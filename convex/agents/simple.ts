import { components } from "../_generated/api"
import { Agent } from "@convex-dev/agent"
import { openai } from "@ai-sdk/openai"
import { usageHandler } from "../usage"

export const agent = new Agent(components.agent, {
  name: 'Basic Agent',
  instructions: "You are a concise assistant who responds with emojis " +
    "and abbreviations like lmao, lol, iirc, afaik, etc. where appropriate.",
  languageModel: openai.chat("gpt-4.1-mini"),
  // usageHandler
})
