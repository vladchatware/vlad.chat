/**
 * Build and verify the reusable Vercel Sandbox base image.
 * Run with Node 24 after `vercel env pull` has supplied VERCEL_OIDC_TOKEN:
 * node --env-file=/tmp/vladchat-oidc.env --experimental-strip-types scripts/create-computer-use-snapshot.mts
 * Optional COMPUTER_USE_SNAPSHOT_BASE_ID repacks a verified base.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMPUTER_USE_SNAPSHOT_VERSION,
  COMPUTER_USE_SNAPSHOT_MARKER,
  INSTALL_CUA_SH,
  INSTALL_DESK_SH,
  INSTALL_PLAYWRIGHT_SH,
} from "../lib/computer-use/playwright-scripts.ts";

const CLI_PACKAGE = "sandbox@4.5.0";
const SANDBOX_TIMEOUT = "30m";
const RESOURCES = ["--vcpus", "8"];

function readProjectConfig(): { orgId?: string; projectName?: string } {
  try {
    return JSON.parse(
      readFileSync(resolve(process.cwd(), ".vercel/project.json"), "utf8"),
    ) as { orgId?: string; projectName?: string };
  } catch {
    return {};
  }
}

const projectConfig = readProjectConfig();
const oidcToken = process.env.VERCEL_OIDC_TOKEN;
const accessToken = process.env.VERCEL_AUTH_TOKEN || process.env.VERCEL_TOKEN;
const project = process.env.VERCEL_PROJECT_NAME || projectConfig.projectName;
const scope = process.env.VERCEL_SCOPE || process.env.VERCEL_TEAM_ID || projectConfig.orgId;
if ((!oidcToken && !accessToken) || !project || !scope) {
  throw new Error(
    "Link this checkout to its Vercel project and provide VERCEL_OIDC_TOKEN (preferred) or a Vercel access token.",
  );
}

const cliBaseArgs = [
  "--yes",
  CLI_PACKAGE,
];
const cliEnvironment = { ...process.env };
if (oidcToken) {
  // Ensure the Sandbox CLI uses the short-lived OIDC credential if a local
  // shell also happens to contain an older long-lived token.
  delete cliEnvironment.VERCEL_AUTH_TOKEN;
  delete cliEnvironment.VERCEL_TOKEN;
} else if (accessToken) {
  cliEnvironment.VERCEL_AUTH_TOKEN = accessToken;
}

function sandboxCli(args: string[]): string {
  const result = spawnSync("npx", [...cliBaseArgs, ...args], {
    encoding: "utf8",
    env: cliEnvironment,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error || "").trim();
    throw new Error(detail || "Vercel Sandbox command failed.");
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function scoped(args: string[]): string[] {
  const delimiter = args.indexOf("--");
  const scopedOptions = ["--project", project, "--scope", scope];
  return delimiter < 0
    ? [...args, ...scopedOptions]
    : [...args.slice(0, delimiter), ...scopedOptions, ...args.slice(delimiter)];
}

function runSetup(
  sandboxName: string,
  script: string,
  timeout: string,
  sudo = false,
  workdir = "/tmp",
) {
  sandboxCli(
    scoped([
      "exec",
      ...(sudo ? ["--sudo"] : []),
      "--workdir",
      workdir,
      "--timeout",
      timeout,
      sandboxName,
      "--",
      "bash",
      "-lc",
      script,
    ]),
  );
}

async function main() {
  const existingSnapshotId = process.env.COMPUTER_USE_SNAPSHOT_TO_VERIFY;
  const baseSnapshotId = process.env.COMPUTER_USE_SNAPSHOT_BASE_ID;
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const sandboxName = `vlad-cu-base-${suffix}`;
  const restoredName = `vlad-cu-check-${suffix}`;
  const dependencyCheckCommand =
    "test -d /tmp/cu-npm/node_modules/playwright " +
    "&& ls /tmp/cu-browsers/chromium-*/chrome-linux*/chrome >/dev/null 2>&1 " +
    "&& command -v Xvfb >/dev/null 2>&1 " +
    "&& command -v x11vnc >/dev/null 2>&1 " +
    "&& command -v websockify >/dev/null 2>&1 " +
    "&& command -v curl >/dev/null 2>&1 " +
    "&& { test -f /usr/share/novnc/vnc.html || test -f /usr/share/novnc/vnc_lite.html; } " +
    "&& export PATH=\"$HOME/.local/bin:$PATH\" " +
    "&& command -v cua-driver >/dev/null 2>&1";
  const checkCommand =
    `test "$(cat "$HOME/${COMPUTER_USE_SNAPSHOT_MARKER}" 2>/dev/null)" = "${COMPUTER_USE_SNAPSHOT_VERSION}" ` +
    `&& ${dependencyCheckCommand}`;

  let snapshotId = existingSnapshotId;
  let sourceCreated = false;
  try {
    if (!snapshotId) {
      sandboxCli(
        scoped([
          "create",
          "--name",
          sandboxName,
          ...(baseSnapshotId ? ["--snapshot", baseSnapshotId] : []),
          "--timeout",
          SANDBOX_TIMEOUT,
          ...RESOURCES,
          "--snapshot-expiration",
          "30d",
          "--keep-last-snapshots",
          "1",
          "--non-persistent",
          "--silent",
        ]),
      );
      sourceCreated = true;
      if (baseSnapshotId) {
        runSetup(sandboxName, dependencyCheckCommand, "2m");
      } else {
        runSetup(sandboxName, INSTALL_PLAYWRIGHT_SH, "12m", true);
        runSetup(sandboxName, INSTALL_DESK_SH, "6m", true);
        runSetup(sandboxName, INSTALL_CUA_SH, "6m");
      }
      runSetup(
        sandboxName,
        `mkdir -p /vercel/sandbox "$HOME/.local/share/vladchat" && printf '%s' '${COMPUTER_USE_SNAPSHOT_VERSION}' > "$HOME/${COMPUTER_USE_SNAPSHOT_MARKER}"`,
        "30s",
      );

      const snapshotOutput = sandboxCli(
        scoped(["snapshot", "--stop", "--expiration", "30d", sandboxName]),
      );
      snapshotId = snapshotOutput.match(/\bsnap_[A-Za-z0-9_-]+\b/)?.[0];
      if (!snapshotId) {
        throw new Error("Snapshot command completed without returning a snapshot ID.");
      }
    }

    const confirmedSnapshotId = snapshotId;
    sandboxCli(
      scoped([
        "create",
        "--snapshot",
        confirmedSnapshotId,
        "--name",
        restoredName,
        "--timeout",
        SANDBOX_TIMEOUT,
        ...RESOURCES,
        "--non-persistent",
        "--silent",
      ]),
    );
    let restoreVerified = false;
    try {
      runSetup(restoredName, checkCommand, "2m", false, "/vercel/sandbox");
      restoreVerified = true;
    } finally {
      if (restoreVerified) sandboxCli(scoped(["rm", restoredName]));
    }

    process.stdout.write(`${confirmedSnapshotId}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      snapshotId
        ? `${detail} Snapshot ${snapshotId} failed restore verification; inspect sandbox ${restoredName}.`
        : `${detail} Prep sandbox retained for diagnostics: ${sourceCreated ? sandboxName : "none"}`,
    );
  } finally {
    if (sourceCreated && snapshotId) sandboxCli(scoped(["rm", sandboxName]));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
