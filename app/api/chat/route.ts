import { streamText, UIMessage, convertToModelMessages, stepCountIs, smoothStream, gateway } from 'ai';
import { experimental_createMCPClient } from '@ai-sdk/mcp';
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
    openCodeConnected,
  }: { messages: UIMessage[]; model: string; openCodeConnected?: boolean } = await req.json();
  const user = await fetchQuery(api.users.viewer, {}, { token: await convexAuthNextjsToken() })

  if (!user) return new NextResponse('no user present in session', { status: 403 })

  if (!user.isAnonymous) {
    if (!user.stripeId) {
      const customer = await stripe.customers.create(({
        email: user.email
      }))
      await fetchMutation(api.users.connect, { stripeId: customer.id }, { token: await convexAuthNextjsToken() })
      user.stripeId = customer.id
    }

    if (user.trialTokens <= 0 && user.tokens <= 0) {
      return new NextResponse('out of tokens', { status: 429 })
    }
  } else {
    if (user.trialMessages! <= 0) return new NextResponse('no more messages left', { status: 429 })
  }

  const notion = await experimental_createMCPClient({
    transport: {
      type: 'http',
      url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/mcp`
    }
  })

  const tools = await notion.tools()

  const _model = withTracing(gateway.languageModel(model), posthog, {})

  // Add OpenCode connection status to system prompt
  const openCodeContext = openCodeConnected
    ? '\n\n[OPENCODE STATUS: CONNECTED] The user has OpenCode running locally. You CAN delegate coding tasks by responding with a delegation JSON. The user will see your delegation and OpenCode will execute it on their machine.'
    : '\n\n[OPENCODE STATUS: NOT CONNECTED] The user does not have OpenCode running. Do NOT attempt to delegate tasks. Instead, provide code examples inline or suggest they run "opencode serve" to enable local coding capabilities.'

  const result = streamText({
    model: _model,
    messages: convertToModelMessages(messages),
    tools: tools as Parameters<typeof streamText>[0]['tools'],
    stopWhen: stepCountIs(5),
    system: system + openCodeContext,
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
