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
import { Response } from '@/components/ai-elements/response';
import { AlertCircleIcon, MessageCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { Authenticated } from 'convex/react';
import { MessageList } from '@/components/chat/message-list';
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
              <MessageList
                isLoadingMore={isLoadingMore}
                lastUserPrompt={lastUserPrompt}
                messages={messages}
                paginationStatus={paginationStatus}
                sendPrompt={sendPrompt}
                showBottomLoader={showBottomLoader}
                submitStatus={submitStatus}
              />
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
