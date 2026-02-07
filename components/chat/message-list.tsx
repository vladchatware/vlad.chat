'use client';

import { AnimatePresence } from 'motion/react'
import { Loader } from '@/components/ai-elements/loader'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { MessageItem } from '@/components/chat/message-item'
import { ChatMessage, ChatSubmitStatus } from '@/components/chat/types'

interface MessageListProps {
  isLoadingMore: boolean
  lastUserPrompt: string | null
  messages: ChatMessage[] | undefined
  paginationStatus: string
  sendPrompt: (text: string) => Promise<void>
  showBottomLoader: boolean
  submitStatus: ChatSubmitStatus
}

export function MessageList({
  isLoadingMore,
  lastUserPrompt,
  messages,
  paginationStatus,
  sendPrompt,
  showBottomLoader,
  submitStatus,
}: MessageListProps) {
  return (
    <>
      {isLoadingMore && (
        <div className="flex justify-center py-4">
          <Loader />
        </div>
      )}
      {paginationStatus === 'CanLoadMore' && !isLoadingMore && (
        <div className="flex justify-center py-2">
          <span className="text-xs text-muted-foreground">Scroll up to load more</span>
        </div>
      )}
      <AnimatePresence initial={false}>
        {(messages ?? []).map((message, messageIndex) => (
          <MessageItem
            key={`${message.order}-${message.stepOrder}`}
            message={message}
            messageIndex={messageIndex}
            messagesCount={(messages ?? []).length}
            lastUserPrompt={lastUserPrompt}
            sendPrompt={sendPrompt}
            submitStatus={submitStatus}
          />
        ))}
      </AnimatePresence>
      {showBottomLoader && (
        <div className="pb-46 flex justify-center text-muted-foreground">
          <Shimmer as="span" duration={1.5} spread={1.3} className="text-sm">
            Loading history...
          </Shimmer>
        </div>
      )}
    </>
  )
}
