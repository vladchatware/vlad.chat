import { JsonRpcTransportHandler, DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server';
import { VladAgentExecutor } from '@/lib/a2a-executor';
import { AgentCard } from '@a2a-js/sdk';
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://vlad.chat';

const agentCard: AgentCard = {
    name: "Vlad",
    description: "Vlad is an AI agent for vlad.chat",
    url: `${siteUrl}/api/a2a`,
    protocolVersion: "1.0",
    version: "1.0.0",
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    provider: {
        organization: "vlad.chat",
        url: siteUrl
    },
    capabilities: {
        streaming: true
    },
    skills: [
        {
            "id": "chat",
            "name": "Chat",
            "description": "General purpose chat",
            "tags": ["chat", "general"]
        }
    ],
    securitySchemes: {
        apiKey: {
            type: "apiKey",
            in: "header",
            name: "X-API-Key",
            description: "Your platform API key"
        }
    },
    security: [
        { apiKey: [] }
    ]
};

// Use a global or module-level store if we want tasks to persist across requests in a single process
const taskStore = new InMemoryTaskStore();
export async function POST(req: Request) {
    try {
        const apiKey = req.headers.get('X-API-Key');
        if (!apiKey) {
            return Response.json({
                jsonrpc: "2.0",
                error: { code: -32007, message: "Authentication required. Please provide X-API-Key header." }
            }, { status: 401 });
        }

        const user = await fetchQuery(api.users.getByApiKey, { apiKey });
        if (!user) {
            return Response.json({
                jsonrpc: "2.0",
                error: { code: -32007, message: "Invalid API Key." }
            }, { status: 401 });
        }

        // Check balance
        if (!user.isAnonymous) {
            if ((user.trialTokens ?? 0) <= 0 && (user.tokens ?? 0) <= 0) {
                return Response.json({
                    jsonrpc: "2.0",
                    error: { code: -32008, message: "Insufficient token balance. Please top up at vlad.chat." }
                }, { status: 402 }); // 402 Payment Required
            }
        } else {
            if ((user.trialMessages ?? 0) <= 0) {
                return Response.json({
                    jsonrpc: "2.0",
                    error: { code: -32008, message: "Trial messages exhausted. Please sign in to continue." }
                }, { status: 402 });
            }
        }

        const agentExecutor = new VladAgentExecutor(user._id);
        const requestHandler = new DefaultRequestHandler(agentCard, taskStore, agentExecutor);
        const transportHandler = new JsonRpcTransportHandler(requestHandler);

        const body = await req.json();
        const response = await transportHandler.handle(body);

        // Check if response is an AsyncGenerator (for streaming, e.g. message/stream)
        if (response && typeof response === 'object' && Symbol.asyncIterator in response) {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                async start(controller) {
                    try {
                        for await (const chunk of response as any) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                        }
                    } catch (e) {
                        console.error('A2A Streaming error:', e);
                    } finally {
                        controller.close();
                    }
                }
            });

            return new Response(stream, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                }
            });
        }

        // Default JSON-RPC response
        return Response.json(response);
    } catch (error) {
        console.error('A2A API Error:', error);
        return Response.json({
            jsonrpc: "2.0",
            error: {
                code: -32603,
                message: error instanceof Error ? error.message : "Internal error"
            }
        }, { status: 500 });
    }
}

// GET /api/a2a returns the agent card
export async function GET() {
    return Response.json(agentCard);
}

export const dynamic = 'force-dynamic';
