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
