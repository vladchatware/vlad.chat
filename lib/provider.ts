export const PROVIDER_MODELS = [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek 4" },
  { id: "anthropic/claude-fable-5", name: "Fable 5" },
  { id: "openai/gpt-5.6-sol", name: "GPT 5.6 Sol" },
  { id: "xai/grok-4.5", name: "Grok 4.5" },
] as const;

export const PROVIDER_MODEL_IDS = new Set<string>(
  PROVIDER_MODELS.map((model) => model.id),
);

export const TOP_UP_PRICE_USD = 5;
export const TOP_UP_TOKENS = 16_666_666;
