'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import type { ScreenshotReference } from '@/lib/computer-use/screenshot-contract';

type ComputerScreenshotOutputProps = {
  screenshots: ScreenshotReference[];
};

export function ComputerScreenshotOutput({ screenshots }: ComputerScreenshotOutputProps) {
  const [selectedIndex, setSelectedIndex] = useState(() => screenshots.length - 1);
  const [failedURL, setFailedURL] = useState<string | null>(null);
  const selected = screenshots[selectedIndex];

  useEffect(() => {
    setSelectedIndex(Math.max(screenshots.length - 1, 0));
  }, [screenshots.length]);

  useEffect(() => {
    setFailedURL(null);
  }, [selected?.url]);

  if (!selected) return null;
  const unavailable = selected.availability === 'unavailable' || !selected.url || failedURL === selected.url;

  return (
    <section
      className="my-3 w-full max-w-xl"
      role="group"
      aria-label={`Computer screenshots, ${screenshots.length} captures`}
    >
      <div className="relative pb-2">
        {screenshots.length > 1 && (
          <>
            <div aria-hidden="true" className="absolute inset-x-3 top-1.5 bottom-0 rounded-xl border bg-muted shadow-sm" />
            <div aria-hidden="true" className="absolute inset-x-1.5 top-0.5 bottom-1 rounded-xl border bg-muted shadow-sm" />
          </>
        )}
        <a
          className="relative block overflow-hidden rounded-xl border bg-black shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={unavailable ? undefined : selected.url}
          target="_blank"
          rel="noreferrer"
          aria-label={unavailable ? `Screenshot ${selectedIndex + 1} is unavailable` : `Open screenshot ${selectedIndex + 1} of ${screenshots.length} at full size`}
          aria-disabled={unavailable}
          onClick={unavailable ? (event) => event.preventDefault() : undefined}
        >
          <div className="relative aspect-video w-full">
            {unavailable ? (
              <div role="img" aria-label="Screenshot unavailable" className="flex size-full items-center justify-center text-sm text-muted-foreground">
                Screenshot unavailable
              </div>
            ) : (
              <Image
                src={selected.url}
                alt={`Computer screenshot ${selectedIndex + 1} of ${screenshots.length}`}
                fill
                sizes="(max-width: 640px) 100vw, 576px"
                unoptimized
                className="object-contain"
                onError={() => setFailedURL(selected.url)}
              />
            )}
          </div>
        </a>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs disabled:opacity-40"
          onClick={() => setSelectedIndex((index) => Math.max(0, index - 1))}
          disabled={selectedIndex === 0}
          aria-label="Show older screenshot"
        >
          Older
        </button>
        <span className="min-w-12 text-center text-xs text-muted-foreground" aria-live="polite">
          {selectedIndex + 1} / {screenshots.length}
        </span>
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs disabled:opacity-40"
          onClick={() => setSelectedIndex((index) => Math.min(screenshots.length - 1, index + 1))}
          disabled={selectedIndex === screenshots.length - 1}
          aria-label="Show newer screenshot"
        >
          Newer
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {screenshots.length === 1 ? 'Screenshot' : `${screenshots.length} screenshots`}
        </span>
      </div>
    </section>
  );
}
