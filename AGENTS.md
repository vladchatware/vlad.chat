## Command policy

- Do **not** run builds (`bun run build`, `npm run build`, `next build`) unless the user explicitly asks.
- Do **not** run Bun commands (`bun install`, `bun run ...`, `bunx ...`) unless the user explicitly asks.
- Prefer static code inspection and minimal edits over command execution.

## Bandaid policy

- Do **not** suppress warnings
- Do **not** hide under `any` or `unknown` when types are present

Fix the root causes instead.
