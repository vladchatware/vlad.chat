import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, MutationCtx, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { vProviderMetadata } from "@convex-dev/agent";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { ProviderMetadata } from "ai";
import {
  debitCreditBalance,
  normalizeUsage,
  trialShortfallTokens,
  type TokenUsage,
} from "@/lib/credits";
import {
  FIVE_HOUR_WINDOW_CREDITS,
  FIVE_HOUR_WINDOW_MS,
  SUBSCRIBER_WINDOW_MULTIPLIER,
  WEEKLY_WINDOW_CREDITS,
  WEEKLY_WINDOW_MS,
  creditsForTokens,
} from "@/lib/billing";
import { usageValidator } from "./validators";
import { isPremiumModel, isModelEnabled } from "@/lib/provider";

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
  ctx: Pick<QueryCtx, "db">,
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

    // Settlement always accounts for completed generation. Cap enforcement
    // happens at admission (usageGate) — a cap thrown here would drop usage
    // for work the upstream provider already billed us for.
    // Trial burns raw tokens; once the trial can't cover a request, the raw
    // shortfall (not the whole request) converts to weighted credits. Grant
    // and prepaid credits burn weighted. The prepaid balance acts as a buffer
    // before overage; only the uncovered remainder is metered to Stripe.
    const shortfallTokens = trialShortfallTokens(user.trialTokens, usage.totalTokens);
    const shortfallCredits = creditsForTokens(args.model, shortfallTokens);
    const waterfall = debitCreditBalance(
      { includedCredits: user.includedCredits, paidTokens: user.tokens },
      shortfallCredits,
    );

    await ctx.db.patch(normalizedUserId, {
      trialTokens: Math.max(0, (user.trialTokens ?? 0) - usage.totalTokens),
      tokens: waterfall.paidTokens,
      includedCredits: waterfall.includedCredits,
    });

    if (waterfall.overageCredits > 0 && subscriber && user.stripeId) {
      // Active subscribers keep going and settle up via metered billing.
      await ctx.db.insert("meterOverage", {
        userId: normalizedUserId,
        stripeId: user.stripeId,
        credits: waterfall.overageCredits,
        status: "pending",
        queuedAt: now,
      });
    }
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

// Admission-time gate: throws before generation starts when a usage window is
// already exhausted. Called by chat/api/threads entry points.
export const usageGate = mutation({
  args: { model: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in to continue.");
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found.");
    const now = Date.now();

    // Premium access is checked first and independently of the operational
    // enabled flag: premium models are enabled:false by definition, so a
    // subscriber must not be blocked by the enabled check below.
    if (isPremiumModel(args.model)) {
      if (user.isAnonymous || !isActiveSubscription(user)) {
        throw new ConvexError("This model requires a vlad.chat subscription.");
      }
    } else if (!isModelEnabled(args.model)) {
      throw new ConvexError("This model is unavailable.");
    }
    if (user.isAnonymous) {
      if ((user.trialMessages ?? 0) <= 0) {
        throw new ConvexError("You've reached the anonymous message limit. Sign in with Google for unlimited messages.");
      }
      return null;
    }

    const subscriber = isActiveSubscription(user);
    const hasBalance =
      (user.trialTokens ?? 0) > 0 ||
      (user.tokens ?? 0) > 0 ||
      (user.includedCredits ?? 0) > 0 ||
      subscriber;
    if (!hasBalance) {
      throw new ConvexError("You have run out of credits. Buy more to continue.");
    }

    const windows = await usageWindows(ctx, userId, now, subscriber);
    if (windows.fiveCredits >= windows.fiveLimit) {
      throw new ConvexError(
        subscriber
          ? "You've hit the 5-hour usage cap for your plan. It resets on a rolling basis — try again soon."
          : "You've hit the free 5-hour usage cap. It resets on a rolling basis — try again soon.",
      );
    }
    if (windows.weekCredits >= windows.weekLimit) {
      throw new ConvexError(
        subscriber
          ? "You've hit the weekly usage cap for your plan. It resets on a rolling basis."
          : "You've hit the free weekly usage cap. It resets on a rolling basis.",
      );
    }
    return null;
  },
});

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return userId !== null ? ctx.db.get(userId) : null;
  },
});

// Claims the single Checkout-session slot for the signed-in user. Called by
// /api/subscribe BEFORE creating the Stripe session, with a locally generated
// marker (passed to Stripe as client_reference_id). Convex OCC serializes
// concurrent calls: the transaction that commits second re-runs, re-reads the
// fresh reservation, and throws — so only one checkout can be in flight. A
// reservation older than 24h (Checkout's max lifetime) is treated as stale and
// is safely overwritable, so an abandoned session never locks the user out.
export const reserveCheckout = mutation({
  args: { marker: v.string() },
  returns: v.null(),
  handler: async (ctx, { marker }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in to continue.");
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found.");
    const reserved = user.pendingCheckoutSessionId;
    const reservedAt = user.pendingCheckoutAt ?? 0;
    if (reserved && reserved !== marker && Date.now() - reservedAt < 24 * 60 * 60 * 1000) {
      throw new ConvexError(
        "A checkout is already in progress. Complete or cancel it before starting another.",
      );
    }
    await ctx.db.patch(userId, {
      pendingCheckoutSessionId: marker,
      pendingCheckoutAt: Date.now(),
    });
    return null;
  },
});

// Releases the Checkout slot. With a marker, only the owning reservation is
// cleared (expired/failed session events); without one, whatever reservation
// exists is cleared (successful subscription activation).
export const clearCheckoutReservation = internalMutation({
  args: { stripeId: v.string(), marker: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { stripeId, marker }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("stripeId", (q) => q.eq("stripeId", stripeId))
      .unique();
    if (!user) return null;
    if (marker !== undefined && user.pendingCheckoutSessionId !== marker) {
      return null;
    }
    await ctx.db.patch(user._id, {
      pendingCheckoutSessionId: undefined,
      pendingCheckoutAt: undefined,
    });
    return null;
  },
});

// Caller-owned release for /api/subscribe when Stripe session creation fails
// (the reservation was taken under the caller's own marker).
export const releaseCheckout = mutation({
  args: { marker: v.string() },
  returns: v.null(),
  handler: async (ctx, { marker }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || user.pendingCheckoutSessionId !== marker) return null;
    await ctx.db.patch(user._id, {
      pendingCheckoutSessionId: undefined,
      pendingCheckoutAt: undefined,
    });
    return null;
  },
});

export const usageSummary = query({
  args: {},
  returns: v.union(v.null(), v.object({
    isAnonymous: v.boolean(),
    totalTokensTracked: v.number(),
    freeMessagesLeft: v.number(),
    usageTrackedPercent: v.number(),
    freeMessagesLeftPercent: v.number(),
    estimatedSpendUsd: v.number(),
    fiveHourCreditsUsed: v.number(),
    fiveHourCreditsLimit: v.number(),
    weeklyCreditsUsed: v.number(),
    weeklyCreditsLimit: v.number(),
  })),
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

    const windows = user.isAnonymous
      ? null
      : await usageWindows(ctx, userId, Date.now(), isActiveSubscription(user));

    return {
      isAnonymous: Boolean(user.isAnonymous),
      totalTokensTracked,
      freeMessagesLeft,
      usageTrackedPercent: Math.min(100, Math.max(0, usageTrackedPercent)),
      freeMessagesLeftPercent: Math.min(100, Math.max(0, freeMessagesLeftPercent)),
      estimatedSpendUsd,
      fiveHourCreditsUsed: windows?.fiveCredits ?? 0,
      fiveHourCreditsLimit: windows?.fiveLimit ?? FIVE_HOUR_WINDOW_CREDITS,
      weeklyCreditsUsed: windows?.weekCredits ?? 0,
      weeklyCreditsLimit: windows?.weekLimit ?? WEEKLY_WINDOW_CREDITS,
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
//
// Stale-event protection: every action is guarded by the local subscription
// identity, so delayed/retried events for an older subscription cannot
// overwrite newer entitlement state (cancellation of the current subscription
// is the only valid cancel; activation of a different subscription than the
// locally-known one can only start a new entitlement).
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
    const knownSub = user.stripeSubscriptionId;

    if (args.action === "activate") {
      const sameSub = args.subscriptionId !== undefined && args.subscriptionId === knownSub;
      if (!isActiveSubscription(user) && !sameSub) {
        // A paid invoice for a subscription other than the locally-known one
        // can only mean a fresh (re)subscription — adopt it and stamp a new
        // grant period. Same-subscription activations (renewal invoices) just
        // re-grant on top of the existing period.
        await ctx.db.patch(user._id, {
          subscriptionStatus: "active",
          stripeSubscriptionId: args.subscriptionId,
          includedCredits: Math.max(0, user.includedCredits ?? 0) + (args.grantCredits ?? 0),
          grantPeriodStart: now,
        });
      } else {
        // Renewal (already active/past_due): additive re-grant. Identity is
        // preserved — a renewal invoice naming a different subscription must
        // never overwrite the locally-known id (stale/foreign event guard).
        // A paid renewal also recovers a past_due subscription to active.
        await ctx.db.patch(user._id, {
          subscriptionStatus: "active",
          stripeSubscriptionId: knownSub ?? args.subscriptionId,
          includedCredits: Math.max(0, user.includedCredits ?? 0) + (args.grantCredits ?? 0),
        });
      }
    } else if (args.action === "past_due") {
      // Payment failure only downgrades the subscription it belongs to. A
      // failure for an old/unknown subscription must not touch a newer one.
      if (args.subscriptionId === undefined || args.subscriptionId === knownSub) {
        await ctx.db.patch(user._id, { subscriptionStatus: "past_due" });
      }
    } else {
      // Cancellation only clears entitlements for the locally-known
      // subscription; a stale deletion for a previous subscription is
      // ignored so it cannot cancel a newer entitlement or wipe its grant.
      if (args.subscriptionId === undefined || args.subscriptionId === knownSub) {
        await ctx.db.patch(user._id, {
          subscriptionStatus: "canceled",
          includedCredits: 0,
        });
      }
    }

    await ctx.db.insert("stripeEvents", {
      eventId: args.eventId,
      processedAt: now,
    });
    return { applied: true };
  },
});
