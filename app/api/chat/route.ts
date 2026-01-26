import { streamText, UIMessage, convertToModelMessages, stepCountIs, smoothStream, gateway } from 'ai';
import { createMCPClient } from '@ai-sdk/mcp';
import { system } from '@/lib/ai'
import { codingAgentTool } from '@/lib/opencode'
import { NOTION_MCP_ENDPOINTS } from '@/lib/notion-oauth';
import { api } from '@/convex/_generated/api';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { PostHog } from 'posthog-node';
import { withTracing } from '@posthog/ai';

const posthog = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST! });

// Cached internal MCP client and tools to avoid recreation on every request
let cachedMcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
let cachedTools: Awaited<ReturnType<Awaited<ReturnType<typeof createMCPClient>>['tools']>> | null = null;

async function getInternalTools() {
  if (!cachedMcpClient) {
    cachedMcpClient = await createMCPClient({
      transport: {
        type: 'http',
        url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/mcp`
      }
    });
  }
  if (!cachedTools) {
    cachedTools = await cachedMcpClient.tools();
  }
  return cachedTools;
}

// Get user's Notion tools via official Notion MCP server
async function getUserNotionTools(token: string): Promise<Record<string, unknown>> {
  try {
    const client = await createMCPClient({
      transport: {
        type: 'sse',
        url: NOTION_MCP_ENDPOINTS.sse,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
    const tools = await client.tools();
    // Prefix user tools to distinguish from internal tools
    return Object.fromEntries(
      Object.entries(tools).map(([key, value]) => [`user_${key}`, value])
    );
  } catch (error) {
    console.error('Failed to connect to user Notion MCP:', error);
    return {};
  }
}

export async function POST(req: Request) {
  const {
    messages,
    model,
    notionToken,
  }: { messages: UIMessage[]; model: string; notionToken?: string } = await req.json();
  const user = await fetchQuery(api.users.viewer, {}, { token: await convexAuthNextjsToken() })

  if (!user) return new NextResponse('no user present in session', { status: 403 })

  const isDev = process.env.NODE_ENV === 'development'

  if (!isDev) {
    if (!user.isAnonymous) {
      if (!user.stripeId) {
        const customer = await stripe.customers.create({
          email: user.email
        })
        await fetchMutation(api.users.connect, { stripeId: customer.id }, { token: await convexAuthNextjsToken() })
        user.stripeId = customer.id
      }

      if (user.trialTokens <= 0 && user.tokens <= 0) {
        return new NextResponse('out of tokens', { status: 429 })
      }
    } else {
      if ((user.trialMessages ?? 0) <= 0) return new NextResponse('no more messages left', { status: 429 })
    }
  }

  // Get internal tools (Vlad's knowledge base)
  const internalTools = await getInternalTools()
  
  // Get user's Notion tools if they've connected their workspace
  const userNotionTools = notionToken ? await getUserNotionTools(notionToken) : {}
  
  const tools = {
    ...internalTools,
    ...userNotionTools,
    coder: codingAgentTool,
  }

  const _model = withTracing(gateway.languageModel(model), posthog, {})

  const result = streamText({
    model: _model,
    messages: await convertToModelMessages(messages),
    tools: tools as Parameters<typeof streamText>[0]['tools'],
    stopWhen: stepCountIs(5),
    system,
    experimental_transform: smoothStream(),
    onFinish: async ({ usage, providerMetadata }) => {
      if (user.isAnonymous) {
        await fetchMutation(api.users.messages, {}, { token: await convexAuthNextjsToken() })
      } else {
        await fetchMutation(api.users.usage, { usage, model, provider: 'AI Gateway', providerMetadata }, { token: await convexAuthNextjsToken() })
      }
    },
  });

  // send sources and reasoning back to the client
  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
