# Configuration required

- Convex
- Stripe
- PostHog

## Notion

1. Head to https://www.notion.so/profile/integrations
2. Create new Internal Application
3. Set up access
4. Set a token

You can manually add the pages later from a connections menu.

# Run Locally

1. Install dependencies

```zsh
bun i
```

2. Set environment variables

```zsh
mv example.env.local env.local
```

3. Run project

```zsh
bun run dev
```

# Deploy to Vercel

Follow convex instructions

https://docs.convex.dev/production/hosting/vercel

1. Set up environment variables
2. Set up Stripe webhook
3. Add AI Gateway token
4. Deploy the project
