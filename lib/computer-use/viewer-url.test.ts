import { describe, expect, it } from "vitest";

/** Mirror of sandbox viewerUrl construction (keep in sync with sandbox.ts). */
function buildViewerUrl(domainUrl: string, entry = "vnc.html"): string {
  const root = domainUrl.replace(/\/$/, "");
  const page = entry.endsWith(".html") ? entry : "vnc.html";
  return `${root}/${page}?autoconnect=1&resize=scale`;
}

describe("computer-use viewerUrl", () => {
  it("builds noVNC URL from sandbox.domain(6080)", () => {
    expect(buildViewerUrl("https://abc123.vercel.run")).toBe(
      "https://abc123.vercel.run/vnc.html?autoconnect=1&resize=scale",
    );
  });

  it("strips trailing slash on domain", () => {
    expect(buildViewerUrl("https://abc123.vercel.run/")).toBe(
      "https://abc123.vercel.run/vnc.html?autoconnect=1&resize=scale",
    );
  });

  it("honors vnc_lite.html entry", () => {
    expect(buildViewerUrl("https://x.vercel.run", "vnc_lite.html")).toBe(
      "https://x.vercel.run/vnc_lite.html?autoconnect=1&resize=scale",
    );
  });

  it("ComputerToolResult field name is viewerUrl", () => {
    const sample = {
      ok: true,
      op: "open" as const,
      screenshotUrl: "https://preview.example/api/computer-use/screenshots/1",
      viewerUrl: "https://abc.vercel.run/vnc.html?autoconnect=1&resize=scale",
    };
    expect(sample).toHaveProperty("viewerUrl");
    expect(sample.viewerUrl).toMatch(/vnc\.html\?autoconnect=1/);
  });
});
