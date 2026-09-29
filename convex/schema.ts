import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values"
import { authTables } from "@convex-dev/auth/server";
import { vMessage, vProviderMetadata } from "@convex-dev/agent";
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
    // One in-flight Checkout session per user; blocks concurrent subscription
    // checkouts until paid (webhook clears it), expired (expired webhook), or
    // 24h old. Convex OCC serializes the check-and-set on this document.
    pendingCheckoutSessionId: v.optional(v.string()),
    pendingCheckoutAt: v.optional(v.number()),
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
    // Optional: usage rows written before this schema have no timestamp;
    // window queries exclude them (undefined sorts below any cutoff).
    usageTime: v.optional(v.number()),
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
    queuedAt: v.optional(v.number()),
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
  storeTransactions: defineTable({
    transactionId: v.string(),
    originalTransactionId: v.string(),
    userId: v.id("users"),
    productId: v.string(),
    tokens: v.number(),
    purchasedAt: v.number(),
    environment: v.string(),
  })
    .index("transactionId", ["transactionId"])
    .index("userId", ["userId"]),
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
  computerUseScreenshots: defineTable({
    artifactId: v.string(),
    storageId: v.id("_storage"),
    sessionKey: v.string(),
    contentType: v.union(v.literal("image/jpeg"), v.literal("image/png")),
    size: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("byArtifactId", ["artifactId"])
    .index("byExpiresAt", ["expiresAt"]),
  computerUseSessions: defineTable({
    sessionKey: v.string(),
    sessionId: v.string(),
    provider: v.optional(v.literal("vercel")),
    status: v.optional(v.union(
      v.literal("starting"),
      v.literal("running"),
      v.literal("stopped"),
      v.literal("expired"),
      v.literal("failed"),
    )),
    sandboxName: v.optional(v.string()),
    viewerToken: v.optional(v.string()),
    threadId: v.optional(v.string()),
    viewerUrl: v.optional(v.string()),
    nativeViewerUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    stepCount: v.optional(v.number()),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("bySessionKey", ["sessionKey"])
    .index("byExpiresAt", ["expiresAt"]),
  agentRuns: defineTable({
    threadId: v.string(),
    userId: v.id("users"),
    promptMessageId: v.optional(v.string()),
    order: v.optional(v.number()),
    queuedPrompt: v.optional(vMessage),
    queuedFileIds: v.optional(v.array(v.string())),
    model: v.string(),
    searchEnabled: v.boolean(),
    workflowId: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("stopRequested"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    stepCount: v.number(),
    attemptCount: v.number(),
    inFlightStep: v.optional(v.number()),
    inFlightAttempt: v.optional(v.number()),
    inFlightPhase: v.optional(v.union(v.literal("model"), v.literal("tool"))),
    inFlightStreamId: v.optional(v.string()),
    inFlightStepOrder: v.optional(v.number()),
    inFlightSteeringIds: v.optional(v.array(v.id("agentRunSteering"))),
    continueAfterStop: v.optional(v.boolean()),
    anonymousMessageBilled: v.optional(v.boolean()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("byThread", ["threadId", "createdAt"])
    .index("byThreadAndStatus", ["threadId", "status", "createdAt"])
    .index("byUser", ["userId", "createdAt"]),
  agentRunSteering: defineTable({
    runId: v.id("agentRuns"),
    requestId: v.string(),
    text: v.string(),
    status: v.union(v.literal("pending"), v.literal("applied")),
    createdAt: v.number(),
    appliedAt: v.optional(v.number()),
  })
    .index("byRun", ["runId", "createdAt"])
    .index("byRunAndStatus", ["runId", "status", "createdAt"])
    .index("byRunAndRequest", ["runId", "requestId"]),
  agentRunSteps: defineTable({
    runId: v.id("agentRuns"),
    stepNumber: v.number(),
    model: v.string(),
    provider: v.string(),
    order: v.number(),
    stepOrder: v.number(),
    hasOutput: v.boolean(),
    hasToolCalls: v.boolean(),
    toolCallIds: v.array(v.string()),
    steeringIds: v.optional(v.array(v.id("agentRunSteering"))),
    usage: usageValidator,
    providerMetadata: v.optional(vProviderMetadata),
    createdAt: v.number(),
  }).index("byRunStep", ["runId", "stepNumber"]),
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
