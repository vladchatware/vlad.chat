# Computer viewer: floating preview and inspector

Status: implementation in progress, September 28, 2026. The user has authorized iOS implementation and refined the inspector behavior: opening it must leave the chat surface and show a separate inspector section.

## 1. Product decision and precedence

The feature is an **in-app floating computer preview with ChatGPT-like visual treatment**. Expanding it opens the computer inspector. The inspector contains the same live desktop, relative trackpad navigation and keyboard input.

This specification replaces the native-system-PiP requirement in `COMPUTER-USE-AUDIT-HANDOFF.md`, `COMPUTER-USE-NATIVE-PIP-HANDOFF.md` and `COMPUTER-USE-E2E-PLAN.md`. Their recorded code findings and deployment history remain useful historical evidence. Their AVKit/HLS architecture and native-PiP acceptance gates are obsolete for this feature.

### Confirmed by the user

- Lightweight sandbox provides generally usable VNC; PiP-like presentation is a client concern.
- Floating window should look and feel like the one in ChatGPT.
- Expansion opens an inspector, following the supplied Sidebar / Canvas / Inspector layout reference.
- Inspector provides the desktop preview and keyboard.
- **Trackpad behavior:** swiping moves the cursor relatively. Touch position does not directly select the matching desktop coordinate.

### Proposed defaults, open to refinement

Exact dimensions, corner radius, motion timing, initial keyboard visibility and control-transfer behavior below remain design proposals. They are not claims about ChatGPT's exact current UI.

### Review summary

| Area | Specified behavior | Decision status |
| --- | --- | --- |
| Collapsed viewer | ChatGPT-like floating preview while chat continues | Confirmed direction; exact chrome remains a visual-review item. |
| Expansion | Opens the computer inspector with preview and keyboard | Confirmed. |
| Navigation | Relative trackpad; finger location does not teleport cursor | Confirmed. |
| Session continuity | Same desktop and connection through expand/collapse | Required behavior. |
| Small screens | Dedicated full-width inspector section replaces the visible chat; collapse returns to chat | Confirmed by user. |
| Keyboard | Shown on phone expansion unless hardware keyboard is attached; can be hidden | Proposed default. |
| Input ownership | Watching does not pause agent; deliberate input requests control; explicit Resume agent | Proposed control policy. |
| Sandbox | Generic VNC; no presentation-specific video conversion | Confirmed architectural boundary. |

The user's later implementation authorization supersedes the earlier handoff-only status in this document.

## 2. References and interpretation

- User-supplied Sidebar / Canvas / Inspector illustration defines spatial roles: conversations left, current chat in the center, contextual computer controls on the right. Its orange gradient, desktop traffic lights and equal column widths are not requested styling.
- ChatGPT defines the floating-preview aesthetic: quiet neutral chrome, rounded preview, small monochrome controls and conversation remaining usable behind it. Use VladChat's existing typography and light/dark treatment.
- [OpenAI's PiP UI guidance](https://developers.openai.com/plugins/concepts/ui-guidelines#picture-in-picture-pip) describes an in-chat persistent floating surface with restrained controls. This supports the broad interaction reference; it does not establish an exact screenshot match or require copying its placement/activation rules.
- The earlier interaction sketch is a non-authoritative discussion aid, not application code, a running remote session or a pixel-perfect ChatGPT reproduction. It illustrates expansion, relative cursor motion and text entry; it does not prove drag/resize/tuck behavior or reproduce the platform keyboard. This written specification takes precedence. Final appearance should be compared with the user's intended ChatGPT window when that exact reference is available.

## 3. Two presentations, one session

| Presentation | Purpose | Allowed interactions |
| --- | --- | --- |
| Floating preview | Watch while continuing the conversation | Move, resize, tuck, expand. Never sends desktop input. |
| Inspector | Inspect and operate the same computer | Trackpad, click/drag/scroll, keyboard, zoom, collapse, explicit control transfer. |

Only one of these presentations is visible at a time. Expansion must preserve session identity, connection, latest framebuffer, cursor position, zoom and remote application state. Collapse reverses the presentation; it does not reconnect or relaunch the browser.

`Done` folds the inspector back to the floating preview. It does not end the sandbox or stop generation. The floating preview has no label, status, close button or transport controls. Ending the session remains an agent action.

The viewer exists inside VladChat. Backgrounding follows normal app lifecycle; there is no promise of a system window floating above other apps. Returning reconnects to a still-valid session when necessary.

## 4. Floating preview

### Appearance

- Desktop content dominates; preserve its aspect ratio. No stretched pixels, webpage reload chrome, large title bar or technical transport labels.
- Continuous rounded clipping, restrained elevation, hairline separation where needed for contrast. Proposed radius 18 pt, adjustable after visual review.
- Proposed phone default width 208 pt; resize range 176–300 pt, clamped to available width minus 24 pt. On regular widths, default 280 pt and range 220–400 pt. Content ratio comes from the framebuffer rather than assuming every desktop is 16:9.
- The minimized surface is only the live desktop image: no `Computer` label, status footer, close button or transport chrome. Keep a continuous rounded clip, restrained elevation and a hairline edge for contrast.
- Preserve the framebuffer aspect ratio; current default is 16:9. The image itself is the expand target. Inspector has one fold control: `Done`.
- Default dock: lower trailing corner, resting just over the composer's top edge. Keep overlap shallow (about 12 pt) so the window reads as sitting on the composer without blocking its controls. Recompute against the visible composer when keyboard or safe-area geometry changes. Remember user-chosen corner and size for the current thread.
- No native-video scrubber, play/pause timeline, oversized controls or permanent heavy frame.

### Gestures

| Gesture | Result |
| --- | --- |
| Tap preview | Open inspector for this session. |
| One-finger drag | Move entire window; do not send remote pointer events. |
| Release after drag | Settle to nearest permitted corner with velocity-aware, bounded motion. |
| Pinch | Resize preview within bounds; do not zoom remote desktop. |
| Deliberate drag beyond side edge | Tuck into a slim edge tab; tap tab restores remembered size/corner. |

Distinguish tap from drag using movement threshold; lifting after drag must not open inspector. Preview gestures never scroll the chat. Outside the window, chat remains interactive. Tucked tab respects touch targets and cannot steal the app's existing left-edge chat-navigation gesture.

When the chat keyboard or safe area changes, move the preview to the nearest unobstructed dock. Restore preferred dock afterwards. Do not cover the composer, send/stop controls or navigation. Narrow screens may temporarily reduce preview size within its range.

### Startup

A current-turn computer invocation can show a compact `Starting computer` placeholder in the floating frame. Once a usable VNC session descriptor arrives, connect immediately; do not wait for tool result finalization, new text tokens or assistant completion. Replace placeholder with a rendered desktop frame without changing window identity.

Historical messages alone never summon a stale preview. A live server-owned session may resume on explicit reopening or return to its owning chat. Failure is shown in the same compact frame and transcript status, with Retry; no separate connection page.

## 5. Inspector layout

### Regular width: trailing column

Use the supplied three-region model: sidebar, chat canvas, trailing computer inspector. Inspector belongs to the selected conversation; it is not a modal sheet dimming the chat.

- Proposed inspector width: 400 pt default, adjustable 340–560 pt while keeping a usable chat canvas (proposed minimum 360 pt). Collapse the sidebar before squeezing both chat and desktop to unusable widths.
- Header: fold action only. No `Computer` title, control-status text or X.
- Main content: aspect-preserving live desktop, fitting available space; background gutters do not receive remote input.
- Input bar below preview: primary click, secondary click, keyboard visibility, fit/zoom and control-owner action. Use compact labels/icons and accessible names.
- Keyboard accessory: Esc, Tab, Ctrl, Alt, Shift, arrows and Return, plus the standard platform keyboard when requested/appropriate. Avoid duplicated desktop toolbars or an invented full custom keyboard.
- When a software keyboard appears, it remains platform-owned; resize the app/preview around actual keyboard geometry rather than drawing a pretend keyboard inside a narrow column.

### Compact width: separate inspector section

On iPhone or a narrow window, opening the inspector replaces the visible chat surface with a dedicated full-width Inspector section. The chat and its floating preview must not remain visible behind the controls. Preserve chat scroll position and draft while the section is open. On regular widths, keep the chat canvas visible beside a distinct trailing inspector pane. Neither layout uses a bottom sheet or the old blank Computer Open page. Done returns to the same chat with its floating preview.

Desktop preview stays visible above controls and the remote text-entry field. The accessory keyboard controls are shown on entry; the system keyboard opens when the user taps Keyboard. Opening the inspector must never type a character, click the remote page, or move chat focus to an unintended field.

For landscape, rotation and split view: recompute preview layout from available space, keep cursor within the framebuffer, preserve connection and zoom, and keep essential controls reachable. If keyboard leaves too little preview space, allow it to be hidden with one action.

## 6. Trackpad navigation — confirmed interaction

The desktop preview doubles as a relative trackpad. The cursor remains where it was when a finger lifts or touches down elsewhere. New touch coordinates do not teleport the pointer.

| Input inside inspector preview | Remote effect |
| --- | --- |
| One-finger swipe | Move cursor by relative displacement; no button held. |
| One-finger stationary tap | Primary click at current cursor position, not touch location. |
| Two stationary taps | Double-click at current cursor position. |
| Two-finger stationary tap | Secondary click at current cursor position. |
| Two-finger parallel swipe | Scroll remote content; never pan inspector or chat. |
| Tap, then press-and-hold with drag | Primary-button drag at cursor; release on finger lift/cancel. |
| Pinch | Zoom local desktop presentation; does not resize the floating window or send browser zoom shortcuts. |

Keep primary/secondary click buttons available as accessible alternatives to gesture-only actions. Resolve two-finger scroll versus pinch by translation versus separation; never emit both for one gesture. Suggested drag activation timing is a tunable default, not a hidden mandatory precision gesture.

Pointer mapping must account for framebuffer size, scale, zoom, letterboxing and rotation. Proposed base gain: touch displacement maps through current display scale, with a bounded acceleration curve for longer traversals. Do not add pointer-speed settings in the first version unless device testing establishes a need.

At high zoom, follow cursor near visible edges so it cannot silently move outside the visible desktop. Fit resets local zoom without relocating the remote pointer. Cursor should remain legible; avoid duplicate local and server cursors. Any predictive local cursor must reconcile with server position and must not falsely indicate a completed remote click.

Long press/drag cannot trigger text selection, context menus or navigation in the host app. All pressed mouse buttons and modifier keys are released on gesture cancellation, connection loss, control loss, hiding or thread switch.

## 7. Keyboard and focus

- Typed text goes to the remote application's focused control, never the chat composer. Keyboard appearance alone does not establish remote focus; the user positions cursor and clicks the intended field.
- Use standard software keyboard and support physical keyboard. Accessory provides desktop-only keys and visible modifier state; no hidden sticky Ctrl/Alt/Shift.
- Backspace, Return, Tab, Escape, arrows, selection shortcuts and modifier combinations preserve key-down/key-up order. Support committed composed text; do not send each intermediate IME composition as duplicate input.
- Do not silently change entered text through autocorrect/capitalization intended for chat. Do not echo passwords or log keystrokes.
- Paste is explicit user action into remote focus; never synchronize clipboard automatically.
- Collapsing/hiding releases remote keys, dismisses remote keyboard focus and preserves the chat draft. It does not leak subsequent keystrokes into either destination.

## 8. Human and agent control

Watching or expanding the inspector does not automatically stop the agent. Simultaneous agent and human pointer/keyboard control is not acceptable.

Proposed control contract:

1. Inspector contains no `Computer` title or control-status text.
2. `Take control`, first trackpad interaction, or first keyboard intent requests a handoff. Suppress remote input until the agent's computer action has reached a safe boundary and ownership is acknowledged. Show `Taking control` immediately; do not queue a click or key against a stale frame.
3. Once granted, subsequent gestures/keys operate the remote desktop. Clearly indicate readiness. Taking control does not cancel the conversation.
4. `Resume agent` releases held inputs and returns ownership explicitly. Hiding/collapsing alone does not resume agent actions while the user might still be entering information.
5. Proposed handoff deadline: 10 seconds. If ownership cannot be acknowledged, keep agent ownership, show `Could not take control` with Retry, and discard pending input. Do not interrupt an unknown in-flight action or race pointer events.

This control policy is proposed, not an assertion that backend arbitration already exists. It is a required implementation dependency for reliable interactive use. Existing `Needs you` handoffs should enter this same inspector and ownership flow.

## 9. State and lifecycle contract

Keep connection, presentation and input ownership independent:

- Connection: starting, connecting, live, reconnecting, failed, ended.
- Presentation: hidden, floating, tucked, inspector.
- Ownership: agent, handoff pending, user.

Changing presentation never creates another sandbox or second VNC connection. A static desktop is not automatically a frozen connection: use transport/session liveness separately from pixel changes.

| Event | Required result |
| --- | --- |
| Descriptor during active turn | Start viewer immediately; no wait for assistant completion. |
| Repeated descriptor or richer duplicate tool result | Reuse connection/surface; no animation replay or duplicate viewer. |
| Expand/collapse 20 times | Same session and uninterrupted connection; cursor/remote focus preserved, local keyboard focus managed. |
| Switch A to B | Detach/hide A, release its inputs; never display A as B's computer. |
| Return to live A | Restore according to remembered visibility and ownership; no stale session revival. |
| Agent completes/stops | Live sandbox remains viewable; report agent status separately. |
| Transport loss | Preserve last frame with clear reconnecting/stale treatment; disable remote input. |
| Session expired/ended | Stop connection, release keys/buttons, remove floating window, retain terminal transcript entry. |
| Old end event after new session arrives | Ignore for new session; compare actual session identity. |
| App background/foreground | Release input on background; reconnect/resume valid session as needed without ending it. |

Proposed first-frame deadline: 15 seconds after a usable descriptor. Automatic reconnect has a total 15-second deadline with backoff; then offer Retry. Proposed initial provisioning deadline: 90 seconds from invocation, after which the viewer shows `Computer is taking longer than expected` with Retry instead of an indefinite spinner. These viewer deadlines do not terminate the sandbox or silently cancel the agent. All timing values are reviewable defaults, not measured guarantees.

## 10. Architecture constraints, not library selection

- Sandbox exposes its existing desktop using VNC. No FFmpeg, HLS segments, server-side video conversion, extra encoder process or PiP-specific media port in the final path.
- Decoding/rendering and PiP-like window behavior belong on the client. Native VNC rendering is the preferred direction from the discussion; decoder/library choice remains an implementation decision after UX review.
- Transport descriptor identifies session, owning thread, authenticated endpoint, expiry and lifecycle. A noVNC HTML `viewerUrl` is not itself a native RFB endpoint. Validate the actual route/handshake and authorization; do not guess a websocket URL or expose a new unauthenticated raw VNC port.
- One persistent session owner outlives transcript cells and presentation changes. Drag/layout changes must not rebuild the connection or run desktop decoding on the UI thread.
- Keep existing generic noVNC access useful where needed; viewing on iOS must not require the sandbox to know about Apple presentation APIs.
- Remove HLS-only prerequisites and readiness gates from snapshot provisioning, sandbox startup, descriptors, tests and docs when replacing that path. Preserve unrelated screenshot/agent-vision support and valid VNC sessions.
- Native system PiP, AVKit playback/audio workarounds and cross-app floating behavior are outside this specification.

## 11. Motion, accessibility and proposed performance budgets

- Expansion visually carries the preview into the inspector; collapse returns to its prior dock. Preserve the last live frame through the transition; no blank reload flash or duplicate live surfaces.
- Proposed transition duration 220–300 ms, no exaggerated bounce. Reduce Motion uses immediate layout/fade without spatial travel.
- Dragging should track the finger at display cadence; target at least smooth 60 Hz interaction on supported devices. Proposed trace budget on a 60 Hz device: p95 frame duration ≤16.7 ms during drag, no repeated >50 ms stalls. These are acceptance targets, not measured results.
- Proposed descriptor-to-connect scheduling ≤250 ms; first-frame deadline 15 seconds. Separately measure sandbox startup, remote action-to-frame latency, phone CPU/memory and sandbox resource use. Removing HLS is not proof of low latency by itself.
- Accessible names for Expand, Collapse, Keyboard and click buttons. Provide move/dock/size actions without precision dragging. Dynamic Type, light/dark, VoiceOver navigation and hardware-keyboard focus must remain usable.
- Do not represent the remote bitmap as a fully accessible webpage. State this limitation accurately; accessible host controls remain required.

## 12. Acceptance tests for the receiving developer

Use normal chat, the actual Upwork website, Preview/dev and the same deployment reached by Convex. Recheck the audited Preview-alias discrepancy; do not assume direct CLI and chat routes match. Record exact app/source/deployment/device identity, redacted logs and durable evidence. This document does not authorize production changes.

1. Start a real computer action while the assistant continues. Floating frame appears during the turn, actual VNC frames replace status, and scrolling the chat does not move/reload the viewer.
2. Drag, resize, tuck and restore while chat streams. No remote clicks, connection resets, composer obstruction or repeated frame stalls. Capture performance trace rather than judging from a single screenshot.
3. Expand into trailing inspector on regular width; into full-width inspector on phone. Preview and keyboard are usable; collapse returns to the prior floating dock with the same session/connection. No Computer Open bottom sheet.
4. Relative trackpad: move cursor, lift, touch another location, move again. Cursor must not teleport. Verify primary/double/secondary click, two-finger scroll and drag-and-drop against actual remote controls.
5. Rotate, show/hide keyboard, zoom and fit. Cursor/input mapping remains correct, preview stays visible and no keys/buttons remain held.
6. Enter text through software/hardware keyboard, navigation keys and composition. Verify target field, no duplicate characters, no chat draft corruption and explicit clipboard behavior.
7. Request control while agent is executing; no overlapping remote input. Resume explicitly. Stopping generation, collapsing and hiding retain separate meanings.
8. Exercise duplicate events, session expiry, reconnect, relaunch, thread switch, stale historical end and legitimate reopening. Failures are bounded and visible; static valid pages are not falsely marked disconnected.
9. Verify existing screenshot/agent-vision behavior still works and native/browser VNC clients can use the same sandbox. Final sandbox starts and operates without FFmpeg/HLS dependencies or encoder processes.
10. Rebuild and verify the final app on simulator and physical phone. Simulator is now a valid interaction-test target because native PiP is no longer required; phone remains necessary for touch, keyboard, performance and network behavior. Report measured results and remaining limitations before calling it complete.

## 13. Handoff summary — use only after implementation is authorized

> Once the user explicitly authorizes implementation, follow the reviewed UX in this document: ChatGPT-like in-app floating VNC preview; expand into a trailing computer inspector with keyboard and **relative trackpad** navigation. Same desktop, connection and cursor across transitions. Keep sandbox generic and lightweight; remove FFmpeg/HLS/AVKit-specific work. Preserve deployment/ownership/error-handling lessons from the historical audit, but do not continue debugging native system PiP as a prerequisite. Exact visual measurements and proposed control-transfer details remain reviewable defaults. No implementation was performed in preparing this spec.
