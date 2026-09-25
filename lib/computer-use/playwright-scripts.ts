/** Bash + CJS payloads executed inside the Vercel Sandbox microVM. */

export const INSTALL_PLAYWRIGHT_SH = `set -euo pipefail
mkdir -p /tmp/cu /tmp/cu-profile /tmp/cu-npm
if [ ! -d /tmp/cu-npm/node_modules/playwright ]; then
  cd /tmp/cu-npm
  npm init -y >/dev/null 2>&1
  npm i playwright@1.49.1 --no-fund --no-audit
  npx playwright install --with-deps chromium
fi
`;

export const RUNNER_CJS = `#!/usr/bin/env node
const { chromium } = require('/tmp/cu-npm/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const STATE_PATH = '/tmp/cu/state.json';
const OUT_SHOT = '/tmp/cu/shot.png';
const OUT_META = '/tmp/cu/meta.json';
const PROFILE = '/tmp/cu-profile';

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
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    viewport: { width: 1280, height: 720 },
  });
  try {
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
    await context.close();
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
