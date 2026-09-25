import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { bearerToken, digestApiKey, generateApiKey } from "@/lib/api-key";

describe("provider API keys", () => {
  it("generates unique high-entropy bearer secrets", () => {
    const keys = Array.from({ length: 50 }, () => generateApiKey());
    expect(new Set(keys.map((key) => key.secret)).size).toBe(keys.length);
    for (const key of keys) {
      expect(key.secret).toMatch(/^vlad_[A-Za-z0-9_-]{43}$/);
      expect(key.prefix).toBe(key.secret.slice(0, 13));
      expect(key.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(key.digest).not.toContain(key.secret);
    }
  });

  it("hashes same secret deterministically", () => {
    const secret = "vlad_example";
    expect(digestApiKey(secret)).toBe(digestApiKey(secret));
  });

  it("accepts one Bearer credential and rejects malformed authorization", () => {
    expect(bearerToken(new Request("https://vlad.chat", {
      headers: { authorization: "Bearer vlad_example" },
    }))).toBe("vlad_example");
    expect(bearerToken(new Request("https://vlad.chat", {
      headers: { authorization: "Bearer first second" },
    }))).toBeNull();
  });
});
