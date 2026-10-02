import { afterEach, describe, expect, it, vi } from "vitest";

const { init } = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock("posthog-js", () => ({
  default: { init },
}));

describe("PostHog browser initialization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    init.mockReset();
  });

  it("uses the direct PostHog host in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-key");

    await import("./instrumentation-client");

    expect(init).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({ api_host: "https://us.i.posthog.com" }),
    );
  });
});
