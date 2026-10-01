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
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import { Fragment, useEffect, useMemo, useRef, useState, useCallback, type ComponentProps } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useUIMessages } from '@convex-dev/agent/react';
import { Response } from '@/components/ai-elements/response';
import { AlertCircleIcon, BarChart3Icon, CopyIcon, KeyRoundIcon, MessageCircleIcon, PlayIcon, RefreshCcwIcon, SquareIcon } from 'lucide-react';
import { SiNotion } from '@icons-pack/react-simple-icons';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { groupConsecutiveScreenshots, screenshotReference, type ScreenshotReference } from '@/lib/computer-use/screenshot-contract';
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
import { GlassButton } from '@/components/ui/glass';
import { useAuthActions } from '@convex-dev/auth/react'
import { Authenticated, useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { PROVIDER_MODELS, isModelEnabled } from '@/lib/provider';
import { SUBSCRIPTION_GRANT_CREDITS } from '@/lib/billing';
import posthog from 'posthog-js';
import { ComputerScreenshotOutput } from '@/components/computer-screenshot-output';

const models = PROVIDER_MODELS.map(({ id, name }) => ({ name, value: id }));

const trackModelGate = (modelId: string) => {
  posthog.capture('premium_model_clicked', { model: modelId });
};
const suggestions = [
  'Projects',
  'Notion Templates',
]

export interface ChatBotDemoProps {
  autoMessage?: string;
}

type ChatMessagePart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  text?: string;
  url?: string;
};

type ToolOutputTextItem = {
  type?: string;
  text?: string;
};

type ToolHeaderType = ComponentProps<typeof ToolHeader>['type'];
type ToolHeaderState = ComponentProps<typeof ToolHeader>['state'];

type CodeRunView = {
  code: string;
  description: string;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted';
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  returnValue?: string;
  errorText?: string;
};

function CodeRunPanel({ code, description, run, fallbackStatus, persistedOutput, errorText }: {
  code: string;
  description: string;
  run?: CodeRunView;
  fallbackStatus: CodeRunView['status'];
  persistedOutput?: string;
  errorText?: string;
}) {
  const [tab, setTab] = useState<'code' | 'output'>('code');
  const status = run?.status ?? fallbackStatus;
  const statusLabel = status === 'running' ? 'Running'
    : status === 'completed' ? 'Completed'
      : status === 'stopped' ? 'Stopped'
        : status === 'interrupted' ? 'Interrupted' : 'Error';
  const output = [
    run?.stdout ? `stdout:\n${run.stdout}` : '',
    run?.stderr ? `stderr:\n${run.stderr}` : '',
    run?.returnValue ? `Return value: ${run.returnValue}` : '',
    run?.errorText ?? errorText ?? '',
    run?.outputTruncated ? 'Output truncated at 64 KiB.' : '',
  ].filter(Boolean).join('\n\n') || persistedOutput || (status === 'running' ? 'Waiting for output…' : 'No output.');

  return (
    <div className="space-y-2 p-4">
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="flex items-center justify-between gap-3">
        <div className="flex rounded-md bg-muted p-1" role="tablist" aria-label="Code run details">
          {(['code', 'output'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={`rounded px-3 py-1 text-xs capitalize ${tab === name ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
            >
              {name}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground" aria-live="polite">{statusLabel}</span>
      </div>
      {tab === 'code' ? (
        <CodeBlock code={code} language="typescript" className="max-h-96 overflow-auto">
          <CodeBlockCopyButton aria-label="Copy TypeScript" />
        </CodeBlock>
      ) : (
        <pre className="max-h-96 min-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-4 font-mono text-xs" aria-live="polite">
          {output}
        </pre>
      )}
    </div>
  );
}

function codeInput(value: unknown): { code: string; description: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  return typeof record.code === 'string'
    ? {
        code: record.code,
        description: typeof record.description === 'string' && record.description.trim()
          ? record.description.trim()
          : 'TypeScript sandbox run',
      }
    : null;
}

function shouldShowBottomLoader(params: {
  defaultThreadId: string | undefined
  activeThreadId: string | null
  paginationStatus: string
}) {
  const isHistoryLoading =
    params.defaultThreadId === undefined ||
    (params.activeThreadId !== null && params.paginationStatus === 'LoadingFirstPage')

  return isHistoryLoading
}

function getUserFacingErrorMessage(error: unknown) {
  const data =
    typeof error === 'object' && error !== null && 'data' in error
      ? (error as { data?: { message?: string } }).data
      : undefined

  if (data?.message) {
    return data.message
  }

  const message = error instanceof Error ? error.message : String(error)
  if (
    message.includes('Free credits temporarily have restricted access') ||
    message.includes('Free credits temporarily have rate limits') ||
    message.includes('GatewayRateLimitError') ||
    message.includes('RestrictedModelsError') ||
    message.includes('no_providers_available')
  ) {
    return 'Vlad.chat is temporarily at AI capacity for this model. Your message was not charged. Please try another model or try again later.'
  }

  const convexMessage = message.match(
    /ConvexError: ([\s\S]*?)(?:\s+at\s|\s+Called by client|$)/,
  )?.[1]?.trim()

  if (convexMessage) {
    return convexMessage
  }

  return message || 'Something went wrong while sending your message. Please try again.'
}

export const ChatBotDemo = ({ autoMessage }: ChatBotDemoProps = {}) => {
  const isAuthenticated = useQuery(api.auth.isAuthenticated)
  const user = useQuery(api.users.viewer)
  const defaultThreadId = useQuery(api.threads.getDefaultThreadId)
  const generateReply = useAction(api.threads.generateReply)
  const stopAgentRun = useMutation(api.threads.stopThread)
  const resumeAgentRun = useMutation(api.threads.resumeThread)
  const steerAgentRun = useMutation(api.threads.steerThread)
  const { signIn } = useAuthActions()
  const notionConn = useQuery(api.notion.getConnection)
  const disconnectNotion = useMutation(api.notion.removeConnection)

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const liveCodeRuns = useQuery(
    api.computerUseCodeRuns.getForThread,
    activeThreadId ? { threadId: activeThreadId } : 'skip',
  )
  const agentRunState = useQuery(
    api.threads.getAgentRunState,
    activeThreadId ? { threadId: activeThreadId } : 'skip',
  )
  const queuedRuns = agentRunState?.queuedRuns ?? []
  const steeringNotes = agentRunState?.steeringNotes ?? []
  const failedQueuedRuns = agentRunState?.failedQueuedRuns ?? []
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(models[0].value);
  const [autoMessageSent, setAutoMessageSent] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [submitState, setSubmitState] = useState<'ready' | 'submitted'>('ready')
  const [submitError, setSubmitError] = useState<{ message: string } | null>(null)
  const [isSteering, setIsSteering] = useState(false)

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
        threadId: activeThreadId ?? undefined,
      })
      setActiveThreadId(result.threadId)
    } catch (error) {
      console.error('Failed to generate reply', error)
      setSubmitError({
        message: getUserFacingErrorMessage(error),
      })
    } finally {
      setSubmitState('ready')
    }
  }, [activeThreadId, generateReply, model, searchEnabled])

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
  const showBottomLoader = shouldShowBottomLoader({
    defaultThreadId,
    activeThreadId,
    paginationStatus,
  })
  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text ?? ''
    if (!text.trim()) {
      if (agentRunState?.status === 'running') {
        await handleStop()
      } else if (agentRunState?.status === 'paused') {
        await handleResume()
      }
      return
    }

    if (submitState === 'submitted') {
      return
    }

    setInput('');
    await sendPrompt(text)
  };

  const handleStop = async () => {
    if (!activeThreadId) {
      return
    }

    try {
      await stopAgentRun({ threadId: activeThreadId })
    } catch (error) {
      console.error('Failed to stop generation', error)
    }
  }

  const handleResume = async () => {
    if (!activeThreadId) return

    try {
      setSubmitError(null)
      await resumeAgentRun({ threadId: activeThreadId })
    } catch (error) {
      setSubmitError({ message: getUserFacingErrorMessage(error) })
    }
  }

  const handleSteer = async () => {
    const instruction = input.trim()
    if (!activeThreadId || !instruction || isSteering) return

    setIsSteering(true)
    setSubmitError(null)
    try {
      await steerAgentRun({
        threadId: activeThreadId,
        requestId: crypto.randomUUID(),
        instruction,
      })
      setInput('')
    } catch (error) {
      setSubmitError({ message: getUserFacingErrorMessage(error) })
    } finally {
      setIsSteering(false)
    }
  }

  const checkout = async () => {
    try {
      const res = await fetch('/api/checkout_session', {
        method: 'POST',
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

  const subscribe = async () => {
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: '/' }),
      })
      const session = await res.json()
      if (!res.ok || !session.url) {
        console.error('Subscribe failed:', session.error ?? res.statusText);
        return;
      }
      window.open(session.url, '_blank')
    } catch (error) {
      console.error('Subscribe error:', error);
    }
  }

  const hasDraft = Boolean(input.trim())
  const runStatus = agentRunState?.status
  const runAction = !hasDraft && runStatus === 'running'
    ? 'stop'
    : !hasDraft && runStatus === 'paused'
      ? 'resume'
      : 'send'
  const isStopping = runStatus === 'stopRequested'
  const isQueued = !hasDraft && runStatus === 'queued'
  const runActionLabel = isStopping
    ? 'Stopping'
    : isQueued
      ? 'Run queued'
      : runAction === 'stop'
        ? 'Stop run'
        : runAction === 'resume'
          ? 'Resume run'
          : 'Send'
  const runActionTitle = isStopping
    ? 'Stopping this run'
    : isQueued
      ? 'This run is queued'
      : runAction === 'stop'
        ? 'Stop this run and keep its checkpoint for resume'
        : runAction === 'resume'
          ? 'Resume this run from its last checkpoint'
          : 'Send message'

  return (
    <>
      <div className="fixed top-4 right-4 z-50 flex flex-col items-end gap-2 md:flex-row md:items-center">
        <GlassButton asChild className="gap-2 p-2 md:px-4 md:py-2">
          <Link href="/provider">
            <KeyRoundIcon className='h-4 w-4' />
            <span className="hidden md:inline">API</span>
          </Link>
        </GlassButton>
        <GlassButton asChild className="gap-2 p-2 md:px-4 md:py-2">
          <Link href="/usage">
            <BarChart3Icon className='h-4 w-4' />
            <span className="hidden md:inline">Usage</span>
          </Link>
        </GlassButton>
        <GlassButton asChild className="gap-0 p-2 md:gap-2 md:px-4 md:py-2">
          <Link href="/lounge">
            <MessageCircleIcon className='w-4 h-4' />
            <span className="hidden md:inline">The Lounge</span>
          </Link>
        </GlassButton>
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
                  const parts = message.parts as ChatMessagePart[]
                  const screenshotAt = (part: ChatMessagePart): ScreenshotReference | undefined => {
                    const name = part.toolName ??
                      (part.type.startsWith('tool-') ? part.type.slice(5) : part.type)
                    if (name !== 'computer_screenshot' || part.state !== 'output-available') return undefined
                    const reference = screenshotReference(part.output)
                    if (!reference) return undefined
                    if (reference.url.startsWith('/') && !reference.url.startsWith('//')) return reference
                    return reference.url.startsWith('https://') ? reference : undefined
                  }
                  const screenshotGroups = new Map<number, ScreenshotReference[]>()
                  const groupedScreenshotIndexes = new Set<number>()
                  for (const group of groupConsecutiveScreenshots(parts.map(screenshotAt))) {
                    screenshotGroups.set(group.startIndex, group.screenshots)
                    for (let index = group.startIndex + 1; index < group.endIndex; index += 1) {
                      groupedScreenshotIndexes.add(index)
                    }
                  }
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

                  const renderToolPart = (part: ChatMessagePart, partIndex: number) => {
                    const rawToolName =
                      part.toolName ??
                      (typeof part.type === 'string' && part.type.startsWith('tool-')
                        ? part.type.slice(5)
                        : part.type)

                    const toolDisplayName = rawToolName?.includes('tavily')
                      ? 'Search'
                      : rawToolName?.includes('notion')
                        ? 'Notion'
                        : rawToolName

                    const toolType = (typeof part.type === 'string' ? part.type : 'dynamic-tool') as ToolHeaderType
                    const toolState = (typeof part.state === 'string' ? part.state : 'input-available') as ToolHeaderState

                    const output = (() => {
                      const content =
                        typeof part.output === 'object' &&
                        part.output !== null &&
                        'content' in part.output
                          ? (part.output as { content?: ToolOutputTextItem[] }).content
                          : undefined
                      if (Array.isArray(content)) {
                        const text = content
                          .filter((item) => item?.type === 'text' && typeof item.text === 'string')
                          .map((item) => item.text)
                          .join('\n')
                          .trim()
                        if (text) {
                          return text
                        }
                      }
                      return part.output
                    })()
                    const persistedOutput = typeof output === 'string'
                      ? output
                      : output == null ? undefined : JSON.stringify(output)
                    const inputCode = rawToolName === 'run_code' ? codeInput(part.input) : null
                    const matchingCodeRun = inputCode && (toolState === 'input-streaming' || toolState === 'input-available')
                      ? liveCodeRuns?.find((run) =>
                          run.code === inputCode.code &&
                          run.description === inputCode.description,
                        )
                      : undefined

                    return (
                      <Tool key={`${messageKey}-${partIndex}`} defaultOpen={false}>
                        <ToolHeader
                          title={toolDisplayName}
                          type={toolType}
                          state={toolState}
                        />
                        <ToolContent>
                          {inputCode ? (
                            <CodeRunPanel
                              code={inputCode.code}
                              description={inputCode.description}
                              run={matchingCodeRun}
                              fallbackStatus={part.errorText || toolState === 'output-error'
                                ? 'failed'
                                : toolState === 'output-available' ? 'completed' : 'running'}
                              persistedOutput={persistedOutput}
                              errorText={part.errorText}
                            />
                          ) : (
                            <>
                              <ToolInput input={part.input} />
                              <ToolOutput output={output} errorText={part.errorText} />
                            </>
                          )}
                        </ToolContent>
                      </Tool>
                    )
                  }
                  return (
                    <motion.div
                      key={messageKey}
                      className={(messages ?? []).length - 1 === messageIndex ? 'pb-52' : ''}
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
                          const screenshotGroup = screenshotGroups.get(partIndex)
                          if (screenshotGroup) {
                            return <ComputerScreenshotOutput key={`${messageKey}-${partIndex}`} screenshots={screenshotGroup} />
                          }
                          if (groupedScreenshotIndexes.has(partIndex)) return null
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
              {queuedRuns.map((queued) => (
                <Message key={queued.runId} from="user">
                  <MessageContent>
                    <Response>
                      {queued.text ||
                        `${queued.attachmentCount} ${queued.attachmentCount === 1 ? 'attachment' : 'attachments'}`}
                    </Response>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Queued — sends after current response
                    </div>
                  </MessageContent>
                </Message>
              ))}
              {steeringNotes.map((note) => (
                <Message key={note.id} from="user">
                  <MessageContent>
                    <Response>{note.text}</Response>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {note.status === 'pending'
                        ? 'Steering — applies from the next model step onward'
                        : 'In effect for this run'}
                    </div>
                  </MessageContent>
                </Message>
              ))}
              {failedQueuedRuns.map((failed) => (
                <Message key={failed.runId} from="user">
                  <MessageContent>
                    <Response>
                      {failed.text ||
                        `${failed.attachmentCount} ${failed.attachmentCount === 1 ? 'attachment' : 'attachments'}`}
                    </Response>
                    <div className="mt-1 text-xs text-destructive">
                      Could not send: {failed.lastError}
                    </div>
                  </MessageContent>
                </Message>
              ))}
              {agentRunState?.status === 'failed' &&
                agentRunState.runId &&
                !failedQueuedRuns.some(
                  (failed) => failed.runId === agentRunState.runId,
                ) && (
                  <Message from="assistant">
                    <MessageContent className="text-sm text-destructive">
                      This response could not continue: {agentRunState.lastError}
                    </MessageContent>
                  </Message>
                )}
              {showBottomLoader && (
                <div className="pb-52 flex justify-center text-muted-foreground">
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

      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-0 left-0 right-0 z-30 h-[env(safe-area-inset-bottom)] bg-background"
      />
      <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 md:px-72">
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
        {user && !user.isAnonymous && user.trialTokens <= 0 && user.tokens <= 0 && (user.includedCredits ?? 0) <= 0 && (
          <Suggestions>
            <Suggestion suggestion={'You have run out of credits. Buy more.'} onClick={() => { checkout() }} />
            <Suggestion suggestion={`Subscribe for ${SUBSCRIPTION_GRANT_CREDITS / 1_000_000}M credits monthly + premium models`} onClick={() => { subscribe() }} />
          </Suggestions>
        )
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
              placeholder={
                agentRunState &&
                ['running', 'stopRequested', 'paused', 'queued'].includes(agentRunState.status)
                  ? 'Type a message, then choose Steer or Send'
                  : undefined
              }
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
                  const subscriber =
                    user?.subscriptionStatus === 'active' || user?.subscriptionStatus === 'past_due';
                  if (!subscriber && !isModelEnabled(value)) {
                    trackModelGate(value);
                    setModel(models[0].value);
                    return;
                  }
                  setModel(value);
                }}
                value={model}
              >
                <PromptInputModelSelectTrigger>
                  <PromptInputModelSelectValue />
                </PromptInputModelSelectTrigger>
                <PromptInputModelSelectContent>
                  {models.map((model) => {
                    const subscriber =
                      user?.subscriptionStatus === 'active' || user?.subscriptionStatus === 'past_due';
                    const locked = !subscriber && !isModelEnabled(model.value);
                    return (
                      <PromptInputModelSelectItem
                        key={model.value}
                        value={model.value}
                        className={locked ? 'text-muted-foreground/50' : undefined}
                      >
                        {model.name}
                      </PromptInputModelSelectItem>
                    );
                  })}
                </PromptInputModelSelectContent>
              </PromptInputModelSelect>
              <PromptInputSearchToggle
                enabled={searchEnabled}
                onToggle={setSearchEnabled}
              />
              <button
                type="button"
                onClick={async () => {
                  if (notionConn) {
                    await disconnectNotion();
                  } else {
                    try {
                      const res = await fetch('/api/notion/connect');
                      const data = await res.json();
                      if (data.authUrl) {
                        window.open(
                          data.authUrl,
                          'notion-oauth',
                          'width=700,height=800,menubar=no,toolbar=no,location=no,status=no',
                        );
                      }
                    } catch (e) {
                      console.error('Failed to start Notion OAuth', e);
                    }
                  }
                }}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
                  notionConn
                    ? "bg-foreground text-background hover:bg-foreground hover:text-background"
                    : "bg-foreground/5 text-foreground/75 hover:bg-foreground/5 hover:text-foreground",
                )}
                title={
                  notionConn
                    ? `Notion: ${notionConn.workspaceName || "Connected"} — click to disconnect`
                    : "Connect Notion"
                }
              >
                <SiNotion className="size-4" />
                {notionConn && (
                  <span className="max-w-20 truncate">
                    {notionConn.workspaceName || ""}
                  </span>
                )}
              </button>
            </PromptInputTools>
            <div className="flex items-center gap-1">
              {input.trim() && agentRunState?.runId &&
                ['running', 'stopRequested', 'paused'].includes(agentRunState.status) && (
                  <button
                    type="button"
                    onClick={() => void handleSteer()}
                    disabled={isSteering}
                    className="h-9 rounded-full border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                    title="Apply this direction to the active run at its next model step"
                  >
                    {isSteering ? 'Steering…' : 'Steer'}
                  </button>
                )}
              <PromptInputSubmit
                type="submit"
                disabled={isStopping || isQueued || (runAction === 'send' && (!hasDraft || submitState === 'submitted'))}
                status={isStopping || isQueued ? 'submitted' : submitState}
                aria-label={runActionLabel}
                title={runActionTitle}
              >
                {runAction === 'stop'
                  ? <SquareIcon className="size-4" />
                  : runAction === 'resume'
                    ? <PlayIcon className="size-4" />
                    : undefined}
              </PromptInputSubmit>
            </div>
          </PromptInputToolbar>
        </PromptInput>
        <footer className="mt-1.5 flex items-center justify-center gap-2 text-[11px] text-muted-foreground/60">
          <Link href="/terms" className="transition-colors hover:text-foreground">
            Terms
          </Link>
          <span aria-hidden="true">•</span>
          <Link href="/privacy" className="transition-colors hover:text-foreground">
            Privacy
          </Link>
        </footer>
      </div>
    </>
  );
};
