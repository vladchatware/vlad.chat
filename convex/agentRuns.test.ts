import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = {
  "./threads.ts": () => import("./threads"),
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
});
