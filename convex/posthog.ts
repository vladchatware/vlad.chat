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
  },
  handler: async (_ctx, args) => {
    const posthog = getClient();

    posthog.capture({
      distinctId: args.distinctId,
      event: "$ai_generation",
      properties: {
        $ai_trace_id: args.traceId,
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
