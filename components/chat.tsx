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
import { Fragment, useEffect, useState, useCallback } from 'react';
import type { DelegationMessage } from '@/lib/opencode-types';
import { motion } from 'motion/react';
import { useChat } from '@ai-sdk/react';
import { Response } from '@/components/ai-elements/response';
import { CopyIcon, MessageCircleIcon, RefreshCcwIcon } from 'lucide-react';
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
import { useAuthActions } from "@convex-dev/auth/react"
import { Authenticated, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useOpenCodeSafe } from '@/lib/opencode-context';
import { OpenCodeStatus } from '@/components/ai-elements/opencode-status';
import { DelegationProgress, DelegationStatus } from '@/components/ai-elements/delegation';
import { OpenCodeSetupPrompt } from '@/components/ai-elements/opencode-setup';

const models = [
  {
    name: 'Kimi K2',
    value: 'moonshotai/kimi-k2'
  },
  {
    name: 'GPT 5.2 Codex',
    value: 'openai/gpt-5.2-codex',
  },
  {
    name: 'Grok 4',
    value: 'xai/grok-4-fast-reasoning'
  },
  {
    name: 'DeepSeek 3.2',
    value: 'deepseek/deepseek-v3.2'
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
  const { signIn } = useAuthActions()
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(models[0].value);
  const [autoMessageSent, setAutoMessageSent] = useState(false);
  const { messages, sendMessage, status, error, regenerate } = useChat({
    onError: error => {
      console.log('error caught', error)
    }
  });

  // OpenCode integration
  const opencode = useOpenCodeSafe();
  const isOpenCodeConnected = opencode?.isConnected ?? false;
  const openCodeEvents = opencode?.events ?? [];
  const [delegationExecuted, setDelegationExecuted] = useState<Set<string>>(new Set());

  // Determine delegation status based on events
  const getDelegationStatus = useCallback((): 'pending' | 'running' | 'completed' | 'error' => {
    if (openCodeEvents.length === 0) return 'pending';

    const hasRunning = openCodeEvents.some(
      e => e.type === 'session.status' && e.properties.status === 'running'
    );
    if (hasRunning) return 'running';

    const hasError = openCodeEvents.some(
      e => e.type === 'session.status' && e.properties.status === 'error'
    );
    if (hasError) return 'error';

    return 'completed';
  }, [openCodeEvents]);

  // Parse delegation JSON from text message
  const parseDelegation = useCallback((text: string): DelegationMessage | null => {
    try {
      // Try to parse as JSON directly
      const parsed = JSON.parse(text.trim());
      if (parsed.type === 'delegation' && parsed.task) {
        return parsed as DelegationMessage;
      }
    } catch {
      // Try to extract JSON from text (might have surrounding text)
      const jsonMatch = text.match(/\{[\s\S]*"type":\s*"delegation"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.type === 'delegation' && parsed.task) {
            return parsed as DelegationMessage;
          }
        } catch {
          // Not valid JSON
        }
      }
    }
    return null;
  }, []);

  // Execute delegation when detected in messages
  useEffect(() => {
    if (!isOpenCodeConnected || !opencode || status === 'streaming') return;

    // Check the last assistant message for delegation
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') return;

    // Get text parts from the message
    const textParts = lastMessage.parts.filter(p => p.type === 'text');
    for (const part of textParts) {
      if (part.type !== 'text') continue;

      const delegation = parseDelegation(part.text);
      if (delegation && !delegationExecuted.has(lastMessage.id)) {
        console.log('Executing delegation:', delegation);
        setDelegationExecuted(prev => new Set(prev).add(lastMessage.id));
        opencode.sendTask(delegation.task).catch(err => {
          console.error('Delegation failed:', err);
        });
      }
    }
  }, [messages, isOpenCodeConnected, opencode, status, parseDelegation, delegationExecuted]);

  useEffect(() => {
    if (isAuthenticated === false) {
      signIn('anonymous')
    }
  }, [isAuthenticated, signIn])

  // Auto-send message when page is ready and autoMessage is provided
  useEffect(() => {
    if (autoMessage && !autoMessageSent && isAuthenticated === true && messages.length === 0 && status !== 'streaming' && status !== 'submitted') {
      setAutoMessageSent(true);
      setShowSuggestions(false);
      sendMessage(
        { text: autoMessage },
        {
          body: {
            model: model,
            openCodeConnected: isOpenCodeConnected,
          },
        },
      );
    }
  }, [autoMessage, autoMessageSent, isAuthenticated, messages.length, status, sendMessage, model])

  useEffect(() => {
    if (input.length) {
      setShowSuggestions(false)
    } else if (messages.length > 0) {
      setShowSuggestions(false)
    } else {
      setShowSuggestions(true)
    }
  }, [input, messages.length])

  const handleSubmit = async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);

    setShowSuggestions(false)

    if (!hasText) {
      return;
    }

    sendMessage(
      {
        text: message.text,
      },
      {
        body: {
          model: model,
          openCodeConnected: isOpenCodeConnected,
        },
      },
    );
    setInput('');
  };

  const checkout = async () => {
    try {
      const res = await fetch(`/api/checkout_session`, {
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
      <div className="fixed top-3 right-3 md:top-4 md:right-4 z-50 flex flex-col items-end gap-1.5 md:gap-2">
        {/* OpenCode connection status */}
        <OpenCodeStatus compact />

        <Link
          href="/lounge"
          className="flex items-center gap-0 md:gap-2 p-2.5 md:px-4 md:py-2 rounded-full bg-gradient-to-r from-violet-600/90 to-fuchsia-600/90 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-medium shadow-lg shadow-violet-500/25 transition-all hover:scale-105">
          <MessageCircleIcon className='w-4 h-4' />
          <span className="hidden md:inline">The Lounge</span>
        </Link>
      </div>
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
              {messages.map((message, messageIndex) => (
                <motion.div
                  key={message.id}
                  className={messages.length - 1 === messageIndex && status !== 'submitted' ? 'pb-46' : ''}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    type: "spring",
                    stiffness: 300,
                    damping: 30,
                    delay: 0.05
                  }}
                >
                  {
                    message.role === 'assistant' && message.parts.filter((part) => part.type === 'source-url').length > 0 && (
                      <Sources>
                        <SourcesTrigger
                          count={
                            message.parts.filter(
                              (part) => part.type === 'source-url',
                            ).length
                          }
                        />
                        {message.parts.filter((part) => part.type === 'source-url').map((part, i) => (
                          <SourcesContent key={`${message.id}-${i}`}>
                            <Source
                              key={`${message.id}-${i}`}
                              href={part.url}
                              title={part.url}
                            />
                          </SourcesContent>
                        ))}
                      </Sources>
                    )
                  }
                  {
                    message.parts.map((part, partIndex) => {
                      switch (part.type) {
                        case 'text': {
                          // Check if this is a delegation message
                          const delegation = message.role === 'assistant'
                            ? parseDelegation(part.text)
                            : null;

                          if (delegation) {
                            // Render DelegationProgress inline instead of the JSON
                            if (openCodeEvents.length > 0) {
                              return (
                                <DelegationProgress
                                  key={`${message.id}-${partIndex}`}
                                  events={openCodeEvents}
                                  hideHeader
                                />
                              );
                            }
                            // If no events yet, show a simple pending indicator
                            return (
                              <div key={`${message.id}-${partIndex}`} className="flex items-center gap-2 py-2">
                                <Loader className="w-4 h-4" />
                                <span className="text-sm text-muted-foreground">
                                  Delegating to OpenCode...
                                </span>
                              </div>
                            );
                          }

                          // Regular text message
                          return (
                            <Fragment key={`${message.id}-${partIndex}`}>
                              <Message from={message.role}>
                                <MessageContent>
                                  <Response>
                                    {part.text}
                                  </Response>
                                </MessageContent>
                              </Message>
                              {message.role === 'assistant' &&
                                messageIndex === messages.length - 1 &&
                                partIndex === message.parts.length - 1 && (
                                  <Actions className="-mt-3">
                                    <Action
                                      onClick={() => { regenerate({ body: { model } }) }}
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
                        }
                        case 'reasoning':
                          return (
                            <Reasoning
                              key={`${message.id}-${partIndex}`}
                              className="w-full"
                              isStreaming={
                                status === 'streaming' &&
                                partIndex === message.parts.length - 1 &&
                                message.id === messages.at(-1)?.id
                              }
                            >
                              <ReasoningTrigger />
                              <ReasoningContent>{part.text}</ReasoningContent>
                            </Reasoning>
                          );
                        case 'dynamic-tool': {
                          const content =
                            (part.output as { content: [{ text: string }] })?.content[0]
                              ?.text ?? [];

                          return (
                            <Tool key={`${message.id}-${partIndex}`} defaultOpen={false}>
                              <ToolHeader type={'tool-notion'} state={part.state} />
                              <ToolContent>
                                <ToolInput input={part.input} />
                                <ToolOutput output={content} errorText={part.errorText} />
                              </ToolContent>
                            </Tool>
                          );
                        }
                        default:
                          return null;
                      }
                    })
                  }
                </motion.div>
              ))}
              {status === 'submitted' && <div className="pb-46 flex justify-center"><Loader /></div>}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>
      </div >

      <div className="px-4 py-2 md:px-72 fixed bottom-0 left-0 right-0 bg-background/30 backdrop-blur-sm">

        {/* {error && <Suggestions>
          <Suggestion suggestion={`An error occurred: ${error.message}. Regenerate.`} onClick={() => regenerate({ body: { model } })} />
        </Suggestions>} */}

        {messages.length > 0 && (
          <div className="mb-2 flex items-center justify-center gap-3 flex-wrap text-sm">
            <DelegationStatus events={openCodeEvents} />

            {user?.isAnonymous && (
              <Authenticated>
                <div className="flex items-center gap-2 flex-wrap">
                  {openCodeEvents.length > 0 && (
                    <span className="text-muted-foreground/50">•</span>
                  )}
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
              </Authenticated>
            )}
          </div>
        )}
        {user && user.trialTokens <= 0 && user.tokens <= 0 && <Suggestions>
          <Suggestion suggestion={`You have run out of credits. Buy more.`} onClick={() => { checkout() }} />
        </Suggestions>
        }
        {showSuggestions && (
          <>
            <Suggestions>
              {suggestions.map(suggestion =>
                <Suggestion
                  key={suggestion}
                  onClick={(suggestion) => {
                    setShowSuggestions(false)
                    sendMessage(
                      { text: suggestion },
                      {
                        body: {
                          model: model,
                          openCodeConnected: isOpenCodeConnected,
                        },
                      },
                    );
                  }} suggestion={suggestion} />
              )}
            </Suggestions>
            {/* Show OpenCode setup prompt when not connected */}
            {!isOpenCodeConnected && <OpenCodeSetupPrompt className="mt-2" />}
          </>
        )}

        <PromptInput onSubmit={handleSubmit} className="mt-2">
          <PromptInputBody>
            <PromptInputTextarea
              onChange={(e) => setInput(e.target.value)}
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
            </PromptInputTools>
            <PromptInputSubmit disabled={!input && !status} status={status} />
          </PromptInputToolbar>
        </PromptInput>
      </div>
    </>
  );
};
