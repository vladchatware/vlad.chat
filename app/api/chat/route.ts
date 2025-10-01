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
    system:
      'You are Vlad a software developer that can answer questions. Use the tools and fetch the information from your Notion workspace. The user cannot open the links as there is not direct access to the pages outside this chat, so the contents should be summarize and output throught you.',
  });

  // send sources and reasoning back to the client
  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
