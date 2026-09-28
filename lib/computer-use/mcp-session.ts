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
export type ComputerMcpContext = {
  sessionKey: string;
  threadId?: string;
};

export const computerSessionAls = new AsyncLocalStorage<ComputerMcpContext>();

const MAX_SESSION_LEN = 80;

export function sanitizeComputerSessionKey(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, MAX_SESSION_LEN);
  return cleaned || "mcp-default";
}

export function resolveMcpComputerSessionKey(toolSessionId?: string): string {
  if (toolSessionId && toolSessionId.trim()) {
    return sanitizeComputerSessionKey(toolSessionId.trim());
  }
  const fromHeader = computerSessionAls.getStore()?.sessionKey;
  if (fromHeader) return fromHeader;
  return "mcp-default";
}

export function resolveMcpComputerThreadId(): string | undefined {
  return computerSessionAls.getStore()?.threadId;
}

export function computerSessionFromRequest(req: Request): string | undefined {
  const raw =
    req.headers.get("x-computer-session") ||
    req.headers.get("x-computer-session-id");
  if (!raw?.trim()) return undefined;
  return sanitizeComputerSessionKey(raw.trim());
}

export function computerThreadFromRequest(req: Request): string | undefined {
  const threadId = req.headers.get("x-computer-thread")?.trim();
  return threadId && threadId.length <= 128 ? threadId : undefined;
}
