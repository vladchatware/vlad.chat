import { streamText, UIMessage, convertToModelMessages, stepCountIs, smoothStream, gateway } from 'ai';
import { createMCPClient } from '@ai-sdk/mcp';
import { system } from '@/lib/ai'
import { api } from '@/convex/_generated/api';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { PostHog } from 'posthog-node';
import { withTracing } from '@posthog/ai';

const posthog = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST! });

type ChatRequestBody = {
  messages: UIMessage[]
  model: string
  searchEnabled?: boolean
}

type ViewerUser = {
  isAnonymous: boolean
  stripeId?: string | null
  email?: string | null
  trialTokens: number
  tokens: number
  trialMessages?: number | null
}

async function readChatRequest(req: Request): Promise<ChatRequestBody> {
  return req.json() as Promise<ChatRequestBody>
}

async function getViewerUser(token: string): Promise<ViewerUser | null> {
  return fetchQuery(api.users.viewer, {}, { token }) as Promise<ViewerUser | null>
}

async function ensureStripeCustomer(user: ViewerUser, token: string) {
  if (user.isAnonymous || user.stripeId) {
    return
  }

  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
  })

  await fetchMutation(api.users.connect, { stripeId: customer.id }, { token })
  user.stripeId = customer.id
}

function getUsageLimitResponse(user: ViewerUser): NextResponse | null {
  if (!user.isAnonymous) {
    if (user.trialTokens <= 0 && user.tokens <= 0) {
      return new NextResponse('out of tokens', { status: 429 })
    }
    return null
  }

  if ((user.trialMessages ?? 0) <= 0) {
    return new NextResponse('no more messages left', { status: 429 })
  }

  return null
}

async function createNotionTools() {
  const notion = await createMCPClient({
    transport: {
      type: 'http',
      url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/mcp`
    }
  })

  return notion.tools()
}

async function createSearchTools() {
  if (!process.env.TVLY) {
    return null
  }

  const tavily = await createMCPClient({
    transport: {
      type: 'http',
      url: `https://mcp.tavily.com/mcp/?tavilyApiKey=${process.env.TVLY}`
    }
  })

  return tavily.tools()
}

async function getTools(searchEnabled?: boolean): Promise<Parameters<typeof streamText>[0]['tools']> {
  const notionTools = await createNotionTools()
  if (!searchEnabled) {
    return notionTools as Parameters<typeof streamText>[0]['tools']
  }

  try {
    const tavilyTools = await createSearchTools()
    if (!tavilyTools) {
      return notionTools as Parameters<typeof streamText>[0]['tools']
    }

    return { ...notionTools, ...tavilyTools } as Parameters<typeof streamText>[0]['tools']
  } catch (error) {
    console.error('Failed to initialize Tavily MCP client:', error)
    return notionTools as Parameters<typeof streamText>[0]['tools']
  }
}

function createModel(model: string) {
  return withTracing(gateway.languageModel(model), posthog, {})
}

async function trackUsage(params: {
  model: string
  token: string
  usage: Parameters<NonNullable<Parameters<typeof streamText>[0]['onFinish']>>[0]['usage']
  providerMetadata: Parameters<NonNullable<Parameters<typeof streamText>[0]['onFinish']>>[0]['providerMetadata']
  user: ViewerUser
}) {
  if (params.user.isAnonymous) {
    await fetchMutation(api.users.messages, {}, { token: params.token })
    return
  }

  await fetchMutation(
    api.users.usage,
    {
      usage: params.usage,
      model: params.model,
      provider: 'AI Gateway',
      providerMetadata: params.providerMetadata,
    },
    { token: params.token },
  )
}

export async function POST(req: Request) {
  const token = await convexAuthNextjsToken()
  const { messages, model, searchEnabled } = await readChatRequest(req)
  const user = await getViewerUser(token)

  if (!user) return new NextResponse('no user present in session', { status: 403 })

  await ensureStripeCustomer(user, token)

  const usageLimitResponse = getUsageLimitResponse(user)
  if (usageLimitResponse) {
    return usageLimitResponse
  }

  const tools = await getTools(searchEnabled)
  const tracedModel = createModel(model)

  const result = streamText({
    model: tracedModel,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(5),
    system,
    experimental_transform: smoothStream(),
    onFinish: async ({ usage, providerMetadata }) => {
      await trackUsage({
        model,
        token,
        usage,
        providerMetadata,
        user,
      })
    },
  });

  // send sources and reasoning back to the client
  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
