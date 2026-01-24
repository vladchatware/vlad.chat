'use client'

/**
 * Delegation Card Component
 * Shows a nice UI for delegated tasks instead of raw JSON
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { 
  Code2, 
  ChevronDown, 
  ChevronRight,
  Sparkles,
  CheckCircle2,
  Loader2,
  Terminal
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

interface DelegationCardProps {
  task: string
  context?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  className?: string
}

export function DelegationCard({ 
  task, 
  context, 
  status,
  className 
}: DelegationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const statusConfig = {
    pending: {
      icon: <Sparkles className="w-4 h-4" />,
      label: 'Delegating to OpenCode...',
      bgColor: 'bg-violet-500/10',
      borderColor: 'border-violet-500/30',
      iconColor: 'text-violet-500',
      labelColor: 'text-violet-600 dark:text-violet-400',
    },
    running: {
      icon: <Loader2 className="w-4 h-4 animate-spin" />,
      label: 'OpenCode is working...',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/30',
      iconColor: 'text-blue-500',
      labelColor: 'text-blue-600 dark:text-blue-400',
    },
    completed: {
      icon: <CheckCircle2 className="w-4 h-4" />,
      label: 'Completed',
      bgColor: 'bg-green-500/10',
      borderColor: 'border-green-500/30',
      iconColor: 'text-green-500',
      labelColor: 'text-green-600 dark:text-green-400',
    },
    error: {
      icon: <Terminal className="w-4 h-4" />,
      label: 'Failed',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30',
      iconColor: 'text-red-500',
      labelColor: 'text-red-600 dark:text-red-400',
    },
  }

  const config = statusConfig[status]

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-xl border overflow-hidden',
        config.bgColor,
        config.borderColor,
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={cn(
          'flex items-center justify-center w-8 h-8 rounded-lg',
          config.bgColor,
          config.iconColor
        )}>
          <Code2 className="w-4 h-4" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-medium', config.iconColor)}>
              {config.icon}
            </span>
            <span className={cn('text-sm font-medium', config.labelColor)}>
              {config.label}
            </span>
          </div>
          <p className="text-sm text-foreground/80 truncate mt-0.5">
            {task.length > 80 ? `${task.slice(0, 80)}...` : task}
          </p>
        </div>
      </div>

      {/* Expandable Details */}
      {(context || task.length > 80) && (
        <>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors border-t border-current/10"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            {isExpanded ? 'Hide details' : 'Show details'}
          </button>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-3 space-y-2">
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">Task:</span>
                    <p className="text-sm text-foreground/80 mt-1">{task}</p>
                  </div>
                  {context && (
                    <div>
                      <span className="text-xs font-medium text-muted-foreground">Context:</span>
                      <p className="text-sm text-foreground/60 mt-1">{context}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  )
}

/**
 * Inline delegation badge for compact display
 */
export function DelegationBadge({ 
  status 
}: { 
  status: 'pending' | 'running' | 'completed' | 'error' 
}) {
  const config = {
    pending: {
      icon: <Sparkles className="w-3 h-3" />,
      label: 'Delegating...',
      className: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
    },
    running: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      label: 'Working...',
      className: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    },
    completed: {
      icon: <CheckCircle2 className="w-3 h-3" />,
      label: 'Done',
      className: 'bg-green-500/10 text-green-600 border-green-500/20',
    },
    error: {
      icon: <Terminal className="w-3 h-3" />,
      label: 'Error',
      className: 'bg-red-500/10 text-red-600 border-red-500/20',
    },
  }[status]

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border',
      config.className
    )}>
      {config.icon}
      {config.label}
    </span>
  )
}
