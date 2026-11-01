import { z } from "zod";
import type { ComputerToolResult } from "./types";

const captureResult = z.object({
  ok: z.literal(true),
  op: z.literal("screenshot"),
  screenshotId: z.string().regex(/^cu_[a-z0-9_]{8,80}$/i),
  screenshotUrl: z.string().min(1),
  mimeType: z.enum(["image/png", "image/jpeg"]).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  screenshotSessionId: z.string().optional(),
  screenshotCreatedAt: z.number().finite().optional(),
});

export type ScreenshotReference = {
  id: string;
  url: string;
  mimeType?: ComputerToolResult["mimeType"];
  width?: number;
  height?: number;
  sessionId?: string;
  createdAt?: number;
  size?: number;
  availability?: "available" | "unavailable";
};

export type ConsecutiveScreenshotGroup = {
  startIndex: number;
  endIndex: number;
  screenshots: ScreenshotReference[];
};

export type ScreenshotToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  output?: unknown;
};

/** Preserve order while grouping only adjacent successful screenshot calls. */
export function groupConsecutiveScreenshots(
  references: readonly (ScreenshotReference | undefined)[],
): ConsecutiveScreenshotGroup[] {
  const groups: ConsecutiveScreenshotGroup[] = [];
  let index = 0;
  while (index < references.length) {
    const first = references[index];
    if (!first) {
      index += 1;
      continue;
    }
    const startIndex = index;
    const screenshots: ScreenshotReference[] = [];
    while (index < references.length && references[index]) {
      screenshots.push(references[index]!);
      index += 1;
    }
    groups.push({ startIndex, endIndex: index, screenshots });
  }
  return groups;
}

/** Project successful screenshot tool parts into the groups rendered in chat. */
export function computerScreenshotGroups(
  parts: readonly ScreenshotToolPart[],
): ConsecutiveScreenshotGroup[] {
  const references = parts.map((part) => {
    const name = part.toolName ??
      (part.type.startsWith("tool-") ? part.type.slice(5) : part.type);
    if (name !== "computer_screenshot" || part.state !== "output-available") {
      return undefined;
    }

    const reference = screenshotReference(part.output);
    if (!reference) return undefined;
    if (reference.url.startsWith("/") && !reference.url.startsWith("//")) {
      return reference;
    }
    return reference.url.startsWith("https://") ? reference : undefined;
  });
  return groupConsecutiveScreenshots(references);
}

/** Read intrinsic PNG/JPEG dimensions; never substitute a viewport guess. */
export function screenshotDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52) {
    const width = view.getUint32(16), height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return undefined;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
      const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += length;
  }
  return undefined;
}

/** Parse compact JSON from live MCP or persisted multimodal tool output. */
export function screenshotReference(output: unknown): ScreenshotReference | undefined {
  if (typeof output === "string") {
    try { return screenshotReference(JSON.parse(output)); } catch { return undefined; }
  }
  const parsed = captureResult.safeParse(output);
  if (parsed.success) {
    const result = parsed.data;
    return {
      id: result.screenshotId,
      url: result.screenshotUrl,
      ...(result.mimeType ? { mimeType: result.mimeType } : {}),
      ...(result.width ? { width: result.width } : {}),
      ...(result.height ? { height: result.height } : {}),
      ...(result.screenshotSessionId ? { sessionId: result.screenshotSessionId } : {}),
      ...(result.screenshotCreatedAt !== undefined ? { createdAt: result.screenshotCreatedAt } : {}),
    };
  }
  if (!output || typeof output !== "object") return undefined;
  const content = Array.isArray(output) ? output
    : "content" in output ? output.content
    : "type" in output && output.type === "content" && "value" in output ? output.value
    : undefined;
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item) {
      const reference = screenshotReference(item.text);
      if (reference) return reference;
    }
  }
  return undefined;
}
