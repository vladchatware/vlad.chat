import { tool } from "ai";
import { z } from "zod";
import {
  computerUseEnabled,
  endComputerSession,
  resolveSandboxCredentials,
  runComputerOp,
} from "./sandbox";
import { putScreenshot, screenshotPublicUrl } from "./artifacts";
import { handoffMessage, looksLikePaymentOrSigning } from "./safety";
import type { ComputerHandoffReason, ComputerToolResult } from "./types";

export type ComputerToolContext = {
  userId?: string;
  chatId?: string;
};

function sessionKeyFrom(ctx: ComputerToolContext) {
  return ctx.userId || ctx.chatId || "anonymous";
}

function attachShot(
  sessionKey: string,
  png: Buffer | null,
  base: ComputerToolResult,
): ComputerToolResult {
  if (!png || png.length === 0) return base;
  const artifact = putScreenshot(sessionKey, png);
  return {
    ...base,
    screenshotId: artifact.id,
    screenshotUrl: screenshotPublicUrl(artifact.id),
    mimeType: "image/png",
    width: 1280,
    height: 720,
  };
}

const actionSchema = z.discriminatedUnion("type", [
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
 * Shared backend tools for the agent loop (web + iOS consume identical results).
 */
export function createComputerUseTools(ctx: ComputerToolContext = {}) {
  const sessionKey = sessionKeyFrom(ctx);

  return {
    computer_open: tool({
      description:
        "Open a public URL in the isolated computer-use browser (Vercel Sandbox + Playwright). Returns screenshotUrl for clients.",
      inputSchema: z.object({
        url: z.string().url().describe("https URL to open"),
      }),
      execute: async ({ url }): Promise<ComputerToolResult> => {
        try {
          const { meta, png, sandboxName } = await runComputerOp(sessionKey, {
            op: "open",
            url,
          });
          return attachShot(sessionKey, png, {
            ok: true,
            op: "open",
            url: String(meta.url || url),
            title: meta.title ? String(meta.title) : undefined,
            action: "open",
            sandboxName,
          });
        } catch (error) {
          return {
            ok: false,
            op: "open",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),

    computer_screenshot: tool({
      description:
        "Capture the current computer-use browser viewport. Returns screenshotUrl for web and iOS.",
      inputSchema: z.object({}),
      execute: async (): Promise<ComputerToolResult> => {
        try {
          const { meta, png, sandboxName } = await runComputerOp(sessionKey, {
            op: "screenshot",
          });
          return attachShot(sessionKey, png, {
            ok: true,
            op: "screenshot",
            url: meta.url ? String(meta.url) : undefined,
            title: meta.title ? String(meta.title) : undefined,
            action: "screenshot",
            sandboxName,
          });
        } catch (error) {
          return {
            ok: false,
            op: "screenshot",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),

    computer_act: tool({
      description:
        "One browser action (click/type/key/scroll/wait/drag) then a fresh screenshotUrl. Refuses payment/signing text — use computer_handoff.",
      inputSchema: z.object({ action: actionSchema }),
      execute: async ({ action }): Promise<ComputerToolResult> => {
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
          const { meta, png, sandboxName } = await runComputerOp(sessionKey, {
            op: "act",
            action,
          });
          return attachShot(sessionKey, png, {
            ok: true,
            op: "act",
            url: meta.url ? String(meta.url) : undefined,
            title: meta.title ? String(meta.title) : undefined,
            action: action.type,
            sandboxName,
          });
        } catch (error) {
          return {
            ok: false,
            op: "act",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),

    computer_handoff: tool({
      description:
        "User must take over (SSO, 2FA, captcha, payment, signing). Emits structured handoff for web + iOS. Never pays or signs silently.",
      inputSchema: z.object({
        reason: z.enum(["sso", "2fa", "captcha", "payment", "signing", "unknown"]),
        message: z.string().optional(),
      }),
      execute: async ({ reason, message }): Promise<ComputerToolResult> => {
        const r = reason as ComputerHandoffReason;
        let shot: ComputerToolResult = {
          ok: true,
          op: "handoff",
          handoff: {
            type: "computer_handoff",
            reason: r,
            message: message || handoffMessage(r),
            requiresUser: true,
          },
        };
        try {
          const { meta, png, sandboxName } = await runComputerOp(sessionKey, {
            op: "screenshot",
          });
          shot = attachShot(sessionKey, png, {
            ...shot,
            url: meta.url ? String(meta.url) : undefined,
            title: meta.title ? String(meta.title) : undefined,
            sandboxName,
          });
        } catch {
          /* handoff still valid without shot */
        }
        return shot;
      },
    }),

    computer_end: tool({
      description:
        "Tear down the computer-use sandbox for this chat session when the browser task is finished.",
      inputSchema: z.object({}),
      execute: async (): Promise<ComputerToolResult> => {
        try {
          await endComputerSession(sessionKey);
          return { ok: true, op: "end", action: "end" };
        } catch (error) {
          return {
            ok: false,
            op: "end",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),
  };
}

export function computerUseToolsAvailable(): boolean {
  if (!computerUseEnabled()) return false;
  return resolveSandboxCredentials().mode !== "none";
}
