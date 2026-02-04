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

export async function POST(req: Request) {
  const {
    messages,
    model,
    searchEnabled,
  }: { messages: UIMessage[]; model: string; searchEnabled?: boolean } = await req.json();

  // Get the auth token once to reuse throughout
  const token = await convexAuthNextjsToken()

  const user = await fetchQuery(api.users.viewer, {}, { token })

  if (!user) return new NextResponse('no user present in session', { status: 403 })

  if (!user.isAnonymous) {
    if (!user.stripeId) {
      const customer = await stripe.customers.create(({
        email: user.email
      }))
      await fetchMutation(api.users.connect, { stripeId: customer.id }, { token })
      user.stripeId = customer.id
    }

    if (user.trialTokens <= 0 && user.tokens <= 0) {
      return new NextResponse('out of tokens', { status: 429 })
    }
  } else {
    if (user.trialMessages! <= 0) return new NextResponse('no more messages left', { status: 429 })
  }

  const notion = await createMCPClient({
    transport: {
      type: 'http',
      url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/mcp`
    }
  })

  const notionTools = await notion.tools()

  // Conditionally add Tavily search tools
  let tools = notionTools
  if (searchEnabled && process.env.TVLY) {
    try {
      const tavily = await createMCPClient({
        transport: {
          type: 'http',
          url: `https://mcp.tavily.com/mcp/?tavilyApiKey=${process.env.TVLY}`
        }
      })
      const tavilyTools = await tavily.tools()
      tools = { ...notionTools, ...tavilyTools }
    } catch (error) {
      console.error('Failed to initialize Tavily MCP client:', error)
      // Fall back to just Notion tools
    }
  }

  const _model = withTracing(gateway.languageModel(model), posthog, {})

  // Save user message before streaming
  const lastUserMessage = messages[messages.length - 1];
  if (lastUserMessage && lastUserMessage.role === 'user') {
    const content = lastUserMessage.parts
      ?.filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map(part => part.text)
      .join('') || '';

    if (content) {
      await fetchMutation(api.threads.saveMessage, {
        message: { role: 'user', content },
      }, { token });
    }
  }

  const result = streamText({
    model: _model,
    messages: await convertToModelMessages(messages),
    tools: tools as Parameters<typeof streamText>[0]['tools'],
    stopWhen: stepCountIs(5),
    system,
    experimental_transform: smoothStream(),
    onFinish: async ({ text, usage, providerMetadata }) => {
      // Save assistant message
      if (text) {
        await fetchMutation(api.threads.saveMessage, {
          message: { role: 'assistant', content: text },
        }, { token });
      }

      // Track usage
      if (user.isAnonymous) {
        await fetchMutation(api.users.messages, {}, { token })
      } else {
        await fetchMutation(api.users.usage, { usage, model, provider: 'AI Gateway', providerMetadata }, { token })
      }
    },
  });

  // send sources and reasoning back to the client
  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
