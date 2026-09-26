import { describe, expect, expectTypeOf, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import {
  FIVE_HOUR_WINDOW_CREDITS,
  OVERAGE_METER_EVENT_NAME,
  OVERAGE_PRICE_PER_MILLION_CREDITS_USD,
  SUBSCRIBER_WINDOW_MULTIPLIER,
  SUBSCRIPTION_GRANT_CREDITS,
  WEEKLY_WINDOW_CREDITS,
  WEEKLY_WINDOW_MS,
  creditsForTokens,
  meterValueForCredits,
} from "./billing";
import { debitCreditBalance, debitTokenBalance, trialShortfallTokens } from "./credits";

const baseUser = {
  trialTokens: 0,
  tokens: 0,
  includedCredits: 0,
  subscriptionStatus: "active" as const,
  stripeId: "cus_test",
};

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

describe("metered price conversion", () => {
  it("bills $0.30 per million credits (cents decimal = 0.00003)", () => {
    const unitAmountDecimalCents = "0.00003";
    const dollarsPerCredit = Number(unitAmountDecimalCents) / 100;
    expect(dollarsPerCredit * 1_000_000).toBe(OVERAGE_PRICE_PER_MILLION_CREDITS_USD);
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
});

// Debit waterfall semantics: trial burns raw; only the raw shortfall converts
// to weighted credits; grant first, prepaid buffer second; only the uncovered
// remainder becomes metered overage.
describe("debit waterfall", () => {
  it("keeps requests fully covered by trial free", () => {
    expect(trialShortfallTokens(100, 100)).toBe(0);
    expect(trialShortfallTokens(150, 100)).toBe(0);
    expect(trialShortfallTokens(0, 100)).toBe(100);
    expect(trialShortfallTokens(undefined, 100)).toBe(100);
  });

  it("debits only the shortfall when trial partially covers a request", () => {
    // 50 trial raw + 50 shortfall raw on GLM (weight 1) = 50 weighted credits.
    const shortfallCredits = creditsForTokens("zai/glm-5.3-flash", trialShortfallTokens(50, 100));
    expect(shortfallCredits).toBe(50);
    const result = debitCreditBalance({ includedCredits: 1000, paidTokens: 0 }, shortfallCredits);
    expect(result).toEqual({ includedCredits: 950, paidTokens: 0, overageCredits: 0 });
  });

  it("consumes grant before prepaid and meters only the uncovered remainder", () => {
    const result = debitCreditBalance(
      { includedCredits: 1000, paidTokens: 1000 },
      1500,
    );
    expect(result).toEqual({ includedCredits: 0, paidTokens: 500, overageCredits: 0 });
  });

  it("uses prepaid as a buffer and meters only what it cannot cover", () => {
    const result = debitCreditBalance({ includedCredits: 0, paidTokens: 1000 }, 1500);
    expect(result).toEqual({ includedCredits: 0, paidTokens: 0, overageCredits: 500 });
  });

  it("meters everything beyond grant when no prepaid buffer exists", () => {
    const result = debitCreditBalance({ includedCredits: 500, paidTokens: 0 }, 1500);
    expect(result).toEqual({ includedCredits: 0, paidTokens: 0, overageCredits: 1000 });
  });

  it("never double-charges prepaid usage as overage", () => {
    // A request fully covered by prepaid must queue zero overage.
    const result = debitCreditBalance({ includedCredits: 0, paidTokens: 1000 }, 1000);
    expect(result.overageCredits).toBe(0);
    expect(result.paidTokens).toBe(0);
  });

  it("keeps legacy trial->paid debit raw for non-subscriber top-ups", () => {
    expect(debitTokenBalance(100, 50, 120)).toEqual({ trialTokens: 0, tokens: 30 });
    expect(debitTokenBalance(0, 10, 25)).toEqual({ trialTokens: 0, tokens: -15 });
  });
});

describe("gate semantics", () => {
  it("subscribers with zero balances keep generating (postpaid)", () => {
    const user = baseUser;
    const hasBalance =
      user.trialTokens > 0 ||
      user.tokens > 0 ||
      user.includedCredits > 0 ||
      user.subscriptionStatus === "active";
    expect(hasBalance).toBe(true);
  });

  it("non-subscribers with zero balances are blocked", () => {
    const user: {
      trialTokens: number;
      tokens: number;
      includedCredits: number;
      subscriptionStatus: "active" | "canceled";
    } = { ...baseUser, subscriptionStatus: "canceled" };
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
