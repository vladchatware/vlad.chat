# Agent Guidelines for vlad.chat

## Build & Test Commands

**Core Commands:**
- `bun run dev` - Start development server with Turbopack
- `bun run build` - Build for production
- `bun run start` - Start production server
- `bun run lint` - Run ESLint

**Testing (Vitest):**
- `bun run test` - Run all tests
- `bunx vitest run` - Run tests once
- `bunx vitest run <filename>` - Run specific test file
- `bunx vitest --run <filename>` - Run single test file with watch mode disabled
- `bunx vitest --run -t "<test name>"` - Run tests matching pattern

**Convex:**
- `bunx convex dev` - Start Convex dev server
- `bunx convex deploy` - Deploy Convex functions (production deploy happens on CI)
- `bunx convex dashboard` - Open Convex dashboard

## Code Style Guidelines

### TypeScript Configuration
- Strict mode is disabled (`"strict": false`)
- Target: ES2017
- Path alias: `@/*` maps to root directory
- React: JSX transform enabled

### File Organization
- `app/` - Next.js App Router (pages, API routes, layouts)
- `components/` - React components (split into `ui/` and `ai-elements/`)
- `lib/` - Utility functions and external service integrations
- `convex/` - Backend (schema, queries, mutations, auth, cron jobs)

### Imports
- External imports first (React, Next.js, libraries)
- Internal imports from `@/*` path aliases
- Named imports with braces: `import { Button } from '@/components/ui/button'`
- Default imports for single exports: `import notion from '@/lib/notion'`
- Use absolute paths with `@/` alias for internal modules
- Example order:
  ```ts
  import { useState } from 'react'
  import { useChat } from '@ai-sdk/react'
  import { cn } from '@/lib/utils'
  import { api } from '@/convex/_generated/api'
  ```

### Components
- Use `'use client'` directive for client components
- Functional components with TypeScript types
- Use `React.ComponentProps` for native element prop types
- Export named exports from UI components
- Use `cn()` utility for className merging (clsx + tailwind-merge)
- Radix UI primitives as base components
- Tailwind CSS for all styling
- Component variants via `class-variance-authority` (cva)
- Data attributes like `data-slot="button"` for styling hooks

### Props & Types
- Use `React.ComponentProps<"element">` for extending native elements
- Use `VariantProps<typeof variantFn>` for variant types
- Destructure props in function signature
- Spread remaining props with `...props`
- Example:
  ```ts
  function Button({
    className,
    variant,
    size,
    ...props
  }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
    return <button className={cn(...)} {...props} />
  }
  ```

### Convex Backend
- Use `query`, `mutation`, `internalMutation` from `convex/server`
- Define schema with `defineSchema`, `defineTable`, `v` from `convex/values`
- Index fields with `.index("name", ["field"])`
- Auth helpers: `getAuthUserId`, `getAuthSessionId` from `@convex-dev/auth/server`
- Use `ctx.db.get()`, `ctx.db.patch()`, `ctx.db.insert()` for database operations
- Cron jobs defined in `convex/crons.ts` with `crons.daily`, `crons.weekly`

### Error Handling
- API routes: Return `NextResponse` with status codes (400, 403, 429, 500)
- Use early returns for validation failures
- Stripe webhooks: try/catch with signature verification
- Log errors to console, return generic error messages to clients
- Example:
  ```ts
  if (!user) return new NextResponse('no user present', { status: 403 })
  if (user.trialTokens <= 0) return new NextResponse('out of tokens', { status: 429 })
  ```

### Naming Conventions
- Components: PascalCase (`ChatBotDemo`, `ThemeProvider`)
- Functions: camelCase (`getRelativeTime`, `connect`)
- Constants: UPPER_SNAKE_CASE for env vars (`NEXT_PUBLIC_SITE_URL`)
- Files: kebab-case for components (`theme-provider.tsx`), camelCase for utilities (`utils.ts`)
- Convex tables: camelCase singular (`users`, `usage`)
- Convex functions: camelCase (`viewer`, `connect`, `messages`)

### Testing
- Test files: `*.test.ts` or `*.test.tsx`
- Use Vitest globals: `describe`, `it`, `expect`, `vi`
- Mock external dependencies with `vi.mock()`
- Use `beforeEach`, `afterEach` for setup/teardown
- Mock functions with `vi.fn()`, `vi.fn().mockResolvedValue()`
- Reset mocks in `beforeEach` to avoid test interference
- Example:
  ```ts
  describe('getRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01'))
    })
    afterEach(() => vi.useRealTimers())
  })
  ```

### Environment Variables
- All env vars in `.env.local` (gitignored)
- Example in `example.env.local`
- Public vars prefixed with `NEXT_PUBLIC_`
- Never commit `.env.local` or secrets
- Required: Convex, Stripe, Notion, PostHog keys

### Styling Guidelines
- Tailwind CSS v4
- Use semantic color tokens: `bg-primary`, `text-muted-foreground`
- Dark mode support with `dark:` prefix
- Accessibility: `aria-invalid`, `focus-visible` states
- Responsive: `md:` prefix for tablet/desktop breakpoints
- No custom CSS classes - use utility classes
- Component variants via cva for consistent styling

### API Routes
- Export named `POST`, `GET`, etc. functions
- Async/await for all async operations
- Parse JSON body: `await req.json()`
- Use Next.js Response objects
- Streaming responses: `result.toUIMessageStreamResponse()`
- Example:
  ```ts
  export async function POST(req: Request) {
    const { messages } = await req.json()
    return result.toUIMessageStreamResponse()
  }
  ```

### Additional Notes
- Package manager: Bun (uses `bun.lock`)
- Node environment for tests
- No Prettier - rely on ESLint
- Keep comments minimal and concise
- Use existing patterns over introducing new conventions
- When in doubt, match the style of existing files in the same directory
