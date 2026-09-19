import type { UIMessageChunk } from "ai";

export type ResponsePhase =
  | "waiting"
  | "thinking"
  | "tool"
  | "responding"
  | "complete"
  | "stopped"
  | "failed";

export type MobileToolStatus = "running" | "completed" | "failed" | "stopped";

export type MobileTool = {
  id: string;
  name: string;
  status: MobileToolStatus;
  /** Streamed tool result text, already truncated to MAX_TOOL_OUTPUT_CHARS. */
  output?: string;
};

export type MobileResponse = {
  phase: ResponsePhase;
  tools: MobileTool[];
};

export type MobileMessage = {
  id: string;
  role: string;
  text: string;
  status: string;
  order: number;
  createdAt: number;
  response?: MobileResponse;
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
};

function setTool(state: OrderState, tool: MobileTool) {
  const existing = state.tools.get(tool.id);
  state.tools.set(tool.id, {
    ...tool,
    name: tool.name || existing?.name || "Tool",
    output: tool.output ?? existing?.output,
  });
}

/**
 * Folds a single stream chunk into the response state for its order.
 *
 * Tool activity intentionally carries only a name, status and (truncated)
 * result text, mirroring the web client's projection without leaking
 * provider-specific inputs.
 */
function applyPart(state: OrderState, part: UIMessageChunk) {
  switch (part.type) {
    case "text-delta":
      state.text += part.delta;
      state.phase = "responding";
      break;
    case "reasoning-start":
    case "reasoning-delta":
      if (!state.text) state.phase = "thinking";
      break;
    case "reasoning-end":
    case "text-end":
    case "start-step":
    case "finish-step":
      if (!state.text) state.phase = "waiting";
      break;
    case "tool-input-start":
    case "tool-input-available":
      setTool(state, { id: part.toolCallId, name: part.toolName, status: "running" });
      if (!state.text) state.phase = "tool";
      break;
    case "tool-input-error":
      setTool(state, { id: part.toolCallId, name: part.toolName, status: "failed" });
      if (!state.text) state.phase = "waiting";
      break;
    case "tool-output-available":
      setTool(state, {
        id: part.toolCallId,
        name: state.tools.get(part.toolCallId)?.name ?? "Tool",
        status: part.preliminary ? "running" : "completed",
        output: truncateToolOutput(toolOutputText(part.output)),
      });
      if (!state.text) state.phase = "waiting";
      break;
    case "tool-output-error":
    case "tool-output-denied":
      setTool(state, {
        id: part.toolCallId,
        name: state.tools.get(part.toolCallId)?.name ?? "Tool",
        status: "failed",
      });
      if (!state.text) state.phase = "waiting";
      break;
    case "abort":
      state.phase = "stopped";
      break;
    case "error":
      state.phase = "failed";
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
  return { phase, tools };
}

/** Hydrates pending assistant rows from active stream deltas. */
export function mergeMobileStreamText(
  messages: MobileMessage[],
  streams: ActiveStream[],
  deltas: StreamDelta[],
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
      state = { text: "", phase: "waiting", tools: new Map() };
      states.set(stream.order, state);
    }
    const parts = (deltasByStream.get(stream.streamId) ?? [])
      .slice()
      .sort((left, right) => left.start - right.start)
      .flatMap((delta) => delta.parts);
    for (const part of parts) {
      applyPart(state, part);
    }
  }

  const merged = messages.map((message) => {
    const state = states.get(message.order);
    if (message.role !== "assistant" || !state || message.status !== "pending") {
      return message;
    }
    return {
      ...message,
      text: state.text,
      status: "streaming",
      response: responseFor(state),
    };
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
      merged.push({
        id: `stream:${stream.streamId}`,
        role: "assistant",
        text: state.text,
        status: "streaming",
        order,
        createdAt: prompt?.createdAt ?? 0,
        response: responseFor(state),
      });
    }
  }
  return merged;
}
