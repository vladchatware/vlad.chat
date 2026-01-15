import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values"
import { authTables } from "@convex-dev/auth/server";
import { vProviderMetadata } from "@convex-dev/agent";

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    stripeId: v.optional(v.string()),
    trialMessages: v.optional((v.number())),
    trialTokens: v.optional(v.number()),
    tokens: v.optional(v.number()),
    apiKey: v.optional(v.string())
  })
    .index("email", ["email"])
    .index('stripeId', ['stripeId'])
    .index('apiKey', ['apiKey']),
  usage: defineTable({
    userId: v.string(),
    model: v.string(),
    provider: v.string(),
    usage: v.object({
      totalTokens: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      reasoningTokens: v.optional(v.number()),
      cachedInputTokens: v.optional(v.number()),
    }),
    providerMetadata: v.optional(vProviderMetadata),
  }),
  // Daily ephemeral group chat - cleared every day
  loungeMessages: defineTable({
    userId: v.optional(v.id("users")), // Optional for bot messages
    userName: v.string(),
    userImage: v.optional(v.string()),
    content: v.string(),
    date: v.string(), // YYYY-MM-DD format for daily grouping
    isBot: v.optional(v.boolean()), // True for Vlad's responses
  })
    .index("byDate", ["date"])
});
