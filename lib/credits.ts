export type TokenUsage = {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    noCacheTokens?: number;
  };
  outputTokenDetails?: { reasoningTokens?: number; textTokens?: number };
  raw?: unknown;
};

export function normalizeUsage(usage: TokenUsage) {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
  for (const tokens of [inputTokens, outputTokens, totalTokens]) {
    if (!Number.isSafeInteger(tokens) || tokens < 0) {
      throw new RangeError("Token usage must contain non-negative safe integers.");
    }
  }
  return {
    ...usage,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function debitTokenBalance(
  trialTokens: number | undefined,
  paidTokens: number | undefined,
  usageTokens: number,
) {
  const trial = Math.max(0, trialTokens ?? 0);
  const paid = Math.max(0, paidTokens ?? 0);
  const remainingTrial = trial - usageTokens;
  if (remainingTrial >= 0) return { trialTokens: remainingTrial, tokens: paid };
  return { trialTokens: 0, tokens: paid - Math.abs(remainingTrial) };
}

// Raw tokens a weekly/daily trial balance could not cover. Requests that fit
// inside the trial are free; only the shortfall converts to weighted credits.
export function trialShortfallTokens(
  trialTokens: number | undefined,
  usageTokens: number,
): number {
  const trial = Math.max(0, trialTokens ?? 0);
  return Math.max(0, usageTokens - trial);
}

// Weighted-credit phase of the debit waterfall: consume the subscription
// grant first, then prepaid top-up credits; whatever remains becomes metered
// overage (subscribers) or drives the paid balance negative (legacy
// draw-down marker for non-subscribers).
export function debitCreditBalance(
  balances: { includedCredits: number | undefined; paidTokens: number | undefined },
  credits: number,
) {
  const includedCredits = Math.max(0, balances.includedCredits ?? 0);
  const paidTokens = Math.max(0, balances.paidTokens ?? 0);
  const fromIncluded = Math.min(includedCredits, credits);
  const remainingAfterIncluded = credits - fromIncluded;
  const fromPaid = Math.min(paidTokens, remainingAfterIncluded);
  return {
    includedCredits: includedCredits - fromIncluded,
    paidTokens: paidTokens - fromPaid,
    overageCredits: remainingAfterIncluded - fromPaid,
  };
}
