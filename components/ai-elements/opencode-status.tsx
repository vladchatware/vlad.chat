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
}

export function OpenCodeStatus({
  showLabel = true,
  compact = false,
  className,
}: OpenCodeStatusProps) {
  const opencode = useOpenCodeSafe()

  // If not within provider, don't render anything
  if (!opencode) return null

  const { isConnected, isConnecting, serverInfo } = opencode

  const label = isConnecting
    ? 'Connecting...'
    : isConnected
      ? 'Local coding enabled'
      : 'OpenCode not detected'

  const tooltipContent = isConnected
    ? `Connected to OpenCode ${serverInfo?.version ?? ''} - Vlad can now work on your local code`
    : 'Run "opencode serve" to let Vlad work on your local files'

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all',
                isConnecting && 'bg-yellow-500/10 text-yellow-600',
                isConnected && !isConnecting && 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20',
                !isConnected && !isConnecting && 'bg-muted text-muted-foreground',
                className
              )}
            >
              {isConnecting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : isConnected ? (
                <Zap className="w-3 h-3" />
              ) : (
                <Terminal className="w-3 h-3" />
              )}
              <span className="hidden lg:inline">
                {isConnected ? 'Local' : 'Connect'}
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
              'flex items-center gap-2 px-3 py-1.5 rounded-full transition-all',
              isConnecting && 'bg-yellow-500/10 text-yellow-600',
              isConnected && !isConnecting && 'bg-emerald-500/10 text-emerald-600',
              !isConnected && !isConnecting && 'bg-muted text-muted-foreground',
              className
            )}
          >
            {isConnecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isConnected ? (
              <Zap className="w-4 h-4" />
            ) : (
              <Terminal className="w-4 h-4" />
            )}
            <div 
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                isConnecting && 'bg-yellow-500 animate-pulse',
                isConnected && !isConnecting && 'bg-emerald-500',
                !isConnected && !isConnecting && 'bg-gray-400'
              )}
            />
            {showLabel && (
              <span className="text-sm font-medium">{label}</span>
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
