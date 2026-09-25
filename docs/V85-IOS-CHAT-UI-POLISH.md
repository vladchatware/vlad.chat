# V-85 — iOS chat UI Grok Bot–like polish

Branch: `feat/v85-ios-chat-ui-grok-polish` (from `main`)

## Before → After

| Area | Before | After |
| --- | --- | --- |
| Message trail | Tight 8pt cell padding; user bubble ~85% width, 16pt corners | Looser `messageGroupSpacing` (28); user bubble 78% width, 18pt continuous corners |
| Thinking / status | Mixed “Thinking” labels, 15pt ad-hoc fonts | Shared `Theme.Typography.thinkingLabel` + “Thinking…” ellipsis |
| Tool cards | Flat 10pt fill, traffic-light green check | Shared `activityCard` chrome (14pt continuous + hairline stroke); calm completed tint |
| Search / URL rows | Bare text rows | Same activity-card surface as tools |
| Composer | Hardcoded 26pt radius; “What’s on your mind?” | Theme composer radius; “Ask anything” empty-state placeholder |
| Computer-use (V-83) | Generic tool JSON dump | `ComputerUseToolCard`: screenshot thumbnail, handoff banner, budget chip; detail sheet structured — **no VNC** (V-84) |

## Simulator

This Linux agent host cannot run iOS Simulator. Verify on device/Xcode:

1. DEBUG Inference State Gallery → **Computer screenshot / handoff / running**
2. Dark + light appearance for composer + user bubbles
3. Open a completed `computer_*` tool sheet and confirm AsyncImage + handoff banner

## Out of scope (unchanged)

- Backend computer-use protocol / V-83 branch
- Live VNC (V-84)
- Web chat redesign
- Pricing narrative
