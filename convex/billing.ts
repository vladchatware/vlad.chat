"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import {
  OVERAGE_METER_EVENT_NAME,
  meterValueForCredits,
} from "@/lib/billing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const ensureStripeCustomer = action({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in to continue.");

    const profile = await ctx.runQuery(internal.users.billingProfile, { userId });
    if (!profile) throw new Error("Signed-in user not found.");
    if (profile.stripeId) return profile.stripeId;

    const customer = await stripe.customers.create(
      { email: profile.email },
      { idempotencyKey: `vlad-user-${userId}` },
    );
    return ctx.runMutation(internal.users.connectStripeCustomer, {
      userId,
      stripeId: customer.id,
    });
  },
});

export const drainMeterOverage = internalAction({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ sent: v.number(), failed: v.number() }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const pending = await ctx.runQuery(internal.meter.pendingOverage, { limit });

    let sent = 0;
    let failed = 0;
    for (const row of pending) {
      try {
        const event = await stripe.v2.billing.meterEvents.create({
          event_name: OVERAGE_METER_EVENT_NAME,
          payload: {
            value: meterValueForCredits(row.credits),
            stripe_customer_id: row.stripeId,
          },
          identifier: `overage_${row._id}`,
        });
        await ctx.runMutation(internal.meter.markOverageSent, {
          id: row._id,
          stripeEventId: event.identifier || `overage_${row._id}`,
        });
        sent += 1;
      } catch (error) {
        // Keep the row pending so the next tick retries; record why.
        await ctx.runMutation(internal.meter.markOverageFailed, {
          id: row._id,
          error: error instanceof Error ? error.message : String(error),
        });
        failed += 1;
      }
    }
    return { sent, failed };
  },
});

