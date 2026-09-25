"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ComputerToolResult } from "@/lib/computer-use/types";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  MonitorIcon,
  XCircleIcon,
} from "lucide-react";

const OP_LABELS: Record<ComputerToolResult["op"], string> = {
  open: "Open",
  screenshot: "Screenshot",
  act: "Act",
  handoff: "Handoff",
  end: "End",
};

export type ComputerUseCardProps = {
  result: ComputerToolResult;
  toolName?: string;
  className?: string;
};

/**
 * Renders a ComputerToolResult from the MCP trail (screenshot + status + handoff).
 * No sandbox control — display only.
 */
export function ComputerUseCard({
  result,
  toolName,
  className,
}: ComputerUseCardProps) {
  const opLabel = OP_LABELS[result.op] ?? result.op;
  const title = toolName?.startsWith("computer_")
    ? `Computer · ${opLabel}`
    : `Computer · ${opLabel}`;

  return (
    <div
      className={cn(
        "not-prose mb-4 w-full overflow-hidden rounded-md border bg-muted/50",
        className,
      )}
      data-computer-op={result.op}
      data-computer-ok={result.ok ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        {result.ok ? (
          <Badge
            variant="secondary"
            className="gap-1 rounded-full text-xs text-green-500"
          >
            <CheckCircle2Icon className="size-3.5" />
            ok
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            className="gap-1 rounded-full text-xs text-red-400"
          >
            <XCircleIcon className="size-3.5" />
            error
          </Badge>
        )}
        <Badge variant="outline" className="rounded-full text-xs capitalize">
          {result.op}
        </Badge>
        {result.budget && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {result.budget.stepsUsed}/{result.budget.maxSteps} steps
            {typeof result.budget.stepsRemaining === "number"
              ? ` · ${result.budget.stepsRemaining} left`
              : null}
          </span>
        )}
      </div>

      {result.handoff && (
        <div
          className="flex gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100"
          role="status"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="min-w-0 space-y-0.5">
            <div className="font-medium text-amber-200">
              Needs you · {result.handoff.reason}
              {result.handoff.requiresUser ? " · user action required" : null}
            </div>
            <p className="text-amber-100/90 text-xs leading-relaxed">
              {result.handoff.message}
            </p>
          </div>
        </div>
      )}

      {!result.ok && (result.error || result.code) && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {result.code ? (
            <span className="mr-2 font-mono uppercase tracking-wide opacity-80">
              {result.code}
            </span>
          ) : null}
          {result.error}
        </div>
      )}

      {(result.url || result.title || result.action) && (
        <div className="space-y-0.5 px-3 py-2 text-xs text-muted-foreground">
          {result.title ? (
            <div className="truncate font-medium text-foreground/80">
              {result.title}
            </div>
          ) : null}
          {result.url ? (
            <div className="truncate font-mono" title={result.url}>
              {result.url}
            </div>
          ) : null}
          {result.action ? (
            <div className="font-mono text-foreground/70">
              action: {result.action}
            </div>
          ) : null}
        </div>
      )}

      {result.screenshotUrl ? (
        <div className="bg-black/40 p-2 sm:p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- remote/API screenshot URLs; Next Image not configured for this route */}
          <img
            src={result.screenshotUrl}
            alt={`Computer ${result.op} screenshot`}
            className="mx-auto max-h-[420px] w-full rounded border border-border/40 object-contain bg-black"
            loading="lazy"
            decoding="async"
            width={result.width ?? 1280}
            height={result.height ?? 720}
          />
        </div>
      ) : null}
    </div>
  );
}
