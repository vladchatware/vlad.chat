import { tool } from "ai";
import { z } from "zod";
import {
  COMPUTER_USE_MAX_STEPS,
  COMPUTER_USE_MAX_TTL_MS,
  ComputerUseCapError,
  computerUseEnabled,
  endComputerSession,
  resolveSandboxCredentials,
  runComputerOp,
} from "./sandbox";
import { putScreenshot, screenshotPublicUrl } from "./artifacts";
import { handoffMessage, looksLikePaymentOrSigning } from "./safety";
import type {
  ComputerAction,
  ComputerBudgetStatus,
  ComputerHandoffReason,
  ComputerToolResult,
} from "./types";

export type ComputerToolContext = {
  userId?: string;
  chatId?: string;
};

export type ComputerOpName = ComputerToolResult["op"];

export type ComputerOpArgs = {
  url?: string;
  action?: ComputerAction;
  reason?: ComputerHandoffReason;
  message?: string;
};

function sessionKeyFrom(ctx: ComputerToolContext) {
  return ctx.userId || ctx.chatId || "anonymous";
}

function mapBudget(b: {
  stepsUsed: number;
  stepsRemaining: number;
  maxSteps: number;
  ttlMs: number;
  elapsedMs: number;
  note: string;
}): ComputerBudgetStatus {
  return {
    stepsUsed: b.stepsUsed,
    stepsRemaining: b.stepsRemaining,
    maxSteps: b.maxSteps,
    ttlMs: b.ttlMs,
    elapsedMs: b.elapsedMs,
    note: b.note,
  };
}

function failCap(op: ComputerToolResult["op"], err: unknown): ComputerToolResult {
  if (err instanceof ComputerUseCapError) {
    return {
      ok: false,
      op,
      code: err.code,
      error: err.message,
      budget: {
        stepsUsed: 0,
        stepsRemaining: 0,
        maxSteps: COMPUTER_USE_MAX_STEPS,
        ttlMs: COMPUTER_USE_MAX_TTL_MS,
        elapsedMs: 0,
        note: "Computer-use session hit an operational limit (TTL, steps, or idle reclaim).",
      },
    };
  }
  return {
    ok: false,
    op,
    code: "runtime",
    error: err instanceof Error ? err.message : String(err),
  };
}

function attachShot(
  sessionKey: string,
  png: Buffer | null,
  base: ComputerToolResult,
  budget?: ComputerBudgetStatus,
): ComputerToolResult {
  const withBudget = budget ? { ...base, budget } : base;
  if (!png || png.length === 0) return withBudget;
  const artifact = putScreenshot(sessionKey, png);
  return {
    ...withBudget,
    screenshotId: artifact.id,
    screenshotUrl: screenshotPublicUrl(artifact.id),
    mimeType: "image/png",
    width: 1280,
    height: 720,
  };
}

export const computerActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    x: z.number(),
    y: z.number(),
    button: z.enum(["left", "right", "middle"]).optional(),
  }),
  z.object({ type: z.literal("type"), text: z.string() }),
  z.object({ type: z.literal("key"), key: z.string() }),
  z.object({
    type: z.literal("scroll"),
    x: z.number(),
    y: z.number(),
    deltaX: z.number().optional(),
    deltaY: z.number().optional(),
  }),
  z.object({ type: z.literal("wait"), ms: z.number().optional() }),
  z.object({
    type: z.literal("drag"),
    fromX: z.number(),
    fromY: z.number(),
    toX: z.number(),
    toY: z.number(),
  }),
]);

/**
 * Shared execute path for AI SDK tools and MCP registration.
 * Clients stay dumb — only render the returned JSON (screenshotUrl / handoff).
 */
export async function runComputerToolOp(
  sessionKey: string,
  op: ComputerOpName,
  args: ComputerOpArgs = {},
): Promise<ComputerToolResult> {
  switch (op) {
    case "open": {
      const url = args.url;
      if (!url) {
        return { ok: false, op: "open", code: "runtime", error: "url is required" };
      }
      try {
        const { meta, png, sandboxName, budget } = await runComputerOp(
          sessionKey,
          { op: "open", url },
        );
        return attachShot(
          sessionKey,
          png,
          {
            ok: true,
            op: "open",
            url: String(meta.url || url),
            title: meta.title ? String(meta.title) : undefined,
            action: "open",
            sandboxName,
          },
          mapBudget(budget),
        );
      } catch (error) {
        return failCap("open", error);
      }
    }
    case "screenshot": {
      try {
        const { meta, png, sandboxName, budget } = await runComputerOp(
          sessionKey,
          { op: "screenshot" },
        );
        return attachShot(
          sessionKey,
          png,
          {
            ok: true,
            op: "screenshot",
            url: meta.url ? String(meta.url) : undefined,
            title: meta.title ? String(meta.title) : undefined,
            action: "screenshot",
            sandboxName,
          },
          mapBudget(budget),
        );
      } catch (error) {
        return failCap("screenshot", error);
      }
    }
    case "act": {
      const action = args.action;
      if (!action) {
        return {
          ok: false,
          op: "act",
          code: "runtime",
          error: "action is required",
        };
      }
      if (action.type === "type" && looksLikePaymentOrSigning(action.text)) {
        return {
          ok: false,
          op: "act",
          error: handoffMessage("payment"),
          handoff: {
            type: "computer_handoff",
            reason: "payment",
            message: handoffMessage("payment"),
            requiresUser: true,
          },
        };
      }
      try {
        const { meta, png, sandboxName, budget } = await runComputerOp(
          sessionKey,
          { op: "act", action },
        );
        return attachShot(
          sessionKey,
          png,
          {
            ok: true,
            op: "act",
            url: meta.url ? String(meta.url) : undefined,
            title: meta.title ? String(meta.title) : undefined,
            action: action.type,
            sandboxName,
          },
          mapBudget(budget),
        );
      } catch (error) {
        return failCap("act", error);
      }
    }
    case "handoff": {
      const reason = (args.reason || "unknown") as ComputerHandoffReason;
      let shot: ComputerToolResult = {
        ok: true,
        op: "handoff",
        handoff: {
          type: "computer_handoff",
          reason,
          message: args.message || handoffMessage(reason),
          requiresUser: true,
        },
      };
      try {
        const { meta, png, sandboxName, budget } = await runComputerOp(
          sessionKey,
          { op: "screenshot" },
        );
        shot = attachShot(
          sessionKey,
          png,
          {
            ...shot,
            url: meta.url ? String(meta.url) : undefined,
            title: meta.title ? String(meta.title) : undefined,
            sandboxName,
          },
          mapBudget(budget),
        );
      } catch {
        /* handoff still valid without shot */
      }
      return shot;
    }
    case "end": {
      try {
        await endComputerSession(sessionKey);
        return { ok: true, op: "end", action: "end" };
      } catch (error) {
        return failCap("end", error);
      }
    }
    default: {
      const _exhaustive: never = op;
      return {
        ok: false,
        op: "screenshot",
        code: "runtime",
        error: `Unknown op: ${String(_exhaustive)}`,
      };
    }
  }
}

/**
 * Shared backend tools for the agent loop (web + iOS consume identical results).
 * Default OFF — COMPUTER_USE_ENABLED must be set explicitly.
 * Product lounge path mounts these via site MCP (`/api/mcp`); `/api/chat` is legacy/styleguide.
 */
export function createComputerUseTools(ctx: ComputerToolContext = {}) {
  const sessionKey = sessionKeyFrom(ctx);

  return {
    computer_open: tool({
      description:
        "Open a public URL in the isolated computer-use browser (Vercel Sandbox + Playwright). Returns screenshotUrl. Sessions capped at 8 min / 20 steps.",
      inputSchema: z.object({
        url: z.string().url().describe("https URL to open"),
      }),
      execute: async ({ url }): Promise<ComputerToolResult> =>
        runComputerToolOp(sessionKey, "open", { url }),
    }),

    computer_screenshot: tool({
      description:
        "Capture the current computer-use browser viewport. Returns screenshotUrl for web and iOS.",
      inputSchema: z.object({}),
      execute: async (): Promise<ComputerToolResult> =>
        runComputerToolOp(sessionKey, "screenshot"),
    }),

    computer_act: tool({
      description:
        "One browser action (click/type/key/scroll/wait/drag) then a fresh screenshotUrl. Refuses payment/signing text — use computer_handoff. Counts toward the 20-step cap.",
      inputSchema: z.object({ action: computerActionSchema }),
      execute: async ({ action }): Promise<ComputerToolResult> =>
        runComputerToolOp(sessionKey, "act", {
          action: action as ComputerAction,
        }),
    }),

    computer_handoff: tool({
      description:
        "User must take over (SSO, 2FA, captcha, payment, signing). Emits structured handoff for web + iOS. Never pays or signs silently.",
      inputSchema: z.object({
        reason: z.enum([
          "sso",
          "2fa",
          "captcha",
          "payment",
          "signing",
          "unknown",
        ]),
        message: z.string().optional(),
      }),
      execute: async ({ reason, message }): Promise<ComputerToolResult> =>
        runComputerToolOp(sessionKey, "handoff", { reason, message }),
    }),

    computer_end: tool({
      description:
        "Tear down the computer-use sandbox for this chat session when the browser task is finished. Always call this to release the sandbox.",
      inputSchema: z.object({}),
      execute: async (): Promise<ComputerToolResult> =>
        runComputerToolOp(sessionKey, "end"),
    }),
  };
}

/** True when flag is on AND Vercel Sandbox auth can resolve. Default OFF. */
export function computerUseToolsAvailable(): boolean {
  if (!computerUseEnabled()) return false;
  return resolveSandboxCredentials().mode !== "none";
}
