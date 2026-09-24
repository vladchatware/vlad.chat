"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";

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
