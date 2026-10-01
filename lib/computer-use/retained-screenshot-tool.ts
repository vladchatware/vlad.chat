import type { ToolSet } from "ai";
import { screenshotReference } from "./screenshot-contract";
import { toolOutputText } from "../mobile-stream";

type ScreenshotReplay = {
  content: Array<
    { type: "text"; text: string } |
    { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" }
  >;
};

type Retention = {
  replay: (toolCallId: string) => Promise<ScreenshotReplay | null>;
  retain: (artifactId: string, toolCallId: string, resultJson: string) => Promise<ScreenshotReplay>;
};

/** Only screenshot calls participate; every other tool keeps its existing behavior. */
export function retainedScreenshotTool(tool: ToolSet[string], retention: Retention): ToolSet[string] {
  const execute = tool.execute;
  if (!execute) return tool;
  return {
    ...tool,
    execute: async (input, options) => {
      const prior = await retention.replay(options.toolCallId);
      if (prior) return prior;
      const output = await execute(input, options);
      const screenshot = screenshotReference(output);
      if (!screenshot) return output;
      return retention.retain(screenshot.id, options.toolCallId, toolOutputText(output));
    },
  };
}
