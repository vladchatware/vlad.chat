import { streamText, UIMessage, convertToModelMessages, isStepCount, smoothStream, gateway } from 'ai';
import { createMCPClient } from '@ai-sdk/mcp';
import { system } from '@/lib/ai'
import { api } from '@/convex/_generated/api';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { NextResponse } from 'next/server';
import {
  computerUseToolsAvailable,
  createComputerUseTools,
} from '@/lib/computer-use'

export async function POST(req: Request) {
  const {
    messages,
    model,
    searchEnabled,
  }: { messages: UIMessage[]; model: string; searchEnabled?: boolean } = await req.json();
  const user = await fetchQuery(api.users.viewer, {}, { token: await convexAuthNextjsToken() })

  if (!user) return new NextResponse('no user present in session', { status: 403 })

  // Admission gate: balance, premium access and usage caps are all checked
  // BEFORE generation starts. Settlement (recordUsage) always accounts for
  // completed work and never re-runs cap checks, so usage for billed upstream
  // work is never discarded.
  try {
    await fetchMutation(api.users.usageGate, { model }, { token: await convexAuthNextjsToken() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request blocked.'
    const status = message.includes('usage cap')
      ? 429
      : message.includes('subscription')
        ? 404
        : 429
    return NextResponse.json(
      { error: { message, type: 'invalid_request_error', code: status === 404 ? 'subscription_required' : 'insufficient_credits' } },
      { status },
    )
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

  // Computer use (V-83): shared backend tools for web + iOS. Feature-flagged.
  // Clients only render tool JSON (screenshotUrl / handoff); no UI-only orchestration.
  if (computerUseToolsAvailable()) {
    const computerTools = createComputerUseTools({
      userId: String(user._id),
    })
    tools = { ...tools, ...computerTools }
  }

  const result = streamText({
    model: gateway.languageModel(model),
    messages: await convertToModelMessages(messages),
    tools: tools as Parameters<typeof streamText>[0]['tools'],
    stopWhen: isStepCount(5),
    instructions: system,
    experimental_transform: smoothStream(),
    telemetry: { functionId: 'chat' },
    onEnd: async ({ usage, finalStep }) => {
      if (user.isAnonymous) {
        await fetchMutation(api.users.messages, {}, { token: await convexAuthNextjsToken() })
      } else {
        await fetchMutation(api.users.usage, { usage, model, provider: 'AI Gateway', providerMetadata: finalStep.providerMetadata }, { token: await convexAuthNextjsToken() })
      }
    },
  });

  // send sources and reasoning back to the client
  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
