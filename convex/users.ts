import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

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
