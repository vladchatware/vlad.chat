# V-83 Spike: Computer use for vlad.chat on Vercel Sandbox (Hermes path)

**Date:** 2026-09-25 (Asia/Bangkok)  
**Status:** **GO — Playwright-in-sandbox** (live create blocked on missing Vercel creds)  
**Draft:** `feat/v83-computer-use-vercel-sandbox` in `vlad.chat/` (see Draft section)

## Verdict

| Question | Answer |
|---|---|
| Can Vercel Sandbox host Grok-like computer use for vlad.chat? | **YES, via Playwright (headless Chromium) inside the microVM** |
| Native GUI / cua-driver / desktop in Sandbox? | **NO** — Sandbox SDK is shell + filesystem + ports |
| Hermes `vercel_sandbox.py` computer-use? | **NO** — terminal-only; Hermes computer-use is separate local `cua-driver` |
| Live create→screenshot→act→destroy on this box? | **Blocked** — no Vercel OIDC/token credentials here |

## Product constraint: one backend, two clients

vlad.chat has **web + iOS**, but **one agent/tool loop**. Computer use MUST:

- Live in the **shared backend** (`/api/chat` tool registration), not in Next.js UI-only code
- Return **client-agnostic tool JSON** both surfaces can render
- Expose screenshots as **URLs** (or short artifact ids), not megabyte base64 inside the mobile tool-output stream (~4k cap)
- Emit **structured handoff events** (`computer_handoff`) for SSO / 2FA / captcha / payment / signing
- Never silently pay or sign

```
Web app ─┐
         ├─→ POST /api/chat  → streamText({ tools: notion|tavily|computer_* })
iOS app ─┘                         │
                                   ├─ Vercel Sandbox + Playwright
                                   ├─ GET /api/computer-use/screenshots/:id
                                   └─ tool result JSON (screenshotUrl, handoff)
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
| Local cua-driver (separate Hermes feature) | **Out of scope** for in-Sandbox path |
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
| Stream | screenshots only | no live desktop / VNC (V-84 follow-up) |
| Fail closed | `ok:false` + `code` | `budget_exceeded` \| `ttl_exceeded` \| `step_limit` |

Cold Playwright install is expensive in wall time — prefer a warm `COMPUTER_USE_SNAPSHOT_ID` before enabling widely.

### Still TODO before enabling on preview/prod

1. **Live creds proof** — run spike with Vercel token; create→shot→act→destroy  
2. **Usage hook** — wire session/step accounting into existing `usageGate` (ops, not a new product tier)  
3. **Blob store** — replace in-process screenshot Map for multi-instance  
4. **Warm snapshot** — Playwright preinstalled

## Go / no-go

**GO** for flagged Playwright-in-Vercel-Sandbox (draft/dark, default OFF). Shared backend tools for web + iOS. **Blocked** on Vercel creds for live proof. **VNC / live desktop is follow-up V-84** (out of scope here).

## Draft status

| Item | Value |
|---|---|
| Branch | `feat/v83-computer-use-vercel-sandbox` |
| PR | https://github.com/vladchatware/vlad.chat/pull/43 |
| Module | `vlad.chat/lib/computer-use/*` |
| Screenshot API | `GET /api/computer-use/screenshots/[id]` |
| Chat wiring | `app/api/chat/route.ts` merges tools when flag+creds |
| Dep | `@vercel/sandbox` added to `package.json` (install on next `bun install`) |
| Hard caps | 8 min TTL / 20 steps / 1 concurrent / 90s idle — fail closed |
| Payments | Fail-closed; `computer_handoff` for payment/signing/SSO/2FA/captcha |

### Draft gaps (intentional)

1. Live create not proven (no Vercel creds on box)
2. Screenshot store is in-process TTL — replace with Blob/R2 before multi-instance prod
3. iOS UI polish for screenshot/handoff cards deferred (protocol ready)
4. Session/step usage accounting for sandbox runtime not wired yet
5. OpenAI-compat `/v1/chat/completions` does not auto-inject computer tools (client-supplied tools only) — primary path is `/api/chat`

## Next slice

1. CTO secret-request → run spike → drop `artifacts/before.png` + `after.png`
2. Land draft PR; enable flag on preview only
3. Persist screenshots to Blob; add usage accounting + handoff UI on web, then iOS
