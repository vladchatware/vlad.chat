## Command policy

- Do **not** run builds (`bun run build`, `next build`) unless the user explicitly asks.
- Do **not** run Bun commands (`bun install`, `bun run ...`, `bunx ...`) unless the user explicitly asks.
- Prefer static code inspection and minimal edits over command execution.

## Bandaid policy

- Do **not** suppress warnings
- Do **not** hide under `any` or `unknown` when types are present

Fix the root causes instead.

## PR workflow policy

- Default to an **isolated PR workflow** for non-trivial refactors and feature work.
- **Hotfix exception:** when the user explicitly asks for a hotfix, commit directly to `main` and push without opening a PR.
- Start with a short plan, then execute in small vertical slices.
- Keep each PR focused on one concern (for example: controller extraction, render split, typing, API cleanup).
- Prefer **stacked PRs** when work is sequential:
  - base PR1 on `main`
  - base PR2 on PR1 branch
  - base PR3 on PR2 branch
- Use clear branch names (for example `refactor/...`, `fix/...`, `chore/...`).
- After each slice:
  - commit only relevant files
  - push branch
  - open PR with concise "what + why"
  - then switch back to `main` (or continue stacking intentionally)
- If a PR becomes obsolete because a follow-up removes/replaces the behavior, close the obsolete PR and reference the superseding PR.
- Prefer cleanup PRs that remove dead paths/docs once migration is complete.

## Git execution policy

- Enforce pre-commit checks through Git hooks (Lefthook) rather than manual-only checks.
- Stage intentionally: add only files relevant to the current slice; do not mix unrelated changes.
- Keep commits small and descriptive; prefer follow-up fix commits over history rewriting.
- For stacked work, apply review fixes to the correct base PR branch so downstream PRs inherit them.
- Check PR feedback explicitly (review comments + reviews + issue comments) and prioritize actionable items.
- When replacing behavior, close superseded PRs with a short note pointing to the new PR.
