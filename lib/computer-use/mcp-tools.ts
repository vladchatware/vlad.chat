import { z } from "zod";
/** Minimal surface — avoid pulling full MCP Server generics into Next build. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP Server.tool generics are not usable at the route boundary
type McpToolServer = { tool: (...args: any[]) => unknown };
import {
  computerActionSchema,
  computerUseToolsAvailable,
  runComputerToolOp,
} from "./tools";
import { resolveMcpComputerSessionKey } from "./mcp-session";
import type { ComputerAction, ComputerToolResult } from "./types";

function mcpResult(result: ComputerToolResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
  };
}

const sessionIdField = z
  .string()
  .optional()
  .describe(
    "Optional sandbox session id for isolation (prefer stable user/thread id). Falls back to x-computer-session header, then mcp-default.",
  );

/**
 * Register computer_* tools on the site MCP server when flag + sandbox creds
 * are available. Convex `getMcpTools` already loads `${SITE_URL}/api/mcp`, so
 * lounge generateReply picks these up with no threads.ts tool wiring.
 */
export function registerComputerUseMcpTools(server: McpToolServer): void {
  if (!computerUseToolsAvailable()) return;

  server.tool(
    "computer_open",
    "Open a public URL in the isolated computer-use browser (Vercel Sandbox + Playwright). Returns viewerUrl (live noVNC); screenshot is deferred to computer_screenshot. Sessions capped at 8 min / 20 steps.",
    {
      url: z.string().url().describe("https URL to open"),
      sessionId: sessionIdField,
    },
    async ({ url, sessionId }) => {
      const sessionKey = resolveMcpComputerSessionKey(sessionId);
      return mcpResult(await runComputerToolOp(sessionKey, "open", { url }));
    },
  );

  server.tool(
    "computer_screenshot",
    "Capture a light JPEG clip of the computer-use viewport (separate from open). Returns screenshotUrl + viewerUrl.",
    {
      sessionId: sessionIdField,
    },
    async ({ sessionId }) => {
      const sessionKey = resolveMcpComputerSessionKey(sessionId);
      return mcpResult(await runComputerToolOp(sessionKey, "screenshot"));
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
      return mcpResult(
        await runComputerToolOp(sessionKey, "act", {
          action: action as ComputerAction,
        }),
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
      return mcpResult(
        await runComputerToolOp(sessionKey, "handoff", { reason, message }),
      );
    },
  );

  server.tool(
    "computer_end",
    "Tear down the computer-use sandbox for this session when the browser task is finished. Always call this to release the sandbox.",
    {
      sessionId: sessionIdField,
    },
    async ({ sessionId }) => {
      const sessionKey = resolveMcpComputerSessionKey(sessionId);
      return mcpResult(await runComputerToolOp(sessionKey, "end"));
    },
  );
}
