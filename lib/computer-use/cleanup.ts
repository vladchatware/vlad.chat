import { Sandbox } from "@vercel/sandbox";
import {
  listStoredComputerSessionsForCleanup,
  publishLiveComputerSession,
} from "./artifacts";
import { resolveSandboxCredentials, sandboxCredentialParams } from "./credentials";
import { COMPUTER_USE_IDLE_MS, COMPUTER_USE_MAX_TTL_MS } from "./limits";
import type { StoredComputerSession } from "./artifacts";

const COMPUTER_USE_SANDBOX_PREFIX = "vlad-cu-";
const TERMINAL_SANDBOX_STATES = new Set(["stopped", "failed", "aborted"]);
const FAILED_SANDBOX_STATES = new Set(["failed", "aborted"]);

export type SandboxCleanupResult = {
  examined: number;
  stopped: number;
  deleted: number;
  reconciled: number;
  skipped: number;
  failed: number;
};

function expiryTime(session: StoredComputerSession): number {
  return (session.createdAt ?? session.updatedAt) + COMPUTER_USE_MAX_TTL_MS;
}

function idleTime(session: StoredComputerSession): number {
  return session.lastUsedAt ?? session.createdAt ?? session.updatedAt;
}

export async function cleanupExpiredComputerUseSandboxes(
  now = Date.now(),
): Promise<SandboxCleanupResult> {
  const credentials = resolveSandboxCredentials();
  if (credentials.mode === "none") {
    throw new Error("Vercel Sandbox credentials are not configured.");
  }

  const auth = sandboxCredentialParams(credentials);
  const [sandboxes, sessions] = await Promise.all([
    Sandbox.list({ namePrefix: COMPUTER_USE_SANDBOX_PREFIX, ...auth }),
    listStoredComputerSessionsForCleanup(),
  ]);
  const recordsByName = new Map<string, StoredComputerSession>();
  const foundNames = new Set<string>();
  for (const session of sessions) {
    if (session.sandboxName) recordsByName.set(session.sandboxName, session);
  }

  const result: SandboxCleanupResult = {
    examined: 0,
    stopped: 0,
    deleted: 0,
    reconciled: 0,
    skipped: 0,
    failed: 0,
  };

  for await (const sandboxInfo of sandboxes) {
    result.examined += 1;
    if (!sandboxInfo.name.startsWith(COMPUTER_USE_SANDBOX_PREFIX)) {
      result.skipped += 1;
      continue;
    }

    const session = recordsByName.get(sandboxInfo.name);
    if (session) foundNames.add(sandboxInfo.name);
    const terminal = TERMINAL_SANDBOX_STATES.has(sandboxInfo.status);
    const createdAt = sandboxInfo.createdAt;
    const expiresAt = sandboxInfo.expiresAt ?? createdAt + COMPUTER_USE_MAX_TTL_MS;
    const sessionExpired = session
      ? expiryTime(session) <= now
      : expiresAt <= now;
    const sessionIdle = session
      ? now - idleTime(session) >= COMPUTER_USE_IDLE_MS
      : false;

    try {
      if (sessionExpired || (!session && terminal)) {
        const sandbox = await Sandbox.get({ name: sandboxInfo.name, ...auth });
        if (!terminal) await sandbox.stop();
        await sandbox.delete({ deleteOrphanSnapshots: true });
        if (session) {
          await publishLiveComputerSession(session.sessionKey, session.sessionId, null);
        }
        result.deleted += 1;
        continue;
      }

      if (session && (terminal || sessionIdle)) {
        if (!terminal && sandboxInfo.status !== "stopping") {
          const sandbox = await Sandbox.get({ name: sandboxInfo.name, ...auth });
          await sandbox.stop();
          result.stopped += 1;
        }
        const status = FAILED_SANDBOX_STATES.has(sandboxInfo.status)
          ? "failed"
          : "stopped";
        await publishLiveComputerSession(
          session.sessionKey,
          session.sessionId,
          session,
          status,
        );
        result.reconciled += 1;
        continue;
      }

      if (!session && expiresAt <= now) {
        const sandbox = await Sandbox.get({ name: sandboxInfo.name, ...auth });
        if (!terminal) await sandbox.stop();
        await sandbox.delete({ deleteOrphanSnapshots: true });
        result.deleted += 1;
        continue;
      }

      result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      console.error("Could not reconcile computer-use sandbox", {
        name: sandboxInfo.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const session of sessions) {
    if (!session.sandboxName || foundNames.has(session.sandboxName)) continue;
    try {
      if (expiryTime(session) <= now) {
        await publishLiveComputerSession(session.sessionKey, session.sessionId, null);
        result.reconciled += 1;
      } else if (
        now - idleTime(session) >= COMPUTER_USE_IDLE_MS &&
        session.status !== "stopped"
      ) {
        await publishLiveComputerSession(
          session.sessionKey,
          session.sessionId,
          session,
          "stopped",
        );
        result.reconciled += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error("Could not reconcile missing computer-use sandbox record", {
        name: session.sandboxName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
