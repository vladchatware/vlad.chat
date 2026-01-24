'use client'

/**
 * OpenCode React Context
 * Provides OpenCode connection state and methods to React components
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { OpenCodeClient } from './opencode-client'
import type { Session, OpenCodeEvent, HealthResponse } from './opencode-types'

interface OpenCodeContextValue {
  // Connection state
  isConnected: boolean
  isConnecting: boolean
  serverInfo: HealthResponse | null

  // Client instance
  client: OpenCodeClient

  // Session management
  currentSession: Session | null
  createSession: (title?: string) => Promise<Session>
  setCurrentSession: (session: Session | null) => void

  // Events
  events: OpenCodeEvent[]
  clearEvents: () => void

  // Task delegation
  sendTask: (task: string, model?: string) => Promise<void>
  abortCurrentTask: () => Promise<void>

  // Connection management
  reconnect: () => Promise<void>
}

const OpenCodeContext = createContext<OpenCodeContextValue | null>(null)

interface OpenCodeProviderProps {
  children: ReactNode
  /** Custom base URL for OpenCode server (default: http://localhost:4096) */
  baseUrl?: string
  /** Polling interval for connection check in ms (default: 5000) */
  pollInterval?: number
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean
}

export function OpenCodeProvider({
  children,
  baseUrl,
  pollInterval = 5000,
  autoConnect = true,
}: OpenCodeProviderProps) {
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [serverInfo, setServerInfo] = useState<HealthResponse | null>(null)
  const [currentSession, setCurrentSession] = useState<Session | null>(null)
  const [events, setEvents] = useState<OpenCodeEvent[]>([])

  // Create client instance (stable reference)
  const clientRef = useRef<OpenCodeClient | null>(null)
  if (!clientRef.current) {
    clientRef.current = new OpenCodeClient(baseUrl)
  }
  const client = clientRef.current

  // Check connection to OpenCode server
  const checkConnection = useCallback(async () => {
    setIsConnecting(true)
    try {
      const health = await client.checkHealth()
      const connected = health?.healthy === true
      setIsConnected(connected)
      setServerInfo(health)

      if (connected && !client.isSubscribed()) {
        // Subscribe to events when connected
        client.subscribeToEvents((event) => {
          setEvents((prev) => [...prev, event])
        })
      } else if (!connected && client.isSubscribed()) {
        // Unsubscribe when disconnected
        client.unsubscribe()
      }
    } catch {
      setIsConnected(false)
      setServerInfo(null)
    } finally {
      setIsConnecting(false)
    }
  }, [client])

  // Auto-connect and poll for connection
  useEffect(() => {
    if (autoConnect) {
      checkConnection()
    }

    // Poll for connection status
    const interval = setInterval(checkConnection, pollInterval)

    return () => {
      clearInterval(interval)
      client.unsubscribe()
    }
  }, [autoConnect, checkConnection, pollInterval, client])

  // Create a new session
  const createSession = useCallback(
    async (title?: string) => {
      const session = await client.createSession({ title })
      setCurrentSession(session)
      return session
    },
    [client]
  )

  // Send a task to OpenCode
  const sendTask = useCallback(
    async (task: string, model: string = 'big-pickle') => {
      if (!isConnected) {
        throw new Error('OpenCode is not connected')
      }

      // Create a new session if none exists
      let session = currentSession
      if (!session) {
        session = await createSession('Vlad delegation')
      }

      // Clear previous events for this task
      setEvents([])

      // Send the task asynchronously with the specified model
      await client.sendTextMessageAsync(session.id, task, { model })
    },
    [isConnected, currentSession, createSession, client]
  )

  // Abort the current task
  const abortCurrentTask = useCallback(async () => {
    if (currentSession) {
      await client.abortSession(currentSession.id)
    }
  }, [currentSession, client])

  // Clear events
  const clearEvents = useCallback(() => {
    setEvents([])
  }, [])

  // Manual reconnect
  const reconnect = useCallback(async () => {
    client.unsubscribe()
    await checkConnection()
  }, [client, checkConnection])

  const value: OpenCodeContextValue = {
    isConnected,
    isConnecting,
    serverInfo,
    client,
    currentSession,
    createSession,
    setCurrentSession,
    events,
    clearEvents,
    sendTask,
    abortCurrentTask,
    reconnect,
  }

  return <OpenCodeContext.Provider value={value}>{children}</OpenCodeContext.Provider>
}

/**
 * Hook to access OpenCode context
 * Must be used within an OpenCodeProvider
 */
export function useOpenCode() {
  const context = useContext(OpenCodeContext)
  if (!context) {
    throw new Error('useOpenCode must be used within an OpenCodeProvider')
  }
  return context
}

/**
 * Hook to check if OpenCode is available (safe version that doesn't throw)
 * Returns null if not within provider
 */
export function useOpenCodeSafe() {
  return useContext(OpenCodeContext)
}

/**
 * Hook to detect if OpenCode server is available
 * Useful for conditional rendering
 */
export function useOpenCodeAvailable() {
  const context = useContext(OpenCodeContext)
  return context?.isConnected ?? false
}
