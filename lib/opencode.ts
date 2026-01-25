import { createOpencode } from 'ai-sdk-provider-opencode-sdk';
import { tool } from 'ai';
import { z } from 'zod';

// Big Pickle model (free for testing)
export const BIG_PICKLE_MODEL = 'opencode/big-pickle';

// OpenCode server URL (defaults to localhost for local development)
export const OPENCODE_URL = process.env.OPENCODE_URL || 'http://localhost:4096';

// Available OpenCode agents
const OPENCODE_AGENTS = ['build', 'plan', 'explore'] as const;
type OpenCodeAgent = typeof OPENCODE_AGENTS[number];

// Lazy-loaded OpenCode provider to avoid memory leaks
let _opencode: ReturnType<typeof createOpencode> | null = null;
function getOpencode() {
  if (!_opencode) {
    _opencode = createOpencode({ baseUrl: OPENCODE_URL });
  }
  return _opencode;
}

// Tool that Vlad uses to delegate coding tasks
export const codingAgentTool = tool({
  description: `Execute coding tasks via OpenCode agent. Use for: running shell commands (git, npm, etc), reading/writing files, exploring codebases, generating code. Pass a clear natural language task description.`,
  inputSchema: z.object({
    task: z.string().min(3).describe('A clear task description in natural language. Examples: "run git status", "read the README.md file", "explore how authentication works in this codebase", "create a hello world script"'),
    agent: z.enum(OPENCODE_AGENTS).optional().describe('Agent mode: build (default, can modify files), plan (read-only analysis), explore (quick codebase search)'),
  }),
  execute: async function* ({ task, agent = 'build' }) {
    // Validate task is not empty or malformed
    if (!task || task.trim().length < 3 || task === ':') {
      yield {
        error: 'Invalid task: please provide a clear description of what you want to do',
        hint: 'Example: "run git status" or "explore the codebase structure"',
      };
      return;
    }
    
    try {
      const { streamText } = await import('ai');
      
      const result = streamText({
        model: getOpencode()(BIG_PICKLE_MODEL, { agent }),
        prompt: task,
      });
      
      // Stream full events to capture tool calls and steps
      let fullText = '';
      let stepCount = 0;
      const toolCalls: Array<{ name: string; input: unknown }> = [];
      
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta': {
            // AI SDK v6 uses 'text' property for text-delta events
            const textChunk = (part as { text?: string }).text || (part as { delta?: string }).delta;
            if (textChunk) {
              fullText += textChunk;
              yield { partial: textChunk, fullText, stepCount, toolCalls };
            }
            break;
          }
          case 'reasoning-delta': {
            // Stream reasoning deltas - AI SDK v6 uses 'text' property
            const reasoningDelta = (part as { text?: string }).text || (part as { delta?: string }).delta;
            if (reasoningDelta) {
              fullText += reasoningDelta;
              yield { partial: reasoningDelta, fullText, stepCount, toolCalls, isReasoning: true };
            }
            break;
          }
          case 'tool-call': {
            if (part.toolName) {
              const toolInput = (part as { input?: unknown }).input ?? {};
              // Check if tool-input-start already created a placeholder for this tool
              const existingCall = toolCalls.find(tc => 
                tc.name === part.toolName && 
                (!tc.input || Object.keys(tc.input as object).length === 0)
              );
              if (existingCall) {
                // Update existing placeholder with actual input
                existingCall.input = toolInput;
              } else {
                // New tool call
                toolCalls.push({ name: part.toolName, input: toolInput });
              }
              yield { 
                event: 'tool-call', 
                toolName: part.toolName, 
                toolInput: toolInput,
                fullText, 
                stepCount, 
                toolCalls 
              };
            }
            break;
          }
          case 'tool-input-start': {
            // AI SDK v6 tool input streaming - create placeholder
            const toolName = (part as { toolName?: string }).toolName;
            if (toolName) {
              // Only add if not already tracking this tool
              const exists = toolCalls.some(tc => tc.name === toolName && (!tc.input || Object.keys(tc.input as object).length === 0));
              if (!exists) {
                toolCalls.push({ name: toolName, input: {} });
              }
              yield { event: 'tool-input-start', toolName, fullText, stepCount, toolCalls };
            }
            break;
          }
          case 'tool-input-delta': {
            // Tool input content streaming
            const inputDelta = (part as { delta?: string }).delta;
            if (inputDelta) {
              yield { event: 'tool-input-delta', inputDelta, fullText, stepCount, toolCalls };
            }
            break;
          }
          case 'tool-result': {
            // Update the corresponding tool call with result if we have more info
            const resultInput = (part as { input?: unknown }).input;
            if (resultInput && part.toolName) {
              const existingCall = toolCalls.find(tc => 
                tc.name === part.toolName && 
                (!tc.input || Object.keys(tc.input as object).length === 0)
              );
              if (existingCall) {
                existingCall.input = resultInput;
              }
            }
            // AI SDK v6 uses 'output' instead of 'result'
            const toolOutput = (part as { output?: unknown }).output;
            yield { 
              event: 'tool-result', 
              toolName: part.toolName, 
              toolOutput,
              fullText, 
              stepCount, 
              toolCalls 
            };
            break;
          }
          case 'finish':
            stepCount++;
            yield { 
              event: 'step-finish', 
              stepCount, 
              fullText, 
              toolCalls,
              finishReason: (part as { finishReason?: string }).finishReason 
            };
            break;
          // Marker events - yield current state to keep stream alive
          case 'start':
          case 'text-start':
          case 'text-end':
          case 'reasoning-start':
          case 'reasoning-end':
          case 'tool-input-end':
            yield { event: part.type, fullText, stepCount, toolCalls };
            break;
          default:
            // Unknown events - still yield to prevent stream freezing
            yield { event: 'unknown', type: part.type, fullText, stepCount, toolCalls };
        }
      }
      
      // Final result
      yield {
        result: fullText,
        steps: stepCount,
        toolCalls,
        complete: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      yield {
        error: `OpenCode error: ${message}`,
        hint: 'Make sure OpenCode server is running (run: opencode serve)',
      };
    }
  },
});
