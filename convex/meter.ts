import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

// Meter-overage queue access for the drain action in billing.ts (which needs
// "use node" for the Stripe SDK; sync queries/mutations must stay out of it).

export const pendingOverage = internalQuery({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      _id: v.id("meterOverage"),
      stripeId: v.string(),
      credits: v.number(),
      queuedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("meterOverage")
      .withIndex("byStatus", (q) => q.eq("status", "pending"))
      .take(limit);
    return rows.map((row) => ({
      _id: row._id,
      stripeId: row.stripeId,
      credits: row.credits,
      queuedAt: row.queuedAt,
    }));
  },
});

export const markOverageSent = internalMutation({
  args: { id: v.id("meterOverage"), stripeEventId: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, stripeEventId }) => {
    await ctx.db.patch(id, { status: "sent", sentAt: Date.now(), stripeEventId });
    return null;
  },
});

export const markOverageFailed = internalMutation({
  args: { id: v.id("meterOverage"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, error }) => {
    await ctx.db.patch(id, { failedAt: Date.now(), lastError: error.slice(0, 500) });
    return null;
  },
});
