import { streamText, UIMessage, convertToModelMessages, experimental_createMCPClient, stepCountIs } from 'ai';
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const {
    messages,
    model,
    webSearch,
  }: { messages: UIMessage[]; model: string; webSearch: boolean } =
    await req.json();

  // const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp'))
  // const notion = await experimental_createMCPClient({
  //   transport
  // })

  // const tools = await notion.tools()

  const result = streamText({
    model: webSearch ? 'perplexity/sonar' : model,
    messages: convertToModelMessages(messages),
    // tools,
    stopWhen: stepCountIs(5),
    system:
      'You are a helpful assistant that can answer questions and help with tasks',
  });

  // send sources and reasoning back to the client
  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
