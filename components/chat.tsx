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
import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { useUIMessages } from '@convex-dev/agent/react';
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
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { Action, Actions } from '@/components/ai-elements/actions';
import { useAuthActions } from '@convex-dev/auth/react'
import { Authenticated, useAction, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

const models = [
  {
    name: 'Kimi K2.5',
    value: 'moonshotai/kimi-k2-thinking'
  },
  {
    name: 'GPT 5.2 Codex',
    value: 'openai/gpt-5.2-codex',
  },
  {
    name: 'Grok 4.1',
    value: 'xai/grok-4.1-fast-reasoning'
  },
  {
    name: 'DeepSeek 3.2',
    value: 'deepseek/deepseek-v3.2-thinking'
  }
];

const suggestions = [
  'Latest updates',
  'Notion Templates',
]

export interface ChatBotDemoProps {
  autoMessage?: string;
}

export const ChatBotDemo = ({ autoMessage }: ChatBotDemoProps = {}) => {
  const isAuthenticated = useQuery(api.auth.isAuthenticated)
  const user = useQuery(api.users.viewer)
  const defaultThreadId = useQuery(api.threads.getDefaultThreadId)
  const generateReply = useAction(api.threads.generateReply)
  const { signIn } = useAuthActions()

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(models[0].value);
  const [autoMessageSent, setAutoMessageSent] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [submitState, setSubmitState] = useState<'ready' | 'submitted'>('ready')
  const [submitError, setSubmitError] = useState<{ message: string } | null>(null)

  const {
    results: messages,
    status: paginationStatus,
    loadMore,
  } = useUIMessages(
    api.threads.getUIMessages,
    activeThreadId ? { threadId: activeThreadId } : 'skip',
    { initialNumItems: 50, stream: true },
  )

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const prevScrollHeight = useRef<number>(0);

  useEffect(() => {
    if (!activeThreadId && defaultThreadId) {
      setActiveThreadId(defaultThreadId)
    }
  }, [activeThreadId, defaultThreadId])

  // Scroll-based pagination: load more when scrolled to top
  useEffect(() => {
    const handleScroll = () => {
      // Only trigger if near top (within 100px) and we can load more
      if (window.scrollY < 100 && paginationStatus === 'CanLoadMore' && !isLoadingMore) {
        setIsLoadingMore(true);
        prevScrollHeight.current = document.documentElement.scrollHeight;
        loadMore(50);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [paginationStatus, loadMore, isLoadingMore]);

  // After loading more, maintain scroll position
  useEffect(() => {
    if (isLoadingMore && paginationStatus !== 'LoadingMore') {
      requestAnimationFrame(() => {
        const newScrollHeight = document.documentElement.scrollHeight;
        const scrollDiff = newScrollHeight - prevScrollHeight.current;
        window.scrollTo(0, window.scrollY + scrollDiff);
        setIsLoadingMore(false);
      });
    }
  }, [paginationStatus, isLoadingMore]);

  useEffect(() => {
    if (isAuthenticated === false) {
      signIn('anonymous')
    }
  }, [isAuthenticated, signIn])

  const sendPrompt = useCallback(async (text: string) => {
    const prompt = text.trim()
    if (!prompt) {
      return
    }

    setShowSuggestions(false)
    setSubmitState('submitted')
    setSubmitError(null)
    try {
      const result = await generateReply({
        prompt,
        model,
        searchEnabled,
      })
      setActiveThreadId(result.threadId)
    } catch (error) {
      console.error('Failed to generate reply', error)
      const data =
        typeof error === 'object' && error !== null && 'data' in error
          ? (error as { data?: { message?: string } }).data
          : undefined
      setSubmitError({
        message: data?.message
          || (error instanceof Error ? error.message : '')
          || 'Something went wrong while sending your message. Please try again.',
      })
    } finally {
      setSubmitState('ready')
    }
  }, [generateReply, model, searchEnabled])

  // Auto-send message when page is ready and autoMessage is provided
  useEffect(() => {
    if (
      autoMessage &&
      !autoMessageSent &&
      isAuthenticated === true &&
      (messages?.length ?? 0) === 0 &&
      submitState === 'ready'
    ) {
      setAutoMessageSent(true);
      void sendPrompt(autoMessage)
    }
  }, [autoMessage, autoMessageSent, isAuthenticated, messages?.length, submitState, sendPrompt])

  useEffect(() => {
    if (input.length) {
      setShowSuggestions(false)
    } else if ((messages?.length ?? 0) > 0) {
      setShowSuggestions(false)
    } else {
      setShowSuggestions(true)
    }
  }, [input, messages?.length])

  const handleSubmit = async (message: PromptInputMessage) => {
    if (!message.text) {
      return;
    }

    setInput('');
    await sendPrompt(message.text)
  };

  const lastUserPrompt = useMemo(() => {
    if (!messages) {
      return null
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (message.role !== 'user') {
        continue
      }
      const text = message.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim()
      if (text) {
        return text
      }
    }
    return null
  }, [messages])

  const streamActive = useMemo(
    () => (messages ?? []).some((message) => message.status === 'streaming' || message.status === 'pending'),
    [messages],
  )
  const submitStatus = (streamActive ? 'streaming' : submitState) as 'ready' | 'submitted' | 'streaming'

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
              {(messages ?? []).map((message, messageIndex) => {
                const messageKey = `${message.order}-${message.stepOrder}`
                const parts = message.parts as Array<any>
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
                    className={(messages ?? []).length - 1 === messageIndex && submitStatus !== 'submitted' ? 'pb-46' : ''}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      type: 'spring',
                      stiffness: 300,
                      damping: 30,
                      delay: 0.05
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
                  </motion.div>
                )
              })}
              {submitStatus === 'submitted' && <div className="pb-46 flex justify-center"><Loader /></div>}
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
              <PromptInputSubmit disabled={!input && submitStatus === 'ready'} status={submitStatus} />
            </div>
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </>
  );
};
