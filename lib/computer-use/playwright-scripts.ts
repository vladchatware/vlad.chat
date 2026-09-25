/** Bash + CJS payloads executed inside the Vercel Sandbox microVM.
 *
 * Editable CJS sources live in `lib/computer-use/sandbox-scripts/`.
 * After editing shooter/runner there, re-embed into SHOOTER_CJS / RUNNER_CJS.
 * cua-bridge: edit sandbox-scripts/cua-bridge.cjs then regenerate cua-bridge-script.ts.
 */

/** Pin browsers under /tmp so partial installs are detectable and recoverable. */
export const INSTALL_PLAYWRIGHT_SH = `set -euo pipefail
export PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers
mkdir -p /tmp/cu /tmp/cu-profile /tmp/cu-npm /tmp/cu-browsers
cd /tmp/cu-npm
if [ ! -d /tmp/cu-npm/node_modules/playwright ]; then
  npm init -y >/dev/null 2>&1
  npm i playwright@1.49.1 --no-fund --no-audit
fi
has_browser() {
  # Headed VNC desk needs full chromium, not headless_shell.
  ls /tmp/cu-browsers/chromium-*/chrome-linux*/chrome >/dev/null 2>&1
}
if ! has_browser; then
  npx playwright install --with-deps chromium
fi
if ! has_browser; then
  echo "Playwright full chromium missing under PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers (headed desk)" >&2
  ls -laR /tmp/cu-browsers >&2 || true
  exit 1
fi
`;

export const INSTALL_DESK_SH = `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
# Keep package set minimal — full recommends + WM was a factor in sandbox OOM (exit 137).
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  xvfb x11vnc novnc websockify python3-websockify fonts-liberation curl iproute2 scrot \
  libxi6 at-spi2-core dbus-x11 \
  >/dev/null
rm -rf /var/lib/apt/lists/*
for b in Xvfb x11vnc websockify curl; do
  if ! command -v "$b" >/dev/null 2>&1; then
    echo "desk install missing binary: $b" >&2
    exit 1
  fi
done
mkdir -p /tmp/cu /tmp/cu-profile
if [ ! -f /usr/share/novnc/vnc.html ] && [ ! -f /usr/share/novnc/vnc_lite.html ]; then
  echo "noVNC web assets missing under /usr/share/novnc" >&2
  ls -la /usr/share/novnc >&2 || true
  exit 1
fi
# 2G swap for Chromium (desk-up then runner was still OOM at 8GB).
if [ ! -f /tmp/cu/swapfile ]; then
  mkdir -p /tmp/cu
  fallocate -l 2G /tmp/cu/swapfile 2>/dev/null || dd if=/dev/zero of=/tmp/cu/swapfile bs=1M count=2048 status=none
  chmod 600 /tmp/cu/swapfile
  mkswap /tmp/cu/swapfile >/dev/null
fi
swapon /tmp/cu/swapfile >/dev/null 2>&1 || true
echo desk-packages-ready
`;



/** Install cua-driver for the sandbox user (no sudo — binary lands in ~/.local/bin). */
export const INSTALL_CUA_SH = `set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
export CUA_DRIVER_NO_MODIFY_PATH=1
mkdir -p "$HOME/.local/bin" /tmp/cu
if ! command -v cua-driver >/dev/null 2>&1; then
  curl -fsSL https://cua.ai/driver/install.sh | bash -s -- --no-modify-path
fi
if ! command -v cua-driver >/dev/null 2>&1; then
  echo "cua-driver missing after install" >&2
  ls -la "$HOME/.local/bin" >&2 || true
  exit 1
fi
cua-driver telemetry disable >/dev/null 2>&1 || true
cua-driver --version | tee /tmp/cu/cua-driver.version
echo cua-driver-ready
`;

export const LAUNCH_CHROME_CJS = `#!/usr/bin/env node
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/tmp/cu-browsers';
process.env.DISPLAY = process.env.DISPLAY || ':99';
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('/tmp/cu-npm/node_modules/playwright');

fs.mkdirSync('/tmp/cu', { recursive: true });
fs.mkdirSync('/tmp/cu-profile', { recursive: true });

function fail(err) {
  try { fs.writeFileSync('/tmp/cu/chrome-launch.err', String(err && err.stack || err)); } catch {}
  console.error(err);
  process.exit(1);
}

(async () => {
  let exec;
  try {
    exec = chromium.executablePath();
  } catch (e) {
    fail(e);
    return;
  }
  if (!exec || !fs.existsSync(exec)) {
    fail(new Error('chromium.executablePath missing: ' + exec));
    return;
  }
  if (String(exec).includes('headless_shell')) {
    fail(new Error('headed desk needs full chromium, got headless_shell: ' + exec));
    return;
  }
  fs.writeFileSync('/tmp/cu/chrome-exec', exec);
  // Memory: one renderer, no GPU/raster extras. Avoid --single-process (headed+VNC crashes).
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--ozone-platform=x11',
    '--remote-debugging-port=9222',
    '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=/tmp/cu-profile',
    '--window-size=1024,720',
    '--window-position=0,0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-translate',
    '--metrics-recording-only',
    '--mute-audio',
    '--renderer-process-limit=1',
    '--disable-features=TranslateUI,AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
    '--js-flags=--max-old-space-size=256',
    'about:blank',
  ];
  const child = spawn(exec, args, {
    env: { ...process.env, DISPLAY: ':99', PLAYWRIGHT_BROWSERS_PATH: '/tmp/cu-browsers' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  fs.writeFileSync('/tmp/cu/chrome.pid', String(child.pid));
  const log = fs.createWriteStream('/tmp/cu/chrome-child.log', { flags: 'a' });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on('exit', (code, signal) => {
    try {
      fs.writeFileSync('/tmp/cu/chrome-launch.err', 'chrome exited code=' + code + ' signal=' + signal);
    } catch {}
  });
  await new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      tries += 1;
      if (child.exitCode != null) {
        reject(new Error('chrome exited before CDP ready, code=' + child.exitCode));
        return;
      }
      const req = http.get('http://127.0.0.1:9222/json/version', (res) => {
        res.resume();
        if (res.statusCode === 200) {
          fs.writeFileSync('/tmp/cu/cdp-ready', '1');
          resolve(undefined);
          return;
        }
        if (tries > 100) reject(new Error('CDP HTTP not 200 after spawn'));
        else setTimeout(tick, 250);
      });
      req.on('error', () => {
        if (tries > 100) reject(new Error('CDP not reachable after spawn: ' + tries));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
  child.unref();
  await new Promise(() => {});
})().catch(fail);
`;

export const START_DESK_SH = `set -euo pipefail
export DISPLAY=:99
export PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers
export PATH="$HOME/.local/bin:$PATH"
mkdir -p /tmp/cu /tmp/cu-profile
# Session bus for AT-SPI (cua-driver get_window_state). Persist for later shot/act cmds.
if [ -z "\${DBUS_SESSION_BUS_ADDRESS:-}" ] && command -v dbus-launch >/dev/null 2>&1; then
  dbus-launch --sh-syntax > /tmp/cu/dbus.env
fi
if [ -f /tmp/cu/dbus.env ]; then
  # shellcheck disable=SC1091
  . /tmp/cu/dbus.env
fi
if ! pgrep -x at-spi-bus-laun >/dev/null 2>&1 && [ -x /usr/libexec/at-spi-bus-launcher ]; then
  /usr/libexec/at-spi-bus-launcher --launch-immediately >/tmp/cu/atspi.log 2>&1 &
  sleep 0.3
fi
# Swap softens Chromium CDP spikes (runner was SIGKILL 137 after desk-up).
if [ ! -f /tmp/cu/swapfile ]; then
  if fallocate -l 2G /tmp/cu/swapfile 2>/dev/null || dd if=/dev/zero of=/tmp/cu/swapfile bs=1M count=2048 status=none; then
    chmod 600 /tmp/cu/swapfile
    mkswap /tmp/cu/swapfile >/dev/null 2>&1 || true
  fi
fi
swapon /tmp/cu/swapfile >/dev/null 2>&1 || true
diag() {
  echo "=== desk diagnostics ===" >&2
  echo "binaries:" >&2
  command -v Xvfb x11vnc websockify curl || true
  echo "ports:" >&2
  (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) | head -40 >&2 || true
  tail -80 /tmp/cu/chrome.log /tmp/cu/chrome-launch.err /tmp/cu/xvfb.log /tmp/cu/x11vnc.log /tmp/cu/novnc.log /tmp/cu/cua-driver.log 2>/dev/null || true
  command -v cua-driver >/dev/null 2>&1 && cua-driver status >&2 || true
  # -x only: never pgrep -f against this script body (false positive).
  ps -eo pid,comm,args | head -80 >&2 || true
  ls -la /tmp/cu-browsers 2>/dev/null | head -40 >&2 || true
}
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing binary: $1" >&2
    diag
    exit 1
  fi
}
need Xvfb
need x11vnc
need curl
port_up() { ss -ltn 2>/dev/null | grep -q ":$1 " || netstat -ltn 2>/dev/null | grep -q ":$1 "; }

# IMPORTANT: use pgrep -x / port checks — pgrep -f matches this bash -lc script text.
if ! pgrep -x Xvfb >/dev/null 2>&1; then
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
  Xvfb :99 -screen 0 1280x720x24 -ac +extension RANDR +render -noreset -nolisten tcp >/tmp/cu/xvfb.log 2>&1 &
  sleep 0.8
  if ! pgrep -x Xvfb >/dev/null 2>&1; then
    echo "Xvfb failed to start" >&2
    diag
    exit 1
  fi
fi
if ! pgrep -x x11vnc >/dev/null 2>&1; then
  x11vnc -display :99 -rfbport 5900 -localhost -forever -shared -nopw -xkb -repeat >/tmp/cu/x11vnc.log 2>&1 &
  sleep 0.6
  if ! pgrep -x x11vnc >/dev/null 2>&1; then
    echo "x11vnc failed to start" >&2
    diag
    exit 1
  fi
fi
NOVNC_WEB=""
for d in /usr/share/novnc /usr/share/novnc/utils/.. /usr/share/novnc; do
  if [ -f "$d/vnc.html" ] || [ -f "$d/vnc_lite.html" ]; then NOVNC_WEB="$d"; break; fi
done
if [ -z "$NOVNC_WEB" ] && [ -d /usr/share/novnc ]; then NOVNC_WEB=/usr/share/novnc; fi
if [ -z "$NOVNC_WEB" ]; then
  echo "noVNC web root not found" >&2
  diag
  exit 1
fi
echo "$NOVNC_WEB" > /tmp/cu/novnc-web
ENTRY=vnc.html
[ -f "$NOVNC_WEB/$ENTRY" ] || ENTRY=vnc_lite.html
echo "$ENTRY" > /tmp/cu/novnc-entry

start_websockify() {
  if command -v websockify >/dev/null 2>&1; then
    websockify --web="$NOVNC_WEB" 6080 127.0.0.1:5900 >/tmp/cu/novnc.log 2>&1 &
    return 0
  fi
  if python3 -c 'import websockify' >/dev/null 2>&1; then
    python3 -m websockify --web="$NOVNC_WEB" 6080 127.0.0.1:5900 >/tmp/cu/novnc.log 2>&1 &
    return 0
  fi
  echo "websockify not available" >&2
  return 1
}
if ! port_up 6080; then
  start_websockify || { diag; exit 1; }
  sleep 0.6
fi
ok=0
for i in $(seq 1 50); do
  if curl -fsS -o /dev/null "http://127.0.0.1:6080/" 2>/dev/null; then ok=1; break; fi
  if curl -fsS -o /dev/null "http://127.0.0.1:6080/$ENTRY" 2>/dev/null; then ok=1; break; fi
  sleep 0.25
done
if [ "$ok" != "1" ]; then
  echo "noVNC HTTP not ready on :6080" >&2
  diag
  exit 1
fi
# Headed Chromium via Playwright keep-alive (shared with VNC + computer_* CDP).
cdp_up() { curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1; }
if ! cdp_up; then
  if [ ! -f /tmp/cu/launch-chrome.cjs ]; then
    echo "launch-chrome.cjs missing" >&2
    diag
    exit 1
  fi
  rm -f /tmp/cu/cdp-ready /tmp/cu/chrome-launch.err
  pkill -x chrome >/dev/null 2>&1 || true
  pkill -x chromium >/dev/null 2>&1 || true
  # Kill prior node launchers by pid file only (avoid pgrep -f on script text).
  if [ -f /tmp/cu/chrome-launcher.pid ]; then
    kill "$(cat /tmp/cu/chrome-launcher.pid)" >/dev/null 2>&1 || true
  fi
  sleep 0.3
  node /tmp/cu/launch-chrome.cjs >/tmp/cu/chrome.log 2>&1 &
  echo $! > /tmp/cu/chrome-launcher.pid
  ok=0
  for i in $(seq 1 90); do
    if [ -f /tmp/cu/cdp-ready ] && cdp_up; then ok=1; break; fi
    if [ -f /tmp/cu/chrome-launch.err ]; then
      echo "chrome launcher failed" >&2
      diag
      exit 1
    fi
    if [ -f /tmp/cu/chrome-launcher.pid ]; then
      lp=$(cat /tmp/cu/chrome-launcher.pid)
      if ! kill -0 "$lp" 2>/dev/null; then
        echo "chrome launcher exited early" >&2
        diag
        exit 1
      fi
    fi
    sleep 0.5
  done
  if [ "$ok" != "1" ]; then
    echo "CDP :9222 not ready after Playwright launch" >&2
    diag
    exit 1
  fi
fi
for i in 1 2 3; do
  if ! cdp_up; then
    echo "CDP dropped after ready" >&2
    diag
    exit 1
  fi
  sleep 0.35
done
# cua-driver daemon on the same DISPLAY / AT-SPI session as Chromium (best-effort).
if command -v cua-driver >/dev/null 2>&1; then
  if ! cua-driver status >/dev/null 2>&1; then
    cua-driver serve --no-overlay >/tmp/cu/cua-driver.log 2>&1 &
    echo $! > /tmp/cu/cua-driver.pid
  fi
  ok_cua=0
  for i in $(seq 1 40); do
    if cua-driver status >/dev/null 2>&1; then ok_cua=1; break; fi
    sleep 0.25
  done
  if [ "$ok_cua" = "1" ]; then
    echo cua-driver-ready >> /tmp/cu/cua-driver.log || true
    if [ -f /tmp/cu/cua-bridge.cjs ]; then
      node /tmp/cu/cua-bridge.cjs refresh-target >/tmp/cu/cua-target.boot.json 2>>/tmp/cu/cua-driver.log || true
    fi
  else
    echo "cua-driver serve not ready (will fall back to CDP/Playwright)" >&2
    tail -40 /tmp/cu/cua-driver.log >&2 || true
  fi
else
  echo "cua-driver not installed (CDP/Playwright fallback only)" >&2
fi
echo desk-ready
`;

/** Tiny CDP JPEG capture — no Playwright (avoids connect+encode OOM 137). */
export const SHOOTER_CJS = "#!/usr/bin/env node\n'use strict';\n/**\n * Tiny CDP JPEG capture — no Playwright.\n * Playwright connectOverCDP + page.screenshot was SIGKILL 137 on Vercel Sandbox\n * when headed desk Chromium was already resident.\n */\nconst fs = require('fs');\nconst http = require('http');\nconst net = require('net');\nconst crypto = require('crypto');\nconst { execFileSync } = require('child_process');\nconst path = require('path');\n\nconst STATE_PATH = '/tmp/cu/state.json';\nconst OUT_SHOT = '/tmp/cu/shot.jpg';\nconst OUT_META = '/tmp/cu/meta.json';\nconst CDP_HTTP = process.env.CU_CDP_URL || 'http://127.0.0.1:9222';\nconst SHOT_W = 640;\nconst SHOT_H = 400;\nconst SHOT_Q = 30;\n\nfunction readState() {\n  try {\n    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));\n  } catch {\n    return { url: 'about:blank' };\n  }\n}\n\nfunction writeMeta(m) {\n  fs.mkdirSync(path.dirname(OUT_META), { recursive: true });\n  fs.writeFileSync(OUT_META, JSON.stringify(m));\n}\n\nfunction httpJson(url) {\n  return new Promise((resolve, reject) => {\n    const req = http.get(url, { timeout: 5000 }, (res) => {\n      let d = '';\n      res.on('data', (c) => {\n        d += c;\n      });\n      res.on('end', () => {\n        try {\n          resolve(JSON.parse(d));\n        } catch (e) {\n          reject(e);\n        }\n      });\n    });\n    req.on('error', reject);\n    req.on('timeout', () => {\n      req.destroy();\n      reject(new Error('http timeout'));\n    });\n  });\n}\n\nfunction connectWs(wsUrl) {\n  return new Promise((resolve, reject) => {\n    const u = new URL(wsUrl);\n    const key = crypto.randomBytes(16).toString('base64');\n    const sock = net.connect({ host: u.hostname, port: Number(u.port) || 80 }, () => {\n      sock.write(\n        'GET ' +\n          u.pathname +\n          u.search +\n          ' HTTP/1.1\\r\\n' +\n          'Host: ' +\n          u.host +\n          '\\r\\n' +\n          'Upgrade: websocket\\r\\n' +\n          'Connection: Upgrade\\r\\n' +\n          'Sec-WebSocket-Key: ' +\n          key +\n          '\\r\\n' +\n          'Sec-WebSocket-Version: 13\\r\\n\\r\\n',\n      );\n    });\n    let buf = Buffer.alloc(0);\n    let upgraded = false;\n    const pending = new Map();\n    let nextId = 1;\n\n    function frame(payloadBuf) {\n      const mask = crypto.randomBytes(4);\n      const len = payloadBuf.length;\n      let header;\n      if (len < 126) {\n        header = Buffer.alloc(2);\n        header[0] = 0x81;\n        header[1] = 0x80 | len;\n      } else if (len < 65536) {\n        header = Buffer.alloc(4);\n        header[0] = 0x81;\n        header[1] = 0x80 | 126;\n        header.writeUInt16BE(len, 2);\n      } else {\n        header = Buffer.alloc(10);\n        header[0] = 0x81;\n        header[1] = 0x80 | 127;\n        header.writeUInt32BE(0, 2);\n        header.writeUInt32BE(len, 6);\n      }\n      const masked = Buffer.alloc(len);\n      for (let i = 0; i < len; i++) masked[i] = payloadBuf[i] ^ mask[i % 4];\n      return Buffer.concat([header, mask, masked]);\n    }\n\n    function send(method, params) {\n      const id = nextId++;\n      const body = Buffer.from(JSON.stringify({ id, method, params: params || {} }));\n      sock.write(frame(body));\n      return new Promise((res, rej) => {\n        const t = setTimeout(() => {\n          if (pending.has(id)) {\n            pending.delete(id);\n            rej(new Error('CDP timeout: ' + method));\n          }\n        }, 15000);\n        pending.set(id, { res, rej, t });\n      });\n    }\n\n    function handlePayload(payload) {\n      let msg;\n      try {\n        msg = JSON.parse(payload.toString());\n      } catch {\n        return;\n      }\n      if (msg.id != null && pending.has(msg.id)) {\n        const p = pending.get(msg.id);\n        pending.delete(msg.id);\n        clearTimeout(p.t);\n        if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));\n        else p.res(msg.result || {});\n      }\n    }\n\n    sock.on('data', (chunk) => {\n      buf = Buffer.concat([buf, chunk]);\n      if (!upgraded) {\n        const idx = buf.indexOf('\\r\\n\\r\\n');\n        if (idx < 0) return;\n        const head = buf.slice(0, idx).toString();\n        if (!/\\s101\\s/.test(head)) {\n          reject(new Error('WS upgrade failed: ' + head.slice(0, 180)));\n          sock.destroy();\n          return;\n        }\n        upgraded = true;\n        buf = buf.slice(idx + 4);\n        resolve({\n          send,\n          close() {\n            try {\n              sock.destroy();\n            } catch {\n              /* ignore */\n            }\n          },\n        });\n      }\n      while (upgraded && buf.length >= 2) {\n        const b0 = buf[0];\n        const b1 = buf[1];\n        const opcode = b0 & 0x0f;\n        const masked = (b1 & 0x80) !== 0;\n        let len = b1 & 0x7f;\n        let off = 2;\n        if (len === 126) {\n          if (buf.length < 4) return;\n          len = buf.readUInt16BE(2);\n          off = 4;\n        } else if (len === 127) {\n          if (buf.length < 10) return;\n          const hi = buf.readUInt32BE(2);\n          const lo = buf.readUInt32BE(6);\n          if (hi !== 0) {\n            sock.destroy();\n            return;\n          }\n          len = lo;\n          off = 10;\n        }\n        const maskLen = masked ? 4 : 0;\n        if (buf.length < off + maskLen + len) return;\n        let payload = buf.slice(off + maskLen, off + maskLen + len);\n        if (masked) {\n          const m = buf.slice(off, off + 4);\n          const out = Buffer.alloc(len);\n          for (let i = 0; i < len; i++) out[i] = payload[i] ^ m[i % 4];\n          payload = out;\n        }\n        buf = buf.slice(off + maskLen + len);\n        if (opcode === 0x8) {\n          sock.destroy();\n          return;\n        }\n        if (opcode === 0x9) {\n          const pongHdr = Buffer.from([0x8a, payload.length & 0x7f]);\n          sock.write(Buffer.concat([pongHdr, payload]));\n          continue;\n        }\n        if (opcode === 0x1 || opcode === 0x2) handlePayload(payload);\n      }\n    });\n    sock.on('error', reject);\n    sock.setTimeout(20000, () => {\n      reject(new Error('WS socket timeout'));\n      sock.destroy();\n    });\n  });\n}\n\nasync function cdpShot() {\n  const base = CDP_HTTP.replace(/\\/$/, '');\n  const targets = await httpJson(base + '/json/list');\n  if (!Array.isArray(targets) || !targets.length) throw new Error('no CDP targets');\n  const page =\n    targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !String(t.url || '').startsWith('chrome-extension:')) ||\n    targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ||\n    targets.find((t) => t.webSocketDebuggerUrl && t.type !== 'service_worker' && t.type !== 'background_page') ||\n    targets.find((t) => t.webSocketDebuggerUrl);\n  if (!page || !page.webSocketDebuggerUrl) throw new Error('no page websocket');\n  const ws = await connectWs(page.webSocketDebuggerUrl);\n  try {\n    await ws.send('Page.enable').catch(() => {});\n    const result = await ws.send('Page.captureScreenshot', {\n      format: 'jpeg',\n      quality: SHOT_Q,\n      fromSurface: true,\n      clip: { x: 0, y: 0, width: SHOT_W, height: SHOT_H, scale: 1 },\n    });\n    if (!result || !result.data) throw new Error('empty CDP screenshot');\n    fs.writeFileSync(OUT_SHOT, Buffer.from(result.data, 'base64'));\n    return {\n      url: page.url || readState().url || 'about:blank',\n      title: page.title || readState().title || '',\n      via: 'cdp',\n    };\n  } finally {\n    ws.close();\n  }\n}\n\nfunction x11Shot() {\n  const env = { ...process.env, DISPLAY: ':99' };\n  try {\n    execFileSync(\n      'scrot',\n      ['-a', '0,0,' + SHOT_W + ',' + SHOT_H, '-q', String(SHOT_Q), OUT_SHOT],\n      {\n        env,\n        timeout: 12000,\n        stdio: ['ignore', 'ignore', 'pipe'],\n      },\n    );\n    if (fs.existsSync(OUT_SHOT) && fs.statSync(OUT_SHOT).size > 32) {\n      const st = readState();\n      return { url: st.url || 'about:blank', title: st.title || '', via: 'scrot' };\n    }\n  } catch (e) {\n    try {\n      fs.writeFileSync('/tmp/cu/shot.err', 'scrot: ' + String((e && e.message) || e));\n    } catch {\n      /* ignore */\n    }\n  }\n  return null;\n}\n\n(async () => {\n  fs.mkdirSync('/tmp/cu', { recursive: true });\n  let info = null;\n  let err = null;\n  try {\n    info = await cdpShot();\n  } catch (e) {\n    err = e;\n    try {\n      fs.writeFileSync('/tmp/cu/shot.err', 'cdp: ' + String((e && e.stack) || e));\n    } catch {\n      /* ignore */\n    }\n    info = x11Shot();\n  }\n  if (!info) {\n    writeMeta({ ok: false, error: String((err && err.message) || err || 'screenshot failed') });\n    process.exit(1);\n  }\n  const meta = {\n    ok: true,\n    url: info.url,\n    title: info.title,\n    action: 'screenshot',\n    width: SHOT_W,\n    height: SHOT_H,\n    mimeType: 'image/jpeg',\n    shot: true,\n    via: info.via,\n  };\n  writeMeta(meta);\n  process.stdout.write(JSON.stringify(meta));\n  process.exit(0);\n})().catch((e) => {\n  writeMeta({ ok: false, error: String((e && e.message) || e) });\n  console.error(e);\n  process.exit(1);\n});\n";

/** Playwright CDP attach for navigate/act only — shots go through SHOOTER_CJS. */
export const RUNNER_CJS = '#!/usr/bin/env node\nprocess.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || \'/tmp/cu-browsers\';\nconst { chromium } = require(\'/tmp/cu-npm/node_modules/playwright\');\nconst fs = require(\'fs\');\nconst path = require(\'path\');\n\nconst STATE_PATH = \'/tmp/cu/state.json\';\nconst OUT_META = \'/tmp/cu/meta.json\';\nconst CDP = process.env.CU_CDP_URL || \'http://127.0.0.1:9222\';\n\nfunction readState() {\n  try {\n    return JSON.parse(fs.readFileSync(STATE_PATH, \'utf8\'));\n  } catch {\n    return { url: \'about:blank\' };\n  }\n}\nfunction writeState(s) {\n  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });\n  fs.writeFileSync(STATE_PATH, JSON.stringify(s));\n}\nfunction writeMeta(m) {\n  fs.writeFileSync(OUT_META, JSON.stringify(m));\n}\n\nasync function withPage(fn) {\n  const state = readState();\n  // Attach only — never launch a second Chromium (desk already owns :9222).\n  const browser = await chromium.connectOverCDP(CDP);\n  try {\n    const context =\n      browser.contexts()[0] ||\n      (await browser.newContext({\n        viewport: { width: 1024, height: 720 },\n      }));\n    const page = context.pages()[0] || (await context.newPage());\n    if (state.url && state.url !== \'about:blank\' && page.url() === \'about:blank\') {\n      await page.goto(state.url, { waitUntil: \'domcontentloaded\', timeout: 45000 }).catch(() => {});\n    }\n    const result = await fn(page, state);\n    const url = page.url();\n    const title = await page.title().catch(() => \'\');\n    writeState({ url, title });\n    writeMeta({\n      ok: true,\n      url,\n      title,\n      action: result && result.action ? result.action : \'ok\',\n      shot: false,\n      shotSkipped: true,\n    });\n    process.stdout.write(\n      JSON.stringify({\n        ok: true,\n        url,\n        title,\n        action: result && result.action,\n        shot: false,\n        shotSkipped: true,\n      }),\n    );\n  } finally {\n    // Leave CDP socket to GC on process exit. Do not browser.close() —\n    // some Playwright builds tear down the remote target when closing.\n  }\n}\n\nasync function main() {\n  const cmd = JSON.parse(process.argv[2] || \'{"op":"open"}\');\n  if (cmd.op === \'open\') {\n    await withPage(async (page) => {\n      await page.goto(cmd.url, { waitUntil: \'domcontentloaded\', timeout: 45000 });\n      return { action: \'open\' };\n    });\n    return;\n  }\n  if (cmd.op === \'act\') {\n    await withPage(async (page) => {\n      const a = cmd.action || {};\n      switch (a.type) {\n        case \'click\':\n          await page.mouse.click(a.x, a.y, { button: a.button || \'left\' });\n          break;\n        case \'type\':\n          await page.keyboard.type(a.text, { delay: 15 });\n          break;\n        case \'key\':\n          await page.keyboard.press(a.key);\n          break;\n        case \'scroll\':\n          await page.mouse.move(a.x, a.y);\n          await page.mouse.wheel(a.deltaX || 0, a.deltaY || 0);\n          break;\n        case \'wait\':\n          await page.waitForTimeout(Math.min(a.ms || 1000, 10000));\n          break;\n        case \'drag\':\n          await page.mouse.move(a.fromX, a.fromY);\n          await page.mouse.down();\n          await page.mouse.move(a.toX, a.toY, { steps: 8 });\n          await page.mouse.up();\n          break;\n        default:\n          throw new Error(\'Unknown action type: \' + a.type);\n      }\n      await page.waitForTimeout(250);\n      return { action: a.type };\n    });\n    return;\n  }\n  throw new Error(\'Unknown op (use shooter.cjs for screenshot): \' + cmd.op);\n}\n\nmain().catch((err) => {\n  writeMeta({ ok: false, error: String((err && err.message) || err) });\n  console.error(err);\n  process.exit(1);\n});\n';
