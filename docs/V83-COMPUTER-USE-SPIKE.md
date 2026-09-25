# V-83 Spike: Computer use for vlad.chat on Vercel Sandbox (Hermes path)

**Date:** 2026-09-25 (Asia/Bangkok)  
**Status:** **GO — Playwright desk + in-sandbox cua-driver** (live create may need Vercel creds)  
**Draft:** `feat/v83-computer-use-vercel-sandbox` in `vlad.chat/` (see Draft section)

## Verdict

| Question | Answer |
|---|---|
| Can Vercel Sandbox host Grok-like computer use for vlad.chat? | **YES, via Playwright (headless Chromium) inside the microVM** |
| Native GUI / cua-driver / desktop in Sandbox? | **YES (V-84+)** — Xvfb+noVNC desk; **cua-driver** installed in-sandbox for shot/act |
| Hermes `vercel_sandbox.py` computer-use? | **NO** — terminal-only; vlad.chat now runs **cua-driver inside** the Sandbox desk |
| Live create→screenshot→act→destroy on this box? | **Blocked** — no Vercel OIDC/token credentials here |

## Product constraint: one backend, two clients

vlad.chat has **web + iOS**, but **one agent/tool loop**. Computer use MUST:

- Live in the **shared backend** (site MCP `/api/mcp` tool registration → Convex `getMcpTools`), not in Next.js UI-only code
- Return **client-agnostic tool JSON** both surfaces can render
- Expose screenshots as **URLs** (or short artifact ids), not megabyte base64 inside the mobile tool-output stream (~4k cap)
- Emit **structured handoff events** (`computer_handoff`) for SSO / 2FA / captcha / payment / signing
- Never silently pay or sign

```
Web / iOS / lounge
  → Convex threads.generateReply
      → getMcpTools → ${NEXT_PUBLIC_SITE_URL}/api/mcp
           ├─ notion-* tools
           └─ computer_* (when COMPUTER_USE_ENABLED + sandbox creds)
                ├─ Vercel Sandbox + Playwright
                ├─ GET /api/computer-use/screenshots/:id
                └─ tool JSON (screenshotUrl, handoff)
Legacy styleguide: POST /api/chat still merges createComputerUseTools.
```

iOS may polish UI later; the **protocol is already shared**.

## Findings (infra)

### Vercel Sandbox gives us
- `Sandbox.create/get/stop/delete`, `runCommand`, `writeFiles`, `readFileToBuffer`
- OIDC (`VERCEL_OIDC_TOKEN`) or access-token triplet (`VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`)
- Firecracker isolation, snapshots, Active CPU billing

### Hermes / dsh — what we still own
| Given | We own |
|---|---|
| Per-task sandbox create/reuse/teardown patterns | Session→sandbox map keyed by user; `computer_end` |
| `runCommand` / files / snapshots | Same via `@vercel/sandbox` + Playwright install/snapshot warm path |
| Terminal backend only | Browser automation layer (Playwright persistent profile) |
| Local cua-driver (Hermes) | **In-sandbox** via INSTALL_CUA_SH + `cua-driver serve` on DISPLAY=:99; CDP/Playwright remains fallback |
| — | Tool wiring, session/step accounting, handoff UX on **both** clients |
| — | Screenshot artifact store (draft: in-process; prod: Blob/R2) |

## Client protocol (tool results)

Every `computer_*` tool returns `ComputerToolResult`:

```ts
{
  ok: boolean
  op: "open" | "screenshot" | "act" | "handoff" | "end"
  url?: string
  title?: string
  action?: string
  screenshotUrl?: string   // prefer — web <img> / iOS URLSession
  screenshotId?: string
  mimeType?: "image/png"
  handoff?: {
    type: "computer_handoff"
    reason: "sso" | "2fa" | "captcha" | "payment" | "signing" | "unknown"
    message: string
    requiresUser: true
  }
  sandboxName?: string
  error?: string
}
```

Tools (feature-flagged): `computer_open`, `computer_screenshot`, `computer_act`, `computer_handoff`, `computer_end`.

## Auth requirements

| Var | When |
|---|---|
| `COMPUTER_USE_ENABLED=1` | Feature flag (off by default) |
| `VERCEL_OIDC_TOKEN` | Local linked project / auto on Vercel |
| `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` | CI / non-Vercel / this spike box |
| `COMPUTER_USE_SNAPSHOT_ID` | Optional warm Playwright image |

**Do not paste tokens in chat.** CTO: secret-request card.

### Preview enable (lounge)

On **Vercel Preview** (Next host that serves `/api/mcp`):

| Var | Value |
|---|---|
| `COMPUTER_USE_ENABLED` | `1` |
| Sandbox auth | OIDC auto on Vercel, or `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` |
| `NEXT_PUBLIC_SITE_URL` | Preview URL Convex should call (or stable preview alias) |

On **Convex** dashboard for that deployment: set `NEXT_PUBLIC_SITE_URL` to the same Preview host so `getMcpTools` hits the MCP that has computer_*. No bridge secret — MCP is the surface.

Leave Production flag off unless intentionally enabling.

## Proof artifacts

| Path | What |
|---|---|
| `/workspace/v83-sandbox-spike/spike-computer-use.mjs` | create→Playwright→shot→act→teardown |
| `artifacts/auth-status.json` | Creds missing |
| `artifacts/sdk-create-error.log` | `LocalOidcContextError` |
| Screenshots | None yet — need creds |

```bash
cd /workspace/v83-sandbox-spike
# after secret-request / vercel env pull
node spike-computer-use.mjs https://example.com
```


## Operational limits (draft defaults)

Short-lived, gated sessions — not an always-on desktop. Limits are normal ops controls (fail closed when hit):

| Cap | Value | Constant |
|---|---|---|
| Max TTL | **8 min** | `COMPUTER_USE_MAX_TTL_MS` |
| Max steps | **20 / session** | `COMPUTER_USE_MAX_STEPS` |
| Concurrent | **1 / user** | `COMPUTER_USE_MAX_CONCURRENT` |
| Idle reclaim | **90 s** | `COMPUTER_USE_IDLE_MS` |
| Default | **OFF** | `COMPUTER_USE_ENABLED` unset |
| Stream | screenshots + **live noVNC** (`viewerUrl`) | V-84 acceptance gate |
| Fail closed | `ok:false` + `code` | `budget_exceeded` \| `ttl_exceeded` \| `step_limit` |

Cold Playwright install is expensive in wall time — prefer a warm `COMPUTER_USE_SNAPSHOT_ID` before enabling widely.

### Still TODO before enabling on preview/prod

1. **Live creds proof** — run spike with Vercel token; create→shot→act→destroy  
2. **Usage hook** — wire session/step accounting into existing `usageGate` (ops, not a new product tier)  
3. **Blob store** — replace in-process screenshot Map for multi-instance  
4. **Warm snapshot** — Playwright preinstalled

## Go / no-go

**GO** for flagged Playwright-in-Vercel-Sandbox (draft/dark, default OFF). Shared backend tools for web + iOS. **Live VNC (`viewerUrl`) wired for V-84 acceptance.** Still blocked on Vercel creds for live create→viewer proof from this box.

## Draft status

| Item | Value |
|---|---|
| Branch | `feat/v83-computer-use-vercel-sandbox` |
| PR | https://github.com/vladchatware/vlad.chat/pull/43 |
| Module | `vlad.chat/lib/computer-use/*` |
| Screenshot API | `GET /api/computer-use/screenshots/[id]` |
| MCP wiring | `app/api/mcp/route.ts` registers computer_* when flag+creds; Convex getMcpTools loads them |
| Legacy chat | `app/api/chat/route.ts` still merges tools (styleguide); product path is MCP |
| Dep | `@vercel/sandbox` added to `package.json` (install on next `bun install`) |
| Hard caps | 8 min TTL / 20 steps / 1 concurrent / 90s idle — fail closed |
| Payments | Fail-closed; `computer_handoff` for payment/signing/SSO/2FA/captcha |

### Draft gaps (intentional)

1. Live create not proven (no Vercel creds on box)
2. Screenshot store is in-process TTL — replace with Blob/R2 before multi-instance prod
3. iOS UI polish for screenshot/handoff cards deferred (protocol ready)
4. Session/step usage accounting for sandbox runtime not wired yet
5. OpenAI-compat `/v1/chat/completions` does not auto-inject computer tools (client-supplied tools only) — primary product path is site MCP via Convex `getMcpTools`
6. Session key: tool arg `sessionId` > header `x-computer-session` (Convex passes userId) > `mcp-default`

## Next slice

1. CTO secret-request → run spike → drop `artifacts/before.png` + `after.png`
2. Land draft PR; enable flag on preview only
3. Persist screenshots to Blob; add usage accounting + handoff UI on web, then iOS




## In-sandbox cua-driver (V-84+)

Desk boot now:

1. `INSTALL_DESK_SH` — apt: xvfb/x11vnc/novnc + `libxi6` `at-spi2-core` `dbus-x11`
2. `INSTALL_CUA_SH` — official installer → `~/.local/bin/cua-driver`, telemetry disabled (no sudo)
3. `START_DESK_SH` — Xvfb :99 → dbus/AT-SPI → noVNC → Chromium CDP → `cua-driver serve`
4. `computer_screenshot` / `computer_act` prefer `cua-bridge.cjs` (`get_window_state` / `click` / `type_text` / `press_key` / `scroll`); on failure fall back to SHOOTER_CJS / RUNNER_CJS
5. `computer_open` stays Playwright CDP navigate; refreshes `/tmp/cu/cua-target.json`
6. `viewerUrl` / noVNC path unchanged

Agent playbook: `skills/computer-use/SKILL.md`.

### Preview retest

1. Preview with `COMPUTER_USE_ENABLED=1` + sandbox auth
2. `computer_open` → open `viewerUrl`
3. `computer_screenshot` — meta should include `via:"cua-driver"` when Driver is healthy
4. `computer_act` click/type — same; if Driver fails, CDP/Playwright still acts
5. Confirm `cua-driver doctor` / `/tmp/cu/cua-driver.log` on sandbox if shot falls back


## Live VNC acceptance (V-84 gate)

Acceptance requires a human (CTO/Vlad) to open `viewerUrl` from `computer_open` and **control** the same desk the agent drives. Screenshot-only is **not** enough.

### How the desk is started (inside sandbox)

```bash
# packages (INSTALL_DESK_SH) — includes libxi6 at-spi2-core dbus-x11
# INSTALL_CUA_SH — curl https://cua.ai/driver/install.sh | bash (user ~/.local/bin)

# display + VNC + noVNC + cua (START_DESK_SH)
Xvfb :99 -screen 0 1280x720x24 …
eval "$(dbus-launch --sh-syntax)"   # AT-SPI for cua-driver
x11vnc -display :99 -rfbport 5900 -localhost -forever -shared -nopw …
websockify --web=/usr/share/novnc 6080 127.0.0.1:5900 &
# headed Chromium on :99 with CDP :9222
node /tmp/cu/launch-chrome.cjs &
cua-driver serve --no-overlay &     # same DISPLAY
```

### Port exposure (SDK)

```ts
Sandbox.create({ ports: [6080], … })
// optional repair on resume:
await sandbox.update({ ports: [6080] })
const viewerUrl = `${sandbox.domain(6080)}/vnc.html?autoconnect=1&resize=scale`
```

Exact JSON field: **`viewerUrl`** (alongside `screenshotUrl`).

### CTO manual verify

1. Ensure Preview has `COMPUTER_USE_ENABLED=1` + sandbox auth (OIDC or token triplet).
2. Call `computer_open` with a public URL (via lounge / MCP).
3. Open the returned `viewerUrl` in a browser (HTTPS noVNC).
4. Confirm Chromium is visible; click/type in the viewer — mouse should move on the desk.
5. Have the agent `computer_act` — you should see the same page update live.
6. `computer_end` tears down the sandbox (viewer dies).
