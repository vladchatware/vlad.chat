// Subscription + metered-overage billing constants.
//
// Model: $5/mo subscription includes a 16M credit monthly grant and unlocks
// premium models. Usage beyond the grant is postpaid: metered credits are
// queued in Convex, drained to Stripe meter events, and invoiced monthly at
// $0.30 per million credits. Prepaid top-ups remain for non-subscribers.

export const SUBSCRIPTION_PRICE_NICKNAME = "vladchat-monthly";
export const OVERAGE_PRICE_NICKNAME = "vladchat-overage-metered";
export const OVERAGE_METER_EVENT_NAME = "vladchat_overage_credits";

export const SUBSCRIPTION_PRICE_USD = 5;
export const SUBSCRIPTION_GRANT_CREDITS = 16_000_000;
export const OVERAGE_PRICE_PER_MILLION_CREDITS_USD = 0.3;

// Usage windows (apply to signed-in users; subscribers get 4x headroom).
export const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const FIVE_HOUR_WINDOW_CREDITS = 500_000;
export const WEEKLY_WINDOW_CREDITS = 2_000_000;
export const SUBSCRIBER_WINDOW_MULTIPLIER = 4;

// Credits burned per raw token for each model. Weights are chosen so revenue
// stays ahead of AI Gateway cost at a typical 3:1 input:output blend
// (see skill reference pricing-margins.md). Unknown models default to 1.
export const MODEL_CREDIT_WEIGHTS: Record<string, number> = {
  "zai/glm-5.3-flash": 1,
  "openai/gpt-5.6-luna": 1.5,
  "deepseek/deepseek-v4.1-flash": 1.8,
  "spacexai/grok-4.7": 6,
  "anthropic/claude-opus-5.5": 27,
};

const DEFAULT_CREDIT_WEIGHT = 1;

export function creditWeightForModel(modelId: string): number {
  return MODEL_CREDIT_WEIGHTS[modelId] ?? DEFAULT_CREDIT_WEIGHT;
}

export function creditsForTokens(modelId: string, totalTokens: number): number {
  return Math.ceil(totalTokens * creditWeightForModel(modelId));
}

// Stripe meter events carry whole credits; the metered price multiplies by
// unit_amount_decimal ($0.30 per 1M credits) so invoice lines land on cents.
export function meterValueForCredits(credits: number): string {
  return String(Math.max(1, Math.ceil(credits)));
}
