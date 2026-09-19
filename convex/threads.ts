import { api, components, internal } from "./_generated/api";

import { ConvexError, v } from "convex/values";
import {
  action,
  ActionCtx,
  mutation,
  MutationCtx,
  query,
  QueryCtx,
} from "./_generated/server.js";
import { paginationOptsValidator } from "convex/server";
import {
  abortStream,
  getThreadMetadata,
  listUIMessages,
  listMessages,
  isStepCount,
  syncStreams,
  vMessage,
  vStreamArgs,
} from "@convex-dev/agent";
import { getAuthUserId } from "@convex-dev/auth/server"
import { agent } from "./agents/simple";
import { chatSystemInstructions } from "./agents/prompts";
import { userNotionInstruction } from "@/lib/ai";
import { z } from "zod/v3";
import {
  experimental_transcribe,
  gateway,
  type ModelMessage,
  type ToolSet,
  type UserContent,
} from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { mobileMessages, unfinishedMobileText, USER_STOPPED_GENERATION } from "@/lib/mobile-stream";
import type { Id } from "./_generated/dataModel";

export const listThreads = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const threads = await ctx.runQuery(
      components.agent.threads.listThreadsByUserId,
      { userId, paginationOpts: args.paginationOpts },
    );
    return threads;
  },
});

export const createNewThread = mutation({
  args: { title: v.optional(v.string()), initialMessage: v.optional(vMessage) },
  handler: async (ctx, { title, initialMessage }) => {
    const userId = await getAuthUserId(ctx);
    const { threadId } = await agent.createThread(ctx, {
      userId,
      title,
    });
    if (initialMessage) {
      await agent.saveMessage(ctx, {
        threadId,
        message: initialMessage,
        skipEmbeddings: true,
      });
    }
    return threadId;
  },
});

export const getThreadDetails = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { title, summary } = await getThreadMetadata(ctx, components.agent, {
      threadId,
    });
    return { title, summary };
  },
});

export const updateThreadTitle = action({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const { thread } = await agent.continueThread(ctx, { threadId });
    const {
      object: { title, summary },
    } = await thread.generateObject(
      {
        schemaDescription:
          "Generate a title and summary for the thread. The title should be a single sentence that captures the main topic of the thread. The summary should be a short description of the thread that could be used to describe it to someone who hasn't read it.",
        schema: z.object({
          title: z.string().describe("The new title for the thread"),
          summary: z.string().describe("The new summary for the thread"),
        }),
        prompt: "Generate a title and summary for this thread.",
      },
      { storageOptions: { saveMessages: "none" } },
    );
    await thread.updateMetadata({ title, summary });
  },
});

function toUsageObject(usage: {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    noCacheTokens?: number;
  };
  outputTokenDetails?: {
    reasoningTokens?: number;
    textTokens?: number;
  };
  raw?: unknown;
} | undefined) {
  return {
    totalTokens: usage?.totalTokens,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens,
    cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens,
    inputTokenDetails: usage?.inputTokenDetails,
    outputTokenDetails: usage?.outputTokenDetails,
    raw: usage?.raw,
  };
}

function userFacingGenerationError(error: unknown) {
  if (error instanceof ConvexError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const text = `${message} ${JSON.stringify(error)}`;

  if (
    text.includes("Free credits temporarily have restricted access") ||
    text.includes("Free credits temporarily have rate limits") ||
    text.includes("no_providers_available") ||
    text.includes("RestrictedModelsError") ||
    text.includes("GatewayRateLimitError")
  ) {
    return new ConvexError(
      "Vlad.chat is temporarily at AI capacity for this model. Your message was not charged. Please try another model or try again later.",
    );
  }

  if (text.includes("AI_NoOutputGeneratedError")) {
    return new ConvexError(
      "The AI provider returned no response. Your message was not charged. Please try again or switch models.",
    );
  }

  return error;
}

async function failPendingMessages(
  ctx: ActionCtx | MutationCtx,
  threadId: string,
  error: string,
) {
  const pending = await ctx.runQuery(
    components.agent.messages.listMessagesByThreadId,
    {
      threadId,
      paginationOpts: { cursor: null, numItems: 20 },
      order: "desc",
      statuses: ["pending"],
    },
  );

  await Promise.all(
    pending.page.map((message) =>
      ctx.runMutation(components.agent.messages.updateMessage, {
        messageId: message._id,
        patch: {
          status: "failed",
          error,
        },
      }),
    ),
  );
}

async function getMcpTools(
  searchEnabled: boolean,
  userNotionToken?: string,
): Promise<ToolSet> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return {};
  }

  const notion = await createMCPClient({
    transport: {
      type: "http",
      url: `${siteUrl}/api/mcp`,
    },
  });
  let tools: ToolSet = await notion.tools();

  if (userNotionToken) {
    try {
      const userNotion = await createMCPClient({
        transport: {
          type: "http",
          url: "https://mcp.notion.com/mcp",
          headers: {
            Authorization: `Bearer ${userNotionToken}`,
          },
        },
      });
      const userTools = await userNotion.tools();
      const namespacedUserTools = Object.fromEntries(
        Object.entries(userTools).map(([name, tool]) => [
          `user_notion_${name}`,
          {
            ...tool,
            description: `[User Notion workspace] ${tool.description ?? ""}`,
          },
        ]),
      ) as ToolSet;
      tools = { ...tools, ...namespacedUserTools };
    } catch (error) {
      console.error("Failed to connect to user Notion MCP:", error);
    }
  }

  if (!searchEnabled || !process.env.TVLY) {
    return tools;
  }

  try {
    const tavily = await createMCPClient({
      transport: {
        type: "http",
        url: `https://mcp.tavily.com/mcp/?tavilyApiKey=${process.env.TVLY}`,
      },
    });
    const tavilyTools = await tavily.tools();
    return { ...tools, ...tavilyTools };
  } catch {
    return tools;
  }
}

async function getValidNotionToken(
  ctx: ActionCtx,
  conn: {
    accessToken: string;
    refreshToken: string;
    expiresAt?: number;
    tokenEndpoint: string;
    clientId: string;
  } | null,
): Promise<string | null> {
  if (!conn) return null;

  const isExpired =
    conn.expiresAt !== undefined &&
    Math.floor(Date.now() / 1000) >= conn.expiresAt - 60;

  if (isExpired) {
    try {
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: conn.refreshToken,
        client_id: conn.clientId,
        resource: "https://mcp.notion.com/mcp",
      });
      const res = await fetch(conn.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params.toString(),
      });
      if (!res.ok) {
        console.error("Notion token refresh failed:", res.status);
        return null;
      }
      const tokens = await res.json();
      const expiresAt = tokens.expires_in
        ? Math.floor(Date.now() / 1000) + tokens.expires_in
        : undefined;

      await ctx.runMutation(api.notion.updateTokens, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || conn.refreshToken,
        expiresAt,
      });
      return tokens.access_token;
    } catch (error) {
      console.error("Notion token refresh error:", error);
      return null;
    }
  }

  return conn.accessToken;
}

async function getDefaultThreadForUser(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  userId: string,
) {
  const threads = await ctx.runQuery(
    components.agent.threads.listThreadsByUserId,
    { userId, paginationOpts: { cursor: null, numItems: 1 } },
  );
  return threads.page[0]?._id ?? null;
}

async function getOrCreateDefaultThread(
  ctx: MutationCtx | ActionCtx,
  userId: string,
) {
  const existing = await getDefaultThreadForUser(ctx, userId);
  if (existing) {
    return existing;
  }
  const result = await agent.createThread(ctx, {
    userId,
    title: "Chat with Vlad",
  });
  return result.threadId;
}

export async function authorizeThreadAccess(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  threadId: string,
  requireUser?: boolean,
) {
  const userId = await getAuthUserId(ctx);
  if (requireUser && !userId) {
    throw new Error("Unauthorized: user is required");
  }
  const { userId: threadUserId } = await getThreadMetadata(
    ctx,
    components.agent,
    { threadId },
  );
  if (requireUser && threadUserId !== userId) {
    throw new Error("Unauthorized: user does not match thread user");
  }
}

export const getDefaultThreadId = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    return getDefaultThreadForUser(ctx, userId);
  },
});

const mobileMessageValidator = v.object({
  id: v.string(),
  role: v.string(),
  text: v.string(),
  status: v.string(),
  order: v.number(),
  createdAt: v.number(),
  response: v.optional(v.object({
    phase: v.union(
      v.literal("waiting"), v.literal("thinking"), v.literal("tool"),
      v.literal("responding"), v.literal("complete"), v.literal("stopped"), v.literal("failed"),
    ),
    tools: v.array(v.object({
      id: v.string(), name: v.string(),
      status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed"), v.literal("stopped")),
    })),
    error: v.optional(v.string()),
  })),
  attachments: v.array(v.object({
    id: v.string(),
    type: v.union(v.literal("image"), v.literal("document")),
    fileName: v.string(),
    mimeType: v.string(),
    url: v.string(),
  })),
});

const mobileAttachmentInputValidator = v.object({
  storageId: v.id("_storage"),
  fileName: v.string(),
  mimeType: v.string(),
});

const mobileThreadValidator = v.object({
  id: v.string(),
  title: v.string(),
  createdAt: v.number(),
});

const mobileAccountValidator = v.object({
  isAnonymous: v.boolean(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  trialMessages: v.number(),
  trialTokens: v.number(),
  tokens: v.number(),
});

/**
 * Small, stable transport shape for native clients.
 *
 * Preserve response activity without exposing provider-specific tool inputs or outputs.
 */
export const getMobileChat = query({
  args: { threadId: v.optional(v.string()) },
  returns: v.object({
    threadId: v.union(v.string(), v.null()),
    title: v.string(),
    threads: v.array(mobileThreadValidator),
    messages: v.array(mobileMessageValidator),
    account: v.union(mobileAccountValidator, v.null()),
    remainingMessages: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        threadId: null,
        title: "Vlad",
        threads: [],
        messages: [],
        account: null,
        remainingMessages: null,
      };
    }

    const [threadResult, user] = await Promise.all([
      ctx.runQuery(components.agent.threads.listThreadsByUserId, {
        userId,
        paginationOpts: { cursor: null, numItems: 100 },
      }),
      ctx.db.get(userId),
    ]);
    const threads = threadResult.page.map((thread) => ({
      id: thread._id,
      title: thread.title ?? "Untitled",
      createdAt: thread._creationTime,
    }));
    const threadId = args.threadId ?? threads[0]?.id ?? null;
    if (!threadId) {
      return {
        threadId: null,
        title: "Vlad",
        threads,
        messages: [],
        account: user ? mobileAccount(user) : null,
        remainingMessages: user?.isAnonymous ? (user.trialMessages ?? 0) : null,
      };
    }
    await authorizeThreadAccess(ctx, threadId, true);

    const [result, metadata] = await Promise.all([
      listMessages(ctx, components.agent, {
        threadId,
        paginationOpts: { cursor: null, numItems: 100 },
      }),
      getThreadMetadata(ctx, components.agent, { threadId }),
    ]);

    const activeStreams = await syncStreams(ctx, components.agent, {
      threadId,
      streamArgs: { kind: "list" },
    });
    const streamMessages = activeStreams?.kind === "list"
      ? activeStreams.messages
      : [];
    const activeDeltas = streamMessages.length
      ? await syncStreams(ctx, components.agent, {
          threadId,
          streamArgs: {
            kind: "deltas",
            cursors: streamMessages.map(({ streamId }) => ({
              streamId,
              cursor: 0,
            })),
          },
        })
      : undefined;

    return {
      threadId,
      title: metadata.title ?? "Untitled",
      threads,
      messages: mobileMessages(
        threadId, result.page, streamMessages,
        activeDeltas?.kind === "deltas" ? activeDeltas.deltas : [],
      ),
      account: user ? mobileAccount(user) : null,
      remainingMessages: user?.isAnonymous ? (user.trialMessages ?? 0) : null,
    };
  },
});

function mobileAccount(user: {
  isAnonymous?: boolean;
  name?: string;
  email?: string;
  trialMessages?: number;
  trialTokens?: number;
  tokens?: number;
}) {
  return {
    isAnonymous: Boolean(user.isAnonymous),
    ...(user.name === undefined ? {} : { name: user.name }),
    ...(user.email === undefined ? {} : { email: user.email }),
    trialMessages: user.trialMessages ?? 0,
    trialTokens: user.trialTokens ?? 0,
    tokens: user.tokens ?? 0,
  };
}

export const createMobileThread = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in to continue.");
    const { threadId } = await agent.createThread(ctx, {
      userId,
      title: "Untitled",
    });
    return threadId;
  },
});

export const generateMobileAttachmentUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in to continue.");
    return ctx.storage.generateUploadUrl();
  },
});

export const transcribeMobileAudio = action({
  args: { storageId: v.id("_storage") },
  returns: v.string(),
  handler: async (ctx, { storageId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in to continue.");
    try {
      const blob = await ctx.storage.get(storageId);
      if (!blob || blob.size === 0) {
        throw new ConvexError("The recording is empty or unavailable.");
      }
      if (blob.size > 20 * 1024 * 1024) {
        throw new ConvexError("The recording exceeds 20 MB.");
      }
      const result = await experimental_transcribe({
        model: gateway.transcriptionModel("openai/whisper-1"),
        audio: new Uint8Array(await blob.arrayBuffer()),
      });
      const text = result.text.trim();
      if (!text) throw new ConvexError("No speech was detected.");
      return text;
    } finally {
      await ctx.storage.delete(storageId).catch(() => undefined);
    }
  },
});

export const renameMobileThread = mutation({
  args: { threadId: v.string(), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, title }) => {
    await authorizeThreadAccess(ctx, threadId, true);
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new ConvexError("Chat title cannot be empty.");
    await agent.updateThreadMetadata(ctx, {
      threadId,
      patch: { title: normalizedTitle },
    });
    return null;
  },
});

export const deleteMobileThread = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId, true);
    await agent.deleteThreadAsync(ctx, { threadId });
    return null;
  },
});

export const deleteMobileMessagesFrom = action({
  args: { threadId: v.string(), startOrder: v.number() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, { threadId, startOrder }) => {
    await authorizeThreadAccess(ctx, threadId, true);

    let nextOrder = startOrder;
    let nextStepOrder = 0;
    let isDone = false;
    while (!isDone) {
      const result = await agent.deleteMessageRange(ctx, {
        threadId,
        startOrder: nextOrder,
        startStepOrder: nextStepOrder,
        endOrder: Number.MAX_SAFE_INTEGER,
      });
      isDone = result.isDone;
      const resumedOrder = result.lastOrder ?? nextOrder;
      const resumedStepOrder = result.lastStepOrder ?? nextStepOrder;
      if (
        !isDone &&
        resumedOrder === nextOrder &&
        resumedStepOrder === nextStepOrder
      ) {
        throw new Error("Message deletion did not advance.");
      }
      nextOrder = resumedOrder;
      nextStepOrder = resumedStepOrder;
    }
    return { deleted: true };
  },
});

export const getUIMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: v.optional(vStreamArgs),
  },
  handler: async (ctx, args) => {
    await authorizeThreadAccess(ctx, args.threadId, true);
    const result = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });
    return { ...result, streams };
  },
});

export const generateReply = action({
  args: {
    prompt: v.string(),
    model: v.string(),
    searchEnabled: v.optional(v.boolean()),
    threadId: v.optional(v.string()),
    attachments: v.optional(v.array(mobileAttachmentInputValidator)),
  },
  handler: async (ctx, {
    prompt,
    model,
    searchEnabled = false,
    threadId: requestedThreadId,
    attachments = [],
  }) => {
    try {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Please sign in to continue.");
    }

    const user = await ctx.runQuery(api.users.viewer, {});
    if (!user) {
      throw new ConvexError("We couldn't load your account. Please refresh and try again.");
    }

    if (!user.isAnonymous) {
      if (user.trialTokens <= 0 && user.tokens <= 0) {
        throw new ConvexError("You have run out of credits. Buy more to continue.");
      }
    } else if ((user.trialMessages ?? 0) <= 0) {
      throw new ConvexError("You've reached the anonymous message limit. Sign in with Google for unlimited messages.");
    }

    const text = prompt.trim();
    if (!text) {
      throw new ConvexError("Your message is empty. Please type something first.");
    }

    const notionConn = await ctx.runQuery(internal.notion.getConnectionForUser, {
      userId,
    });
    const userNotionToken = await getValidNotionToken(ctx, notionConn);

    const tools = await getMcpTools(searchEnabled, userNotionToken ?? undefined);

    const notionInstruction = notionConn
      ? userNotionInstruction(notionConn.workspaceName)
      : "";

    if (requestedThreadId) {
      await authorizeThreadAccess(ctx, requestedThreadId, true);
    }
    const threadId = requestedThreadId ?? await getOrCreateDefaultThread(ctx, userId);
    const { thread } = await agent.continueThread(ctx, { threadId, userId });
    const modelPrompt = await mobileModelPrompt(ctx, text, attachments);

    const result = await thread.streamText(
      {
        model: gateway.languageModel(model),
        instructions: notionInstruction
          ? `${chatSystemInstructions}${notionInstruction}`
          : undefined,
        prompt: modelPrompt,
        tools,
        stopWhen: isStepCount(8),
        onError: async () => {
          await failPendingMessages(
            ctx,
            threadId,
            "The AI provider failed before returning a response.",
          );
        },
      },
      {
        saveStreamDeltas: true,
        storageOptions: { saveMessages: "all" },
      },
    );

    let outputText: string;
    let usage: Awaited<typeof result.usage>;
    let providerMetadata: Awaited<typeof result.finalStep>["providerMetadata"];
    try {
      const [textResult, usageResult, finalStep] = await Promise.all([
        result.text,
        result.usage,
        result.finalStep,
      ]);
      outputText = textResult;
      usage = usageResult;
      providerMetadata = finalStep.providerMetadata;
    } catch (error) {
      await failPendingMessages(
        ctx,
        threadId,
        "The AI provider failed before returning a response.",
      );
      throw userFacingGenerationError(error);
    }
    const usageObject = toUsageObject(usage);

    if (outputText) {
      if (user.isAnonymous) {
        await ctx.runMutation(api.users.messages, {});
      } else {
        await ctx.runMutation(api.users.usage, {
          usage: usageObject,
          model,
          provider: "AI Gateway",
          providerMetadata,
        });
      }
    }

    const hasUsage =
      usageObject.totalTokens !== undefined ||
      usageObject.inputTokens !== undefined ||
      usageObject.outputTokens !== undefined;
    if (hasUsage || providerMetadata) {
      try {
        await ctx.runAction(internal.posthog.captureLlmGeneration, {
          distinctId: userId,
          traceId: `${threadId}:${result.order}`,
          threadId,
          order: result.order,
          model,
          provider: "AI Gateway",
          input: [{ role: "user", content: text }],
          output: outputText
            ? [
                {
                  role: "assistant",
                  content: [{ type: "text", text: outputText }],
                },
              ]
            : [],
          usage: usageObject,
          providerMetadata,
        });
      } catch (error) {
        console.error("PostHog LLM capture failed", error);
      }
    }

    await Promise.allSettled(
      attachments.map(({ storageId }) => ctx.storage.delete(storageId)),
    );

    return {
      threadId,
      order: result.order,
      promptMessageId: result.promptMessageId,
    };
    } catch (error) {
      await Promise.allSettled(
        attachments.map(({ storageId }) => ctx.storage.delete(storageId)),
      );
      throw userFacingGenerationError(error);
    }
  },
});

async function mobileModelPrompt(
  ctx: ActionCtx,
  text: string,
  attachments: Array<{
    storageId: Id<"_storage">;
    fileName: string;
    mimeType: string;
  }>,
): Promise<string | ModelMessage[]> {
  if (!attachments.length) return text;

  const content: Exclude<UserContent, string> = text
    ? [{ type: "text", text }]
    : [];
  for (const attachment of attachments) {
    const blob = await ctx.storage.get(attachment.storageId);
    if (!blob) {
      throw new ConvexError(`Attachment '${attachment.fileName}' was not uploaded.`);
    }
    if (blob.size > 20 * 1024 * 1024) {
      throw new ConvexError(`Attachment '${attachment.fileName}' exceeds 20 MB.`);
    }
    content.push({
      type: "file",
      data: {
        type: "data",
        data: new Uint8Array(await blob.arrayBuffer()),
      },
      filename: attachment.fileName,
      mediaType: attachment.mimeType,
    });
  }
  return [{ role: "user", content }];
}

export const abortReply = mutation({
  args: {
    threadId: v.string(),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await authorizeThreadAccess(ctx, args.threadId, true);

    const activeStreams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: { kind: "list" },
    });
    const activeOrders = activeStreams?.kind === "list"
      ? activeStreams.messages.map((message) => message.order)
      : [];
    const orders = [...new Set(activeOrders)].filter((order) =>
      args.order === undefined || order === args.order
    );
    // An order may be reserved before its stream exists. The client keeps the
    // stop intent and retries on the next snapshot; failing that reservation here
    // would allow generation to start after an apparent successful stop.
    if (!orders.length) return { aborted: false, failedPending: 0 };
    const streams = activeStreams?.kind === "list"
      ? activeStreams.messages.filter((stream) => orders.includes(stream.order)) : [];
    const snapshot = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: { kind: "deltas", cursors: streams.map((stream) => ({ streamId: stream.streamId, cursor: 0 })) },
    });
    const documents = await listMessages(ctx, components.agent, {
      threadId: args.threadId, paginationOpts: { cursor: null, numItems: 100 },
    });
    const partialText = new Map(streams.map((stream) => [
      stream.order,
      unfinishedMobileText(documents.page, stream, snapshot?.kind === "deltas" ? snapshot.deltas : []),
    ]));
    let aborted = false;
    for (const order of orders) {
      aborted = await abortStream(ctx, components.agent, {
        threadId: args.threadId,
        order,
        reason: USER_STOPPED_GENERATION,
      }) || aborted;
    }

    const matchingPending = documents.page.filter((message) =>
      message.status === "pending" && orders.includes(message.order)
    );
    await Promise.all(
      matchingPending.map((message) =>
        ctx.runMutation(components.agent.messages.updateMessage, {
          messageId: message._id,
          patch: {
            status: "failed",
            error: USER_STOPPED_GENERATION,
            // Keep the unfinished step after delta cleanup without duplicating saved text.
            message: { role: "assistant", content: partialText.get(message.order) ?? "" },
          },
        }),
      ),
    );

    return {
      aborted,
      failedPending: matchingPending.length,
    };
  },
});

export const hasActiveStreams = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    await authorizeThreadAccess(ctx, args.threadId, true);
    const streams = await ctx.runQuery(components.agent.streams.list, {
      threadId: args.threadId,
      statuses: ["streaming"],
    });
    return streams.length > 0;
  },
});

// Get messages for user's default thread with pagination
export const getMessages = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { paginationOpts }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const threadId = await getDefaultThreadForUser(ctx, userId);
    if (!threadId) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    // Use component API directly to control order (agent.listMessages hardcodes desc)
    const result = await ctx.runQuery(
      components.agent.messages.listMessagesByThreadId,
      {
        threadId,
        paginationOpts,
        order: "asc",
        statuses: ["success"],
      }
    );

    return result;
  },
});

// Save message to user's default thread (creates thread on first message)
export const saveMessage = mutation({
  args: {
    message: vMessage
  },
  handler: async (ctx, { message }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    const threadId = await getOrCreateDefaultThread(ctx, userId);

    await agent.saveMessage(ctx, {
      threadId,
      message,
      skipEmbeddings: true,
    });
  },
});
