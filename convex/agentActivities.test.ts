import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { agentActivityPayload, agentActivityState } from "./lib/agentActivityState";

const modules = {
  "./agentActivities.ts": () => import("./agentActivities"),
  "./agentActivityPush.ts": () => import("./agentActivityPush"),
  "./threads.ts": () => import("./threads"),
  "./users.ts": () => import("./users"),
  "./_generated/server.ts": () => import("./_generated/server"),
};

async function fixture() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }));
  const runId = await t.run((ctx) => ctx.db.insert("agentRuns", {
    userId, threadId: "activity-thread", model: "test", searchEnabled: false,
    status: "running", stepCount: 0, attemptCount: 0, createdAt: Date.now(), updatedAt: Date.now(),
  }));
  const own = t.withIdentity({ subject: userId });
  const register = () => own.mutation(api.agentActivities.register, {
    runId, activityId: "activity-1", pushToken: "ab".repeat(32), environment: "sandbox",
  });
  return { t, own, runId, userId, register };
}

describe("agent Live Activity delivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("APNS_KEY_ID", "test-key");
    vi.stubEnv("APNS_TEAM_ID", "test-team");
    vi.stubEnv("APNS_PRIVATE_KEY", "test-private-key");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("requires authentication and run ownership before accepting a push token", async () => {
    const { t, runId } = await fixture();
    const other = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }));
    const args = { runId, activityId: "activity-1", pushToken: "ab".repeat(32), environment: "sandbox" as const };
    await expect(t.mutation(api.agentActivities.register, args)).rejects.toThrow("Agent run not found");
    await expect(t.withIdentity({ subject: other }).mutation(api.agentActivities.register, args)).rejects.toThrow("Agent run not found");
    expect(await t.run((ctx) => ctx.db.query("agentActivities").collect())).toEqual([]);
  });

  it("disables push registration until server credentials exist", async () => {
    const { own, register, t } = await fixture();
    vi.stubEnv("APNS_PRIVATE_KEY", "");
    expect(await own.query(api.agentActivities.pushAvailable)).toBe(false);
    expect(await register()).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("agentActivities").collect())).toEqual([]);
  });

  it("rotates tokens in place and rejects malformed registrations", async () => {
    const { own, t, register, runId } = await fixture();
    await register();
    await own.mutation(api.agentActivities.register, {
      runId, activityId: "activity-1", pushToken: "cd".repeat(32), environment: "production",
    });
    const rows = await t.run((ctx) => ctx.db.query("agentActivities").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pushToken: "cd".repeat(32), environment: "production", revision: 2 });
    await expect(own.mutation(api.agentActivities.register, {
      runId, activityId: "bad/path", pushToken: "not-a-token", environment: "sandbox",
    })).rejects.toThrow("Invalid Live Activity registration");
  });

  it("maps real workflow mutations and supersedes outdated scheduled deliveries", async () => {
    const { t, register, runId } = await fixture();
    await register();
    const row = (await t.run((ctx) => ctx.db.query("agentActivities").collect()))[0];
    const first = await t.mutation(internal.agentActivities.prepareDelivery, { registrationId: row._id, revision: 1 });
    expect(first?.state.phase).toBe("starting");
    await t.mutation(internal.threads.claimAgentRunStep, { runId, stepNumber: 1 });
    expect(await t.mutation(internal.agentActivities.prepareDelivery, { registrationId: row._id, revision: 1 })).toBeNull();
    const model = await t.mutation(internal.agentActivities.prepareDelivery, { registrationId: row._id, revision: 2 });
    expect(model?.state.phase).toBe("running");
    expect(model!.timestamp).toBeGreaterThan(first!.timestamp);
    await t.mutation(internal.threads.setAgentRunStepPhase, { runId, stepNumber: 1, phase: "tool" });
    const tool = await t.mutation(internal.agentActivities.prepareDelivery, { registrationId: row._id, revision: 3 });
    expect(tool?.state.phase).toBe("executing");
    await t.mutation(internal.threads.setAgentRunStatus, { runId, status: "failed", error: "private error" });
    const terminal = await t.mutation(internal.agentActivities.prepareDelivery, { registrationId: row._id, revision: 4 });
    expect(terminal?.state.phase).toBe("failed");
    const payload = agentActivityPayload(terminal!.state, terminal!.timestamp);
    expect(payload.aps.event).toBe("end");
    expect(payload.aps).toHaveProperty("dismissal-date", 0);
    expect(JSON.stringify(payload)).not.toContain("private error");
    expect(Object.keys(payload.aps["content-state"]).sort()).toEqual(["phase", "stepCount", "updatedAt"]);
  });

  it("does not erase rotated registrations on an old delivery result and honors logout cleanup", async () => {
    const { t, own, register } = await fixture();
    await register();
    const row = (await t.run((ctx) => ctx.db.query("agentActivities").collect()))[0];
    await register();
    await t.mutation(internal.agentActivities.finishDelivery, { registrationId: row._id, revision: 1, remove: true });
    expect(await t.run((ctx) => ctx.db.get(row._id))).not.toBeNull();
    await own.mutation(api.agentActivities.unregister, { activityId: "activity-1" });
    expect(await t.mutation(internal.agentActivities.prepareDelivery, { registrationId: row._id, revision: 2 })).toBeNull();
  });

  it("cannot unregister another user's activity", async () => {
    const { t, register } = await fixture();
    await register();
    const other = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }));
    await t.withIdentity({ subject: other }).mutation(api.agentActivities.unregister, { activityId: "activity-1" });
    expect(await t.run((ctx) => ctx.db.query("agentActivities").collect())).toHaveLength(1);
  });

  it("refuses deliveries for deleted runs", async () => {
    const { t, register, runId } = await fixture();
    await register();
    const row = (await t.run((ctx) => ctx.db.query("agentActivities").collect()))[0];
    await t.run((ctx) => ctx.db.delete(runId));
    expect(await t.mutation(internal.agentActivities.prepareDelivery, { registrationId: row._id, revision: 1 })).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(row._id))).toBeNull();
  });

  it("expires old tokens without removing fresh registrations", async () => {
    const { t, register } = await fixture();
    await register();
    const row = (await t.run((ctx) => ctx.db.query("agentActivities").collect()))[0];
    await t.mutation(internal.agentActivities.expire, { registrationId: row._id });
    expect(await t.run((ctx) => ctx.db.get(row._id))).not.toBeNull();
    await t.run((ctx) => ctx.db.patch(row._id, { expiresAt: Date.now() - 1 }));
    expect(await t.mutation(internal.agentActivities.prepareDelivery, { registrationId: row._id, revision: 1 })).toBeNull();
    await t.mutation(internal.agentActivities.expire, { registrationId: row._id });
    expect(await t.run((ctx) => ctx.db.get(row._id))).toBeNull();
  });

  it("keeps stopping distinct from paused, resumes same run, and treats completion as terminal", () => {
    const run = { status: "stopRequested" as const, inFlightPhase: "tool" as const, stepCount: 2, updatedAt: 1000 };
    expect(agentActivityState(run)?.phase).toBe("stopping");
    expect(agentActivityState({ ...run, status: "paused" })?.phase).toBe("paused");
    expect(agentActivityState({ ...run, status: "running", inFlightPhase: "model" })?.phase).toBe("running");
    const complete = agentActivityState({ ...run, status: "completed" })!;
    expect(agentActivityPayload(complete, 3).aps.event).toBe("end");
    expect(agentActivityState({ ...run, status: "queued" })).toBeNull();
  });
});
