import { Sandbox } from "@vercel/sandbox";
import { createHash, randomBytes } from "node:crypto";
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
import {
  getStoredComputerSession,
  publishLiveComputerSession,
  recordComputerSessionActivity,
} from "./artifacts";
import { resolveSandboxCredentials } from "./credentials";
import { COMPUTER_USE_MAX_TTL_MS } from "./limits";
import { COMPUTER_ACTION_SAFETY_SOURCE } from "./safety";

export { COMPUTER_USE_MAX_TTL_MS } from "./limits";

/** Session operational limits — tune here; fail closed when hit. */
export const COMPUTER_USE_MAX_STEPS = 20; // per session
export const COMPUTER_USE_MAX_CONCURRENT = 1; // per user/session key
export { COMPUTER_USE_IDLE_MS } from "./limits";
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

export type SandboxCodeRun = {
  code: string;
  description: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

const CODE_MODE_SOURCE_LIMIT = 64 * 1024;
const CODE_MODE_OUTPUT_LIMIT = 64 * 1024;

function sandboxCodeSource(code: string, resultMarker: string): string {
  return `import { createRequire } from "node:module";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
const require = createRequire(import.meta.url);
const execFile = promisify(execFileCallback);
const run = async (cmd, args, options = {}) => {
  const result = await execFile(cmd, args, {
    cwd: options.cwd ?? "/vercel/sandbox",
    maxBuffer: 1024 * 1024,
    timeout: options.timeoutMs ?? 30000,
    env: process.env,
  });
  return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
};
const blockedComputerText = ${COMPUTER_ACTION_SAFETY_SOURCE};
const tools = Object.freeze({
  run_command: async ({ command, cwd, timeoutMs }) => {
    try {
      return await run("bash", ["-lc", command], { cwd, timeoutMs });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        return {
          exitCode: typeof error.code === "number" ? error.code : null,
          stdout: typeof error.stdout === "string" ? error.stdout : "",
          stderr: typeof error.stderr === "string" ? error.stderr : String(error),
        };
      }
      throw error;
    }
  },
  read_file: async ({ path }) => readFile(path, "utf8"),
  write_file: async ({ path, content }) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    return { path, bytesWritten: Buffer.byteLength(content, "utf8") };
  },
  computer: Object.freeze({
    screenshot: async () => {
      await run("node", ["/tmp/cu/cua-bridge.cjs", "screenshot"]);
      return JSON.parse(await readFile("/tmp/cu/meta.json", "utf8"));
    },
    act: async (action) => {
      if (action.type === "type" && blockedComputerText(action.text)) {
        throw new Error("Payment or signing text requires user handoff. Stop and call computer_handoff.");
      }
      await run("node", ["/tmp/cu/cua-bridge.cjs", "act", JSON.stringify(action)]);
      await run("node", ["/tmp/cu/cua-bridge.cjs", "screenshot"]);
      return JSON.parse(await readFile("/tmp/cu/meta.json", "utf8"));
    },
  }),
});
try {
  const value = await (async () => {\n${code}\n})();
  process.stdout.write(${JSON.stringify(resultMarker)} + JSON.stringify(value === undefined ? null : value));
} catch (error) {
  process.stderr.write(String(error instanceof Error ? error.stack ?? error.message : error));
  process.exitCode = 1;
}
`;
}

function limitCodeOutput(value: string): { value: string; truncated: boolean } {
  if (value.length <= CODE_MODE_OUTPUT_LIMIT) {
    return { value, truncated: false };
  }
  return { value: value.slice(0, CODE_MODE_OUTPUT_LIMIT), truncated: true };
}

function limitCombinedCodeOutput(stdout: string, stderr: string) {
  const stdoutLimit = limitCodeOutput(stdout);
  const stderrLimit = limitCodeOutput(
    stderr.slice(0, Math.max(0, CODE_MODE_OUTPUT_LIMIT - stdoutLimit.value.length)),
  );
  return {
    stdout: stdoutLimit.value,
    stderr: stderrLimit.value,
    truncated:
      stdoutLimit.truncated ||
      stderrLimit.truncated ||
      stdout.length + stderr.length > CODE_MODE_OUTPUT_LIMIT,
  };
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
    persistent: true,
    keepLastSnapshots: { count: 1 },
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
  const inMemory = sessions.get(sessionKey);
  const stored = await getStoredComputerSession(sessionKey);
  const existing = stored ?? inMemory;
  const configuredSnapshot = process.env.COMPUTER_USE_SNAPSHOT_ID;
  const name =
    existing?.sandboxName ||
    (configuredSnapshot
      ? snapshotSandboxName(sessionKey, configuredSnapshot)
      : sandboxNameFor(sessionKey));
  const params = { ...createParams(), name };

  const now = Date.now();
  const storedUpdatedAt = existing && "updatedAt" in existing ? existing.updatedAt : undefined;
  const restoredAt = existing?.createdAt ?? storedUpdatedAt ?? now;
  const session: ComputerSession = {
    sessionKey,
    sessionId:
      existing?.sessionId ??
      createHash("sha256")
        .update(`${sessionKey}:${name}:${restoredAt}`)
        .digest("hex")
        .slice(0, 32),
    provider: "vercel",
    status: "starting",
    threadId: threadId ?? existing?.threadId,
    sandboxName: name,
    viewerToken: existing?.viewerToken ?? randomBytes(32).toString("hex"),
    createdAt: restoredAt,
    lastUsedAt: existing?.lastUsedAt ?? restoredAt,
    stepCount: existing?.stepCount ?? 0,
    viewerUrl: existing?.viewerUrl,
    nativeViewerUrl: existing?.nativeViewerUrl,
    deskReady: Boolean(inMemory?.deskReady),
  };
  sessions.set(sessionKey, session);
  await publishLiveComputerSession(sessionKey, session.sessionId, session, "starting");

  // A named sandbox can outlive the snapshot it was created from. `getOrCreate`
  // handles Vercel's `snapshot_not_found` response by deleting that stale sandbox
  // and creating a fresh one; a create/get fallback leaves it stuck forever.
  const sandbox = await Sandbox.getOrCreate(
    params as Parameters<typeof Sandbox.getOrCreate>[0],
  );

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

  // Live desk: Xvfb + authenticated noVNC/WebSocket + headed Chromium (CDP :9222).
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
      {
        path: "/tmp/cu/websockify-tokens",
        content: Buffer.from(`${session.viewerToken}: 127.0.0.1:5900\n`),
        mode: 0o600,
      },
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
      const websocketPath = encodeURIComponent(`websockify?token=${session.viewerToken}`);
      viewerUrl = `${root}/${entry}?autoconnect=1&resize=scale#path=${websocketPath}`;
      nativeViewerUrl = `${root}/vladchat.html#token=${session.viewerToken}`;
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

  session.status = "running";
  session.lastUsedAt = Date.now();
  sessions.set(sessionKey, session);
  await publishLiveComputerSession(sessionKey, session.sessionId, session, "active");

  return { sandbox, session };
}

export type SandboxCodeResult = {
  runId: string;
  status: "completed" | "failed" | "stopped" | "interrupted";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  valueJson?: string;
  valueTruncated: boolean;
  timedOut: boolean;
  screenshot?: Buffer;
};

type CodeRunState = {
  runId: string;
  description: string;
  code: string;
  status: "running" | "completed" | "failed" | "stopped" | "interrupted";
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  returnValue?: string;
  exitCode?: number;
  errorText?: string;
  startedAt: number;
  finishedAt?: number;
};

function codeRunEndpoint(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!configuredUrl) throw new Error("Code run persistence requires NEXT_PUBLIC_CONVEX_URL.");
  const url = new URL(configuredUrl);
  if (url.hostname.endsWith(".convex.cloud")) {
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  }
  if (!url.hostname.endsWith(".convex.site")) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL must use a Convex deployment hostname.");
  }
  url.pathname = "/computer-use/code-runs";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function publishCodeRun(
  token: string,
  state: CodeRunState,
  includeSource = false,
): Promise<void> {
  const progress: Omit<CodeRunState, "code" | "description"> = {
    runId: state.runId,
    status: state.status,
    stdout: state.stdout,
    stderr: state.stderr,
    outputTruncated: state.outputTruncated,
    ...(state.returnValue === undefined ? {} : { returnValue: state.returnValue }),
    ...(state.exitCode === undefined ? {} : { exitCode: state.exitCode }),
    ...(state.errorText === undefined ? {} : { errorText: state.errorText }),
    startedAt: state.startedAt,
    ...(state.finishedAt === undefined ? {} : { finishedAt: state.finishedAt }),
  };
  const response = await fetch(codeRunEndpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(includeSource ? state : progress),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Code run persistence failed (${response.status})${detail ? `: ${detail}` : ""}.`);
  }
}

/** Execute one TypeScript program inside an already-running computer sandbox. */
export async function runSandboxCode(
  sessionKey: string,
  threadId: string,
  input: SandboxCodeRun,
  grantToken: string | undefined,
): Promise<SandboxCodeResult> {
  if (!grantToken) throw new Error("Code execution requires a signed run grant.");
  if (Buffer.byteLength(input.code, "utf8") > CODE_MODE_SOURCE_LIMIT) {
    throw new Error("TypeScript program exceeds the 64 KiB source limit.");
  }
  const prior = (await getStoredComputerSession(sessionKey)) ?? sessions.get(sessionKey);
  if (prior?.status !== "running" || (prior.threadId && prior.threadId !== threadId)) {
    throw new Error("Open a live computer in this chat before running TypeScript.");
  }
  const sessionCreatedAt = prior.createdAt ??
    ("updatedAt" in prior ? prior.updatedAt : Date.now());
  const sessionAgeMs = Date.now() - sessionCreatedAt;
  const remainingTtlMs = COMPUTER_USE_MAX_TTL_MS - sessionAgeMs;
  if (remainingTtlMs < 1000) {
    throw new Error("Computer session is too close to its expiry to start a code run.");
  }

  const { sandbox, session } = await getOrCreateSessionSandbox(sessionKey, threadId);
  if (session.status !== "running" || (session.threadId && session.threadId !== threadId)) {
    throw new Error("Computer session is no longer available to this chat.");
  }
  const activity = await recordComputerSessionActivity(session);
  session.stepCount = activity.stepCount;
  session.lastUsedAt = activity.lastUsedAt;

  const runId = randomBytes(16).toString("hex");
  const resultMarker = `\n__VLAD_CODE_RESULT_${runId}__`;
  const startedAt = Date.now();
  const runState: CodeRunState = {
    runId,
    description: input.description,
    code: input.code,
    status: "running",
    stdout: "",
    stderr: "",
    outputTruncated: false,
    startedAt,
  };
  await publishCodeRun(grantToken, runState, true);

  const path = `/tmp/cu/code-${runId}.mts`;
  let previousMeta: string | undefined;
  try {
    previousMeta = (await sandbox.readFileToBuffer({ path: "/tmp/cu/meta.json" }))?.toString("utf8");
  } catch {
    previousMeta = undefined;
  }
  try {
    await sandbox.writeFiles([
      { path, content: Buffer.from(sandboxCodeSource(input.code, resultMarker), "utf8"), mode: 0o600 },
    ]);
    const command = await sandbox.runCommand({
      cmd: "node",
      args: ["--experimental-strip-types", path],
      cwd: "/vercel/sandbox",
      timeoutMs: Math.min(input.timeoutMs, remainingTtlMs),
      detached: true,
    });
    let lastPublishedAt = Date.now();
    let pendingLogChars = 0;
    const appendLog = (stream: "stdout" | "stderr", chunk: string) => {
      const remaining = Math.max(
        0,
        CODE_MODE_OUTPUT_LIMIT - runState.stdout.length - runState.stderr.length,
      );
      runState[stream] += chunk.slice(0, remaining);
      if (chunk.length > remaining) runState.outputTruncated = true;
      pendingLogChars += chunk.length;
    };
    let logPersistenceError: string | undefined;
    const logPump = (async () => {
      for await (const line of command.logs({ signal: input.signal })) {
        if (line.stream === "stdout" || line.stream === "stderr") {
          appendLog(line.stream, line.data);
        }
        if (pendingLogChars >= 1024 || Date.now() - lastPublishedAt >= 500) {
          try {
            await publishCodeRun(grantToken, runState);
            pendingLogChars = 0;
            lastPublishedAt = Date.now();
          } catch (error) {
            logPersistenceError = error instanceof Error ? error.message : String(error);
          }
        }
      }
    })().catch((error: unknown) => {
      logPersistenceError = error instanceof Error ? error.message : String(error);
    });
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    const killOnAbort = () => {
      void command.kill("SIGTERM").then(() => {
        abortTimer = setTimeout(() => void command.kill("SIGKILL").catch(() => undefined), 2000);
      }).catch(() => undefined);
    };
    input.signal?.addEventListener("abort", killOnAbort, { once: true });
    if (input.signal?.aborted) killOnAbort();
    let finished: Awaited<ReturnType<typeof command.wait>>;
    try {
      finished = await command.wait();
    } finally {
      input.signal?.removeEventListener("abort", killOnAbort);
      if (abortTimer) clearTimeout(abortTimer);
    }
    await logPump;
    const [rawStdout, rawStderr] = await Promise.all([
      finished.stdout(),
      finished.stderr(),
    ]);
    const markerIndex = rawStdout.lastIndexOf(resultMarker);
    const rawValue = markerIndex < 0
      ? undefined
      : rawStdout.slice(markerIndex + resultMarker.length).trim();
    const stdout = markerIndex < 0 ? rawStdout : rawStdout.slice(0, markerIndex);
    const capped = limitCombinedCodeOutput(stdout, rawStderr);
    const valueTruncated = rawValue !== undefined && Buffer.byteLength(rawValue, "utf8") > 16 * 1024;
    let screenshot: Buffer | undefined;
    try {
      const latestMeta = (await sandbox.readFileToBuffer({ path: "/tmp/cu/meta.json" }))?.toString("utf8");
      if (latestMeta && latestMeta !== previousMeta) {
        screenshot = (await sandbox.readFileToBuffer({ path: "/tmp/cu/shot.jpg" })) ?? undefined;
      }
    } catch {
      screenshot = undefined;
    }
    const status = input.signal?.aborted
      ? "stopped"
      : finished.exitCode === null
        ? "interrupted"
        : finished.exitCode === 0 ? "completed" : "failed";
    Object.assign(runState, {
      status,
      stdout: capped.stdout,
      stderr: capped.stderr,
      outputTruncated: runState.outputTruncated || capped.truncated,
      ...(rawValue === undefined
        ? {}
        : { returnValue: valueTruncated ? JSON.stringify("Return value exceeds 16 KiB.") : rawValue }),
      exitCode: finished.exitCode ?? undefined,
      ...(logPersistenceError ? { errorText: `Some live log updates failed: ${logPersistenceError}` } : {}),
      finishedAt: Date.now(),
    });
    await publishCodeRun(grantToken, runState);
    return {
      runId,
      status,
      exitCode: finished.exitCode,
      stdout: capped.stdout,
      stderr: capped.stderr,
      outputTruncated: runState.outputTruncated || capped.truncated,
      ...(rawValue === undefined
        ? {}
        : {
            valueJson: valueTruncated
              ? JSON.stringify("Return value exceeds 16 KiB.")
              : rawValue,
          }),
      valueTruncated,
      timedOut: finished.exitCode === null && !input.signal?.aborted,
      ...(screenshot ? { screenshot } : {}),
    };
  } catch (error) {
    const stopped = input.signal?.aborted ?? false;
    const message = error instanceof Error ? error.message : String(error);
    Object.assign(runState, {
      status: stopped ? "stopped" : "failed",
      errorText: message,
      finishedAt: Date.now(),
    });
    await publishCodeRun(grantToken, runState);
    throw error;
  } finally {
    await sandbox.runCommand({
      cmd: "rm",
      args: ["-f", path],
      cwd: "/vercel/sandbox",
      timeoutMs: 5000,
    }).catch(() => undefined);
  }
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

function assertSessionCaps(
  session: { createdAt?: number; stepCount?: number } | undefined,
) {
  if (!session) return;

  const now = Date.now();
  if (session.createdAt !== undefined && now - session.createdAt >= COMPUTER_USE_MAX_TTL_MS) {
    throw new ComputerUseCapError(
      "ttl_exceeded",
      `Computer-use session exceeded ${COMPUTER_USE_MAX_TTL_MS / 60000} min TTL. Call computer_open to start a fresh session.`,
    );
  }
  if ((session.stepCount ?? 0) >= COMPUTER_USE_MAX_STEPS) {
    throw new ComputerUseCapError(
      "step_limit",
      `Computer-use step limit (${COMPUTER_USE_MAX_STEPS}) reached for this session.`,
    );
  }
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
  const prior = (await getStoredComputerSession(sessionKey)) ?? sessions.get(sessionKey);
  if (prior) {
    try {
      assertSessionCaps({
        createdAt:
          prior.createdAt ?? ("updatedAt" in prior ? prior.updatedAt : undefined),
        stepCount: prior.stepCount,
      });
    } catch (error) {
      if (cmd.op !== "open" || !(error instanceof ComputerUseCapError)) throw error;
      // A requested open is the recovery path after expiry or a spent step cap.
      // Reclaim once, then create a fresh viewer in this same tool call.
      await endComputerSession(sessionKey);
    }
  }

  const { sandbox, session } = await getOrCreateSessionSandbox(sessionKey, threadId);
  assertSessionCaps(session);
  const activity = await recordComputerSessionActivity(session);
  session.lastUsedAt = activity.lastUsedAt;
  session.stepCount = activity.stepCount;
  session.status = "running";
  sessions.set(sessionKey, session);

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
  const existing = (await getStoredComputerSession(sessionKey)) ?? sessions.get(sessionKey);
  if (!existing) return;
  try {
    const params = createParams();
    const sandbox = await Sandbox.get({
      name: existing.sandboxName,
      ...credFields(params),
    } as Parameters<typeof Sandbox.get>[0]).catch(() => null);
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch {
        /* already stopped */
      }
      if (typeof sandbox.delete === "function") {
        await sandbox.delete({ deleteOrphanSnapshots: true });
      }
    }
    await publishLiveComputerSession(sessionKey, existing.sessionId, null);
  } finally {
    sessions.delete(sessionKey);
  }
}
