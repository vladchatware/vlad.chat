import { isToolUIPart } from "ai";
import type {
  UIMessageChunk,
  UIMessagePart,
  UIDataTypes,
  UITools,
} from "ai";

export type ResponsePhase =
  | "waiting"
  | "thinking"
  | "tool"
  | "responding"
  | "complete"
  | "stopped"
  | "failed";

export type MobileToolStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export type MobileTool = {
  id: string;
  name: string;
  status: MobileToolStatus;
  title?: string;
  inputSummary?: string;
  /** Streamed tool result text, already truncated to MAX_TOOL_OUTPUT_CHARS. */
  output?: string;
  outputTruncated?: boolean;
  errorText?: string;
};

export type MobileTextPart = {
  id: string;
  type: "text" | "reasoning";
  text: string;
  state: "streaming" | "done";
};

export type MobileSourcePart = {
  id: string;
  type: "source";
  sourceId: string;
  url: string;
  title?: string;
};

export type MobileToolPart = {
  id: string;
  type: "tool";
  tool: MobileTool;
};

export type MobileResponsePart =
  | MobileTextPart
  | MobileSourcePart
  | MobileToolPart;

export type MobileResponse = {
  phase: ResponsePhase;
  /** Ordered, provider-independent presentation parts. */
  parts: MobileResponsePart[];
  /** Compatibility projection for clients that only render tool rows. */
  tools: MobileTool[];
  errorText?: string;
};

export type MobileMessage = {
  id: string;
  role: string;
  text: string;
  status: string;
  order: number;
  createdAt: number;
  response?: MobileResponse;
  errorText?: string;
  attachments?: MobileAttachment[];
};

type MobileAttachment = {
  id: string;
  type: "image" | "document";
  fileName: string;
  mimeType: string;
  url: string;
};

type ActiveStream = {
  streamId: string;
  order: number;
  stepOrder: number;
};

type StreamDelta = {
  streamId: string;
  start: number;
  parts: UIMessageChunk[];
};

/** Upper bound for tool result text carried to the native client. */
export const MAX_TOOL_OUTPUT_CHARS = 4000;

export function truncateToolOutput(text: string): string {
  return text.length <= MAX_TOOL_OUTPUT_CHARS
    ? text
    : `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}…`;
}

/** Mirrors the web client's extraction of text from a tool result payload. */
export function toolOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (output && typeof output === "object") {
    const content = (output as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (item): item is { type?: unknown; text?: unknown } =>
            typeof item === "object" && item !== null,
        )
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text as string)
        .join("\n")
        .trim();
      if (text) {
        return text;
      }
    }
    try {
      return JSON.stringify(output);
    } catch {
      return "";
    }
  }
  return output == null ? "" : String(output);
}

type OrderState = {
  text: string;
  phase: ResponsePhase;
  tools: Map<string, MobileTool>;
  parts: MobileResponsePart[];
  errorText?: string;
};

function createOrderState(): OrderState {
  return { text: "", phase: "waiting", tools: new Map(), parts: [] };
}

function upsertToolPart(state: OrderState, tool: MobileTool) {
  const existing = state.tools.get(tool.id);
  const nextTool = {
    ...tool,
    name: tool.name || existing?.name || "Tool",
    output: tool.output ?? existing?.output,
    outputTruncated: tool.outputTruncated ?? existing?.outputTruncated,
    errorText: tool.errorText ?? existing?.errorText,
    inputSummary: tool.inputSummary ?? existing?.inputSummary,
    title: tool.title ?? existing?.title,
  } satisfies MobileTool;
  state.tools.set(tool.id, nextTool);

  const partIndex = state.parts.findIndex(
    (part): part is MobileToolPart => part.type === "tool" && part.id === tool.id,
  );
  const nextPart: MobileToolPart = { id: tool.id, type: "tool", tool: nextTool };
  if (partIndex === -1) {
    state.parts.push(nextPart);
  } else {
    state.parts[partIndex] = nextPart;
  }
}

function hasOpenTools(state: OrderState): boolean {
  return [...state.tools.values()].some(
    (tool) => tool.status === "pending" || tool.status === "running",
  );
}

function settleOpenTools(
  state: OrderState,
  status: Extract<MobileToolStatus, "failed" | "stopped">,
  errorText?: string,
) {
  for (const tool of state.tools.values()) {
    if (tool.status !== "pending" && tool.status !== "running") {
      continue;
    }
    upsertToolPart(state, {
      ...tool,
      status,
      ...(tool.errorText || !errorText ? {} : { errorText }),
    });
  }
}

function upsertTextPart(
  state: OrderState,
  type: MobileTextPart["type"],
  id: string,
  text: string,
  partState: MobileTextPart["state"],
) {
  const partId = `${type}:${id}`;
  const partIndex = state.parts.findIndex(
    (part): part is MobileTextPart => part.type === type && part.id === partId,
  );
  const nextPart: MobileTextPart = {
    id: partId,
    type,
    text,
    state: partState,
  };
  if (partIndex === -1) {
    state.parts.push(nextPart);
  } else {
    state.parts[partIndex] = nextPart;
  }
}

function appendTextPart(
  state: OrderState,
  type: MobileTextPart["type"],
  id: string,
  delta: string,
) {
  const partId = `${type}:${id}`;
  const existing = state.parts.find(
    (part): part is MobileTextPart => part.type === type && part.id === partId,
  );
  upsertTextPart(state, type, id, `${existing?.text ?? ""}${delta}`, "streaming");
}

function addSourcePart(
  state: OrderState,
  sourceId: string,
  url: string,
  title?: string,
) {
  if (state.parts.some((part) => part.type === "source" && part.id === sourceId)) {
    return;
  }
  state.parts.push({ id: sourceId, type: "source", sourceId, url, title });
}

function storedPartID(state: OrderState, type: MobileTextPart["type"]): string {
  const index = state.parts.filter((part) => part.type === type).length;
  return `stored:${type}:${index}`;
}

function summarizeToolInput(input: unknown): string | undefined {
  if (typeof input === "string") {
    return input.trim() || undefined;
  }
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  for (const key of ["query", "searchQuery", "url", "title"]) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key].trim();
    }
  }

  const scalarFields = Object.entries(record)
    .filter(([, value]) =>
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean",
    )
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");

  return scalarFields ? scalarFields.slice(0, 500) : undefined;
}

function toolOutputFields(output: unknown): Pick<MobileTool, "output" | "outputTruncated"> {
  const text = toolOutputText(output);
  return {
    output: truncateToolOutput(text),
    outputTruncated: text.length > MAX_TOOL_OUTPUT_CHARS,
  };
}

/**
 * Folds a single stream chunk into the response state for its order.
 *
 * Tool activity carries display-safe metadata and a bounded result preview,
 * mirroring the web client's visible states without leaking provider-specific
 * inputs wholesale.
 */
function applyPart(state: OrderState, part: UIMessageChunk) {
  switch (part.type) {
    case "text-start":
      upsertTextPart(state, "text", part.id, "", "streaming");
      break;
    case "text-delta":
      state.text += part.delta;
      state.phase = "responding";
      appendTextPart(state, "text", part.id, part.delta);
      break;
    case "text-end": {
      const existing = state.parts.find(
        (candidate): candidate is MobileTextPart =>
          candidate.type === "text" && candidate.id === `text:${part.id}`,
      );
      upsertTextPart(state, "text", part.id, existing?.text ?? "", "done");
      break;
    }
    case "reasoning-start":
      upsertTextPart(state, "reasoning", part.id, "", "streaming");
      state.phase = "thinking";
      break;
    case "reasoning-delta":
      appendTextPart(state, "reasoning", part.id, part.delta);
      if (!state.text) state.phase = "thinking";
      break;
    case "reasoning-end": {
      const existing = state.parts.find(
        (candidate): candidate is MobileTextPart =>
          candidate.type === "reasoning" && candidate.id === `reasoning:${part.id}`,
      );
      upsertTextPart(state, "reasoning", part.id, existing?.text ?? "", "done");
      break;
    }
    case "start-step":
      if (!state.text && !hasOpenTools(state)) {
        state.phase = "thinking";
      }
      break;
    case "finish-step":
      break;
    case "tool-input-start":
      upsertToolPart(state, {
        id: part.toolCallId,
        name: part.toolName,
        status: "pending",
        title: part.title,
      });
      state.phase = "tool";
      break;
    case "tool-input-available":
      upsertToolPart(state, {
        id: part.toolCallId,
        name: part.toolName,
        status: "running",
        inputSummary: summarizeToolInput(part.input),
        title: part.title,
      });
      state.phase = "tool";
      break;
    case "tool-input-error":
      upsertToolPart(state, {
        id: part.toolCallId,
        name: part.toolName,
        status: "failed",
        inputSummary: summarizeToolInput(part.input),
        errorText: part.errorText,
        title: part.title,
      });
      state.phase = "failed";
      break;
    case "tool-output-available":
      upsertToolPart(state, {
        id: part.toolCallId,
        name: state.tools.get(part.toolCallId)?.name ?? "Tool",
        status: part.preliminary ? "running" : "completed",
        ...toolOutputFields(part.output),
      });
      state.phase = part.preliminary ? "tool" : state.text ? "responding" : "tool";
      break;
    case "tool-output-error":
      upsertToolPart(state, {
        id: part.toolCallId,
        name: state.tools.get(part.toolCallId)?.name ?? "Tool",
        status: "failed",
        errorText: part.errorText,
      });
      state.phase = "failed";
      break;
    case "tool-output-denied":
      upsertToolPart(state, {
        id: part.toolCallId,
        name: state.tools.get(part.toolCallId)?.name ?? "Tool",
        status: "failed",
        errorText: "Tool use was denied.",
      });
      state.phase = "failed";
      break;
    case "source-url":
      addSourcePart(state, part.sourceId, part.url, part.title);
      break;
    case "abort":
      state.phase = "stopped";
      state.errorText = part.reason ?? "Generation stopped.";
      settleOpenTools(state, "stopped", state.errorText);
      break;
    case "error":
      state.phase = "failed";
      state.errorText = part.errorText;
      settleOpenTools(state, "failed", state.errorText ?? "Generation failed.");
      break;
    case "finish":
      if (hasOpenTools(state)) {
        state.phase = "failed";
        state.errorText ??= "Tool did not return a final result.";
        settleOpenTools(state, "failed", state.errorText);
      } else if (state.phase !== "failed" && state.phase !== "stopped") {
        state.phase = "complete";
      }
      break;
    default:
      break;
  }
}

function responseFor(state: OrderState): MobileResponse {
  const tools = [...state.tools.values()];
  let phase = state.phase;
  if (
    !state.text &&
    phase !== "stopped" &&
    phase !== "failed" &&
    tools.some((tool) => tool.status === "running")
  ) {
    phase = "tool";
  }
  return {
    phase,
    parts: state.parts,
    tools,
    ...(state.errorText ? { errorText: state.errorText } : {}),
  };
}

type MobileUIMessagePart = UIMessagePart<UIDataTypes, UITools>;
type MobileToolUIPart = Extract<MobileUIMessagePart, { toolCallId: string }>;

function toolName(part: MobileToolUIPart): string {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
}

function projectStoredPart(state: OrderState, part: MobileUIMessagePart) {
  switch (part.type) {
    case "text":
      state.text += part.text;
      if (state.phase !== "failed" && state.phase !== "stopped") {
        state.phase = "responding";
      }
      upsertTextPart(state, "text", storedPartID(state, "text"), part.text, part.state ?? "done");
      return;
    case "reasoning":
      if (!state.text && state.phase !== "failed" && state.phase !== "stopped") {
        state.phase = "thinking";
      }
      upsertTextPart(state, "reasoning", storedPartID(state, "reasoning"), part.text, part.state ?? "done");
      return;
    case "source-url":
      addSourcePart(state, part.sourceId, part.url, part.title);
      return;
    default:
      if (isToolUIPart(part)) {
        const toolPart = part as MobileToolUIPart;
        const hasInput = "input" in toolPart;
        const hasOutput = "output" in toolPart;
        const hasError = "errorText" in toolPart;
        const status: MobileToolStatus =
          toolPart.state === "input-streaming" ? "pending" :
          toolPart.state === "input-available" ||
          toolPart.state === "approval-requested" ||
          toolPart.state === "approval-responded" ? "running" :
          toolPart.state === "output-available" ? "completed" : "failed";
        const output = hasOutput ? toolPart.output : undefined;
        upsertToolPart(state, {
          id: toolPart.toolCallId,
          name: toolName(toolPart),
          status,
          title: toolPart.title,
          inputSummary: hasInput ? summarizeToolInput(toolPart.input) : undefined,
          ...(hasOutput ? toolOutputFields(output) : {}),
          errorText: hasError ? toolPart.errorText : undefined,
        });
        if (status !== "failed" && state.phase !== "failed" && state.phase !== "stopped") {
          state.phase = "tool";
        }
        if (status === "failed") {
          state.phase = "failed";
          state.errorText ??= toolPart.errorText ?? "Tool failed.";
        }
      }
  }
}

/** Projects persisted UI message parts through the same contract as live deltas. */
export function projectStoredResponse(
  parts: readonly MobileUIMessagePart[],
  status: string,
  errorText?: string,
): MobileResponse {
  const state = createOrderState();
  for (const part of parts) {
    projectStoredPart(state, part);
  }
  if (status === "failed") {
    state.phase = "failed";
    settleOpenTools(state, "failed", errorText ?? "Generation failed.");
  } else if (status === "stopped") {
    state.phase = "stopped";
    settleOpenTools(state, "stopped", errorText ?? "Generation stopped.");
  } else if (status === "success" && hasOpenTools(state)) {
    state.phase = "failed";
    state.errorText ??= "Tool did not return a final result.";
    settleOpenTools(state, "failed", state.errorText);
  } else if (
    status === "success" &&
    state.phase !== "failed" &&
    state.phase !== "stopped"
  ) {
    state.phase = "complete";
  }
  state.errorText = errorText ?? state.errorText ?? (status === "failed" ? "Generation failed." : undefined);
  return responseFor(state);
}

/** Hydrates pending assistant rows from active stream deltas. */
export function mergeMobileStreamText(
  messages: MobileMessage[],
  streams: ActiveStream[],
  deltas: StreamDelta[],
  createStreamingMessage?: (stream: ActiveStream, text: string) => MobileMessage,
): MobileMessage[] {
  const deltasByStream = new Map<string, StreamDelta[]>();
  for (const delta of deltas) {
    const existing = deltasByStream.get(delta.streamId);
    if (existing) {
      existing.push(delta);
    } else {
      deltasByStream.set(delta.streamId, [delta]);
    }
  }

  const sortedStreams = [...streams].sort(
    (left, right) => left.order - right.order || left.stepOrder - right.stepOrder,
  );
  const states = new Map<number, OrderState>();
  const firstStreamByOrder = new Map<number, ActiveStream>();
  for (const stream of sortedStreams) {
    if (!firstStreamByOrder.has(stream.order)) {
      firstStreamByOrder.set(stream.order, stream);
    }
    let state = states.get(stream.order);
    if (!state) {
      state = createOrderState();
      states.set(stream.order, state);
    }
    const parts = (deltasByStream.get(stream.streamId) ?? [])
      .slice()
      .sort((left, right) => left.start - right.start)
      .flatMap((delta) => delta.parts);
    for (const part of parts) {
      applyPart(state, part);
    }
    // A durable stream row is created before provider output is available.
    // Keep that interval visible as active thinking instead of exposing the
    // transport's internal waiting state to the native client.
    if (state.phase === "waiting") {
      state.phase = "thinking";
    }
  }

  const merged = messages.map((message) => {
    const state = states.get(message.order);
    if (message.role !== "assistant" || !state) {
      return message;
    }

    if (message.status === "pending" || message.status === "streaming") {
      return {
        ...message,
        text: state.text,
        status: "streaming",
        response: responseFor(state),
        ...(state.errorText ? { errorText: state.errorText } : {}),
      };
    }

    // A terminal message can become visible just before its stored response
    // projection catches up with the final stream snapshot. Carry over any
    // completed stream parts only when the streamed answer exactly matches the
    // durable text, so stale deltas can never overwrite a finished response.
    if (message.status === "success" && state.phase === "complete" && state.text === message.text) {
      const streamed = responseFor(state);
      const stored = message.response;
      const storedParts = stored?.parts ?? [];
      const matchedStoredPartIds = new Set<string>();
      let hasStreamOnlyParts = false;
      const completedParts = streamed.parts.flatMap((streamPart) => {
        const storedPart = storedParts.find((candidate) => {
          if (matchedStoredPartIds.has(candidate.id)) return false;
          if (candidate.id === streamPart.id) return true;
          if (candidate.type === "text" && streamPart.type === "text") return candidate.text === streamPart.text;
          if (candidate.type === "reasoning" && streamPart.type === "reasoning") return candidate.text === streamPart.text;
          if (candidate.type === "tool" && streamPart.type === "tool") return candidate.tool.id === streamPart.tool.id;
          if (candidate.type === "source" && streamPart.type === "source") {
            return candidate.sourceId === streamPart.sourceId && candidate.url === streamPart.url;
          }
          return false;
        });
        if (storedPart) {
          matchedStoredPartIds.add(storedPart.id);
          return [storedPart];
        }
        // The stored message text is authoritative. If it already has text
        // parts, don't append an equivalent streamed part under a generated ID.
        if (streamPart.type === "text" && storedParts.some((part) => part.type === "text")) {
          return [];
        }
        hasStreamOnlyParts = true;
        return [streamPart];
      });
      completedParts.push(...storedParts.filter((part) => !matchedStoredPartIds.has(part.id)));
      if (hasStreamOnlyParts) {
        return {
          ...message,
          response: {
            phase: stored?.phase ?? "complete",
            parts: completedParts,
            tools: stored?.tools ?? streamed.tools,
            ...(stored?.errorText ? { errorText: stored.errorText } : {}),
          },
        };
      }
    }

    return message;
  });

  for (const [order, state] of states) {
    const hasAssistantMessage = merged.some(
      (message) => message.order === order && message.role === "assistant",
    );
    const stream = firstStreamByOrder.get(order);
    if (!hasAssistantMessage && stream) {
      const prompt = merged.find(
        (message) => message.order === order && message.role === "user",
      );
      const assistant = {
        ...(createStreamingMessage?.(stream, state.text) ?? {
          id: `stream:${stream.streamId}`,
          role: "assistant",
          text: state.text,
          status: "streaming",
          order,
          createdAt: prompt?.createdAt ?? 0,
          attachments: [],
        }),
        response: responseFor(state),
        ...(state.errorText ? { errorText: state.errorText } : {}),
      } satisfies MobileMessage;
      const insertionIndex = merged.findIndex((message) => message.order > order);
      if (insertionIndex === -1) {
        merged.push(assistant);
      } else {
        merged.splice(insertionIndex, 0, assistant);
      }
    }
  }
  return merged;
}
