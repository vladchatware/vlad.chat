import { toUIMessages } from "@convex-dev/agent";
import type { MessageDoc, StreamMessage } from "@convex-dev/agent/validators";
import { getToolName, isToolUIPart, type UIMessageChunk } from "ai";

export const USER_STOPPED_GENERATION = "User stopped generation";

export type ResponsePhase =
  | "waiting" | "thinking" | "tool" | "responding"
  | "complete" | "stopped" | "failed";
export type MobileTool = {
  id: string;
  name: string;
  status: "running" | "completed" | "failed" | "stopped";
};
export type MobileResponse = {
  phase: ResponsePhase;
  tools: MobileTool[];
  error?: string;
};
export type MobileMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: string;
  order: number;
  createdAt: number;
  response?: MobileResponse;
  attachments: {
    id: string;
    type: "image" | "document";
    fileName: string;
    mimeType: string;
    url: string;
  }[];
};
export type MobileStreamDelta = { streamId: string; start: number; parts: UIMessageChunk[] };
type ResponseStream = Pick<StreamMessage, "streamId" | "order" | "stepOrder" | "status">;

/** Native projection: one stable assistant row per response order, including empty activity. */
export function mobileMessages(
  threadId: string,
  documents: MessageDoc[],
  streams: ResponseStream[],
  deltas: MobileStreamDelta[],
): MobileMessage[] {
  const messages: MobileMessage[] = [];
  const ordered = [...documents].sort((a, b) => a.order - b.order || a.stepOrder - b.stepOrder);
  const uiMessages = toUIMessages(ordered);
  for (const message of uiMessages.filter((message) => message.role === "user")) {
    messages.push({
      id: message.key, role: "user", text: message.text, status: message.status,
      order: message.order, createdAt: message._creationTime,
      attachments: message.parts.flatMap((part, index) => part.type === "file" ? [{
        id: `${message.key}:attachment:${index}`,
        type: part.mediaType.startsWith("image/") ? "image" as const : "document" as const,
        fileName: part.filename ?? `Attachment ${index + 1}`,
        mimeType: part.mediaType, url: part.url,
      }] : []),
    });
  }

  const orders = new Set([
    ...ordered.filter((doc) => doc.message?.role !== "user" && doc.message?.role !== "system").map((doc) => doc.order),
    ...streams.map((stream) => stream.order),
  ]);
  for (const order of orders) {
    const docs = ordered.filter((doc) => doc.order === order && doc.message?.role !== "user" && doc.message?.role !== "system");
    const last = docs.at(-1);
    const responseStreams = streams.filter((stream) => stream.order === order)
      .sort((a, b) => a.stepOrder - b.stepOrder);
    // Persisted terminal state wins over delayed stream snapshots.
    const terminal = last?.status === "failed" ||
      (last?.status === "success" && (responseStreams.length === 0 || (!last.tool && last.message?.role === "assistant")));
    const liveStreams = terminal ? [] : responseStreams;
    const firstStreamStep = liveStreams[0]?.stepOrder ?? Infinity;
    const saved = toUIMessages(docs.filter((doc) => doc.stepOrder < firstStreamStep));
    let text = saved.map((message) => message.text).join("");
    const tools = new Map<string, MobileTool>();
    for (const message of saved) {
      for (const part of message.parts) {
        if (isToolUIPart(part)) {
          tools.set(part.toolCallId, {
            id: part.toolCallId, name: getToolName(part),
            status: part.state === "output-available" ? "completed"
              : part.state === "output-error" || part.state === "output-denied" ? "failed" : "running",
          });
        }
      }
    }
    let phase: ResponsePhase = last?.status === "failed"
      ? last.error === USER_STOPPED_GENERATION ? "stopped" : "failed"
      : terminal ? "complete" : "waiting";
    const updateTool = (id: string, status: MobileTool["status"], name?: string) => {
      const existing = tools.get(id);
      tools.set(id, { id, name: name ?? existing?.name ?? "Tool", status });
    };
    for (const stream of liveStreams) {
      phase = "waiting";
      const parts = deltas.filter((delta) => delta.streamId === stream.streamId)
        .sort((a, b) => a.start - b.start).flatMap((delta) => delta.parts);
      for (const part of parts) {
        switch (part.type) {
          case "text-delta": text += part.delta; phase = "responding"; break;
          case "reasoning-start":
          case "reasoning-delta": phase = "thinking"; break;
          case "text-end":
          case "reasoning-end":
          case "start-step":
          case "finish-step": phase = "waiting"; break;
          case "tool-input-start":
          case "tool-input-available":
            updateTool(part.toolCallId, "running", part.toolName); phase = "tool"; break;
          case "tool-input-error":
            updateTool(part.toolCallId, "failed", part.toolName); phase = "waiting"; break;
          case "tool-output-available":
            updateTool(part.toolCallId, "completed"); phase = "waiting"; break;
          case "tool-output-error":
          case "tool-output-denied":
            updateTool(part.toolCallId, "failed"); phase = "waiting"; break;
          case "abort": phase = "stopped"; break;
          case "error": phase = "failed"; break;
          // Completion is acknowledged by the persisted message, not a finish chunk.
        }
      }
      if (stream.status === "aborted") phase = "failed";
    }
    const active = phase !== "complete" && phase !== "failed" && phase !== "stopped";
    if (active && [...tools.values()].some((tool) => tool.status === "running")) phase = "tool";
    if (!active) {
      for (const tool of tools.values()) {
        if (tool.status === "running") tool.status = phase === "stopped" ? "stopped" : "failed";
      }
    }
    messages.push({
      id: `${threadId}:assistant:${order}`, role: "assistant", text,
      status: active ? "streaming" : phase === "complete" ? "success" : "failed",
      order, createdAt: docs[0]?._creationTime ?? ordered.find((doc) => doc.order === order)?._creationTime ?? 0,
      attachments: [],
      response: {
        phase, tools: [...tools.values()],
        ...(phase === "failed" ? { error: "Response failed. Please try again." } : {}),
      },
    });
  }
  return messages.sort((a, b) => a.order - b.order || (a.role === "user" ? -1 : 1));
}

/** Persist only text not already saved by earlier steps, even when delta batching lags. */
export function unfinishedMobileText(
  documents: MessageDoc[], stream: ResponseStream, deltas: MobileStreamDelta[],
): string {
  const savedText = [...documents]
    .filter((doc) => doc.order === stream.order && doc.stepOrder >= stream.stepOrder && doc.status === "success")
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .flatMap((doc) => {
      if (doc.message?.role !== "assistant") return [];
      const content = doc.message.content;
      return typeof content === "string" ? [content]
        : content.filter((part) => part.type === "text").map((part) => part.text);
    }).join("");
  const streamedText = deltas.filter((delta) => delta.streamId === stream.streamId)
    .sort((a, b) => a.start - b.start).flatMap((delta) => delta.parts)
    .filter((part) => part.type === "text-delta").map((part) => part.delta).join("");
  return streamedText.startsWith(savedText) ? streamedText.slice(savedText.length) : "";
}
