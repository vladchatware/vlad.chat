import { convexTest } from "convex-test";
import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const apns = vi.hoisted(() => ({
  status: 200,
  reason: "",
  requests: [] as { host: string; headers: Record<string, string>; body: string }[],
}));

vi.mock("node:http2", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    connect(host: string) {
      return Object.assign(new EventEmitter(), {
        setTimeout() {}, close() {},
        request(headers: Record<string, string>) {
          const request = new EventEmitter();
          return Object.assign(request, {
            setEncoding() {},
            end(body: string) {
              apns.requests.push({ host, headers, body });
              queueMicrotask(() => {
                request.emit("response", { ":status": apns.status });
                if (apns.reason) request.emit("data", JSON.stringify({ reason: apns.reason }));
                request.emit("end");
              });
            },
          });
        },
      });
    },
  };
});

const modules = {
  "./agentActivities.ts": () => import("./agentActivities"),
  "./agentActivityPush.ts": () => import("./agentActivityPush"),
  "./_generated/server.ts": () => import("./_generated/server"),
};

async function fixture() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { isAnonymous: true }));
  const runId = await t.run((ctx) => ctx.db.insert("agentRuns", {
    userId, threadId: "private-thread", model: "test", searchEnabled: false,
    status: "running", stepCount: 0, attemptCount: 0, createdAt: Date.now(), updatedAt: Date.now(),
  }));
  await t.withIdentity({ subject: userId }).mutation(api.agentActivities.register, {
    runId, activityId: "activity-1", pushToken: "ab".repeat(32), environment: "sandbox",
  });
  const registration = (await t.run((ctx) => ctx.db.query("agentActivities").collect()))[0];
  return { t, runId, registration, args: { registrationId: registration._id, revision: 1, attempt: 0 } };
}

describe("APNs Live Activity transport", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    apns.status = 200;
    apns.reason = "";
    apns.requests = [];
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    vi.stubEnv("APNS_PRIVATE_KEY", await exportPKCS8(privateKey));
    vi.stubEnv("APNS_KEY_ID", "test-key");
    vi.stubEnv("APNS_TEAM_ID", "test-team");
    vi.stubEnv("APNS_BUNDLE_ID", "chat.vlad.ios");
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("uses HTTP/2 sandbox, correct topic, signed bearer and private update payload", async () => {
    const { t, args, registration } = await fixture();
    await t.action(internal.agentActivityPush.send, args);
    expect(apns.requests).toHaveLength(1);
    expect(apns.requests[0]).toMatchObject({
      host: "https://api.sandbox.push.apple.com",
      headers: {
        ":method": "POST", "apns-push-type": "liveactivity", "apns-priority": "5",
        "apns-topic": "chat.vlad.ios.push-type.liveactivity", "apns-expiration": "0",
      },
    });
    expect(apns.requests[0].headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(apns.requests[0].body).toContain('"event":"update"');
    expect(apns.requests[0].body).not.toContain("private-thread");
    expect(await t.run((ctx) => ctx.db.get(registration._id))).not.toBeNull();
  });

  it("sends terminal end with immediate dismissal then removes registration", async () => {
    const { t, args, runId, registration } = await fixture();
    await t.run((ctx) => ctx.db.patch(runId, { status: "completed" }));
    await t.action(internal.agentActivityPush.send, args);
    expect(apns.requests[0].headers["apns-priority"]).toBe("10");
    expect(apns.requests[0].body).toContain('"event":"end"');
    expect(apns.requests[0].body).toContain('"dismissal-date":0');
    expect(await t.run((ctx) => ctx.db.get(registration._id))).toBeNull();
  });

  it("removes expired APNs tokens and does not send superseded revisions", async () => {
    const { t, args, registration } = await fixture();
    await t.action(internal.agentActivityPush.send, { ...args, revision: 0 });
    expect(apns.requests).toHaveLength(0);
    apns.status = 410;
    await t.action(internal.agentActivityPush.send, args);
    expect(await t.run((ctx) => ctx.db.get(registration._id))).toBeNull();
  });

  it("removes BadDeviceToken without discarding tokens for configuration errors", async () => {
    const { t, args, registration } = await fixture();
    apns.status = 400;
    apns.reason = "DeviceTokenNotForTopic";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await t.action(internal.agentActivityPush.send, args);
      expect(log).toHaveBeenCalledWith("Live Activity APNs delivery stopped after HTTP status 400.");
      expect(await t.run((ctx) => ctx.db.get(registration._id))).not.toBeNull();
      apns.reason = "BadDeviceToken";
      await t.action(internal.agentActivityPush.send, args);
      expect(await t.run((ctx) => ctx.db.get(registration._id))).toBeNull();
    } finally {
      log.mockRestore();
    }
  });

  it("retries transient APNs failures at most three times", async () => {
    const { t, registration } = await fixture();
    apns.status = 503;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const elapsed of [1000, 1000, 2000, 4000]) {
        await vi.advanceTimersByTimeAsync(elapsed);
        await t.finishInProgressScheduledFunctions();
      }
      expect(apns.requests).toHaveLength(4);
      expect(log).toHaveBeenCalledWith("Live Activity APNs delivery stopped after HTTP status 503.");
      await vi.advanceTimersByTimeAsync(30_000);
      await t.finishInProgressScheduledFunctions();
      expect(apns.requests).toHaveLength(4);
      expect(await t.run((ctx) => ctx.db.get(registration._id))).not.toBeNull();
    } finally {
      log.mockRestore();
    }
  });
});
