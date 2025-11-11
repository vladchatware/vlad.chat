'use client';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
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
import { Fragment, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { Response } from '@/components/ai-elements/response';
import { CopyIcon, GlobeIcon, MessageCircle, RefreshCcwIcon } from 'lucide-react';
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
import { Authenticated, Unauthenticated, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

const models = [
  {
    name: 'GPT 5 mini',
    value: 'openai/gpt-5-mini',
  },
  {
    name: 'GPT 5',
    value: 'openai/gpt-5'
  }
];

const suggestions = [
  'Latest updates',
  'Roadmap',
  'Notion Templates',
]

const ChatBotDemo = () => {
  const isAuthenticated = useQuery(api.auth.isAuthenticated)
  const user = useQuery(api.users.viewer)
  const { signIn, signOut } = useAuthActions()
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(models[0].value);
  const [webSearch, setWebSearch] = useState(false);
  const { messages, sendMessage, status, error, regenerate } = useChat({
    onError: error => {
      console.log('error caught', error)
    }
  });

  useEffect(() => {
    if (!isAuthenticated) {
      signIn('anonymous')
    }
  }, [])

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
    const hasAttachments = Boolean(message.files?.length);

    setShowSuggestions(false)

    if (!(hasText || hasAttachments)) {
      return;
    }

    sendMessage(
      {
        text: message.text || 'Sent with attachments',
        files: message.files
      },
      {
        body: {
          model: model,
          webSearch: webSearch,
        },
      },
    );
    setInput('');
  };

  const checkout = async () => {
    const res = await fetch(`/api/checkout_session`, {
      method: 'POST',
      body: JSON.stringify({
        price: 5
      })
    })
    const session = await res.json()
    window.open(session.url, '_blank')
  }

  return (
    <>
      <div className="">
        <div className="md:px-72">
          <Conversation className="">
            <ConversationContent>
              <div>
                <Message from="assistant">
                  <MessageContent>
                    <img src="vlad.png" width={150} />
                    <Response>
                      Hello, I am Vlad a software developer.
                    </Response>
                    <Response>
                      You can ask me about my experience, my past projects or my notion templates.
                    </Response>
                    <Response>
                      Also chek out my [shop](https://shop.vlad.chat) or listen to some [music](https://music.vlad.chat).
                    </Response>
                  </MessageContent>
                </Message>
              </div>
              {messages.map((message, i, messages) => (
                <div key={message.id} className={messages.length - 1 === i ? "pb-42" : ""} >
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
                    message.parts.map((part, i) => {
                      switch (part.type) {
                        case 'text':
                          return (
                            <Fragment key={`${message.id}-${i}`}>
                              <Message from={message.role}>
                                <MessageContent>
                                  <Response>
                                    {part.text}
                                  </Response>
                                </MessageContent>
                              </Message>
                              {message.role === 'assistant' && i === messages.length - 1 && (
                                <Actions className="mt-2">
                                  <Action
                                    onClick={() => { regenerate() }}
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
                              key={`${message.id}-${i}`}
                              className="w-full"
                              isStreaming={status === 'streaming' && i === message.parts.length - 1 && message.id === messages.at(-1)?.id}
                            >
                              <ReasoningTrigger />
                              <ReasoningContent>{part.text}</ReasoningContent>
                            </Reasoning>
                          );
                        case 'dynamic-tool':
                          const content = (part.output as { content: [{ text: string }] })?.content[0]?.text ?? []
                          return <>
                            <Tool key={`${message.id}-${i}`} defaultOpen={false}>
                              <ToolHeader type={'tool-notion'} state={part.state} />
                              <ToolContent>
                                <ToolInput input={part.input} />
                                <ToolOutput output={content} errorText={part.errorText} />
                              </ToolContent>
                            </Tool>
                          </>
                        default:
                          return null;
                      }
                    })
                  }
                </div>
              ))}
              {status === 'submitted' && <div className="pb-46"><Loader /></div>}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>
      </div >

      <div className="p-6 md:px-72" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(255, 255, 255, 0.3)', backdropFilter: 'blur(1px)' }}>

        {error && <Suggestions>
          <Suggestion suggestion={`An error occured: ${error.message}. Regenerate.`} onClick={() => regenerate()} />
        </Suggestions>}

        {user?.isAnonymous && messages.length > 0 && <Authenticated>
          <Suggestions>
            <Suggestion suggestion={`You have only ${user?.trialMessages} messages left. Sign in to reset your limits.`} onClick={() => { signIn('google') }} />
          </Suggestions>
        </Authenticated>}
        {user?.trialTokens <= 0 && user.tokens <= 0 && <Suggestions>
          <Suggestion suggestion={`You have run out of credits. Buy more.`} onClick={() => { checkout() }} />
        </Suggestions>
        }
        {showSuggestions && <Suggestions>
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
                      webSearch: webSearch,
                    },
                  },
                );
              }} suggestion={suggestion} />
          )}
        </Suggestions>}

        <PromptInput onSubmit={handleSubmit} className="mt-4" globalDrop multiple>
          <PromptInputBody>
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
            <PromptInputTextarea
              onChange={(e) => setInput(e.target.value)}
              value={input}
            />
          </PromptInputBody>
          <PromptInputToolbar>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              <PromptInputButton
                variant={webSearch ? 'default' : 'ghost'}
                onClick={() => setWebSearch(!webSearch)}
              >
                <GlobeIcon size={16} />
                <span>Search</span>
              </PromptInputButton>
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

export default ChatBotDemo;
