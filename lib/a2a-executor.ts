import { AgentExecutor, RequestContext, ExecutionEventBus } from '@a2a-js/sdk/server';
import { streamText, stepCountIs, gateway, CoreMessage } from 'ai';
import { system } from '@/lib/ai';
import { experimental_createMCPClient } from '@ai-sdk/mcp';
import { nanoid } from 'nanoid';
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export class VladAgentExecutor implements AgentExecutor {
    constructor(private userId?: string) { }

    async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
        const { userMessage } = requestContext;

        // Map A2A message to AI SDK messages
        const parts = userMessage.parts.filter((p: any) => p.kind === 'text') as { text: string }[];
        const text = parts.map(p => p.text).join(' ');

        const messages: CoreMessage[] = [
            {
                role: 'user',
                content: text
            }
        ];

        try {
            const notion = await experimental_createMCPClient({
                transport: {
                    type: 'http',
                    url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/mcp`
                }
            });

            const tools = await notion.tools();
            const model = 'gpt-4o';

            const result = streamText({
                model: gateway.languageModel(model),
                messages,
                tools: tools as any,
                stopWhen: stepCountIs(5),
                system,
            });

            let fullText = '';
            for await (const textPart of result.textStream) {
                fullText += textPart;
            }

            const usage = await result.usage;

            if (this.userId) {
                await fetchMutation(api.users.usage, {
                    userId: this.userId as any,
                    model,
                    provider: 'A2A',
                    usage
                });
            }

            eventBus.publish({
                kind: 'message',
                messageId: nanoid(),
                role: 'agent',
                parts: [{ kind: 'text', text: fullText }],
                taskId: requestContext.taskId,
                contextId: requestContext.contextId,
                metadata: {
                    usage: {
                        promptTokens: usage.promptTokens,
                        completionTokens: usage.completionTokens,
                        totalTokens: usage.totalTokens,
                    },
                    billing: {
                        status: "account_debited",
                        unit: "tokens"
                    }
                }
            } as any);
        } catch (error) {
            console.error('A2A Execution Error:', error);
            eventBus.publish({
                kind: 'message',
                messageId: nanoid(),
                role: 'agent',
                parts: [{ kind: 'text', text: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
                taskId: requestContext.taskId,
                contextId: requestContext.contextId,
            } as any);
        } finally {
            eventBus.finished();
        }
    }

    async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
        // Basic cancellation: just stop publishing
        eventBus.publish({
            kind: 'task-status-update',
            taskId,
            status: 'canceled',
            final: true
        } as any);
        eventBus.finished();
    }
}
