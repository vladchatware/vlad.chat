import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values"
import { authTables } from "@convex-dev/auth/server";
import { vProviderMetadata } from "@convex-dev/agent";
import { usageValidator } from "./validators";

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
    // Subscription billing (lib/billing.ts holds plan constants).
    subscriptionStatus: v.optional(
      v.union(
        v.literal("active"),
        v.literal("past_due"),
        v.literal("canceled"),
      ),
    ),
    stripeSubscriptionId: v.optional(v.string()),
    includedCredits: v.optional(v.number()),
    grantPeriodStart: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index('stripeId', ['stripeId'])
    .index("bySubscriptionStatus", ["subscriptionStatus"]),
  usage: defineTable({
    userId: v.string(),
    model: v.string(),
    provider: v.string(),
    source: v.optional(v.union(v.literal("chat"), v.literal("api"))),
    apiKeyId: v.optional(v.id("apiKeys")),
    usage: usageValidator,
    providerMetadata: v.optional(vProviderMetadata),
    usageTime: v.number(),
    credits: v.optional(v.number()),
    overageQueued: v.optional(v.boolean()),
  }).index("byUserTime", ["userId", "usageTime"]),
  // Queued overage drained to Stripe meter events by a cron; stripeEventId
  // (the API's own event id) provides at-least-once-safe idempotency.
  meterOverage: defineTable({
    userId: v.id("users"),
    stripeId: v.string(),
    credits: v.number(),
    identifier: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("sent")),
    sentAt: v.optional(v.number()),
    stripeEventId: v.optional(v.string()),
    failedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("byStatus", ["status"])
    .index("byUser", ["userId"]),
  apiKeys: defineTable({
    userId: v.id("users"),
    name: v.string(),
    prefix: v.string(),
    digest: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("byUserId", ["userId"])
    .index("byDigest", ["digest"]),
  stripeEvents: defineTable({
    eventId: v.string(),
    processedAt: v.number(),
  }).index("byEventId", ["eventId"]),
  notionConnections: defineTable({
    userId: v.id("users"),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.optional(v.number()),
    tokenEndpoint: v.string(),
    clientId: v.string(),
    workspaceName: v.optional(v.string()),
    workspaceIcon: v.optional(v.string()),
    workspaceId: v.string(),
    botId: v.string(),
    scope: v.optional(v.string()),
  })
    .index("userId", ["userId"]),
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
