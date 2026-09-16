import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous"
import Google from "@auth/core/providers/google"
import { MutationCtx } from "./_generated/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Anonymous, Google],
  callbacks: {
    async redirect({ redirectTo }) {
      if (redirectTo.startsWith("vladchat://")) return redirectTo;
      const siteUrl = process.env.SITE_URL;
      if (siteUrl && redirectTo.startsWith(siteUrl)) return redirectTo;
      throw new Error("Invalid authentication redirect URL");
    },
    async afterUserCreatedOrUpdated(ctx: MutationCtx, { userId }) {
      const user = await ctx.db.get(userId);
      if (!user) return;
      await ctx.db.patch(userId, {
        trialMessages: user.trialMessages ?? 10,
        trialTokens: user.trialTokens ?? 16000000,
        tokens: user.tokens ?? 0,
      })
    }
  }
});
