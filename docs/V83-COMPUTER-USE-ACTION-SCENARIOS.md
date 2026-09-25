# V-83 / V-84: Computer-use action scenarios

**Date:** 2026-09-25 (Asia/Bangkok)  
**Branch:** `feat/v83-computer-use-vercel-sandbox` (PR [#43](https://github.com/vladchatware/vlad.chat/pull/43))  
**Related:** [`V83-COMPUTER-USE-SPIKE.md`](./V83-COMPUTER-USE-SPIKE.md)

Catalog of desk-control action scenarios for vlad.chat `computer_*` tools on Vercel Sandbox (Playwright/CDP + cua-driver bridge). Maps Grok Bot–style desk control to what this product should support.

## How to read status labels

| Label | Meaning |
|---|---|
| **Observed in our stack** | Present in `lib/computer-use/` types, tools, runner, shooter, cua-bridge, or safety today |
| **Parity target (Grok Bot–style)** | Public Grok Bot / industry desk-control pattern we are matching — **not** a claim that Grok Bot exposes this exact JSON API |
| **Not yet implemented** | Desired or in-progress; not wired end-to-end for the lounge MCP path |

Per-scenario **status**: `implemented` | `partial` | `planned`.

---

## Tools (session surface)

| Tool | Role | Status |
|---|---|---|
| `computer_open` | Create/reuse sandbox desk, open URL, return `viewerUrl` | **implemented** |
| `computer_screenshot` | Observe viewport → `screenshotUrl` / `screenshotId` | **implemented** |
| `computer_act` | One gesture (`ComputerAction`) then fresh shot | **implemented** |
| `computer_handoff` | Structured stop for human takeover | **implemented** |
| `computer_end` | Tear down sandbox / release desk | **implemented** |

Result shape: `ComputerToolResult` in `lib/computer-use/types.ts` (`ok`, `op`, `url`, `title`, `action`, `screenshotUrl`, `screenshotId`, `mimeType`, `width`, `height`, `handoff`, `sandboxName`, `viewerUrl`, `error`, `code`, `budget`).

**Execution path (Observed in our stack):**

1. Prefer **cua-driver** via `sandbox-scripts/cua-bridge.cjs` for screenshot/act when the daemon is up.
2. On non-zero bridge exit → **fallback** to CDP shooter (`shooter.cjs`) / Playwright runner (`runner.cjs`).
3. Live desk: Xvfb + x11vnc + noVNC → public `viewerUrl` (port 6080).

---

## Mouse

### Click (left)

| Field | Value |
|---|---|
| **Name** | Left click at coordinates |
| **What user/agent sees** | Pointer click on page/desk; post-act screenshot and/or live noVNC motion |
| **Tool / mechanism** | `computer_act` → `{ type: "click", x, y, button?: "left" }` → Playwright `page.mouse.click` / cua `click` |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack.** Coords are viewport- or window-local depending on path (CDP vs cua window target). |

### Double-click

| Field | Value |
|---|---|
| **Name** | Double-click |
| **What user/agent sees** | Two clicks (open file, select word, etc.) |
| **Tool / mechanism** | Not a first-class `ComputerAction`. cua-bridge forwards `count` on `click` when present; Playwright runner is single-click only |
| **Status** | **partial** |
| **Notes** | **Parity target:** cua / desk drivers often expose `double_click` or `count: 2`. **Not yet implemented** as `type: "double_click"` in public schema. Workaround: two sequential `computer_act` clicks (2 steps). |

### Right-click / middle-click

| Field | Value |
|---|---|
| **Name** | Context menu / middle button |
| **What user/agent sees** | Context menu or middle-button behavior |
| **Tool / mechanism** | `computer_act` → `{ type: "click", x, y, button: "right" \| "middle" }`; cua maps right → `right_click` |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack** (schema + runner + bridge). |

### Move / hover

| Field | Value |
|---|---|
| **Name** | Pointer move without click |
| **What user/agent sees** | Hover menus, tooltips |
| **Tool / mechanism** | No `ComputerAction` for move. Scroll moves then wheels; drag moves between points. cua-driver exposes `move_cursor` |
| **Status** | **planned** |
| **Notes** | **Parity target (Grok Bot–style / cua).** Add `{ type: "move", x, y }` when a flow needs hover-only. |

### Drag

| Field | Value |
|---|---|
| **Name** | Click-drag |
| **What user/agent sees** | Drag gesture (slider, reorder, select) then screenshot |
| **Tool / mechanism** | `computer_act` → `{ type: "drag", fromX, fromY, toX, toY }` → Playwright mouse down/move/up; cua `drag` (`from_x`…`to_y`) |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack.** cua `duration_ms` / steps not exposed on our JSON yet. |

### Scroll / wheel

| Field | Value |
|---|---|
| **Name** | Scroll at point |
| **What user/agent sees** | Page/desk scrolls |
| **Tool / mechanism** | `computer_act` → `{ type: "scroll", x, y, deltaX?, deltaY? }` → Playwright `mouse.wheel`; cua maps deltas → `direction` + `amount` |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack.** |

### Press-and-hold

| Field | Value |
|---|---|
| **Name** | Hold mouse button (long-press) |
| **What user/agent sees** | Long-press menus / continuous press |
| **Tool / mechanism** | Not in `ComputerAction`. Some CUA stacks expose hold; typed cua-driver desktop often lacks held mouse |
| **Status** | **planned** |
| **Notes** | **Parity target** where UX needs it; **Not yet implemented.** Prefer drag or click unless a site requires hold. |

---

## Keyboard

### Type text

| Field | Value |
|---|---|
| **Name** | Type into focused field |
| **What user/agent sees** | Characters appear; screenshot after |
| **Tool / mechanism** | `computer_act` → `{ type: "type", text }` → Playwright `keyboard.type`; cua `type_text` (bridge may accept optional x,y) |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack.** `looksLikePaymentOrSigning(text)` refuses pay/sign phrases and returns `computer_handoff`. |

### Key / hotkey chords

| Field | Value |
|---|---|
| **Name** | Single key or chord |
| **What user/agent sees** | Enter / Tab / Escape / Ctrl·Cmd shortcuts |
| **Tool / mechanism** | `computer_act` → `{ type: "key", key }` → Playwright `keyboard.press`; cua `press_key`, or `hotkey` when `key` contains `+` (bridge `mapKey`) |
| **Status** | **implemented** (chords **partial** on Playwright path; stronger on cua-bridge) |
| **Notes** | **Observed in our stack.** Prefer `Control+c` / `Meta+a` style strings for bridge hotkeys. |

### Focus-before-type discipline

| Field | Value |
|---|---|
| **Name** | Click field, then type |
| **What user/agent sees** | Agent screenshots → clicks input → types (multi-step) |
| **Tool / mechanism** | Loop: `computer_screenshot` → `computer_act` click → `computer_act` type. cua `type_text` with x,y can focus+type in one call (bridge supports; public `type` schema has no coords yet) |
| **Status** | **partial** |
| **Notes** | **Parity target:** screenshot → act → verify. Each act counts toward the 20-step cap. |

---

## Session / navigation

### Open URL

| Field | Value |
|---|---|
| **Name** | Open public URL on desk browser |
| **What user/agent sees** | `viewerUrl` (live noVNC); url/title in result; shot often deferred to `computer_screenshot` |
| **Tool / mechanism** | `computer_open` `{ url }` |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack.** Open may still return `viewerUrl` if navigate runner exits 137 (V-84 hardening). |

### Screenshot / observe

| Field | Value |
|---|---|
| **Name** | Capture viewport for grounding |
| **What user/agent sees** | `screenshotUrl` / `screenshotId` (JPEG preferred, ~640px) |
| **Tool / mechanism** | `computer_screenshot`; post-act shot via shooter (or cua window/desktop capture) |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack.** Clients render URL — not megabyte base64 (mobile ~4k tool-output cap). |

### Wait

| Field | Value |
|---|---|
| **Name** | Pause for load / animation |
| **What user/agent sees** | Brief delay then continue |
| **Tool / mechanism** | `computer_act` → `{ type: "wait", ms? }` (capped ≤10s in runner/bridge) |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack.** Still consumes a step. |

### End session

| Field | Value |
|---|---|
| **Name** | Tear down desk |
| **What user/agent sees** | `viewerUrl` dies; sandbox stopped/deleted |
| **Tool / mechanism** | `computer_end` |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack.** Always call when the browser task is done. |

### Live watch / control (`viewerUrl`)

| Field | Value |
|---|---|
| **Name** | Human watches or drives the same desk |
| **What user/agent sees** | HTTPS noVNC (`…/vnc.html?autoconnect=1&resize=scale`) on sandbox port 6080 |
| **Tool / mechanism** | `viewerUrl` on open / screenshot / act / handoff results |
| **Status** | **implemented** (V-84 acceptance gate) |
| **Notes** | **Observed in our stack.** **Parity target:** Grok Bot Agent Computer preview / take over. Screenshot-only is **not** enough for acceptance. |

---

## Takeover / handoff (critical)

### When to stop for the human

| Field | Value |
|---|---|
| **Name** | Sensitive-step handoff |
| **What user/agent sees** | Structured `handoff`: `{ type: "computer_handoff", reason, message, requiresUser: true }` plus optional shot + `viewerUrl` |
| **Tool / mechanism** | `computer_handoff` `{ reason, message? }` with `reason`: `sso` \| `2fa` \| `captcha` \| `payment` \| `signing` \| `unknown`. Auto-refuse when `type` text matches `looksLikePaymentOrSigning` |
| **Status** | **implemented** (protocol); client cards on web/iOS **partial** |
| **Notes** | **Observed in our stack.** **Parity target (public Grok Bot docs):** password/passkey, 2FA, CAPTCHA, payment/identity, site requires human — open computer, take control, complete only the blocked step, tell the Bot to continue. Never paste passwords/OTPs into chat. Grok Bot also uses in-chat forms / secure secret request / `request_box_help`; vlad.chat maps the **desk** half to `computer_handoff` + `viewerUrl`. |

### How `viewerUrl` / noVNC fits

| Field | Value |
|---|---|
| **Name** | Human control of live desk |
| **What user/agent sees** | Same headed Chromium on the agent display; clicks/typing in noVNC move the desk |
| **Tool / mechanism** | Desk boot: Xvfb + x11vnc + websockify/noVNC + Chromium CDP `:9222` |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack** (spike Live VNC acceptance). |

### Resume after user finishes

| Field | Value |
|---|---|
| **Name** | Agent continues after takeover |
| **What user/agent sees** | User finishes in viewer; tells agent to continue; agent `computer_screenshot` / `computer_act` on **same** session |
| **Tool / mechanism** | No `computer_resume` tool. Session keyed by user/chat until TTL (8 min), idle reclaim (90s), step limit (20), or `computer_end` |
| **Status** | **partial** |
| **Notes** | **Parity target:** Grok Bot “return control and tell the Bot to continue.” **Not yet implemented:** explicit resume/ack event, sticky “user still controlling” lock, or long-lived signed-in profile like Grok’s persistent cloud PC. After TTL/idle → `computer_open` again (**new** short session). |

### Sticky permissions / SSO persistence

| Field | Value |
|---|---|
| **Name** | Signed-in sessions across tasks |
| **What user/agent sees** | Grok Bot: shared persistent computer cookies. vlad.chat: ephemeral sandbox profile |
| **Tool / mechanism** | Non-persistent sandbox; profile dies with `computer_end` / TTL |
| **Status** | **planned** |
| **Notes** | **Parity target** only. Warm `COMPUTER_USE_SNAPSHOT_ID` helps cold start, not cross-task SSO. |

---

## Safety scenarios

### Never silent pay / sign

| Field | Value |
|---|---|
| **Name** | Fail closed on payment and signing |
| **What user/agent sees** | Act refused with `handoff.reason: "payment"` (or signing copy); user must take over |
| **Tool / mechanism** | `looksLikePaymentOrSigning` on `type` text; `computer_handoff` for payment/signing/SSO/2FA/captcha |
| **Status** | **implemented** (heuristic on type; click “Pay now” still agent-discipline + handoff tool) |
| **Notes** | **Observed in our stack.** Clicking Pay is not regex-blocked — agent must call `computer_handoff`. **Parity:** Grok Bot approvals / takeover for payment. |

### Step / TTL / idle caps

| Field | Value |
|---|---|
| **Name** | Operational budgets |
| **What user/agent sees** | `ok: false` + `code`: `step_limit` | `ttl_exceeded` | `budget_exceeded` (also `disabled` | `auth_missing` | `runtime`); `budget` on success |
| **Tool / mechanism** | 8 min TTL, 20 steps/session, 1 concurrent/key, 90s idle reclaim (`sandbox.ts` constants) |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack.** Default **OFF** (`COMPUTER_USE_ENABLED`). |

### Fallback cua-driver → CDP / Playwright

| Field | Value |
|---|---|
| **Name** | Prefer Driver, fall back to CDP runner/shooter |
| **What user/agent sees** | Same `computer_*` JSON; meta may note `via: "cua-driver"` when bridge succeeds |
| **Tool / mechanism** | `INSTALL_CUA_SH` + `cua-bridge.cjs`; on bridge failure → `shooter.cjs` / `runner.cjs` |
| **Status** | **partial** → trending **implemented** (prefer-bridge wired in `runComputerOp`; install non-fatal) |
| **Notes** | **Observed in our stack** for both paths. Treat as **partial** until Preview acceptance proves bridge-first reliably. |

### Feature flag / auth missing

| Field | Value |
|---|---|
| **Name** | Disabled or no sandbox creds |
| **What user/agent sees** | Tools absent from MCP or `code: disabled` / `auth_missing` |
| **Tool / mechanism** | `COMPUTER_USE_ENABLED` + OIDC or `VERCEL_TOKEN` + team + project |
| **Status** | **implemented** |
| **Notes** | **Observed in our stack.** |

---

## Agent loop pattern (parity)

**Parity target (Grok Bot–style / box-desktop skill):**

1. Open destination (`computer_open`).
2. Observe (`computer_screenshot` or post-act shot).
3. One action (`computer_act`).
4. Verify on next shot / `viewerUrl`.
5. On SSO / 2FA / captcha / payment / signing → `computer_handoff`; human uses `viewerUrl`; continue or `computer_end`.

Do **not** invent silent credential pastes. Prefer connectors/MCP when a site has one; computer-use is for no-connector / visual flows.

---

## Grok Bot parity (summary table)

Parity column grounded in public docs ([Use the computer and apps](https://docs.x.ai/docs/grok-bot/computer-and-apps), [Approvals, security, and privacy](https://docs.x.ai/docs/grok-bot/approvals-security-and-privacy), takeover guides), box-desktop / managed skills (`request_box_help`, screenshot→act), and Hermes/cua-driver action model. **Not** private Grok Bot internals.

| Scenario | Grok Bot–style pattern | vlad.chat status |
|---|---|---|
| Live desk preview | Agent Computer preview | **implemented** (`viewerUrl` noVNC) |
| Human takeover (login/2FA/captcha/pay) | Take over → finish step → continue | **implemented** protocol; resume UX **partial** |
| Left / right / middle click | Desktop pointer | **implemented** |
| Double-click | Common desk action | **partial** / **planned** first-class |
| Move / hover | Pointer move | **planned** |
| Drag | Drag gesture | **implemented** |
| Scroll | Wheel / scroll | **implemented** |
| Press-and-hold | Occasional long-press | **planned** (low priority) |
| Type text | Keyboard entry | **implemented** |
| Hotkeys | Chords | **partial** (stronger on cua-bridge) |
| Focus then type | Click field then type | **partial** (multi-step; coords on `type` **planned**) |
| Open URL | Browser navigate | **implemented** |
| Screenshot observe | Screen grounding | **implemented** |
| Wait | Settle UI | **implemented** |
| End / reclaim desk | Stop cloud work | **implemented** |
| Never silent pay/sign | Approvals + takeover | **implemented** (handoff + type heuristic) |
| Persistent signed-in PC | Shared always-on computer | **planned** (ephemeral sandbox today) |
| cua-driver primary path | Native desk driver | **partial** (prefer-bridge + CDP fallback) |
| Step/TTL caps | Usage / session limits | **implemented** (8 min / 20 steps) |
| In-chat password form (non-desk) | Secure form / credential request | **Not yet implemented** in computer-use module (out of scope here) |

---

## Implemented vs planned (checklist)

### Implemented

- Tools: `computer_open`, `computer_screenshot`, `computer_act`, `computer_handoff`, `computer_end`
- Actions: click (left/right/middle), type, key, scroll, drag, wait
- `viewerUrl` live noVNC desk
- Handoff reasons + payment/signing type refuse
- Caps: TTL / steps / idle / concurrent; fail-closed codes
- CDP Playwright runner + light shooter; screenshot artifact URLs
- cua-bridge install + prefer path with CDP fallback (acceptance still proving)

### Partial

- Hotkey chords (bridge > Playwright)
- Double-click (`count` in bridge only)
- Focus-before-type as one protocol call
- Resume-after-handoff (same session only; no resume event)
- cua-driver prefer reliability on Preview
- Client handoff/screenshot card polish (web + iOS)

### Planned / not yet implemented

- First-class `move` / hover, `double_click`, press-and-hold
- Durable SSO profile / persistent desk parity
- Explicit `computer_resume` or user-control lock
- Optional `type` with x,y focus in public schema
- In-module secure password form (Grok-style); keep using product auth paths outside computer-use

---

## File map

| Path | Role |
|---|---|
| `lib/computer-use/types.ts` | `ComputerAction`, handoff, `ComputerToolResult` |
| `lib/computer-use/tools.ts` / `mcp-tools.ts` | AI SDK + MCP tool registration |
| `lib/computer-use/sandbox.ts` | Session, caps, prefer-cua + CDP fallback |
| `lib/computer-use/safety.ts` | Pay/sign heuristics + handoff copy |
| `lib/computer-use/sandbox-scripts/runner.cjs` | CDP Playwright actions |
| `lib/computer-use/sandbox-scripts/shooter.cjs` | Light screenshot |
| `lib/computer-use/sandbox-scripts/cua-bridge.cjs` | cua-driver mapping |
| `docs/V83-COMPUTER-USE-SPIKE.md` | Infra / GO decision / VNC acceptance |

---

## Skills pointer

See also [`skills/computer-use/SKILL.md`](../skills/computer-use/SKILL.md) (agent loop). That skill should link here for the full scenario catalog — do not duplicate it there.
