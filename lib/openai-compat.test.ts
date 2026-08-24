import { describe, expect, it } from "vitest";

import {
  chatCompletionRequestSchema,
  openAiFinishReason,
  toAiPrompt,
  toAiToolChoice,
} from "@/lib/openai-compat";

describe("OpenAI compatibility adapter", () => {
  it("moves caller instructions outside AI SDK message history", () => {
    expect(toAiPrompt([
      { role: "system", content: "Be concise." },
      { role: "developer", content: "Use repository conventions." },
      { role: "user", content: "Fix tests." },
    ])).toEqual({
      instructions: ["Be concise.", "Use repository conventions."],
      messages: [{ role: "user", content: "Fix tests." }],
    });
  });

  it("correlates tool results with prior calls in linear time", () => {
    const { messages } = toAiPrompt([
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"README.md"}' },
        }],
      },
      { role: "tool", tool_call_id: "call_1", content: "contents" },
    ]);

    expect(messages[1]).toEqual({
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "read_file",
        output: { type: "text", value: "contents" },
      }],
    });
  });

  it("preserves reasoning content in assistant tool-call history", () => {
    const request = chatCompletionRequestSchema.parse({
      model: "model",
      messages: [{
        role: "assistant",
        content: null,
        reasoning_content: "Inspect the repository first.",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"README.md"}' },
        }],
      }],
    });

    expect(toAiPrompt(request.messages).messages[0]).toEqual({
      role: "assistant",
      content: [
        { type: "reasoning", text: "Inspect the repository first." },
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "read_file",
          input: { path: "README.md" },
        },
      ],
    });
  });

  it("rejects tool results that appear before their assistant call", () => {
    expect(() => toAiPrompt([
      { role: "tool", tool_call_id: "call_1", content: "contents" },
    ])).toThrow("No assistant tool call found");
  });

  it("accepts both OpenAI output-token fields", () => {
    expect(chatCompletionRequestSchema.parse({
      model: "model",
      messages: [{ role: "user", content: "hello" }],
      max_completion_tokens: 100,
    }).max_completion_tokens).toBe(100);
  });

  it("rejects unsupported request fields instead of silently ignoring them", () => {
    const result = chatCompletionRequestSchema.safeParse({
      model: "model",
      messages: [{ role: "user", content: "hello" }],
      unsupported_option: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate caller tool names", () => {
    const tool = {
      type: "function" as const,
      function: { name: "read_file", parameters: { type: "object" } },
    };
    const result = chatCompletionRequestSchema.safeParse({
      model: "model",
      messages: [{ role: "user", content: "hello" }],
      tools: [tool, tool],
    });
    expect(result.success).toBe(false);
  });

  it("maps tool choice and finish reason names", () => {
    expect(toAiToolChoice({ type: "function", function: { name: "read_file" } }))
      .toEqual({ type: "tool", toolName: "read_file" });
    expect(openAiFinishReason("tool-calls")).toBe("tool_calls");
  });
});
