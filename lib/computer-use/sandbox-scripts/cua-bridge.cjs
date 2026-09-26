#!/usr/bin/env node
'use strict';
/**
 * cua-driver bridge for Vercel Sandbox desk.
 * Prefer Driver for screenshot/act; caller falls back to shooter/runner on non-zero exit.
 *
 * Usage:
 *   node cua-bridge.cjs refresh-target
 *   node cua-bridge.cjs screenshot
 *   node cua-bridge.cjs act '{"type":"click","x":10,"y":20}'
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CU = '/tmp/cu';
const TARGET_PATH = path.join(CU, 'cua-target.json');
const STATE_PATH = path.join(CU, 'state.json');
const OUT_SHOT_PNG = path.join(CU, 'shot.png');
const OUT_SHOT_JPG = path.join(CU, 'shot.jpg');
const OUT_META = path.join(CU, 'meta.json');
const MAX_DIM = 640;

function ensureDir() {
  fs.mkdirSync(CU, { recursive: true });
}

function envForCua() {
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':99' };
  const homeBin = path.join(process.env.HOME || '/root', '.local', 'bin');
  env.PATH = homeBin + ':' + (env.PATH || '');
  try {
    const dbus = fs.readFileSync(path.join(CU, 'dbus.env'), 'utf8');
    for (const line of dbus.split('\n')) {
      const m = line.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
        v = v.slice(1, -1);
      }
      // unquote shell $'...' lightly — dbus-launch --sh-syntax uses quotes
      env[m[1]] = v.replace(/\\(.)/g, '$1');
    }
  } catch {
    /* optional */
  }
  return env;
}

function writeMeta(m) {
  ensureDir();
  fs.writeFileSync(OUT_META, JSON.stringify(m));
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { url: 'about:blank', title: '' };
  }
}

function readTarget() {
  try {
    return JSON.parse(fs.readFileSync(TARGET_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeTarget(t) {
  ensureDir();
  fs.writeFileSync(TARGET_PATH, JSON.stringify(t));
}

function cuaBin() {
  const env = envForCua();
  const which = spawnSync('bash', ['-lc', 'command -v cua-driver'], {
    env,
    encoding: 'utf8',
  });
  const p = (which.stdout || '').trim();
  if (which.status === 0 && p) return p;
  const fallback = path.join(process.env.HOME || '', '.local', 'bin', 'cua-driver');
  if (fs.existsSync(fallback)) return fallback;
  throw new Error('cua-driver not on PATH');
}

function cuaStatusOk() {
  try {
    const r = spawnSync(cuaBin(), ['status'], {
      env: envForCua(),
      encoding: 'utf8',
      timeout: 8000,
    });
    return r.status === 0 && /running/i.test(r.stdout || '');
  } catch {
    return false;
  }
}

function cuaCall(tool, args, timeoutMs) {
  const bin = cuaBin();
  const payload = JSON.stringify(args || {});
  const r = spawnSync(bin, ['call', tool, payload], {
    env: envForCua(),
    encoding: 'utf8',
    timeout: timeoutMs || 45000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();
  if (r.status !== 0) {
    throw new Error(err || out || 'cua-driver call failed: ' + tool);
  }
  if (!out) return {};
  try {
    return JSON.parse(out);
  } catch {
    // Some tools print ✅ text + JSON; try last {...}
    const i = out.lastIndexOf('{');
    if (i >= 0) {
      try {
        return JSON.parse(out.slice(i));
      } catch {
        /* fallthrough */
      }
    }
    return { raw: out };
  }
}

function isChromeish(name, title) {
  const s = String(name || '') + ' ' + String(title || '');
  return /chrom|chrome|chromium/i.test(s);
}

function pickChromeWindow(windows) {
  const list = Array.isArray(windows) ? windows : [];
  const chrome = list.filter((w) => isChromeish(w.app_name, w.title) && w.pid && w.window_id);
  if (!chrome.length) return null;
  // Prefer highest z_index when available
  chrome.sort((a, b) => {
    const za = typeof a.z_index === 'number' ? a.z_index : -1;
    const zb = typeof b.z_index === 'number' ? b.z_index : -1;
    return zb - za;
  });
  const w = chrome[0];
  return {
    pid: w.pid,
    window_id: w.window_id,
    title: w.title || '',
    app_name: w.app_name || '',
    bounds: w.bounds || null,
  };
}

function refreshTarget() {
  if (!cuaStatusOk()) throw new Error('cua-driver daemon not running');
  let windows = [];
  try {
    const res = cuaCall('list_windows', { on_screen_only: true }, 20000);
    windows = res.windows || res || [];
    if (!Array.isArray(windows) && res.windows) windows = res.windows;
  } catch (e) {
    const res = cuaCall('list_windows', {}, 20000);
    windows = res.windows || [];
  }
  if (!Array.isArray(windows)) windows = [];
  let target = pickChromeWindow(windows);
  if (!target) {
    // Try list_apps for running chrome pid, then list_windows by pid
    try {
      const apps = cuaCall('list_apps', {}, 20000);
      const arr = apps.apps || apps || [];
      const list = Array.isArray(arr) ? arr : [];
      const chromeApp = list.find(
        (a) => a.running && a.pid && isChromeish(a.name || a.app_name || a.bundle_id, ''),
      );
      if (chromeApp && chromeApp.pid) {
        const byPid = cuaCall('list_windows', { pid: chromeApp.pid }, 20000);
        target = pickChromeWindow(byPid.windows || []);
        if (!target && chromeApp.windows && chromeApp.windows.length) {
          const w = chromeApp.windows[0];
          target = {
            pid: chromeApp.pid,
            window_id: w.window_id,
            title: w.title || '',
            app_name: chromeApp.name || 'chromium',
            bounds: w.bounds || null,
          };
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (!target) throw new Error('no Chromium window for cua-target');
  writeTarget(target);
  return target;
}

function ensureTarget() {
  const existing = readTarget();
  if (existing && existing.pid && existing.window_id) return existing;
  return refreshTarget();
}

function normalizeShotFile(srcPath) {
  // Prefer PNG at shot.png; drop stale jpg so meta mime is honest.
  try {
    if (fs.existsSync(OUT_SHOT_JPG)) fs.unlinkSync(OUT_SHOT_JPG);
  } catch {
    /* ignore */
  }
  if (srcPath !== OUT_SHOT_PNG) {
    fs.copyFileSync(srcPath, OUT_SHOT_PNG);
  }
  return OUT_SHOT_PNG;
}

function doScreenshot() {
  if (!cuaStatusOk()) throw new Error('cua-driver daemon not running');
  ensureDir();
  const st = readState();
  let via = 'cua-driver';
  let info = {};

  // Prefer window capture (matches click window-local coords).
  try {
    const t = ensureTarget();
    const tmp = path.join(CU, 'cua-shot-raw.png');
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    const res = cuaCall(
      'get_window_state',
      {
        pid: t.pid,
        window_id: t.window_id,
        include_accessibility_tree: false,
        include_screenshot: true,
        max_image_dimension: MAX_DIM,
        screenshot_out_file: tmp,
      },
      60000,
    );
    const filePath = res.screenshot_file_path || tmp;
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 32) {
      throw new Error('empty window screenshot');
    }
    normalizeShotFile(filePath);
    info = {
      url: st.url || 'about:blank',
      title: res.window_title || t.title || st.title || '',
      width: res.screenshot_width || MAX_DIM,
      height: res.screenshot_height || undefined,
      pid: t.pid,
      window_id: t.window_id,
    };
    via = 'cua-driver';
  } catch (winErr) {
    // Full-desk fallback
    const tmp = path.join(CU, 'cua-desk-raw.png');
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    const res = cuaCall(
      'get_desktop_state',
      {
        max_image_dimension: MAX_DIM,
        screenshot_out_file: tmp,
      },
      60000,
    );
    const filePath = res.screenshot_file_path || tmp;
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 32) {
      throw new Error(
        'window shot failed (' + String(winErr && winErr.message) + '); desktop shot empty',
      );
    }
    normalizeShotFile(filePath);
    info = {
      url: st.url || 'about:blank',
      title: st.title || '',
      width: res.screenshot_width || MAX_DIM,
      height: res.screenshot_height || undefined,
      deskFallback: true,
      windowError: String(winErr && winErr.message).slice(0, 200),
    };
    via = 'cua-driver';
  }

  const meta = {
    ok: true,
    url: info.url,
    title: info.title,
    action: 'screenshot',
    width: info.width,
    height: info.height,
    mimeType: 'image/png',
    shot: true,
    via,
    pid: info.pid,
    window_id: info.window_id,
    deskFallback: info.deskFallback || false,
  };
  writeMeta(meta);
  process.stdout.write(JSON.stringify(meta));
}

function mapKey(key) {
  const k = String(key || '');
  const aliases = {
    Enter: 'return',
    Return: 'return',
    Escape: 'escape',
    Esc: 'escape',
    Backspace: 'backspace',
    Tab: 'tab',
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Space: 'space',
    ' ': 'space',
  };
  return aliases[k] || k.toLowerCase();
}

function doAct(action) {
  if (!cuaStatusOk()) throw new Error('cua-driver daemon not running');
  const t = ensureTarget();
  const type = action && action.type;
  if (!type) throw new Error('action.type required');

  const base = { pid: t.pid, window_id: t.window_id };

  switch (type) {
    case 'click': {
      const button = action.button || 'left';
      if (button === 'right') {
        cuaCall('right_click', { ...base, x: action.x, y: action.y }, 30000);
      } else {
        cuaCall(
          'click',
          {
            ...base,
            x: action.x,
            y: action.y,
            button: button === 'middle' ? 'middle' : 'left',
            count: action.count || 1,
          },
          30000,
        );
      }
      break;
    }
    case 'type': {
      const args = { ...base, text: String(action.text || '') };
      if (typeof action.x === 'number' && typeof action.y === 'number') {
        args.x = action.x;
        args.y = action.y;
      }
      cuaCall('type_text', args, 60000);
      break;
    }
    case 'key': {
      const key = mapKey(action.key);
      // Chord like Control+c → hotkey
      if (String(action.key || '').includes('+')) {
        const parts = String(action.key)
          .split('+')
          .map((p) => mapKey(p.trim()));
        cuaCall('hotkey', { ...base, keys: parts }, 30000);
      } else {
        cuaCall('press_key', { ...base, key }, 30000);
      }
      break;
    }
    case 'scroll': {
      const dx = Number(action.deltaX || 0);
      const dy = Number(action.deltaY || 0);
      let direction = 'down';
      let amount = 3;
      if (Math.abs(dy) >= Math.abs(dx)) {
        direction = dy < 0 ? 'up' : 'down';
        amount = Math.min(50, Math.max(1, Math.round(Math.abs(dy) / 40) || 3));
      } else {
        direction = dx < 0 ? 'left' : 'right';
        amount = Math.min(50, Math.max(1, Math.round(Math.abs(dx) / 40) || 3));
      }
      const args = { ...base, direction, amount, by: 'line' };
      if (typeof action.x === 'number' && typeof action.y === 'number') {
        args.x = action.x;
        args.y = action.y;
      }
      cuaCall('scroll', args, 30000);
      break;
    }
    case 'drag': {
      cuaCall(
        'drag',
        {
          ...base,
          from_x: action.fromX,
          from_y: action.fromY,
          to_x: action.toX,
          to_y: action.toY,
        },
        45000,
      );
      break;
    }
    case 'wait': {
      const ms = Math.min(Number(action.ms || 1000), 10000);
      spawnSync('bash', ['-lc', 'sleep ' + (ms / 1000).toFixed(3)], { timeout: ms + 2000 });
      break;
    }
    default:
      throw new Error('Unknown action type for cua-bridge: ' + type);
  }

  const st = readState();
  const meta = {
    ok: true,
    url: st.url || 'about:blank',
    title: st.title || t.title || '',
    action: type,
    shot: false,
    via: 'cua-driver',
    pid: t.pid,
    window_id: t.window_id,
  };
  writeMeta(meta);
  process.stdout.write(JSON.stringify(meta));
}

function main() {
  ensureDir();
  const op = process.argv[2] || '';
  try {
    if (op === 'refresh-target') {
      const t = refreshTarget();
      const meta = { ok: true, action: 'refresh-target', via: 'cua-driver', ...t };
      writeMeta(meta);
      process.stdout.write(JSON.stringify(meta));
      return;
    }
    if (op === 'screenshot') {
      doScreenshot();
      return;
    }
    if (op === 'act') {
      const action = JSON.parse(process.argv[3] || '{}');
      doAct(action);
      return;
    }
    throw new Error('usage: cua-bridge.cjs refresh-target|screenshot|act <json>');
  } catch (e) {
    writeMeta({ ok: false, error: String((e && e.message) || e), via: 'cua-driver' });
    console.error(e);
    process.exit(1);
  }
}

main();
