import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { vProviderMetadata } from "@convex-dev/agent";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return userId !== null ? ctx.db.get(userId) : null;
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
    userId: v.optional(v.id("users")),
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
  },
  handler: async (ctx, args) => {
    const { userId: explicitUserId, ...usageArgs } = args;
    const userId = explicitUserId || (await getAuthUserId(ctx));
    if (!userId) throw new Error("User identification required");

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    if (user.isAnonymous && user.trialMessages > 0) {
      await ctx.db.patch(userId, { trialMessages: user.trialMessages - 1 });
    } else {
      const trialTokens = (user.trialTokens ?? 0) - (args.usage.totalTokens ?? 0);
      if (trialTokens <= 0) {
        const tokens = (user.tokens ?? 0) - Math.abs(trialTokens);
        await ctx.db.patch(userId, { trialTokens: 0, tokens });
      } else {
        await ctx.db.patch(userId, { trialTokens });
      }
    }

    return ctx.db.insert('usage', {
      ...usageArgs,
      userId
    });
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
  args: { tokens: v.number(), stripeId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query('users').withIndex('stripeId', q => q.eq('stripeId', args.stripeId)).first()
    return ctx.db.patch(user._id, { tokens: user.tokens + args.tokens })
  }
})

export const getByApiKey = query({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    return ctx.db.query('users').withIndex('apiKey', q => q.eq('apiKey', args.apiKey)).first()
  }
})
