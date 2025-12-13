import { streamText, gateway, stepCountIs } from 'ai';
import { experimental_createMCPClient } from '@ai-sdk/mcp';
import { api } from '@/convex/_generated/api';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { loungeSystem } from '@/lib/ai';
import { PostHog } from 'posthog-node';
import { withTracing } from '@posthog/ai';

const posthog = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST! });

export async function POST(req: Request) {
  try {
    const token = await convexAuthNextjsToken();

    // Check if user can trigger @vlad
    const canTrigger = await fetchQuery(
      api.lounge.canTriggerVlad,
      {},
      { token }
    );

    if (!canTrigger) {
      return new Response('No @vlad triggers remaining. Sign in to continue!', { status: 403 });
    }

    // Decrement trial messages for anonymous users
    await fetchMutation(
      api.lounge.useVladTrigger,
      {},
      { token }
    );

    // Get recent lounge messages for context
    const recentMessages = await fetchQuery(
      api.lounge.getRecentMessages,
      { limit: 15 },
      { token }
    );

    // Build conversation context from lounge messages
    const conversationContext = recentMessages
      .map(m => `${m.userName}: ${m.content}`)
      .join('\n');

    // Set up MCP client for Notion tools
    const notion = await experimental_createMCPClient({
      transport: {
        type: 'http',
        url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/mcp`
      }
    });
    const tools = await notion.tools();

    const model = 'openai/gpt-5.2-chat';
    const _model = withTracing(gateway.languageModel(model), posthog, {});

    // Stream the response
    const result = streamText({
      model: _model,
      system: loungeSystem,
      prompt: `Here's the recent conversation in The Lounge:\n\n${conversationContext}\n\nRespond to the latest message naturally.`,
      tools: tools as Parameters<typeof streamText>[0]['tools'],
      stopWhen: stepCountIs(5),
      onFinish: async ({ text, usage, providerMetadata }) => {
        // Save Vlad's complete response to the lounge
        if (text) {
          await fetchMutation(
            api.lounge.saveBotMessage,
            { content: text },
            { token: await convexAuthNextjsToken() }
          );
        }
        // Track usage
        await fetchMutation(
          api.users.usage,
          { usage, model, provider: 'AI Gateway', providerMetadata },
          { token: await convexAuthNextjsToken() }
        );
      },
    });

    // Return streaming response as plain text
    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Lounge AI error:', error);
    return new Response('Failed to generate response', { status: 500 });
  }
}
