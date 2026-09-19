import { describe, expect, it } from "vitest";

import {
  MAX_TOOL_OUTPUT_CHARS,
  mergeMobileStreamText,
  type MobileMessage,
} from "./mobile-stream";

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
  it("materializes an empty waiting row as soon as a stream exists", () => {
    const result = mergeMobileStreamText(
      [{ ...pendingMessage, text: "", status: "pending" }],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [],
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("streaming");
    expect(result[0].text).toBe("");
    expect(result[0].response).toEqual({ phase: "waiting", tools: [] });
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
      { id: "call-1", name: "web_search", status: "running" },
    ]);
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

    expect(result[0].response).toEqual({
      phase: "responding",
      tools: [{ id: "call-1", name: "web_search", status: "completed", output: "Result" }],
    });
    expect(result[0].text).toBe("Here");
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
});
