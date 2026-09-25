import { Sandbox } from "@vercel/sandbox";
import type { ComputerSession } from "./types";
import { INSTALL_PLAYWRIGHT_SH, RUNNER_CJS } from "./playwright-scripts";

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
    resources: { vcpus: 2 },
    persistent: false,
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
  };
  sessions.set(sessionKey, session);

  // Re-run install whenever chromium binary is missing (npm package alone is insufficient).
  const marker = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      "export PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers; "
        + "if [ -d /tmp/cu-npm/node_modules/playwright ] && "
        + "{ ls /tmp/cu-browsers/chromium-*/chrome-linux*/chrome >/dev/null 2>&1 "
        + "|| ls /tmp/cu-browsers/chromium_headless_shell-*/chrome-linux*/headless_shell >/dev/null 2>&1; }; "
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

  await sandbox.writeFiles([
    { path: "/tmp/cu/runner.cjs", content: Buffer.from(RUNNER_CJS) },
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
  const payload = JSON.stringify(cmd).replace(/'/g, `'\\''`);
  const run = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `export PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers; node /tmp/cu/runner.cjs '${payload}'`],
    timeoutMs: 2 * 60 * 1000,
  });
  if (run.exitCode !== 0) {
    const errBuf = await sandbox.readFileToBuffer({ path: "/tmp/cu/meta.json" });
    const errMeta = errBuf ? JSON.parse(errBuf.toString("utf8")) : null;
    throw new Error(
      errMeta?.error || (await run.stderr()) || `runner exit ${run.exitCode}`,
    );
  }
  const metaBuf = await sandbox.readFileToBuffer({ path: "/tmp/cu/meta.json" });
  const meta = metaBuf ? JSON.parse(metaBuf.toString("utf8")) : { ok: true };
  const png = await sandbox.readFileToBuffer({ path: "/tmp/cu/shot.png" });
  session.lastUsedAt = Date.now();
  session.stepCount += 1;
  sessions.set(sessionKey, session);
  return { meta, png, sandboxName: session.sandboxName, budget: budgetStatus(session) };
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
