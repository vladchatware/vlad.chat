import { Sandbox } from "@vercel/sandbox";
import type { ComputerSession } from "./types";
import {
  INSTALL_PLAYWRIGHT_SH,
  INSTALL_DESK_SH,
  INSTALL_CUA_SH,
  START_DESK_SH,
  LAUNCH_CHROME_CJS,
  RUNNER_CJS,
  SHOOTER_CJS,
} from "./playwright-scripts";
import { CUA_BRIDGE_CJS } from "./cua-bridge-script";
import { SOFT_CURSOR_PY } from "./soft-cursor-script";

/** Session operational limits — tune here; fail closed when hit. */
export const COMPUTER_USE_MAX_TTL_MS = 8 * 60 * 1000; // 8 min wall clock
export const COMPUTER_USE_MAX_STEPS = 20; // per session
export const COMPUTER_USE_MAX_CONCURRENT = 1; // per user/session key
export const COMPUTER_USE_IDLE_MS = 90 * 1000; // reclaim if idle
/** Sandbox create timeout must not exceed TTL. */
const SANDBOX_CREATE_TIMEOUT_MS = COMPUTER_USE_MAX_TTL_MS;

export class ComputerUseCapError extends Error {
  readonly code: "budget_exceeded" | "ttl_exceeded" | "step_limit";
  constructor(code: ComputerUseCapError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ComputerUseCapError";
  }
}

const sessions = new Map<string, ComputerSession>();

export function computerUseEnabled(): boolean {
  return (
    process.env.COMPUTER_USE_ENABLED === "1" ||
    process.env.COMPUTER_USE_ENABLED === "true"
  );
}

export function resolveSandboxCredentials():
  | { mode: "oidc" }
  | { mode: "token"; token: string; teamId: string; projectId: string }
  | { mode: "none" } {
  const teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || "";
  const projectId = process.env.VERCEL_PROJECT_ID || "";
  const token = process.env.VERCEL_TOKEN || process.env.VERCEL_ACCESS_TOKEN || "";
  if (token && teamId && projectId) {
    return { mode: "token", token, teamId, projectId };
  }
  if (process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL) {
    return { mode: "oidc" };
  }
  return { mode: "none" };
}

function createParams(): Record<string, unknown> {
  const creds = resolveSandboxCredentials();
  const snapshotId = process.env.COMPUTER_USE_SNAPSHOT_ID;
  const base: Record<string, unknown> = {
    timeout: SANDBOX_CREATE_TIMEOUT_MS,
    resources: { vcpus: 8 }, // 2GB/vCPU → 16GB; open skips shot to avoid 137
    persistent: false,
    // noVNC websockify listens on 6080 inside the sandbox.
    ports: [6080],
  };
  if (snapshotId) {
    base.source = { type: "snapshot", snapshotId };
  }
  if (creds.mode === "token") {
    base.token = creds.token;
    base.teamId = creds.teamId;
    base.projectId = creds.projectId;
  }
  return base;
}

function sandboxNameFor(sessionKey: string): string {
  const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "anon";
  return `vlad-cu-${safe}`.slice(0, 63);
}

function credFields(params: Record<string, unknown>) {
  if (typeof params.token === "string") {
    return {
      token: params.token as string,
      teamId: params.teamId as string,
      projectId: params.projectId as string,
    };
  }
  return {};
}

export async function getOrCreateSessionSandbox(sessionKey: string): Promise<{
  sandbox: Sandbox;
  session: ComputerSession;
}> {
  const existing = sessions.get(sessionKey);
  const name = existing?.sandboxName || sandboxNameFor(sessionKey);
  const params = { ...createParams(), name };

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create(
      params as Parameters<typeof Sandbox.create>[0],
    );
  } catch {
    sandbox = await Sandbox.get({
      name,
      ...credFields(params),
    } as Parameters<typeof Sandbox.get>[0]);
  }

  const session: ComputerSession = {
    sessionKey,
    sandboxName: name,
    createdAt: existing?.createdAt ?? Date.now(),
    lastUsedAt: Date.now(),
    stepCount: existing?.stepCount ?? 0,
    viewerUrl: existing?.viewerUrl,
    deskReady: existing?.deskReady,
  };
  sessions.set(sessionKey, session);

  // Re-run install whenever chromium binary is missing (npm package alone is insufficient).
  const marker = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      "export PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers; "
        + "if [ -d /tmp/cu-npm/node_modules/playwright ] && "
        + "ls /tmp/cu-browsers/chromium-*/chrome-linux*/chrome >/dev/null 2>&1; "
        + "then echo ready; else echo missing; fi",
    ],
  });
  if (!(await marker.stdout()).includes("ready")) {
    const install = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", INSTALL_PLAYWRIGHT_SH],
      sudo: true,
      timeoutMs: 8 * 60 * 1000,
    });
    if (install.exitCode !== 0) {
      throw new Error(
        `Playwright install failed: ${(await install.stderr()) || (await install.stdout())}`,
      );
    }
  }


  // Live desk: Xvfb + x11vnc + noVNC + headed Chromium (CDP :9222) so humans can VNC-control.
  // Re-run START when in-memory deskReady but CDP died (warm lambda / crashed chrome).
  let deskOk = Boolean(session.deskReady && session.viewerUrl);
  if (deskOk) {
    const cdp = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "curl -fsS http://127.0.0.1:9222/json/version >/dev/null && echo up || echo down"],
    });
    if (!(await cdp.stdout()).includes("up")) {
      deskOk = false;
      session.deskReady = false;
    }
  }
  if (!deskOk) {
    const deskInstall = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", INSTALL_DESK_SH],
      sudo: true,
      timeoutMs: 5 * 60 * 1000,
    });
    if (deskInstall.exitCode !== 0) {
      throw new Error(
        `Desk install failed: ${(await deskInstall.stderr()) || (await deskInstall.stdout())}`,
      );
    }
    // cua-driver for sandbox user (not root). Apt deps already in INSTALL_DESK_SH.
    const cuaInstall = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", INSTALL_CUA_SH],
      timeoutMs: 5 * 60 * 1000,
    });
    if (cuaInstall.exitCode !== 0) {
      // Non-fatal — CDP/Playwright fallback still works.
      console.warn(
        `cua-driver install failed (fallback to CDP): ${(await cuaInstall.stderr()) || (await cuaInstall.stdout())}`,
      );
    }
    await sandbox.writeFiles([
      { path: "/tmp/cu/launch-chrome.cjs", content: Buffer.from(LAUNCH_CHROME_CJS) },
      { path: "/tmp/cu/runner.cjs", content: Buffer.from(RUNNER_CJS) },
      { path: "/tmp/cu/shooter.cjs", content: Buffer.from(SHOOTER_CJS) },
      { path: "/tmp/cu/cua-bridge.cjs", content: Buffer.from(CUA_BRIDGE_CJS) },
      { path: "/tmp/cu/soft-cursor.py", content: Buffer.from(SOFT_CURSOR_PY) },
    ]);
    const deskStart = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", START_DESK_SH],
      timeoutMs: 3 * 60 * 1000,
    });
    if (deskStart.exitCode !== 0) {
      throw new Error(
        `Desk start failed: ${(await deskStart.stderr()) || (await deskStart.stdout())}`,
      );
    }
    try {
      if (typeof (sandbox as { update?: (p: { ports: number[] }) => Promise<unknown> }).update === "function") {
        await (sandbox as { update: (p: { ports: number[] }) => Promise<unknown> }).update({
          ports: [6080],
        });
      }
    } catch {
      /* port may already be mapped from create */
    }
    let viewerUrl: string | undefined;
    try {
      const base = sandbox.domain(6080);
      const root = base.replace(/\/$/, "");
      let entry = "vnc.html";
      try {
        const entryBuf = await sandbox.readFileToBuffer({ path: "/tmp/cu/novnc-entry" });
        const raw = entryBuf?.toString("utf8").trim();
        if (raw && raw.endsWith(".html")) entry = raw;
      } catch {
        /* default vnc.html */
      }
      viewerUrl = `${root}/${entry}?autoconnect=1&resize=scale`;
    } catch (err) {
      throw new Error(
        `Sandbox port 6080 not routed for noVNC: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    session.viewerUrl = viewerUrl;
    session.deskReady = true;
    sessions.set(sessionKey, session);
  }

  await sandbox.writeFiles([
    { path: "/tmp/cu/runner.cjs", content: Buffer.from(RUNNER_CJS) },
    { path: "/tmp/cu/shooter.cjs", content: Buffer.from(SHOOTER_CJS) },
    { path: "/tmp/cu/cua-bridge.cjs", content: Buffer.from(CUA_BRIDGE_CJS) },
    { path: "/tmp/cu/soft-cursor.py", content: Buffer.from(SOFT_CURSOR_PY) },
  ]);

  return { sandbox, session };
}

export function budgetStatus(session: ComputerSession) {
  const elapsedMs = Date.now() - session.createdAt;
  return {
    stepsUsed: session.stepCount,
    stepsRemaining: Math.max(0, COMPUTER_USE_MAX_STEPS - session.stepCount),
    maxSteps: COMPUTER_USE_MAX_STEPS,
    ttlMs: COMPUTER_USE_MAX_TTL_MS,
    elapsedMs,
    note: "Computer-use sessions are short-lived. Caps: 8 min / 20 steps / 1 sandbox.",
  };
}

function assertSessionCaps(sessionKey: string, session: ComputerSession | undefined) {
  // Concurrent: Map is keyed by sessionKey; enforce one active sandbox per user key.
  // (Map size for this key is always 0|1; also reject if another key shares same user prefix — kept simple: 1 entry per sessionKey.)
  void COMPUTER_USE_MAX_CONCURRENT;

  if (!session) return;

  const now = Date.now();
  if (now - session.createdAt > COMPUTER_USE_MAX_TTL_MS) {
    throw new ComputerUseCapError(
      "ttl_exceeded",
      `Computer-use session exceeded ${COMPUTER_USE_MAX_TTL_MS / 60000} min TTL. Call computer_end and start a new short task.`,
    );
  }
  if (now - session.lastUsedAt > COMPUTER_USE_IDLE_MS) {
    throw new ComputerUseCapError(
      "budget_exceeded",
      `Computer-use idle > ${COMPUTER_USE_IDLE_MS / 1000}s — sandbox reclaimed. Open again if needed.`,
    );
  }
  if (session.stepCount >= COMPUTER_USE_MAX_STEPS) {
    throw new ComputerUseCapError(
      "step_limit",
      `Computer-use step limit (${COMPUTER_USE_MAX_STEPS}) reached for this session.`,
    );
  }
}

export async function reclaimIfIdle(sessionKey: string): Promise<boolean> {
  const existing = sessions.get(sessionKey);
  if (!existing) return false;
  if (Date.now() - existing.lastUsedAt <= COMPUTER_USE_IDLE_MS) return false;
  await endComputerSession(sessionKey);
  return true;
}

export async function runComputerOp(
  sessionKey: string,
  cmd: Record<string, unknown>,
): Promise<{
  meta: Record<string, unknown>;
  png: Buffer | null;
  sandboxName: string;
  viewerUrl?: string;
  budget: ReturnType<typeof budgetStatus>;
}> {
  // Idle reclaim before create/reuse (fail closed — no silent burn).
  const prior = sessions.get(sessionKey);
  if (prior && Date.now() - prior.lastUsedAt > COMPUTER_USE_IDLE_MS) {
    await endComputerSession(sessionKey);
    throw new ComputerUseCapError(
      "budget_exceeded",
      `Computer-use idle > ${COMPUTER_USE_IDLE_MS / 1000}s — sandbox reclaimed. Open again for a short task.`,
    );
  }
  if (prior) assertSessionCaps(sessionKey, prior);

  const { sandbox, session } = await getOrCreateSessionSandbox(sessionKey);
  assertSessionCaps(sessionKey, session);

  async function readShotMeta(): Promise<{
    meta: Record<string, unknown>;
    png: Buffer | null;
  }> {
    const metaBuf = await sandbox.readFileToBuffer({ path: "/tmp/cu/meta.json" });
    const meta = metaBuf ? JSON.parse(metaBuf.toString("utf8")) : { ok: true };
    let png: Buffer | null = null;
    try {
      png = await sandbox.readFileToBuffer({ path: "/tmp/cu/shot.jpg" });
    } catch {
      /* no jpeg */
    }
    if (!png || png.length === 0) {
      try {
        png = await sandbox.readFileToBuffer({ path: "/tmp/cu/shot.png" });
      } catch {
        png = null;
      }
    }
    return { meta, png };
  }

  const cuEnv =
    'export PATH="$HOME/.local/bin:$PATH" DISPLAY=:99; '
    + "[ -f /tmp/cu/dbus.env ] && . /tmp/cu/dbus.env; ";

  async function runShooter(): Promise<{
    exitCode: number | null;
    stderr: () => Promise<string>;
  }> {
    // No Playwright — raw CDP JPEG (or scrot fallback). Low NODE heap.
    return sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        cuEnv + "export NODE_OPTIONS='--max-old-space-size=96'; node /tmp/cu/shooter.cjs",
      ],
      timeoutMs: 60 * 1000,
    });
  }

  async function runCua(
    op: "screenshot" | "act" | "refresh-target",
    actionJson?: string,
  ): Promise<{
    exitCode: number | null;
    stderr: () => Promise<string>;
  }> {
    const actArg =
      op === "act" ? ` '${(actionJson || "{}").replace(/'/g, `'\\''`)}'` : "";
    return sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        cuEnv
          + "export NODE_OPTIONS='--max-old-space-size=96'; "
          + `node /tmp/cu/cua-bridge.cjs ${op}${actArg}`,
      ],
      timeoutMs: op === "act" ? 90 * 1000 : 60 * 1000,
    });
  }

  // screenshot: prefer cua-driver; fall back to CDP/scrot shooter.
  if (cmd.op === "screenshot") {
    let shot = await runCua("screenshot");
    if (shot.exitCode !== 0) {
      shot = await runShooter();
    }
    if (shot.exitCode !== 0) {
      let errMeta: { error?: string } | null = null;
      try {
        const errBuf = await sandbox.readFileToBuffer({ path: "/tmp/cu/meta.json" });
        errMeta = errBuf ? JSON.parse(errBuf.toString("utf8")) : null;
      } catch {
        /* no meta */
      }
      const base =
        errMeta?.error || (await shot.stderr()) || `shooter exit ${shot.exitCode}`;
      const viewer = session.viewerUrl ? ` viewerUrl=${session.viewerUrl}` : "";
      throw new Error(`${base}${viewer}`);
    }
    const { meta, png } = await readShotMeta();
    session.lastUsedAt = Date.now();
    session.stepCount += 1;
    sessions.set(sessionKey, session);
    return {
      meta,
      png,
      sandboxName: session.sandboxName,
      viewerUrl: session.viewerUrl,
      budget: budgetStatus(session),
    };
  }

  // act: prefer cua-driver; fall back to Playwright runner + shot.
  if (cmd.op === "act") {
    const action = (
      cmd.action && typeof cmd.action === "object" ? cmd.action : {}
    ) as Record<string, unknown>;
    let meta: Record<string, unknown> = { ok: true };
    let png: Buffer | null = null;

    const cuaAct = await runCua("act", JSON.stringify(action));
    if (cuaAct.exitCode === 0) {
      meta = (await readShotMeta()).meta;
    } else {
      const payload = JSON.stringify(cmd).replace(/'/g, `'\\''`);
      const run = await sandbox.runCommand({
        cmd: "bash",
        args: [
          "-lc",
          cuEnv
            + "export PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers NODE_OPTIONS='--max-old-space-size=192'; "
            + `node /tmp/cu/runner.cjs '${payload}'`,
        ],
        timeoutMs: 2 * 60 * 1000,
      });
      if (run.exitCode !== 0) {
        const errBuf = await sandbox.readFileToBuffer({ path: "/tmp/cu/meta.json" });
        const errMeta = errBuf ? JSON.parse(errBuf.toString("utf8")) : null;
        const base =
          errMeta?.error || (await run.stderr()) || `runner exit ${run.exitCode}`;
        const viewer = session.viewerUrl ? ` viewerUrl=${session.viewerUrl}` : "";
        throw new Error(`${base}${viewer}`);
      }
      const runMeta = await readShotMeta();
      meta = { ...runMeta.meta, via: runMeta.meta.via || "playwright" };
    }

    let shot = await runCua("screenshot");
    if (shot.exitCode !== 0) shot = await runShooter();
    if (shot.exitCode === 0) {
      const shotMeta = await readShotMeta();
      meta = {
        ...meta,
        ...shotMeta.meta,
        action: meta.action || shotMeta.meta.action || action.type,
        shot: true,
      };
      png = shotMeta.png;
    } else {
      meta = { ...meta, shot: false, shotNote: `shooter exit ${shot.exitCode}` };
      png = null;
    }

    session.lastUsedAt = Date.now();
    session.stepCount += 1;
    sessions.set(sessionKey, session);
    return {
      meta,
      png,
      sandboxName: session.sandboxName,
      viewerUrl: session.viewerUrl,
      budget: budgetStatus(session),
    };
  }

  // open (and other runner ops): Playwright CDP navigate; refresh cua target after open.
  const payload = JSON.stringify(cmd).replace(/'/g, `'\\''`);
  const run = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      cuEnv
        + "export PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers NODE_OPTIONS='--max-old-space-size=192'; "
        + `node /tmp/cu/runner.cjs '${payload}'`,
    ],
    timeoutMs: 2 * 60 * 1000,
  });
  if (run.exitCode !== 0) {
    const errBuf = await sandbox.readFileToBuffer({ path: "/tmp/cu/meta.json" });
    const errMeta = errBuf ? JSON.parse(errBuf.toString("utf8")) : null;
    const base =
      errMeta?.error || (await run.stderr()) || `runner exit ${run.exitCode}`;
    // computer_open: desk/viewerUrl is the acceptance signal. Runner SIGKILL(137)
    // on navigate used to fail the whole op even though noVNC was healthy.
    if (cmd.op === "open" && session.viewerUrl) {
      await runCua("refresh-target").catch(() => undefined);
      session.lastUsedAt = Date.now();
      session.stepCount += 1;
      sessions.set(sessionKey, session);
      return {
        meta: {
          ok: true,
          url: typeof cmd.url === "string" ? cmd.url : undefined,
          action: "open",
          shot: false,
          runnerExit: run.exitCode,
          note: String(base).slice(0, 240),
        },
        png: null,
        sandboxName: session.sandboxName,
        viewerUrl: session.viewerUrl,
        budget: budgetStatus(session),
      };
    }
    const viewer = session.viewerUrl ? ` viewerUrl=${session.viewerUrl}` : "";
    throw new Error(`${base}${viewer}`);
  }

  if (cmd.op === "open") {
    await runCua("refresh-target").catch(() => undefined);
  }

  const runMeta = await readShotMeta();
  session.lastUsedAt = Date.now();
  session.stepCount += 1;
  sessions.set(sessionKey, session);
  return {
    meta: runMeta.meta,
    png: null,
    sandboxName: session.sandboxName,
    viewerUrl: session.viewerUrl,
    budget: budgetStatus(session),
  };
}

export async function endComputerSession(sessionKey: string): Promise<void> {
  const existing = sessions.get(sessionKey);
  if (!existing) return;
  try {
    const params = createParams();
    const sandbox = await Sandbox.get({
      name: existing.sandboxName,
      ...credFields(params),
    } as Parameters<typeof Sandbox.get>[0]);
    try {
      await sandbox.stop();
    } catch {
      /* already stopped */
    }
    if (typeof sandbox.delete === "function") {
      await sandbox.delete().catch(() => undefined);
    }
  } finally {
    sessions.delete(sessionKey);
  }
}
