import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { NATIVE_VIEWER_HTML } from "./native-viewer-script";

interface NativeBridge {
  pointer(x: number, y: number, mask: number): void;
  key(keysym: number, code: string, down: boolean): void;
  text(value: string): void;
  fit(): void;
}

function loadBridge() {
  const pointerEvent = vi.fn();
  const sendKey = vi.fn();
  const applyScale = vi.fn();
  let scaleViewport = false;
  let notifyResize = () => {};
  const legacyMouseHandler = vi.fn(() => {
    throw new Error("DOM mouse handlers do not accept native framebuffer input");
  });
  const connection = {
    _rfbConnectionState: "connected",
    viewOnly: false,
    _fbWidth: 1280,
    _fbHeight: 720,
    _sock: {},
    _FBU: { rects: 0 },
    _display: {
      fillRect: vi.fn(), copyImage: vi.fn(), imageRect: vi.fn(), blitImage: vi.fn(),
      flush: () => Promise.resolve(),
    },
    _framebufferUpdate: vi.fn(),
    _handleMouseButton: legacyMouseHandler,
    addEventListener: vi.fn(),
    get scaleViewport() { return scaleViewport; },
    set scaleViewport(value: boolean) { scaleViewport = value; applyScale(value); },
    sendKey,
  };
  class RFB {
    static messages = { pointerEvent };
    constructor() { return connection; }
  }
  const page: { vladVNC?: NativeBridge } = {};
  const script = NATIVE_VIEWER_HTML.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("Native viewer module is missing");
  runInNewContext(script.replace(/import RFB from "\.\/core\/rfb\.js";/, ""), {
    RFB, window: page,
    document: { querySelector: () => ({}) },
    location: new URL("https://viewer.example/native.html#token=test-token"),
    URL, URLSearchParams,
    ResizeObserver: class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe() {}
    },
  });
  if (!page.vladVNC) throw new Error("Native viewer bridge is missing");
  return { bridge: page.vladVNC, connection, pointerEvent, sendKey, legacyMouseHandler, applyScale, resize: () => notifyResize() };
}

describe("native computer input bridge", () => {
  it("recomputes fit after viewport resizes and explicit Fit while scaling is already enabled", () => {
    const { bridge, connection, applyScale, resize } = loadBridge();
    expect(connection.scaleViewport).toBe(true);
    applyScale.mockClear();
    resize();
    bridge.fit();
    expect(applyScale.mock.calls).toEqual([[true], [true]]);
  });

  it("preserves framebuffer position and complete button masks through click, drag and scroll", () => {
    const { bridge, connection, pointerEvent, legacyMouseHandler } = loadBridge();
    for (const mask of [0, 1, 1, 0, 4, 0, 8, 0, 16, 0]) {
      bridge.pointer(640, 360, mask);
    }
    expect(pointerEvent.mock.calls).toEqual(
      [0, 1, 1, 0, 4, 0, 8, 0, 16, 0].map(mask => [connection._sock, 640, 360, mask]),
    );
    expect(legacyMouseHandler).not.toHaveBeenCalled();
  });

  it("rounds and clamps native coordinates to framebuffer bounds", () => {
    const { bridge, connection, pointerEvent } = loadBridge();
    bridge.pointer(-20, 1000, 1);
    bridge.pointer(2000, -5, 0);
    bridge.pointer(12.6, 19.2, 4);
    expect(pointerEvent.mock.calls).toEqual([
      [connection._sock, 0, 719, 1],
      [connection._sock, 1279, 0, 0],
      [connection._sock, 13, 19, 4],
    ]);
  });

  it("does not send pointer packets while disconnected or view-only", () => {
    const { bridge, connection, pointerEvent } = loadBridge();
    connection._rfbConnectionState = "disconnected";
    bridge.pointer(640, 360, 1);
    connection._rfbConnectionState = "connected";
    connection.viewOnly = true;
    bridge.pointer(640, 360, 1);
    expect(pointerEvent).not.toHaveBeenCalled();
  });

  it("passes key releases and Unicode text to noVNC", () => {
    const { bridge, sendKey } = loadBridge();
    bridge.key(0xffe3, "ControlLeft", true);
    bridge.key(0xffe3, "ControlLeft", false);
    bridge.text("A😀");
    expect(sendKey.mock.calls).toEqual([
      [0xffe3, "ControlLeft", true], [0xffe3, "ControlLeft", false],
      [65, "", true], [65, "", false],
      [0x0101f600, "", true], [0x0101f600, "", false],
    ]);
  });
});
