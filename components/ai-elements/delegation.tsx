'use client'

/**
 * Delegation Progress Component
 * Displays OpenCode's work progress inline in chat using the Tool component
 */

import { useMemo } from 'react'
import type { OpenCodeEvent } from '@/lib/opencode-types'
import { cn } from '@/lib/utils'
import {
  FileEdit,
  Terminal,
  CheckCircle2,
  Loader2,
  FileText,
  Code2,
  XCircle,
} from 'lucide-react'
import { Message, MessageContent } from '@/components/ai-elements/message'
import { Response } from '@/components/ai-elements/response'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import type { ToolUIPart } from 'ai'

interface DelegationProgressProps {
  events: OpenCodeEvent[]
  className?: string
  hideHeader?: boolean
}

// Map OpenCode tool states to ToolUIPart states
function mapToolState(state: string): ToolUIPart['state'] {
  switch (state) {
    case 'pending':
      return 'input-streaming'
    case 'running':
      return 'input-available'
    case 'completed':
      return 'output-available'
    case 'failed':
      return 'output-error'
    default:
      return 'input-streaming'
  }
}

// Get a friendly title for tools
function getToolTitle(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'read_file':
    case 'file.read':
    case 'Read':
      return `Read: ${(input.path as string) ?? 'file'}`
    case 'write_file':
    case 'file.write':
    case 'Write':
      return `Write: ${(input.path as string) ?? 'file'}`
    case 'edit_file':
    case 'file.edit':
    case 'StrReplace':
      return `Edit: ${(input.path as string) ?? 'file'}`
    case 'execute':
    case 'shell':
    case 'bash':
    case 'Shell':
      return `Shell: ${((input.command as string) ?? '').slice(0, 40)}${((input.command as string) ?? '').length > 40 ? '...' : ''}`
    case 'search':
    case 'grep':
    case 'Grep':
      return `Search: "${(input.pattern as string) ?? (input.query as string) ?? ''}"`
    case 'list_directory':
    case 'ls':
    case 'LS':
      return `List: ${(input.path as string) ?? '.'}`
    case 'Glob':
      return `Find: ${(input.glob_pattern as string) ?? ''}`
    case 'Task':
      return `Task: ${(input.description as string) ?? 'subtask'}`
    case 'SemanticSearch':
      return `Semantic: ${((input.query as string) ?? '').slice(0, 30)}...`
    default:
      return name
  }
}

export function DelegationProgress({
  events,
  className,
  hideHeader = false,
}: DelegationProgressProps) {
  // Process events into displayable items
  const { toolInvocations, textMessages, fileChanges, isRunning } = useMemo(() => {
    const toolMap = new Map<string, {
      id: string
      name: string
      input: Record<string, unknown>
      output?: unknown
      state: string
      errorText?: string
    }>()

    const texts: string[] = []
    const files: { path: string; action: string }[] = []
    let running = false

    for (const event of events) {
      // Handle message.part.updated events (actual OpenCode format)
      if (event.type === 'message.part.updated') {
        const part = event.properties.part as {
          id: string
          type: string
          text?: string
          tool?: string
          callID?: string
          state?: {
            status: string
            input?: Record<string, unknown>
            output?: unknown
          }
        }

        if (part.type === 'tool' && part.callID && part.state) {
          // Tool invocation update
          const existing = toolMap.get(part.callID)
          toolMap.set(part.callID, {
            id: part.callID,
            name: part.tool ?? existing?.name ?? 'unknown',
            input: part.state.input ?? existing?.input ?? {},
            output: part.state.output ?? existing?.output,
            state: part.state.status,
            errorText: existing?.errorText,
          })
        } else if (part.type === 'text' && part.text?.trim()) {
          // Only add final text (when time.end is set), not streaming deltas
          const time = (event.properties.part as { time?: { end?: number } }).time
          if (time?.end) {
            texts.push(part.text)
          }
        }
        continue
      }

      // Legacy event format support
      switch (event.type) {
        case 'message.part.tool-invocation': {
          const inv = event.properties.toolInvocation as {
            id: string
            name: string
            input: Record<string, unknown>
            state: string
          }
          const existing = toolMap.get(inv.id)
          toolMap.set(inv.id, {
            ...existing,
            id: inv.id,
            name: inv.name,
            input: inv.input ?? existing?.input ?? {},
            state: inv.state,
          })
          break
        }
        case 'message.part.tool-result': {
          const result = event.properties.toolResult as {
            id: string
            result: unknown
            isError?: boolean
          }
          const existing = toolMap.get(result.id)
          if (existing) {
            toolMap.set(result.id, {
              ...existing,
              output: result.result,
              state: result.isError ? 'failed' : 'completed',
              errorText: result.isError ? String(result.result) : undefined,
            })
          }
          break
        }
        case 'message.part.text': {
          const text = event.properties.text as string
          if (text?.trim()) {
            texts.push(text)
          }
          break
        }
        case 'file.changed': {
          files.push({
            path: event.properties.path as string,
            action: event.properties.action as string,
          })
          break
        }
        case 'session.status': {
          const status = event.properties.status as { type?: string } | string
          const statusType = typeof status === 'string' ? status : status?.type
          if (statusType === 'busy' || statusType === 'running') {
            running = true
          } else if (statusType === 'idle') {
            running = false
          }
          break
        }
      }
    }

    return {
      toolInvocations: Array.from(toolMap.values()),
      textMessages: texts,
      fileChanges: files,
      isRunning: running,
    }
  }, [events])

  // Always show at least a status indicator when we have events
  // This prevents the "stuck" state where events exist but nothing displays
  const hasContent = toolInvocations.length > 0 || textMessages.length > 0 || fileChanges.length > 0
  
  if (!hasContent && events.length === 0) {
    return null
  }

  // Truncate long outputs (especially file reads)
  const truncateOutput = (output: unknown, maxLength = 500): unknown => {
    if (typeof output === 'string' && output.length > maxLength) {
      return output.slice(0, maxLength) + `\n... (${output.length - maxLength} more characters)`
    }
    return output
  }

  // Determine if OpenCode is actively running (default to running if we have events but no status yet)
  const showRunning = isRunning || (events.length > 0 && !hasContent)

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header showing OpenCode status - always show when we have events but no content */}
      {(!hideHeader || !hasContent) && (
        <div className="flex items-center gap-2">
          <div className={cn(
            'flex items-center justify-center w-6 h-6 rounded-md',
            showRunning ? 'bg-blue-500/10' : 'bg-green-500/10'
          )}>
            {showRunning ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            ) : (
              <Code2 className="w-4 h-4 text-green-500" />
            )}
          </div>
          <span className={cn(
            'text-sm font-medium',
            showRunning ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'
          )}>
            {showRunning ? 'OpenCode is working...' : 'OpenCode completed'}
          </span>
        </div>
      )}

      {/* Tool invocations FIRST (chronological order) */}
      {toolInvocations.map((tool) => (
        <Tool key={tool.id} defaultOpen={false}>
          <ToolHeader
            title={getToolTitle(tool.name, tool.input)}
            type="tool-opencode"
            state={mapToolState(tool.state)}
          />
          <ToolContent>
            <ToolInput input={tool.input} />
            {(tool.output || tool.errorText) && (
              <ToolOutput
                output={truncateOutput(tool.output)}
                errorText={tool.errorText}
              />
            )}
          </ToolContent>
        </Tool>
      ))}

      {/* File changes */}
      {fileChanges.length > 0 && (
        <div className="space-y-1 px-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Files Changed
          </div>
          {fileChanges.map((file, i) => {
            const actionConfig = {
              created: { icon: FileText, color: 'text-green-600', label: 'created' },
              modified: { icon: FileEdit, color: 'text-yellow-600', label: 'modified' },
              deleted: { icon: XCircle, color: 'text-red-600', label: 'deleted' },
            }[file.action] ?? { icon: FileText, color: 'text-gray-600', label: file.action }

            const Icon = actionConfig.icon

            return (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Icon className={cn('w-4 h-4', actionConfig.color)} />
                <span className="font-mono text-xs">{file.path}</span>
                <span className={cn('text-xs', actionConfig.color)}>
                  {actionConfig.label}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Text messages from OpenCode LAST (the final response) */}
      {textMessages.length > 0 && (
        <Message from="assistant">
          <MessageContent>
            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
              <Terminal className="w-3 h-3" />
              <span>OpenCode:</span>
            </div>
            {textMessages.map((text, i) => (
              <Response key={i}>
                {text}
              </Response>
            ))}
          </MessageContent>
        </Message>
      )}
    </div>
  )
}

/**
 * Compact delegation indicator for message bubbles
 */
export function DelegationIndicator({ isActive }: { isActive: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {isActive ? (
        <>
          <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
          <span>Working on your code...</span>
        </>
      ) : (
        <>
          <Terminal className="w-3 h-3 text-green-500" />
          <span>Delegated to OpenCode</span>
        </>
      )}
    </div>
  )
}
/**
 * Status message for common status bars
 */
export function DelegationStatus({ events, className }: { events: OpenCodeEvent[], className?: string }) {
  const status = useMemo((): 'running' | 'completed' | 'error' | null => {
    if (events.length === 0) return null

    // Process events chronologically to find the latest state
    let lastKnown: 'running' | 'completed' | 'error' | null = null

    for (const event of events) {
      if (event.type === 'session.status') {
        const rawStatus = event.properties.status as { type?: string } | string
        const statusType = typeof rawStatus === 'string' ? rawStatus : rawStatus?.type

        if (statusType === 'busy' || statusType === 'running') {
          lastKnown = 'running'
        } else if (statusType === 'idle') {
          lastKnown = 'completed'
        } else if (statusType === 'error') {
          lastKnown = 'error'
        }
      }

      // Also check part updates for "running" state
      if (event.type === 'message.part.updated') {
        const part = event.properties.part as any
        if (part.state?.status === 'running') {
          lastKnown = 'running'
        }
      }
    }

    return lastKnown || 'completed'
  }, [events])

  if (!status) return null

  const config = {
    running: {
      text: 'OpenCode is working...',
      bullet: 'bg-blue-500 animate-pulse shadow-[0_0_4px_rgba(59,130,246,0.4)]',
      textClass: 'text-blue-600 dark:text-blue-400'
    },
    completed: {
      text: 'OpenCode completed',
      bullet: 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]',
      textClass: 'text-emerald-600 dark:text-emerald-400'
    },
    error: {
      text: 'OpenCode error',
      bullet: 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]',
      textClass: 'text-red-600 dark:text-red-400'
    }
  }[status]

  return (
    <div className={cn('flex items-center gap-1.5 text-xs font-medium cursor-default transition-colors', className)}>
      <div className={cn('w-1.5 h-1.5 rounded-full', config.bullet)} />
      <span className={cn('opacity-80', config.textClass)}>
        {config.text}
      </span>
    </div>
  )
}
