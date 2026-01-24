/**
 * OpenCode HTTP Client
 * Connects to local OpenCode server via HTTP and SSE
 */

import type {
  Session,
  SessionStatus,
  MessageResponse,
  Part,
  TextPart,
  OpenCodeEvent,
  HealthResponse,
  Project,
  FileDiff,
  Todo,
} from './opencode-types'

const DEFAULT_BASE_URL = 'http://localhost:4096'

export class OpenCodeClient {
  private baseUrl: string
  private eventSource: EventSource | null = null
  private eventListeners: Set<(event: OpenCodeEvent) => void> = new Set()

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl
  }

  // ============================================
  // Connection & Health
  // ============================================

  /**
   * Check if OpenCode server is running and healthy
   */
  async checkHealth(): Promise<HealthResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/global/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  /**
   * Check if connection is available (simple boolean check)
   */
  async isAvailable(): Promise<boolean> {
    const health = await this.checkHealth()
    return health?.healthy === true
  }

  // ============================================
  // Project
  // ============================================

  /**
   * Get the current project
   */
  async getCurrentProject(): Promise<Project | null> {
    try {
      const res = await fetch(`${this.baseUrl}/project/current`)
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  /**
   * List all projects
   */
  async listProjects(): Promise<Project[]> {
    try {
      const res = await fetch(`${this.baseUrl}/project`)
      if (!res.ok) return []
      return res.json()
    } catch {
      return []
    }
  }

  // ============================================
  // Sessions
  // ============================================

  /**
   * Create a new session
   */
  async createSession(options?: { title?: string; parentID?: string }): Promise<Session> {
    const res = await fetch(`${this.baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options ?? {}),
    })
    if (!res.ok) {
      throw new Error(`Failed to create session: ${res.statusText}`)
    }
    return res.json()
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<Session | null> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}`)
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<Session[]> {
    try {
      const res = await fetch(`${this.baseUrl}/session`)
      if (!res.ok) return []
      return res.json()
    } catch {
      return []
    }
  }

  /**
   * Get session status for all sessions
   */
  async getSessionStatuses(): Promise<Record<string, SessionStatus>> {
    try {
      const res = await fetch(`${this.baseUrl}/session/status`)
      if (!res.ok) return {}
      return res.json()
    } catch {
      return {}
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}`, {
        method: 'DELETE',
      })
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * Abort a running session
   */
  async abortSession(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/abort`, {
        method: 'POST',
      })
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * Get the diff for a session
   */
  async getSessionDiff(sessionId: string, messageId?: string): Promise<FileDiff[]> {
    try {
      const url = new URL(`${this.baseUrl}/session/${sessionId}/diff`)
      if (messageId) {
        url.searchParams.set('messageID', messageId)
      }
      const res = await fetch(url.toString())
      if (!res.ok) return []
      return res.json()
    } catch {
      return []
    }
  }

  /**
   * Get todos for a session
   */
  async getSessionTodos(sessionId: string): Promise<Todo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/todo`)
      if (!res.ok) return []
      return res.json()
    } catch {
      return []
    }
  }

  // ============================================
  // Messages
  // ============================================

  /**
   * Send a message and wait for response
   */
  async sendMessage(
    sessionId: string,
    parts: Part[],
    options?: {
      model?: string
      agent?: string
      noReply?: boolean
      system?: string
    }
  ): Promise<MessageResponse> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts, ...options }),
    })
    if (!res.ok) {
      throw new Error(`Failed to send message: ${res.statusText}`)
    }
    return res.json()
  }

  /**
   * Send a message asynchronously (non-blocking)
   */
  async sendMessageAsync(
    sessionId: string,
    parts: Part[],
    options?: {
      model?: string
      agent?: string
      system?: string
    }
  ): Promise<void> {
    // Convert model string to object format expected by OpenCode API
    const body: Record<string, unknown> = { parts }
    if (options?.model) {
      body.model = { providerID: 'opencode', modelID: options.model }
    }
    if (options?.agent) body.agent = options.agent
    if (options?.system) body.system = options.system

    const res = await fetch(`${this.baseUrl}/session/${sessionId}/prompt_async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`Failed to send async message: ${res.statusText}`)
    }
  }

  /**
   * Send a text message (convenience method)
   */
  async sendTextMessage(sessionId: string, text: string): Promise<MessageResponse> {
    const textPart: TextPart = { type: 'text', text }
    return this.sendMessage(sessionId, [textPart])
  }

  /**
   * Send a text message asynchronously (convenience method)
   */
  async sendTextMessageAsync(
    sessionId: string,
    text: string,
    options?: { model?: string; agent?: string }
  ): Promise<void> {
    const textPart: TextPart = { type: 'text', text }
    return this.sendMessageAsync(sessionId, [textPart], options)
  }

  /**
   * Get messages for a session
   */
  async getMessages(sessionId: string, limit?: number): Promise<MessageResponse[]> {
    try {
      const url = new URL(`${this.baseUrl}/session/${sessionId}/message`)
      if (limit) {
        url.searchParams.set('limit', limit.toString())
      }
      const res = await fetch(url.toString())
      if (!res.ok) return []
      return res.json()
    } catch {
      return []
    }
  }

  /**
   * Execute a slash command
   */
  async executeCommand(
    sessionId: string,
    command: string,
    args?: Record<string, unknown>,
    options?: { agent?: string; model?: string }
  ): Promise<MessageResponse> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, arguments: args, ...options }),
    })
    if (!res.ok) {
      throw new Error(`Failed to execute command: ${res.statusText}`)
    }
    return res.json()
  }

  /**
   * Run a shell command
   */
  async runShellCommand(
    sessionId: string,
    command: string,
    agent: string,
    model?: string
  ): Promise<MessageResponse> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/shell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, agent, model }),
    })
    if (!res.ok) {
      throw new Error(`Failed to run shell command: ${res.statusText}`)
    }
    return res.json()
  }

  // ============================================
  // Events (SSE)
  // ============================================

  /**
   * Subscribe to server-sent events
   */
  subscribeToEvents(onEvent: (event: OpenCodeEvent) => void): void {
    this.eventListeners.add(onEvent)

    // Only create EventSource if not already connected
    if (!this.eventSource) {
      this.eventSource = new EventSource(`${this.baseUrl}/event`)

      this.eventSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as OpenCodeEvent
          // Notify all listeners
          this.eventListeners.forEach((listener) => listener(event))
        } catch {
          // Ignore parse errors
        }
      }

      this.eventSource.onerror = () => {
        // EventSource will automatically reconnect
      }
    }
  }

  /**
   * Unsubscribe a specific listener
   */
  unsubscribeListener(onEvent: (event: OpenCodeEvent) => void): void {
    this.eventListeners.delete(onEvent)
  }

  /**
   * Close the event stream and remove all listeners
   */
  unsubscribe(): void {
    this.eventListeners.clear()
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  /**
   * Check if currently subscribed to events
   */
  isSubscribed(): boolean {
    return this.eventSource !== null && this.eventSource.readyState !== EventSource.CLOSED
  }

  // ============================================
  // Files
  // ============================================

  /**
   * List files in a directory
   */
  async listFiles(path?: string): Promise<unknown[]> {
    try {
      const url = new URL(`${this.baseUrl}/file`)
      if (path) {
        url.searchParams.set('path', path)
      }
      const res = await fetch(url.toString())
      if (!res.ok) return []
      return res.json()
    } catch {
      return []
    }
  }

  /**
   * Read file content
   */
  async readFile(path: string): Promise<{ path: string; content: string } | null> {
    try {
      const url = new URL(`${this.baseUrl}/file/content`)
      url.searchParams.set('path', path)
      const res = await fetch(url.toString())
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  /**
   * Search for text in files
   */
  async findInFiles(pattern: string): Promise<unknown[]> {
    try {
      const url = new URL(`${this.baseUrl}/find`)
      url.searchParams.set('pattern', pattern)
      const res = await fetch(url.toString())
      if (!res.ok) return []
      return res.json()
    } catch {
      return []
    }
  }

  /**
   * Find files by name
   */
  async findFiles(query: string, type?: 'file' | 'directory', limit?: number): Promise<string[]> {
    try {
      const url = new URL(`${this.baseUrl}/find/file`)
      url.searchParams.set('query', query)
      if (type) url.searchParams.set('type', type)
      if (limit) url.searchParams.set('limit', limit.toString())
      const res = await fetch(url.toString())
      if (!res.ok) return []
      return res.json()
    } catch {
      return []
    }
  }
}

// Export a default instance for convenience
export const opencode = new OpenCodeClient()
