import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { fetchQuery } from 'convex/nextjs';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeftIcon } from 'lucide-react';

import { Progress } from '@/components/ui/progress';
import { api } from '@/convex/_generated/api';

export const metadata: Metadata = {
  title: 'Usage',
  description: 'Track usage, free messages, and estimated spend.',
};

const SPEND_BAR_MAX_USD = 5;

function formatPercent(value: number) {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default async function UsagePage() {
  const token = await convexAuthNextjsToken();

  const [user, summary] = await Promise.all([
    fetchQuery(api.users.viewer, {}, { token }),
    fetchQuery(api.users.usageSummary, {}, { token }),
  ]);

  if (!user || !summary) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30 px-4 py-10 text-foreground">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            Back to chat
          </Link>

          <section className="rounded-2xl border border-border/80 bg-card/80 p-6 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight">Usage overview</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Open chat first to initialize your account, then come back here to view usage.
            </p>
          </section>
        </div>
      </main>
    );
  }

  const spendProgress = Math.min(100, (summary.estimatedSpendUsd / SPEND_BAR_MAX_USD) * 100);

  return (
    <main className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30 px-4 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Back to chat
        </Link>

        <section className="rounded-2xl border border-border/80 bg-card/80 p-6 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">Usage overview</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your usage progress from 0% to 100%.
            </p>
          </div>

          <div className="space-y-6">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Usage tracked</span>
                <span className="font-medium">{formatPercent(summary.usageTrackedPercent)}</span>
              </div>
              <Progress value={summary.usageTrackedPercent} className="h-3" />
              <p className="mt-2 text-xs text-muted-foreground">
                {summary.isAnonymous
                  ? 'Based on your free message quota.'
                  : 'Based on your 16M free trial token quota.'}
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Free messages left</span>
                <span className="font-medium">{summary.freeMessagesLeft} / 10</span>
              </div>
              <Progress value={summary.freeMessagesLeftPercent} className="h-3" />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Money spent (estimated)</span>
                <span className="font-medium">{formatUsd(summary.estimatedSpendUsd)}</span>
              </div>
              <Progress value={spendProgress} className="h-3" />
              <p className="mt-2 text-xs text-muted-foreground">
                Estimated from tracked token usage at $0.30 per 1M tokens.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
