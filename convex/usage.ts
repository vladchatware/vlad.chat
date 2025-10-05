import { v } from 'convex/values'
import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { UsageHandler, vProviderMetadata } from "@convex-dev/agent";
import { getAuthUserId } from "@convex-dev/auth/server"
import { userAgent } from 'next/server';

export function getBillingPeriod(at: number) {
  const now = new Date(at);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth());
  return startOfMonth.toISOString().split("T")[0];
}

export const usageHandler: UsageHandler = async (ctx, args) => {
  if (!args.userId) {
    console.debug("Not tracking usage for anonymous user");
    return;
  }
  // await ctx.runMutation(internal.usage.insertRawUsage, {
  //   userId: args.userId,
  //   agentName: args.agentName,
  //   model: args.model,
  //   provider: args.provider,
  //   usage: args.usage,
  //   providerMetadata: args.providerMetadata,
  // });
};

// export const resetLimits = mutation({}, handler: async (ctx, args) => {
//   const userId = await getAuthUserId(ctx);
//   if (userId === null) {
//     throw new Error("Not signed in");
//   }
//   // return ctx.db.
// })

export const insertRawUsage = mutation({
  args: {
    agentName: v.optional(v.string()),
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
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not signed in");
    }
    // @ts-expect-error Agent code
    args.userId = userId
    const billingPeriod = getBillingPeriod(Date.now());

    const user = await ctx.db.get(userId)
    console.log('user', user)

    const trialMessages = user?.trialMessages <= 0 ? 0 : user?.trialMessages - 1
    await ctx.db.patch(userId, { trialMessages })

    // @ts-expect-error Agent mixup
    return await ctx.db.insert("usage", {
      ...args,
      billingPeriod,
    });
  },
});
