# vlad.chat

A personal AI chatbot application built with Next.js, featuring an intelligent conversational interface powered by OpenAI models, integrated with Notion for knowledge management, and equipped with payment processing and analytics.

## Features

- 🤖 **AI-Powered Chat**: Interactive conversations using OpenAI GPT-5 models
- 📚 **Notion Integration**: Access to knowledge base stored in Notion pages
- 💳 **Payment Processing**: Stripe integration for credit-based usage
- 📊 **Analytics**: PostHog integration for usage tracking
- 🔐 **Authentication**: Anonymous and Google OAuth authentication via Convex Auth
- 🎨 **Modern UI**: Beautiful, responsive interface built with Radix UI and Tailwind CSS
- 🔄 **Streaming Responses**: Real-time streaming of AI responses
- 🧠 **Reasoning Display**: Optional reasoning chain visualization

## Tech Stack

- **Framework**: Next.js 15 with React 19
- **Backend**: Convex (database, auth, serverless functions)
- **AI**: OpenAI GPT-5 models via AI SDK
- **Payments**: Stripe
- **Analytics**: PostHog
- **Knowledge Base**: Notion API
- **UI Components**: Radix UI, Tailwind CSS
- **Package Manager**: Bun
- **Protocol**: Model Context Protocol (MCP)

## Prerequisites

Before you begin, ensure you have the following:

- [Bun](https://bun.sh/) installed (v1.0 or later)
- [ngrok](https://ngrok.com/) installed (required for local MCP server access)
- A [Convex](https://www.convex.dev/) account and project
- A [Stripe](https://stripe.com/) account
- A [PostHog](https://posthog.com/) account (optional but recommended)
- A [Notion](https://www.notion.so/) workspace with API access

## Getting Started

### 1. Clone and Install

```bash
# Install dependencies
bun install
```

### 2. Environment Variables

Copy the example environment file and fill in your credentials:

```bash
cp example.env.local .env.local
```

Update `.env.local` with the following variables:

```env
# Convex
CONVEX_DEPLOYMENT=your-convex-deployment-url
NEXT_PUBLIC_CONVEX_URL=your-convex-url

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=your-stripe-publishable-key
STRIPE_SECRET_KEY=your-stripe-secret-key

# PostHog (optional)
NEXT_PUBLIC_POSTHOG_KEY=your-posthog-key
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com

# Notion
NOTION_TOKEN=your-notion-integration-token

# AI Gateway (optional, for rate limiting/proxy)
AI_GATEWAY_API_KEY=your-ai-gateway-key

# Site URL
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 3. Set Up Convex

1. Install Convex CLI if you haven't already:
   ```bash
   bunx convex dev
   ```

2. Follow the prompts to link your project or create a new one

3. Deploy your Convex functions:
   ```bash
   bunx convex deploy
   ```

### 4. Set Up Notion Integration

1. Go to [Notion Integrations](https://www.notion.so/profile/integrations)
2. Create a new **Internal Application**
3. Set up the necessary permissions (read access to pages you want to use)
4. Copy the integration token to `NOTION_TOKEN` in your `.env.local`
5. Share the Notion pages you want to access with your integration

### 5. Set Up ngrok for MCP Server

The MCP server needs to be publicly accessible for AI inference to make requests to it. For local development, use ngrok to expose your local server:

1. **Install ngrok** (if not already installed):
   ```bash
   # macOS
   brew install ngrok/ngrok/ngrok
   
   # Or download from https://ngrok.com/download
   ```

2. **Start your Next.js development server**:
   ```bash
   bun run dev
   ```

3. **In a separate terminal, start ngrok**:
   ```bash
   ngrok http 3000
   ```

4. **Copy the ngrok HTTPS URL** (e.g., `https://abc123.ngrok.io`)

5. **Update the MCP server URL** in `app/api/chat/route.ts`:
   - Change line 36 from:
     ```typescript
     const transport = new StreamableHTTPClientTransport(new URL('https://vlad.chat/api/mcp'))
     ```
   - To your ngrok URL:
     ```typescript
     const transport = new StreamableHTTPClientTransport(new URL('https://your-ngrok-url.ngrok.io/api/mcp'))
     ```

   > **Note**: For production, this should remain as your production domain. Consider using an environment variable to switch between local and production URLs.

### 6. Run the Development Server

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Important**: Keep both the Next.js dev server and ngrok running while developing. The MCP server must be publicly accessible for the AI to make inference requests.

## Project Structure

```
vlad.chat/
├── app/                    # Next.js app directory
│   ├── api/               # API routes (chat, checkout, mcp)
│   ├── page.tsx           # Main chat interface
│   └── layout.tsx         # Root layout
├── components/            # React components
│   ├── ai-elements/      # AI chat UI components
│   └── ui/               # Reusable UI components
├── convex/               # Convex backend
│   ├── agents/          # AI agent configurations
│   ├── auth.ts          # Authentication setup
│   ├── schema.ts        # Database schema
│   └── users.ts         # User management
├── lib/                  # Utility libraries
│   ├── ai.ts            # AI configuration
│   ├── notion.ts        # Notion integration
│   └── stripe.ts        # Stripe integration
└── public/              # Static assets
```

## Configuration

### Convex Setup

The application uses Convex for:
- User authentication and management
- Conversation thread storage
- Credit/token tracking
- Serverless function execution

Ensure your Convex schema is properly configured in `convex/schema.ts`.

### Stripe Webhook

For production, set up a Stripe webhook endpoint:
1. In your Stripe dashboard, create a webhook pointing to `/api/webhook` (if implemented)
2. Add the webhook secret to your environment variables

### MCP Server Configuration

The MCP (Model Context Protocol) server at `/api/mcp` provides tools for the AI to interact with your Notion workspace. During inference, the AI needs to make HTTP requests to this endpoint, which is why it must be publicly accessible.

**For Local Development:**
- Use ngrok to expose your local server (see step 5 in Getting Started)
- Update the MCP server URL in `app/api/chat/route.ts` to your ngrok URL
- Keep both the dev server and ngrok running

**For Production:**
- The MCP server URL should point to your production domain
- Ensure the endpoint is accessible and properly secured

### AI Models

The application currently supports:
- `openai/gpt-5-mini` (default)
- `openai/gpt-5`

You can modify the available models in `app/page.tsx`.

## Deployment

### Deploy to Vercel

1. **Push your code** to a Git repository

2. **Import to Vercel**:
   - Go to [Vercel](https://vercel.com)
   - Import your repository
   - Vercel will auto-detect Next.js

3. **Set up Convex**:
   - Follow the [Convex Vercel integration guide](https://docs.convex.dev/production/hosting/vercel)
   - Add your Convex environment variables

4. **Configure Environment Variables**:
   - Add all variables from `.env.local` to Vercel's environment settings
   - Update `NEXT_PUBLIC_SITE_URL` to your production domain

5. **Set up Stripe Webhook**:
   - Configure the webhook endpoint in Stripe dashboard
   - Point it to your production URL

6. **Deploy**:
   - Vercel will automatically deploy on push
   - Or trigger a manual deployment from the dashboard

## Development

### Available Scripts

- `bun run dev` - Start development server with Turbopack
- `bun run build` - Build for production
- `bun run start` - Start production server
- `bun run lint` - Run ESLint

### Key Features Implementation

- **Chat Interface**: Built with `@ai-sdk/react` for streaming responses
- **Authentication**: Uses `@convex-dev/auth` for anonymous and OAuth auth
- **Credit System**: Token-based usage tracking with trial limits

## License

Private project - All rights reserved

## Support

For questions or issues, please contact [Vlad](https://vlad.chat) or [book a call](https://calendly.com/vladchatware/30min).
