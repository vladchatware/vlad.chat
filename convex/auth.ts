import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous"
import Google from "@auth/core/providers/google"
import { MutationCtx } from "./_generated/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Anonymous, Google],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx: MutationCtx, { userId }) {
      await ctx.db.patch(userId, { trialMessages: 10, trialTokens: 16000000, tokens: 0 })
    }
  }
});
