import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const getConnection = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const conn = await ctx.db
      .query("notionConnections")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .first();

    if (!conn) return null;

    return {
      _id: conn._id,
      workspaceName: conn.workspaceName,
      workspaceIcon: conn.workspaceIcon,
      workspaceId: conn.workspaceId,
      botId: conn.botId,
      scope: conn.scope,
    };
  },
});

export const getConnectionForUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notionConnections")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const saveConnection = mutation({
  args: {
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.optional(v.number()),
    tokenEndpoint: v.string(),
    clientId: v.string(),
    workspaceName: v.optional(v.string()),
    workspaceIcon: v.optional(v.string()),
    workspaceId: v.string(),
    botId: v.string(),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("notionConnections")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        tokenEndpoint: args.tokenEndpoint,
        clientId: args.clientId,
        workspaceName: args.workspaceName,
        workspaceIcon: args.workspaceIcon,
        workspaceId: args.workspaceId,
        botId: args.botId,
        scope: args.scope,
      });
    } else {
      await ctx.db.insert("notionConnections", {
        userId,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        tokenEndpoint: args.tokenEndpoint,
        clientId: args.clientId,
        workspaceName: args.workspaceName,
        workspaceIcon: args.workspaceIcon,
        workspaceId: args.workspaceId,
        botId: args.botId,
        scope: args.scope,
      });
    }
  },
});

export const removeConnection = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("notionConnections")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const updateTokens = mutation({
  args: {
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("notionConnections")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
      });
    }
  },
});
