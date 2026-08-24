import type { JSONSchema7, ModelMessage, ToolChoice, ToolSet } from "ai";
import { dynamicTool, jsonSchema } from "ai";
import { z } from "zod";

const toolNameSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

const functionCallSchema = z.object({
  name: toolNameSchema,
  arguments: z.string(),
}).strict();

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: functionCallSchema,
}).strict();

const jsonSchemaSchema = z.custom<JSONSchema7>(
  (value): value is JSONSchema7 =>
    typeof value === "object" && value !== null && !Array.isArray(value),
  "Tool parameters must be a JSON Schema object.",
);

const messageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: z.string(), name: z.string().optional() }).strict(),
  z.object({ role: z.literal("developer"), content: z.string(), name: z.string().optional() }).strict(),
  z.object({ role: z.literal("user"), content: z.string(), name: z.string().optional() }).strict(),
  z.object({
    role: z.literal("assistant"),
    content: z.string().nullable().optional(),
    name: z.string().optional(),
    reasoning_content: z.string().nullable().optional(),
    tool_calls: z.array(toolCallSchema).optional(),
  }).strict(),
  z.object({
    role: z.literal("tool"),
    content: z.string(),
    name: z.string().optional(),
    tool_call_id: z.string().min(1),
  }).strict(),
]);

const functionToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: toolNameSchema,
    description: z.string().optional(),
    parameters: jsonSchemaSchema.default({
      type: "object",
      properties: {},
    }),
    strict: z.boolean().optional(),
  }).strict(),
}).strict();

const toolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: toolNameSchema }).strict(),
  }).strict(),
]);

export const chatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional().default(false),
  stream_options: z.object({ include_usage: z.boolean().optional() }).strict().optional(),
  tools: z.array(functionToolSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
  n: z.literal(1).optional(),
  user: z.string().optional(),
  reasoning_effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  seed: z.number().int().optional(),
}).strict().refine(
  (request) => !(request.max_tokens && request.max_completion_tokens),
  {
    message: "Use either max_tokens or max_completion_tokens, not both.",
    path: ["max_tokens"],
  },
).superRefine((request, context) => {
  const toolNames = new Set<string>();
  for (const tool of request.tools ?? []) {
    if (toolNames.has(tool.function.name)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate tool name '${tool.function.name}'.`,
        path: ["tools"],
      });
    }
    toolNames.add(tool.function.name);
  }

  if (
    request.tool_choice &&
    typeof request.tool_choice !== "string" &&
    !toolNames.has(request.tool_choice.function.name)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `tool_choice references unknown tool '${request.tool_choice.function.name}'.`,
      path: ["tool_choice"],
    });
  }
  if (request.tool_choice === "required" && toolNames.size === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "tool_choice 'required' needs at least one tool.",
      path: ["tool_choice"],
    });
  }
});

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

export function toAiPrompt(messages: ChatCompletionRequest["messages"]): {
  instructions: string[];
  messages: ModelMessage[];
} {
  const instructions: string[] = [];
  const toolNames = new Map<string, string>();
  const modelMessages: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      instructions.push(message.content);
      continue;
    }
    if (message.role === "user") {
      modelMessages.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const toolCalls = message.tool_calls ?? [];
      if (!toolCalls.length && !message.reasoning_content) {
        modelMessages.push({ role: "assistant", content: message.content ?? "" });
        continue;
      }
      for (const call of toolCalls) {
        if (toolNames.has(call.id)) {
          throw new Error(`Duplicate assistant tool call id ${call.id}.`);
        }
        toolNames.set(call.id, call.function.name);
      }
      modelMessages.push({
        role: "assistant",
        content: [
          ...(message.reasoning_content
            ? [{ type: "reasoning" as const, text: message.reasoning_content }]
            : []),
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...toolCalls.map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.id,
            toolName: call.function.name,
            input: parseToolArguments(call.function.arguments),
          })),
        ],
      });
      continue;
    }

    const toolName = toolNames.get(message.tool_call_id);
    if (!toolName) {
      throw new Error(`No assistant tool call found for ${message.tool_call_id}.`);
    }
    modelMessages.push({
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: message.tool_call_id,
        toolName,
        output: { type: "text", value: message.content },
      }],
    });
  }

  return { instructions, messages: modelMessages };
}

function parseToolArguments(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Tool arguments must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Assistant tool call arguments must contain a valid JSON object.");
  }
}

export function toAiTools(definitions: ChatCompletionRequest["tools"]): ToolSet | undefined {
  if (!definitions?.length) return undefined;
  return Object.fromEntries(definitions.map(({ function: definition }) => [
    definition.name,
    dynamicTool({
      description: definition.description,
      inputSchema: jsonSchema(definition.parameters),
      strict: definition.strict,
    }),
  ]));
}

export function toAiToolChoice(
  choice: ChatCompletionRequest["tool_choice"],
): ToolChoice<ToolSet> | undefined {
  if (choice === undefined) return undefined;
  if (choice === "none") return "none";
  if (choice === "auto") return "auto";
  if (choice === "required") return "required";
  if (!choice.function?.name) {
    throw new Error("Function tool choice requires a tool name.");
  }
  return { type: "tool" as const, toolName: choice.function.name };
}

export function openAiFinishReason(reason: string) {
  if (reason === "tool-calls") return "tool_calls";
  if (reason === "content-filter") return "content_filter";
  if (reason === "length" || reason === "stop") return reason;
  return "stop";
}

export function openAiError(
  message: string,
  status: number,
  type: string,
  code: string,
  param: string | null = null,
) {
  return Response.json(
    { error: { message, type, param, code } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
