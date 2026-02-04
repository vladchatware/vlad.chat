import { api, components } from "./_generated/api";

import { v } from "convex/values";
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
  getThreadMetadata,
  listUIMessages,
  stepCountIs,
  syncStreams,
  vMessage,
  vStreamArgs,
} from "@convex-dev/agent";
import { getAuthUserId } from "@convex-dev/auth/server"
import { agent } from "./agents/simple";
import { z } from "zod/v3";
import { gateway } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";

const ALLOWED_MODELS = new Set([
  "moonshotai/kimi-k2.5",
  "openai/gpt-5.2-codex",
  "xai/grok-4.1-fast-reasoning",
  "deepseek/deepseek-v3.2-thinking",
]);

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
        mode: "json",
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
    reasoningTokens: usage?.reasoningTokens,
    cachedInputTokens: usage?.cachedInputTokens,
    inputTokenDetails: usage?.inputTokenDetails,
    outputTokenDetails: usage?.outputTokenDetails,
    raw: usage?.raw,
  };
}

function resolveModel(model: string) {
  if (!ALLOWED_MODELS.has(model)) {
    throw new Error(`Unsupported model: ${model}`);
  }
  return gateway.languageModel(model);
}

async function getMcpTools(searchEnabled: boolean) {
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
  const notionTools = await notion.tools();

  if (!searchEnabled || !process.env.TVLY) {
    return notionTools;
  }

  try {
    const tavily = await createMCPClient({
      transport: {
        type: "http",
        url: `https://mcp.tavily.com/mcp/?tavilyApiKey=${process.env.TVLY}`,
      },
    });
    const tavilyTools = await tavily.tools();
    return { ...notionTools, ...tavilyTools };
  } catch {
    return notionTools;
  }
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
  },
  handler: async (ctx, { prompt, model, searchEnabled = false }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized");
    }

    const user = await ctx.runQuery(api.users.viewer, {});
    if (!user) {
      throw new Error("no user present in session");
    }

    if (!user.isAnonymous) {
      if (user.trialTokens <= 0 && user.tokens <= 0) {
        throw new Error("out of tokens");
      }
    } else if ((user.trialMessages ?? 0) <= 0) {
      throw new Error("no more messages left");
    }

    const text = prompt.trim();
    if (!text) {
      throw new Error("Prompt cannot be empty");
    }

    const threadId = await getOrCreateDefaultThread(ctx, userId);
    const { thread } = await agent.continueThread(ctx, { threadId, userId });

    const tools = await getMcpTools(searchEnabled);
    const result = await thread.streamText(
      {
        model: resolveModel(model),
        prompt: text,
        tools: tools as any,
        stopWhen: stepCountIs(5),
      } as any,
      {
        saveStreamDeltas: true,
        storageOptions: { saveMessages: "all" },
      },
    );

    const [outputText, usage, providerMetadata] = await Promise.all([
      result.text,
      result.usage,
      result.providerMetadata,
    ]);

    if (outputText) {
      if (user.isAnonymous) {
        await ctx.runMutation(api.users.messages, {});
      } else {
        await ctx.runMutation(api.users.usage, {
          usage: toUsageObject(usage),
          model,
          provider: "AI Gateway",
          providerMetadata,
        });
      }
    }

    return {
      threadId,
      order: result.order,
      promptMessageId: result.promptMessageId,
    };
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
