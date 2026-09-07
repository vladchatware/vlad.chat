import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeftIcon } from 'lucide-react';

export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
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

        <article className="rounded-2xl border border-border/80 bg-card/80 p-6 shadow-sm md:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
            Last updated: {updated}
          </p>
          <div className="mt-8 flex flex-col gap-7">{children}</div>
        </article>
      </div>
    </main>
  );
}

export function Section({ children }: { children: ReactNode }) {
  return <section className="flex flex-col gap-3">{children}</section>;
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="text-base font-semibold tracking-tight text-foreground">{children}</h2>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-1.5 pl-5">{children}</ul>;
}

export function LI({ children }: { children: ReactNode }) {
  return <li className="text-sm leading-relaxed text-muted-foreground">{children}</li>;
}
