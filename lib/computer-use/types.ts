/**
 * Client-agnostic computer-use protocol (web app + iOS share this JSON).
 * Orchestration lives only in the backend agent/tool loop — never in UI.
 * Screenshots are URLs/ids (mobile tool output is ~4k-capped).
 */

export type ComputerAction =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; x: number; y: number; deltaX?: number; deltaY?: number }
  | { type: "wait"; ms?: number }
  | { type: "drag"; fromX: number; fromY: number; toX: number; toY: number };

export type ComputerHandoffReason =
  | "sso"
  | "2fa"
  | "captcha"
  | "payment"
  | "signing"
  | "unknown";

export type ComputerHandoffEvent = {
  type: "computer_handoff";
  reason: ComputerHandoffReason;
  message: string;
  requiresUser: true;
};

export type ComputerErrorCode =
  | "budget_exceeded"
  | "ttl_exceeded"
  | "step_limit"
  | "disabled"
  | "auth_missing"
  | "runtime";

export type ComputerBudgetStatus = {
  stepsUsed: number;
  stepsRemaining: number;
  maxSteps: number;
  ttlMs: number;
  elapsedMs: number;
  note: string;
};

export type ComputerToolResult = {
  ok: boolean;
  op: "open" | "screenshot" | "act" | "handoff" | "end";
  url?: string;
  title?: string;
  action?: string;
  screenshotUrl?: string;
  screenshotId?: string;
  mimeType?: "image/png";
  width?: number;
  height?: number;
  handoff?: ComputerHandoffEvent;
  sandboxName?: string;
  error?: string;
  code?: ComputerErrorCode;
  budget?: ComputerBudgetStatus;
};

export type ComputerSession = {
  sessionKey: string;
  sandboxName: string;
  createdAt: number;
  lastUsedAt: number;
  stepCount: number;
};
