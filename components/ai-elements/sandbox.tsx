"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
  type HTMLAttributes,
} from "react";

type SandboxState = ToolUIPart["state"];
type TabsContextValue = {
  activeTab: string;
  setActiveTab: (value: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useSandboxTabs() {
  const context = useContext(TabsContext);
  if (!context) throw new Error("Sandbox tabs must be used inside SandboxTabs");
  return context;
}

export type SandboxProps = ComponentProps<typeof Collapsible>;

export function Sandbox({ className, ...props }: SandboxProps) {
  return (
    <Collapsible
      className={cn("w-full overflow-hidden rounded-md border bg-background", className)}
      {...props}
    />
  );
}

export type SandboxHeaderProps = Omit<HTMLAttributes<HTMLButtonElement>, "title"> & {
  title?: string;
  state: SandboxState;
  statusLabel?: string;
};

export function SandboxHeader({
  children,
  className,
  state,
  statusLabel,
  title,
  ...props
}: SandboxHeaderProps) {
  const statusLabels: Record<SandboxState, string> = {
    "input-streaming": "Pending",
    "input-available": "Running",
    "output-available": "Completed",
    "output-error": "Error",
  };

  return (
    <CollapsibleTrigger asChild>
      <button
        className={cn(
          "flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left",
          className,
        )}
        type="button"
        {...props}
      >
        <span className="flex min-w-0 items-center gap-2">
          {title && <span className="truncate text-sm font-medium">{title}</span>}
          {children}
        </span>
        <Badge className="shrink-0" variant="secondary">
          {statusLabel ?? statusLabels[state]}
        </Badge>
      </button>
    </CollapsibleTrigger>
  );
}

export type SandboxContentProps = ComponentProps<typeof CollapsibleContent>;

export function SandboxContent({ className, ...props }: SandboxContentProps) {
  return (
    <CollapsibleContent
      className={cn("border-t", className)}
      {...props}
    />
  );
}

export type SandboxTabsProps = HTMLAttributes<HTMLDivElement> & {
  defaultValue: string;
};

export function SandboxTabs({
  className,
  defaultValue,
  ...props
}: SandboxTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultValue);

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={className} {...props} />
    </TabsContext.Provider>
  );
}

export type SandboxTabsBarProps = HTMLAttributes<HTMLDivElement>;

export function SandboxTabsBar({ className, ...props }: SandboxTabsBarProps) {
  return (
    <div className={cn("flex items-center border-b px-3", className)} {...props} />
  );
}

export type SandboxTabsListProps = HTMLAttributes<HTMLDivElement>;

export function SandboxTabsList({ className, ...props }: SandboxTabsListProps) {
  return (
    <div
      className={cn("flex items-center gap-4", className)}
      role="tablist"
      {...props}
    />
  );
}

export type SandboxTabsTriggerProps = ComponentProps<"button"> & {
  value: string;
};

export function SandboxTabsTrigger({
  children,
  className,
  value,
  ...props
}: SandboxTabsTriggerProps) {
  const { activeTab, setActiveTab } = useSandboxTabs();
  const selected = activeTab === value;

  return (
    <button
      aria-selected={selected}
      className={cn(
        "border-b-2 px-1 py-3 text-sm font-medium transition-colors",
        selected
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
        className,
      )}
      onClick={() => setActiveTab(value)}
      role="tab"
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export type SandboxTabContentProps = HTMLAttributes<HTMLDivElement> & {
  value: string;
};

export function SandboxTabContent({
  children,
  className,
  value,
  ...props
}: SandboxTabContentProps) {
  const { activeTab } = useSandboxTabs();
  if (activeTab !== value) return null;

  return (
    <div className={cn("p-3", className)} role="tabpanel" {...props}>
      {children}
    </div>
  );
}
