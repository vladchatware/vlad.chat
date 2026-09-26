#!/usr/bin/env node
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/tmp/cu-browsers';
const { chromium } = require('/tmp/cu-npm/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const STATE_PATH = '/tmp/cu/state.json';
const OUT_META = '/tmp/cu/meta.json';
const CDP = process.env.CU_CDP_URL || 'http://127.0.0.1:9222';

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { url: 'about:blank' };
  }
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
  // Attach only — never launch a second Chromium (desk already owns :9222).
  const browser = await chromium.connectOverCDP(CDP);
  try {
    const context =
      browser.contexts()[0] ||
      (await browser.newContext({
        viewport: { width: 1024, height: 720 },
      }));
    const page = context.pages()[0] || (await context.newPage());
    if (state.url && state.url !== 'about:blank' && page.url() === 'about:blank') {
      await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }
    const result = await fn(page, state);
    const url = page.url();
    const title = await page.title().catch(() => '');
    writeState({ url, title });
    writeMeta({
      ok: true,
      url,
      title,
      action: result && result.action ? result.action : 'ok',
      shot: false,
      shotSkipped: true,
    });
    process.stdout.write(
      JSON.stringify({
        ok: true,
        url,
        title,
        action: result && result.action,
        shot: false,
        shotSkipped: true,
      }),
    );
  } finally {
    // Leave CDP socket to GC on process exit. Do not browser.close() —
    // some Playwright builds tear down the remote target when closing.
  }
}

async function main() {
  const cmd = JSON.parse(process.argv[2] || '{"op":"open"}');
  if (cmd.op === 'open') {
    await withPage(async (page) => {
      await page.goto(cmd.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return { action: 'open' };
    });
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
          await page.keyboard.type(a.text, { delay: 15 });
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
          await page.mouse.move(a.toX, a.toY, { steps: 8 });
          await page.mouse.up();
          break;
        default:
          throw new Error('Unknown action type: ' + a.type);
      }
      await page.waitForTimeout(250);
      return { action: a.type };
    });
    return;
  }
  throw new Error('Unknown op (use shooter.cjs for screenshot): ' + cmd.op);
}

main().catch((err) => {
  writeMeta({ ok: false, error: String((err && err.message) || err) });
  console.error(err);
  process.exit(1);
});
