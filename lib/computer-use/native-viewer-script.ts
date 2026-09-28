/** Minimal native-shell VNC page. noVNC decodes RFB directly from websockify. */
export const NATIVE_VIEWER_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <style>
      html, body, #screen { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #111; }
      #screen { position: relative; }
      #screen canvas { display: block; }
    </style>
  </head>
  <body>
    <div id="screen"></div>
    <script type="module">
      import RFB from "./core/rfb.js";

      const screen = document.querySelector("#screen");
      const socketURL = new URL("websockify", location.href);
      socketURL.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const rfb = new RFB(screen, socketURL.href, { shared: true });
      rfb.scaleViewport = true;
      rfb.showDotCursor = true;

      function publish(type, extra = {}) {
        window.webkit?.messageHandlers?.vnc?.postMessage({ type, ...extra });
      }

      function publishDesktop() {
        const width = rfb._fbWidth || 0;
        const height = rfb._fbHeight || 0;
        if (width && height) publish("desktop", { width, height });
      }

      rfb.addEventListener("connect", () => {
        publishDesktop();
        publish("connected");
      });
      rfb.addEventListener("disconnect", event => {
        publish("disconnected", { clean: event.detail.clean });
      });
      rfb.addEventListener("desktopname", event => {
        publishDesktop();
        publish("desktopName", { name: event.detail.name });
      });

      const observer = new ResizeObserver(publishDesktop);
      observer.observe(screen);

      window.vladVNC = {
        pointer(x, y, mask) {
          rfb._handleMouseButton(
            Math.max(0, Math.min(rfb._fbWidth - 1, Math.round(x))),
            Math.max(0, Math.min(rfb._fbHeight - 1, Math.round(y))),
            mask,
          );
        },
        key(keysym, code, down) { rfb.sendKey(keysym, code, down); },
        fit() { rfb.scaleViewport = true; },
        text(value) {
          for (const character of value) {
            const codePoint = character.codePointAt(0);
            const keysym = codePoint < 0x100 ? codePoint : (0x01000000 | codePoint);
            rfb.sendKey(keysym, "", true);
            rfb.sendKey(keysym, "", false);
          }
        },
      };
      publish("connecting");
    </script>
  </body>
</html>`;
