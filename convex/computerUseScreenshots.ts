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
const ARTIFACT_ID = /^cu_[a-z0-9_]{8,80}$/i;
const CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);

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
