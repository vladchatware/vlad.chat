"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type ScrollContextValue = {
  isAtBottom: boolean;
  scrollToBottom: () => void;
};

const ScrollContext = createContext<ScrollContextValue>({
  isAtBottom: true,
  scrollToBottom: () => {},
});

export const useScrollContext = () => useContext(ScrollContext);

export type ConversationProps = ComponentProps<"div"> & {
  children: ReactNode;
};

export const Conversation = ({
  className,
  children,
  ...props
}: ConversationProps) => {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const userScrolledUp = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const checkIfAtBottom = useCallback(() => {
    const threshold = 150; // Increased threshold for better detection
    const scrollTop = window.scrollY;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    return scrollTop + windowHeight >= documentHeight - threshold;
  }, []);

  const scrollToBottom = useCallback(() => {
    userScrolledUp.current = false;
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  // Track user scroll
  useEffect(() => {
    let lastScrollTop = window.scrollY;

    const handleScroll = () => {
      const currentScrollTop = window.scrollY;
      const atBottom = checkIfAtBottom();
      const scrollingDown = currentScrollTop > lastScrollTop;
      const scrollingUp = currentScrollTop < lastScrollTop;

      // User scrolled up - disable auto-scroll
      if (scrollingUp && !atBottom) {
        userScrolledUp.current = true;
      }

      // User scrolled back to bottom - re-enable auto-scroll
      if (atBottom && userScrolledUp.current) {
        userScrolledUp.current = false;
      }

      // Also re-enable if user is actively scrolling down and gets close to bottom
      if (scrollingDown && atBottom) {
        userScrolledUp.current = false;
      }

      setIsAtBottom(atBottom);
      lastScrollTop = currentScrollTop;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [checkIfAtBottom]);

  // Auto-scroll when content changes (if user hasn't scrolled up)
  useEffect(() => {
    if (!contentRef.current) return;

    const observer = new MutationObserver(() => {
      if (!userScrolledUp.current) {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "smooth",
        });
      }
    });

    observer.observe(contentRef.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, []);

  return (
    <ScrollContext.Provider value={{ isAtBottom, scrollToBottom }}>
      <div
        ref={contentRef}
        className={cn("relative", className)}
        role="log"
        {...props}
      >
        {children}
      </div>
    </ScrollContext.Provider>
  );
};

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => <div className={cn("p-4", className)} {...props} />;

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useScrollContext();

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "fixed bottom-52 left-[50%] translate-x-[-50%] rounded-full z-50",
          className
        )}
        onClick={scrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};