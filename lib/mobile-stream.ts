import type { UIMessageChunk } from "ai";

export type MobileMessage = {
  id: string;
  role: string;
  text: string;
  status: string;
  order: number;
  createdAt: number;
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

/** Replaces pending assistant snapshots with text from active delta streams. */
export function mergeMobileStreamText<MESSAGE extends MobileMessage>(
  messages: MESSAGE[],
  streams: ActiveStream[],
  deltas: StreamDelta[],
  createStreamingMessage: (stream: ActiveStream, text: string) => MESSAGE,
): MESSAGE[];
export function mergeMobileStreamText(
  messages: MobileMessage[],
  streams: ActiveStream[],
  deltas: StreamDelta[],
): MobileMessage[];
export function mergeMobileStreamText(
  messages: MobileMessage[],
  streams: ActiveStream[],
  deltas: StreamDelta[],
  createStreamingMessage?: (stream: ActiveStream, text: string) => MobileMessage,
): MobileMessage[] {
  const textByStreamId = new Map<string, string>();
  for (const delta of [...deltas].sort((left, right) => left.start - right.start)) {
    const text = delta.parts
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join("");
    textByStreamId.set(
      delta.streamId,
      `${textByStreamId.get(delta.streamId) ?? ""}${text}`,
    );
  }

  const textByOrder = new Map<number, string>();
  const firstStreamByOrder = new Map<number, ActiveStream>();
  for (const stream of [...streams].sort(
    (left, right) => left.order - right.order || left.stepOrder - right.stepOrder,
  )) {
    if (!firstStreamByOrder.has(stream.order)) {
      firstStreamByOrder.set(stream.order, stream);
    }
    textByOrder.set(
      stream.order,
      `${textByOrder.get(stream.order) ?? ""}${textByStreamId.get(stream.streamId) ?? ""}`,
    );
  }

  const merged = messages.map((message) => {
    const streamedText = textByOrder.get(message.order);
    if (
      message.role !== "assistant" ||
      message.status !== "pending" ||
      streamedText === undefined
    ) {
      return message;
    }
    return { ...message, text: streamedText, status: "streaming" };
  });

  for (const [order, text] of textByOrder) {
    const hasAssistantMessage = merged.some(
      (message) => message.order === order && message.role === "assistant",
    );
    const stream = firstStreamByOrder.get(order);
    if (!hasAssistantMessage && stream && text) {
      const prompt = merged.find(
        (message) => message.order === order && message.role === "user",
      );
      merged.push(
        createStreamingMessage?.(stream, text) ?? {
          id: `stream:${stream.streamId}`,
          role: "assistant",
          text,
          status: "streaming",
          order,
          createdAt: prompt?.createdAt ?? 0,
        },
      );
    }
  }
  return merged;
}
