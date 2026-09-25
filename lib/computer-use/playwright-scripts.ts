/** Bash + CJS payloads executed inside the Vercel Sandbox microVM. */

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
  ls /tmp/cu-browsers/chromium-*/chrome-linux*/chrome >/dev/null 2>&1 \\
    || ls /tmp/cu-browsers/chromium_headless_shell-*/chrome-linux*/headless_shell >/dev/null 2>&1
}
if ! has_browser; then
  npx playwright install --with-deps chromium
fi
if ! has_browser; then
  echo "Playwright chromium binary missing under PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers" >&2
  ls -laR /tmp/cu-browsers >&2 || true
  exit 1
fi
`;

export const INSTALL_DESK_SH = `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v Xvfb >/dev/null 2>&1 || ! command -v x11vnc >/dev/null 2>&1 || ! command -v websockify >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq xvfb x11vnc novnc websockify fluxbox xterm fonts-liberation >/dev/null
fi
mkdir -p /tmp/cu /tmp/cu-profile
`;

export const START_DESK_SH = `set -euo pipefail
export DISPLAY=:99
mkdir -p /tmp/cu /tmp/cu-profile
if ! pgrep -f 'Xvfb :99' >/dev/null 2>&1; then
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
  Xvfb :99 -screen 0 1280x720x24 -ac +extension RANDR +render -noreset -nolisten tcp >/tmp/cu/xvfb.log 2>&1 &
  sleep 0.6
fi
if ! pgrep -x fluxbox >/dev/null 2>&1; then
  fluxbox >/tmp/cu/fluxbox.log 2>&1 &
  sleep 0.3
fi
if ! pgrep -f 'x11vnc.*5900' >/dev/null 2>&1; then
  x11vnc -display :99 -rfbport 5900 -localhost -forever -shared -nopw -xkb -repeat >/tmp/cu/x11vnc.log 2>&1 &
  sleep 0.4
fi
NOVNC_WEB=""
for d in /usr/share/novnc /usr/share/novnc/utils/.. /usr/share/novnc; do
  if [ -f "$d/vnc.html" ] || [ -f "$d/vnc_lite.html" ]; then NOVNC_WEB="$d"; break; fi
done
if [ -z "$NOVNC_WEB" ] && [ -d /usr/share/novnc ]; then NOVNC_WEB=/usr/share/novnc; fi
if [ -z "$NOVNC_WEB" ]; then
  echo "noVNC web root not found" >&2
  exit 1
fi
echo "$NOVNC_WEB" > /tmp/cu/novnc-web
ENTRY=vnc.html
[ -f "$NOVNC_WEB/$ENTRY" ] || ENTRY=vnc_lite.html
echo "$ENTRY" > /tmp/cu/novnc-entry
if ! pgrep -f 'websockify.*6080' >/dev/null 2>&1; then
  websockify --web="$NOVNC_WEB" 6080 127.0.0.1:5900 >/tmp/cu/novnc.log 2>&1 &
  sleep 0.4
fi
# Wait for noVNC HTTP
ok=0
for i in $(seq 1 40); do
  if curl -fsS -o /dev/null "http://127.0.0.1:6080/" 2>/dev/null; then ok=1; break; fi
  if curl -fsS -o /dev/null "http://127.0.0.1:6080/$ENTRY" 2>/dev/null; then ok=1; break; fi
  sleep 0.25
done
if [ "$ok" != "1" ]; then
  echo "noVNC HTTP not ready on :6080" >&2
  tail -40 /tmp/cu/novnc.log /tmp/cu/x11vnc.log /tmp/cu/xvfb.log >&2 || true
  exit 1
fi
# Persist headed Chromium on the shared display via CDP (agent + human share one desk).
if ! curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  export PLAYWRIGHT_BROWSERS_PATH=/tmp/cu-browsers
  CHROME=""
  for c in /tmp/cu-browsers/chromium-*/chrome-linux*/chrome; do
    if [ -x "$c" ]; then CHROME="$c"; break; fi
  done
  if [ -z "$CHROME" ]; then
    echo "chromium binary not found for headed desk" >&2
    ls -laR /tmp/cu-browsers >&2 || true
    exit 1
  fi
  DISPLAY=:99 "$CHROME" \
    --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage \
    --disable-gpu --ozone-platform=x11 \
    --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \
    --user-data-dir=/tmp/cu-profile \
    --window-size=1280,720 --window-position=0,0 \
    about:blank >/tmp/cu/chrome.log 2>&1 &
  ok=0
  for i in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1; then ok=1; break; fi
    sleep 0.5
  done
  if [ "$ok" != "1" ]; then
    echo "CDP :9222 not ready" >&2
    tail -50 /tmp/cu/chrome.log >&2 || true
    exit 1
  fi
fi
curl -fsS http://127.0.0.1:9222/json/version >/dev/null
echo desk-ready
`;

export const RUNNER_CJS = `#!/usr/bin/env node
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/tmp/cu-browsers';
const { chromium } = require('/tmp/cu-npm/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const STATE_PATH = '/tmp/cu/state.json';
const OUT_SHOT = '/tmp/cu/shot.png';
const OUT_META = '/tmp/cu/meta.json';
const CDP = process.env.CU_CDP_URL || 'http://127.0.0.1:9222';

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { url: 'about:blank' }; }
}
function writeState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s));
}
function writeMeta(m) {
  fs.writeFileSync(OUT_META, JSON.stringify(m));
}

async function withPage(fn) {
  const state = readState();
  // Attach to long-lived headed Chromium on the VNC display (do not close it).
  const browser = await chromium.connectOverCDP(CDP);
  try {
    const context = browser.contexts()[0] || await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = context.pages()[0] || await context.newPage();
    if (state.url && state.url !== 'about:blank' && page.url() === 'about:blank') {
      await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }
    const result = await fn(page, state);
    const url = page.url();
    const title = await page.title().catch(() => '');
    await page.screenshot({ path: OUT_SHOT, fullPage: false });
    writeState({ url, title });
    writeMeta({
      ok: true,
      url,
      title,
      action: result && result.action ? result.action : 'screenshot',
      width: 1280,
      height: 720,
    });
    process.stdout.write(JSON.stringify({ ok: true, url, title, action: result && result.action }));
  } finally {
    // Intentionally do not call browser.close() — that would kill the headed
    // Chromium the VNC viewer and subsequent computer_* ops share.
  }
}

async function main() {
  const cmd = JSON.parse(process.argv[2] || '{"op":"screenshot"}');
  if (cmd.op === 'open') {
    await withPage(async (page) => {
      await page.goto(cmd.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return { action: 'open' };
    });
    return;
  }
  if (cmd.op === 'screenshot') {
    await withPage(async () => ({ action: 'screenshot' }));
    return;
  }
  if (cmd.op === 'act') {
    await withPage(async (page) => {
      const a = cmd.action || {};
      switch (a.type) {
        case 'click':
          await page.mouse.click(a.x, a.y, { button: a.button || 'left' });
          break;
        case 'type':
          await page.keyboard.type(a.text, { delay: 20 });
          break;
        case 'key':
          await page.keyboard.press(a.key);
          break;
        case 'scroll':
          await page.mouse.move(a.x, a.y);
          await page.mouse.wheel(a.deltaX || 0, a.deltaY || 0);
          break;
        case 'wait':
          await page.waitForTimeout(Math.min(a.ms || 1000, 10000));
          break;
        case 'drag':
          await page.mouse.move(a.fromX, a.fromY);
          await page.mouse.down();
          await page.mouse.move(a.toX, a.toY, { steps: 12 });
          await page.mouse.up();
          break;
        default:
          throw new Error('Unknown action type: ' + a.type);
      }
      await page.waitForTimeout(400);
      return { action: a.type };
    });
    return;
  }
  throw new Error('Unknown op: ' + cmd.op);
}

main().catch((err) => {
  writeMeta({ ok: false, error: String(err && err.message || err) });
  console.error(err);
  process.exit(1);
});
`;
