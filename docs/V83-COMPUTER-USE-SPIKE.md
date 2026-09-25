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
| — | Tool wiring, credit metering, handoff UX on **both** clients |
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


## $5/mo viability

**Stance:** Computer use is **not** an always-on desktop at $5. It is a **gated, short-lived, credit-metered** tool.

### Rough unit cost (Vercel Sandbox Pro list prices, 2026)

| Component | Rate (approx) | Notes |
|---|---|---|
| Active CPU | ~$0.128 / vCPU-hour | Only while CPU runs (Playwright/install) |
| Provisioned memory | ~$0.0212 / GB-hour | Wall-clock while sandbox alive |
| Creations | ~$0.60 / 1M | Negligible at chat volumes |
| Model tokens | existing chat metering | Screenshots add vision tokens |

**Example (2 vCPU / ~4 GB, 5 min wall, ~30% active CPU):**  
Active CPU ≈ 2 × 0.05 h × 0.3 × $0.128 ≈ **$0.004**  
Memory ≈ 4 GB × 0.083 h × $0.0212 ≈ **$0.007**  
**Sandbox ≈ $0.01–0.03 / short task** before tokens. Cold Playwright install can be much higher — **must use snapshot**.

A handful of tasks/day fits a $5 credit pool **only with hard caps**. Uncapped / always-on is **not viable**.

### Product rules baked into draft

| Cap | Value | Constant |
|---|---|---|
| Max TTL | **8 min** | `COMPUTER_USE_MAX_TTL_MS` |
| Max steps | **20 / session** | `COMPUTER_USE_MAX_STEPS` |
| Concurrent | **1 / user** | `COMPUTER_USE_MAX_CONCURRENT` |
| Idle reclaim | **90 s** | `COMPUTER_USE_IDLE_MS` |
| Default | **OFF** | `COMPUTER_USE_ENABLED` unset |
| Stream | screenshots only | no live desktop |
| Fail closed | `ok:false` + `code` | `budget_exceeded` \| `ttl_exceeded` \| `step_limit` |

### Still TODO before paid enable

1. **Live creds proof** — run spike with Vercel token; record real $/task  
2. **Metering hook** — debit credits per step/minute via existing `usageGate`  
3. **Blob store** — replace in-process screenshot Map for multi-instance  
4. **Warm snapshot** — Playwright preinstalled (cold install eats the budget)

**Go for draft / dark ship. No-go for default-on $5 without caps + metering + snapshot.**

## Go / no-go

**GO (Playwright-in-sandbox) for draft/dark.** Viable on $5 **only** with flag default OFF + hard caps + metering + warm snapshot. Uncapped always-on desktop = **NO-GO** at $5.

## Draft status

| Item | Value |
|---|---|
| Branch | `feat/v83-computer-use-vercel-sandbox` |
| PR | _(filled after open)_ |
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
4. Credit metering for Active CPU not wired yet
5. OpenAI-compat `/v1/chat/completions` does not auto-inject computer tools (client-supplied tools only) — primary path is `/api/chat`

## Next slice

1. CTO secret-request → run spike → drop `artifacts/before.png` + `after.png`
2. Land draft PR; enable flag on preview only
3. Persist screenshots to Blob; add credit metering + handoff UI on web, then iOS
