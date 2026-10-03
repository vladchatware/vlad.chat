import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { agentActivityState } from "./lib/agentActivityState";

const MAX_ACTIVITIES_PER_USER = 20;
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;
const stateValidator = v.object({
  phase: v.union(v.literal("starting"), v.literal("running"), v.literal("executing"),
    v.literal("stopping"), v.literal("paused"), v.literal("completed"), v.literal("failed")),
  stepCount: v.number(),
  updatedAt: v.number(),
});

export const pushAvailable = query({
  args: {}, returns: v.boolean(),
  handler: async (ctx) => Boolean(await getAuthUserId(ctx)) && Boolean(
    process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY,
  ),
});

export async function queueAgentActivityUpdate(ctx: MutationCtx, runId: Id<"agentRuns">): Promise<void> {
  const registrations = await ctx.db.query("agentActivities")
    .withIndex("byRun", (q) => q.eq("runId", runId)).take(MAX_ACTIVITIES_PER_USER);
  for (const registration of registrations) {
    if (registration.expiresAt <= Date.now()) {
      await ctx.db.delete(registration._id);
      continue;
    }
    const revision = registration.revision + 1;
    await ctx.db.patch(registration._id, { revision });
    // Coalesce rapid model/tool transitions. Older scheduled revisions become
    // no-ops; the newest authoritative state wins, including terminal updates.
    await ctx.scheduler.runAfter(1000, internal.agentActivityPush.send, {
      registrationId: registration._id, revision, attempt: 0,
    });
  }
}

export async function patchAgentRun(
  ctx: MutationCtx,
  runId: Id<"agentRuns">,
  patch: Partial<Omit<Doc<"agentRuns">, "_id" | "_creationTime">>,
): Promise<void> {
  const before = await ctx.db.get(runId);
  await ctx.db.patch(runId, patch);
  if (!before) return;
  const previous = agentActivityState(before);
  const next = agentActivityState({ ...before, ...patch });
  if (previous?.phase !== next?.phase || previous?.stepCount !== next?.stepCount) {
    await queueAgentActivityUpdate(ctx, runId);
  }
}

export const register = mutation({
  args: {
    runId: v.id("agentRuns"), activityId: v.string(), pushToken: v.string(),
    environment: v.union(v.literal("sandbox"), v.literal("production")),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const run = await ctx.db.get(args.runId);
    if (!userId || !run || run.userId !== userId) throw new ConvexError("Agent run not found.");
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(args.activityId)
      || !/^[a-fA-F0-9]{64,512}$/.test(args.pushToken) || args.pushToken.length % 2 !== 0) {
      throw new ConvexError("Invalid Live Activity registration.");
    }
    if (!process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID || !process.env.APNS_PRIVATE_KEY) return false;
    const existing = await ctx.db.query("agentActivities")
      .withIndex("byUserActivity", (q) => q.eq("userId", userId).eq("activityId", args.activityId)).unique();
    if (existing && existing.runId !== args.runId) throw new ConvexError("Live Activity run cannot change.");
    const own = await ctx.db.query("agentActivities")
      .withIndex("byUser", (q) => q.eq("userId", userId)).take(MAX_ACTIVITIES_PER_USER + 1);
    for (const item of own) {
      if (item.expiresAt <= Date.now()) await ctx.db.delete(item._id);
    }
    if (!existing && own.filter((item) => item.expiresAt > Date.now()).length >= MAX_ACTIVITIES_PER_USER) {
      throw new ConvexError("Too many active Live Activities.");
    }
    if (existing?.expiresAt && existing.expiresAt <= Date.now()) return false;
    if (existing) {
      await ctx.db.patch(existing._id, { pushToken: args.pushToken, environment: args.environment });
    } else {
      const expiresAt = Date.now() + MAX_DURATION_MS;
      const id = await ctx.db.insert("agentActivities", {
        ...args, userId, expiresAt, revision: 0, lastTimestamp: 0,
      });
      await ctx.scheduler.runAfter(MAX_DURATION_MS, internal.agentActivities.expire, { registrationId: id });
    }
    await queueAgentActivityUpdate(ctx, args.runId);
    return true;
  },
});

export const unregister = mutation({
  args: { activityId: v.string() }, returns: v.null(),
  handler: async (ctx, { activityId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Authentication required.");
    const registration = await ctx.db.query("agentActivities")
      .withIndex("byUserActivity", (q) => q.eq("userId", userId).eq("activityId", activityId)).unique();
    if (registration) await ctx.db.delete(registration._id);
    return null;
  },
});

export const expire = internalMutation({
  args: { registrationId: v.id("agentActivities") }, returns: v.null(),
  handler: async (ctx, { registrationId }) => {
    const registration = await ctx.db.get(registrationId);
    if (registration && registration.expiresAt <= Date.now()) await ctx.db.delete(registrationId);
    return null;
  },
});

export const prepareDelivery = internalMutation({
  args: { registrationId: v.id("agentActivities"), revision: v.number() },
  returns: v.union(v.null(), v.object({
    pushToken: v.string(), environment: v.union(v.literal("sandbox"), v.literal("production")),
    timestamp: v.number(), state: stateValidator,
  })),
  handler: async (ctx, { registrationId, revision }) => {
    const registration = await ctx.db.get(registrationId);
    if (!registration || registration.revision !== revision || registration.expiresAt <= Date.now()) return null;
    const run = await ctx.db.get(registration.runId);
    if (!run || run.userId !== registration.userId) {
      await ctx.db.delete(registrationId);
      return null;
    }
    const state = agentActivityState(run);
    if (!state) return null;
    const timestamp = Math.max(Math.floor(Date.now() / 1000), registration.lastTimestamp + 1);
    await ctx.db.patch(registrationId, { lastTimestamp: timestamp });
    return { pushToken: registration.pushToken, environment: registration.environment, timestamp, state };
  },
});

export const finishDelivery = internalMutation({
  args: { registrationId: v.id("agentActivities"), revision: v.number(), remove: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { registrationId, revision, remove }) => {
    const registration = await ctx.db.get(registrationId);
    if (remove && registration?.revision === revision) await ctx.db.delete(registrationId);
    return null;
  },
});

export const isCurrentDelivery = internalQuery({
  args: { registrationId: v.id("agentActivities"), revision: v.number() }, returns: v.boolean(),
  handler: async (ctx, { registrationId, revision }) => {
    const registration = await ctx.db.get(registrationId);
    return Boolean(registration && registration.revision === revision && registration.expiresAt > Date.now());
  },
});
