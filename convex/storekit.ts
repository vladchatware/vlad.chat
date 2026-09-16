import { decodeJwt, importPKCS8, SignJWT } from "jose";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

import { action, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const PRODUCTS = {
  "chat.vlad.tokens.5": 16_666_666,
} as const;

type ProductId = keyof typeof PRODUCTS;

type VerifiedTransaction = {
  transactionId: string;
  originalTransactionId: string;
  productId: ProductId;
  bundleId: string;
  purchaseDate: number;
  environment: string;
  revocationDate?: number;
};

const creditVerifiedPurchaseRef = makeFunctionReference<
  "mutation",
  {
    userId: Id<"users">;
    transactionId: string;
    originalTransactionId: string;
    productId: ProductId;
    tokens: number;
    purchasedAt: number;
    environment: string;
  },
  { tokensGranted: number; alreadyRedeemed: boolean }
>("storekit:creditVerifiedPurchase");

export const redeemTransaction = action({
  args: { transactionId: v.string() },
  returns: v.object({
    tokensGranted: v.number(),
    alreadyRedeemed: v.boolean(),
  }),
  handler: async (ctx, { transactionId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in to redeem a purchase.");
    const user = await ctx.runQuery(
      makeFunctionReference<"query", Record<string, never>, {
        isAnonymous?: boolean;
      } | null>("users:viewer"),
      {},
    );
    if (!user || user.isAnonymous) {
      throw new ConvexError("Link your Google account before purchasing credits.");
    }

    const transaction = await fetchVerifiedTransaction(transactionId);
    const expectedBundleId = requiredEnv("APPLE_BUNDLE_ID");
    if (transaction.transactionId !== transactionId) {
      throw new ConvexError("Apple returned a different transaction.");
    }
    if (transaction.bundleId !== expectedBundleId) {
      throw new ConvexError("Purchase belongs to a different app.");
    }
    if (!(transaction.productId in PRODUCTS)) {
      throw new ConvexError("Unknown StoreKit product.");
    }
    if (transaction.revocationDate !== undefined) {
      throw new ConvexError("This purchase was revoked.");
    }
    const tokens = PRODUCTS[transaction.productId];

    return ctx.runMutation(creditVerifiedPurchaseRef, {
      userId,
      transactionId: transaction.transactionId,
      originalTransactionId: transaction.originalTransactionId,
      productId: transaction.productId,
      tokens,
      purchasedAt: transaction.purchaseDate,
      environment: transaction.environment,
    });
  },
});

export const creditVerifiedPurchase = internalMutation({
  args: {
    userId: v.id("users"),
    transactionId: v.string(),
    originalTransactionId: v.string(),
    productId: v.string(),
    tokens: v.number(),
    purchasedAt: v.number(),
    environment: v.string(),
  },
  returns: v.object({
    tokensGranted: v.number(),
    alreadyRedeemed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("storeTransactions")
      .withIndex("transactionId", (query) =>
        query.eq("transactionId", args.transactionId)
      )
      .unique();
    if (existing) {
      if (existing.userId !== args.userId) {
        throw new ConvexError("Purchase was redeemed by another account.");
      }
      return { tokensGranted: 0, alreadyRedeemed: true };
    }

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError("Account no longer exists.");
    await ctx.db.insert("storeTransactions", args);
    await ctx.db.patch(args.userId, { tokens: (user.tokens ?? 0) + args.tokens });
    return { tokensGranted: args.tokens, alreadyRedeemed: false };
  },
});

async function fetchVerifiedTransaction(transactionId: string) {
  const token = await appStoreServerToken();
  const paths = [
    "https://api.storekit.itunes.apple.com",
    "https://api.storekit-sandbox.itunes.apple.com",
  ];
  for (const baseURL of paths) {
    const response = await fetch(
      `${baseURL}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (response.status === 404) continue;
    if (!response.ok) {
      throw new ConvexError(`Apple purchase verification failed (${response.status}).`);
    }
    const json = await response.json() as { signedTransactionInfo?: string };
    if (!json.signedTransactionInfo) {
      throw new ConvexError("Apple returned no signed transaction.");
    }
    const payload = decodeJwt(json.signedTransactionInfo) as Partial<VerifiedTransaction>;
    if (
      typeof payload.transactionId !== "string" ||
      typeof payload.originalTransactionId !== "string" ||
      typeof payload.productId !== "string" ||
      !(payload.productId in PRODUCTS) ||
      typeof payload.bundleId !== "string" ||
      typeof payload.purchaseDate !== "number" ||
      typeof payload.environment !== "string"
    ) {
      throw new ConvexError("Apple returned malformed transaction data.");
    }
    return payload as VerifiedTransaction;
  }
  throw new ConvexError("Apple could not find this transaction.");
}

async function appStoreServerToken() {
  const privateKey = requiredEnv("APPLE_PRIVATE_KEY").replaceAll("\\n", "\n");
  const key = await importPKCS8(privateKey, "ES256");
  return new SignJWT({ bid: requiredEnv("APPLE_BUNDLE_ID") })
    .setProtectedHeader({ alg: "ES256", kid: requiredEnv("APPLE_KEY_ID"), typ: "JWT" })
    .setIssuer(requiredEnv("APPLE_ISSUER_ID"))
    .setAudience("appstoreconnect-v1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new ConvexError(`${name} is not configured.`);
  return value;
}
