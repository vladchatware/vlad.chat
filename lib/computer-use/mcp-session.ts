import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped computer session for site MCP (`/api/mcp`).
 *
 * Resolution order for sandbox sessionKey:
 * 1. Optional `sessionId` tool argument (multi-agent isolation)
 * 2. `x-computer-session` / `x-computer-session-id` request header
 *    (Convex getMcpTools passes userId here)
 * 3. Fallback `"mcp-default"` (shared — prefer passing sessionId/header)
 */
export const computerSessionAls = new AsyncLocalStorage<string>();

const MAX_SESSION_LEN = 80;

export function sanitizeComputerSessionKey(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, MAX_SESSION_LEN);
  return cleaned || "mcp-default";
}

export function resolveMcpComputerSessionKey(toolSessionId?: string): string {
  if (toolSessionId && toolSessionId.trim()) {
    return sanitizeComputerSessionKey(toolSessionId.trim());
  }
  const fromHeader = computerSessionAls.getStore();
  if (fromHeader) return fromHeader;
  return "mcp-default";
}

export function computerSessionFromRequest(req: Request): string | undefined {
  const raw =
    req.headers.get("x-computer-session") ||
    req.headers.get("x-computer-session-id");
  if (!raw?.trim()) return undefined;
  return sanitizeComputerSessionKey(raw.trim());
}
