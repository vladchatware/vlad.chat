import { convexTest } from "convex-test";
import { exportPKCS8, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = {
  "./storekit.ts": () => import("./storekit"),
  "./users.ts": () => import("./users"),
  "./_generated/server.ts": () => import("./_generated/server"),
};
const transactionId = "2000000000000001";
const tokensPerPack = 16_666_666;
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let testPrivateKey: string;
const fetchMock = vi.fn<typeof fetch>();

async function account() {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: false, tokens: 0 }));
  return { t, id, auth: t.withIdentity({ subject: `${id}|session` }) };
}

async function appleTransaction(environment: "Production" | "Sandbox") {
  const signedTransactionInfo = await new SignJWT({
    transactionId,
    originalTransactionId: transactionId,
    productId: "chat.vlad.tokens.5",
    bundleId: "chat.vlad.ios",
    purchaseDate: 1_790_000_000_000,
    environment,
  }).setProtectedHeader({ alg: "ES256" }).sign(signingKey);
  return Response.json({ signedTransactionInfo });
}

beforeAll(async () => {
  const keys = await generateKeyPair("ES256", { extractable: true });
  signingKey = keys.privateKey;
  testPrivateKey = await exportPKCS8(signingKey);
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("APPLE_PRIVATE_KEY", testPrivateKey);
  vi.stubEnv("APPLE_KEY_ID", "TESTKEY123");
  vi.stubEnv("APPLE_ISSUER_ID", "test-issuer");
  vi.stubEnv("APPLE_BUNDLE_ID", "chat.vlad.ios");
  vi.stubEnv("ALLOW_XCODE_STOREKIT_REDEMPTION", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("StoreKit transaction environment routing", () => {
  it("credits a sandbox purchase without contacting production", async () => {
    const { t, id, auth } = await account();
    fetchMock.mockResolvedValue(await appleTransaction("Sandbox"));

    await expect(auth.action(api.storekit.redeemTransaction, {
      transactionId, environment: "Sandbox",
    })).resolves.toEqual({ tokensGranted: tokensPerPack, alreadyRedeemed: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.storekit-sandbox.apple.com/inApps/v1/transactions/${transactionId}`);
    expect(await t.run(async (ctx) => (await ctx.db.get(id))?.tokens)).toBe(tokensPerPack);
  });

  it("lets older clients reach sandbox after production denies the same JWT", async () => {
    const { auth } = await account();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    fetchMock.mockResolvedValueOnce(await appleTransaction("Sandbox"));

    await expect(auth.action(api.storekit.redeemTransaction, { transactionId }))
      .resolves.toEqual({ tokensGranted: tokensPerPack, alreadyRedeemed: false });
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname))
      .toEqual(["api.storekit.apple.com", "api.storekit-sandbox.apple.com"]);
  });

  it("keeps explicit production authorization failures from granting credits", async () => {
    const { t, id, auth } = await account();
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await expect(auth.action(api.storekit.redeemTransaction, {
      transactionId, environment: "Production",
    })).rejects.toThrow(/Production.*401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await t.run(async (ctx) => (await ctx.db.get(id))?.tokens)).toBe(0);
  });

  it("rejects a response from the wrong transaction environment", async () => {
    const { t, id, auth } = await account();
    fetchMock.mockResolvedValue(await appleTransaction("Production"));

    await expect(auth.action(api.storekit.redeemTransaction, {
      transactionId, environment: "Sandbox",
    })).rejects.toThrow(/malformed transaction/);
    expect(await t.run(async (ctx) => (await ctx.db.get(id))?.tokens)).toBe(0);
  });

  it("credits an Apple transaction only once when redemption is retried", async () => {
    const { t, id, auth } = await account();
    fetchMock.mockImplementation(async () => appleTransaction("Sandbox"));
    const args = { transactionId, environment: "Sandbox" as const };

    await auth.action(api.storekit.redeemTransaction, args);
    await expect(auth.action(api.storekit.redeemTransaction, args))
      .resolves.toEqual({ tokensGranted: 0, alreadyRedeemed: true });
    expect(await t.run(async (ctx) => (await ctx.db.get(id))?.tokens)).toBe(tokensPerPack);
    expect(await t.run(async (ctx) => (await ctx.db.query("storeTransactions").collect()).length)).toBe(1);
  });
});

describe("Xcode development crediting", () => {
  const localTransaction = {
    transactionId: "1", originalTransactionId: "1",
    productId: "chat.vlad.tokens.5", purchasedAt: 1_790_000_000_000,
  };

  it("requires the deployment flag before granting test credits", async () => {
    const { t, id, auth } = await account();
    await expect(auth.action(api.storekit.redeemXcodeTransaction, localTransaction))
      .rejects.toThrow(/disabled on this deployment/);
    expect(await t.run(async (ctx) => (await ctx.db.get(id))?.tokens)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("grants a local development purchase only once without Apple API calls", async () => {
    vi.stubEnv("ALLOW_XCODE_STOREKIT_REDEMPTION", "true");
    const { t, id, auth } = await account();
    await expect(auth.action(api.storekit.redeemXcodeTransaction, localTransaction))
      .resolves.toEqual({ tokensGranted: tokensPerPack, alreadyRedeemed: false });
    await expect(auth.action(api.storekit.redeemXcodeTransaction, localTransaction))
      .resolves.toEqual({ tokensGranted: 0, alreadyRedeemed: true });
    expect(await t.run(async (ctx) => (await ctx.db.get(id))?.tokens)).toBe(tokensPerPack);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
