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
  xvfb x11vnc novnc websockify python3-websockify fonts-liberation curl iproute2 \
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
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--ozone-platform=x11',
    '--remote-debugging-port=9222',
    '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=/tmp/cu-profile',
    '--window-size=1024,720',
    '--window-position=0,0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-features=TranslateUI',
    '--renderer-process-limit=1',
    '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
    '--disable-software-rasterizer',
    '--memory-pressure-off',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
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
mkdir -p /tmp/cu /tmp/cu-profile
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
  tail -80 /tmp/cu/chrome.log /tmp/cu/chrome-launch.err /tmp/cu/xvfb.log /tmp/cu/x11vnc.log /tmp/cu/novnc.log 2>/dev/null || true
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
      viewport: { width: 1024, height: 720 },
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
      width: 1024,
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
