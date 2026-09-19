import { describe, expect, it } from "vitest";
import type { MessageDoc } from "@convex-dev/agent/validators";
import type { UIMessageChunk } from "ai";
import { mobileMessages, unfinishedMobileText, USER_STOPPED_GENERATION } from "./mobile-stream";

const user: MessageDoc = {
  _id: "user", _creationTime: 1, threadId: "thread", order: 2, stepOrder: 0,
  status: "success", tool: false, message: { role: "user", content: "Hello" },
};
const pending: MessageDoc = {
  ...user, _id: "pending", stepOrder: 1, status: "pending", message: undefined,
};
const stream = { streamId: "stream", order: 2, stepOrder: 1, status: "streaming" as const };
function project(parts: UIMessageChunk[], docs = [user, pending]) {
  return mobileMessages("thread", docs, [stream], [{ streamId: "stream", start: 0, parts }]);
}
const assistant = (parts: UIMessageChunk[]) => project(parts).at(-1);

describe("native response lifecycle", () => {
  it("shows waiting before the first token, even without a pending document", () => {
    expect(assistant([])?.response.phase).toBe("waiting");
    expect(project([], [user]).at(-1)).toMatchObject({
      id: "thread:assistant:2", text: "", response: { phase: "waiting" },
    });
  });

  it("uses reasoning events, then returns to working until text arrives", () => {
    expect(assistant([{ type: "reasoning-start", id: "r" }])?.response.phase).toBe("thinking");
    expect(assistant([
      { type: "reasoning-start", id: "r" }, { type: "reasoning-end", id: "r" },
    ])?.response.phase).toBe("waiting");
    expect(assistant([{ type: "text-delta", id: "t", delta: "Hello" }])).toMatchObject({
      text: "Hello", response: { phase: "responding" },
    });
  });

  it("tracks concurrent named tools independently of text and reasoning", () => {
    const calls: UIMessageChunk[] = [
      { type: "tool-input-start", toolCallId: "a", toolName: "search" },
      { type: "tool-input-available", toolCallId: "b", toolName: "read_page", input: {} },
      { type: "tool-output-available", toolCallId: "a", output: "sensitive output" },
    ];
    expect(assistant(calls)?.response).toEqual({ phase: "tool", tools: [
      { id: "a", name: "search", status: "completed" },
      { id: "b", name: "read_page", status: "running" },
    ] });
    expect(assistant([...calls, { type: "tool-output-error", toolCallId: "b", errorText: "secret" }])?.response)
      .toEqual({ phase: "waiting", tools: [
        { id: "a", name: "search", status: "completed" },
        { id: "b", name: "read_page", status: "failed" },
      ] });
  });

  it("keeps assistant identity from streaming through persisted completion", () => {
    const finished: MessageDoc = { ...pending, status: "success", message: { role: "assistant", content: "Final" } };
    const result = project([{ type: "text-delta", id: "t", delta: "Stale partial" }], [user, finished]);
    expect(result.at(-1)).toMatchObject({
      id: assistant([])?.id, text: "Final", response: { phase: "complete" },
    });
  });

  it("restores stopped and failed replies without any active stream", () => {
    for (const [error, phase] of [[USER_STOPPED_GENERATION, "stopped"], ["Provider secret", "failed"]]) {
      const failed: MessageDoc = { ...pending, status: "failed", error, message: { role: "assistant", content: "Partial" } };
      const response = mobileMessages("thread", [user, failed], [], []).at(-1);
      expect(response).toMatchObject({ text: "Partial", response: { phase } });
      expect(JSON.stringify(response)).not.toContain("Provider secret");
    }
  });

  it("does not double-count a saved intermediate step covered by the active stream", () => {
    const toolCall: MessageDoc = {
      ...pending, status: "success", tool: true,
      message: { role: "assistant", content: [
        { type: "text", text: "Searching. " },
        { type: "tool-call", toolCallId: "a", toolName: "search", input: {} },
      ] },
    };
    const result = project([
      { type: "text-delta", id: "t", delta: "Searching. " },
      { type: "tool-input-available", toolCallId: "a", toolName: "search", input: {} },
      { type: "tool-output-available", toolCallId: "a", output: "result" },
      { type: "finish-step" },
      { type: "text-delta", id: "t2", delta: "Answer" },
    ], [user, toolCall, { ...pending, _id: "next", stepOrder: 3 }]);
    expect(result.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(result.at(-1)).toMatchObject({ text: "Searching. Answer", response: { phase: "responding" } });
  });

  it("replays out-of-order batches in cursor order", () => {
    const result = mobileMessages("thread", [user, pending], [stream], [
      { streamId: "stream", start: 2, parts: [{ type: "text-delta", id: "t", delta: "world" }] },
      { streamId: "stream", start: 0, parts: [{ type: "text-delta", id: "t", delta: "Hello " }] },
    ]);
    expect(result.at(-1).text).toBe("Hello world");
  });

  it("restores persisted tool results after the delta stream disappears", () => {
    const docs: MessageDoc[] = [user, {
      ...pending, status: "success", tool: true,
      message: { role: "assistant", content: [{ type: "tool-call", toolCallId: "a", toolName: "search", input: {} }] },
    }, {
      ...pending, _id: "result", stepOrder: 2, status: "success", tool: true,
      message: { role: "tool", content: [{ type: "tool-result", toolCallId: "a", toolName: "search", output: { type: "text", value: "Result" } }] },
    }, {
      ...pending, _id: "final", stepOrder: 3, status: "success", message: { role: "assistant", content: "Answer" },
    }];
    expect(mobileMessages("thread", docs, [], []).at(-1)).toMatchObject({
      text: "Answer", response: { phase: "complete", tools: [{ id: "a", name: "search", status: "completed" }] },
    });
  });
});

describe("unfinished response persistence", () => {
  const saved: MessageDoc = {
    ...pending, status: "success", tool: true,
    message: { role: "assistant", content: "Searching. " },
  };
  it("does not duplicate a committed step when finish-step has not arrived yet", () => {
    expect(unfinishedMobileText([saved], stream, [{
      streamId: "stream", start: 0,
      parts: [{ type: "text-delta", id: "t", delta: "Searching. " }],
    }])).toBe("");
  });
  it("retains only the unfinished step after a saved tool step", () => {
    expect(unfinishedMobileText([saved], stream, [{
      streamId: "stream", start: 0,
      parts: [
        { type: "text-delta", id: "t", delta: "Searching. " },
        { type: "finish-step" },
        { type: "text-delta", id: "t2", delta: "Partial answer" },
      ],
    }])).toBe("Partial answer");
  });
});

it("completes a tool-only turn when no pending step or active stream remains", () => {
  const toolOnly: MessageDoc = {
    ...pending, tool: true, status: "success",
    message: { role: "assistant", content: [{ type: "tool-call", toolCallId: "a", toolName: "search", input: {} }] },
  };
  expect(mobileMessages("thread", [user, toolOnly], [], []).at(-1).response.phase).toBe("complete");
});
