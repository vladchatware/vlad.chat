import {
  generateText,
  gateway,
  streamText,
  type LanguageModelUsage,
  type ProviderMetadata,
} from "ai";
import { fetchMutation } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import { providerSystem } from "@/lib/ai";
import {
  chatCompletionRequestSchema,
  openAiError,
  openAiFinishReason,
  toAiPrompt,
  toAiToolChoice,
  toAiTools,
  type ChatCompletionRequest,
} from "@/lib/openai-compat";
import { PROVIDER_MODEL_IDS } from "@/lib/provider";
import { authenticateProviderRequest } from "@/lib/provider-auth";

export const maxDuration = 300;

export async function POST(request: Request) {
  const authentication = await authenticateProviderRequest(request);
  if (!authentication.ok) return authentication.error;
  if (!authentication.hasCredits) {
    return openAiError(
      "Your vlad.chat credit balance is exhausted. Top up at https://vlad.chat/provider.",
      429,
      "insufficient_quota",
      "insufficient_credits",
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = chatCompletionRequestSchema.safeParse(json);
  if (!parsed.success) {
    return openAiError(
      parsed.error.issues[0]?.message ?? "Invalid request body.",
      400,
      "invalid_request_error",
      "invalid_request",
      parsed.error.issues[0]?.path.join(".") || null,
    );
  }
  if (!PROVIDER_MODEL_IDS.has(parsed.data.model)) {
    return openAiError(
      `Model '${parsed.data.model}' is not available.`,
      404,
      "invalid_request_error",
      "model_not_found",
      "model",
    );
  }

  let prompt;
  try {
    prompt = toAiPrompt(parsed.data.messages);
  } catch (error) {
    return openAiError(
      error instanceof Error ? error.message : "Invalid messages.",
      400,
      "invalid_request_error",
      "invalid_messages",
      "messages",
    );
  }

  const options = generationOptions(parsed.data, prompt, request.signal);
  try {
    if (parsed.data.stream) {
      const result = streamText(options);
      return streamResponse(result, parsed.data, authentication.digest);
    }

    const result = await generateText(options);
    ensureSuccessfulFinish(result.finishReason);
    await settleUsage(
      authentication.digest,
      parsed.data.model,
      result.usage,
      result.finalStep.providerMetadata,
    );
    return completionResponse(parsed.data.model, result);
  } catch (error) {
    return upstreamError(error);
  }
}

function generationOptions(
  request: ChatCompletionRequest,
  prompt: ReturnType<typeof toAiPrompt>,
  abortSignal: AbortSignal,
) {
  return {
    model: gateway.languageModel(request.model),
    instructions: [providerSystem, ...prompt.instructions].join("\n\n"),
    messages: prompt.messages,
    tools: toAiTools(request.tools),
    toolChoice: toAiToolChoice(request.tool_choice),
    temperature: request.temperature,
    topP: request.top_p,
    maxOutputTokens: request.max_completion_tokens ?? request.max_tokens,
    presencePenalty: request.presence_penalty,
    frequencyPenalty: request.frequency_penalty,
    stopSequences: typeof request.stop === "string" ? [request.stop] : request.stop,
    seed: request.seed,
    reasoning: request.reasoning_effort,
    providerOptions: providerOptions(request),
    abortSignal,
  };
}

function providerOptions(request: ChatCompletionRequest) {
  if (
    !request.user &&
    request.parallel_tool_calls === undefined
  ) {
    return undefined;
  }
  const provider = request.model.split("/", 1)[0];
  return {
    ...(request.user ? { gateway: { user: request.user } } : {}),
    ...(request.parallel_tool_calls === undefined
      ? {}
      : { [provider]: { parallelToolCalls: request.parallel_tool_calls } }),
  };
}

function completionResponse(
  model: string,
  result: Awaited<ReturnType<typeof generateText>>,
) {
  const toolCalls = result.toolCalls.map((call) => ({
    id: call.toolCallId,
    type: "function" as const,
    function: {
      name: call.toolName,
      arguments: JSON.stringify(call.input),
    },
  }));

  return Response.json({
    id: `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: result.text || null,
        ...(result.finalStep.reasoningText
          ? { reasoning_content: result.finalStep.reasoningText }
          : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: openAiFinishReason(result.finishReason),
    }],
    usage: openAiUsage(result.usage),
  }, { headers: { "Cache-Control": "no-store" } });
}

function streamResponse(
  result: ReturnType<typeof streamText>,
  request: ChatCompletionRequest,
  digest: string,
) {
  const id = `chatcmpl_${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const toolCallIndexes = new Map<string, number>();
  const encode = (value: object | "[DONE]") =>
    encoder.encode(`data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`);
  const chunk = (delta: object, finishReason: string | null = null) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model: request.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encode(chunk({ role: "assistant" })));
      try {
        for await (const event of result.stream) {
          if (event.type === "text-delta") {
            controller.enqueue(encode(chunk({ content: event.text })));
          }
          if (event.type === "reasoning-delta") {
            controller.enqueue(encode(chunk({ reasoning_content: event.text })));
          }
          if (event.type === "tool-call") {
            const index = toolCallIndexes.get(event.toolCallId) ?? toolCallIndexes.size;
            toolCallIndexes.set(event.toolCallId, index);
            controller.enqueue(encode(chunk({
              tool_calls: [{
                index,
                id: event.toolCallId,
                type: "function",
                function: {
                  name: event.toolName,
                  arguments: JSON.stringify(event.input),
                },
              }],
            })));
          }
          if (event.type === "error") throw event.error;
          if (event.type === "abort") throw new Error(event.reason ?? "Request aborted.");
        }

        const [usage, finishReason, finalStep] = await Promise.all([
          result.usage,
          result.finishReason,
          result.finalStep,
        ]);
        ensureSuccessfulFinish(finishReason);
        await settleUsage(digest, request.model, usage, finalStep.providerMetadata);
        controller.enqueue(encode(chunk({}, openAiFinishReason(finishReason))));
        if (request.stream_options?.include_usage) {
          controller.enqueue(encode({
            id,
            object: "chat.completion.chunk",
            created,
            model: request.model,
            choices: [],
            usage: openAiUsage(usage),
          }));
        }
        controller.enqueue(encode("[DONE]"));
        controller.close();
      } catch (error) {
        closeStreamWithError(controller, encode, error);
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function ensureSuccessfulFinish(finishReason: string) {
  if (finishReason === "error") {
    throw new Error("Upstream model finished with an error.");
  }
}

function closeStreamWithError(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encode: (value: object | "[DONE]") => Uint8Array,
  error: unknown,
) {
  const details = upstreamErrorDetails(error);
  try {
    controller.enqueue(encode({
      error: {
        message: details.message,
        type: details.type,
        param: null,
        code: details.code,
      },
    }));
    controller.enqueue(encode("[DONE]"));
    controller.close();
  } catch {
    // Client disconnected; request abort already stopped upstream generation.
  }
}

async function settleUsage(
  digest: string,
  model: string,
  usage: LanguageModelUsage,
  providerMetadata: ProviderMetadata | undefined,
) {
  await fetchMutation(api.users.recordApiUsage, {
    digest,
    model,
    provider: "AI Gateway",
    usage,
    providerMetadata,
  });
}

function openAiUsage(usage: LanguageModelUsage) {
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: usage.totalTokens ?? promptTokens + completionTokens,
  };
}

function upstreamError(error: unknown) {
  const details = upstreamErrorDetails(error);
  return openAiError(
    details.message,
    details.status,
    details.type,
    details.code,
  );
}

function upstreamErrorDetails(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : undefined;
  const rateLimited =
    statusCode === 429 ||
    message.includes("GatewayRateLimitError") ||
    message.includes("RestrictedModelsError") ||
    message.includes("no_providers_available") ||
    message.toLowerCase().includes("rate limit");

  if (rateLimited) {
    return {
      message: "Vlad.chat is temporarily at AI capacity for this model. Your request was not charged.",
      status: 429,
      type: "rate_limit_error",
      code: "rate_limit_exceeded",
    };
  }
  return {
    message: "AI provider failed before completing request. Your request was not charged.",
    status: 502,
    type: "server_error",
    code: "upstream_error",
  };
}
