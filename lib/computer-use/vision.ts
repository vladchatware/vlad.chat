import { getScreenshot } from "./artifacts";
import type { ComputerToolResult } from "./types";

type ComputerToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" };

/** MCP carries pixels separately from the compact JSON rendered by clients. */
export async function computerToolMcpResult(result: ComputerToolResult): Promise<{
  content: ComputerToolContent[];
  isError?: boolean;
}> {
  const expectsScreenshot = result.ok && (result.op === "screenshot" || result.op === "act");
  if (!result.screenshotId && !result.screenshotUrl && !expectsScreenshot) {
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }

  try {
    const screenshot = result.screenshotId
      ? await getScreenshot(result.screenshotId)
      : undefined;
    if (!screenshot) throw new Error("Screenshot expired or unavailable.");
    return {
      content: [
        { type: "text", text: JSON.stringify(result) },
        {
          type: "image",
          data: screenshot.png.toString("base64"),
          mimeType: screenshot.contentType,
        },
      ],
    };
  } catch (error) {
    const failure: ComputerToolResult = {
      ...result,
      ok: false,
      code: "runtime",
      error: `${error instanceof Error ? error.message : "Screenshot delivery failed."} Call computer_screenshot before acting again; the previous action may already have completed.`,
    };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(failure) }],
    };
  }
}

/** Direct AI SDK tools keep UI output as JSON and add pixels only for the model. */
export async function computerToolModelOutput(result: ComputerToolResult) {
  const { content } = await computerToolMcpResult(result);
  return {
    type: "content" as const,
    value: content.map((part) =>
      part.type === "image"
        ? {
            type: "file" as const,
            mediaType: part.mimeType,
            data: { type: "data" as const, data: part.data },
          }
        : part,
    ),
  };
}
