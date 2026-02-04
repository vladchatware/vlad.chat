import { components } from "../_generated/api"
import { Agent } from "@convex-dev/agent"
import { gateway, generateText } from "ai"
import { chatSystemInstructions } from "./prompts"
// import { usageHandler } from "../usage"

const DEFAULT_GATEWAY_MODEL = "moonshotai/kimi-k2.5"
const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small"
const DEFAULT_SUMMARY_MODEL = "moonshotai/kimi-k2.5"

const MAX_CONTEXT_CHARS = 24000
const KEEP_RECENT_MESSAGES = 24
const MIN_MESSAGES_TO_SUMMARIZE = 30

function messageToText(message: any) {
  const content = message.content
  if (typeof content === "string") {
    return content
  }
  if (!Array.isArray(content)) {
    return ""
  }
  return content
    .map((part) => {
      if (part.type === "text") {
        return part.text
      }
      if (part.type === "tool-call") {
        return `[tool-call:${part.toolName}]`
      }
      if (part.type === "tool-result") {
        return `[tool-result:${part.toolName}]`
      }
      if (part.type === "reasoning") {
        return part.text
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

function contextSize(messages: any[]) {
  return messages.reduce((total, message) => total + messageToText(message).length, 0)
}

async function compactContext(allMessages: any[]) {
  if (
    allMessages.length < MIN_MESSAGES_TO_SUMMARIZE ||
    contextSize(allMessages) <= MAX_CONTEXT_CHARS
  ) {
    return allMessages
  }

  const splitAt = Math.max(allMessages.length - KEEP_RECENT_MESSAGES, 1)
  const toSummarize = allMessages.slice(0, splitAt)
  const recent = allMessages.slice(splitAt)
  const transcript = toSummarize
    .map((message) => `${message.role.toUpperCase()}: ${messageToText(message)}`)
    .join("\n")

  try {
    const { text } = await generateText({
      model: gateway.languageModel(DEFAULT_SUMMARY_MODEL),
      prompt:
        "Summarize the conversation history for continued assistant use. " +
        "Keep concrete user preferences, constraints, decisions, open questions, and commitments. " +
        "Do not add facts. Keep it compact.\n\n" +
        transcript,
    })

    return [
      {
        role: "system",
        content:
          "Compacted conversation summary (use as context, not user-visible):\n" +
          text.trim(),
      },
      ...recent,
    ]
  } catch {
    return recent
  }
}

export const agent = new Agent(components.agent, {
  name: 'Vlad',
  instructions: chatSystemInstructions,
  languageModel: gateway.languageModel(DEFAULT_GATEWAY_MODEL),
  textEmbeddingModel: gateway.embeddingModel(DEFAULT_EMBEDDING_MODEL),
  contextOptions: {
    recentMessages: 100,
    searchOptions: {
      limit: 0,
      vectorSearch: false,
      textSearch: false,
    },
  },
  contextHandler: async (_ctx, { allMessages }) => compactContext(allMessages as any[]),
  // usageHandler
})
