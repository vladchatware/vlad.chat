# iOS response experience: review and implementation spec

Status: ready for coding-agent handoff. Reviewed 2026-09-22 against `c2daf60`.

Implementation note: the first response-contract, lifecycle, activity-rendering, scroll, spacing, tint, single- and multi-part stable markdown reveal, and Debug-gallery slices are now present in the worktree. The gallery includes both Web-search control states. The current worktree has passed 20 mobile-stream contract tests and 7 signed physical-device Xcode tests. Remaining proof is a real provider-backed request against the deployed Convex environment, frame-pacing measurement, and any fixes exposed by that run.

## Objective and scope

Make native responses feel as coherent as Next.js: immediate feedback, understandable tool activity, smooth text reveal, stable scrolling, consistent spacing, and correct selected controls. Preserve native interaction and accessibility.

The initial review used static source inspection. Follow-up validation now covers the native gallery and response projection on a physical iPhone. The provider-backed request path has not been measured in this worktree because the mirrored device was unavailable while in use. Findings below distinguish confirmed code behavior from performance hypotheses. Timing and spacing values are proposed acceptance targets, not measurements of the current app.

Reference hierarchy:

1. Explicit product requirements in this spec, including a search toggle whose content never changes with selection.
2. Production web behavior in `components/chat.tsx`, `components/ai-elements/*`, and `app/globals.css`.
3. `/styleguide` (`app/styleguide/page.tsx`) for component states and visual comparison. It is not a complete scripted lifecycle test today.

Interpret “arbitrary tool display” as one reusable, provider-independent tool component, supporting Search, Notion, and future tools through data. Do not build another search-only rendering path.

Out of scope: model changes, inference-provider migration, billing, authentication, attachment upload, voice, thread-management features, full web redesign. Existing renderer dependencies may be retained if they meet the requirements.

## Baseline findings, expanded and corrected

The table below records the pre-implementation baseline that motivated this spec. Its consequences explain the required fixes; they are not a claim that every listed defect remains in the current worktree. Use the implementation note, current diff, and validation section to determine what is already covered and what still needs device proof.

| Priority | Finding | Source evidence | Consequence |
| --- | --- | --- | --- |
| P0 | Loading feedback has gaps; shimmer is not entirely absent. | `MessageView.swift:1015` already renders a masked gradient via `TextPulseAnimation`. `responseActivitySection` at line 400 requires `isLoading && isLastMessage`. `sendMessage` initially adds only a user row. | Nothing guarantees feedback between Send and the first server assistant row. Shimmer also depends on local action lifetime, not authoritative response state. |
| P0 | User scroll intent is overwritten by every subscription update. | `ChatViewModel.apply` ends with `scrollToBottomTrigger = UUID()`; `ChatListView.swift:135` clears `userHasScrolled` and `isScrollInteractionActive`; `MessageTableView.swift:217` forces a bottom scroll. | Reading earlier text competes with incoming content. This is a confirmed wiring defect, not merely missing animation. |
| P0 | Tool history is lost at two layers. | `convex/threads.ts:getMobileChat` maps stored messages to basic text/status fields. Activity is added only from active stream deltas. `MessageView.responseActivitySection` hides activity when local loading ends. | Tools disappear after completion and cannot be reconstructed on reopening history. Changing the card design alone cannot fix this. |
| P0 | Lifecycle is split between local request state and server state. | `isLoading` follows the generation action; `apply` maps only `status == "streaming"`, text, and response activity. Same-ID wrapper updates are largely gated on `isLoading`. | Reconnect, restored active replies, terminal snapshots, and action/subscription ordering can leave stale or incorrect UI. These scenarios require replay verification. |
| P1 | Tool projection is too lossy for web parity. | `lib/mobile-stream.ts` collapses tool input-start/input-available to `running`, keeps name/status/truncated output, drops input details and error text, and reduces reasoning to a phase. Source parts are not projected. | No pending/running distinction, meaningful query/error inspection, reasoning-content parity, or first-class sources. |
| P1 | Mobile flattens the response sequence. | `mergeMobileStreamText` accumulates text and a separate tools map by order. Web renders ordered parts, including reasoning and tool calls. | Text → tool → text cannot preserve its original placement. Activity after initial text is also underrepresented because phase changes are often guarded by `!state.text`. |
| P1 | Incremental rendering machinery exists but is bypassed. | No production caller of `StreamingMarkdownChunker`; `ChatViewModel.apply` recreates messages without `contentChunks`. `LaTeXMarkdownView` renders full fallback markdown while streaming and disables transaction animation. | No explicit new-word reveal. Whole growing input is handed to the renderer repeatedly. Actual frame cost needs measurement. |
| P1 | Streaming completion changes rendering structure. | `LaTeXMarkdownView.swift:147` switches from fallback markdown to parsed segments when streaming ends. | Possible final-layout jump, especially for tables, math, and code. Verify before choosing a replacement. |
| P1 | Scroll geometry relies on an oversized placeholder. | `Constants.StreamingBuffer` reserves 50 screens initially, up to 200; table code cancels unused space using negative bottom insets. | Fragile interaction between content height, keyboard, completion, and scroll offsets. A risk supported by code; current visible severity is unmeasured. |
| P1 | Search toggle changes geometry and uses the wrong color system. | `MessageInputView.swift:234`: off = 24-point globe, on = padded “Web Search” capsule with `.blue`. Web toggle at `prompt-input.tsx:765` always shows globe + “Web” and reverses foreground/background on selection. | Selection moves nearby controls and introduces unrelated blue. |
| P1 | No consistent application tint contract. | Empty AccentColor definition, no root `.tint`, hardcoded `UIColor.systemBlue` cursor, separate navigation tint, legacy green accent helpers. | Sheets, links, text selection, and selected controls can disagree. Exact system fallback appearance needs device inspection. |
| P1 | Spacing has multiple owners. | Table cell adds horizontal 8 / vertical 8; message adds horizontal 4 and vertical 8; activity adds default horizontal padding; content stacks use 2/4/6/12-point gaps. `Theme.Dimensions` already has a 4/8/12/16/24 scale. | Activity and answer text do not share one gutter; nested padding makes similar states look different. |

Two useful corrections to the original diagnosis:

- The problem spans transport projection, lifecycle reconciliation, renderer updates, scroll ownership, and design tokens. Raw inference transport alone does not explain tint or spacing.
- Web explicitly implements a message fade, shimmer, tool transitions, and conditional follow scrolling. `Response` delegates to Streamdown; explicit per-word reveal is not configured in the inspected wrapper. Treat subtle word reveal as a requested improvement, not an already-proven web implementation detail.

Additional defects to cover while changing these areas:

- Errors use `attachmentError` even for subscription/generation failures. `streamError` UI exists but is not populated by mobile mapping. Give generation failures an inline home on the affected response.
- `cancelGeneration` immediately clears local loading before server acknowledgement. A stale snapshot must not restart indicators or overwrite a newer generation.
- `ToolOutputSheet` receives a selected `ResponseTool` value. Resolve current detail by stable tool ID so an open sheet can reflect subsequent output/status changes.
- Synthetic stream IDs and optimistic user IDs can be replaced by persisted IDs, causing reloads and appearance replay. Preserve presentation identity through reconciliation.
- Keyboard observer tokens are discarded; removal passes the SwiftUI view instead of those tokens. Fix registration/teardown when touching keyboard coordination; repeated visits must not accumulate callbacks.

## Required behavior

### 1. One authoritative response lifecycle

Represent submission separately from received content, with stable response identity. Keep lifecycle and ordered content independent: a response can already contain answer text and still be running a tool.

| State | Visible behavior | Exit condition |
| --- | --- | --- |
| Submitting / waiting | Immediately show one assistant activity row, “Thinking…” shimmer; Send becomes Stop. | Reasoning, tool activity, first answer content, or terminal result. |
| Thinking | Keep activity visible; render expandable reasoning only if displayable reasoning was actually supplied. | Next activity or terminal result. |
| Tool pending / running | Named tool row with explicit status; details available without obscuring the answer. | Tool result, tool failure, cancellation, or next activity. |
| Responding | Reveal only appended content; keep relevant tool/reasoning history inspectable. | More content/activity or terminal result. |
| Complete | Stop motion; keep final answer, tools, sources, and copy/retry affordances. | New explicit user action. |
| Stopping / stopped | Stop reveal scheduling; preserve received partial answer; show stopped state after acknowledgement. | Acknowledgement or actionable cancellation failure. |
| Failed | Preserve partial content and show concise inline error with Retry. | Explicit retry creates a new generation identity. |
| Reconnecting | Preserve visible content and reading position; show connection status separately. | Authoritative snapshot resumes or terminates response. |

Requirements:

- Create one local activity placeholder immediately on successful submission validation, before network work. Reconcile it into the server response without duplicate rows, flicker, or scroll reset.
- Derive ongoing response state from server snapshots, including app reopen during generation. Local request completion must not independently hide ongoing server activity.
- Track generation identity/revision so late callbacks cannot clear a newer request. Terminal state wins over stale nonterminal state for that generation.
- Waiting/thinking/tool/answer may alternate across steps. Do not model the whole response as one irreversible progression through those four phases.
- Keep tool history visible after completion, stop, failure, and reopening. Empty failed/stopped replies must still render a terminal row.
- Search enabled means tool availability, not proof a search occurred. Show Search activity only after a real tool event.

### 2. Typed presentation data, live and persisted

Extend the mobile contract to preserve information the UI needs. Prefer a small typed presentation contract over exposing the entire provider/SDK union to Swift.

Minimum contract:

- Stable conversation, generation, message/step, part, and tool-call identities; explicit ordering and terminal outcome.
- Ordered parts for answer text, displayable reasoning, tool calls, and sources. Tools update in place by call ID; identical names do not merge distinct calls.
- Tool status: pending, running, completed, failed, stopped. Preserve input/query summary, output preview, explicit truncation indicator, and displayable error when supplied.
- Source ID, title, and URL when provided. Never infer citations or fabricate sources from arbitrary tool strings.
- Optional fields/defaults for existing stored history and rolling client/server deployment. Unknown future tools use the generic renderer. Unknown enum values must not kill the whole chat subscription; use an explicit typed fallback.

Build live snapshots and stored history through the same projection rules. Current server truncates output at 4,000 characters; retain bounded payloads and disclose truncation in details. Do not label the preview “full output.” Full-result fetching is optional and separately scoped.

Preserve the existing decision to avoid sending provider-specific inputs indiscriminately. Project useful display fields deliberately. Render only reasoning content already exposed for user display; never manufacture reasoning from hidden inference state.

Reconcile snapshots by stable identity; avoid rebuilding all presentation state on every delta. Maintain per-message reveal cursors, expansion state, and scroll anchors across updates. Make repeated identical snapshots idempotent. On a real content replacement, reset only the affected generation/part.

### 3. Loading and thinking shimmer

- Use one reusable native shimmer component for waiting, thinking, and applicable loading states. Reuse/fix the existing mask implementation if suitable.
- Target a subtle 1.5-second directional sweep, matching production web timing; readable base text in both themes. No simultaneous competing dot animation in the same activity label.
- Place shimmer on the assistant text gutter. Transition into tool/content states without removing and recreating the response container.
- Activity appears by the next rendered frame after a locally accepted Send. No network-dependent blank interval.
- Hide the bare waiting indicator once content starts unless a later actual waiting/thinking activity warrants it. Never show perpetual shimmer for a terminal response.
- Reduce Motion uses static status text. Stop indefinite animation when terminal, offscreen, or app inactive. VoiceOver announces meaningful phase changes, not animation frames.

### 4. General tool presentation

Create one `ToolActivity` component used by Search, Notion, and unknown tools. Known-tool metadata supplies a friendly title/icon; fallback uses a readable name. Do not route tools by scattered view conditionals.

- Collapsed row: icon, title, explicit status, disclosure affordance. Use a short meaningful query/summary when available; raw JSON is not the default preview.
- Expanded detail or native sheet: display input summary, result, failure/stopped reason, sources, and truncation status as available. Use the same detail structure across tools.
- Status must be understandable without color. Pending and running remain distinct; preliminary output does not imply completion.
- Multiple and overlapping tool calls remain individually inspectable in stable order. Completing one tool must not mark others complete.
- Open detail updates by ID. Completion or later snapshots must not dismiss it or erase user expansion choices.
- Retain completed/failed/stopped tools in history. If response terminates while a tool is still running, reconcile its outcome so it cannot spin forever; do not falsely mark it successful.
- Match `/styleguide` coverage for input-streaming, input-available, output-available, output-error, then add stop, empty output, unknown tool, and multiple-call states.

### 5. Smooth streaming text and stable markdown

Separate received canonical text from displayed text. Transport batches must not directly determine visual cadence.

- Coalesce updates on a bounded presentation cadence; initial target 30 Hz maximum for content publication. Render only changed parts.
- Reveal newly appended words or short text runs with a subtle 120–180 ms opacity fade. No vertical movement, blur, scale, or whole-message fade on each update.
- Reveal complete grapheme clusters; support emoji, combining marks, and languages without spaces. Do not implement a whitespace-only tokenizer.
- Normal stream reveal should add no more than 150 ms of intentional delay. Large bursts/reconnect snapshots must catch up within 250 ms rather than replaying a long typewriter queue. Terminal snapshots flush remaining content within that bound.
- Previously visible text remains still. Reopening history does not replay the stream. Reduce Motion displays incoming batches immediately.
- Preserve stable completed markdown blocks and parse/update the active tail. Audit the existing chunker before reuse: time/hash IDs, simplified fence recognition, and working-to-final ID changes are not a reliable identity contract.
- Incomplete code fences, lists, links, tables, citations, and math must remain readable. Use a stable partial representation; no repeated full-message reflow or disappearing blocks.
- Completion may refine formatting, but preserve the reading anchor and avoid switching the entire message tree. Fix geometry/update ownership before adding fades.
- Copy uses canonical received text. After completion, rendered and copied content must match the final server answer exactly, excluding display-only status labels.

### 6. Scrolling and keyboard ownership

Give one coordinator responsibility for scroll policy. Distinguish following latest from reading history; separate explicit navigation commands from passive content updates.

- Locally sending a message and tapping Jump to latest are explicit bottom-follow actions. Ordinary subscription updates are not scroll commands.
- While following latest, preserve the latest visible content as it grows, coalescing scroll adjustment with layout. Avoid starting overlapping animations per token.
- User upward drag disables follow immediately; incoming updates and delayed callbacks cannot reset it. Resume after explicit Jump to latest or user-driven return to the bottom.
- While reading history, preserve first visible message/part ID and its within-viewport offset through updates, keyboard changes, tool expansion elsewhere, and finalization. Initial acceptance tolerance: 2 points when the anchored content itself is unchanged and geometry permits.
- Keep Jump to latest available while detached, including with keyboard visible when space permits; it must not overlap composer or content.
- Keyboard presentation/dismissal respects current follow mode. Store/remove actual observer tokens. Repeated appear/disappear cycles produce one callback per keyboard event.
- Remove the 50-screen reservation and compensating negative inset approach in favor of real measured layout and bounded safe-area/composer insets. If a measured performance limitation requires temporary space reservation, document evidence and bound it to the viewport rather than dozens of screens.
- No blank viewport, rebound, or surprise bottom snap when streaming starts/stops, a synthetic ID is replaced, app resumes, or device rotates.

### 7. Shared spacing and active tint

Use semantic tokens backed by the existing 4/8/12/16/24 scale. Different roles can have different spacing; equivalent roles must use the same token and one owner.

Proposed native baseline:

| Token / role | Value |
| --- | --- |
| Conversation outer gutter | 16 pt |
| Gap between distinct message groups | 24 pt |
| Gap between response sections: reasoning, tool group, answer, sources | 12 pt |
| Gap between adjacent tool rows / small related controls | 8 pt |
| Icon-to-label / compact metadata | 4 or 8 pt, named by role |
| Tool card and user bubble inset | 12 pt |
| Minimum control hit area | 44 × 44 pt |

Transcript container owns outer gutter; response stack owns section gaps; components own internal padding. Assistant text, shimmer, reasoning header, tool-card edge, and source group align on the same outer gutter. Card text may indent by its card padding. User bubble remains trailing aligned. Preserve deliberate iPad max-width behavior through named layout tokens rather than device-specific padding scattered in cells.

Define semantic foreground/background/selected/disabled/link/error/success tokens for light and dark appearances. Product default: neutral monochrome active controls, matching production web and native Send:

- Selected fill = foreground; selected content = background. Dark mode: light button/dark icon. Light mode: dark button/light icon.
- Unselected fill = low-emphasis foreground tint; unselected content = secondary foreground.
- Share tint through SwiftUI root, UIKit text controls, sheets, links, and selection controls. Remove conflicting hardcoded blue and legacy green from these roles. Keep semantic error/success colors distinct from selection tint.
- Use dynamic text styles and scalable layout. Check contrast and Increase Contrast; do not encode selected state with color alone.

Search control: fixed globe + “Web” label in both states. Same font, padding, width, and position when toggled. Only fill/foreground and accessibility selected state change, with a short color transition. Expose “Web search, on/off” to VoiceOver. Preserve preference persistence. During generation, selection changes apply to the next request and never mutate the in-flight request's recorded configuration.

## Native state gallery and deterministic replay

Add a debug-only native “Chat UI states” destination plus reusable previews. Use production components and the production presentation reducer. Fixtures must work offline without credentials or paid inference. Do not duplicate UI implementations for screenshots.

Support pause, restart, step, speed, appearance, Reduce Motion, and Dynamic Type controls. Replay must use the same normalized events/snapshots as production, including delayed, repeated, and replaced snapshots.

Required fixtures:

1. Initial history loading; empty chat; send before assistant row exists; waiting → first answer.
2. Waiting → thinking → answer → complete, with and without displayable reasoning.
3. Every tool status; Search, Notion, unknown tool; empty and truncated result; failure with error text.
4. Two same-name calls; overlapping calls; text → tool → text; preliminary result → final result.
5. Fast tokens, slow tokens, long pauses, large burst, reconnect snapshot; multilingual text and emoji.
6. Partial markdown: paragraphs, nested lists, links, code fences, table, math, citation; terminal formatting.
7. Stop before first token, stop during text/tool execution, cancellation failure, provider failure before/after partial answer, retry with stale prior callbacks.
8. Follow latest; scroll up during stream; keyboard show/hide; expand tool while detached; jump back; rotation; long response; long history.
9. Completed conversation restored with tools/reasoning/sources; older history without optional fields; unknown future tool/status fallback.
10. Search on/off/pressed/disabled; light/dark; small phone/iPad; accessibility text sizes; VoiceOver and Reduce Motion.

Capture equivalent web states from `/styleguide` and production chat when available. Add only missing web fixtures needed for comparison; do not make web redesign a dependency. Native gallery must cover full sequences, not just isolated screenshots.

## Implementation slices and ownership

Keep implementation in isolated focused PRs. Start PR1 from main; stack sequential work deliberately. Theme/gallery scaffolding can proceed independently if file ownership is clear.

| Slice | Owner / primary files | Deliverable and gate |
| --- | --- | --- |
| 1. Response contract | Backend agent: `lib/mobile-stream.ts`, `lib/mobile-stream.test.ts`, `convex/threads.ts`; agree Swift DTOs with native agent | Typed ordered presentation data for live and stored messages. Tests cover terminal precedence, tool status/error/source preservation, step order, and legacy compatibility. |
| 2. Reconciliation and lifecycle | Native state agent: `Sources/Models/ConvexModels.swift`, `Sources/ViewModels/ChatViewModel.swift` | Stable identities, immediate placeholder, server-owned lifecycle, inline error/stop handling, deterministic reducer tests. No unconditional scroll trigger. |
| 3. Activity and tool UI | Native component agent: `MessageView.swift`, new focused components, gallery fixtures | Shimmer across all waiting paths; generic persistent tool history; live details; accessible statuses. Depends on slices 1–2. |
| 4. Text presentation | Rendering agent: `LaTeXMarkdownView.swift`, chunker/presentation scheduler | Stable blocks, subtle appended-run reveal, bounded backlog, multilingual/markdown replay checks. Depends on slice 2. |
| 5. Scroll coordination | Native list agent: `ChatListView.swift`, `MessageTableView.swift`, streaming buffer constants | One follow policy, preserved reading anchor, measured layout, correct keyboard teardown. Coordinate final-layout behavior with slice 4. |
| 6. Tokens and search control | Design-system agent: `Theme.swift`, color/asset definitions, app root, `MessageInputView.swift`, touched component padding | Neutral selected tint, stable Web label/geometry, named spacing ownership, light/dark/accessibility gallery. |
| 7. Integration and cleanup | Integration agent | Complete replay gallery, visual/performance evidence, remove superseded rendering/scroll paths after verifying remaining callers. |

Do not dispatch independent agents to edit the same central view simultaneously. Assign `MessageView.swift` extraction to the activity owner first; later slices consume extracted components. Each PR explains behavior, why, checks performed, and remaining limitations. Check reviews, review comments, and issue comments before declaring a slice done.

## Validation and definition of done

Meaningful automated checks:

- Transport/reducer tests prove live-to-persisted parity, deterministic ordering, repeated-snapshot idempotence, stable identities, cancellation/terminal precedence, and compatibility fallback.
- Presentation scheduler checks use a fake clock; assert bounded backlog, no dropped/duplicated text, Unicode correctness, and no history replay.
- Scroll-policy tests cover detach/follow and stale scheduled callbacks. UI replay validates geometry; reducer tests alone cannot establish scroll smoothness.
- Snapshot or UI checks cover representative themes, tool/terminal states, stable toggle geometry, and accessible text sizes. Do not add tests that merely assert constants exist.

Runtime evidence required before claiming UX completion:

- Record send → wait → tool → answer → complete, plus reading history during an active response. Repeat stop/failure/reopen and keyboard cases on a small phone and iPad layout.
- Measure under a documented device/OS/configuration: 100-message history, a 10,000-character response, 30 snapshot updates/second, plus burst delivery. Instrument frame pacing, main-thread work, presentation lag, and viewport offset.
- Initial 60 Hz target: 95th-percentile presentation work below 16.7 ms per frame, no repeated streaming-attributable hitches over 50 ms, reveal lag within the bounds above. These are proposed budgets; report actual traces and adjust only with evidence.
- No duplicate placeholder, invisible running generation, lost tool history, wrong terminal state, reader-position theft, blank streaming space, whole-answer reanimation, or search-toggle layout shift.
- Final text, tool outcomes, and sources survive reopen. Reduce Motion and VoiceOver remain usable without per-token announcements.

Execution constraints: follow repository `AGENTS.md`. No builds or Bun commands without explicit user request. Do not run a build as part of this spec task. Future agents must report runtime validation as pending until authorized and performed; do not present static review as runtime proof. Preserve Lefthook checks and never bypass hooks. Existing pre-commit runs Bun, so arrange authorization before committing implementation work rather than silently triggering forbidden commands. No warning suppression or type erasure to conceal model mismatches.

## Copyable coding-agent brief

Implement the assigned slice of `ios/VladChat/UX_PARITY_SPEC.md`. Read its findings and acceptance checks first. Use production Next.js and `/styleguide` as references, preserving native semantics. Fix presentation data/lifecycle and scroll ownership before adding cosmetic animation. Reuse existing components only after verifying they are on the active path. Keep changes focused, preserve typed contracts and old-history compatibility, and include deterministic fixtures. Respect repository command restrictions and isolated PR workflow. Report exact behavior changed, tests/evidence obtained, and any acceptance checks still pending. Do not claim smoothness from code inspection alone.
