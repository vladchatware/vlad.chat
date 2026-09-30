import { afterEach, describe, expect, it, vi } from "vitest";
import { canUseCodeMode, signCodeModeGrant, verifyCodeModeGrant } from "./code-mode";

describe("computer-use Code Mode grants", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows anonymous Code Mode in local development and Vercel previews", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(canUseCodeMode(true)).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(canUseCodeMode(true)).toBe(true);
  });

  it("keeps anonymous Code Mode disabled in production while allowing signed-in users", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");

    expect(canUseCodeMode(true)).toBe(false);
    expect(canUseCodeMode(false)).toBe(true);
  });

  it("round-trips the signed-in owner, sandbox, and thread", async () => {
    vi.stubEnv("COMPUTER_USE_AUTH_SECRET", "code-mode-test-secret-0123456789abcdef");
    const grant = {
      userId: "user_123",
      sessionKey: "user_123",
      threadId: "thread_456",
      isAnonymous: false,
    };

    await expect(signCodeModeGrant(grant).then(verifyCodeModeGrant)).resolves.toEqual(grant);
  });

  it("rejects a tampered grant", async () => {
    vi.stubEnv("COMPUTER_USE_AUTH_SECRET", "code-mode-test-secret-0123456789abcdef");
    const token = await signCodeModeGrant({
      userId: "user_123",
      sessionKey: "user_123",
      threadId: "thread_456",
      isAnonymous: false,
    });
    const parts = token.split(".");
    parts[2] = "A".repeat(parts[2].length);

    await expect(verifyCodeModeGrant(parts.join("."))).resolves.toBeNull();
  });

  it("refuses to mint grants with a short secret", async () => {
    vi.stubEnv("COMPUTER_USE_AUTH_SECRET", "too-short");

    await expect(signCodeModeGrant({
      userId: "user_123",
      sessionKey: "user_123",
      threadId: "thread_456",
      isAnonymous: false,
    })).rejects.toThrow("COMPUTER_USE_AUTH_SECRET");
  });
});
