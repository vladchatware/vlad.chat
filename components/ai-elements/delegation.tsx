'use client'

/**
 * Delegation Progress Component
 * Displays OpenCode's work progress inline in chat
 */

import { useMemo } from 'react'
import type { OpenCodeEvent } from '@/lib/opencode-types'
import { cn } from '@/lib/utils'
import {
  FileEdit,
  Terminal,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  FolderOpen,
} from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface DelegationProgressProps {
  events: OpenCodeEvent[]
  className?: string
}

export function DelegationProgress({ events, className }: DelegationProgressProps) {
  // Filter and group events for display
  const displayEvents = useMemo(() => {
    return events.filter((event) => {
      // Only show relevant event types
      const showTypes = [
        'message.part.text',
        'message.part.tool-invocation',
        'file.changed',
        'session.status',
      ]
      return showTypes.includes(event.type)
    })
  }, [events])

  if (displayEvents.length === 0) {
    return null
  }

  // Check if there's an active/running session
  const isRunning = events.some(
    (e) => e.type === 'session.status' && e.properties.status === 'running'
  )

  return (
    <div
      className={cn(
        'space-y-2 border-l-2 pl-4 py-2',
        isRunning ? 'border-blue-500' : 'border-green-500',
        className
      )}
    >
      <div className="flex items-center gap-2">
        {isRunning ? (
          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        )}
        <span className={cn('text-sm font-medium', isRunning ? 'text-blue-600' : 'text-green-600')}>
          {isRunning ? 'OpenCode working...' : 'OpenCode completed'}
        </span>
      </div>

      <div className="space-y-1">
        {displayEvents.map((event, i) => (
          <DelegationEventItem key={i} event={event} />
        ))}
      </div>
    </div>
  )
}

interface DelegationEventItemProps {
  event: OpenCodeEvent
}

function DelegationEventItem({ event }: DelegationEventItemProps) {
  switch (event.type) {
    case 'message.part.text': {
      const text = event.properties.text as string
      // Only show non-empty text
      if (!text?.trim()) return null
      return (
        <p className="text-sm text-muted-foreground pl-6">
          {text.length > 200 ? `${text.slice(0, 200)}...` : text}
        </p>
      )
    }

    case 'message.part.tool-invocation': {
      const toolInvocation = event.properties.toolInvocation as {
        id: string
        name: string
        input: Record<string, unknown>
        state: 'pending' | 'running' | 'completed' | 'failed'
      }

      const stateIcon = {
        pending: <Loader2 className="w-3 h-3 text-gray-400" />,
        running: <Loader2 className="w-3 h-3 animate-spin text-blue-500" />,
        completed: <CheckCircle2 className="w-3 h-3 text-green-500" />,
        failed: <XCircle className="w-3 h-3 text-red-500" />,
      }[toolInvocation.state]

      // Get a friendly display for the tool
      const toolDisplay = getToolDisplay(toolInvocation.name, toolInvocation.input)

      return (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm hover:bg-muted/50 rounded px-1 -mx-1 w-full text-left">
            {stateIcon}
            <span className="font-mono text-xs bg-muted px-1 rounded">
              {toolInvocation.name}
            </span>
            {toolDisplay.summary && (
              <span className="text-muted-foreground truncate">{toolDisplay.summary}</span>
            )}
          </CollapsibleTrigger>
          {toolDisplay.details && (
            <CollapsibleContent>
              <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
                {toolDisplay.details}
              </pre>
            </CollapsibleContent>
          )}
        </Collapsible>
      )
    }

    case 'file.changed': {
      const path = event.properties.path as string
      const action = event.properties.action as 'created' | 'modified' | 'deleted'

      const actionColor = {
        created: 'text-green-600',
        modified: 'text-yellow-600',
        deleted: 'text-red-600',
      }[action]

      const actionIcon = {
        created: <FileText className="w-3 h-3" />,
        modified: <FileEdit className="w-3 h-3" />,
        deleted: <XCircle className="w-3 h-3" />,
      }[action]

      return (
        <div className="flex items-center gap-2 text-sm">
          <span className={actionColor}>{actionIcon}</span>
          <span className="text-muted-foreground">{action}:</span>
          <span className="font-mono text-xs">{path}</span>
        </div>
      )
    }

    case 'session.status': {
      // Don't render status events directly, they're used for the header
      return null
    }

    default:
      return null
  }
}

/**
 * Get a friendly display for a tool invocation
 */
function getToolDisplay(
  name: string,
  input: Record<string, unknown>
): { summary?: string; details?: string } {
  switch (name) {
    case 'read_file':
    case 'file.read':
      return {
        summary: input.path as string,
        details: undefined,
      }

    case 'write_file':
    case 'file.write':
      return {
        summary: input.path as string,
        details: input.content ? `${(input.content as string).slice(0, 100)}...` : undefined,
      }

    case 'execute':
    case 'shell':
    case 'bash':
      return {
        summary: `$ ${input.command as string}`,
        details: undefined,
      }

    case 'search':
    case 'grep':
      return {
        summary: `"${input.pattern ?? input.query}"`,
        details: undefined,
      }

    case 'list_directory':
    case 'ls':
      return {
        summary: (input.path as string) ?? '.',
        details: undefined,
      }

    default:
      // For unknown tools, try to show the first string input
      const firstInput = Object.entries(input).find(([, v]) => typeof v === 'string')
      return {
        summary: firstInput ? (firstInput[1] as string).slice(0, 50) : undefined,
        details: JSON.stringify(input, null, 2),
      }
  }
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
