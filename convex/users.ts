import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, MutationCtx, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { vProviderMetadata } from "@convex-dev/agent";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { ProviderMetadata } from "ai";
import { debitTokenBalance, normalizeUsage, type TokenUsage } from "@/lib/credits";
import { usageValidator } from "./validators";

const FREE_MESSAGE_LIMIT = 10;
const FREE_TRIAL_TOKEN_LIMIT = 16_000_000;
const PRICE_PER_MILLION_TOKENS_USD = 0.3;

async function recordUsage(
  ctx: MutationCtx,
  userId: string,
  args: {
    model: string;
    provider: string;
    usage: TokenUsage;
    providerMetadata?: ProviderMetadata;
    source: "chat" | "api";
    apiKeyId?: Id<"apiKeys">;
  },
) {
  const normalizedUserId = ctx.db.normalizeId("users", userId);
  if (!normalizedUserId) throw new ConvexError("User not found.");

  const user = await ctx.db.get(normalizedUserId);
  if (!user) throw new ConvexError("User not found.");

  const usage = normalizeUsage(args.usage);
  if (user.isAnonymous) {
    const trialMessages = Math.max(0, user.trialMessages ?? 0);
    if (trialMessages > 0) {
      await ctx.db.patch(normalizedUserId, { trialMessages: trialMessages - 1 });
    }
  } else {
    await ctx.db.patch(
      normalizedUserId,
      debitTokenBalance(user.trialTokens, user.tokens, usage.totalTokens),
    );
  }

  return ctx.db.insert("usage", {
    model: args.model,
    provider: args.provider,
    usage,
    providerMetadata: args.providerMetadata,
    source: args.source,
    apiKeyId: args.apiKeyId,
    userId,
  });
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return userId !== null ? ctx.db.get(userId) : null;
  },
});

export const usageSummary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    const usageRows = await ctx.db
      .query("usage")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    const totalTokensTracked = usageRows.reduce((sum, row) => {
      return sum + (row.usage.totalTokens ?? 0);
    }, 0);

    const freeMessagesLeft = Math.max(0, user.trialMessages ?? 0);
    const freeMessagesUsed = Math.max(0, FREE_MESSAGE_LIMIT - freeMessagesLeft);
    const freeMessagesLeftPercent = (freeMessagesLeft / FREE_MESSAGE_LIMIT) * 100;

    const trialTokensLeft = Math.max(0, user.trialTokens ?? 0);
    const trialTokensUsed = Math.max(0, FREE_TRIAL_TOKEN_LIMIT - trialTokensLeft);

    const usageTrackedPercent = user.isAnonymous
      ? (freeMessagesUsed / FREE_MESSAGE_LIMIT) * 100
      : (trialTokensUsed / FREE_TRIAL_TOKEN_LIMIT) * 100;

    const estimatedSpendUsd =
      (totalTokensTracked / 1_000_000) * PRICE_PER_MILLION_TOKENS_USD;

    return {
      isAnonymous: Boolean(user.isAnonymous),
      totalTokensTracked,
      freeMessagesLeft,
      usageTrackedPercent: Math.min(100, Math.max(0, usageTrackedPercent)),
      freeMessagesLeftPercent: Math.min(100, Math.max(0, freeMessagesLeftPercent)),
      estimatedSpendUsd,
    };
  },
});

export const creditBalance = query({
  args: {},
  returns: v.union(
    v.object({
      trialTokens: v.number(),
      paidTokens: v.number(),
      totalTokens: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || user.isAnonymous) return null;

    const trialTokens = Math.max(0, user.trialTokens ?? 0);
    const paidTokens = Math.max(0, user.tokens ?? 0);
    return {
      trialTokens,
      paidTokens,
      totalTokens: trialTokens + paidTokens,
    };
  },
});

export const billingProfile = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({ email: v.optional(v.string()), stripeId: v.optional(v.string()) }),
    v.null(),
  ),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user || user.isAnonymous) return null;
    return { email: user.email, stripeId: user.stripeId };
  },
});

export const connectStripeCustomer = internalMutation({
  args: { userId: v.id("users"), stripeId: v.string() },
  returns: v.string(),
  handler: async (ctx, { userId, stripeId }) => {
    const user = await ctx.db.get(userId);
    if (!user || user.isAnonymous) throw new ConvexError("Signed-in user not found.");
    if (user.stripeId) return user.stripeId;
    await ctx.db.patch(userId, { stripeId });
    return stripeId;
  },
});

export const messages = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError("Please sign in to continue.")
    const user = await ctx.db.get(userId)
    if (!user) throw new ConvexError("User not found.")
    const trialMessages = Math.max(0, user.trialMessages ?? 0)
    if (trialMessages === 0) return
    return ctx.db.patch(userId, { trialMessages: trialMessages - 1 })
  }
})

export const usage = mutation({
  args: {
    model: v.string(),
    provider: v.string(),
    usage: usageValidator,
    providerMetadata: v.optional(vProviderMetadata),
  },
  returns: v.id("usage"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in to continue.");
    return recordUsage(ctx, userId, { ...args, source: "chat" });
  },
})

export const listApiKeys = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("apiKeys"),
    name: v.string(),
    prefix: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    if (!user || user.isAnonymous) return [];

    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("byUserId", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    return keys.map((key) => ({
      _id: key._id,
      name: key.name,
      prefix: key.prefix,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
    }));
  },
});

export const createApiKey = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    prefix: v.string(),
    digest: v.string(),
  },
  returns: v.id("apiKeys"),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.isAnonymous) {
      throw new ConvexError("Sign in with Google before creating an API key.");
    }

    const name = args.name.trim();
    if (!name || name.length > 80) {
      throw new ConvexError("API key name must be between 1 and 80 characters.");
    }
    if (!/^vlad_[A-Za-z0-9_-]{8}$/.test(args.prefix)) {
      throw new ConvexError("Invalid API key prefix.");
    }
    if (!/^[a-f0-9]{64}$/.test(args.digest)) {
      throw new ConvexError("Invalid API key digest.");
    }

    const duplicate = await ctx.db
      .query("apiKeys")
      .withIndex("byDigest", (q) => q.eq("digest", args.digest))
      .unique();
    if (duplicate) throw new ConvexError("API key already exists.");

    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("byUserId", (q) => q.eq("userId", args.userId))
      .collect();
    if (existing.filter((key) => !key.revokedAt).length >= 20) {
      throw new ConvexError("Revoke an existing key before creating another.");
    }

    return ctx.db.insert("apiKeys", {
      userId: args.userId,
      name,
      prefix: args.prefix,
      digest: args.digest,
      createdAt: Date.now(),
    });
  },
});

export const revokeApiKey = mutation({
  args: { apiKeyId: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, { apiKeyId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in to continue.");
    const key = await ctx.db.get(apiKeyId);
    if (!key || key.userId !== userId) {
      throw new ConvexError("API key not found.");
    }
    if (!key.revokedAt) await ctx.db.patch(apiKeyId, { revokedAt: Date.now() });
    return null;
  },
});

export const resolveApiKey = query({
  args: { digest: v.string() },
  returns: v.union(v.object({ hasCredits: v.boolean() }), v.null()),
  handler: async (ctx, { digest }) => {
    if (!/^[a-f0-9]{64}$/.test(digest)) return null;
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("byDigest", (q) => q.eq("digest", digest))
      .unique();
    if (!key || key.revokedAt) return null;

    const user = await ctx.db.get(key.userId);
    if (!user || user.isAnonymous) return null;
    const trialTokens = Math.max(0, user.trialTokens ?? 0);
    const paidTokens = Math.max(0, user.tokens ?? 0);
    return { hasCredits: trialTokens > 0 || paidTokens > 0 };
  },
});

export const recordApiUsage = mutation({
  args: {
    digest: v.string(),
    model: v.string(),
    provider: v.string(),
    usage: usageValidator,
    providerMetadata: v.optional(vProviderMetadata),
  },
  returns: v.id("usage"),
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{64}$/.test(args.digest)) {
      throw new ConvexError("Invalid API key.");
    }
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("byDigest", (q) => q.eq("digest", args.digest))
      .unique();
    if (!key || key.revokedAt) throw new ConvexError("Invalid API key.");

    const result = await recordUsage(ctx, key.userId, {
      model: args.model,
      provider: args.provider,
      usage: args.usage,
      providerMetadata: args.providerMetadata,
      source: "api",
      apiKeyId: key._id,
    });
    await ctx.db.patch(key._id, { lastUsedAt: Date.now() });
    return result;
  },
});

export const resetMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = ((await ctx.db.query('users').collect()))
    for (const user of users) {
      await ctx.db.patch(user._id, { trialMessages: 10 })
    }
  }
})

export const resetTokens = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = ((await ctx.db.query('users').collect()))
    for (const user of users) {
      await ctx.db.patch(user._id, { trialTokens: 16000000 })
    }
  }
})

export const topup = internalMutation({
  args: { eventId: v.string(), tokens: v.number(), stripeId: v.string() },
  returns: v.object({ credited: v.boolean() }),
  handler: async (ctx, args) => {
    const processed = await ctx.db
      .query("stripeEvents")
      .withIndex("byEventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (processed) return { credited: false };

    const user = await ctx.db.query('users').withIndex('stripeId', q => q.eq('stripeId', args.stripeId)).unique()
    if (!user) throw new ConvexError("Stripe customer not found.");
    await ctx.db.patch(user._id, { tokens: Math.max(0, user.tokens ?? 0) + args.tokens })
    await ctx.db.insert("stripeEvents", { eventId: args.eventId, processedAt: Date.now() });
    return { credited: true };
  }
})
