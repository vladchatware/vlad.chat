import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = {
  "./threads.ts": () => import("./threads"),
  "./users.ts": () => import("./users"),
  "./_generated/server.ts": () => import("./_generated/server"),
};

describe("agent run model-step retries", () => {
  it("advances attempts once and refuses retries after tool execution starts", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { isAnonymous: true }),
    );
    const runId = await t.run((ctx) =>
      ctx.db.insert("agentRuns", {
        threadId: "thread-retry",
        userId,
        model: "test-model",
        searchEnabled: false,
        status: "running",
        stepCount: 0,
        attemptCount: 1,
        inFlightStep: 1,
        inFlightAttempt: 1,
        inFlightPhase: "model",
        createdAt: now,
        updatedAt: now,
      }),
    );

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.threads.advanceAgentRunStepAttempt, {
          runId,
          stepNumber: 1,
          expectedAttempt: 1,
        }),
      ),
    ).resolves.toBe(2);

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.threads.advanceAgentRunStepAttempt, {
          runId,
          stepNumber: 1,
          expectedAttempt: 1,
        }),
      ),
    ).resolves.toBe(2);

    await t.run((ctx) =>
      ctx.db.patch(runId, { inFlightPhase: "tool" }),
    );
    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.threads.advanceAgentRunStepAttempt, {
          runId,
          stepNumber: 1,
          expectedAttempt: 2,
        }),
      ),
    ).resolves.toBeNull();

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ attemptCount: 2, inFlightAttempt: 2 });
  });

  it("caps model-phase retries at three attempts", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { isAnonymous: true }),
    );
    const runId = await t.run((ctx) =>
      ctx.db.insert("agentRuns", {
        threadId: "thread-retry-cap",
        userId,
        model: "test-model",
        searchEnabled: false,
        status: "running",
        stepCount: 0,
        attemptCount: 3,
        inFlightStep: 1,
        inFlightAttempt: 3,
        inFlightPhase: "model",
        createdAt: now,
        updatedAt: now,
      }),
    );

    await expect(
      t.run((ctx) =>
        ctx.runMutation(internal.threads.advanceAgentRunStepAttempt, {
          runId,
          stepNumber: 1,
          expectedAttempt: 3,
        }),
      ),
    ).resolves.toBeNull();
  });

  it("persists continuation intent only after visible interrupted output", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { isAnonymous: true, trialMessages: 1 }),
    );
    const runId = await t.run((ctx) =>
      ctx.db.insert("agentRuns", {
        threadId: "thread-resume-partial",
        userId,
        model: "test-model",
        searchEnabled: false,
        status: "paused",
        stepCount: 0,
        attemptCount: 1,
        inFlightStep: 1,
        inFlightAttempt: 1,
        inFlightPhase: "model",
        createdAt: now,
        updatedAt: now,
      }),
    );

    await t.run((ctx) =>
      ctx.runMutation(internal.users.settleAgentRunStep, {
        runId,
        stepNumber: 1,
        model: "test-model",
        provider: "AI Gateway",
        order: 1,
        stepOrder: 1,
        hasOutput: true,
        hasToolCalls: false,
        wasInterrupted: true,
        toolCallIds: [],
        steeringIds: [],
        usage: {},
      }),
    );

    await expect(
      t.run((ctx) => ctx.db.get(runId)),
    ).resolves.toMatchObject({ stepCount: 1, continueAfterStop: true });

    await t.run((ctx) =>
      ctx.runMutation(internal.users.settleAgentRunStep, {
        runId,
        stepNumber: 2,
        model: "test-model",
        provider: "AI Gateway",
        order: 1,
        stepOrder: 2,
        hasOutput: true,
        hasToolCalls: false,
        toolCallIds: [],
        steeringIds: [],
        usage: {},
      }),
    );

    await expect(
      t.run((ctx) => ctx.db.get(runId)),
    ).resolves.toMatchObject({ stepCount: 2, continueAfterStop: false });
  });
});
