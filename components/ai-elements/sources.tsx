"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { BookIcon, ChevronDownIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ComponentProps } from "react";
import { useState } from "react";

// Create motion versions of Lucide icons
const MotionBookIcon = motion.create(BookIcon);
const MotionChevronDownIcon = motion.create(ChevronDownIcon);

export type SourcesProps = ComponentProps<"div">;

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible
    className={cn("not-prose mb-4 text-primary text-xs", className)}
    {...props}
  />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

export const SourcesTrigger = ({
  className,
  count,
  children,
  ...props
}: SourcesTriggerProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <CollapsibleTrigger
      className={cn("flex items-center gap-2", className)}
      onClick={() => setIsOpen(!isOpen)}
      {...props}
    >
      {children ?? (
        <>
          <p className="font-medium">Used {count} sources</p>
          <MotionChevronDownIcon
            className="h-4 w-4"
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          />
        </>
      )}
    </CollapsibleTrigger>
  );
};

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({
  className,
  ...props
}: SourcesContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-3 flex w-fit flex-col gap-2",
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type SourceProps = {
  href?: string;
  title?: string;
  children?: React.ReactNode;
  className?: string;
};

export const Source = ({ href, title, children, className }: SourceProps) => (
  <motion.div
    whileHover={{ x: 4 }}
    transition={{ type: "spring", stiffness: 400, damping: 25 }}
  >
    <a
      className={cn("flex items-center gap-2", className)}
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children ?? (
        <>
          <MotionBookIcon
            className="h-4 w-4"
            whileHover={{ scale: 1.1, rotate: -5 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
          />
          <span className="block font-medium">{title}</span>
        </>
      )}
    </a>
  </motion.div>
);
