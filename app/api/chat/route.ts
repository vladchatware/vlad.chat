import { streamText, UIMessage, convertToModelMessages, experimental_createMCPClient, stepCountIs, smoothStream } from 'ai';
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { system } from '@/lib/ai'

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const {
    messages,
    model,
    webSearch,
  }: { messages: UIMessage[]; model: string; webSearch: boolean } =
    await req.json();

  const transport = new StreamableHTTPClientTransport(new URL('https://vlad.chat/api/mcp'))
  const notion = await experimental_createMCPClient({
    transport
  })

  const tools = await notion.tools()

  const result = streamText({
    model: webSearch ? 'perplexity/sonar' : model,
    messages: convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(5),
    system,
    experimental_transform: smoothStream({
      delayInMs: 20, // optional: defaults to 10ms
      chunking: 'line', // optional: defaults to 'word'
    }),
  });

  // send sources and reasoning back to the client
  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
