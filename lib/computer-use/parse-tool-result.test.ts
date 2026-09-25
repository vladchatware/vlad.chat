import { describe, expect, it } from "vitest";
import {
  isComputerToolName,
  parseComputerToolResult,
} from "./parse-tool-result";
import type { ComputerToolResult } from "./types";

const fixture: ComputerToolResult = {
  ok: true,
  op: "screenshot",
  screenshotUrl: "/api/computer-use/screenshots/cu_test",
  screenshotId: "cu_test",
  mimeType: "image/png",
  width: 1280,
  height: 720,
  budget: {
    stepsUsed: 2,
    stepsRemaining: 18,
    maxSteps: 20,
    ttlMs: 480_000,
    elapsedMs: 12_000,
    note: "ok",
  },
};

describe("parseComputerToolResult", () => {
  it("parses a plain object", () => {
    expect(parseComputerToolResult(fixture)).toEqual(fixture);
  });

  it("parses a JSON string", () => {
    expect(parseComputerToolResult(JSON.stringify(fixture))).toEqual(fixture);
  });

  it("parses MCP text content wrapper", () => {
    const mcp = {
      content: [{ type: "text", text: JSON.stringify(fixture) }],
    };
    expect(parseComputerToolResult(mcp)).toEqual(fixture);
  });

  it("parses handoff results", () => {
    const handoff: ComputerToolResult = {
      ok: true,
      op: "handoff",
      handoff: {
        type: "computer_handoff",
        reason: "2fa",
        message: "Enter the code from your authenticator.",
        requiresUser: true,
      },
    };
    expect(parseComputerToolResult(JSON.stringify(handoff))).toEqual(handoff);
  });

  it("returns null for unrelated output", () => {
    expect(parseComputerToolResult({ foo: 1 })).toBeNull();
    expect(parseComputerToolResult("not json")).toBeNull();
    expect(parseComputerToolResult(null)).toBeNull();
  });
});

describe("isComputerToolName", () => {
  it("matches computer_* tools", () => {
    expect(isComputerToolName("computer_open")).toBe(true);
    expect(isComputerToolName("computer_act")).toBe(true);
    expect(isComputerToolName("notion_search")).toBe(false);
    expect(isComputerToolName(undefined)).toBe(false);
  });
});
