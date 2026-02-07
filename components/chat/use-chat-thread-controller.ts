'use client';

import { useAuthActions } from '@convex-dev/auth/react'
import { useUIMessages } from '@convex-dev/agent/react'
import { useAction, useQuery } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/convex/_generated/api'

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
]

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

export function useChatThreadController({ autoMessage }: { autoMessage?: string } = {}) {
  const isAuthenticated = useQuery(api.auth.isAuthenticated)
  const user = useQuery(api.users.viewer)
  const defaultThreadId = useQuery(api.threads.getDefaultThreadId)
  const generateReply = useAction(api.threads.generateReply)
  const { signIn } = useAuthActions()

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [input, setInput] = useState('')
  const [model, setModel] = useState<string>(models[0].value)
  const [autoMessageSent, setAutoMessageSent] = useState(false)
  const [searchEnabled, setSearchEnabled] = useState(false)
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

  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const prevScrollHeight = useRef<number>(0)

  useEffect(() => {
    if (!activeThreadId && defaultThreadId) {
      setActiveThreadId(defaultThreadId)
    }
  }, [activeThreadId, defaultThreadId])

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY < 100 && paginationStatus === 'CanLoadMore' && !isLoadingMore) {
        setIsLoadingMore(true)
        prevScrollHeight.current = document.documentElement.scrollHeight
        loadMore(50)
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [paginationStatus, loadMore, isLoadingMore])

  useEffect(() => {
    if (isLoadingMore && paginationStatus !== 'LoadingMore') {
      requestAnimationFrame(() => {
        const newScrollHeight = document.documentElement.scrollHeight
        const scrollDiff = newScrollHeight - prevScrollHeight.current
        window.scrollTo(0, window.scrollY + scrollDiff)
        setIsLoadingMore(false)
      })
    }
  }, [paginationStatus, isLoadingMore])

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

  useEffect(() => {
    if (
      autoMessage &&
      !autoMessageSent &&
      isAuthenticated === true &&
      (messages?.length ?? 0) === 0 &&
      submitState === 'ready'
    ) {
      setAutoMessageSent(true)
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

  return {
    activeThreadId,
    defaultThreadId,
    input,
    isAuthenticated,
    isLoadingMore,
    lastUserPrompt,
    messages,
    model,
    paginationStatus,
    searchEnabled,
    setInput,
    setModel,
    setSearchEnabled,
    setShowSuggestions,
    showBottomLoader,
    showSuggestions,
    signIn,
    submitError,
    setSubmitError,
    submitStatus,
    sendPrompt,
    user,
  }
}

export { models }
