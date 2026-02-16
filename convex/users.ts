import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { vProviderMetadata } from "@convex-dev/agent";

const FREE_MESSAGE_LIMIT = 10;
const FREE_TRIAL_TOKEN_LIMIT = 16_000_000;
const PRICE_PER_MILLION_TOKENS_USD = 0.3;

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

export const connect = mutation({
  args: { stripeId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    return ctx.db.patch(userId, { stripeId: args.stripeId })
  }
})

export const messages = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    const user = await ctx.db.get(userId)
    if (user.trialMessages === 0) return
    return ctx.db.patch(userId, { trialMessages: user.trialMessages - 1 })
  }
})

export const usage = mutation({
  args: {
    model: v.string(),
    provider: v.string(),
    usage: v.object({
      totalTokens: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      reasoningTokens: v.optional(v.number()),
      cachedInputTokens: v.optional(v.number()),
      inputTokenDetails: v.optional(v.object({
        cacheReadTokens: v.optional(v.number()),
        noCacheTokens: v.optional(v.number()),
      })),
      outputTokenDetails: v.optional(v.object({
        reasoningTokens: v.optional(v.number()),
        textTokens: v.optional(v.number()),
      })),
      raw: v.optional(v.any()),
    }),
    providerMetadata: v.optional(vProviderMetadata),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const user = await ctx.db.get(userId)

    if (user.isAnonymous && user.trialMessages > 0) {
      await ctx.db.patch(userId, { trialMessages: user.trialMessages - 1 })
    } else {
      const trialTokens = user.trialTokens - args.usage.totalTokens

      if (trialTokens <= 0) {
        const tokens = user.tokens - Math.abs(trialTokens)
        await ctx.db.patch(userId, { trialTokens: 0, tokens })
      } else {
        await ctx.db.patch(userId, { trialTokens })
      }
    }

    return ctx.db.insert('usage', {
      ...args,
      userId
    })
  },
})

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
  args: { tokens: v.number(), stripeId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query('users').withIndex('stripeId', q => q.eq('stripeId', args.stripeId)).first()
    return ctx.db.patch(user._id, { tokens: user.tokens + args.tokens })
  }
})
