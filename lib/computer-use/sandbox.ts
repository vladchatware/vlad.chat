import { Sandbox } from "@vercel/sandbox";
import { createHash } from "node:crypto";
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
import { NATIVE_VIEWER_HTML } from "./native-viewer-script";
import { CUA_BRIDGE_CJS } from "./cua-bridge-script";
import { publishLiveComputerSession } from "./artifacts";
import { resolveSandboxCredentials } from "./credentials";
import { COMPUTER_USE_MAX_TTL_MS } from "./limits";

export { COMPUTER_USE_MAX_TTL_MS } from "./limits";

/** Session operational limits — tune here; fail closed when hit. */
export const COMPUTER_USE_MAX_STEPS = 20; // per session
export const COMPUTER_USE_MAX_CONCURRENT = 1; // per user/session key
export const COMPUTER_USE_IDLE_MS = COMPUTER_USE_MAX_TTL_MS; // keep passive floating preview alive
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

function snapshotSandboxName(sessionKey: string, snapshotId: string): string {
  const fingerprint = createHash("sha256").update(snapshotId).digest("hex").slice(0, 8);
  return `${sandboxNameFor(sessionKey).slice(0, 54)}-${fingerprint}`;
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

export async function getOrCreateSessionSandbox(
  sessionKey: string,
  threadId?: string,
): Promise<{
  sandbox: Sandbox;
  session: ComputerSession;
}> {
  const existing = sessions.get(sessionKey);
  const configuredSnapshot = process.env.COMPUTER_USE_SNAPSHOT_ID;
  const name =
    existing?.sandboxName ||
    (configuredSnapshot
      ? snapshotSandboxName(sessionKey, configuredSnapshot)
      : sandboxNameFor(sessionKey));
  const params = { ...createParams(), name };

  // A named sandbox can outlive the snapshot it was created from. `getOrCreate`
  // handles Vercel's `snapshot_not_found` response by deleting that stale sandbox
  // and creating a fresh one; a create/get fallback leaves it stuck forever.
  const sandbox = await Sandbox.getOrCreate(
    params as Parameters<typeof Sandbox.getOrCreate>[0],
  );

  const session: ComputerSession = {
    sessionKey,
    sessionId: existing?.sessionId ?? createHash("sha256").update(name).digest("hex").slice(0, 32),
    threadId: threadId ?? existing?.threadId,
    sandboxName: name,
    createdAt: existing?.createdAt ?? Date.now(),
    lastUsedAt: Date.now(),
    stepCount: existing?.stepCount ?? 0,
    viewerUrl: existing?.viewerUrl,
    nativeViewerUrl: existing?.nativeViewerUrl,
    deskReady: existing?.deskReady,
  };
  sessions.set(sessionKey, session);

  const setupCheck = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      "if [ -d /tmp/cu-npm/node_modules/playwright ] "
        + "&& ls /tmp/cu-browsers/chromium-*/chrome-linux*/chrome >/dev/null 2>&1 "
        + "&& command -v Xvfb >/dev/null 2>&1 "
        + "&& command -v x11vnc >/dev/null 2>&1 "
        + "&& command -v websockify >/dev/null 2>&1 "
        + "&& command -v curl >/dev/null 2>&1 "
        + "&& { [ -f /usr/share/novnc/vnc.html ] || [ -f /usr/share/novnc/vnc_lite.html ]; }; then echo ready; else echo missing; fi",
    ],
  });
  const setupReady = (await setupCheck.stdout()).trim().endsWith("ready");
  if (configuredSnapshot && !setupReady) {
    throw new Error(
      "Configured computer-use snapshot is missing required desktop dependencies; recreate it before using COMPUTER_USE_SNAPSHOT_ID.",
    );
  }
  if (!setupReady) {
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
  }

  const cuaCheck = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      "export PATH=\"$HOME/.local/bin:$PATH\"; command -v cua-driver >/dev/null 2>&1 && echo ready || echo missing",
    ],
  });
  const cuaReady = (await cuaCheck.stdout()).trim().endsWith("ready");
  if (configuredSnapshot && !cuaReady) {
    throw new Error(
      "Configured computer-use snapshot is missing cua-driver; recreate it with the snapshot script.",
    );
  }
  if (!cuaReady) {
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
  }

  // Live desk: Xvfb + x11vnc + noVNC + headed Chromium (CDP :9222) so humans can VNC-control.
  // Re-run START when in-memory deskReady but CDP died (warm lambda / crashed chrome).
  let deskOk = Boolean(session.deskReady && session.viewerUrl && session.nativeViewerUrl);
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
    await sandbox.writeFiles([
      { path: "/tmp/cu/launch-chrome.cjs", content: Buffer.from(LAUNCH_CHROME_CJS) },
      { path: "/tmp/cu/runner.cjs", content: Buffer.from(RUNNER_CJS) },
      { path: "/tmp/cu/shooter.cjs", content: Buffer.from(SHOOTER_CJS) },
      { path: "/tmp/cu/cua-bridge.cjs", content: Buffer.from(CUA_BRIDGE_CJS) },
      { path: "/tmp/cu/native-viewer.html", content: Buffer.from(NATIVE_VIEWER_HTML) },
    ]);
    const deskStart = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", START_DESK_SH],
      timeoutMs: 3 * 60 * 1000,
    });
    if (deskStart.exitCode !== 0) {
      const details = (await deskStart.stderr()) || (await deskStart.stdout());
      throw new Error(
        `Desk start failed (exit ${String(deskStart.exitCode)}): ${details || "no stderr or stdout"}`,
      );
    }
    const routeUpdateSandbox = sandbox as Sandbox & {
      update?: (params: { ports: number[] }) => Promise<unknown>;
    };
    if (typeof routeUpdateSandbox.update === "function") {
      await routeUpdateSandbox.update({ ports: [6080] });
    }
    let viewerUrl: string | undefined;
    let nativeViewerUrl: string | undefined;
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
      nativeViewerUrl = `${root}/vladchat.html`;
    } catch (err) {
      throw new Error(
        `Sandbox port 6080 not routed for noVNC: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    session.viewerUrl = viewerUrl;
    session.nativeViewerUrl = nativeViewerUrl;
    session.deskReady = true;
    sessions.set(sessionKey, session);
  }

  await sandbox.writeFiles([
    { path: "/tmp/cu/runner.cjs", content: Buffer.from(RUNNER_CJS) },
    { path: "/tmp/cu/shooter.cjs", content: Buffer.from(SHOOTER_CJS) },
    { path: "/tmp/cu/cua-bridge.cjs", content: Buffer.from(CUA_BRIDGE_CJS) },
  ]);

  session.sessionId = createHash("sha256")
    .update(`${sessionKey}:${session.sandboxName}:${session.createdAt}`)
    .digest("hex")
    .slice(0, 32);
  sessions.set(sessionKey, session);
  try {
    await publishLiveComputerSession(sessionKey, session.sessionId, {
      viewerUrl: session.viewerUrl,
      nativeViewerUrl: session.nativeViewerUrl,
      ...(session.threadId === undefined ? {} : { threadId: session.threadId }),
    });
  } catch (error) {
    console.warn(
      `Could not publish live computer session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

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
    note: "Computer-use sessions are short-lived. Caps: 30 min / 20 steps / 1 sandbox.",
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
      `Computer-use session exceeded ${COMPUTER_USE_MAX_TTL_MS / 60000} min TTL. Call computer_open to start a fresh session.`,
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
  threadId?: string,
): Promise<{
  meta: Record<string, unknown>;
  png: Buffer | null;
  sandboxName: string;
  viewerUrl?: string;
  nativeViewerUrl?: string;
  budget: ReturnType<typeof budgetStatus>;
}> {
  const prior = sessions.get(sessionKey);
  if (prior) {
    try {
      assertSessionCaps(sessionKey, prior);
    } catch (error) {
      if (cmd.op !== "open" || !(error instanceof ComputerUseCapError)) throw error;
      // A requested open is the recovery path after expiry or a spent step cap.
      // Reclaim once, then create a fresh viewer in this same tool call.
      await endComputerSession(sessionKey);
    }
  }

  const { sandbox, session } = await getOrCreateSessionSandbox(sessionKey, threadId);
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
      nativeViewerUrl: session.nativeViewerUrl,
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
            + "rm -f /tmp/cu/meta.json; "
            + "export PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers NODE_OPTIONS='--max-old-space-size=192'; "
            + `node /tmp/cu/runner.cjs '${payload}'`,
        ],
        timeoutMs: 2 * 60 * 1000,
      });
      if (run.exitCode !== 0) {
        const errBuf = await sandbox.readFileToBuffer({ path: "/tmp/cu/meta.json" });
        const errMeta = errBuf ? JSON.parse(errBuf.toString("utf8")) : null;
        const base =
          (await run.stderr()) || errMeta?.error || `runner exit ${run.exitCode}`;
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
      nativeViewerUrl: session.nativeViewerUrl,
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
        + "rm -f /tmp/cu/meta.json; "
        + "export PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers NODE_OPTIONS='--max-old-space-size=192'; "
        + `node /tmp/cu/runner.cjs '${payload}'`,
    ],
    timeoutMs: 2 * 60 * 1000,
  });
  if (run.exitCode !== 0) {
    const errBuf = await sandbox.readFileToBuffer({ path: "/tmp/cu/meta.json" });
    const errMeta = errBuf ? JSON.parse(errBuf.toString("utf8")) : null;
    const base =
      (await run.stderr()) || errMeta?.error || `runner exit ${run.exitCode}`;
    // Keep desktop viewing available while reporting page navigation failure truthfully.
    if (cmd.op === "open" && session.viewerUrl && session.nativeViewerUrl) {
      await runCua("refresh-target").catch(() => undefined);
      session.lastUsedAt = Date.now();
      session.stepCount += 1;
      sessions.set(sessionKey, session);
      return {
        meta: {
          ok: false,
          url: typeof cmd.url === "string" ? cmd.url : undefined,
          action: "open",
          shot: false,
          error: String(base).slice(0, 240),
        },
        png: null,
        sandboxName: session.sandboxName,
        viewerUrl: session.viewerUrl,
        nativeViewerUrl: session.nativeViewerUrl,
          budget: budgetStatus(session),
      };
    }
    const viewer = session.viewerUrl ? ` viewerUrl=${session.viewerUrl}` : "";
    throw new Error(`${base}${viewer}`);
  }

  const runMeta = await readShotMeta();
  if (cmd.op === "open") {
    // Refresh the optional cua-driver target only after preserving the browser
    // result. A missing daemon writes its error to meta.json and must not turn a
    // successful Playwright navigation into a failed computer_open result.
    await runCua("refresh-target").catch(() => undefined);
  }
  session.lastUsedAt = Date.now();
  session.stepCount += 1;
  sessions.set(sessionKey, session);
  return {
    meta: runMeta.meta,
    png: null,
    sandboxName: session.sandboxName,
    viewerUrl: session.viewerUrl,
    nativeViewerUrl: session.nativeViewerUrl,
    budget: budgetStatus(session),
  };
}

export async function endComputerSession(sessionKey: string): Promise<void> {
  const existing = sessions.get(sessionKey);
  if (!existing) return;
  try {
    try {
      await publishLiveComputerSession(sessionKey, existing.sessionId, null);
    } catch (error) {
      console.warn(
        `Could not clear live computer session: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const params = createParams();
    const sandbox = await Sandbox.get({
      name: existing.sandboxName,
      ...credFields(params),
    } as Parameters<typeof Sandbox.get>[0]).catch(() => null);
    if (!sandbox) return;
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
