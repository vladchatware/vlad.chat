import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMCPClient } from "@ai-sdk/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { convertToModelMessages, generateText, isStepCount } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { putScreenshot } from "./artifacts";
import { registerComputerUseMcpTools } from "./mcp-tools";
import { runComputerOp } from "./sandbox";
import { createComputerUseTools } from "./tools";
import type { ComputerToolResult } from "./types";
import { computerToolMcpResult, computerToolModelOutput } from "./vision";
import { MAX_TOOL_OUTPUT_CHARS, projectStoredResponse, toolOutputText } from "../mobile-stream";

vi.mock("./sandbox", () => {
  return {
    COMPUTER_USE_MAX_STEPS: 20,
    COMPUTER_USE_MAX_TTL_MS: 8 * 60 * 1000,
    ComputerUseCapError: class extends Error {},
    computerUseEnabled: () => true,
    resolveSandboxCredentials: () => ({ mode: "oidc" }),
    runComputerOp: vi.fn(),
    endComputerSession: vi.fn(),
  };
});

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const budget = {
  stepsUsed: 1,
  stepsRemaining: 19,
  maxSteps: 20,
  ttlMs: 8 * 60 * 1000,
  elapsedMs: 100,
  note: "test",
};

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
  vi.stubEnv("COMPUTER_USE_STORAGE_SECRET", "");
  vi.mocked(runComputerOp).mockResolvedValue({
    meta: { url: "https://example.com", title: "Example" },
    png,
    sandboxName: "vision-test",
    viewerUrl: "https://vision-test.vercel.run/vnc.html",
    budget,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function screenshotResult(): Promise<ComputerToolResult> {
  const artifact = await putScreenshot("vision-test", png);
  return {
    ok: true,
    op: "screenshot",
    screenshotId: artifact.id,
    screenshotUrl: `https://example.com/api/computer-use/screenshots/${artifact.id}`,
    viewerUrl: "https://vision-test.vercel.run/vnc.html",
    mimeType: artifact.contentType,
  };
}

function visionModel(toolName: string, input: Record<string, string | object>) {
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [{ type: "tool-call", toolCallId: "vision-1", toolName, input: JSON.stringify(input) }],
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "Screenshot received." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      },
    ],
  });
}

function expectModelPixels(model: MockLanguageModelV4) {
  expect(model.doGenerateCalls).toHaveLength(2);
  const toolMessages = model.doGenerateCalls[1].prompt.filter((message) => message.role === "tool");
  const toolResult = toolMessages.flatMap((message) => message.content).find((part) => part.type === "tool-result");
  expect(toolResult?.output.type).toBe("content");
  if (toolResult?.output.type !== "content") throw new Error("Missing multimodal tool result");
  const image = toolResult.output.value.find((part) => part.type === "file");
  expect(image?.mediaType).toBe("image/png");
  if (image?.data.type !== "data") throw new Error("Missing inline screenshot pixels");
  const bytes = typeof image.data.data === "string"
    ? Buffer.from(image.data.data, "base64")
    : Buffer.from(image.data.data);
  expect(bytes).toEqual(png);
}

describe("computer-use vision content", () => {
  it("carries stored pixels beside unchanged mobile JSON", async () => {
    const result = await screenshotResult();
    const mcp = await computerToolMcpResult(result);
    expect(mcp.content).toEqual([
      { type: "text", text: JSON.stringify(result) },
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
    ]);
    expect(toolOutputText(mcp)).toBe(JSON.stringify(result));
    expect(toolOutputText(mcp).length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS);
  });

  it("uses the stored image MIME type rather than guessed metadata", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const artifact = await putScreenshot("vision-test", jpeg);
    const output = await computerToolModelOutput({
      ok: true,
      op: "act",
      screenshotId: artifact.id,
      mimeType: "image/png",
    });
    expect(output.value[1]).toEqual({
      type: "file",
      mediaType: "image/jpeg",
      data: { type: "data", data: jpeg.toString("base64") },
    });
  });

  it("preserves compact computer JSON when Convex replays multimodal results", async () => {
    const result = await screenshotResult();
    const modelOutput = await computerToolModelOutput(result);
    // Real captures exceed the native preview limit; replay must extract text
    // before truncation, including when images are materialized as file URLs.
    modelOutput.value.push({
      type: "file",
      mediaType: "image/png",
      data: { type: "data", data: "a".repeat(MAX_TOOL_OUTPUT_CHARS * 2) },
    });
    expect(toolOutputText(modelOutput)).toBe(JSON.stringify(result));
    expect(toolOutputText(modelOutput.value)).toBe(JSON.stringify(result));
    const response = projectStoredResponse([
      {
        type: "tool-computer_screenshot",
        toolCallId: "vision-replay",
        state: "output-available",
        input: {},
        output: modelOutput.value,
      },
    ], "success");
    expect(response.tools[0].output).toBe(JSON.stringify(result));
    expect(response.tools[0].outputTruncated).toBe(false);
  });

  it.each<ComputerToolResult>([
    { ok: true, op: "open", viewerUrl: "https://vision-test.vercel.run/vnc.html" },
    { ok: false, op: "act", code: "step_limit", error: "Step limit reached" },
    { ok: true, op: "end" },
  ])("preserves $op results without inventing images", async (result) => {
    expect(await computerToolMcpResult(result)).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
    });
  });

  it("reports expired screenshots instead of pretending the model saw them", async () => {
    vi.useFakeTimers();
    const result = await screenshotResult();
    vi.advanceTimersByTime(30 * 60 * 1000);
    const output = await computerToolMcpResult(result);
    expect(output.isError).toBe(true);
    expect(output.content).toHaveLength(1);
    expect(JSON.parse(toolOutputText(output))).toMatchObject({
      ok: false,
      code: "runtime",
      viewerUrl: result.viewerUrl,
      error: expect.stringContaining("Call computer_screenshot before acting again"),
    });
  });

  it.each(["screenshot", "act"] as const)("reports missing %s captures before another action", async (op) => {
    const output = await computerToolMcpResult({ ok: true, op });
    expect(output.isError).toBe(true);
    expect(JSON.parse(toolOutputText(output))).toMatchObject({ ok: false, op, code: "runtime" });
    expect(toolOutputText(output)).toContain("previous action may already have completed");
  });

  it("reports storage download failures with recovery instructions", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
    vi.stubEnv("COMPUTER_USE_STORAGE_SECRET", "test-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unavailable", { status: 503 }));
    const output = await computerToolMcpResult({ ok: true, op: "screenshot", screenshotId: "cu_missing" });
    expect(output.isError).toBe(true);
    expect(toolOutputText(output)).toContain("Convex screenshot download failed (503)");
    expect(toolOutputText(output)).not.toContain("test-secret");
  });

  it("loads production pixels from private storage without fetching the public preview URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
    vi.stubEnv("COMPUTER_USE_STORAGE_SECRET", "test-secret");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(png, {
      headers: {
        "content-type": "image/png",
        "x-computer-use-session": "vision-test",
        "x-computer-use-created-at": "100",
      },
    }));
    const output = await computerToolMcpResult({
      ok: true,
      op: "screenshot",
      screenshotId: "cu_private",
      screenshotUrl: "https://protected-preview.example/api/computer-use/screenshots/cu_private",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("https://test.convex.site/computer-use/screenshots/cu_private", {
      headers: { Authorization: "Bearer test-secret" },
      cache: "no-store",
    });
    expect(output.content[1]).toEqual({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
  });
});

describe("model receives screenshot pixels", () => {
  it.each([
    ["computer_screenshot", { sessionId: "vision-test" }],
    ["computer_act", { sessionId: "vision-test", action: { type: "click", x: 10, y: 10 } }],
    ["computer_handoff", { sessionId: "vision-test", reason: "sso" }],
  ] as const)("%s crosses the real MCP adapter into the next model turn", async (toolName, input) => {
    const server = new McpServer({ name: "vision-test", version: "1.0.0" });
    registerComputerUseMcpTools(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = await createMCPClient({ transport: clientTransport });
    try {
      const model = visionModel(toolName, input);
      const response = await generateText({
        model,
        prompt: "Inspect the browser.",
        tools: await client.tools(),
        stopWhen: isStepCount(2),
      });
      expectModelPixels(model);
      const mobileJSON = toolOutputText(response.steps[0].toolResults[0].output);
      expect(JSON.parse(mobileJSON)).toMatchObject({ ok: true, screenshotId: expect.any(String) });
      expect(mobileJSON.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS);
      expect(mobileJSON).not.toContain(png.toString("base64"));
      expect(response.warnings).toEqual([]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("direct AI SDK tools deliver pixels while execute output stays compact", async () => {
    const model = visionModel("computer_screenshot", {});
    const response = await generateText({
      model,
      prompt: "Inspect the browser.",
      tools: createComputerUseTools({ userId: "vision-test" }),
      stopWhen: isStepCount(2),
    });
    expectModelPixels(model);
    const output = response.steps[0].toolResults[0].output;
    expect(output).toMatchObject({ ok: true, op: "screenshot", screenshotId: expect.any(String) });
    expect(JSON.stringify(output)).not.toContain(png.toString("base64"));
    expect(response.warnings).toEqual([]);
  });

  it("rehydrates direct-tool screenshot history for subsequent user turns", async () => {
    const result = await screenshotResult();
    const history = await convertToModelMessages([
      {
        role: "assistant",
        parts: [{
          type: "tool-computer_screenshot",
          toolCallId: "vision-history-shot",
          state: "output-available",
          input: {},
          output: result,
        }],
      },
    ], { tools: createComputerUseTools({ userId: "vision-test" }) });
    const toolMessage = history.find((message) => message.role === "tool");
    const toolResult = toolMessage?.content[0];
    if (toolResult?.type !== "tool-result" || toolResult.output.type !== "content") {
      throw new Error("Missing rehydrated screenshot content");
    }
    expect(toolResult.output.value[1]).toEqual({
      type: "file",
      mediaType: "image/png",
      data: { type: "data", data: png.toString("base64") },
    });
  });
});
