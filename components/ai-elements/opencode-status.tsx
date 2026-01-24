'use client'

/**
 * OpenCode Connection Status Indicator
 * Shows whether local OpenCode server is connected
 */

import { useOpenCodeSafe } from '@/lib/opencode-context'
import { cn } from '@/lib/utils'
import { Terminal, Loader2, Zap } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface OpenCodeStatusProps {
  /** Show label text (default: true) */
  showLabel?: boolean
  /** Compact mode - just the dot (default: false) */
  compact?: boolean
  /** Custom class name */
  className?: string
  /** Styling variant */
  variant?: 'pill' | 'minimal'
}

export function OpenCodeStatus({
  showLabel = true,
  compact = false,
  className,
  variant = 'pill',
}: OpenCodeStatusProps) {
  const opencode = useOpenCodeSafe()

  // If not within provider, don't render anything
  if (!opencode) return null

  const { isConnected, isConnecting, serverInfo } = opencode

  const label = isConnecting
    ? 'Connecting...'
    : isConnected
      ? 'Local Coding'
      : 'Connect'

  const tooltipContent = isConnected
    ? `Connected to OpenCode ${serverInfo?.version ?? ''} - Vlad can now work on your local code`
    : 'Run "opencode serve --cors https://vlad.chat" to let Vlad work on your local files'

  if (variant === 'minimal') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'flex items-center gap-1.5 text-xs font-medium cursor-default transition-colors',
                isConnecting && 'text-amber-500',
                isConnected && !isConnecting && 'text-emerald-500',
                !isConnected && !isConnecting && 'text-slate-500',
                className
              )}
            >
              <div
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  isConnecting && 'bg-amber-500 animate-pulse',
                  isConnected && !isConnecting && 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]',
                  !isConnected && !isConnecting && 'bg-slate-500'
                )}
              />
              {showLabel && (
                <span className="opacity-80">{label}</span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{tooltipContent}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'flex items-center gap-2 p-2.5 md:px-4 md:py-2 rounded-full text-sm font-medium transition-all hover:scale-105 cursor-default',
                isConnecting && 'bg-gradient-to-r from-amber-500/90 to-orange-500/90 text-white shadow-lg shadow-amber-500/20',
                isConnected && !isConnecting && 'bg-gradient-to-r from-emerald-600/90 to-teal-600/90 text-white shadow-lg shadow-emerald-500/20',
                !isConnected && !isConnecting && 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80',
                className
              )}
            >
              {isConnecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isConnected ? (
                <Zap className="w-4 h-4 fill-current" />
              ) : (
                <Terminal className="w-4 h-4" />
              )}
              <span className="hidden md:inline">
                {label}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{tooltipContent}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex items-center gap-3 px-5 py-2.5 rounded-full text-sm font-medium transition-all hover:scale-105 cursor-default',
              isConnecting && 'bg-gradient-to-r from-amber-500/90 to-orange-500/90 text-white shadow-lg shadow-amber-500/20',
              isConnected && !isConnecting && 'bg-gradient-to-r from-emerald-600/90 to-teal-600/90 text-white shadow-lg shadow-emerald-500/20',
              !isConnected && !isConnecting && 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80',
              className
            )}
          >
            {isConnecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isConnected ? (
              <Zap className="w-4 h-4 fill-current" />
            ) : (
              <Terminal className="w-4 h-4" />
            )}
            <div
              className={cn(
                'w-2 h-2 rounded-full',
                isConnecting && 'bg-white animate-pulse',
                isConnected && !isConnecting && 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]',
                !isConnected && !isConnecting && 'bg-slate-500'
              )}
            />
            {showLabel && (
              <span>{label}</span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{tooltipContent}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
