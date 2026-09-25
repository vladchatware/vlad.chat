# V-85 — iOS chat UI Grok Bot–like polish

Branch: `feat/v85-ios-chat-ui-grok-polish` (from `main`)  
Draft PR: https://github.com/vladchatware/vlad.chat/pull/44  
Related: V-83 protocol / PR #43 (`lib/computer-use/types.ts`), V-84 live VNC (out of scope).

## Before → After

| Area | Before | After |
| --- | --- | --- |
| Message trail | Tight 8pt cell padding; user bubble ~85% width, 16pt corners | Looser `messageGroupSpacing` (28); user bubble 78% width, 18pt continuous corners |
| Thinking / status | Mixed “Thinking” labels, 15pt ad-hoc fonts | Shared `Theme.Typography.thinkingLabel` + “Thinking…” ellipsis |
| Tool cards | Flat 10pt fill, traffic-light green check | Shared `activityCard` chrome (14pt continuous + hairline stroke); calm completed tint |
| Search / URL rows | Bare text rows | Same activity-card surface as tools |
| Composer | Hardcoded 26pt radius; “What’s on your mind?” | Theme composer radius; “Ask anything” empty-state placeholder |
| Computer-use (V-83) | Generic tool JSON dump | `ComputerUseToolCard`: screenshot thumbnail, handoff banner, budget / error-code chips; detail sheet structured — **no VNC** (V-84) |

## Protocol parity (V-83)

Swift `ComputerUseModels` mirrors backend `ComputerToolResult` (clients render only; no sandbox orchestration on device):

| Field | Notes |
| --- | --- |
| `ok`, `op` | `op`: `open` \| `screenshot` \| `act` \| `handoff` \| `end` (unknown → `.unknown`) |
| `screenshotUrl` / `screenshotId` | AsyncImage thumbnail; never VNC |
| `handoff` | `{type:"computer_handoff", reason, message, requiresUser}` — amber banner |
| `budget` | `stepsUsed` / `maxSteps` chip + detail meta |
| `error` / `code` | `code`: `budget_exceeded`, `ttl_exceeded`, `step_limit`, `disabled`, `auth_missing`, `runtime` |

MCP tool names: `computer_open`, `computer_screenshot`, `computer_act`, `computer_handoff`, `computer_end`.

### Wire shapes `ResponseTool.output` may carry

`ComputerToolResult.parse(from:)` accepts (same as mobile-stream / MCP may deliver):

1. **Plain JSON object** — `{"ok":true,"op":"screenshot",…}` (happy path after `toolOutputText`)
2. **MCP content wrapper** — `{"content":[{"type":"text","text":"<json>"}]}` (from `mcpResult()` in `lib/computer-use/mcp-tools.ts`)
3. **MCP content array alone** — `[{"type":"text","text":"<json>"}]`
4. **JSON-encoded string** of any of the above

When parse succeeds, the tool trail / detail sheet **do not** fall back to a raw JSON dump.

## Simulator

This Linux agent host cannot run iOS Simulator. Verify on a Mac with Xcode:

1. `VladChatTests` — esp. computer-use decode (plain / MCP wrapper / array / budget codes)
2. DEBUG Inference State Gallery → **Computer screenshot / handoff / running**
3. Dark + light appearance for composer + user bubbles
4. Open a completed `computer_*` tool sheet → AsyncImage + handoff banner (no ugly JSON when parse works)

## Out of scope (unchanged)

- Backend computer-use protocol / V-83 branch (except consuming its JSON)
- Live VNC (V-84)
- Web chat redesign
- Pricing / StoreKit narrative
