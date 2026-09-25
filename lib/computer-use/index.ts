/**
 * Computer use — shared backend agent tools (web + iOS).
 *
 * Product path (lounge / Convex generateReply):
 *   getMcpTools → GET/POST ${NEXT_PUBLIC_SITE_URL}/api/mcp
 *     → computer_* (when COMPUTER_USE_ENABLED + sandbox creds)
 *       → Vercel Sandbox + Playwright
 *         → screenshotUrl via /api/computer-use/screenshots/:id
 *
 * Legacy / styleguide: POST /api/chat also merges createComputerUseTools.
 * Clients only render tool results; they do not own sandbox lifecycle.
 */
export {
  createComputerUseTools,
  computerUseToolsAvailable,
  runComputerToolOp,
  computerActionSchema,
  type ComputerToolContext,
  type ComputerOpName,
  type ComputerOpArgs,
} from "./tools";
export { registerComputerUseMcpTools } from "./mcp-tools";
export {
  computerSessionAls,
  computerSessionFromRequest,
  resolveMcpComputerSessionKey,
} from "./mcp-session";
export {
  computerUseEnabled,
  resolveSandboxCredentials,
  COMPUTER_USE_MAX_TTL_MS,
  COMPUTER_USE_MAX_STEPS,
  COMPUTER_USE_MAX_CONCURRENT,
  COMPUTER_USE_IDLE_MS,
} from "./sandbox";
export type {
  ComputerToolResult,
  ComputerHandoffEvent,
  ComputerAction,
} from "./types";
export { getScreenshot } from "./artifacts";
export {
  parseComputerToolResult,
  isComputerToolName,
} from "./parse-tool-result";
