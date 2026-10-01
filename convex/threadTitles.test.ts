import { convexTest } from "convex-test";
import agentTest from "@convex-dev/agent/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { agent } from "./agents/simple";
import { api, components, internal } from "./_generated/api";

const modules = {
  "./threads.ts": () => import("./threads"),
  "./users.ts": () => import("./users"),
  "./_generated/server.ts": () => import("./_generated/server"),
};

async function setup(title: string | null = "Untitled", hasOutput = true) {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const thread = await t.run((ctx) => ctx.runMutation(components.agent.threads.createThread, { userId, ...(title === null ? {} : { title }) }));
  const runId = await t.run(async (ctx) => {
    const runId = await ctx.db.insert("agentRuns", {
      threadId: thread._id, userId, model: "test", searchEnabled: false,
      status: "running", stepCount: 1, attemptCount: 1, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("agentRunSteps", {
      runId, stepNumber: 1, model: "test", provider: "test", order: 1,
      stepOrder: 0, hasOutput, hasToolCalls: false, toolCallIds: [], usage: {}, createdAt: 1,
    });
    return runId;
  });
  const complete = () => t.mutation(internal.threads.agentRunWorkflowCompleted, {
    workflowId: "test-workflow", context: { runId }, result: { kind: "success", returnValue: null },
  });
  const job = () => t.run((ctx) => ctx.db.query("threadTitleJobs").unique());
  const metadata = () => t.run((ctx) => ctx.runQuery(components.agent.threads.getThread, { threadId: thread._id }));
  const auth = t.withIdentity({ subject: `${userId}|session` });
  return { t, userId, threadId: thread._id, runId, complete, job, metadata, auth };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("canonical thread titles", () => {
  it.each(["Untitled", "New chat", "Chat with Vlad", "", null])("schedules default %s only after completion and claims simultaneous/resumed triggers once", async (title) => {
    const f = await setup(title);
    await f.t.mutation(internal.threads.scheduleThreadTitleForUser, { threadId: f.threadId, userId: f.userId });
    expect(await f.job()).toBeNull();
    await Promise.all([f.complete(), f.complete()]);
    await f.auth.action(api.threads.updateThreadTitle, { threadId: f.threadId });
    const job = await f.job();
    expect(job?.status).toBe("pending");
    const claims = await Promise.all([
      f.t.mutation(internal.threads.claimThreadTitle, { jobId: job!._id }),
      f.t.mutation(internal.threads.claimThreadTitle, { jobId: job!._id }),
    ]);
    expect(claims.filter(Boolean)).toEqual([f.threadId]);
    await f.t.mutation(internal.threads.finishThreadTitle, { jobId: job!._id, result: { title: "Planning a trip", summary: "Travel plans" } });
    await f.complete();
    expect(await f.metadata()).toMatchObject({ title: "Planning a trip", summary: "Travel plans" });
    expect((await f.job())?._id).toBe(job!._id);
  });

  it("does not schedule empty output or replace an existing manual title", async () => {
    for (const [title, output] of [["Untitled", false], ["My title", true]] as const) {
      const f = await setup(title, output);
      await f.complete();
      expect(await f.job()).toBeNull();
      expect((await f.metadata())?.title).toBe(title);
    }
  });

  it("preserves a manual rename during generation, including a return to the default", async () => {
    const f = await setup();
    await f.complete();
    const job = await f.job();
    await f.t.mutation(internal.threads.claimThreadTitle, { jobId: job!._id });
    await f.auth.mutation(api.threads.renameMobileThread, { threadId: f.threadId, title: "My title" });
    await f.auth.mutation(api.threads.renameMobileThread, { threadId: f.threadId, title: "Untitled" });
    await f.t.mutation(internal.threads.finishThreadTitle, { jobId: job!._id, result: { title: "Generated title", summary: "Generated summary" } });
    await f.complete();
    expect((await f.metadata())?.title).toBe("Untitled");
    expect((await f.job())?.status).toBe("canceled");
  });

  it("serializes a simultaneous manual rename and generated metadata write", async () => {
    const f = await setup();
    await f.complete();
    const job = await f.job();
    await f.t.mutation(internal.threads.claimThreadTitle, { jobId: job!._id });
    await Promise.all([
      f.t.mutation(internal.threads.finishThreadTitle, { jobId: job!._id, result: { title: "Generated", summary: "Summary" } }),
      f.auth.mutation(api.threads.renameMobileThread, { threadId: f.threadId, title: "Manual wins" }),
    ]);
    expect((await f.metadata())?.title).toBe("Manual wins");
    expect((await f.job())?.status).toBe("canceled");
  });

  it("rechecks canonical ownership before generation and persistence", async () => {
    for (const phase of ["before generation", "before persistence"]) {
      const f = await setup();
      await f.complete();
      const job = await f.job();
      if (phase === "before persistence") await f.t.mutation(internal.threads.claimThreadTitle, { jobId: job!._id });
      await f.t.run((ctx) => ctx.runMutation(components.agent.threads.updateThread, { threadId: f.threadId, patch: { userId: "different-owner" } }));
      if (phase === "before generation") expect(await f.t.mutation(internal.threads.claimThreadTitle, { jobId: job!._id })).toBeNull();
      else await f.t.mutation(internal.threads.finishThreadTitle, { jobId: job!._id, result: { title: "Generated", summary: "Summary" } });
      expect((await f.metadata())?.title).toBe("Untitled");
      expect((await f.job())?.status).toBe("canceled");
    }
  });

  it("keeps fallback after failure and does not regenerate on replay", async () => {
    const f = await setup();
    await f.complete();
    const job = await f.job();
    await f.t.mutation(internal.threads.claimThreadTitle, { jobId: job!._id });
    await f.t.mutation(internal.threads.finishThreadTitle, { jobId: job!._id });
    await f.complete();
    expect(await f.t.mutation(internal.threads.claimThreadTitle, { jobId: job!._id })).toBeNull();
    expect((await f.metadata())?.title).toBe("Untitled");
    expect((await f.job())?.status).toBe("failed");
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({ status: "completed" });
  });

  it("catches model failures outside the completed conversation", async () => {
    const f = await setup();
    await f.complete();
    const job = await f.job();
    const generate = vi.spyOn(agent, "continueThread").mockRejectedValue(new Error("Provider unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await f.t.action(internal.threads.generateThreadTitle, { jobId: job!._id });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Could not generate thread title", expect.any(Error));
    expect((await f.job())?.status).toBe("failed");
    expect((await f.metadata())?.title).toBe("Untitled");
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({ status: "completed" });
  });

  it("checks title changes before generation and before atomic persistence", async () => {
    for (const phase of ["before generation", "before persistence"]) {
      const f = await setup();
      await f.complete();
      const job = await f.job();
      if (phase === "before persistence") await f.t.mutation(internal.threads.claimThreadTitle, { jobId: job!._id });
      await f.t.run((ctx) => ctx.runMutation(components.agent.threads.updateThread, { threadId: f.threadId, patch: { title: "Manual title" } }));
      if (phase === "before generation") expect(await f.t.mutation(internal.threads.claimThreadTitle, { jobId: job!._id })).toBeNull();
      else await f.t.mutation(internal.threads.finishThreadTitle, { jobId: job!._id, result: { title: "Generated", summary: "Summary" } });
      expect((await f.metadata())?.title).toBe("Manual title");
      expect((await f.job())?.status).toBe("canceled");
    }
  });

  it("rejects title requests from a different user", async () => {
    const f = await setup();
    await f.complete();
    const otherUser = await f.t.run((ctx) => ctx.db.insert("users", {}));
    await expect(f.t.withIdentity({ subject: `${otherUser}|session` }).action(api.threads.updateThreadTitle, { threadId: f.threadId })).rejects.toThrow("user does not match");
  });
});
