# iOS UX fixes — annotated review, September 29

Status: planning draft. No implementation authorized by this review request.

Source: user-annotated `Screenshot 2026-09-29 at 11.18.40.png`. This document organizes the markings; questions in the image remain questions, not approved requirements. Priority and proposed defaults below are recommendations.

Checkpoint: commit `323986a`, PR #44. Existing viewer spec: [COMPUTER-USE-VIEWER-UX-SPEC.md](COMPUTER-USE-VIEWER-UX-SPEC.md).

Confirmed during this review:

- Terminal is an **interactive remote shell**.
- Pressing **Stop ends dictation and sends the message immediately**, without a separate review/Send step.

## 1. Connection state and session correctness — first

| ID | Observed problem / requested direction | Acceptance criteria |
| --- | --- | --- |
| LIVE-1 | Inspector displays a stopped-sandbox error webpage behind a connecting indicator. Hide the webpage when disconnected. | Starting, connecting, reconnecting, live, failed, and ended have distinct app-owned states. An expired sandbox is never represented as a live or indefinitely connecting session. No upstream error HTML or infrastructure IDs appear as the desktop. |
| LIVE-2 | Floating preview can remain black with “Connecting.” | Opening produces immediate feedback; connection attempts reach a bounded success/failure state. Retry targets the correct session. Preserve a last good frame only with clear stale/reconnecting treatment. |
| LIVE-3 | Inspect a completed or old computer session without misleading status. | Tool completion, agent completion, transport connection, and sandbox lifetime remain separate. Opening an ended session explains its state and offers an explicit next action; it does not imply that the old computer is still running. |
| LIVE-4 | Additional observation to investigate: a render.com request appears near an Upwork page title. The screenshot does not establish which turn produced the result. | Verify request → thread → sandbox → viewer association using the real requested website. A result or viewer from another session must not be attributed to the current request. |

Do not silently turn a computer failure into a terminal session. A terminal mode needs its own availability and failure state.

## 2. Inspector and remote controls

| ID | Annotation | Proposed outcome / decision |
| --- | --- | --- |
| INSPECT-1 | “Inspector gadget?” beside the title. | Reconsider the user-facing title. Candidate: “Computer.” Exact title remains open. Earlier requests rejected a “Computer” label on the floating preview; that does not automatically settle the inspector title. |
| INSPECT-2 | “Icon instead of text” beside Done. | Replace Done with a recognizable collapse icon, accessible label “Collapse to preview.” It returns to the floating preview without ending the session. |
| INSPECT-3 | “Always on keyboard”; crossed keyboard toggle and unused lower area. | Show the software keyboard on inspector entry, with remote-key accessory directly above it. Keep desktop and controls visible when keyboard appears. A connected hardware keyboard should not create an empty reserved keyboard region. Exact keyboard visual reference needs clarification. |
| INSPECT-4 | Click / right-click marked “tap?” and “force tap?” | Proposed: tap = primary click, long press = secondary click; retain relative trackpad movement. Confirm intended press gesture. Do not interpret the note as a requirement for pressure-sensitive hardware. Remove redundant buttons only once replacement gestures and accessible actions are established. |
| INSPECT-5 | “Rotate the screen / hide controls.” | Design an immersive landscape presentation with a clear way to restore controls and return. Decide whether controls hide automatically or through an explicit action. |
| INSPECT-6 | “Terminal” / “switch to terminal,” with green arrows from activity card and inspector. | **Confirmed: interactive remote shell.** Proposed Computer / Terminal destinations within the inspector share the same sandbox. Define the card's destination and terminal input/control ownership before implementation. Switching surfaces preserves session identity; an ended sandbox cannot provide a working shell. |

Inspector acceptance: expand immediately; keep the same session across collapse/reopen; keyboard, trackpad, modifiers, and rotation work together; disconnected states disable remote input and remain understandable.

## 3. Dictation and composer input

The five handwritten scenarios should become a single explicit input-state design, not independent icon fixes.

| ID | Scenario from the notes | Required review / acceptance |
| --- | --- | --- |
| VOICE-1 | Start dictating, but no language indicator. | Show recording/transcription state and the language actually used by recognition. Language selection behavior remains to be designed. |
| VOICE-2 | Finished dictating: “stop and send?” | **Confirmed: pressing Stop ends capture and sends immediately.** Finalize recognition and submit exactly once, preserving manual corrections. No separate confirmation/Send action. Show any finalization delay explicitly. |
| VOICE-3 | Open keyboard while dictating; recording indicator disappears. | Recording state remains visible with keyboard open. Keyboard presentation must not silently start, stop, or hide capture. |
| VOICE-4 | Correct existing words while continuing to speak. | Define how incoming transcription and manual edits coexist. Preserve user edits; do not overwrite corrected text with a later recognition update. |
| VOICE-5 | An unexplained three-dot button appears. | Inventory current states and assign each a clear control/label. Loading and transcription-in-progress must not look like an unexplained new action. |
| VOICE-6 | Stop / play / restart icons linked to microphone. | Stop-and-send is confirmed; playback/restart semantics remain open. Clarify whether Play means recorded-audio playback or reading the transcript aloud, when it is available, and whether Restart discards the recording, transcript, or both. Do not insert a pre-send review step. These are not assumed to be sandbox lifecycle controls. |
| INPUT-1 | Placeholder and composer spacing marked. | Choose consistent chat placeholder copy and spacing for placeholder, attachment button, model selector, tool selector, and mic. Verify with empty draft, multiline draft, keyboard open, and dictation active. |

State flow: idle → capturing/transcribing (text remains editable) → explicit Stop → finalizing/sending → sent. Keyboard visibility is independent of capture. Proposed recovery: interruption or send failure preserves text rather than losing it or submitting twice; accidental OS interruption is not treated as the user's Stop action. Playback/restart states remain to be defined.

## 4. Account sheet and sign-in explanation

| ID | Annotation | Acceptance criteria / proposed fix |
| --- | --- | --- |
| ACCOUNT-1 | “Why am I seeing this?” beside Anonymous account. | Explain the user-facing purpose of this sheet. Audit what opens it and whether presentation was expected. Do not assume the header should simply be deleted or that the screenshot proves an automatic prompt. |
| ACCOUNT-2 | Dashes and empty usage bar marked as a loading state. | Loading is visually distinct from zero usage, exhausted allowance, and an error. Show a deliberate loading treatment, then real values; provide recovery on failure. |
| ACCOUNT-3 | “Messages left” repeated in several places. | One primary remaining-message count; remove duplicate count labels and redundant progress text. Keep the meaning of any remaining usage metric clear. |
| ACCOUNT-4 | “Why should I sign in?” beside providers. | Add concise, verified benefit copy near sign-in. Do not promise more credits or other benefits unless the product actually provides them. |
| ACCOUNT-5 | Different text sizes on Google and Apple controls. | Align provider buttons' perceived type scale, heights, and spacing while respecting their supported presentation. |

## 5. Transcript and chat list

| ID | Annotation | Acceptance criteria / proposed fix |
| --- | --- | --- |
| CHAT-1 | “New chat” → automatic title generation. | A meaningful short title replaces the initial placeholder once enough conversation exists. Define fallback on failure and preserve manually edited titles. |
| CHAT-2 | Long technical prompt crossed out; “Different placeholder message.” | Replace the demonstration/fixture prompt with a short natural request. Do not rewrite real user messages. Distinguish this from the composer placeholder decision. |
| CHAT-3 | “Shimmer, lighter color” beside reasoning/activity text. | Use subdued activity styling; shimmer only while work is active, with Reduce Motion support. Completed content must not keep animating. |
| CHAT-4 | “Computer use” → “Using computer”; step budget marked “no need?” | Proposed running label: “Using computer.” Use state-appropriate completed/failed labels. Decide whether the step count belongs in details rather than the primary card. |
| CHAT-5 | Response action icons crossed/marked near the bottom. | Review placement and hierarchy of copy/retry actions. Exact desired replacement is unclear; do not remove actions based solely on crossed marks. |

## 6. Floating preview and tucked handle

| ID | Annotation / preserved requirement | Acceptance criteria |
| --- | --- | --- |
| FLOAT-1 | Edge chevron marked “pip tuck”; separate computer icon crossed out. | One coherent restore affordance at the tucked edge. Proposed chevron points inward. Avoid duplicate restore controls in the transcript or beside the composer. |
| FLOAT-2 | Preserve earlier movement corrections. | Fold at the preview's current side and height; restore the same position. Mirror handle shape by edge. Clamp the entire preview during an active drag to the space between header and composer; do not move only its content or scroll the transcript underneath. |
| FLOAT-3 | Preserve immediate expansion and continuity. | Tap immediately opens inspector with appropriate feedback. Drag, tuck, expand, and collapse do not recreate the VNC session or replay the drag animation. |

## Proposed implementation order

1. Connection/session truth and reliable error states (LIVE).
2. Inspector keyboard, navigation, gestures, and interactive terminal design (INSPECT).
3. Dictation state flow and composer behavior (VOICE / INPUT).
4. Account loading, duplication, and sign-in explanation (ACCOUNT).
5. Chat titles, activity styling, card copy, and response actions (CHAT).
6. Tucked-handle visual cleanup alongside viewer verification (FLOAT).

Each is a reviewable slice with its own acceptance evidence. Final order remains open to user preference.

## Decisions to settle before affected implementation

- Terminal entry point and input ownership while the agent is acting.
- Play/restart: recorded audio review, transcript speech playback, and/or retry recording; when these are available with Stop-and-send.
- Inspector title; intended keyboard styling reference; landscape control-hiding behavior.
- Tap/long-press mapping; budget visibility; exact replacement for marked response actions.

## Verification and specification cleanup

- Exercise live preview against a real requested website on the connected iPhone; fixtures support deterministic state tests but do not prove live session behavior.
- Explicitly test expired sandbox, failed connection, slow connection, reconnect, completed agent with live sandbox, and old-session reopening.
- For drag bounds and motion, inspect frames while the finger is moving and held beyond the boundary. Final-position assertions cannot detect transient overlap, animation rewind, or underlying chat scrolling.
- Cover keyboard shown/hidden, portrait/landscape, light/dark, Dynamic Type, Reduce Motion, and VoiceOver for affected controls.
- Test account loading/failure/success and every dictation scenario above independently.
- Once decisions are accepted, reconcile the main viewer spec: its corner-only snapping, composer-overlap, and Done-label language conflict with later refinements. Keep historical handoffs clearly historical.

No application code, builds, deployments, commits, or pushes are part of this organization pass.

## Linear tracking

Milestone: **iOS UX stabilization — September review**, in the [Chat project](https://linear.app/vladchatware/project/chat-2934fdd35d99).

All 20 tickets are assigned to this milestone. Fifteen are Todo; five design-decision tickets are Backlog. No assignees or due dates were added. The annotated image is attached to [V-105](https://linear.app/vladchatware/issue/V-105/verify-september-ios-ux-fixes-on-real-sessions-and-reconcile-viewer).

| Source items | Linear ticket |
| --- | --- |
| LIVE-1, LIVE-2 | [V-86: Show truthful connection states instead of error webpages and endless loading](https://linear.app/vladchatware/issue/V-86/show-truthful-connection-states-instead-of-error-webpages-and-endless) |
| LIVE-3 | [V-87: Handle reopening completed and expired computer sessions explicitly](https://linear.app/vladchatware/issue/V-87/handle-reopening-completed-and-expired-computer-sessions-explicitly) |
| LIVE-4 | [V-88: Investigate requested website and displayed computer session mismatches](https://linear.app/vladchatware/issue/V-88/investigate-requested-website-and-displayed-computer-session) |
| INSPECT-1, INSPECT-2 | [V-89: Refine inspector title and replace Done with a collapse icon](https://linear.app/vladchatware/issue/V-89/refine-inspector-title-and-replace-done-with-a-collapse-icon) |
| INSPECT-3 | [V-90: Show the remote keyboard on inspector entry with coherent accessory keys](https://linear.app/vladchatware/issue/V-90/show-the-remote-keyboard-on-inspector-entry-with-coherent-accessory) |
| INSPECT-4 | [V-91: Define tap and secondary-click gestures for the relative trackpad](https://linear.app/vladchatware/issue/V-91/define-tap-and-secondary-click-gestures-for-the-relative-trackpad) |
| INSPECT-5 | [V-92: Design landscape inspector with recoverable hidden controls](https://linear.app/vladchatware/issue/V-92/design-landscape-inspector-with-recoverable-hidden-controls) |
| INSPECT-6 | [V-93: Expose an interactive remote shell in the iOS computer inspector](https://linear.app/vladchatware/issue/V-93/expose-an-interactive-remote-shell-in-the-ios-computer-inspector) |
| VOICE-1, VOICE-2, VOICE-3, VOICE-5 | [V-94: Make dictation state visible and send immediately when Stop is pressed](https://linear.app/vladchatware/issue/V-94/make-dictation-state-visible-and-send-immediately-when-stop-is-pressed) |
| VOICE-4 | [V-95: Preserve manual text corrections during ongoing dictation](https://linear.app/vladchatware/issue/V-95/preserve-manual-text-corrections-during-ongoing-dictation) |
| VOICE-6 | [V-96: Define dictation Play and Restart controls alongside Stop-and-send](https://linear.app/vladchatware/issue/V-96/define-dictation-play-and-restart-controls-alongside-stop-and-send) |
| INPUT-1, CHAT-2 | [V-97: Unify composer copy and spacing and replace technical demo prompts](https://linear.app/vladchatware/issue/V-97/unify-composer-copy-and-spacing-and-replace-technical-demo-prompts) |
| ACCOUNT-1, ACCOUNT-4 | [V-98: Explain guest account state and the reason to sign in](https://linear.app/vladchatware/issue/V-98/explain-guest-account-state-and-the-reason-to-sign-in) |
| ACCOUNT-2, ACCOUNT-3 | [V-99: Clarify account usage loading and show remaining messages once](https://linear.app/vladchatware/issue/V-99/clarify-account-usage-loading-and-show-remaining-messages-once) |
| ACCOUNT-5 | [V-100: Align sign-in provider button typography and sizing](https://linear.app/vladchatware/issue/V-100/align-sign-in-provider-button-typography-and-sizing) |
| CHAT-1 | [V-101: Generate meaningful chat titles after conversation starts](https://linear.app/vladchatware/issue/V-101/generate-meaningful-chat-titles-after-conversation-starts) |
| CHAT-3, CHAT-4 | [V-102: Refine activity shimmer, computer status labels and budget visibility](https://linear.app/vladchatware/issue/V-102/refine-activity-shimmer-computer-status-labels-and-budget-visibility) |
| CHAT-5 | [V-103: Review transcript response-action placement and hierarchy](https://linear.app/vladchatware/issue/V-103/review-transcript-response-action-placement-and-hierarchy) |
| FLOAT-1, FLOAT-2, FLOAT-3 | [V-104: Use one tucked preview handle and verify live drag boundaries](https://linear.app/vladchatware/issue/V-104/use-one-tucked-preview-handle-and-verify-live-drag-boundaries) |
| Verification / all review areas | [V-105: Verify September iOS UX fixes on real sessions and reconcile viewer spec](https://linear.app/vladchatware/issue/V-105/verify-september-ios-ux-fixes-on-real-sessions-and-reconcile-viewer) |
