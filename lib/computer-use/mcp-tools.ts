import { z } from "zod";
import {
  computerActionSchema,
  computerUseToolsAvailable,
  runComputerToolOp,
} from "./tools";
import {
  resolveMcpComputerSessionKey,
  resolveMcpComputerThreadId,
} from "./mcp-session";
import type { ComputerAction } from "./types";
import { computerToolMcpResult } from "./vision";

/** Only the Zod 3 registration overload used here, with typed input and output. */
type McpToolServer = {
  tool<Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    parameters: Shape,
    execute: (args: z.infer<z.ZodObject<Shape>>) => Promise<Awaited<ReturnType<typeof computerToolMcpResult>>>,
  ): void;
};

const sessionIdField = z
  .string()
  .optional()
  .describe(
    "Optional sandbox session id for isolation (prefer stable user/thread id). Falls back to x-computer-session header, then mcp-default.",
  );

/**
 * Register computer_* tools on the site MCP server when flag + sandbox creds
 * are available. Convex `getMcpTools` loads `${SITE_URL}/api/mcp`, so
 * generateReply picks these up with no threads.ts tool wiring. The Lounge
 * filters computer_* tools from its MCP toolset.
 */
export function registerComputerUseMcpTools(server: McpToolServer): void {
  if (!computerUseToolsAvailable()) return;

  server.tool(
    "computer_open",
    "Open a public URL in the isolated computer-use browser (Vercel Sandbox + Playwright). Returns viewerUrl for noVNC control and nativeViewerUrl for the in-app live viewer; screenshot is deferred to computer_screenshot. Reopens an expired session in a fresh sandbox. Sessions capped at 30 min / 20 steps.",
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
    "Capture a light JPEG clip of the computer-use viewport (separate from open). Returns screenshotUrl, viewerUrl, and nativeViewerUrl.",
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
    "One browser action (click/type/key/scroll/wait/drag) then a fresh screenshotUrl. Refuses payment/signing text — use computer_handoff. Counts toward the 20-step cap.",
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
