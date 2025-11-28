import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// Get today's date in YYYY-MM-DD format
function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

// Query to get all messages for today
export const getMessages = query({
  args: {},
  handler: async (ctx) => {
    const today = getTodayDate();
    const messages = await ctx.db
      .query("loungeMessages")
      .withIndex("byDate", (q) => q.eq("date", today))
      .order("asc")
      .collect();

    return messages;
  },
});

// Mutation to send a message
export const sendMessage = mutation({
  args: { content: v.string() },
  handler: async (ctx, { content }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Must be logged in to send messages");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Use name, email, or "Anonymous" as the display name
    const userName = user.name || user.email?.split("@")[0] || "Anonymous";
    const today = getTodayDate();

    return await ctx.db.insert("loungeMessages", {
      userId,
      userName,
      userImage: user.image,
      content: content.trim(),
      date: today,
    });
  },
});

// Check if user can trigger @vlad (for anonymous users with limited messages)
export const canTriggerVlad = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;

    const user = await ctx.db.get(userId);
    if (!user) return false;

    // Non-anonymous users have unlimited @vlad triggers
    if (!user.isAnonymous) return true;

    // Anonymous users need trial messages left
    return user.trialMessages > 0;
  },
});

// Decrement trial messages when @vlad is triggered (called from API route)
export const useVladTrigger = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Must be logged in");

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    // Only decrement for anonymous users
    if (user.isAnonymous && user.trialMessages > 0) {
      await ctx.db.patch(userId, { trialMessages: user.trialMessages - 1 });
    }

    return { success: true };
  },
});

// Get message count for today (for display purposes)
export const getMessageCount = query({
  args: {},
  handler: async (ctx) => {
    const today = getTodayDate();
    const messages = await ctx.db
      .query("loungeMessages")
      .withIndex("byDate", (q) => q.eq("date", today))
      .collect();

    return messages.length;
  },
});

// Internal mutation to clear old messages (called by cron)
export const clearOldMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = getTodayDate();
    
    // Get all messages that are NOT from today
    const oldMessages = await ctx.db
      .query("loungeMessages")
      .collect();

    let deletedCount = 0;
    for (const message of oldMessages) {
      if (message.date !== today) {
        await ctx.db.delete(message._id);
        deletedCount++;
      }
    }

    return { deletedCount };
  },
});

// Public mutation to save Vlad's bot response (called from API route)
export const saveBotMessage = mutation({
  args: { content: v.string() },
  handler: async (ctx, { content }) => {
    const today = getTodayDate();

    return await ctx.db.insert("loungeMessages", {
      userName: "Vlad",
      userImage: "/vlad.png",
      content: content.trim(),
      date: today,
      isBot: true,
    });
  },
});

// Query to get recent messages for context (for AI)
export const getRecentMessages = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 10 }) => {
    const today = getTodayDate();
    const messages = await ctx.db
      .query("loungeMessages")
      .withIndex("byDate", (q) => q.eq("date", today))
      .order("desc")
      .take(limit);

    return messages.reverse(); // Return in chronological order
  },
});

