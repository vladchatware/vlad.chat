export type ChatSubmitStatus = 'ready' | 'submitted' | 'streaming'

export interface ChatTextPart {
  type: 'text'
  text: string
}

export interface ChatReasoningPart {
  type: 'reasoning'
  text: string
}

export interface ChatSourceUrlPart {
  type: 'source-url'
  url: string
}

export interface ChatToolOutputItem {
  type: string
  text?: string
}

export interface ChatToolPart {
  type: 'dynamic-tool' | `tool-${string}`
  toolName?: string
  state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  input?: object
  output?: object
  errorText?: string
}

export interface ChatUnknownPart {
  type: string
  [key: string]: string | number | boolean | null | object | undefined
}

export type ChatMessagePart =
  | ChatTextPart
  | ChatReasoningPart
  | ChatSourceUrlPart
  | ChatToolPart
  | ChatUnknownPart

export interface ChatMessage {
  order: number | string
  stepOrder: number | string
  role: 'assistant' | 'user' | 'system'
  status?: 'pending' | 'streaming' | string
  parts: ChatMessagePart[]
}

export function isTextPart(part: ChatMessagePart): part is ChatTextPart {
  return part.type === 'text'
}

export function isReasoningPart(part: ChatMessagePart): part is ChatReasoningPart {
  return part.type === 'reasoning'
}

export function isSourceUrlPart(part: ChatMessagePart): part is ChatSourceUrlPart {
  return part.type === 'source-url'
}

export function isToolPart(part: ChatMessagePart): part is ChatToolPart {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-')
}

export function extractToolOutputText(part: ChatToolPart) {
  const content = part.output && 'content' in part.output
    ? (part.output.content as ChatToolOutputItem[] | undefined)
    : undefined

  if (Array.isArray(content)) {
    const text = content
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n')
      .trim()

    if (text) {
      return text
    }
  }

  return part.output
}
