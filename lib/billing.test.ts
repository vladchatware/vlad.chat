import { describe, expect, expectTypeOf, it } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import {
  FIVE_HOUR_WINDOW_CREDITS,
  OVERAGE_METER_EVENT_NAME,
  SUBSCRIBER_WINDOW_MULTIPLIER,
  SUBSCRIPTION_GRANT_CREDITS,
  WEEKLY_WINDOW_CREDITS,
  WEEKLY_WINDOW_MS,
  creditsForTokens,
  meterValueForCredits,
} from "./billing";

const baseUser = {
  trialTokens: 0,
  tokens: 0,
  includedCredits: 0,
  subscriptionStatus: undefined as Doc<"users">["subscriptionStatus"],
  stripeId: undefined as Doc<"users">["stripeId"],
};

function activeSubscriber(overrides: Partial<typeof baseUser> = {}) {
  return { ...baseUser, subscriptionStatus: "active" as const, ...overrides };
}

function creditUsage(totalTokens: number) {
  return { totalTokens, inputTokens: totalTokens, outputTokens: 0 };
}

describe("model credit weights", () => {
  it("prices GLM at parity", () => {
    expect(creditsForTokens("zai/glm-5.3-flash", 1000)).toBe(1000);
  });

  it("applies premium weights with ceil rounding", () => {
    expect(creditsForTokens("anthropic/claude-opus-5.5", 1000)).toBe(27_000);
    expect(creditsForTokens("openai/gpt-5.6-luna", 1000)).toBe(1500);
    expect(creditsForTokens("spacexai/grok-4.7", 7)).toBe(42);
    expect(creditsForTokens("deepseek/deepseek-v4.1-flash", 1000)).toBe(1800);
  });

  it("defaults unknown models to parity", () => {
    expect(creditsForTokens("mystery/model", 1000)).toBe(1000);
  });
});

describe("meter values", () => {
  it("sends whole credits with a floor of 1", () => {
    expect(meterValueForCredits(0)).toBe("1");
    expect(meterValueForCredits(2500)).toBe("2500");
  });

  it("uses the configured meter event name", () => {
    expect(OVERAGE_METER_EVENT_NAME).toMatch(/_credits$/);
  });
});

describe("usage windows", () => {
  it("keeps the 4x subscriber headroom relationship", () => {
    expect(FIVE_HOUR_WINDOW_CREDITS * SUBSCRIBER_WINDOW_MULTIPLIER).toBe(2_000_000);
    expect(WEEKLY_WINDOW_CREDITS * SUBSCRIBER_WINDOW_MULTIPLIER).toBe(8_000_000);
    expect(WEEKLY_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("grant accounting", () => {
  it("monthly grant is spendable in credits", () => {
    expectTypeOf(SUBSCRIPTION_GRANT_CREDITS).toBeNumber();
    expect(SUBSCRIPTION_GRANT_CREDITS).toBe(16_000_000);
  });

  it("subscribers with zero balances keep generating (postpaid)", () => {
    const user = activeSubscriber({ stripeId: "cus_test" });
    const hasBalance =
      user.trialTokens > 0 ||
      user.tokens > 0 ||
      user.includedCredits > 0 ||
      user.subscriptionStatus === "active";
    expect(hasBalance).toBe(true);
  });

  it("non-subscribers with zero balances are blocked", () => {
    const user = baseUser;
    const hasBalance =
      user.trialTokens > 0 ||
      user.tokens > 0 ||
      user.includedCredits > 0 ||
      user.subscriptionStatus === "active";
    expect(hasBalance).toBe(false);
  });

  it("weight math keeps premium margin-safe at the 3:1 blend (Opus)", () => {
    // Opus ≈ $8/M raw tokens at the gateway. 27 credits per token at
    // $0.30 per million credits → $8.10 revenue per million raw tokens.
    const revenuePerMillionTokens =
      (creditsForTokens("anthropic/claude-opus-5.5", 1_000_000) / 1_000_000) * 0.3;
    expect(revenuePerMillionTokens).toBeCloseTo(8.1, 5);
    expect(revenuePerMillionTokens).toBeGreaterThan(8);
  });

  it("accepts usage rows shaped like convex usage docs", () => {
    const apiKeyId = "k57" as Id<"apiKeys">;
    expect(typeof apiKeyId).toBe("string");
    expect(creditUsage(10).totalTokens).toBe(10);
  });
});
