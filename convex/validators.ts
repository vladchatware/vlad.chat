import { v } from "convex/values";

export const usageValidator = v.object({
  totalTokens: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
  inputTokenDetails: v.optional(v.object({
    cacheReadTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    noCacheTokens: v.optional(v.number()),
  })),
  outputTokenDetails: v.optional(v.object({
    reasoningTokens: v.optional(v.number()),
    textTokens: v.optional(v.number()),
  })),
  raw: v.optional(v.any()),
});
