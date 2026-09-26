#!/usr/bin/env node
'use strict';
/**
 * Tiny CDP JPEG capture — no Playwright.
 * Playwright connectOverCDP + page.screenshot was SIGKILL 137 on Vercel Sandbox
 * when headed desk Chromium was already resident.
 */
const fs = require('fs');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');

const STATE_PATH = '/tmp/cu/state.json';
const OUT_SHOT = '/tmp/cu/shot.jpg';
const OUT_META = '/tmp/cu/meta.json';
const CDP_HTTP = process.env.CU_CDP_URL || 'http://127.0.0.1:9222';
const SHOT_W = 640;
const SHOT_H = 400;
const SHOT_Q = 30;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { url: 'about:blank' };
  }
}

function writeMeta(m) {
  fs.mkdirSync(path.dirname(OUT_META), { recursive: true });
  fs.writeFileSync(OUT_META, JSON.stringify(m));
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let d = '';
      res.on('data', (c) => {
        d += c;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('http timeout'));
    });
  });
}

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect({ host: u.hostname, port: Number(u.port) || 80 }, () => {
      sock.write(
        'GET ' +
          u.pathname +
          u.search +
          ' HTTP/1.1\r\n' +
          'Host: ' +
          u.host +
          '\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' +
          key +
          '\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n',
      );
    });
    let buf = Buffer.alloc(0);
    let upgraded = false;
    const pending = new Map();
    let nextId = 1;

    function frame(payloadBuf) {
      const mask = crypto.randomBytes(4);
      const len = payloadBuf.length;
      let header;
      if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81;
        header[1] = 0x80 | len;
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 0x80 | 127;
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(len, 6);
      }
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) masked[i] = payloadBuf[i] ^ mask[i % 4];
      return Buffer.concat([header, mask, masked]);
    }

    function send(method, params) {
      const id = nextId++;
      const body = Buffer.from(JSON.stringify({ id, method, params: params || {} }));
      sock.write(frame(body));
      return new Promise((res, rej) => {
        const t = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            rej(new Error('CDP timeout: ' + method));
          }
        }, 15000);
        pending.set(id, { res, rej, t });
      });
    }

    function handlePayload(payload) {
      let msg;
      try {
        msg = JSON.parse(payload.toString());
      } catch {
        return;
      }
      if (msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.t);
        if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
        else p.res(msg.result || {});
      }
    }

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx < 0) return;
        const head = buf.slice(0, idx).toString();
        if (!/\s101\s/.test(head)) {
          reject(new Error('WS upgrade failed: ' + head.slice(0, 180)));
          sock.destroy();
          return;
        }
        upgraded = true;
        buf = buf.slice(idx + 4);
        resolve({
          send,
          close() {
            try {
              sock.destroy();
            } catch {
              /* ignore */
            }
          },
        });
      }
      while (upgraded && buf.length >= 2) {
        const b0 = buf[0];
        const b1 = buf[1];
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          const hi = buf.readUInt32BE(2);
          const lo = buf.readUInt32BE(6);
          if (hi !== 0) {
            sock.destroy();
            return;
          }
          len = lo;
          off = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < off + maskLen + len) return;
        let payload = buf.slice(off + maskLen, off + maskLen + len);
        if (masked) {
          const m = buf.slice(off, off + 4);
          const out = Buffer.alloc(len);
          for (let i = 0; i < len; i++) out[i] = payload[i] ^ m[i % 4];
          payload = out;
        }
        buf = buf.slice(off + maskLen + len);
        if (opcode === 0x8) {
          sock.destroy();
          return;
        }
        if (opcode === 0x9) {
          const pongHdr = Buffer.from([0x8a, payload.length & 0x7f]);
          sock.write(Buffer.concat([pongHdr, payload]));
          continue;
        }
        if (opcode === 0x1 || opcode === 0x2) handlePayload(payload);
      }
    });
    sock.on('error', reject);
    sock.setTimeout(20000, () => {
      reject(new Error('WS socket timeout'));
      sock.destroy();
    });
  });
}

async function cdpShot() {
  const base = CDP_HTTP.replace(/\/$/, '');
  const targets = await httpJson(base + '/json/list');
  if (!Array.isArray(targets) || !targets.length) throw new Error('no CDP targets');
  const page =
    targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !String(t.url || '').startsWith('chrome-extension:')) ||
    targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ||
    targets.find((t) => t.webSocketDebuggerUrl && t.type !== 'service_worker' && t.type !== 'background_page') ||
    targets.find((t) => t.webSocketDebuggerUrl);
  if (!page || !page.webSocketDebuggerUrl) throw new Error('no page websocket');
  const ws = await connectWs(page.webSocketDebuggerUrl);
  try {
    await ws.send('Page.enable').catch(() => {});
    const result = await ws.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: SHOT_Q,
      fromSurface: true,
      clip: { x: 0, y: 0, width: SHOT_W, height: SHOT_H, scale: 1 },
    });
    if (!result || !result.data) throw new Error('empty CDP screenshot');
    fs.writeFileSync(OUT_SHOT, Buffer.from(result.data, 'base64'));
    return {
      url: page.url || readState().url || 'about:blank',
      title: page.title || readState().title || '',
      via: 'cdp',
    };
  } finally {
    ws.close();
  }
}

function x11Shot() {
  const env = { ...process.env, DISPLAY: ':99' };
  try {
    execFileSync(
      'scrot',
      ['-a', '0,0,' + SHOT_W + ',' + SHOT_H, '-q', String(SHOT_Q), OUT_SHOT],
      {
        env,
        timeout: 12000,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    if (fs.existsSync(OUT_SHOT) && fs.statSync(OUT_SHOT).size > 32) {
      const st = readState();
      return { url: st.url || 'about:blank', title: st.title || '', via: 'scrot' };
    }
  } catch (e) {
    try {
      fs.writeFileSync('/tmp/cu/shot.err', 'scrot: ' + String((e && e.message) || e));
    } catch {
      /* ignore */
    }
  }
  return null;
}

(async () => {
  fs.mkdirSync('/tmp/cu', { recursive: true });
  let info = null;
  let err = null;
  try {
    info = await cdpShot();
  } catch (e) {
    err = e;
    try {
      fs.writeFileSync('/tmp/cu/shot.err', 'cdp: ' + String((e && e.stack) || e));
    } catch {
      /* ignore */
    }
    info = x11Shot();
  }
  if (!info) {
    writeMeta({ ok: false, error: String((err && err.message) || err || 'screenshot failed') });
    process.exit(1);
  }
  const meta = {
    ok: true,
    url: info.url,
    title: info.title,
    action: 'screenshot',
    width: SHOT_W,
    height: SHOT_H,
    mimeType: 'image/jpeg',
    shot: true,
    via: info.via,
  };
  writeMeta(meta);
  process.stdout.write(JSON.stringify(meta));
  process.exit(0);
})().catch((e) => {
  writeMeta({ ok: false, error: String((e && e.message) || e) });
  console.error(e);
  process.exit(1);
});
