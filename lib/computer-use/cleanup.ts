import { Sandbox } from "@vercel/sandbox";
import { resolveSandboxCredentials, sandboxCredentialParams } from "./credentials";
import { COMPUTER_USE_MAX_TTL_MS } from "./limits";

const COMPUTER_USE_SANDBOX_PREFIX = "vlad-cu-";
const TERMINAL_SANDBOX_STATES = new Set(["stopped", "failed", "aborted"]);

export type SandboxCleanupResult = {
  examined: number;
  deleted: number;
  skipped: number;
  failed: number;
};

export async function cleanupExpiredComputerUseSandboxes(
  now = Date.now(),
): Promise<SandboxCleanupResult> {
  const credentials = resolveSandboxCredentials();
  if (credentials.mode === "none") {
    throw new Error("Vercel Sandbox credentials are not configured.");
  }

  const auth = sandboxCredentialParams(credentials);
  const sandboxes = await Sandbox.list({
    namePrefix: COMPUTER_USE_SANDBOX_PREFIX,
    ...auth,
  });
  const result: SandboxCleanupResult = {
    examined: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
  };

  for await (const sandboxInfo of sandboxes) {
    result.examined += 1;
    if (!sandboxInfo.name.startsWith(COMPUTER_USE_SANDBOX_PREFIX)) {
      result.skipped += 1;
      continue;
    }

    const terminal = TERMINAL_SANDBOX_STATES.has(sandboxInfo.status);
    const expiresAt =
      sandboxInfo.expiresAt ?? sandboxInfo.createdAt + COMPUTER_USE_MAX_TTL_MS;
    if (!terminal && expiresAt > now) {
      result.skipped += 1;
      continue;
    }

    try {
      const sandbox = await Sandbox.get({ name: sandboxInfo.name, ...auth });
      if (!terminal) await sandbox.stop();
      await sandbox.delete({ deleteOrphanSnapshots: true });
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      console.error("Could not clean expired computer-use sandbox", {
        name: sandboxInfo.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
