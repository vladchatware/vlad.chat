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
  /**
   * Receives the transcript scroll container so callers can drive history
   * pagination against it.
   */
  onScrollElement?: (element: HTMLDivElement | null) => void;
  /**
   * Change this (typically the active thread id) to re-anchor the transcript to
   * the newest message without animating.
   */
  anchorKey?: string | null;
};

const AT_BOTTOM_THRESHOLD = 150;

/**
 * The transcript scrolls inside this element, never the document.
 *
 * A document-level scroll is what collapses iOS Safari's Smart App Banner
 * (`apple-itunes-app`): Safari minimizes the banner on any downward page
 * scroll, so auto-scrolling the window on history load hid the strip before a
 * visitor could ever tap it. Keeping the scroll local leaves the document at
 * scroll 0, which keeps the banner pinned.
 */
export const Conversation = ({
  className,
  children,
  onScrollElement,
  anchorKey,
  ...props
}: ConversationProps) => {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const userScrolledUp = useRef(false);
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // The first content mutation after mount / thread switch is the history
  // paint: jump to the bottom instantly instead of animating the history away.
  const hasAnchored = useRef(false);

  const setScrollElement = useCallback(
    (element: HTMLDivElement | null) => {
      scrollElementRef.current = element;
      onScrollElement?.(element);
    },
    [onScrollElement]
  );

  const checkIfAtBottom = useCallback(() => {
    const element = scrollElementRef.current;
    if (!element) return true;
    return (
      element.scrollTop + element.clientHeight >=
      element.scrollHeight - AT_BOTTOM_THRESHOLD
    );
  }, []);

  const scrollToBottom = useCallback(() => {
    const element = scrollElementRef.current;
    userScrolledUp.current = false;
    hasAnchored.current = true;
    if (!element || element.scrollHeight <= element.clientHeight) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, []);

  // Track user scroll
  useEffect(() => {
    const element = scrollElementRef.current;
    if (!element) return;

    let lastScrollTop = element.scrollTop;

    const handleScroll = () => {
      const currentScrollTop = element.scrollTop;
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

    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => element.removeEventListener("scroll", handleScroll);
  }, [checkIfAtBottom]);

  // Re-anchor when the caller switches threads: reset the intent flags so the
  // first paint of the new thread jumps to the newest message instantly.
  const isFirstAnchor = useRef(true);
  useEffect(() => {
    if (isFirstAnchor.current) {
      isFirstAnchor.current = false;
      return;
    }

    hasAnchored.current = false;
    userScrolledUp.current = false;
    setIsAtBottom(true);
  }, [anchorKey]);

  // Keep the transcript pinned to the newest message when the viewport itself
  // resizes (iOS keyboard, orientation change) unless the user scrolled up.
  useEffect(() => {
    const element = scrollElementRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (userScrolledUp.current) return;
      if (element.scrollHeight <= element.clientHeight) return;
      element.scrollTop = element.scrollHeight;
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Auto-scroll when content changes (if user hasn't scrolled up)
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const observer = new MutationObserver(() => {
      const element = scrollElementRef.current;
      if (!element || userScrolledUp.current) return;

      // Nothing overflows (empty or short thread): scrolling would be a no-op
      // that only produces spurious scroll events.
      if (element.scrollHeight <= element.clientHeight) return;

      if (!hasAnchored.current) {
        hasAnchored.current = true;
        element.scrollTop = element.scrollHeight;
        setIsAtBottom(true);
        return;
      }

      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    });

    observer.observe(content, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, []);

  return (
    <ScrollContext.Provider value={{ isAtBottom, scrollToBottom }}>
      <div
        ref={setScrollElement}
        className={cn("relative overflow-y-auto overscroll-contain", className)}
        role="log"
        {...props}
      >
        <div ref={contentRef}>{children}</div>
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
