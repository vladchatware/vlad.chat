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

interface MessageItemProps {
  message: any
  messageIndex: number
  messagesCount: number
  lastUserPrompt: string | null
  sendPrompt: (text: string) => Promise<void>
  submitStatus: 'ready' | 'submitted' | 'streaming'
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
  const parts = message.parts as Array<any>
  const hasRenderableContent = parts.some((part) => {
    if (part.type === 'source-url') {
      return false
    }
    if (part.type === 'text' || part.type === 'reasoning' || part.type === 'dynamic-tool') {
      return true
    }
    return typeof part.type === 'string' && part.type.startsWith('tool-')
  })
  const showMessageLoader =
    message.role === 'assistant' &&
    (message.status === 'pending' || message.status === 'streaming') &&
    !hasRenderableContent &&
    messageIndex === messagesCount - 1

  const renderToolPart = (part: any, partIndex: number) => {
    const rawToolName =
      part.toolName ??
      (typeof part.type === 'string' && part.type.startsWith('tool-')
        ? part.type.slice(5)
        : part.type)

    const toolDisplayName = rawToolName?.includes('tavily')
      ? 'Tavily'
      : rawToolName?.includes('notion')
        ? 'Notion'
        : rawToolName

    const output = (() => {
      const content = part?.output?.content
      if (Array.isArray(content)) {
        const text = content
          .filter((item: any) => item?.type === 'text')
          .map((item: any) => item.text)
          .join('\n')
          .trim()
        if (text) {
          return text
        }
      }
      return part.output
    })()

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
      {message.role === 'assistant' && parts.filter((part) => part.type === 'source-url').length > 0 && (
        <Sources>
          <SourcesTrigger
            count={
              parts.filter((part) => part.type === 'source-url').length
            }
          />
          {parts.filter((part) => part.type === 'source-url').map((part, i) => (
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
        switch (part.type) {
          case 'text':
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
          case 'reasoning':
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
          case 'dynamic-tool': {
            return renderToolPart(part, partIndex)
          }
          default:
            if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
              return renderToolPart(part, partIndex)
            }
            return null
        }
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
