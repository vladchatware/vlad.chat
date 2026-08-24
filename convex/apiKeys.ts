"use node";

import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { generateApiKey } from "../lib/api-key-secret";

export const create = action({
  args: { name: v.string() },
  returns: v.object({ apiKey: v.string() }),
  handler: async (ctx, { name }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in to continue.");

    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 80) {
      throw new ConvexError("API key name must be between 1 and 80 characters.");
    }

    const generated = generateApiKey();
    await ctx.runMutation(internal.users.createApiKey, {
      userId,
      name: normalizedName,
      prefix: generated.prefix,
      digest: generated.digest,
    });
    return { apiKey: generated.secret };
  },
});
