import { streamText, experimental_createMCPClient, gateway, stepCountIs } from 'ai';
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { api } from '@/convex/_generated/api';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { loungeSystem } from '@/lib/ai';

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
    const transport = new StreamableHTTPClientTransport(new URL('https://vlad.chat/api/mcp'));
    const notion = await experimental_createMCPClient({
      // @ts-expect-error Experimental 
      transport
    });
    const tools = await notion.tools();

    // Stream the response
    const result = streamText({
      model: gateway.languageModel('openai/gpt-5-mini'),
      system: loungeSystem,
      prompt: `Here's the recent conversation in The Lounge:\n\n${conversationContext}\n\nRespond to the latest message naturally.`,
      tools,
      stopWhen: stepCountIs(5),
      onFinish: async ({ text }) => {
        // Save Vlad's complete response to the lounge
        if (text) {
          await fetchMutation(
            api.lounge.saveBotMessage,
            { content: text },
            { token: await convexAuthNextjsToken() }
          );
        }
      },
    });

    // Return streaming response as plain text
    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Lounge AI error:', error);
    return new Response('Failed to generate response', { status: 500 });
  }
}
