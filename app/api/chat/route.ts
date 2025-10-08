import { streamText, UIMessage, convertToModelMessages, experimental_createMCPClient, stepCountIs, smoothStream } from 'ai';
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { system } from '@/lib/ai'
import { api, internal } from '@/convex/_generated/api';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

export async function POST(req: Request) {
  const {
    messages,
    model,
    webSearch,
  }: { messages: UIMessage[]; model: string; webSearch: boolean } = await req.json();
  const user = await fetchQuery(api.users.viewer, {}, { token: await convexAuthNextjsToken() })

  if (!user) return new NextResponse('no user present in session', { status: 403 })

  if (!user.stripeId) {
    const customer = await stripe.customers.create(({
      email: user.email,
      balance: 5
    }))
    await fetchMutation(api.users.connect, { stripeId: customer.id }, { token: await convexAuthNextjsToken() })
    user.stripeId = customer.id
  }

  const customer = await stripe.customers.retrieve(user.stripeId)

  // @ts-expect-error FIXME Stripe type correct import 
  if (customer.balance <= 0) return new NextResponse('out of tokens')

  if (user.trialMessages! <= 0) return new NextResponse('no more messages left', { status: 429 })

  const transport = new StreamableHTTPClientTransport(new URL('https://vlad.chat/api/mcp'))
  const notion = await experimental_createMCPClient({
    // @ts-expect-error Experimental 
    transport
  })

  const tools = await notion.tools()

  const result = streamText({
    model: webSearch ? 'perplexity/sonar' : model,
    messages: convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(5),
    system,
    experimental_transform: smoothStream(),
    onFinish: async ({ usage, providerMetadata }) => {
      await stripe.billing.meterEvents.create({ event_name: 'tokens', payload: { 'value': `${usage.totalTokens}`, 'stripe_customer_id': user.stripeId } })
      await fetchMutation(api.users.messages, {}, { token: await convexAuthNextjsToken() })
    },
  });

  // send sources and reasoning back to the client
  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
