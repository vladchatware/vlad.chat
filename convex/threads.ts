import { api, components, internal } from "./_generated/api";

import { ConvexError, v } from "convex/values";
import {
  action,
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  MutationCtx,
  query,
  QueryCtx,
} from "./_generated/server.js";
import { paginationOptsValidator, type FunctionReturnType } from "convex/server";
import {
  abortStream,
  getThreadMetadata,
  listMessages,
  listUIMessages,
  isStepCount,
  syncStreams,
  storeFile,
  vMessage,
  vStreamArgs,
} from "@convex-dev/agent";
import { getAuthUserId } from "@convex-dev/auth/server"
import { agent } from "./agents/simple";
import { chatSystemInstructions } from "./agents/prompts";
import { userNotionInstruction } from "@/lib/ai";
import {
  computerUseInstruction,
  hasComputerUseTools,
} from "@/lib/computer-use/skill";
import { getActiveLiveSessionForThread } from "./computerUseScreenshots";
import { isModelEnabled, isPremiumModel } from "@/lib/provider";
import { z } from "zod/v3";
import {
  gateway,
  type ModelMessage,
  type ToolSet,
  type UserContent,
} from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import {
  mergeMobileStreamText,
  projectStoredResponse,
} from "@/lib/mobile-stream";
import type { Doc, Id } from "./_generated/dataModel";
import { WorkflowManager, sendEvent, start, vWorkflowId, vResultValidator } from "@convex-dev/workflow";
import type { WorkflowId } from "@convex-dev/workflow";

const workflow = new WorkflowManager(components.workflow);

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
  /** Stable sandbox session for computer_* MCP tools (userId). */
  computerSessionKey?: string,
  computerThreadId?: string,
): Promise<ToolSet> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return {};
  }

  let tools: ToolSet = {};
  try {
    const notion = await createMCPClient({
      transport: {
        type: "http",
        url: `${siteUrl}/api/mcp`,
        headers: {
          ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
            ? {
                "x-vercel-protection-bypass":
                  process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
              }
            : {}),
          ...(computerSessionKey ? { "x-computer-session": computerSessionKey } : {}),
          ...(computerThreadId ? { "x-computer-thread": computerThreadId } : {}),
        },
      },
    });
    // Site MCP includes Notion tools and, when enabled, computer_* (V-83).
    tools = await notion.tools();
  } catch (error) {
    console.error("Failed to connect to site Notion MCP:", error);
  }

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
  userId: Id<"users">,
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

      await ctx.runMutation(internal.notion.updateTokensForAgent, {
        userId,
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

const MAX_AGENT_STEPS = 8;
const MAX_AGENT_STEP_ATTEMPTS = 3;
const MAX_STEERING_PER_RUN = 20;

export const getAgentRunInternal = internalQuery({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, { runId }) => ctx.db.get(runId),
});

export const getAgentRunSteeringForStep = internalQuery({
  args: { steeringIds: v.array(v.id("agentRunSteering")) },
  handler: async (ctx, { steeringIds }) =>
    Promise.all(steeringIds.map((steeringId) => ctx.db.get(steeringId))),
});

export const createAgentRunWithPrompt = internalMutation({
  args: {
    threadId: v.string(),
    userId: v.id("users"),
    prompt: vMessage,
    fileIds: v.optional(v.array(v.string())),
    model: v.string(),
    searchEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const [runningRun, stopRequestedRun, pausedRun, queuedRun] = await Promise.all([
      ctx.db
        .query("agentRuns")
        .withIndex("byThreadAndStatus", (q) =>
          q.eq("threadId", args.threadId).eq("status", "running"),
        )
        .first(),
      ctx.db
        .query("agentRuns")
        .withIndex("byThreadAndStatus", (q) =>
          q.eq("threadId", args.threadId).eq("status", "stopRequested"),
        )
        .first(),
      ctx.db
        .query("agentRuns")
        .withIndex("byThreadAndStatus", (q) =>
          q.eq("threadId", args.threadId).eq("status", "paused"),
        )
        .first(),
      ctx.db
        .query("agentRuns")
        .withIndex("byThreadAndStatus", (q) =>
          q.eq("threadId", args.threadId).eq("status", "queued"),
        )
        .first(),
    ]);
    const queued = Boolean(
      runningRun || stopRequestedRun || pausedRun || queuedRun,
    );
    const savedPrompt = queued
      ? undefined
      : await agent.saveMessage(ctx, {
          threadId: args.threadId,
          userId: args.userId,
          message: args.prompt,
          metadata: args.fileIds ? { fileIds: args.fileIds } : undefined,
          skipEmbeddings: true,
        });
    const now = Date.now();
    const runId = await ctx.db.insert("agentRuns", {
      threadId: args.threadId,
      userId: args.userId,
      promptMessageId: savedPrompt?.messageId,
      order: savedPrompt?.message.order,
      queuedPrompt: queued ? args.prompt : undefined,
      queuedFileIds: queued ? args.fileIds : undefined,
      model: args.model,
      searchEnabled: args.searchEnabled,
      status: queued ? "queued" : "running",
      stepCount: 0,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return {
      runId,
      promptMessageId: savedPrompt?.messageId,
      order: savedPrompt?.message.order,
      queued,
    };
  },
});

export const attachAgentRunWorkflow = internalMutation({
  args: { runId: v.id("agentRuns"), workflowId: vWorkflowId },
  returns: v.null(),
  handler: async (ctx, { runId, workflowId }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new ConvexError("Agent run not found.");
    await ctx.db.patch(runId, { workflowId, updatedAt: Date.now() });
    return null;
  },
});

export const claimAgentRunStep = internalMutation({
  args: { runId: v.id("agentRuns"), stepNumber: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { runId, stepNumber }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "running") return false;
    if (run.stepCount + 1 !== stepNumber) {
      throw new ConvexError("Agent run checkpoint is out of sequence.");
    }
    if (run.inFlightStep !== undefined) {
      if (run.inFlightStep !== stepNumber) {
        throw new ConvexError("Another agent step is already in flight.");
      }
      return true;
    }
    const steering = await ctx.db
      .query("agentRunSteering")
      .withIndex("byRun", (q) => q.eq("runId", runId))
      .order("asc")
      .take(MAX_STEERING_PER_RUN);
    await ctx.db.patch(runId, {
      inFlightStep: stepNumber,
      attemptCount: run.attemptCount + 1,
      inFlightAttempt: 1,
      inFlightPhase: "model",
      inFlightStreamId: undefined,
      inFlightStepOrder: undefined,
      inFlightSteeringIds: steering.map((note) => note._id),
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const advanceAgentRunStepAttempt = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    stepNumber: v.number(),
    expectedAttempt: v.number(),
  },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { runId, stepNumber, expectedAttempt }) => {
    const run = await ctx.db.get(runId);
    if (
      !run ||
      run.status !== "running" ||
      run.inFlightStep !== stepNumber ||
      run.inFlightPhase !== "model"
    ) {
      return null;
    }
    if (run.inFlightAttempt !== expectedAttempt) {
      return run.inFlightAttempt !== undefined &&
          run.inFlightAttempt > expectedAttempt
        ? run.inFlightAttempt
        : null;
    }
    if (expectedAttempt >= MAX_AGENT_STEP_ATTEMPTS) return null;
    if (run.inFlightStreamId) {
      await abortStream(ctx, components.agent, {
        streamId: run.inFlightStreamId,
        reason: "Interrupted model attempt is being retried.",
      }).catch((error) => {
        console.error("Could not abort interrupted agent stream", error);
      });
    }
    const nextAttempt = expectedAttempt + 1;
    await ctx.db.patch(runId, {
      attemptCount: run.attemptCount + 1,
      inFlightAttempt: nextAttempt,
      inFlightStreamId: undefined,
      inFlightStepOrder: undefined,
      updatedAt: Date.now(),
    });
    return nextAttempt;
  },
});

export const setAgentRunStepPhase = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    stepNumber: v.number(),
    phase: v.literal("tool"),
  },
  returns: v.boolean(),
  handler: async (ctx, { runId, stepNumber, phase }) => {
    const run = await ctx.db.get(runId);
    if (
      !run ||
      run.status !== "running" ||
      run.inFlightStep !== stepNumber
    ) {
      return false;
    }
    await ctx.db.patch(runId, { inFlightPhase: phase, updatedAt: Date.now() });
    return true;
  },
});

export const setAgentRunStream = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    stepNumber: v.number(),
    streamId: v.string(),
    stepOrder: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, { runId, stepNumber, streamId, stepOrder }) => {
    const run = await ctx.db.get(runId);
    if (
      !run ||
      run.status !== "running" ||
      run.inFlightStep !== stepNumber
    ) {
      return false;
    }
    await ctx.db.patch(runId, {
      inFlightStreamId: streamId,
      inFlightStepOrder: stepOrder,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const setAgentRunStatus = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    status: v.union(
      v.literal("running"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { runId, status, error }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    if (run.status === "completed" || run.status === "failed") return null;
    if (status === "paused" && run.status !== "stopRequested") return null;
    if (
      status === "running" &&
      run.status !== "paused" &&
      run.status !== "running"
    ) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(runId, {
      status,
      updatedAt: now,
      ...(status === "completed" || status === "failed"
        ? { completedAt: now }
        : {}),
      ...(error ? { lastError: error } : {}),
    });
    return null;
  },
});

export const completeAgentRunIfRunning = internalMutation({
  args: { runId: v.id("agentRuns") },
  returns: v.boolean(),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "running") return false;
    const pendingSteering = await ctx.db
      .query("agentRunSteering")
      .withIndex("byRunAndStatus", (q) =>
        q.eq("runId", runId).eq("status", "pending"),
      )
      .first();
    if (pendingSteering) {
      if (run.stepCount >= MAX_AGENT_STEPS) {
        const now = Date.now();
        await ctx.db.patch(runId, {
          status: "failed",
          lastError: "The run reached its step limit with unapplied steering. Send that direction as a new message.",
          updatedAt: now,
          completedAt: now,
        });
      }
      return false;
    }
    const now = Date.now();
    await ctx.db.patch(runId, {
      status: "completed",
      updatedAt: now,
      completedAt: now,
    });
    return true;
  },
});

export const agentRunWorkflow = workflow.define({
  args: { runId: v.id("agentRuns") },
  returns: v.null(),
  handler: async (step, { runId }): Promise<null> => {
    await step.runMutation(internal.threads.attachAgentRunWorkflow, {
      runId,
      workflowId: step.workflowId,
    });

    const pauseForRequestedStop = async () => {
      const currentRun = await step.runQuery(
        internal.threads.getAgentRunInternal,
        { runId },
      );
      if (currentRun?.status !== "stopRequested") return false;
      await step.runMutation(internal.threads.setAgentRunStatus, {
        runId,
        status: "paused",
      });
      await step.awaitEvent({ name: "resume" });
      await step.runMutation(internal.threads.setAgentRunStatus, {
        runId,
        status: "running",
      });
      return true;
    };

    for (let stepNumber = 1; stepNumber <= MAX_AGENT_STEPS; stepNumber += 1) {
      let claimed = false;
      while (!claimed) {
        const run = await step.runQuery(internal.threads.getAgentRunInternal, {
          runId,
        });
        if (!run || ["completed", "failed"].includes(run.status)) return null;
        if (run.status === "stopRequested") {
          await step.runMutation(internal.threads.setAgentRunStatus, {
            runId,
            status: "paused",
          });
          await step.awaitEvent({ name: "resume" });
          await step.runMutation(internal.threads.setAgentRunStatus, {
            runId,
            status: "running",
          });
          continue;
        }
        if (run.status !== "running") return null;
        claimed = await step.runMutation(internal.threads.claimAgentRunStep, {
          runId,
          stepNumber,
        });
      }

      const claimedRun = await step.runQuery(
        internal.threads.getAgentRunInternal,
        { runId },
      );
      let attempt = claimedRun?.inFlightStep === stepNumber
        ? claimedRun.inFlightAttempt ?? 1
        : 1;
      let result: FunctionReturnType<typeof internal.threads.runAgentStep> | undefined;
      while (result === undefined) {
        try {
          result = await step.runAction(
            internal.threads.runAgentStep,
            { runId, stepNumber },
            {
              retry: false,
              name: `agent-step-${stepNumber}-attempt-${attempt}`,
            },
          );
        } catch (error) {
          let currentRun = await step.runQuery(
            internal.threads.getAgentRunInternal,
            { runId },
          );
          if (
            currentRun?.status === "stopRequested" &&
            currentRun.inFlightPhase === "model"
          ) {
            await pauseForRequestedStop();
            currentRun = await step.runQuery(
              internal.threads.getAgentRunInternal,
              { runId },
            );
          }
          if (
            currentRun?.status !== "running" ||
            currentRun.inFlightStep !== stepNumber ||
            currentRun.inFlightPhase !== "model" ||
            attempt >= MAX_AGENT_STEP_ATTEMPTS
          ) {
            throw error;
          }
          let nextAttempt = await step.runMutation(
            internal.threads.advanceAgentRunStepAttempt,
            { runId, stepNumber, expectedAttempt: attempt },
          );
          if (nextAttempt === null) {
            currentRun = await step.runQuery(
              internal.threads.getAgentRunInternal,
              { runId },
            );
            if (
              currentRun?.status === "stopRequested" &&
              currentRun.inFlightPhase === "model"
            ) {
              await pauseForRequestedStop();
              nextAttempt = await step.runMutation(
                internal.threads.advanceAgentRunStepAttempt,
                { runId, stepNumber, expectedAttempt: attempt },
              );
            }
          }
          if (nextAttempt === null) throw error;
          attempt = nextAttempt;
        }
      }
      await step.runMutation(internal.users.settleAgentRunStep, {
        runId,
        stepNumber,
        ...result,
      });

      const stopped = await pauseForRequestedStop();
      if (stopped) {
        if (stepNumber === MAX_AGENT_STEPS) {
          await step.runMutation(
            internal.threads.completeAgentRunIfRunning,
            { runId },
          );
          return null;
        }
        continue;
      }

      if (!result.hasToolCalls || stepNumber === MAX_AGENT_STEPS) {
        const completed = await step.runMutation(
          internal.threads.completeAgentRunIfRunning,
          { runId },
        );
        if (completed) return null;

        // Stop may commit between the status read and completion. Re-read it
        // before exiting so a user stop cannot be overwritten as completion.
        if (await pauseForRequestedStop()) {
          if (stepNumber < MAX_AGENT_STEPS) continue;
          await step.runMutation(
            internal.threads.completeAgentRunIfRunning,
            { runId },
          );
        }
        const currentRun = await step.runQuery(
          internal.threads.getAgentRunInternal,
          { runId },
        );
        if (
          currentRun?.status === "running" &&
          stepNumber < MAX_AGENT_STEPS
        ) {
          continue;
        }
        return null;
      }
    }

    return null;
  },
});

export const agentRunWorkflowCompleted = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ runId: v.id("agentRuns") }),
  },
  returns: v.null(),
  handler: async (ctx, { context: { runId }, result }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    if (result.kind === "success") {
      if (run.status !== "failed") {
        const now = Date.now();
        await ctx.db.patch(runId, {
          status: "completed",
          updatedAt: now,
          completedAt: now,
        });
      }
    } else {
      const error = result.kind === "failed" ? result.error : "Workflow canceled.";
      await ctx.db.patch(runId, {
        status: "failed",
        lastError: error,
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
      const pending = await ctx.runQuery(
        components.agent.messages.listMessagesByThreadId,
        {
          threadId: run.threadId,
          paginationOpts: { cursor: null, numItems: 20 },
          order: "desc",
          statuses: ["pending"],
        },
      );
      await Promise.all(
        pending.page.map((message) =>
          ctx.runMutation(components.agent.messages.updateMessage, {
            messageId: message._id,
            patch: { status: "failed", error: "The agent run failed. Please try again." },
          }),
        ),
      );
    }
    try {
      await startNextQueuedAgentRunForThread(ctx, run.threadId);
    } catch (error) {
      console.error("Could not start the next queued agent run", error);
    }
    return null;
  },
});

export const runAgentStep = internalAction({
  args: {
    runId: v.id("agentRuns"),
    stepNumber: v.number(),
  },
  handler: async (ctx, { runId, stepNumber }) => {
    const run = await ctx.runQuery(internal.threads.getAgentRunInternal, {
      runId,
    });
    if (
      !run ||
      !run.promptMessageId ||
      run.order === undefined ||
      run.stepCount + 1 !== stepNumber ||
      run.inFlightStep !== stepNumber
    ) {
      throw new ConvexError("Agent run checkpoint is out of sequence.");
    }
    const steering = (await ctx.runQuery(
      internal.threads.getAgentRunSteeringForStep,
      { steeringIds: run.inFlightSteeringIds ?? [] },
    )).filter((note) => note !== null);

    const notionConn = await ctx.runQuery(internal.notion.getConnectionForUser, {
      userId: run.userId,
    });
    const userNotionToken = await getValidNotionToken(
      ctx,
      run.userId,
      notionConn,
    );
    const tools = await getMcpTools(
      run.searchEnabled,
      userNotionToken ?? undefined,
      String(run.userId),
      run.threadId,
    );
    const notionInstruction = notionConn
      ? userNotionInstruction(notionConn.workspaceName)
      : "";
    const computerInstruction = hasComputerUseTools(tools)
      ? computerUseInstruction()
      : "";
    const steeringInstruction = steering.length > 0
      ? `\n\nPersistent user steering for this run. Apply these directions from this model step onward:\n${steering.map((note) => `- ${note.text}`).join("\n")}`
      : "";
    const extraInstructions = `${notionInstruction}${computerInstruction}${steeringInstruction}`;

    const { thread } = await agent.continueThread(ctx, {
      threadId: run.threadId,
      userId: run.userId,
    });
    const abortController = new AbortController();
    let monitorActive = true;
    let toolExecutionMayStart = false;
    let toolStepStarted = false;
    let streamIdRecorded = false;
    let activeStreamStepOrder: number | undefined;
    const stopMonitor = (async () => {
      while (monitorActive && !toolExecutionMayStart) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!monitorActive || toolExecutionMayStart) return;
        const currentRun = await ctx.runQuery(
          internal.threads.getAgentRunInternal,
          { runId },
        );
        if (currentRun?.status === "stopRequested") {
          abortController.abort(new Error("User requested Stop."));
          return;
        }
        if (!currentRun || currentRun.status !== "running") return;
      }
    })().catch((error) => {
      console.error("Agent run stop monitor failed", error);
    });

    let streamFailed = false;
    let streamError: unknown;
    let result: Awaited<ReturnType<typeof thread.streamText>> | undefined;
    try {
      result = await thread.streamText(
        {
          model: gateway.languageModel(run.model),
          promptMessageId: run.promptMessageId,
          instructions: extraInstructions
            ? `${chatSystemInstructions}${extraInstructions}`
            : undefined,
          tools,
          stopWhen: isStepCount(1),
          abortSignal: abortController.signal,
          onChunk: async () => {
            if (streamIdRecorded) return;
            const activeStreams = await syncStreams(ctx, components.agent, {
              threadId: run.threadId,
              streamArgs: { kind: "list" },
            });
            const activeStream = activeStreams?.kind === "list"
              ? activeStreams.messages.find(
                  (message) =>
                    message.order === run.order &&
                    message.status === "streaming",
                )
              : undefined;
            if (!activeStream) return;
            activeStreamStepOrder = activeStream.stepOrder;
            streamIdRecorded = await ctx.runMutation(
              internal.threads.setAgentRunStream,
              {
                runId,
                stepNumber,
                streamId: activeStream.streamId,
                stepOrder: activeStream.stepOrder,
              },
            );
            if (!streamIdRecorded) {
              abortController.abort(new Error("User requested Stop."));
            }
          },
          onToolExecutionStart: async () => {
            toolExecutionMayStart = true;
            const canStartTool = await ctx.runMutation(
              internal.threads.setAgentRunStepPhase,
              { runId, stepNumber, phase: "tool" },
            );
            if (!canStartTool) {
              throw new Error("Agent run stopped before tool execution.");
            }
            toolStepStarted = true;
          },
          onError: async () => {
            const currentRun = await ctx.runQuery(
              internal.threads.getAgentRunInternal,
              { runId },
            );
            if (currentRun?.status !== "stopRequested") {
              await failPendingMessages(
                ctx,
                run.threadId,
                "The AI provider failed before returning a response.",
              );
            }
          },
        },
        {
          saveStreamDeltas: { chunking: "word", throttleMs: 0 },
          storageOptions: { saveMessages: "all" },
        },
      );
    } catch (error) {
      streamFailed = true;
      streamError = error;
    } finally {
      monitorActive = false;
      await stopMonitor;
    }

    if (streamFailed) {
      const currentRun = await ctx.runQuery(
        internal.threads.getAgentRunInternal,
        { runId },
      );
      if (currentRun?.status !== "stopRequested" || toolStepStarted) {
        throw streamError;
      }

      const stepOrder = currentRun.inFlightStepOrder ?? activeStreamStepOrder;
      const savedMessages = stepOrder === undefined
        ? []
        : (await ctx.runQuery(
            components.agent.messages.listMessagesByThreadId,
            {
              threadId: run.threadId,
              paginationOpts: { cursor: null, numItems: 100 },
              order: "desc",
              statuses: ["success", "failed", "pending"],
            },
          )).page.filter(
            (message) =>
              message.order === run.order &&
              message.stepOrder === stepOrder &&
              message.message?.role === "assistant",
          );
      const partialAssistant = savedMessages[0];
      let hasOutput = false;
      if (partialAssistant?.message?.role === "assistant") {
        const assistantMessage = partialAssistant.message;
        const content = typeof assistantMessage.content === "string"
          ? assistantMessage.content
          : assistantMessage.content.filter(
              (part) =>
                part.type === "text" ||
                part.type === "reasoning" ||
                part.type === "file",
            );
        hasOutput = typeof content === "string"
          ? content.trim().length > 0
          : content.some(
              (part) => part.type === "text" && part.text.trim().length > 0,
            );
        if (hasOutput) {
          await ctx.runMutation(components.agent.messages.updateMessage, {
            messageId: partialAssistant._id,
            patch: {
              message: { ...assistantMessage, content },
              status: "success",
              error: undefined,
            },
          });
        } else {
          await ctx.runMutation(components.agent.messages.deleteByIds, {
            messageIds: [partialAssistant._id],
          });
        }
      }

      return {
        model: run.model,
        provider: "AI Gateway",
        order: run.order,
        stepOrder: stepOrder ?? stepNumber,
        hasOutput,
        hasToolCalls: false,
        toolCallIds: [],
        steeringIds: run.inFlightSteeringIds ?? [],
        usage: toUsageObject(undefined),
      };
    }
    if (!result) throw new ConvexError("Agent stream ended without a result.");

    const [outputText, usage, finalStep, steps] = await Promise.all([
      result.text,
      result.usage,
      result.finalStep,
      result.steps,
    ]);
    const lastSavedMessage = result.savedMessages?.at(-1);
    const order = result.order ?? run.order;
    const stepOrder = lastSavedMessage?.stepOrder ?? stepNumber;
    const toolCalls = steps.flatMap((step) => step.toolCalls);
    const usageObject = toUsageObject(usage);
    const toolCallItems = toolCalls.map((call) => ({
      type: "tool-call" as const,
      id: call.toolCallId,
      function: { name: call.toolName, arguments: call.input },
    }));
    const hasUsage =
      usageObject.totalTokens !== undefined ||
      usageObject.inputTokens !== undefined ||
      usageObject.outputTokens !== undefined;
    if (hasUsage || finalStep.providerMetadata || toolCallItems.length > 0) {
      try {
        await ctx.runAction(internal.posthog.captureLlmGeneration, {
          distinctId: String(run.userId),
          traceId: `${run.threadId}:${order}:${stepNumber}`,
          threadId: run.threadId,
          order,
          sessionId: run.threadId,
          model: run.model,
          provider: "AI Gateway",
          output: outputText
            ? [{
                role: "assistant",
                content: [
                  { type: "text", text: outputText },
                  ...toolCallItems,
                ],
              }]
            : toolCallItems.length > 0
              ? [{ role: "assistant", content: toolCallItems }]
              : [],
          usage: usageObject,
          providerMetadata: finalStep.providerMetadata,
        });
      } catch (error) {
        console.error("PostHog LLM capture failed", error);
      }
    }

    return {
      model: run.model,
      provider: "AI Gateway",
      order,
      stepOrder,
      hasOutput: outputText.length > 0,
      hasToolCalls: toolCalls.length > 0,
      toolCallIds: toolCalls.map((call) => call.toolCallId),
      steeringIds: steering.map((note) => note._id),
      usage: usageObject,
      providerMetadata: finalStep.providerMetadata,
    };
  },
});

async function findActiveAgentRun(
  ctx: MutationCtx | QueryCtx,
  threadId: string,
) {
  const [runningRun, stopRequestedRun, pausedRun] = await Promise.all([
    ctx.db
      .query("agentRuns")
      .withIndex("byThreadAndStatus", (q) =>
        q.eq("threadId", threadId).eq("status", "running"),
      )
      .first(),
    ctx.db
      .query("agentRuns")
      .withIndex("byThreadAndStatus", (q) =>
        q.eq("threadId", threadId).eq("status", "stopRequested"),
      )
      .first(),
    ctx.db
      .query("agentRuns")
      .withIndex("byThreadAndStatus", (q) =>
        q.eq("threadId", threadId).eq("status", "paused"),
      )
      .first(),
  ]);
  return runningRun ?? stopRequestedRun ?? pausedRun;
}

async function requestAgentRunStop(ctx: MutationCtx, run: Doc<"agentRuns">) {
  if (run.status !== "running") return run.status;
  await ctx.db.patch(run._id, {
    status: "stopRequested",
    updatedAt: Date.now(),
  });
  if (run.inFlightPhase === "model" && run.inFlightStreamId) {
    await abortStream(ctx, components.agent, {
      streamId: run.inFlightStreamId,
      reason: "User stopped generation",
    }).catch((error) => {
      console.error("Could not abort persisted agent stream", error);
    });
  }
  return "stopRequested" as const;
}

async function startNextQueuedAgentRunForThread(
  ctx: MutationCtx,
  threadId: string,
) {
  if (await findActiveAgentRun(ctx, threadId)) return null;
  const nextRun = await ctx.db
    .query("agentRuns")
    .withIndex("byThreadAndStatus", (q) =>
      q.eq("threadId", threadId).eq("status", "queued"),
    )
    .order("asc")
    .first();
  if (!nextRun) return null;
  if (!nextRun.queuedPrompt) {
    await ctx.db.patch(nextRun._id, {
      status: "failed",
      lastError: "Queued prompt was missing.",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.threads.startNextQueuedAgentRun,
      { threadId },
    );
    return null;
  }

  try {
    await ctx.runMutation(internal.users.usageGateForAgentRun, {
      userId: nextRun.userId,
      model: nextRun.model,
    });
  } catch (error) {
    await ctx.db.patch(nextRun._id, {
      status: "failed",
      lastError: error instanceof Error
        ? error.message
        : "Usage limits blocked the queued agent run.",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.threads.startNextQueuedAgentRun,
      { threadId },
    );
    return null;
  }

  const savedPrompt = await agent.saveMessage(ctx, {
    threadId,
    userId: nextRun.userId,
    message: nextRun.queuedPrompt,
    metadata: nextRun.queuedFileIds
      ? { fileIds: nextRun.queuedFileIds }
      : undefined,
    skipEmbeddings: true,
  });
  await ctx.db.patch(nextRun._id, {
    promptMessageId: savedPrompt.messageId,
    order: savedPrompt.message.order,
    queuedPrompt: undefined,
    queuedFileIds: undefined,
    status: "running",
    updatedAt: Date.now(),
  });

  try {
    await start(
      ctx,
      internal.threads.agentRunWorkflow,
      { runId: nextRun._id },
      {
        startAsync: true,
        onComplete: internal.threads.agentRunWorkflowCompleted,
        context: { runId: nextRun._id },
      },
    );
  } catch (error) {
    await ctx.db.patch(nextRun._id, {
      status: "failed",
      lastError: error instanceof Error
        ? error.message
        : "Could not start the queued agent run.",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.threads.startNextQueuedAgentRun,
      { threadId },
    );
  }
  return nextRun._id;
}

export const startNextQueuedAgentRun = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await startNextQueuedAgentRunForThread(ctx, threadId);
    return null;
  },
});

export const getAgentRunState = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId, true);
    const [activeRun, latestRun, queuedRuns, failedQueuedRuns] = await Promise.all([
      findActiveAgentRun(ctx, threadId),
      ctx.db
        .query("agentRuns")
        .withIndex("byThread", (q) => q.eq("threadId", threadId))
        .order("desc")
        .first(),
      ctx.db
        .query("agentRuns")
        .withIndex("byThreadAndStatus", (q) =>
          q.eq("threadId", threadId).eq("status", "queued"),
        )
        .order("asc")
        .take(20),
      ctx.db
        .query("agentRuns")
        .withIndex("byThreadAndStatus", (q) =>
          q.eq("threadId", threadId).eq("status", "failed"),
        )
        .order("desc")
        .take(20),
    ]);
    const run = activeRun ?? latestRun;
    if (!run && queuedRuns.length === 0) return null;
    const steeringNotes = run
      ? await ctx.db
          .query("agentRunSteering")
          .withIndex("byRun", (q) => q.eq("runId", run._id))
          .order("asc")
          .take(MAX_STEERING_PER_RUN)
      : [];
    return {
      runId: run?._id ?? null,
      status: run?.status ?? "idle",
      stepCount: run?.stepCount ?? 0,
      attemptCount: run?.attemptCount ?? 0,
      inFlightAttempt: run?.inFlightAttempt,
      inFlightStep: run?.inFlightStep,
      inFlightPhase: run?.inFlightPhase,
      updatedAt: run?.updatedAt ?? Date.now(),
      lastError: run?.lastError,
      steeringNotes: steeringNotes
        .map(({ _id, text, status, createdAt }) => ({
          id: _id,
          text,
          status,
          createdAt,
        })),
      queuedRuns: queuedRuns.map((queued) => ({
        runId: queued._id,
        text: typeof queued.queuedPrompt?.content === "string"
          ? queued.queuedPrompt.content
          : queued.queuedPrompt?.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join(""),
        attachmentCount: queued.queuedFileIds?.length ?? 0,
        createdAt: queued.createdAt,
      })),
      failedQueuedRuns: failedQueuedRuns
        .filter((failed) => failed.queuedPrompt !== undefined)
        .map((failed) => ({
          runId: failed._id,
          text: typeof failed.queuedPrompt?.content === "string"
            ? failed.queuedPrompt.content
            : failed.queuedPrompt?.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join(""),
          attachmentCount: failed.queuedFileIds?.length ?? 0,
          lastError: failed.lastError ?? "This queued message could not be sent.",
          createdAt: failed.createdAt,
        })),
    };
  },
});

export const steerThread = mutation({
  args: {
    threadId: v.string(),
    requestId: v.string(),
    instruction: v.string(),
  },
  handler: async (ctx, { threadId, requestId, instruction }) => {
    await authorizeThreadAccess(ctx, threadId, true);
    const run = await findActiveAgentRun(ctx, threadId);
    if (!run) {
      throw new ConvexError("This run has ended. Send the direction as a new message.");
    }
    const existing = await ctx.db
      .query("agentRunSteering")
      .withIndex("byRunAndRequest", (q) =>
        q.eq("runId", run._id).eq("requestId", requestId),
      )
      .unique();
    if (existing) return { status: existing.status, runId: run._id };
    const text = instruction.trim();
    if (!text || text.length > 2_000) {
      throw new ConvexError("Steering must be between 1 and 2,000 characters.");
    }
    if (
      run.status === "completed" ||
      run.status === "failed" ||
      run.stepCount >= MAX_AGENT_STEPS ||
      run.inFlightStep === MAX_AGENT_STEPS
    ) {
      throw new ConvexError("This run has reached its step limit. Send the direction as a new message.");
    }
    const steering = await ctx.db
      .query("agentRunSteering")
      .withIndex("byRun", (q) => q.eq("runId", run._id))
      .take(MAX_STEERING_PER_RUN);
    if (steering.length >= MAX_STEERING_PER_RUN) {
      throw new ConvexError("This run has reached its 20 direction limit. Send the direction as a new message.");
    }
    const now = Date.now();
    const steeringId = await ctx.db.insert("agentRunSteering", {
      runId: run._id,
      requestId,
      text,
      status: "pending",
      createdAt: now,
    });
    await ctx.db.patch(run._id, { updatedAt: now });
    return { status: "pending" as const, runId: run._id, steeringId };
  },
});

export const stopThread = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId, true);
    const run = await findActiveAgentRun(ctx, threadId);
    const status = run
      ? await requestAgentRunStop(ctx, run)
      : "idle";
    return { status };
  },
});

export const resumeThread = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId, true);
    const run = await findActiveAgentRun(ctx, threadId);
    if (!run) {
      throw new ConvexError("No paused agent run is ready to resume.");
    }
    if (run.status === "running") {
      return { status: "running" as const, runId: run._id };
    }
    if (run.status === "stopRequested") {
      return { status: "stopRequested" as const, runId: run._id };
    }
    if (run.status !== "paused" || !run.workflowId) {
      throw new ConvexError("No paused agent run is ready to resume.");
    }
    await sendEvent(ctx, components.workflow, {
      workflowId: run.workflowId as WorkflowId,
      name: "resume",
    });
    await ctx.db.patch(run._id, {
      status: "running",
      updatedAt: Date.now(),
    });
    return { status: "running" as const, runId: run._id };
  },
});

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

const mobileToolValidator = v.object({
  id: v.string(),
  name: v.string(),
  title: v.optional(v.string()),
  // Keep the wire boundary forward-compatible. Swift maps unknown values to
  // an explicit neutral enum case instead of failing the whole subscription.
  status: v.string(),
  inputSummary: v.optional(v.string()),
  output: v.optional(v.string()),
  outputTruncated: v.optional(v.boolean()),
  errorText: v.optional(v.string()),
});

const mobileResponsePartValidator = v.union(
  v.object({
    id: v.string(),
    type: v.union(v.literal("text"), v.literal("reasoning")),
    text: v.string(),
    state: v.union(v.literal("streaming"), v.literal("done")),
  }),
  v.object({
    id: v.string(),
    type: v.literal("source"),
    sourceId: v.string(),
    url: v.string(),
    title: v.optional(v.string()),
  }),
  v.object({
    id: v.string(),
    type: v.literal("tool"),
    tool: mobileToolValidator,
  }),
  // Unknown future part kinds remain decodable and can be ignored by older
  // clients while known fields stay available for diagnostics.
  v.object({
    id: v.string(),
    type: v.string(),
    text: v.optional(v.string()),
    state: v.optional(v.string()),
    sourceId: v.optional(v.string()),
    url: v.optional(v.string()),
    title: v.optional(v.string()),
    tool: v.optional(mobileToolValidator),
  }),
);

const mobileResponseValidator = v.object({
  phase: v.string(),
  parts: v.array(mobileResponsePartValidator),
  tools: v.array(mobileToolValidator),
  errorText: v.optional(v.string()),
});

const mobileMessageValidator = v.object({
  id: v.string(),
  role: v.string(),
  text: v.string(),
  status: v.string(),
  order: v.number(),
  createdAt: v.number(),
  response: v.optional(mobileResponseValidator),
  errorText: v.optional(v.string()),
  attachments: v.optional(v.array(v.object({
    id: v.string(),
    type: v.union(v.literal("image"), v.literal("document")),
    fileName: v.string(),
    mimeType: v.string(),
    url: v.string(),
  }))),
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
 * Agent UIMessage parts are projected into a small ordered presentation model.
 * Swift should not need to mirror the AI SDK's dynamic tool/content union.
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
    computerViewer: v.union(
      v.object({
        sessionId: v.string(),
        viewerUrl: v.optional(v.string()),
        nativeViewerUrl: v.optional(v.string()),
      }),
      v.null(),
    ),
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
        computerViewer: null,
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
        computerViewer: null,
      };
    }
    await authorizeThreadAccess(ctx, threadId, true);

    const paginationOpts = { cursor: null, numItems: 100 };
    const [result, canonicalResult, metadata] = await Promise.all([
      listUIMessages(ctx, components.agent, { threadId, paginationOpts }),
      listMessages(ctx, components.agent, { threadId, paginationOpts }),
      getThreadMetadata(ctx, components.agent, { threadId }),
    ]);
    const liveComputerSession = await ctx.db
      .query("computerUseSessions")
      .withIndex("bySessionKey", (q) => q.eq("sessionKey", String(userId)))
      .unique();
    const liveComputerSessionForThread = getActiveLiveSessionForThread(
      liveComputerSession,
      threadId,
    );
    const errorsByMessageID = new Map<string, string>();
    for (const message of canonicalResult.page) {
      if (message.error) {
        errorsByMessageID.set(message._id, message.error);
      }
    }

    const messages = result.page.map((message) => {
      const errorText = errorsByMessageID.get(message.id);
      const response = message.role === "assistant"
        ? projectStoredResponse(message.parts, message.status, errorText)
        : undefined;
      return {
        id: message.key,
        role: message.role,
        text: message.text,
        status: message.status,
        order: message.order,
        createdAt: message._creationTime,
        ...(response ? { response } : {}),
        ...(errorText ? { errorText } : {}),
        attachments: message.parts.flatMap((part, index) =>
          part.type === "file" && part.url
            ? [{
                id: `${message.key}:attachment:${index}`,
                type: part.mediaType.startsWith("image/") ? "image" as const : "document" as const,
                fileName: part.filename ?? `Attachment ${index + 1}`,
                mimeType: part.mediaType,
                url: part.url,
              }]
            : []
        ),
      };
    });
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
      messages: mergeMobileStreamText(
        messages,
        streamMessages,
        activeDeltas?.kind === "deltas" ? activeDeltas.deltas : [],
        (stream, text) => ({
          id: `stream:${stream.streamId}`,
          role: "assistant",
          text,
          status: "streaming",
          order: stream.order,
          createdAt: messages.find((message) => message.order === stream.order)
            ?.createdAt ?? 0,
          attachments: [],
        }),
      ),
      account: user ? mobileAccount(user) : null,
      remainingMessages: user?.isAnonymous ? (user.trialMessages ?? 0) : null,
      computerViewer: liveComputerSessionForThread,
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
    const { threadId } = await agent.createThread(ctx, { userId, title: "Untitled" });
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

export const renameMobileThread = mutation({
  args: { threadId: v.string(), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, title }) => {
    await authorizeThreadAccess(ctx, threadId, true);
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new ConvexError("Chat title cannot be empty.");
    await agent.updateThreadMetadata(ctx, { threadId, patch: { title: normalizedTitle } });
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
  handler: async (
    ctx,
    { prompt, model, searchEnabled = false, threadId: requestedThreadId, attachments = [] },
  ) => {
    let preparedRunId: Id<"agentRuns"> | undefined;
    try {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Please sign in to continue.");
    }

    const text = prompt.trim();
    if (!text && attachments.length === 0) {
      throw new ConvexError("Your message is empty. Please type something first.");
    }

    // usageGate (above) already enforced tier eligibility and subscription
    // access; this only blocks operationally disabled free models. Premium
    // models are enabled:false by definition, so they must not be caught here.
    if (!isPremiumModel(model) && !isModelEnabled(model)) {
      throw new ConvexError(
        "This model is currently unavailable. Please pick another model.",
      );
    }

    if (requestedThreadId) await authorizeThreadAccess(ctx, requestedThreadId, true);
    const threadId =
      requestedThreadId ?? (await getOrCreateDefaultThread(ctx, userId));

    const modelPrompt = await mobileModelPrompt(ctx, text, attachments);
    const promptMessage: ModelMessage = modelPrompt.kind === "attachments"
      ? modelPrompt.prompt[0]
      : { role: "user", content: modelPrompt.prompt };
    const prepared = await ctx.runMutation(
      internal.threads.createAgentRunWithPrompt,
      {
        threadId,
        userId,
        prompt: promptMessage,
        fileIds: modelPrompt.kind === "attachments"
          ? modelPrompt.fileIds
          : undefined,
        model,
        searchEnabled,
      },
    );
    preparedRunId = prepared.runId;

    await Promise.allSettled(
      attachments.map(({ storageId }) => ctx.storage.delete(storageId)),
    );

    if (!prepared.queued) {
      // Queue admission must not depend on current usage. Recheck when the
      // queued run reaches the front; immediate runs gate before starting.
      await ctx.runMutation(api.users.usageGate, { model });
      await start(
        ctx,
        internal.threads.agentRunWorkflow,
        { runId: prepared.runId },
        {
          startAsync: true,
          onComplete: internal.threads.agentRunWorkflowCompleted,
          context: { runId: prepared.runId },
        },
      );
    }

    return {
      threadId,
      order: prepared.order,
      promptMessageId: prepared.promptMessageId,
      runId: prepared.runId,
      queued: prepared.queued,
    };
    } catch (error) {
      if (preparedRunId) {
        await ctx.runMutation(internal.threads.setAgentRunStatus, {
          runId: preparedRunId,
          status: "failed",
          error: "Could not start the durable agent workflow.",
        }).catch((statusError) => {
          console.error("Failed to mark agent run as failed", statusError);
        });
        const failedRun = await ctx.runQuery(
          internal.threads.getAgentRunInternal,
          { runId: preparedRunId },
        );
        if (failedRun) {
          await ctx.runMutation(
            internal.threads.startNextQueuedAgentRun,
            { threadId: failedRun.threadId },
          ).catch((startError) => {
            console.error("Could not start queued agent run", startError);
          });
        }
      }
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
  attachments: Array<{ storageId: Id<"_storage">; fileName: string; mimeType: string }>,
): Promise<
  | { kind: "text"; prompt: string }
  | { kind: "attachments"; prompt: ModelMessage[]; fileIds: string[] }
> {
  if (!attachments.length) return { kind: "text", prompt: text };

  const content: Exclude<UserContent, string> = text ? [{ type: "text", text }] : [];
  const fileIds: string[] = [];
  for (const attachment of attachments) {
    const blob = await ctx.storage.get(attachment.storageId);
    if (!blob) {
      throw new ConvexError(`Attachment '${attachment.fileName}' was not uploaded.`);
    }
    if (blob.size > 20 * 1024 * 1024) {
      throw new ConvexError(`Attachment '${attachment.fileName}' exceeds 20 MB.`);
    }
    const { file, filePart, imagePart } = await storeFile(
      ctx,
      components.agent,
      blob,
      { filename: attachment.fileName },
    );
    content.push(imagePart ?? filePart);
    fileIds.push(file.fileId);
  }
  return { kind: "attachments", prompt: [{ role: "user", content }], fileIds };
}

export const abortReply = mutation({
  args: {
    threadId: v.string(),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await authorizeThreadAccess(ctx, args.threadId, true);

    const run = await findActiveAgentRun(ctx, args.threadId);
    if (run) {
      const status = await requestAgentRunStop(ctx, run);
      return {
        aborted: status === "stopRequested",
        failedPending: 0,
      };
    }

    const activeStreams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: { kind: "list" },
    });
    const activeOrders = activeStreams?.kind === "list"
      ? activeStreams.messages.map((message) => message.order)
      : [];
    const orders = args.order === undefined
      ? [...new Set(activeOrders)]
      : [args.order];
    let aborted = false;
    for (const order of orders) {
      aborted = await abortStream(ctx, components.agent, {
        threadId: args.threadId,
        order,
        reason: "User stopped generation",
      }) || aborted;
    }

    const pending = await ctx.runQuery(
      components.agent.messages.listMessagesByThreadId,
      {
        threadId: args.threadId,
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
            error: "User stopped generation",
          },
        }),
      ),
    );

    return {
      aborted,
      failedPending: pending.page.length,
    };
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
