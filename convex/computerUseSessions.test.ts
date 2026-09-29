import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { getActiveLiveSessionForThread } from "./computerUseScreenshots";

const modules = {
  "./computerUseScreenshots.ts": () => import("./computerUseScreenshots"),
  "./_generated/server.ts": () => import("./_generated/server"),
};

describe("live computer-use sessions", () => {
  it("keeps only latest live stream and ignores stale end events", async () => {
    const t = convexTest(schema, modules);
    const base = {
      sessionKey: "user_session",
      viewerUrl: "https://sb-example.vercel.run/vnc.html",
      nativeViewerUrl: "https://sb-example.vercel.run/vladchat.html",
      updatedAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000,
    };
    await t.run((ctx) => ctx.runMutation(internal.computerUseScreenshots.upsertLiveSession, {
      ...base,
      sessionId: "1".repeat(32),
    }));
    await t.run((ctx) => ctx.runMutation(internal.computerUseScreenshots.upsertLiveSession, {
      ...base,
      sessionId: "2".repeat(32),
      nativeViewerUrl: "https://sb-example.vercel.run/vladchat.html",
    }));
    await t.run((ctx) => ctx.runMutation(internal.computerUseScreenshots.cleanupSessionByKey, {
      sessionKey: base.sessionKey,
      sessionId: "1".repeat(32),
    }));

    const sessions = await t.run((ctx) => ctx.db.query("computerUseSessions").collect());
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("2".repeat(32));
    expect(sessions[0].nativeViewerUrl).toBe("https://sb-example.vercel.run/vladchat.html");
  });

  it("projects only unexpired sessions to their owning thread", () => {
    const session = {
      sessionId: "1".repeat(32),
      sessionKey: "user_session",
      threadId: "thread-a",
      viewerUrl: "https://sb-example.vercel.run/vnc.html",
      nativeViewerUrl: "https://sb-example.vercel.run/vladchat.html",
      updatedAt: 1_000,
      expiresAt: 2_000,
    };

    expect(getActiveLiveSessionForThread(session, "thread-a", 1_999)).toEqual({
      sessionId: session.sessionId,
      viewerUrl: session.viewerUrl,
      nativeViewerUrl: session.nativeViewerUrl,
    });
    expect(getActiveLiveSessionForThread(session, "thread-b", 1_999)).toBeNull();
    expect(getActiveLiveSessionForThread(session, "thread-a", 2_000)).toBeNull();
    expect(getActiveLiveSessionForThread({ ...session, threadId: undefined }, "thread-a", 1_999)).toBeNull();
    expect(getActiveLiveSessionForThread({ ...session, status: "stopped" }, "thread-a", 1_999)).toBeNull();
    expect(getActiveLiveSessionForThread({ ...session, status: "failed" }, "thread-a", 1_999)).toBeNull();
  });

  it("stores lifecycle metadata and reserves steps atomically up to the cap", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const session = {
      sessionKey: "user_lifecycle",
      sessionId: "3".repeat(32),
      provider: "vercel" as const,
      status: "running" as const,
      sandboxName: "vlad-cu-user_lifecycle",
      viewerToken: "a".repeat(64),
      threadId: "thread-lifecycle",
      viewerUrl: "https://sb-example.vercel.run/vnc.html?path=websockify",
      nativeViewerUrl: "https://sb-example.vercel.run/vladchat.html?token=secret",
      createdAt: now,
      lastUsedAt: now,
      stepCount: 0,
      updatedAt: now,
      expiresAt: now + 30 * 60 * 1000,
    };
    await t.run((ctx) => ctx.runMutation(internal.computerUseScreenshots.upsertLiveSession, session));

    for (let step = 1; step <= 20; step += 1) {
      const activity = await t.run((ctx) => ctx.runMutation(
        internal.computerUseScreenshots.recordSessionActivity,
        {
          sessionKey: session.sessionKey,
          sessionId: session.sessionId,
          now: now + step,
          expiresAt: session.expiresAt,
        },
      ));
      expect(activity.stepCount).toBe(step);
    }
    await expect(t.run((ctx) => ctx.runMutation(
      internal.computerUseScreenshots.recordSessionActivity,
      {
        sessionKey: session.sessionKey,
        sessionId: session.sessionId,
        now: now + 21,
        expiresAt: session.expiresAt,
      },
    ))).rejects.toThrow("step limit");

    await t.run((ctx) => ctx.runMutation(
      internal.computerUseScreenshots.upsertLiveSession,
      session,
    ));

    const stored = await t.run((ctx) => ctx.db.query("computerUseSessions").collect());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      provider: "vercel",
      status: "running",
      sandboxName: session.sandboxName,
      viewerToken: session.viewerToken,
      stepCount: 20,
      lastUsedAt: now + 20,
    });
  });

  it("rejects activity for stale session identities and expired sessions", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const session = {
      sessionKey: "user_stale",
      sessionId: "4".repeat(32),
      status: "running" as const,
      createdAt: now - 31 * 60 * 1000,
      stepCount: 0,
      updatedAt: now,
      expiresAt: now - 60_000,
    };
    await t.run((ctx) => ctx.runMutation(internal.computerUseScreenshots.upsertLiveSession, session));

    await expect(t.run((ctx) => ctx.runMutation(
      internal.computerUseScreenshots.recordSessionActivity,
      {
        sessionKey: session.sessionKey,
        sessionId: "5".repeat(32),
        now,
        expiresAt: now + 30 * 60 * 1000,
      },
    ))).rejects.toThrow("not active");
    await expect(t.run((ctx) => ctx.runMutation(
      internal.computerUseScreenshots.recordSessionActivity,
      {
        sessionKey: session.sessionKey,
        sessionId: session.sessionId,
        now,
        expiresAt: session.expiresAt,
      },
    ))).rejects.toThrow("expired");
  });
});
