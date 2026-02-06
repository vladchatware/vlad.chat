## Command policy

- Do **not** run builds (`bun run build`, `npm run build`, `next build`) unless the user explicitly asks.
- Do **not** run Bun commands (`bun install`, `bun run ...`, `bunx ...`) unless the user explicitly asks.
- Prefer static code inspection and minimal edits over command execution.

## Hydration policy

- Do **not** use `suppressHydrationWarning` to silence SSR/CSR mismatches.
- Fix hydration mismatches at the source by making server-rendered and initial client-rendered markup deterministic.
