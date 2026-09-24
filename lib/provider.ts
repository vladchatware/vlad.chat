export const PROVIDER_MODELS = [
  { id: "zai/glm-5.3-flash", name: "GLM 5.3 Flash" },
  { id: "anthropic/claude-fable-5.1", name: "Fable 5.1" },
  { id: "openai/gpt-5.6-luna", name: "GPT 5.6 Luna" },
  { id: "spacexai/grok-4.7", name: "Grok 4.7" },
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek 4.1" },
] as const;

export const PROVIDER_MODEL_IDS = new Set<string>(
  PROVIDER_MODELS.map((model) => model.id),
);

export const TOP_UP_PRICE_USD = 5;
export const TOP_UP_TOKENS = 16_666_666;
