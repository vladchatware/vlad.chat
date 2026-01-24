/**
 * OpenCode Server API TypeScript Types
 * Based on https://opencode.ai/docs/server/
 */

// Session types
export interface Session {
  id: string
  title?: string
  parentID?: string
  createdAt: string
  updatedAt: string
  share?: {
    id: string
    url: string
  }
}

export interface SessionStatus {
  status: 'idle' | 'running' | 'error'
  error?: string
}

// Message types
export interface Message {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  createdAt: string
}

export interface MessageResponse {
  info: Message
  parts: Part[]
}

// Part types - different content types in a message
export type Part = 
  | TextPart 
  | ToolInvocationPart 
  | ToolResultPart 
  | FilePart 
  | StepStartPart

export interface TextPart {
  type: 'text'
  text: string
}

export interface ToolInvocationPart {
  type: 'tool-invocation'
  toolInvocation: {
    id: string
    name: string
    input: Record<string, unknown>
    state: 'pending' | 'running' | 'completed' | 'failed'
  }
}

export interface ToolResultPart {
  type: 'tool-result'
  toolResult: {
    id: string
    result: unknown
    isError?: boolean
  }
}

export interface FilePart {
  type: 'file'
  file: {
    path: string
    content?: string
  }
}

export interface StepStartPart {
  type: 'step-start'
  stepStart: {
    id: string
    name: string
  }
}

// File types
export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
}

export interface FileContent {
  path: string
  content: string
  mimeType?: string
}

export interface FileDiff {
  path: string
  oldContent?: string
  newContent: string
  hunks?: DiffHunk[]
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

// Event types for SSE stream
export interface OpenCodeEvent {
  type: string
  properties: Record<string, unknown>
}

// Common event types
export interface MessagePartTextEvent extends OpenCodeEvent {
  type: 'message.part.text'
  properties: {
    sessionID: string
    messageID: string
    text: string
  }
}

export interface MessagePartToolInvocationEvent extends OpenCodeEvent {
  type: 'message.part.tool-invocation'
  properties: {
    sessionID: string
    messageID: string
    toolInvocation: {
      id: string
      name: string
      input: Record<string, unknown>
      state: 'pending' | 'running' | 'completed' | 'failed'
    }
  }
}

export interface FileChangedEvent extends OpenCodeEvent {
  type: 'file.changed'
  properties: {
    path: string
    action: 'created' | 'modified' | 'deleted'
  }
}

export interface SessionStatusEvent extends OpenCodeEvent {
  type: 'session.status'
  properties: {
    sessionID: string
    status: 'idle' | 'running' | 'error'
  }
}

// Health check response
export interface HealthResponse {
  healthy: boolean
  version: string
}

// Project types
export interface Project {
  id: string
  path: string
  name: string
}

// Todo types
export interface Todo {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

// Provider types
export interface Provider {
  id: string
  name: string
  models: Model[]
}

export interface Model {
  id: string
  name: string
  provider: string
}

// Agent types
export interface Agent {
  id: string
  name: string
  description?: string
}

// Command types
export interface Command {
  name: string
  description: string
  arguments?: CommandArgument[]
}

export interface CommandArgument {
  name: string
  description: string
  required: boolean
}

// Delegation message type (for vlad.chat integration)
export interface DelegationMessage {
  type: 'delegation'
  task: string
  context?: string
}
