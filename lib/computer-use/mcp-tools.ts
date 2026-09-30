import { z } from "zod";
import {
  computerActionSchema,
  computerUseToolsAvailable,
  runComputerToolOp,
} from "./tools";
import {
  resolveMcpComputerSessionKey,
  resolveMcpComputerThreadId,
  resolveCodeModeGrant,
  resolveCodeModeGrantToken,
} from "./mcp-session";
import type { ComputerAction } from "./types";
import { computerToolMcpResult } from "./vision";
import { runSandboxCode } from "./sandbox";
import { putScreenshot, screenshotPublicUrl } from "./artifacts";

/** Only the Zod 3 registration overload used here, with typed input and output. */
type McpToolServer = {
  tool<Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    parameters: Shape,
    execute: (
      args: z.infer<z.ZodObject<Shape>>,
      extra?: { signal?: AbortSignal },
    ) => Promise<Awaited<ReturnType<typeof computerToolMcpResult>>>,
  ): void;
};

const sessionIdField = z
  .string()
  .optional()
  .describe(
    "Optional sandbox session id for standalone MCP isolation. Authenticated x-computer-session requests always use their user session.",
  );

/**
 * Register computer_* tools on the site MCP server when flag + sandbox creds
 * are available. Convex `getMcpTools` loads `${SITE_URL}/api/mcp`, so
 * generateReply picks these up with no threads.ts tool wiring. The Lounge
 * filters computer_* tools from its MCP toolset.
 */
export function registerComputerUseMcpTools(server: McpToolServer): void {
  if (!computerUseToolsAvailable()) return;

  const codeModeGrant = resolveCodeModeGrant();
  if (codeModeGrant) server.tool(
    "run_code",
    "Execute one asynchronous TypeScript program inside the current live computer sandbox. Fresh program state per call; sandbox files and browser persist. Use tools.run_command, tools.read_file, tools.write_file, tools.computer.screenshot, or tools.computer.act. Program timeout defaults to 60 seconds and caps at 120 seconds. Return only concise values needed for the next decision.",
    {
      code: z.string().min(1).max(64 * 1024).describe(
        "Body of an async TypeScript function. Type annotations are stripped at runtime; use only erasable TypeScript syntax.",
      ),
      description: z.string().min(1).max(500).optional()
        .describe("Optional short purpose of this program."),
      timeoutMs: z.number().int().min(1000).max(120_000).optional()
        .describe("Run deadline in milliseconds; default 60000, maximum 120000."),
    },
    async ({ code, description, timeoutMs }, extra) => {
      const runDescription = description ?? "TypeScript sandbox run";
      const result = await runSandboxCode(codeModeGrant.sessionKey, codeModeGrant.threadId, {
        code,
        description: runDescription,
        timeoutMs: timeoutMs ?? 60_000,
        signal: extra?.signal,
      }, resolveCodeModeGrantToken());
      const value = result.valueJson === undefined
        ? "No value returned."
        : `Return value: ${result.valueJson}`;
      const output = [
        `Program: ${runDescription}`,
        `Run ID: ${result.runId}`,
        `Status: ${result.status}`,
        `Exit code: ${String(result.exitCode)}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
        value,
        result.outputTruncated ? "Output truncated at 64 KiB." : "",
        result.valueTruncated ? "Return value exceeds 16 KiB." : "",
        result.timedOut ? "Execution exceeded its time limit." : "",
      ].filter(Boolean).join("\n\n");
      if (!result.screenshot) {
        return { content: [{ type: "text" as const, text: output }] };
      }
      const artifact = await putScreenshot(codeModeGrant.sessionKey, result.screenshot);
      const withImage = await computerToolMcpResult({
        ok: result.exitCode === 0,
        op: "act",
        action: "run_code",
        screenshotId: artifact.id,
        screenshotUrl: screenshotPublicUrl(artifact.id),
        mimeType: artifact.contentType,
      });
      return {
        ...withImage,
        content: [
          { type: "text" as const, text: output },
          ...withImage.content.filter((item) => item.type === "image"),
        ],
      };
    },
  );

  server.tool(
    "computer_open",
    "Open a public URL in the isolated computer-use browser (Vercel Sandbox + Playwright). Viewer and screenshot URLs are internal; the app displays the live session to the user. Screenshot is deferred to computer_screenshot. Reopens an expired session in a fresh sandbox. Sessions capped at 30 min / 20 steps.",
    {
      url: z.string().url().describe("https URL to open"),
      sessionId: sessionIdField,
    },
    async ({ url, sessionId }) => {
      const sessionKey = resolveMcpComputerSessionKey(sessionId);
      return computerToolMcpResult(
        await runComputerToolOp(sessionKey, "open", { url }, resolveMcpComputerThreadId()),
      );
    },
  );

  server.tool(
    "computer_screenshot",
    "Capture a light JPEG clip of the computer-use viewport (separate from open). Screenshot and viewer URLs are internal; do not include them in assistant messages.",
    {
      sessionId: sessionIdField,
    },
    async ({ sessionId }) => {
      const sessionKey = resolveMcpComputerSessionKey(sessionId);
      return computerToolMcpResult(
        await runComputerToolOp(sessionKey, "screenshot", {}, resolveMcpComputerThreadId()),
      );
    },
  );

  server.tool(
    "computer_act",
    "One browser action (click/type/key/scroll/wait/drag) then a fresh screenshot for agent verification. Result URLs are internal; do not include them in assistant messages. Refuses payment/signing text — use computer_handoff. Counts toward the 20-step cap.",
    {
      action: computerActionSchema,
      sessionId: sessionIdField,
    },
    async ({ action, sessionId }) => {
      const sessionKey = resolveMcpComputerSessionKey(sessionId);
      return computerToolMcpResult(
        await runComputerToolOp(sessionKey, "act", {
          action: action as ComputerAction,
        }, resolveMcpComputerThreadId()),
      );
    },
  );

  server.tool(
    "computer_handoff",
    "User must take over (SSO, 2FA, captcha, payment, signing). Emits structured handoff. Never pays or signs silently.",
    {
      reason: z.enum(["sso", "2fa", "captcha", "payment", "signing", "unknown"]),
      message: z.string().optional(),
      sessionId: sessionIdField,
    },
    async ({ reason, message, sessionId }) => {
      const sessionKey = resolveMcpComputerSessionKey(sessionId);
      return computerToolMcpResult(
        await runComputerToolOp(
          sessionKey,
          "handoff",
          { reason, message },
          resolveMcpComputerThreadId(),
        ),
      );
    },
  );

  server.tool(
    "computer_end",
    "Tear down the computer-use sandbox only when the user explicitly asks to close the live desk or the viewer has failed. Keep the live viewer open after the browser task is complete.",
    {
      sessionId: sessionIdField,
    },
    async ({ sessionId }) => {
      const sessionKey = resolveMcpComputerSessionKey(sessionId);
      return computerToolMcpResult(
        await runComputerToolOp(sessionKey, "end", {}, resolveMcpComputerThreadId()),
      );
    },
  );
}
