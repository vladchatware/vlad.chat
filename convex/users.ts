import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, MutationCtx, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { vProviderMetadata } from "@convex-dev/agent";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { ProviderMetadata } from "ai";
import { debitTokenBalance, normalizeUsage, type TokenUsage } from "@/lib/credits";
import {
  FIVE_HOUR_WINDOW_CREDITS,
  FIVE_HOUR_WINDOW_MS,
  SUBSCRIBER_WINDOW_MULTIPLIER,
  WEEKLY_WINDOW_CREDITS,
  WEEKLY_WINDOW_MS,
  creditsForTokens,
} from "@/lib/billing";
import { usageValidator } from "./validators";

const FREE_MESSAGE_LIMIT = 10;
const FREE_TRIAL_TOKEN_LIMIT = 16_000_000;
const PRICE_PER_MILLION_TOKENS_USD = 0.3;

function isActiveSubscription(user: { subscriptionStatus?: string }) {
  return (
    user.subscriptionStatus === "active" || user.subscriptionStatus === "past_due"
  );
}

// Credits spent by a usage row (new rows store credits; legacy rows are
// reconstructed from the stored model + tokens with today's weights).
function rowCredits(row: { credits?: number; model: string; usage: { totalTokens?: number } }) {
  return row.credits ?? creditsForTokens(row.model, row.usage.totalTokens ?? 0);
}

async function usageWindows(
  ctx: MutationCtx,
  userId: string,
  now: number,
  subscriber: boolean,
) {
  const multiplier = subscriber ? SUBSCRIBER_WINDOW_MULTIPLIER : 1;
  const fiveLimit = FIVE_HOUR_WINDOW_CREDITS * multiplier;
  const weekLimit = WEEKLY_WINDOW_CREDITS * multiplier;

  const recent = await ctx.db
    .query("usage")
    .withIndex("byUserTime", (q) =>
      q.eq("userId", userId).gte("usageTime", now - FIVE_HOUR_WINDOW_MS),
    )
    .collect();
  const weekly = await ctx.db
    .query("usage")
    .withIndex("byUserTime", (q) =>
      q.eq("userId", userId).gte("usageTime", now - WEEKLY_WINDOW_MS),
    )
    .collect();

  const fiveCredits = recent.reduce((sum, row) => sum + rowCredits(row), 0);
  const weekCredits = weekly.reduce((sum, row) => sum + rowCredits(row), 0);

  return { fiveCredits, fiveLimit, weekCredits, weekLimit };
}

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
  const now = Date.now();
  const credits = creditsForTokens(args.model, usage.totalTokens);

  if (user.isAnonymous) {
    const trialMessages = Math.max(0, user.trialMessages ?? 0);
    if (trialMessages > 0) {
      await ctx.db.patch(normalizedUserId, { trialMessages: trialMessages - 1 });
    }
  } else {
    const subscriber = isActiveSubscription(user);
    const windows = await usageWindows(ctx, normalizedUserId, now, subscriber);

    if (windows.fiveCredits >= windows.fiveLimit) {
      throw new ConvexError(
        subscriber
          ? "You've hit the 5-hour usage cap for your plan. It resets on a rolling basis — try again soon."
          : "You've hit the free 5-hour usage cap. Subscribe or top up to raise it.",
      );
    }
    if (windows.weekCredits >= windows.weekLimit) {
      throw new ConvexError(
        subscriber
          ? "You've hit the weekly usage cap for your plan. It resets on a rolling basis."
          : "You've hit the free weekly usage cap. Subscribe or top up to raise it.",
      );
    }

    // Trial burns raw tokens; once the trial is exhausted, paid + grant
    // balances burn weighted credits. Subscribers' excess queues as postpaid
    // overage for the Stripe meter drain.
    const trialDebit = debitTokenBalance(user.trialTokens, undefined, usage.totalTokens);
    let includedCredits = Math.max(0, user.includedCredits ?? 0);
    let paidTokens = Math.max(0, user.tokens ?? 0);
    let remaining = trialDebit.trialTokens > 0 ? 0 : credits;

    if (remaining > 0) {
      const fromIncluded = Math.min(includedCredits, remaining);
      includedCredits -= fromIncluded;
      remaining -= fromIncluded;
    }

    if (remaining > 0) {
      // Negative paid balance marks the account as drawn-down; the generate
      // gate stops non-subscribers, while active subscribers keep going and
      // settle up via metered billing.
      paidTokens -= remaining;
      if (subscriber && user.stripeId) {
        await ctx.db.insert("meterOverage", {
          userId: normalizedUserId,
          stripeId: user.stripeId,
          credits: remaining,
          status: "pending",
        });
      }
    }

    await ctx.db.patch(normalizedUserId, {
      trialTokens: trialDebit.trialTokens,
      tokens: paidTokens,
      includedCredits,
    });
  }

  return ctx.db.insert("usage", {
    model: args.model,
    provider: args.provider,
    usage,
    providerMetadata: args.providerMetadata,
    source: args.source,
    apiKeyId: args.apiKeyId,
    userId,
    usageTime: now,
    credits,
    overageQueued: false,
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

export const subscriptionStatus = query({
  args: {},
  returns: v.union(
    v.object({
      status: v.union(
        v.literal("active"),
        v.literal("past_due"),
        v.literal("canceled"),
        v.null(),
      ),
      hasSubscription: v.boolean(),
      includedCredits: v.number(),
      paidTokens: v.number(),
      trialTokens: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || user.isAnonymous) return null;

    return {
      status: user.subscriptionStatus ?? null,
      hasSubscription: isActiveSubscription(user),
      includedCredits: Math.max(0, user.includedCredits ?? 0),
      paidTokens: Math.max(0, user.tokens ?? 0),
      trialTokens: Math.max(0, user.trialTokens ?? 0),
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
  returns: v.union(
    v.object({ hasCredits: v.boolean(), premiumAllowed: v.boolean() }),
    v.null(),
  ),
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
    return {
      hasCredits: trialTokens > 0 || paidTokens > 0 || isActiveSubscription(user),
      premiumAllowed: isActiveSubscription(user),
    };
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

// Applies subscription lifecycle changes from Stripe webhooks. Idempotent per
// Stripe event id via the stripeEvents table.
export const applySubscriptionWebhook = internalMutation({
  args: {
    eventId: v.string(),
    stripeId: v.string(),
    action: v.union(
      v.literal("activate"),
      v.literal("past_due"),
      v.literal("cancel"),
    ),
    subscriptionId: v.optional(v.string()),
    grantCredits: v.optional(v.number()),
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    const processed = await ctx.db
      .query("stripeEvents")
      .withIndex("byEventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (processed) return { applied: false };

    const user = await ctx.db
      .query("users")
      .withIndex("stripeId", (q) => q.eq("stripeId", args.stripeId))
      .unique();
    if (!user) throw new ConvexError("Stripe customer not found.");

    const now = Date.now();
    if (args.action === "activate") {
      // Renewals re-grant; fresh activations also stamp the period start.
      const isRenewal =
        isActiveSubscription(user) && args.subscriptionId === user.stripeSubscriptionId;
      await ctx.db.patch(user._id, {
        subscriptionStatus: "active",
        stripeSubscriptionId: args.subscriptionId ?? user.stripeSubscriptionId,
        includedCredits: Math.max(0, user.includedCredits ?? 0) + (args.grantCredits ?? 0),
        grantPeriodStart: isRenewal ? user.grantPeriodStart : now,
      });
    } else if (args.action === "past_due") {
      await ctx.db.patch(user._id, { subscriptionStatus: "past_due" });
    } else {
      await ctx.db.patch(user._id, {
        subscriptionStatus: "canceled",
        includedCredits: 0,
      });
    }

    await ctx.db.insert("stripeEvents", {
      eventId: args.eventId,
      processedAt: now,
    });
    return { applied: true };
  },
});
