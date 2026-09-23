import { describe, expect, it } from "vitest";

import {
  MAX_TOOL_OUTPUT_CHARS,
  mergeMobileStreamText,
  projectStoredResponse,
  type MobileResponse,
  type MobileMessage,
} from "./mobile-stream";
import type { UIDataTypes, UIMessagePart, UITools } from "ai";

const pendingMessage: MobileMessage = {
  id: "pending",
  role: "assistant",
  text: "",
  status: "pending",
  order: 2,
  createdAt: 1,
};

describe("mergeMobileStreamText", () => {
  it("hydrates a pending assistant message from ordered stream deltas", () => {
    const result = mergeMobileStreamText(
      [pendingMessage],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [
        {
          streamId: "stream-1",
          start: 2,
          parts: [{ type: "text-delta", id: "text", delta: "world" }],
        },
        {
          streamId: "stream-1",
          start: 0,
          parts: [{ type: "text-delta", id: "text", delta: "Hello " }],
        },
      ],
    );

    expect(result[0]).toMatchObject({ text: "Hello world", status: "streaming" });
  });

  it("does not replace a finalized message with stale stream data", () => {
    const finalized = { ...pendingMessage, text: "Final", status: "success" };
    const result = mergeMobileStreamText(
      [finalized],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [{
        streamId: "stream-1",
        start: 0,
        parts: [{ type: "text-delta", id: "text", delta: "Partial" }],
      }],
    );

    expect(result[0]).toEqual(finalized);
  });

  it("materializes a streaming assistant before its pending message exists", () => {
    const userMessage = {
      ...pendingMessage,
      id: "user",
      role: "user",
      text: "Hello",
      status: "success",
    };
    const result = mergeMobileStreamText(
      [userMessage],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [{
        streamId: "stream-1",
        start: 0,
        parts: [{ type: "text-delta", id: "text", delta: "Partial" }],
      }],
    );

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      id: "stream:stream-1",
      role: "assistant",
      text: "Partial",
      status: "streaming",
    });
  });
});

describe("mergeMobileStreamText response activity", () => {
  it("materializes an active thinking row before provider output exists", () => {
    const result = mergeMobileStreamText(
      [{ ...pendingMessage, text: "", status: "pending" }],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [],
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("streaming");
    expect(result[0].text).toBe("");
    expect(result[0].response).toEqual({ phase: "thinking", parts: [], tools: [] });
  });

  it("reports thinking while reasoning streams", () => {
    const result = mergeMobileStreamText(
      [pendingMessage],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [{
        streamId: "stream-1",
        start: 0,
        parts: [{ type: "reasoning-start", id: "r" }],
      }],
    );

    expect(result[0].response?.phase).toBe("thinking");
  });

  it("surfaces a running tool call with its name", () => {
    const result = mergeMobileStreamText(
      [pendingMessage],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [{
        streamId: "stream-1",
        start: 0,
        parts: [{ type: "tool-input-start", toolCallId: "call-1", toolName: "web_search" }],
      }],
    );

    expect(result[0].response?.phase).toBe("tool");
    expect(result[0].response?.tools).toEqual([
      { id: "call-1", name: "web_search", status: "pending" },
    ]);
  });

  it("summarizes generic scalar tool input without exposing raw JSON", () => {
    const result = mergeMobileStreamText(
      [pendingMessage],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [{
        streamId: "stream-1",
        start: 0,
        parts: [{
          type: "tool-input-available",
          toolCallId: "call-1",
          toolName: "future_tool",
          input: { limit: 5, includeArchived: true, nested: { ignored: true } },
        }],
      }],
    );

    expect(result[0].response?.tools[0]).toMatchObject({
      inputSummary: "limit: 5, includeArchived: true",
    });
  });

  it("streams a preliminary tool result while the tool is still running", () => {
    const result = mergeMobileStreamText(
      [pendingMessage],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [{
        streamId: "stream-1",
        start: 0,
        parts: [
          { type: "tool-input-start", toolCallId: "call-1", toolName: "web_search" },
          {
            type: "tool-output-available",
            toolCallId: "call-1",
            output: { content: [{ type: "text", text: "partial" }] },
            preliminary: true,
          },
        ],
      }],
    );

    expect(result[0].response?.tools[0]).toMatchObject({
      name: "web_search",
      status: "running",
      output: "partial",
    });
  });

  it("completes the tool result and resumes after answers arrive", () => {
    const result = mergeMobileStreamText(
      [pendingMessage],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [
        {
          streamId: "stream-1",
          start: 0,
          parts: [
            { type: "tool-input-available", toolCallId: "call-1", toolName: "web_search", input: {} },
            {
              type: "tool-output-available",
              toolCallId: "call-1",
              output: { content: [{ type: "text", text: "Result" }] },
            },
            { type: "text-delta", id: "text", delta: "Here" },
          ],
        },
      ],
    );

    expect(result[0].response).toMatchObject({
      phase: "responding",
      tools: [{ id: "call-1", name: "web_search", status: "completed", output: "Result" }],
      parts: [
        {
          id: "call-1",
          type: "tool",
          tool: { id: "call-1", name: "web_search", status: "completed", output: "Result" },
        },
        { type: "text", text: "Here", state: "streaming" },
      ],
    });
    expect(result[0].text).toBe("Here");
  });

  it("preserves text, tool, and later text in presentation order", () => {
    const result = mergeMobileStreamText(
      [pendingMessage],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [{
        streamId: "stream-1",
        start: 0,
        parts: [
          { type: "text-delta", id: "text-1", delta: "Before" },
          { type: "tool-input-start", toolCallId: "call-1", toolName: "web_search" },
          { type: "tool-output-available", toolCallId: "call-1", output: "Result" },
          { type: "text-delta", id: "text-2", delta: "After" },
        ],
      }],
    );

    expect(result[0].response?.parts.map((part) => part.type)).toEqual([
      "text",
      "tool",
      "text",
    ]);
  });

  it("truncates oversized tool output", () => {
    const result = mergeMobileStreamText(
      [pendingMessage],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [{
        streamId: "stream-1",
        start: 0,
        parts: [
          { type: "tool-input-start", toolCallId: "call-1", toolName: "read_page" },
          {
            type: "tool-output-available",
            toolCallId: "call-1",
            output: "x".repeat(MAX_TOOL_OUTPUT_CHARS + 500),
          },
        ],
      }],
    );

    const output = result[0].response?.tools[0]?.output ?? "";
    expect(output.endsWith("…")).toBe(true);
    expect(output.length).toBe(MAX_TOOL_OUTPUT_CHARS + 1);
  });

  it("settles an open tool when the response is aborted", () => {
    const result = mergeMobileStreamText(
      [pendingMessage],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [{
        streamId: "stream-1",
        start: 0,
        parts: [
          { type: "tool-input-start", toolCallId: "call-1", toolName: "web_search" },
          { type: "abort", reason: "User stopped generation." },
        ],
      }],
    );

    expect(result[0].response).toMatchObject({
      phase: "stopped",
      errorText: "User stopped generation.",
      tools: [{ id: "call-1", status: "stopped", errorText: "User stopped generation." }],
    });
  });

  it("does not leave a running tool open after a terminal finish", () => {
    const result = mergeMobileStreamText(
      [pendingMessage],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [{
        streamId: "stream-1",
        start: 0,
        parts: [
          { type: "tool-input-start", toolCallId: "call-1", toolName: "web_search" },
          { type: "finish" },
        ],
      }],
    );

    expect(result[0].response).toMatchObject({
      phase: "failed",
      tools: [{ id: "call-1", status: "failed" }],
    });
  });
});

describe("projectStoredResponse", () => {
  it("keeps ordered text, reasoning, sources, and terminal state", () => {
    const parts: UIMessagePart<UIDataTypes, UITools>[] = [
      { type: "reasoning", text: "Think", state: "done" },
      { type: "text", text: "Answer", state: "done" },
      { type: "source-url", sourceId: "source-1", url: "https://example.com", title: "Example" },
    ];

    const response: MobileResponse = projectStoredResponse(parts, "success");

    expect(response).toMatchObject({
      phase: "complete",
      parts: [
        { type: "reasoning", text: "Think", state: "done" },
        { type: "text", text: "Answer", state: "done" },
        { type: "source", sourceId: "source-1", url: "https://example.com", title: "Example" },
      ],
    });
  });

  it("derives an active phase from stored partial content", () => {
    const textResponse = projectStoredResponse(
      [{ type: "text", text: "Partial answer", state: "streaming" }],
      "pending",
    );
    const toolResponse = projectStoredResponse(
      [{
        type: "dynamic-tool",
        toolName: "web_search",
        toolCallId: "call-1",
        state: "input-available",
        input: { query: "Vlad" },
      }],
      "pending",
    );

    expect(textResponse.phase).toBe("responding");
    expect(toolResponse.phase).toBe("tool");
  });

  it("preserves a failed terminal state and error text", () => {
    const response = projectStoredResponse([], "failed", "Provider failed");

    expect(response).toMatchObject({
      phase: "failed",
      errorText: "Provider failed",
      parts: [],
    });
  });

  it("does not let a successful message status hide a stored tool error", () => {
    const parts: UIMessagePart<UIDataTypes, UITools>[] = [
      {
        type: "dynamic-tool",
        toolName: "web_search",
        toolCallId: "call-1",
        state: "output-error",
        input: { query: "Vlad" },
        errorText: "Search failed",
      },
    ];

    const response = projectStoredResponse(parts, "success");

    expect(response.phase).toBe("failed");
    expect(response.errorText).toBe("Search failed");
    expect(response.tools[0]).toMatchObject({
      id: "call-1",
      status: "failed",
      errorText: "Search failed",
    });
  });

  it("settles a stored running tool when the message failed", () => {
    const parts: UIMessagePart<UIDataTypes, UITools>[] = [
      {
        type: "dynamic-tool",
        toolName: "web_search",
        toolCallId: "call-1",
        state: "input-available",
        input: { query: "Vlad" },
      },
    ];

    const response = projectStoredResponse(parts, "failed", "Provider failed");

    expect(response).toMatchObject({
      phase: "failed",
      tools: [{ id: "call-1", status: "failed", errorText: "Provider failed" }],
    });
  });

  it("does not mark a success terminal while a stored tool is still open", () => {
    const parts: UIMessagePart<UIDataTypes, UITools>[] = [
      {
        type: "dynamic-tool",
        toolName: "web_search",
        toolCallId: "call-1",
        state: "input-available",
        input: { query: "Vlad" },
      },
    ];

    const response = projectStoredResponse(parts, "success");

    expect(response).toMatchObject({
      phase: "failed",
      errorText: "Tool did not return a final result.",
      tools: [{ id: "call-1", status: "failed" }],
    });
  });

  it("keeps an approved stored tool running until output arrives", () => {
    const parts: UIMessagePart<UIDataTypes, UITools>[] = [
      {
        type: "dynamic-tool",
        toolName: "web_search",
        toolCallId: "call-1",
        state: "approval-responded",
        input: { query: "Vlad" },
        approval: { id: "approval-1", approved: true },
      },
    ];

    const response = projectStoredResponse(parts, "pending");

    expect(response).toMatchObject({
      phase: "tool",
      tools: [{ id: "call-1", status: "running" }],
    });
  });
});
