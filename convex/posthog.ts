"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { PostHog } from "posthog-node";
import { usageValidator } from "./validators";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY!;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST!;

let client: PostHog | null = null;

function getClient() {
  if (!client) {
    client = new PostHog(posthogKey, {
      host: posthogHost,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

export const captureAiSpans = internalAction({
  args: {
    distinctId: v.string(),
    traceId: v.string(),
    sessionId: v.optional(v.string()),
    spans: v.array(
      v.object({
        spanId: v.string(),
        spanName: v.string(),
        input: v.optional(v.any()),
        output: v.optional(v.any()),
      }),
    ),
  },
  handler: async (_ctx, args) => {
    if (args.spans.length === 0) return { ok: true, count: 0 };
    const posthog = getClient();
    for (const span of args.spans) {
      posthog.capture({
        distinctId: args.distinctId,
        event: "$ai_span",
        properties: {
          $ai_trace_id: args.traceId,
          $ai_session_id: args.sessionId ?? null,
          $ai_span_id: span.spanId,
          $ai_span_name: span.spanName,
          $ai_parent_id: args.traceId,
          $ai_input_state: truncForState(span.input),
          $ai_output_state: truncForState(span.output),
        },
        timestamp: new Date(),
      });
    }
    await posthog.shutdown(2_000);
    client = null;
    return { ok: true, count: args.spans.length };
  },
});

const MAX_STATE_CHARS = 20_000;

function truncForState(value: unknown): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "null";
  } catch {
    return "[unserializable]";
  }
  if (json.length <= MAX_STATE_CHARS) return value;
  return `${json.slice(0, MAX_STATE_CHARS)}…[truncated]`;
}

export const captureLlmGeneration = internalAction({
  args: {
    distinctId: v.string(),
    traceId: v.string(),
    threadId: v.string(),
    order: v.number(),
    model: v.string(),
    provider: v.string(),
    input: v.optional(v.any()),
    output: v.optional(v.any()),
    usage: usageValidator,
    providerMetadata: v.optional(v.any()),
    sessionId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const posthog = getClient();

    posthog.capture({
      distinctId: args.distinctId,
      event: "$ai_generation",
      properties: {
        $ai_trace_id: args.traceId,
        $ai_session_id: args.sessionId ?? null,
        $ai_model: args.model,
        $ai_provider: args.provider,
        $ai_input: args.input,
        $ai_output_choices: args.output,
        $ai_input_tokens: args.usage.inputTokens,
        $ai_output_tokens: args.usage.outputTokens,
        $ai_total_tokens: args.usage.totalTokens,
        $ai_reasoning_tokens:
          args.usage.reasoningTokens ??
          args.usage.outputTokenDetails?.reasoningTokens,
        $ai_cached_input_tokens:
          args.usage.cachedInputTokens ??
          args.usage.inputTokenDetails?.cacheReadTokens,
        threadId: args.threadId,
        order: args.order,
        providerMetadata: args.providerMetadata,
      },
      timestamp: new Date(),
    });

    await posthog.shutdown(2_000);
    client = null;
    return { ok: true };
  },
});
