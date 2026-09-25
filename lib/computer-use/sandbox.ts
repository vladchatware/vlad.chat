import { Sandbox } from "@vercel/sandbox";
import type { ComputerSession } from "./types";
import { INSTALL_PLAYWRIGHT_SH, RUNNER_CJS } from "./playwright-scripts";

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
    timeout: 15 * 60 * 1000,
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
  };
  sessions.set(sessionKey, session);

  const marker = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      "test -d /tmp/cu-npm/node_modules/playwright && echo ready || echo missing",
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
      throw new Error(`Playwright install failed: ${await install.stderr()}`);
    }
  }

  await sandbox.writeFiles([
    { path: "/tmp/cu/runner.cjs", content: Buffer.from(RUNNER_CJS) },
  ]);

  return { sandbox, session };
}

export async function runComputerOp(
  sessionKey: string,
  cmd: Record<string, unknown>,
): Promise<{
  meta: Record<string, unknown>;
  png: Buffer | null;
  sandboxName: string;
}> {
  const { sandbox, session } = await getOrCreateSessionSandbox(sessionKey);
  const payload = JSON.stringify(cmd).replace(/'/g, `'\\''`);
  const run = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `node /tmp/cu/runner.cjs '${payload}'`],
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
  sessions.set(sessionKey, session);
  return { meta, png, sandboxName: session.sandboxName };
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
