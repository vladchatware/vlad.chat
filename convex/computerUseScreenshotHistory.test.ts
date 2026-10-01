import { convexTest } from "convex-test";
import agentTest from "@convex-dev/agent/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, components, internal } from "./_generated/api";
import { retainedScreenshotTool } from "@/lib/computer-use/retained-screenshot-tool";
import { generateText, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { saveMessages } from "@convex-dev/agent";
import { httpRouter } from "convex/server";

const modules = {
  "./computerUseScreenshots.ts": () => import("./computerUseScreenshots"),
  "./_generated/server.ts": () => import("./_generated/server"),
  "./threads.ts": () => import("./threads"),
  "./http.ts": async () => {
    const { upload, download } = await import("./computerUseScreenshots");
    const http = httpRouter();
    http.route({ path: "/computer-use/screenshots", method: "POST", handler: upload });
    http.route({ pathPrefix: "/computer-use/screenshots/", method: "GET", handler: download });
    return { default: http };
  },
};
const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64",
));

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const otherUser = await t.run((ctx) => ctx.db.insert("users", {}));
  const thread = await t.run((ctx) => ctx.runMutation(components.agent.threads.createThread, { userId }));
  const otherThread = await t.run((ctx) => ctx.runMutation(components.agent.threads.createThread, { userId }));
  const runId = await t.run((ctx) => ctx.db.insert("agentRuns", {
    threadId: thread._id, userId, order: 2, model: "test", searchEnabled: false,
    status: "running", stepCount: 1, attemptCount: 1, createdAt: 1, updatedAt: 1,
  }));
  const auth = t.withIdentity({ subject: `${userId}|session` });
  const capture = async (artifactId = "cu_capture_1", sessionId = "a".repeat(32), threadId = thread._id) => {
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([png], { type: "image/png" })));
    const args = {
      artifactId, storageId, sessionKey: String(userId), threadId, sessionId,
      contentType: "image/png" as const, size: png.length, width: 1, height: 1,
      digest: "same-image-digest", createdAt: Date.now(), expiresAt: Date.now() + 1_800_000,
    };
    await t.mutation(internal.computerUseScreenshots.save, args);
    const resultJson = JSON.stringify({
      ok: true, op: "screenshot", screenshotId: artifactId,
      screenshotUrl: `/api/computer-use/screenshots/${artifactId}`,
      screenshotSessionId: sessionId, mimeType: "image/png", width: 1, height: 1,
    });
    return { args, resultJson };
  };
  const retain = (captured: Awaited<ReturnType<typeof capture>>, toolCallId = "call-1") =>
    t.mutation(internal.computerUseScreenshots.retainForToolCall, {
      artifactId: captured.args.artifactId, runId, stepNumber: 1, toolCallId, resultJson: captured.resultJson,
    });
  return { t, userId, otherUser, threadId: thread._id, otherThreadId: otherThread._id, runId, auth, capture, retain };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("durable screenshot history", () => {
  it("real private upload retries retain one blob and private download survives retention expiry", async () => {
    vi.stubEnv("COMPUTER_USE_STORAGE_SECRET", "test-storage-secret");
    const f = await setup();
    const headers = {
      Authorization: "Bearer test-storage-secret", "Content-Type": "image/png",
      "X-Computer-Use-Artifact": "cu_http_capture", "X-Computer-Use-Session": String(f.userId),
      "X-Computer-Use-Thread": f.threadId, "X-Computer-Use-Session-Id": "a".repeat(32),
      "X-Computer-Use-Width": "1", "X-Computer-Use-Height": "1",
    };
    for (let retry = 0; retry < 2; retry++) {
      const response = await f.t.fetch("/computer-use/screenshots", { method: "POST", headers, body: png });
      expect(response.status).toBe(200);
    }
    const rows = await f.t.run((ctx) => ctx.db.query("computerUseScreenshots").collect());
    expect(rows).toHaveLength(1);
    expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(1);
    expect(rows[0]).toMatchObject({ threadId: f.threadId, sessionId: "a".repeat(32), width: 1, height: 1 });
    const resultJson = JSON.stringify({ ok: true, op: "screenshot", screenshotId: "cu_http_capture", screenshotUrl: "/capture", screenshotSessionId: "a".repeat(32) });
    await f.t.mutation(internal.computerUseScreenshots.retainForToolCall, { runId: f.runId, stepNumber: 1, toolCallId: "call-http", artifactId: "cu_http_capture", resultJson });
    await f.t.run((ctx) => ctx.db.patch(rows[0]._id, { expiresAt: 0 }));
    const download = await f.t.fetch("/computer-use/screenshots/cu_http_capture", { headers: { Authorization: "Bearer test-storage-secret" } });
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(png);
    expect((await f.t.fetch("/computer-use/screenshots/cu_http_capture")).status).toBe(401);
    expect((await f.t.fetch("/computer-use/screenshots", { method: "POST", headers: { ...headers, "X-Computer-Use-Session-Id": "invalid" }, body: png })).status).toBe(400);
    expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(1);
  });
  it("hydrates canonical mobile tool parts on reload and reports missing bytes without a phantom image", async () => {
    const f = await setup(), capture = await f.capture();
    const saved = await f.t.run((ctx) => saveMessages(ctx, components.agent, {
      threadId: f.threadId,
      messages: [
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-1", toolName: "computer_screenshot", input: {} }] },
        { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", toolName: "computer_screenshot", output: { type: "json", value: JSON.parse(capture.resultJson) } }] },
      ],
    }));
    await f.t.run((ctx) => ctx.db.patch(f.runId, { order: saved.messages[0].order }));
    await f.retain(capture);
    const snapshot = await f.auth.query(api.threads.getMobileChat, { threadId: f.threadId });
    const tool = snapshot.messages.flatMap((message) => message.response?.tools ?? [])[0];
    expect(tool.screenshot).toMatchObject({ id: capture.args.artifactId, availability: "available", size: png.length });
    expect(tool.screenshot?.url).not.toBe(`/api/computer-use/screenshots/${capture.args.artifactId}`);
    const part = snapshot.messages.flatMap((message) => message.response?.parts ?? []).find((part) => part.type === "tool");
    expect(part).toMatchObject({ tool });
    await f.t.run((ctx) => ctx.storage.delete(capture.args.storageId));
    const reload = await f.auth.query(api.threads.getMobileChat, { threadId: f.threadId });
    expect(reload.messages.flatMap((message) => message.response?.tools ?? [])[0].screenshot).toEqual({
      id: capture.args.artifactId, url: "", availability: "unavailable",
    });
  });
  it("retains exact bytes and ordered call/session metadata across reload, completion, session replacement and expiry", async () => {
    vi.useFakeTimers();
    const f = await setup();
    const first = await f.capture(), second = await f.capture("cu_capture_2", "b".repeat(32));
    await f.retain(first, "call-1");
    await f.retain(second, "call-2");
    await f.t.run((ctx) => ctx.db.patch(f.runId, { status: "completed" }));
    await f.t.mutation(internal.computerUseScreenshots.upsertLiveSession, {
      sessionKey: String(f.userId), sessionId: "c".repeat(32), threadId: f.otherThreadId,
      status: "stopped", updatedAt: Date.now(), expiresAt: Date.now() + 100,
    });
    vi.advanceTimersByTime(1_800_001);
    await f.t.mutation(internal.computerUseScreenshots.cleanupExpired, {});
    await f.t.mutation(internal.computerUseScreenshots.cleanupExpiredLiveSessions, {});
    for (let reload = 0; reload < 2; reload++) {
      const history = await f.auth.query(api.computerUseScreenshots.getForThread, {
        threadId: f.threadId, artifactIds: [first.args.artifactId, second.args.artifactId],
      });
      expect(history.map((item) => item.screenshot?.toolCallId)).toEqual(["call-1", "call-2"]);
      expect(history.map((item) => item.screenshot?.sessionId)).toEqual(["a".repeat(32), "b".repeat(32)]);
      expect(history[0].screenshot).toMatchObject({ order: 2, stepNumber: 1, width: 1, height: 1, size: png.length });
      expect(await f.auth.query(api.computerUseScreenshots.getArtifact, { artifactId: first.args.artifactId })).toMatchObject({ id: first.args.artifactId });
    }
    for (const capture of [first, second]) {
      const bytes = await f.t.run(async (ctx) => (await ctx.storage.get(capture.args.storageId))!.arrayBuffer());
      expect(new Uint8Array(bytes)).toEqual(png);
    }
  });

  it("deduplicates upload retries and conflicting retries cannot change bytes or attribution", async () => {
    const f = await setup(), first = await f.capture();
    const retryStorage = await f.t.run((ctx) => ctx.storage.store(new Blob([png])));
    const results = await Promise.all([0, 1].map(() => f.t.mutation(internal.computerUseScreenshots.save, {
      ...first.args, storageId: retryStorage, createdAt: Date.now() + 1,
    })));
    expect(results).toEqual([first.args.storageId, first.args.storageId]);
    for (const conflict of [{ digest: "different" }, { sessionId: "b".repeat(32) }, { threadId: f.otherThreadId }]) {
      await expect(f.t.mutation(internal.computerUseScreenshots.save, { ...first.args, ...conflict })).rejects.toThrow("Conflicting");
    }
    expect(await f.t.run((ctx) => ctx.db.query("computerUseScreenshots").collect())).toHaveLength(1);
  });

  it("binds repeated call events once and resolves racing captures to the original invocation", async () => {
    const f = await setup(), first = await f.capture(), retry = await f.capture("cu_capture_retry");
    const retained = await f.retain(first);
    expect((await f.retain(first))?._id).toBe(retained?._id);
    expect((await f.retain(retry))?.artifactId).toBe(first.args.artifactId);
    expect((await f.auth.query(api.computerUseScreenshots.getForThread, {
      threadId: f.threadId, artifactIds: [first.args.artifactId, first.args.artifactId, retry.args.artifactId],
    })).map((item) => item.screenshot?.id ?? null)).toEqual([first.args.artifactId, null]);
    await expect(f.retain(first, "different-call")).rejects.toThrow("another tool invocation");
  });

  it("rejects wrong thread/user/session association and never guesses legacy attribution", async () => {
    const f = await setup(), first = await f.capture();
    const wrongThread = await f.capture("cu_wrong_thread", "a".repeat(32), f.otherThreadId);
    await expect(f.retain(wrongThread)).rejects.toThrow("does not belong");
    await expect(f.retain({ ...first, resultJson: first.resultJson.replace("a".repeat(32), "b".repeat(32)) })).rejects.toThrow("captured identity");
    await f.retain(first);
    const stranger = f.t.withIdentity({ subject: `${f.otherUser}|session` });
    expect(await stranger.query(api.computerUseScreenshots.getArtifact, { artifactId: first.args.artifactId })).toBeNull();
    expect(await f.t.query(api.computerUseScreenshots.getArtifact, { artifactId: first.args.artifactId })).toBeNull();
    await expect(stranger.query(api.computerUseScreenshots.getForThread, { threadId: f.threadId, artifactIds: [first.args.artifactId] })).rejects.toThrow("Unauthorized");
    await expect(f.t.query(api.computerUseScreenshots.getForThread, { threadId: f.threadId, artifactIds: [] })).rejects.toThrow("Unauthorized");
    expect((await f.auth.query(api.computerUseScreenshots.getForThread, { threadId: f.otherThreadId, artifactIds: [first.args.artifactId] }))[0].screenshot).toBeNull();
    const legacy = await f.capture("cu_legacy_capture");
    await f.t.run(async (ctx) => {
      const row = await ctx.db.query("computerUseScreenshots").withIndex("byArtifactId", (q) => q.eq("artifactId", legacy.args.artifactId)).unique();
      await ctx.db.patch(row!._id, { sessionId: undefined });
    });
    await expect(f.retain(legacy)).rejects.toThrow("does not belong");
  });

  it("cleans only unattached captures, and expired/missing bytes have explicit unavailable results", async () => {
    vi.useFakeTimers();
    const f = await setup(), first = await f.capture(), temporary = await f.capture("cu_temporary_capture");
    await f.retain(first);
    vi.advanceTimersByTime(1_800_001);
    await f.t.mutation(internal.computerUseScreenshots.cleanupExpired, {});
    expect(await f.t.run((ctx) => ctx.storage.get(temporary.args.storageId))).toBeNull();
    await expect(f.retain(temporary)).rejects.toThrow("does not belong");
    await f.t.run((ctx) => ctx.storage.delete(first.args.storageId));
    expect((await f.auth.query(api.computerUseScreenshots.getForThread, { threadId: f.threadId, artifactIds: [first.args.artifactId] }))[0].screenshot).toBeNull();
  });

  it("the real SDK call retries replay original pixels without re-executing capture", async () => {
    const f = await setup(), first = await f.capture();
    const execute = vi.fn(async () => ({ content: [{ type: "text", text: first.resultJson }] }));
    const replay = async (record: NonNullable<Awaited<ReturnType<typeof f.retain>>>) => {
      const bytes = await f.t.run(async (ctx) => (await ctx.storage.get(record.storageId))!.arrayBuffer());
      return { content: [
        { type: "text" as const, text: record.resultJson! },
        { type: "image" as const, data: Buffer.from(bytes).toString("base64"), mimeType: record.contentType },
      ] };
    };
    const screenshotTool = retainedScreenshotTool(tool({ inputSchema: z.object({}), execute }), {
      replay: async (toolCallId) => {
        const record = await f.t.query(internal.computerUseScreenshots.retainedForToolCall, { runId: f.runId, stepNumber: 1, toolCallId });
        return record ? replay(record) : null;
      },
      retain: async (_artifactId, toolCallId) => replay((await f.retain(first, toolCallId))!),
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const model = new MockLanguageModelV4({ doGenerate: async () => ({
        content: [{ type: "tool-call", toolCallId: "call-sdk", toolName: "computer_screenshot", input: "{}" }],
        finishReason: { unified: "tool-calls", raw: "tool-calls" }, warnings: [],
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
      }) });
      const result = await generateText({ model, prompt: "Capture", tools: { computer_screenshot: screenshotTool } });
      expect(result.toolResults[0].output).toMatchObject({ content: [
        { text: first.resultJson }, { data: Buffer.from(png).toString("base64") },
      ] });
    }
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
