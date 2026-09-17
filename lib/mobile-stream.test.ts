import { describe, expect, it } from "vitest";

import { mergeMobileStreamText, type MobileMessage } from "./mobile-stream";

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
