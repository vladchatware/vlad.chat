import { ConvexError, v } from "convex/values";

import { action, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { agent } from "./agents/simple";

/**
 * Account deletion (App Store Guideline 5.1.1(v)).
 *
 * Deletes every user-scoped record we hold: chat threads/messages (agent
 * component, incl. stored files and streams), agent runs and steps, API keys,
 * Notion connections (OAuth tokens), computer-use sessions/screenshots (plus
 * their storage blobs), code runs, thread title jobs, usage/metering rows,
 * Store transaction rows, lounge messages, then the Convex Auth account,
 * sessions, refresh tokens, and finally the user document.
 *
 * External side effects: an active Stripe subscription is cancelled and any
 * pending Checkout session expired before local data is removed.
 */

const PURGE_BATCH = 100;
const THREAD_PAGE = 25;
const STRIPE_API = "https://api.stripe.com/v1";

async function stripeRequest(path: string, method: "POST" | "DELETE") {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ConvexError("Billing is not configured.");
  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}` },
  });
  // 404 means the object is already gone — deletion is idempotent.
  if (!response.ok && response.status !== 404) {
    throw new ConvexError(
      "Could not cancel your billing subscription. Please try again in a moment.",
    );
  }
}

export const deleteAccount = action({
  args: { confirm: v.literal("DELETE") },
  returns: v.object({
    threadsDeleted: v.number(),
    threadsFailed: v.number(),
  }),
  handler: async (ctx): Promise<{ threadsDeleted: number; threadsFailed: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in to continue.");

    // 1. Stop billing first: an active subscription must not keep charging a
    //    deleted account.
    const billing = await ctx.runQuery(internal.account.billingState, { userId });
    if (billing.stripeSubscriptionId) {
      await stripeRequest(`/subscriptions/${billing.stripeSubscriptionId}`, "DELETE");
    }
    if (billing.pendingCheckoutSessionId) {
      await stripeRequest(`/checkout/sessions/${billing.pendingCheckoutSessionId}/expire`, "POST");
    }

    // 2. Tear down chat threads synchronously (messages, streams, files).
    let threadsDeleted = 0;
    let threadsFailed = 0;
    let cursor: string | null = null;
    while (true) {
      const page = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
        userId,
        paginationOpts: { numItems: THREAD_PAGE, cursor },
      });
      for (const thread of page.page) {
        try {
          await agent.deleteThreadSync(ctx, { threadId: thread._id });
          await ctx.runMutation(internal.account.clearThreadAux, {
            userId,
            threadId: thread._id,
          });
          threadsDeleted += 1;
        } catch {
          threadsFailed += 1;
        }
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    // 3. Purge remaining user-scoped rows in bounded batches.
    let done = false;
    while (!done) {
      done = await ctx.runMutation(internal.account.purgeUserBatch, { userId });
    }

    return { threadsDeleted, threadsFailed };
  },
});

export const billingState = internalQuery({
  args: { userId: v.id("users") },
  returns: v.object({
    stripeSubscriptionId: v.union(v.string(), v.null()),
    pendingCheckoutSessionId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return {
      stripeSubscriptionId: user?.stripeSubscriptionId ?? null,
      pendingCheckoutSessionId: user?.pendingCheckoutSessionId ?? null,
    };
  },
});

/** Auxiliary rows keyed by thread rather than user. */
export const clearThreadAux = internalMutation({
  args: { userId: v.id("users"), threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, threadId }) => {
    const titleJobs = await ctx.db
      .query("threadTitleJobs")
      .withIndex("byThread", (q) => q.eq("threadId", threadId))
      .take(PURGE_BATCH);
    for (const job of titleJobs) await ctx.db.delete(job._id);

    const codeRuns = await ctx.db
      .query("computerCodeRuns")
      .withIndex("byUserThreadUpdatedAt", (q) =>
        q.eq("userId", userId).eq("threadId", threadId),
      )
      .take(PURGE_BATCH);
    for (const run of codeRuns) await ctx.db.delete(run._id);

    return null;
  },
});

/**
 * Deletes up to PURGE_BATCH rows per table and reports whether more remain.
 * Runs repeatedly from the action so no single transaction grows unbounded.
 */
export const purgeUserBatch = internalMutation({
  args: { userId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, { userId }): Promise<boolean> => {
    let more = false;
    const bump = (count: number) => {
      if (count >= PURGE_BATCH) more = true;
    };

    // Computer-use screenshots + their storage blobs, reached through runs so
    // the association is deleted first.
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("byUser", (q) => q.eq("userId", userId))
      .take(20);
    for (const run of runs) {
      const shots = await ctx.db
        .query("computerUseScreenshots")
        .withIndex("byRunToolCall", (q) => q.eq("runId", run._id))
        .take(PURGE_BATCH);
      for (const shot of shots) {
        await ctx.storage.delete(shot.storageId).catch(() => undefined);
        await ctx.db.delete(shot._id);
      }
      const steps = await ctx.db
        .query("agentRunSteps")
        .withIndex("byRunStep", (q) => q.eq("runId", run._id))
        .take(PURGE_BATCH);
      for (const step of steps) await ctx.db.delete(step._id);
      const steering = await ctx.db
        .query("agentRunSteering")
        .withIndex("byRun", (q) => q.eq("runId", run._id))
        .take(PURGE_BATCH);
      for (const row of steering) await ctx.db.delete(row._id);
      if (steps.length >= PURGE_BATCH || steering.length >= PURGE_BATCH) {
        more = true;
        continue; // finish this run on the next pass
      }
      await ctx.db.delete(run._id);
    }
    bump(runs.length);

    const apiKeys = await ctx.db
      .query("apiKeys")
      .withIndex("byUserId", (q) => q.eq("userId", userId))
      .take(PURGE_BATCH);
    for (const key of apiKeys) await ctx.db.delete(key._id);
    bump(apiKeys.length);

    const notion = await ctx.db
      .query("notionConnections")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .take(PURGE_BATCH);
    for (const connection of notion) await ctx.db.delete(connection._id);
    bump(notion.length);

    const usage = await ctx.db
      .query("usage")
      .withIndex("byUserTime", (q) => q.eq("userId", userId))
      .take(PURGE_BATCH);
    for (const row of usage) await ctx.db.delete(row._id);
    bump(usage.length);

    const overage = await ctx.db
      .query("meterOverage")
      .withIndex("byUser", (q) => q.eq("userId", userId))
      .take(PURGE_BATCH);
    for (const row of overage) await ctx.db.delete(row._id);
    bump(overage.length);

    // Financial rows (Store transactions, usage, meter overage) are deleted for
    // maximum privacy. Retention policy for accounting/tax is deliberately
    // parked until after App Review (decision 2026-10-31) — revisit then.
    const purchases = await ctx.db
      .query("storeTransactions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .take(PURGE_BATCH);
    for (const row of purchases) await ctx.db.delete(row._id);
    bump(purchases.length);

    const codeRuns = await ctx.db
      .query("computerCodeRuns")
      .withIndex("byUserThreadUpdatedAt", (q) => q.eq("userId", userId))
      .take(PURGE_BATCH);
    for (const row of codeRuns) await ctx.db.delete(row._id);
    bump(codeRuns.length);

    const sessions = await ctx.db
      .query("computerUseSessions")
      .withIndex("bySessionKey", (q) => q.eq("sessionKey", userId))
      .take(PURGE_BATCH);
    for (const row of sessions) await ctx.db.delete(row._id);
    bump(sessions.length);

    const lounge = await ctx.db
      .query("loungeMessages")
      .filter((q) => q.eq(q.field("userId"), userId))
      .take(PURGE_BATCH);
    for (const row of lounge) await ctx.db.delete(row._id);
    bump(lounge.length);

    if (more) return false;

    // Final pass: auth records, then the user document itself.
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();
    for (const account of accounts) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .collect();
      for (const code of codes) await ctx.db.delete(code._id);
      await ctx.db.delete(account._id);
    }

    const authSessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const session of authSessions) {
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .collect();
      for (const token of tokens) await ctx.db.delete(token._id);
      await ctx.db.delete(session._id);
    }

    const pendingUser = (await ctx.db.get(userId)) as { _id: Id<"users"> } | null;
    if (pendingUser) await ctx.db.delete(pendingUser._id);

    return true;
  },
});
