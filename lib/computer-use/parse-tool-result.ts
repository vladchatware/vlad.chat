import type { ComputerToolResult } from "./types";

type McpTextItem = { type?: string; text?: string };

/**
 * Normalize MCP / AI-SDK tool output into ComputerToolResult.
 * Accepts: already-parsed object, JSON string, or MCP
 * `{ content: [{ type: "text", text: "{...}" }] }`.
 */
export function parseComputerToolResult(
  output: unknown,
): ComputerToolResult | null {
  const candidate = unwrapToolOutput(output);
  if (candidate == null) return null;

  let value: unknown = candidate;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.ok !== "boolean" || typeof obj.op !== "string") return null;

  return value as ComputerToolResult;
}

function unwrapToolOutput(output: unknown): unknown {
  if (
    typeof output === "object" &&
    output !== null &&
    "content" in output &&
    Array.isArray((output as { content?: unknown }).content)
  ) {
    const content = (output as { content: McpTextItem[] }).content;
    const text = content
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return output;
}

export function isComputerToolName(name: string | undefined | null): boolean {
  if (!name) return false;
  return name === "computer" || name.startsWith("computer_");
}
