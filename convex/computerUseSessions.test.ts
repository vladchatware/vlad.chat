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
  });
});
