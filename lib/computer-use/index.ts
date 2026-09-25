/**
 * Computer use — shared backend agent tools (web + iOS).
 *
 *   Client (web | iOS)
 *     → /api/chat (same tool loop)
 *       → computer_* tools (feature-flagged)
 *         → Vercel Sandbox + Playwright
 *           → screenshotUrl via /api/computer-use/screenshots/:id
 *           → handoff as structured ComputerHandoffEvent in tool JSON
 *
 * Clients only render tool results; they do not own sandbox lifecycle.
 */
export {
  createComputerUseTools,
  computerUseToolsAvailable,
  type ComputerToolContext,
} from "./tools";
export { computerUseEnabled, resolveSandboxCredentials } from "./sandbox";
export type {
  ComputerToolResult,
  ComputerHandoffEvent,
  ComputerAction,
} from "./types";
export { getScreenshot } from "./artifacts";
