'use client';

import { Fragment } from 'react'
import { motion } from 'motion/react'
import { CopyIcon, RefreshCcwIcon } from 'lucide-react'
import { Message, MessageContent } from '@/components/ai-elements/message'
import { Response } from '@/components/ai-elements/response'
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/source'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import { Action, Actions } from '@/components/ai-elements/actions'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  ChatMessage,
  ChatSubmitStatus,
  ChatToolPart,
  extractToolOutputText,
  isReasoningPart,
  isSourceUrlPart,
  isTextPart,
  isToolPart,
} from '@/components/chat/types'

interface MessageItemProps {
  message: ChatMessage
  messageIndex: number
  messagesCount: number
  lastUserPrompt: string | null
  sendPrompt: (text: string) => Promise<void>
  submitStatus: ChatSubmitStatus
}

export function MessageItem({
  message,
  messageIndex,
  messagesCount,
  lastUserPrompt,
  sendPrompt,
  submitStatus,
}: MessageItemProps) {
  const messageKey = `${message.order}-${message.stepOrder}`
  const parts = message.parts
  const hasRenderableContent = parts.some((part) => {
    if (isSourceUrlPart(part)) {
      return false
    }
    if (isTextPart(part) || isReasoningPart(part) || isToolPart(part)) {
      return true
    }
    return false
  })
  const showMessageLoader =
    message.role === 'assistant' &&
    (message.status === 'pending' || message.status === 'streaming') &&
    !hasRenderableContent &&
    messageIndex === messagesCount - 1

  const renderToolPart = (part: ChatToolPart, partIndex: number) => {
    const rawToolName =
      part.toolName ??
      (part.type.startsWith('tool-')
        ? part.type.slice(5)
        : part.type)

    const toolDisplayName = rawToolName?.includes('tavily')
      ? 'Tavily'
      : rawToolName?.includes('notion')
        ? 'Notion'
      : rawToolName

    const output = extractToolOutputText(part)

    return (
      <Tool key={`${messageKey}-${partIndex}`} defaultOpen={false}>
        <ToolHeader
          title={toolDisplayName}
          type={part.type}
          state={part.state ?? 'input-available'}
        />
        <ToolContent>
          <ToolInput input={part.input} />
          <ToolOutput output={output} errorText={part.errorText} />
        </ToolContent>
      </Tool>
    )
  }

  return (
    <motion.div
      key={messageKey}
      className={messagesCount - 1 === messageIndex ? 'pb-46' : ''}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: 0.22,
        ease: 'easeOut',
      }}
    >
      {message.role === 'assistant' && parts.filter((part) => isSourceUrlPart(part)).length > 0 && (
        <Sources>
          <SourcesTrigger
            count={
              parts.filter((part) => isSourceUrlPart(part)).length
            }
          />
          {parts.filter((part) => isSourceUrlPart(part)).map((part, i) => (
            <SourcesContent key={`${messageKey}-${i}`}>
              <Source
                key={`${messageKey}-${i}`}
                href={part.url}
                title={part.url}
              />
            </SourcesContent>
          ))}
        </Sources>
      )}
      {parts.map((part, partIndex) => {
        if (isTextPart(part)) {
          return (
            <Fragment key={`${messageKey}-${partIndex}`}>
              <Message from={message.role}>
                <MessageContent>
                  <Response>
                    {part.text}
                  </Response>
                </MessageContent>
              </Message>
              {message.role === 'assistant' &&
                messageIndex === messagesCount - 1 &&
                partIndex === parts.length - 1 && (
                  <Actions className="-mt-3">
                    <Action
                      onClick={() => {
                        if (lastUserPrompt) {
                          void sendPrompt(lastUserPrompt)
                        }
                      }}
                      label="Retry"
                    >
                      <RefreshCcwIcon className="size-3" />
                    </Action>
                    <Action
                      onClick={() =>
                        navigator.clipboard.writeText(part.text)
                      }
                      label="Copy"
                    >
                      <CopyIcon className="size-3" />
                    </Action>
                  </Actions>
                )}
            </Fragment>
          )
        }

        if (isReasoningPart(part)) {
          return (
            <Reasoning
              key={`${messageKey}-${partIndex}`}
              className="w-full"
              isStreaming={
                submitStatus === 'streaming' &&
                partIndex === parts.length - 1 &&
                messageIndex === messagesCount - 1
              }
            >
              <ReasoningTrigger />
              <ReasoningContent>{part.text}</ReasoningContent>
            </Reasoning>
          )
        }

        if (isToolPart(part)) {
          return renderToolPart(part, partIndex)
        }

        return null
      })}
      {showMessageLoader && (
        <Message from="assistant">
          <MessageContent className="text-muted-foreground">
            <Shimmer as="span" duration={1.5} spread={1.5} className="text-sm">
              Thinking...
            </Shimmer>
          </MessageContent>
        </Message>
      )}
    </motion.div>
  )
}
