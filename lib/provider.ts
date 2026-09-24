export const PROVIDER_MODELS = [
  { id: "zai/glm-5.3-flash", name: "GLM 5.3 Flash", enabled: true },
  { id: "anthropic/claude-opus-5.5", name: "Opus 5.5", enabled: false },
  { id: "openai/gpt-5.6-luna", name: "GPT 5.6 Luna", enabled: false },
  { id: "spacexai/grok-4.7", name: "Grok 4.7", enabled: false },
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek 4.1", enabled: false },
] as const;

export type ProviderModel = (typeof PROVIDER_MODELS)[number];

export const PROVIDER_MODELS_ENABLED: ProviderModel[] = PROVIDER_MODELS.filter(
  (model) => model.enabled,
);

export function isModelEnabled(modelId: string): boolean {
  return PROVIDER_MODELS.some(
    (model) => model.id === modelId && model.enabled,
  );
}

export const PROVIDER_MODEL_IDS = new Set<string>(
  PROVIDER_MODELS.map((model) => model.id),
);

export const TOP_UP_PRICE_USD = 5;
export const TOP_UP_TOKENS = 16_666_666;
