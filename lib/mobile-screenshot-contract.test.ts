import { describe, expect, it } from "vitest";
import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import { mergeMobileStreamText, projectStoredResponse, MAX_TOOL_OUTPUT_CHARS } from "./mobile-stream";
import { groupConsecutiveScreenshots, screenshotDimensions, screenshotReference } from "./computer-use/screenshot-contract";

const result = {
  ok: true, op: "screenshot", screenshotId: "cu_capture_first",
  screenshotUrl: "https://example.test/api/computer-use/screenshots/cu_capture_first",
  screenshotSessionId: "a".repeat(32), screenshotCreatedAt: 123,
  mimeType: "image/png", width: 1, height: 1,
};
const text = { type: "text", text: JSON.stringify(result) };
const image = { type: "image", data: "pixels".repeat(MAX_TOOL_OUTPUT_CHARS), mimeType: "image/png" };
const stored = (id: string, output: unknown) => ({
  type: "tool-computer_screenshot", toolCallId: id, state: "output-available", input: {}, output,
} satisfies UIMessagePart<UIDataTypes, UITools>);

describe("V-113 client contract fixtures", () => {
  it.each([result, JSON.stringify(result), { content: [text, image] }, [text, image], { type: "content", value: [text, image] }])(
    "projects every live/stored envelope without inline pixels or preview truncation", (output) => {
      const response = projectStoredResponse([stored("call-first", output)], "success");
      expect(response.tools[0]).toMatchObject({ id: "call-first", status: "completed", screenshot: {
        id: result.screenshotId, url: result.screenshotUrl, sessionId: result.screenshotSessionId,
        createdAt: 123, mimeType: "image/png", width: 1, height: 1,
      } });
      expect(response.parts[0]).toMatchObject({ type: "tool", id: "call-first", tool: response.tools[0] });
      expect(JSON.stringify(response)).not.toContain(image.data);
    },
  );

  it("retains ordered captures and stable IDs independently of output preview size and reload", () => {
    const outputs = [result, { ...result, screenshotId: "cu_capture_second", screenshotUrl: "https://example.test/second", title: "x".repeat(5000) }];
    const parts = outputs.map((output, index) => stored(`call-${index}`, output));
    const first = projectStoredResponse(parts, "success"), reload = projectStoredResponse(parts, "success");
    expect(first).toEqual(reload);
    expect(first.tools.map((tool) => tool.screenshot?.id)).toEqual(["cu_capture_first", "cu_capture_second"]);
    expect(first.tools[1].outputTruncated).toBe(true);
    expect(first.tools[1].screenshot?.url).toBe("https://example.test/second");
    expect(first.parts).toHaveLength(2);
  });

  it("groups only adjacent successful screenshots and preserves newest-last order", () => {
    const first = screenshotReference(result)!;
    const second = screenshotReference({ ...result, screenshotId: "cu_capture_second" })!;
    const third = screenshotReference({ ...result, screenshotId: "cu_capture_third" })!;
    const groups = groupConsecutiveScreenshots([first, second, undefined, third]);

    expect(groups).toEqual([
      { startIndex: 0, endIndex: 2, screenshots: [first, second] },
      { startIndex: 3, endIndex: 4, screenshots: [third] },
    ]);
    expect(groups[0].screenshots.at(-1)?.id).toBe("cu_capture_second");
  });

  it("duplicate stream events keep one call and match stored replay", () => {
    const input = { type: "tool-input-available" as const, toolCallId: "call-first", toolName: "computer_screenshot", input: {} };
    const output = { type: "tool-output-available" as const, toolCallId: "call-first", output: { content: [text, image] } };
    const messages = mergeMobileStreamText(
      [{ id: "pending", role: "assistant", text: "", order: 2, createdAt: 1, status: "pending" }],
      [{ streamId: "stream-1", order: 2, stepOrder: 0 }],
      [{ streamId: "stream-1", start: 0, parts: [input, output, output] }],
    );
    expect(messages[0].response?.tools).toHaveLength(1);
    expect(messages[0].response?.tools[0].screenshot).toEqual(projectStoredResponse([stored("call-first", result)], "success").tools[0].screenshot);
  });

  it("does not invent success images for failure/loading or change non-screenshot activity", () => {
    const response = projectStoredResponse([
      stored("failure", { ...result, ok: false, error: "Capture failed" }),
      { type: "tool-computer_screenshot", toolCallId: "loading", state: "input-available", input: {} },
      { ...stored("act", result), type: "tool-computer_act" },
      { type: "tool-computer_screenshot", toolCallId: "failed-state", state: "output-error", input: {}, errorText: "Failed" },
    ], "success");
    expect(response.tools.every((tool) => tool.screenshot === undefined)).toBe(true);
    expect(response.tools.map((tool) => tool.status)).toEqual(["completed", "failed", "completed", "failed"]);
    expect(response.tools[0].output).toContain("Capture failed");
    expect(response.tools[2].name).toBe("computer_act");
    const loading = projectStoredResponse([{ type: "tool-computer_screenshot", toolCallId: "loading", state: "input-available", input: {} }], "pending");
    expect(loading.tools[0]).toMatchObject({ status: "running" });
    expect(loading.tools[0].screenshot).toBeUndefined();
  });

  it("separate thread/turn snapshots cannot share projection state", () => {
    const first = projectStoredResponse([stored("same-call", result)], "success");
    const second = projectStoredResponse([stored("same-call", { ...result, screenshotId: "cu_other_session", screenshotSessionId: "b".repeat(32) })], "success");
    expect(first.tools[0].screenshot?.id).toBe("cu_capture_first");
    expect(second.tools[0].screenshot?.sessionId).toBe("b".repeat(32));
  });

  it("uses intrinsic PNG and JPEG dimensions and rejects incomplete dimension headers", () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    expect(screenshotDimensions(png)).toEqual({ width: 1, height: 1 });
    expect(screenshotDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 10, 0, 20]))).toEqual({ width: 20, height: 10 });
    expect(screenshotDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 20]))).toBeUndefined();
    expect(screenshotReference({ ...result, width: -1 })).toBeUndefined();
  });
});
