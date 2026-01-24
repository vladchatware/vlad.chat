'use client'

/**
 * OpenCode Setup Instructions
 * Shown when OpenCode is not detected, helps users connect
 */

import { useState } from 'react'
import { useOpenCodeSafe } from '@/lib/opencode-context'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Terminal, Copy, Check, ExternalLink, RefreshCw } from 'lucide-react'

interface OpenCodeSetupProps {
  /** Always show, even when connected (default: false) */
  alwaysShow?: boolean
  /** Compact mode (default: false) */
  compact?: boolean
  /** Custom class name */
  className?: string
}

export function OpenCodeSetup({
  alwaysShow = false,
  compact = false,
  className,
}: OpenCodeSetupProps) {
  const opencode = useOpenCodeSafe()
  const [copied, setCopied] = useState(false)

  // If not within provider, show setup anyway
  const isConnected = opencode?.isConnected ?? false

  // Don't show if connected (unless alwaysShow)
  if (isConnected && !alwaysShow) {
    return null
  }

  const command = 'opencode serve --cors https://vlad.chat'

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = command
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleRefresh = () => {
    opencode?.reconnect()
  }

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Terminal className="w-4 h-4" />
        <span>Run</span>
        <code
          className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs cursor-pointer hover:bg-muted/80"
          onClick={handleCopy}
          title="Click to copy"
        >
          {command}
        </code>
        {copied && <Check className="w-3 h-3 text-green-500" />}
      </div>
    )
  }

  return (
    <Card className={cn('bg-muted/50', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-primary" />
          <h3 className="font-medium">Connect your local OpenCode</h3>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          To let Vlad work directly on your code, run OpenCode in server mode:
        </p>

        <div className="flex items-center gap-2">
          <code className="flex-1 bg-background p-3 rounded font-mono text-sm border">
            {command}
          </code>
          <Button variant="outline" size="icon" onClick={handleCopy} title="Copy command">
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <a
            href="https://opencode.ai/docs/server/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            Learn more
          </a>

          {opencode && (
            <Button variant="ghost" size="sm" onClick={handleRefresh} className="gap-1">
              <RefreshCw className="w-3 h-3" />
              Retry connection
            </Button>
          )}
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>Note:</strong> OpenCode runs on your machine and gives Vlad access to:
          </p>
          <ul className="list-disc list-inside pl-2 space-y-0.5">
            <li>Read and edit files in your project</li>
            <li>Run terminal commands</li>
            <li>Search and navigate your codebase</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Inline setup prompt for chat
 */
export function OpenCodeSetupPrompt({ className }: { className?: string }) {
  const opencode = useOpenCodeSafe()

  if (opencode?.isConnected) {
    return null
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-sm',
        className
      )}
    >
      <Terminal className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">
        Want Vlad to work on your code? Run{' '}
        <code className="bg-muted/80 px-1.5 py-0.5 rounded font-mono text-[11px] text-primary select-all">
          opencode serve --cors https://vlad.chat
        </code>
      </span>
    </div>
  )
}
