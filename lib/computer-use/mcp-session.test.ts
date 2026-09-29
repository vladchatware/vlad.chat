import { describe, expect, it } from "vitest";
import {
  computerSessionAls,
  resolveMcpComputerSessionKey,
} from "./mcp-session";

describe("MCP computer session resolution", () => {
  it("keeps authenticated request session authoritative over tool input", () => {
    computerSessionAls.run(
      { sessionKey: "authenticated-user" },
      () => expect(resolveMcpComputerSessionKey("model-chosen-session")).toBe("authenticated-user"),
    );
  });

  it("uses tool session input when request has no authenticated session", () => {
    expect(resolveMcpComputerSessionKey("standalone-session")).toBe("standalone-session");
  });
});
