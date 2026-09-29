import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  httpAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";

const MAX_SCREENSHOT_BYTES = 1024 * 1024;
const SCREENSHOT_TTL_MS = 30 * 60 * 1000;
const COMPUTER_USE_SESSION_TTL_MS = 30 * 60 * 1000;
const ARTIFACT_ID = /^cu_[a-z0-9_]{8,80}$/i;
const CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);
const LIVE_SESSION_ID = /^[a-f0-9]{32}$/;
const VIEWER_TOKEN = /^[a-f0-9]{64}$/;
const COMPUTER_USE_MAX_STEPS = 20;

export function getActiveLiveSessionForThread(
  session: {
    sessionId: string;
    threadId?: string;
    status?: "starting" | "running" | "stopped" | "expired" | "failed";
    viewerUrl?: string;
    nativeViewerUrl?: string;
    expiresAt: number;
  } | null | undefined,
  threadId: string,
  now = Date.now(),
) {
  if (
    !session ||
    (session.status !== undefined && session.status !== "running") ||
    session.threadId !== threadId ||
    session.expiresAt <= now
  ) {
    return null;
  }
  return {
    sessionId: session.sessionId,
    ...(session.viewerUrl === undefined ? {} : { viewerUrl: session.viewerUrl }),
    ...(session.nativeViewerUrl === undefined ? {} : { nativeViewerUrl: session.nativeViewerUrl }),
  };
}

function matchesImageContentType(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    contentType === "image/png" &&
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.COMPUTER_USE_STORAGE_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;

  const supplied = authorization.slice("Bearer ".length);
  if (supplied.length !== secret.length) return false;

  let mismatch = 0;
  for (let i = 0; i < secret.length; i += 1) {
    mismatch |= secret.charCodeAt(i) ^ supplied.charCodeAt(i);
  }
  return mismatch === 0;
}

export const save = internalMutation({
  args: {
    artifactId: v.string(),
    storageId: v.id("_storage"),
    sessionKey: v.string(),
    contentType: v.union(v.literal("image/jpeg"), v.literal("image/png")),
    size: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("computerUseScreenshots", args);
    return null;
  },
});

export const upsertLiveSession = internalMutation({
  args: {
    sessionKey: v.string(),
    sessionId: v.string(),
    provider: v.optional(v.literal("vercel")),
    status: v.optional(v.union(
      v.literal("starting"),
      v.literal("running"),
      v.literal("stopped"),
      v.literal("expired"),
      v.literal("failed"),
    )),
    sandboxName: v.optional(v.string()),
    viewerToken: v.optional(v.string()),
    threadId: v.optional(v.string()),
    viewerUrl: v.optional(v.string()),
    nativeViewerUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    stepCount: v.optional(v.number()),
    updatedAt: v.number(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("computerUseSessions")
      .withIndex("bySessionKey", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    if (existing?.sessionId === args.sessionId) {
      const lastUsedAt = Math.max(existing.lastUsedAt ?? 0, args.lastUsedAt ?? 0);
      await ctx.db.patch(existing._id, {
        ...args,
        ...(existing.status === "running" && args.status === "starting"
          ? { status: "running" as const }
          : {}),
        updatedAt: Math.max(existing.updatedAt, args.updatedAt),
        ...(lastUsedAt > 0 ? { lastUsedAt } : {}),
        stepCount: Math.max(existing.stepCount ?? 0, args.stepCount ?? 0),
      });
    } else {
      if (existing) await ctx.db.delete(existing._id);
      await ctx.db.insert("computerUseSessions", args);
    }
    return null;
  },
});

export const liveSessionByKey = internalQuery({
  args: { sessionKey: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("computerUseSessions"),
      _creationTime: v.number(),
      sessionKey: v.string(),
      sessionId: v.string(),
      provider: v.optional(v.literal("vercel")),
      status: v.optional(v.union(
        v.literal("starting"),
        v.literal("running"),
        v.literal("stopped"),
        v.literal("expired"),
        v.literal("failed"),
      )),
      sandboxName: v.optional(v.string()),
      viewerToken: v.optional(v.string()),
      threadId: v.optional(v.string()),
      viewerUrl: v.optional(v.string()),
      nativeViewerUrl: v.optional(v.string()),
      videoUrl: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      lastUsedAt: v.optional(v.number()),
      stepCount: v.optional(v.number()),
      updatedAt: v.number(),
      expiresAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { sessionKey }) =>
    ctx.db
      .query("computerUseSessions")
      .withIndex("bySessionKey", (q) => q.eq("sessionKey", sessionKey))
      .unique(),
});

export const sessionsForCleanup = internalQuery({
  args: {},
  returns: v.array(v.object({
    _id: v.id("computerUseSessions"),
    _creationTime: v.number(),
    sessionKey: v.string(),
    sessionId: v.string(),
    provider: v.optional(v.literal("vercel")),
    status: v.optional(v.union(
      v.literal("starting"),
      v.literal("running"),
      v.literal("stopped"),
      v.literal("expired"),
      v.literal("failed"),
    )),
    sandboxName: v.optional(v.string()),
    viewerToken: v.optional(v.string()),
    threadId: v.optional(v.string()),
    viewerUrl: v.optional(v.string()),
    nativeViewerUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    stepCount: v.optional(v.number()),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })),
  handler: async (ctx) => ctx.db.query("computerUseSessions").take(500),
});

export const recordSessionActivity = internalMutation({
  args: {
    sessionKey: v.string(),
    sessionId: v.string(),
    now: v.number(),
    expiresAt: v.number(),
  },
  returns: v.object({ stepCount: v.number(), lastUsedAt: v.number() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("computerUseSessions")
      .withIndex("bySessionKey", (q) => q.eq("sessionKey", args.sessionKey))
      .unique();
    if (!existing || existing.sessionId !== args.sessionId || existing.status !== "running") {
      throw new Error("Computer-use session is not active.");
    }
    const absoluteExpiry = (existing.createdAt ?? args.now) + COMPUTER_USE_SESSION_TTL_MS;
    if (absoluteExpiry <= args.now || args.expiresAt <= args.now) {
      throw new Error("Computer-use session expired.");
    }
    const stepCount = existing.stepCount ?? 0;
    if (stepCount >= COMPUTER_USE_MAX_STEPS) {
      throw new Error(`Computer-use step limit (${COMPUTER_USE_MAX_STEPS}) reached for this session.`);
    }
    await ctx.db.patch(existing._id, {
      lastUsedAt: args.now,
      stepCount: stepCount + 1,
      updatedAt: args.now,
    });
    return { stepCount: stepCount + 1, lastUsedAt: args.now };
  },
});

export const cleanupExpiredLiveSessions = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("computerUseSessions")
      .withIndex("byExpiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(100);
    for (const session of expired) await ctx.db.delete(session._id);
    if (expired.length === 100) {
      await ctx.scheduler.runAfter(
        0,
        internal.computerUseScreenshots.cleanupExpiredLiveSessions,
        {},
      );
    }
    return null;
  },
});

export const publish = httpAction(async (ctx, request) => {
  if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);

  if (request.method === "GET") {
    const sessionKey = new URL(request.url).searchParams.get("sessionKey");
    if (sessionKey) {
      const session = await ctx.runQuery(internal.computerUseScreenshots.liveSessionByKey, {
        sessionKey,
      });
      return json({ session });
    }
    if (new URL(request.url).searchParams.get("cleanup") === "1") {
      const sessions = await ctx.runQuery(
        internal.computerUseScreenshots.sessionsForCleanup,
        {},
      );
      return json({ sessions });
    }
    return json({ error: "A sessionKey or cleanup=1 is required" }, 400);
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json({ error: "Invalid live session payload" }, 400);
  }
  const payload = body as Record<string, unknown>;
  const { sessionKey, sessionId, status, viewerUrl, nativeViewerUrl } = payload;
  if (
    typeof sessionKey !== "string" ||
    !sessionKey.trim() ||
    sessionKey.length > 128 ||
    typeof sessionId !== "string" ||
    !LIVE_SESSION_ID.test(sessionId) ||
    (payload.threadId !== undefined &&
      (typeof payload.threadId !== "string" || payload.threadId.length > 128)) ||
    (status !== "active" && status !== "ended" && status !== "starting" && status !== "running" && status !== "stopped" && status !== "expired" && status !== "failed")
  ) {
    return json({ error: "Invalid live session metadata" }, 400);
  }

  if (payload.event === "activity") {
    if (typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt)) {
      return json({ error: "Invalid activity metadata" }, 400);
    }
    try {
      const activity = await ctx.runMutation(
        internal.computerUseScreenshots.recordSessionActivity,
        { sessionKey, sessionId, now: Date.now(), expiresAt: payload.expiresAt },
      );
      return json({ ok: true, ...activity });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Session activity failed" }, 409);
    }
  }

  if (status === "stopped" || status === "expired" || status === "failed" || status === "running") {
    await ctx.runMutation(internal.computerUseScreenshots.updateSessionStatus, {
      sessionKey,
      sessionId,
      status,
      now: Date.now(),
    });
    return json({ ok: true });
  }

  if (status === "ended") {
    const existing = await ctx.runQuery(internal.computerUseScreenshots.liveSessionByKey, {
      sessionKey,
    });
    if (existing?.sessionId === sessionId) {
      await ctx.runMutation(internal.computerUseScreenshots.cleanupSessionByKey, {
        sessionKey,
        sessionId,
      });
    }
    return json({ ok: true });
  }

  if (
    viewerUrl !== undefined &&
    (typeof viewerUrl !== "string" || !isValidSandboxUrl(viewerUrl, /\/[^/]*vnc[^/]*\.html$/i))
  ) {
    return json({ error: "Invalid live viewer URL" }, 400);
  }
  if (
    nativeViewerUrl !== undefined &&
    (typeof nativeViewerUrl !== "string" || !isValidSandboxUrl(nativeViewerUrl, /\/vladchat\.html$/))
  ) {
    return json({ error: "Invalid native viewer URL" }, 400);
  }

  const provider = payload.provider;
  const sandboxName = payload.sandboxName;
  const viewerToken = payload.viewerToken;
  const createdAt = payload.createdAt;
  const lastUsedAt = payload.lastUsedAt;
  const stepCount = payload.stepCount;
  if (
    (provider !== undefined && provider !== "vercel") ||
    (sandboxName !== undefined && (typeof sandboxName !== "string" || !/^vlad-cu-[a-zA-Z0-9_-]{1,54}$/.test(sandboxName))) ||
    (viewerToken !== undefined && (typeof viewerToken !== "string" || !VIEWER_TOKEN.test(viewerToken))) ||
    (createdAt !== undefined && (typeof createdAt !== "number" || !Number.isFinite(createdAt))) ||
    (lastUsedAt !== undefined && (typeof lastUsedAt !== "number" || !Number.isFinite(lastUsedAt))) ||
    (stepCount !== undefined && (typeof stepCount !== "number" || !Number.isInteger(stepCount) || stepCount < 0))
  ) {
    return json({ error: "Invalid sandbox lifecycle metadata" }, 400);
  }

  const now = Date.now();
  await ctx.runMutation(internal.computerUseScreenshots.upsertLiveSession, {
    sessionKey,
    sessionId,
    provider: "vercel",
    status: status === "active" ? "running" : status,
    ...(typeof sandboxName === "string" ? { sandboxName } : {}),
    ...(typeof viewerToken === "string" ? { viewerToken } : {}),
    ...(typeof payload.threadId === "string" ? { threadId: payload.threadId } : {}),
    ...(typeof viewerUrl === "string" ? { viewerUrl } : {}),
    ...(typeof nativeViewerUrl === "string" ? { nativeViewerUrl } : {}),
    ...(typeof createdAt === "number" ? { createdAt } : {}),
    ...(typeof lastUsedAt === "number" ? { lastUsedAt } : {}),
    ...(typeof stepCount === "number" ? { stepCount } : {}),
    updatedAt: now,
    expiresAt: (typeof createdAt === "number" ? createdAt : now) + COMPUTER_USE_SESSION_TTL_MS,
  });
  return json({ ok: true });
});

export const cleanupSessionByKey = internalMutation({
  args: { sessionKey: v.string(), sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionKey, sessionId }) => {
    const existing = await ctx.db
      .query("computerUseSessions")
      .withIndex("bySessionKey", (q) => q.eq("sessionKey", sessionKey))
      .unique();
    if (existing?.sessionId === sessionId) await ctx.db.delete(existing._id);
    return null;
  },
});

export const updateSessionStatus = internalMutation({
  args: {
    sessionKey: v.string(),
    sessionId: v.string(),
    status: v.union(
      v.literal("starting"),
      v.literal("running"),
      v.literal("stopped"),
      v.literal("expired"),
      v.literal("failed"),
    ),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { sessionKey, sessionId, status, now }) => {
    const existing = await ctx.db
      .query("computerUseSessions")
      .withIndex("bySessionKey", (q) => q.eq("sessionKey", sessionKey))
      .unique();
    if (existing?.sessionId === sessionId) {
      await ctx.db.patch(existing._id, { status, updatedAt: now });
    }
    return null;
  },
});

function isValidSandboxUrl(value: string, pathPattern: RegExp): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname.endsWith(".vercel.run") &&
      !url.username &&
      !url.password &&
      pathPattern.test(url.pathname);
  } catch {
    return false;
  }
}

export const byArtifactId = internalQuery({
  args: { artifactId: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("computerUseScreenshots"),
      _creationTime: v.number(),
      artifactId: v.string(),
      storageId: v.id("_storage"),
      sessionKey: v.string(),
      contentType: v.union(v.literal("image/jpeg"), v.literal("image/png")),
      size: v.number(),
      createdAt: v.number(),
      expiresAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { artifactId }) =>
    ctx.db
      .query("computerUseScreenshots")
      .withIndex("byArtifactId", (q) => q.eq("artifactId", artifactId))
      .unique(),
});

export const cleanupExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("computerUseScreenshots")
      .withIndex("byExpiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(100);

    for (const screenshot of expired) {
      await ctx.storage.delete(screenshot.storageId);
      await ctx.db.delete(screenshot._id);
    }

    if (expired.length === 100) {
      await ctx.scheduler.runAfter(
        0,
        internal.computerUseScreenshots.cleanupExpired,
        {},
      );
    }
    return null;
  },
});

export const upload = httpAction(async (ctx, request) => {
  if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);

  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  const artifactId = request.headers.get("x-computer-use-artifact") || "";
  const sessionKey = request.headers.get("x-computer-use-session") || "";
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!CONTENT_TYPES.has(contentType || "")) {
    return json({ error: "Unsupported screenshot content type" }, 415);
  }
  if (!ARTIFACT_ID.test(artifactId)) {
    return json({ error: "Invalid screenshot artifact ID" }, 400);
  }
  if (!sessionKey || sessionKey.length > 128) {
    return json({ error: "Invalid computer-use session key" }, 400);
  }
  if (contentLength > MAX_SCREENSHOT_BYTES) {
    return json({ error: "Screenshot exceeds the 1 MB limit" }, 413);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_SCREENSHOT_BYTES) {
    return json({ error: "Screenshot is empty or exceeds the 1 MB limit" }, 413);
  }
  if (!matchesImageContentType(bytes, contentType || "")) {
    return json({ error: "Screenshot bytes do not match the image content type" }, 415);
  }

  const mimeType = contentType as "image/jpeg" | "image/png";
  const createdAt = Date.now();
  const storageId: Id<"_storage"> = await ctx.storage.store(
    new Blob([bytes], { type: mimeType }),
  );
  try {
    await ctx.runMutation(internal.computerUseScreenshots.save, {
      artifactId,
      storageId,
      sessionKey,
      contentType: mimeType,
      size: bytes.length,
      createdAt,
      expiresAt: createdAt + SCREENSHOT_TTL_MS,
    });
  } catch (error) {
    await ctx.storage.delete(storageId);
    throw error;
  }

  return json({ id: artifactId });
});

export const download = httpAction(async (ctx, request) => {
  if (!isAuthorized(request)) return new Response("Unauthorized", { status: 401 });

  const artifactId = new URL(request.url).pathname.split("/").pop() || "";
  if (!ARTIFACT_ID.test(artifactId)) return new Response("Not found", { status: 404 });

  const record = await ctx.runQuery(internal.computerUseScreenshots.byArtifactId, {
    artifactId,
  });
  if (!record || record.expiresAt <= Date.now()) {
    return new Response("Expired or unknown screenshot", { status: 404 });
  }

  const blob = await ctx.storage.get(record.storageId);
  if (!blob) return new Response("Expired or unknown screenshot", { status: 404 });

  return new Response(blob, {
    headers: {
      "Content-Type": record.contentType,
      "Cache-Control": "private, max-age=60",
      "X-Computer-Use-Session": record.sessionKey,
      "X-Computer-Use-Created-At": String(record.createdAt),
      "Content-Length": String(record.size),
    },
  });
});
