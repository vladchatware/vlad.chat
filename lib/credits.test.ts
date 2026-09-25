import { describe, expect, it } from "vitest";

import { debitTokenBalance, normalizeUsage } from "@/lib/credits";

describe("credit accounting", () => {
  it("derives total usage when provider omits it", () => {
    expect(normalizeUsage({ inputTokens: 10, outputTokens: 4 })).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
    });
  });

  it("normalizes missing token fields to zero", () => {
    expect(normalizeUsage({})).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });

  it("rejects negative usage before it can increase a balance", () => {
    expect(() => normalizeUsage({ totalTokens: -1 })).toThrow(RangeError);
  });

  it("uses trial credits before paid credits", () => {
    expect(debitTokenBalance(100, 50, 120)).toEqual({
      trialTokens: 0,
      tokens: 30,
    });
  });

  it("preserves post-response overspend behavior", () => {
    expect(debitTokenBalance(0, 10, 25)).toEqual({
      trialTokens: 0,
      tokens: -15,
    });
  });
});
