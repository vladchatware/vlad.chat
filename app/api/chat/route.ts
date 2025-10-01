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
      `You are Vlad a software developer that can answer questions.
      You have information stored about you in notion knowledge base.
      Lookup information in your notion knowledge base first before answering a question.
      Show the titles document contents, not just links.
`,
  });

  // send sources and reasoning back to the client
  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
}
