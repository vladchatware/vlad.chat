import { jwtVerify } from "jose";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  httpAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";

const GRANT_ISSUER = "vlad.chat/computer-use";
const GRANT_AUDIENCE = "vlad.chat/run-code";
const MAX_SOURCE_CHARS = 64 * 1024;
const MAX_LOG_CHARS = 64 * 1024;
const CODE_RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const runStatus = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("stopped"),
  v.literal("interrupted"),
);

const runFields = {
  runId: v.string(),
  userId: v.string(),
  sessionKey: v.string(),
  threadId: v.string(),
  description: v.string(),
  code: v.string(),
  status: runStatus,
  stdout: v.string(),
  stderr: v.string(),
  outputTruncated: v.boolean(),
  returnValue: v.optional(v.string()),
  exitCode: v.optional(v.number()),
  errorText: v.optional(v.string()),
  startedAt: v.number(),
  updatedAt: v.number(),
  finishedAt: v.optional(v.number()),
  expiresAt: v.number(),
};

const runResponseFields = {
  ...runFields,
  userId: v.id("users"),
};

const storedRunFields = {
  ...runResponseFields,
  _id: v.id("computerCodeRuns"),
  _creationTime: v.number(),
};

type CodeRunUpdate = {
  runId: string;
  description?: string;
  code?: string;
  status: "running" | "completed" | "failed" | "stopped" | "interrupted";
  stdout?: string;
  stderr?: string;
  outputTruncated?: boolean;
  returnValue?: string;
  exitCode?: number;
  errorText?: string;
  startedAt?: number;
  finishedAt?: number;
};

function isCodeRunUpdate(value: unknown): value is CodeRunUpdate {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const validStatuses = ["running", "completed", "failed", "stopped", "interrupted"];
  return typeof record.runId === "string" && /^[a-f0-9-]{16,64}$/i.test(record.runId) &&
    typeof record.status === "string" && validStatuses.includes(record.status) &&
    (record.description === undefined || typeof record.description === "string") &&
    (record.code === undefined || typeof record.code === "string") &&
    (record.stdout === undefined || typeof record.stdout === "string") &&
    (record.stderr === undefined || typeof record.stderr === "string") &&
    (record.outputTruncated === undefined || typeof record.outputTruncated === "boolean") &&
    (record.returnValue === undefined || typeof record.returnValue === "string") &&
    (record.exitCode === undefined || typeof record.exitCode === "number") &&
    (record.errorText === undefined || typeof record.errorText === "string") &&
    (record.startedAt === undefined || typeof record.startedAt === "number") &&
    (record.finishedAt === undefined || typeof record.finishedAt === "number");
}

export const save = internalMutation({
  args: { ...runFields, isAnonymous: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { isAnonymous, ...args }) => {
    const userId = ctx.db.normalizeId("users", args.userId);
    if (!userId) throw new Error("Code run grant has invalid user identity.");
    const existing = await ctx.db
      .query("computerCodeRuns")
      .withIndex("byRunId", (q) => q.eq("runId", args.runId))
      .unique();
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.sessionKey !== args.sessionKey ||
        existing.threadId !== args.threadId
      ) {
        throw new Error("Code run identity cannot be changed.");
      }
      if (existing.status !== "running") return null;
      await ctx.db.patch(existing._id, {
        status: args.status,
        stdout: args.stdout,
        stderr: args.stderr,
        outputTruncated: args.outputTruncated,
        returnValue: args.returnValue,
        exitCode: args.exitCode,
        errorText: args.errorText,
        updatedAt: args.updatedAt,
        finishedAt: args.finishedAt,
        expiresAt: args.expiresAt,
      });
      return null;
    }
    if (args.status !== "running") {
      throw new Error("A new code run must start in running state.");
    }
    const user = await ctx.db.get(userId);
    if (!user || Boolean(user.isAnonymous) !== isAnonymous) {
      throw new Error("Code run grant does not match its user identity.");
    }
    await ctx.db.insert("computerCodeRuns", { ...args, userId });
    return null;
  },
});

export const getForThread = query({
  args: { threadId: v.string() },
  returns: v.array(v.object(storedRunFields)),
  handler: async (ctx, { threadId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const runs = await ctx.db
      .query("computerCodeRuns")
      .withIndex("byUserThreadUpdatedAt", (q) =>
        q.eq("userId", userId).eq("threadId", threadId),
      )
      .order("desc")
      .take(1);
    return runs.filter((run) => run.expiresAt > Date.now());
  },
});

export const publish = httpAction(async (ctx, request) => {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
  const secret = process.env.COMPUTER_USE_AUTH_SECRET;
  if (!token || !secret || secret.length < 32) {
    return new Response("Unauthorized", { status: 401 });
  }

  let userId: string;
  let sessionKey: string;
  let threadId: string;
  let isAnonymous: boolean;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: GRANT_ISSUER,
      audience: GRANT_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.sessionKey !== "string" ||
      typeof payload.threadId !== "string" ||
      typeof payload.isAnonymous !== "boolean" ||
      payload.sessionKey !== payload.sub
    ) {
      return new Response("Invalid grant", { status: 401 });
    }
    userId = payload.sub;
    sessionKey = payload.sessionKey;
    threadId = payload.threadId;
    isAnonymous = payload.isAnonymous;
  } catch {
    return new Response("Invalid grant", { status: 401 });
  }

  let body: CodeRunUpdate;
  try {
    const parsed: unknown = await request.json();
    if (!isCodeRunUpdate(parsed)) return new Response("Invalid code run update", { status: 400 });
    body = parsed;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (
    (body.code !== undefined && new TextEncoder().encode(body.code).byteLength > MAX_SOURCE_CHARS) ||
    (body.description !== undefined && body.description.length > 500) ||
    (body.stdout !== undefined && body.stdout.length > MAX_LOG_CHARS) ||
    (body.stderr !== undefined && body.stderr.length > MAX_LOG_CHARS) ||
    (body.returnValue !== undefined && body.returnValue.length > 20 * 1024) ||
    (body.errorText !== undefined && body.errorText.length > 4 * 1024)
  ) {
    return new Response("Invalid code run update", { status: 400 });
  }

  const existing = await ctx.runQuery(internal.computerUseCodeRuns.getInternal, {
    runId: body.runId,
  });
  const now = Date.now();
  const code = body.code ?? existing?.code;
  const description = body.description ?? existing?.description;
  if (!code || !description) {
    return new Response("Initial code run update must include source and description", {
      status: 400,
    });
  }
  await ctx.runMutation(internal.computerUseCodeRuns.save, {
    runId: body.runId,
    userId,
    sessionKey,
    threadId,
    isAnonymous,
    description,
    code,
    status: body.status,
    stdout: body.stdout ?? existing?.stdout ?? "",
    stderr: body.stderr ?? existing?.stderr ?? "",
    outputTruncated: body.outputTruncated ?? existing?.outputTruncated ?? false,
    ...(body.returnValue === undefined
      ? existing?.returnValue === undefined ? {} : { returnValue: existing.returnValue }
      : { returnValue: body.returnValue }),
    ...(body.exitCode === undefined
      ? existing?.exitCode === undefined ? {} : { exitCode: existing.exitCode }
      : { exitCode: body.exitCode }),
    ...(body.errorText === undefined
      ? existing?.errorText === undefined ? {} : { errorText: existing.errorText }
      : { errorText: body.errorText }),
    startedAt: body.startedAt ?? existing?.startedAt ?? now,
    updatedAt: now,
    ...(body.finishedAt === undefined ? {} : { finishedAt: body.finishedAt }),
    expiresAt: now + CODE_RUN_RETENTION_MS,
  });
  return new Response("", { status: 204 });
});

export const cleanupExpired = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("computerCodeRuns")
      .withIndex("byExpiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(100);
    await Promise.all(expired.map((run) => ctx.db.delete(run._id)));
    return expired.length;
  },
});

export const getInternal = internalQuery({
  args: { runId: v.string() },
  returns: v.union(v.object(storedRunFields), v.null()),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db
      .query("computerCodeRuns")
      .withIndex("byRunId", (q) => q.eq("runId", runId))
      .unique();
    return run;
  },
});
