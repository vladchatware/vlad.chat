'use client';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  type PromptInputMessage,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectItem,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
  PromptInputSearchToggle,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput,
  ToolInput,
} from '@/components/ai-elements/tool';
import { Fragment } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Response } from '@/components/ai-elements/response';
import { AlertCircleIcon, CopyIcon, MessageCircleIcon, RefreshCcwIcon } from 'lucide-react';
import Link from 'next/link';
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/source';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import { Loader } from '@/components/ai-elements/loader';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { Action, Actions } from '@/components/ai-elements/actions';
import { Authenticated } from 'convex/react';
import { models, useChatThreadController } from '@/components/chat/use-chat-thread-controller';

const suggestions = [
  'Latest updates',
  'Notion Templates',
]

export interface ChatBotDemoProps {
  autoMessage?: string;
}

export const ChatBotDemo = ({ autoMessage }: ChatBotDemoProps = {}) => {
  const {
    input,
    isLoadingMore,
    lastUserPrompt,
    messages,
    model,
    paginationStatus,
    searchEnabled,
    setInput,
    setModel,
    setSearchEnabled,
    showBottomLoader,
    showSuggestions,
    signIn,
    submitError,
    setSubmitError,
    submitStatus,
    sendPrompt,
    user,
  } = useChatThreadController({ autoMessage })
  const handleSubmit = async (message: PromptInputMessage) => {
    if (submitStatus === 'streaming') {
      return
    }

    if (!message.text) {
      return;
    }

    setInput('');
    await sendPrompt(message.text)
  };

  const checkout = async () => {
    try {
      const res = await fetch('/api/checkout_session', {
        method: 'POST',
        body: JSON.stringify({
          price: 5
        })
      })

      if (!res.ok) {
        console.error('Checkout failed:', res.statusText);
        return;
      }

      const session = await res.json()

      if (!session.url) {
        console.error('Checkout session missing URL');
        return;
      }

      window.open(session.url, '_blank')
    } catch (error) {
      console.error('Checkout error:', error);
    }
  }

  return (
    <>
      <Link
        href="/lounge"
        className="fixed top-4 right-4 z-50 flex items-center gap-0 md:gap-2 p-2 md:px-4 md:py-2 rounded-full bg-gradient-to-r from-violet-600/90 to-fuchsia-600/90 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-medium shadow-lg shadow-violet-500/25 transition-all hover:scale-105">
        <MessageCircleIcon className='w-4 h-4' />
        <span className="hidden md:inline">The Lounge</span>
      </Link>
      <div className="">
        <div className="md:px-72">
          <Conversation className="">
            <ConversationContent>
              <div>
                <Message from="assistant">
                  <MessageContent>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="vlad.png" width={150} alt="Vlad" />
                    <Response>
                      Hello, I am Vlad a software developer.
                    </Response>
                    <Response>
                      Check out my [shop](https://shop.vlad.chat) or listen to some [music](https://music.vlad.chat).
                    </Response>
                  </MessageContent>
                </Message>
              </div>
              {/* Loading indicator for older messages */}
              {isLoadingMore && (
                <div className="flex justify-center py-4">
                  <Loader />
                </div>
              )}
              {/* Show "Load more" hint if more messages available */}
              {paginationStatus === 'CanLoadMore' && !isLoadingMore && (
                <div className="flex justify-center py-2">
                  <span className="text-xs text-muted-foreground">Scroll up to load more</span>
                </div>
              )}
              <AnimatePresence initial={false}>
                {(messages ?? []).map((message, messageIndex) => {
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
                    messageIndex === (messages ?? []).length - 1

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
                      className={(messages ?? []).length - 1 === messageIndex ? 'pb-46' : ''}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: 0.22,
                        ease: 'easeOut',
                      }}
                    >
                      {
                        message.role === 'assistant' && parts.filter((part) => part.type === 'source-url').length > 0 && (
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
                        )
                      }
                      {
                        parts.map((part, partIndex) => {
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
                                    messageIndex === (messages ?? []).length - 1 &&
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
                              );
                            case 'reasoning':
                              return (
                                <Reasoning
                                  key={`${messageKey}-${partIndex}`}
                                  className="w-full"
                                  isStreaming={
                                    submitStatus === 'streaming' &&
                                    partIndex === parts.length - 1 &&
                                    messageIndex === (messages ?? []).length - 1
                                  }
                                >
                                  <ReasoningTrigger />
                                  <ReasoningContent>{part.text}</ReasoningContent>
                                </Reasoning>
                              );
                            case 'dynamic-tool': {
                              return renderToolPart(part, partIndex);
                            }
                            default:
                              if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
                                return renderToolPart(part, partIndex);
                              }
                              return null;
                          }
                        })
                      }
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
                })}
              </AnimatePresence>
              {showBottomLoader && (
                <div className="pb-46 flex justify-center text-muted-foreground">
                  <Shimmer as="span" duration={1.5} spread={1.3} className="text-sm">
                    Loading history...
                  </Shimmer>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>
      </div >

      <div className="px-4 py-2 md:px-72 fixed bottom-0 left-0 right-0 bg-background/30 backdrop-blur-sm">
        {submitError && (
          <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{submitError.message}</span>
              </div>
            </div>
          </div>
        )}
        {user?.isAnonymous && (messages?.length ?? 0) > 0 && <Authenticated>
          <div className="mb-2 flex items-center justify-center gap-2 flex-wrap text-sm">
            <span className="text-muted-foreground">
              {user.trialMessages > 0 ? (
                <>{user.trialMessages} {user.trialMessages === 1 ? 'message' : 'messages'} left</>
              ) : (
                <>No messages left</>
              )}
            </span>
            <span className="text-muted-foreground/50">•</span>
            <button
              onClick={() => signIn('google')}
              className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              Sign in with Google
            </button>
            <span className="text-muted-foreground/50">for unlimited</span>
          </div>
        </Authenticated>}
        {user && user.trialTokens <= 0 && user.tokens <= 0 && <Suggestions>
          <Suggestion suggestion={'You have run out of credits. Buy more.'} onClick={() => { checkout() }} />
        </Suggestions>
        }
        {showSuggestions && <Suggestions>
          {suggestions.map(suggestion =>
            <Suggestion
              key={suggestion}
              onClick={(value) => {
                void sendPrompt(value)
              }} suggestion={suggestion} />
          )}
        </Suggestions>}

        <PromptInput onSubmit={handleSubmit} className="mt-2">
          <PromptInputBody>
            <PromptInputTextarea
              onChange={(e) => {
                setInput(e.target.value)
                if (submitError) {
                  setSubmitError(null)
                }
              }}
              value={input}
            />
          </PromptInputBody>
          <PromptInputToolbar>
            <PromptInputTools>
              <PromptInputModelSelect
                onValueChange={(value) => {
                  setModel(value);
                }}
                value={model}
              >
                <PromptInputModelSelectTrigger>
                  <PromptInputModelSelectValue />
                </PromptInputModelSelectTrigger>
                <PromptInputModelSelectContent>
                  {models.map((model) => (
                    <PromptInputModelSelectItem key={model.value} value={model.value}>
                      {model.name}
                    </PromptInputModelSelectItem>
                  ))}
                </PromptInputModelSelectContent>
              </PromptInputModelSelect>
              <PromptInputSearchToggle
                enabled={searchEnabled}
                onToggle={setSearchEnabled}
              />
            </PromptInputTools>
            <div className="flex items-center gap-1">
              <PromptInputSubmit
                disabled={
                  (submitStatus === 'ready' && !input)
                  || submitStatus === 'streaming'
                }
                status={submitStatus}
              />
            </div>
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </>
  );
};
