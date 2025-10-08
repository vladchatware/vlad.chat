import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values"
import { authTables } from "@convex-dev/auth/server";

const schema = defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    stripeId: v.optional(v.string()),
    trialMessages: v.optional((v.number()))
  }).index("email", ["email"])
});

export default schema;
