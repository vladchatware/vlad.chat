# Computer use: live video and native iOS PiP

> **Superseded historical document.** Use [Computer viewer UX specification](COMPUTER-USE-VIEWER-UX-SPEC.md). Current direction is an in-app floating VNC preview and inspector, not system PiP. The [September 28 audit](COMPUTER-USE-AUDIT-HANDOFF.md) records historical findings. Sections below are not current requirements or acceptance evidence.

Status: implementation in progress; device and live-sandbox validation remain. Updated 2026-09-27.

## Objective

Replace the custom floating VNC webview with genuine system Picture in Picture backed by a continuous video stream of the agent's desktop. Start presenting during the agent turn as soon as usable session/media information arrives. Connection states must resolve to playback, a specific recoverable failure, or a terminal state.

The user first requested a handoff for a development agent, then explicitly asked to implement it on the current branch. Code carries an HLS video URL through tool results and publishes it to a user-scoped Convex session record as soon as sandbox media is ready. The native chat subscription starts an AVPlayer-backed PiP session before the MCP tool finishes. The Computer Open detail page and inline viewer are removed; the transcript card only reports session status. Live PiP remains unverified on the real Upwork flow.

## User-reported failures

1. The viewer opens near message completion instead of when the tool returns the sandbox viewer URL.
2. The Computer Open detail sheet remained on “Connecting to live browser…” after generation stopped. The sheet is removed from the product flow.
3. The floating viewer moves poorly, lags, and has improvised controls/tuck handles. It does not behave like iOS PiP.
4. A captured screenshot was black. The assistant claimed a render-timing cause, but that explanation has not been established.

Reference captures, local to the handoff machine:

- [IMG_9672.PNG](/Users/mac/Downloads/IMG_9672.PNG): transcript, floating edge handles, completed and running computer-use cards, reported black screenshot.
- [IMG_9673.PNG](/Users/mac/Downloads/IMG_9673.PNG): stopped generation and a detail sheet still saying “Connecting to live browser…”.

## Working context and constraints

- Repository: `/Users/mac/Projects/vlad.chat`.
- Current branch: `feat/v85-ios-chat-ui-grok-polish`. User previously requested changes on this branch. Preserve that direction unless they change it.
- The checkout contains substantial uncommitted work, including VNC/session changes, UI changes, and the recent failure/handoff/budget status improvements. Inspect and preserve that work. Do not reset files or stage unrelated edits.
- Follow `AGENTS.md`, including no builds or Bun commands without the required explicit user authorization. Do not interpret this spec as new authorization to build, install, deploy, or run a paid sandbox. Report any validation still needed.
- [PR #51](https://github.com/vladchatware/vlad.chat/pull/51), `codex/fix-computer-use-agent-vision`, is open and unmerged as of this inspection. It supplies screenshot pixels to the model and improves mobile result normalization. Account for this dependency; do not independently overwrite those fixes.
- Previous Swift syntax and isolated model type checks passed. Full iOS execution has not been validated. A previous standalone test type-check could not find `Testing`; do not generalize that to all installed Xcode test environments without checking.

## Confirmed code observations

| Area | Location | Observation |
| --- | --- | --- |
| Automatic presentation | `ios/VladChat/Sources/SwiftChat/Views/ChatListView.swift`, `presentComputerPipIfReady` | Runs from view lifecycle/message/loading changes, scans message history, requires a parsed `open` result and `isLoading`, and deduplicates by session identifier. |
| Tool reconciliation | Same file, `latestComputerSessionTools` | Combines `activity.tools` and tool parts, then keeps the first duplicate ID. A richer later representation can be discarded. Establish whether this occurs in actual subscription payloads. |
| Native subscription | `ios/VladChat/Sources/ViewModels/ChatViewModel.swift`, `enqueue` / `apply` | Native messages come from `threads:getMobileChat`; rendering is coalesced at about 33 ms. The query now includes the user’s active computer-video session, which is published by the sandbox as soon as HLS is ready. |
| Message equality | `ios/VladChat/Sources/SwiftChat/Models/ChatModels.swift`, `Message` | `Message` is a value type with synthesized `Equatable`, including `responseActivity`. Do not claim its equality ignores tool updates. |
| Server streaming | `convex/threads.ts`, `thread.streamText` | Durable deltas are configured with `throttleMs: 0`. A deliberate server throttle is not established as the cause. |
| Output normalization | `lib/mobile-stream.ts`, `toolOutputText` | This branch recognizes a string or an object with `content`; other representations can be serialized/truncated. PR #51 improves support for content arrays and canonical content envelopes. |
| Native parsing | `ios/VladChat/Sources/SwiftChat/Models/ComputerUseModels.swift` | Handles plain JSON, MCP content wrappers/arrays, nested strings, and separate text blocks. Does not currently recognize `{type: "content", value: [...]}`. Verify shapes on both live and persisted paths. |
| Current “PiP” | `ComputerUseBox.swift`, `ComputerUseFloatingPopup`, `ComputerUsePipOverlay`, `ComputerViewerPiP` | SwiftUI drag/tuck state wraps a `WKWebView`; no system PiP controller or native video pipeline. Drag state updates the containing view. Exact frame-time impact has not been profiled. |
| Computer Open page | `ComputerUseBox.swift`, `ComputerUseDetailContent` | Removed. The chat keeps a compact status card while system PiP is the only live-video surface. |
| Web viewer readiness | `ComputerViewerWebView` | Observes HTTP/navigation failures; HTTP success does not establish a working VNC WebSocket or rendered desktop. |
| Sandbox | `lib/computer-use/sandbox.ts`, `playwright-scripts.ts` | Xvfb + headed Chromium + x11vnc/noVNC on port 6080. Protocol exposes `viewerUrl`; no video stream descriptor exists. |
| False success risk | `sandbox.ts`, `runComputerOp` | An `open` runner failure can be returned as success if a viewer URL exists. Desktop availability does not prove page navigation succeeded. |

These observations identify defects and investigation points. The precise end-to-end cause of delayed presentation and the black screenshot remains unproven. Capture timings and actual payloads before assigning a single root cause.

## Required behavior

### Mid-flight startup

- Consume session/media availability at the native subscription/model boundary, independently of transcript layout, visible cells, scrolling, and assistant text completion.
- A tool output containing usable session information must update the media session immediately, even if no new text token follows it.
- Normalize live and saved tool result formats consistently. Images and conversation metadata must not corrupt or truncate the session descriptor.
- Reconcile duplicate tool IDs by lifecycle/output freshness; do not drop a completed result in favor of its earlier running placeholder.
- Separate sandbox readiness, media readiness, and page-navigation result. If navigation is slow, a ready desktop may be shown with a truthful page status.
- Show “Starting browser” while provisioning. Show “Connecting to live browser” only while a real connection attempt is in progress.
- Do not automatically reopen PiP when loading history, switching to an old conversation, or receiving repeated snapshots of the same result.
- One automatic presentation request per newly active session. User dismissal suppresses automatic reopening for that session; an explicit tap may reopen it.

### Genuine native PiP

- Use public `AVPictureInPictureController` APIs and a supported video content source.
- iOS owns floating-window movement, corner snapping, resizing, edge hiding, close, and restore. Remove the custom floating-webview/drag/tuck path after replacement works.
- Observe PiP support and readiness; handle start failures and restoration callbacks. Keep player/session ownership independent of transient message views.
- Begin media preparation immediately after the session descriptor arrives. Request PiP at the earliest supported point in the user-initiated computer-use flow. Verify Apple's initiation rules and behavior on device; do not promise an arbitrary background/programmatic launch. If a direct gesture is required, expose one native PiP action immediately during the turn.
- When system PiP is unavailable, expose a clear failure state on the transcript status card. Do not present an inline viewer, slide-out page, or custom floating window.
- Configure the required media/background lifecycle deliberately. Do not break existing dictation/audio-session behavior or request microphone access for a silent desktop feed.
- Closing PiP stops or suspends the viewer as appropriate; it does not silently terminate the agent's sandbox.

### Continuous desktop video and interaction

- Capture the same desktop/browser session used by the agent, including its actual viewport and pointer where supported. No second browser session.
- PiP receives continuous decoded video frames. Polling screenshot artifacts or repeatedly snapshotting a `WKWebView` is not an acceptable replacement.
- Native PiP is the live viewing surface. Keep transcript session details compact; do not open a Computer Open page to view or control the session.
- “Needs you” remains visible in the app with the handoff reason/message and a clear route to control the same session. Do not imply a PiP window itself accepts remote browser input.
- Keep viewing state separate from agent pause/cancel state. Stopping generation must not leave a pending connection spinner forever. If the sandbox remains alive, viewing may continue with “Agent stopped”; if it ends, close playback and show “Session ended”.
- A successful `computer_end`, expiry, or confirmed sandbox termination closes the matching stream. An unsuccessful end must not falsely mark a still-live session ended.

### Connection and failure states

Use an explicit state model: idle, provisioning, connecting, playing, reconnecting, ended, failed. Track presentation separately: inline, PiP, dismissed. A completed MCP call is not proof of playback.

- “Playing” requires a decoded/displayed frame, not just a URL, HTTP 200, or loaded HTML document.
- Connection attempts must have a deadline. Proposed default: 15 seconds after a media-ready descriptor; on expiry show a reason and Retry/Close actions.
- A dropped connection uses bounded reconnect/backoff. Expired/revoked sessions stop retries and show an ended/expired state.
- A stale or frozen frame must not continue to be represented as current live video. Track frame progress/transport health.
- Distinguish stream failure from tool/navigation failure. Surface real errors; do not convert them to success because noVNC is available.
- Treat deliberate user cancellation as “Stopped,” not a generic “Something Went Wrong” failure for this flow.

## Architecture decision required before implementation

System PiP is fixed. The implementation currently uses FFmpeg/H.264/HLS from the existing Xvfb display and AVPlayerLayer as the native PiP source. This is an implementation choice, not a measured transport result: first-frame time, ongoing latency, CPU, frame rate, and routing behavior remain unverified on a real sandbox and iPhone.

The initial implementation selects HLS because AVPlayer provides a public PiP path without a custom native decoder. Before calling the transport production-ready, measure it against the actual Vercel Sandbox routing and an iPhone:

| Candidate | Native presentation | Main validation |
| --- | --- | --- |
| Low-latency encoded stream, such as WebRTC | Decode into a supported sample-buffer PiP source | Sandbox networking/signaling, ICE/TURN where needed, decoder/frame ownership, background behavior, dependency size. |
| HLS / low-latency HLS | `AVPlayer` / `AVPlayerLayer` with native PiP | Actual end-to-end delay, first-frame time, encoder availability, playlist/segment delivery and caching, sandbox CPU. |

Do not label ordinary segmented HLS “low latency” without measuring it. Revisit WebRTC only if HLS misses the targets and the sandbox networking constraints are verified. No need to build both production paths.

Current runtime delta: the sandbox image installs FFmpeg, and port 6081 serves a 15 fps H.264 HLS stream from display `:99.0`. Configured snapshots must contain the Playwright browser, desktop packages, FFmpeg, and CUA driver; provisioning verifies those dependencies after restore. These implementation details are not validated measurements. Record actual results and the rejected alternative in the PR. If HLS misses the targets, return a measured tradeoff rather than masking delay with animations.

## Current implementation status

- The `videoUrl` field now accompanies `viewerUrl` in computer-use results and mobile decoding. The sandbox starts the authenticated HLS endpoint before browser navigation and waits for a real playlist segment before returning the result.
- The iOS chat model consumes active subscription results directly, merges duplicate tool IDs in favor of usable output, and owns a single `AVPlayerLayer` / `AVPictureInPictureController` session independently of transcript cells.
- iOS shows a small inline video surface with native PiP controls, manual PiP reopen, close, retry after a 15-second first-frame deadline, and “Agent stopped/finished” status. The noVNC page remains available as an explicit control view. The custom draggable/tuck PiP overlay path was removed.
- Snapshot provisioning verifies all runtime packages after restoring the image. Existing configured snapshots need a rebuild if any required package is missing.
- Still required: Swift compile and focused tests; sandbox deployment/runtime check; physical iPhone PiP, background, and dictation checks; timing, latency, frame-rate, and CPU measurements; reconnect behavior after a stream drops; verify browser control reaches the same desktop. No build, tests, sandbox operation, or device run has been performed for this slice.

## Session/media contract

Add a typed, client-independent media descriptor rather than overloading `viewerUrl` or guessing a video URL from a VNC URL. Final field names depend on the selected transport; required information is:

- Stable session identity and lifecycle state.
- Media transport and its playback URL or signaling information.
- Expiration and readiness; optional dimensions/codec details when the client needs them.
- Separate interactive-control URL (`viewerUrl` can remain that field).
- Structured failure information when video cannot start.

Deliver this descriptor in the live tool/event path and preserve it through mobile normalization. Consider a session-ready event/preliminary result if the tool otherwise withholds an already-ready stream until lengthy navigation completes. Preserve compatibility with saved results and older clients; absence of video support must render truthfully.

Media access must remain scoped to the authorized session. Document authentication/capability expiry, reconnection, redirect handling, and termination. Do not expose an unauthenticated desktop feed or log playback credentials. Limit sandbox encoder processes and buffered media; clean them up with session termination.

If sandbox runtime packages or snapshot contents change, update and validate the snapshot provisioning path in `scripts/create-computer-use-snapshot.mts`. Define behavior for existing snapshots/sessions instead of assuming they contain an encoder.

## Performance and timing targets

These are proposed acceptance targets for the dev agent to verify, not current measurements:

- Within 250 ms of receiving a usable tool/session descriptor on device: media session state updates and connection begins, without waiting for another text delta.
- A warm, media-ready session displays its first frame within 3 seconds on a stable connection. Report provisioning time separately.
- Target desktop-to-device delay: at most 1 second on stable Wi-Fi, at most 2 seconds in a representative mobile-network test. Report median and p95 with the test conditions; escalate a measured transport limitation rather than silently relaxing the target.
- At least 15 displayed frames/second during ordinary scrolling on a stable connection, with adaptive quality where needed.
- PiP movement/resizing uses native system behavior; media decoding and transcript updates must not create main-thread stalls. Capture a device performance trace while both are active.
- Bound connection/reconnection time and memory. No unbounded frame/segment queues or encoder processes per tool call.

## Implementation slices

1. **Trace and normalize delivery.** Record tool result emission, durable delta visibility, native receipt, parsing, and media presentation request. Fix wrapper handling, duplicate reconciliation, and terminal tool states. Test a tool result followed by a deliberately long assistant turn with no immediate text update.
2. **Prove the media path.** Stream the actual sandbox desktop to a native test surface, measure startup/latency/CPU, and select the transport. Verify black-frame reports against page navigation and actual captured display; do not reuse the unproven “page still painting” explanation.
3. **Integrate native PiP.** Stable media-session owner, supported content source, readiness/failure callbacks, dismiss/restore behavior, background/audio handling, and transcript status for unsupported or failed PiP.
4. **Connect the product flow and remove obsolete UI.** Start from incoming session events, preserve interactive handoff and screenshot history, remove the custom PiP classes and message-driven floating-overlay state, and fix the indefinite detail spinner.
5. **Validate and hand back evidence.** Focused regressions plus physical-device demonstration and performance measurements. Respect repository authorization requirements for commands/builds/deployment.

Keep commits/PRs focused, accounting for the current dirty branch and PR #51. Do not bundle unrelated chat, account, LaTeX, or model-catalog edits.

## Acceptance matrix

| Scenario | Required result |
| --- | --- |
| `computer_open` returns media while the assistant keeps working for 30+ seconds | Video begins during that turn; native PiP becomes available/starts at the supported initiation point, not at message completion. |
| Result arrives with no subsequent text delta | Same timely session update and startup. |
| Raw JSON, MCP wrapper, content array, canonical content envelope, metadata text block, saved replay | Same parsed session identity/URLs; image payload does not consume the bounded text preview. |
| Running placeholder and completed tool share an ID | Completed output wins; no indefinite connecting state. |
| PiP drag, resize, edge hide, restore while assistant streams | Native controls/behavior; no custom overlay handles; no observed main-thread stalls from frame processing. |
| User closes PiP and further tool results arrive | Same session stays dismissed until explicitly reopened. |
| Scroll offscreen, switch chat, reopen owning thread with an unexpired published session | No player tied to a cell lifecycle; resume the same active session after tool completion or app relaunch, without duplicate PiP controllers. Ended/expired sessions must not reopen. |
| Stop generation during provisioning/connection/playback | Pending states settle truthfully; no endless spinner or generic cancellation error. A live sandbox can remain viewable. |
| End, expiry, bad credentials, 404, WebSocket/media failure, network loss | Specific bounded state, appropriate retry or ended message, resources released. |
| SSO/2FA/payment handoff | “Needs you” and reason remain visible; restore opens control of the same desktop. |
| Failed navigation while desktop is available | Video may remain usable, but navigation result stays failed. |
| Unsupported/disabled PiP or OS rejects start | Clear failure outcome on the transcript card; no inline viewer or fake PiP. |
| Background/foreground and dictation before/after viewing | Playback follows supported lifecycle; dictation still works; no leaked audio session. |
| Known page containing motion, colored regions, text, and cursor movement | Stream and screenshot refer to the actual agent desktop; no unexplained black frame accepted as success. |

## Required handback

- Root-cause explanation backed by event timings and payload examples with credentials redacted.
- Selected transport and measured first-frame delay, ongoing latency, frame rate, and resource use.
- Physical iPhone recording showing tool result arrival, continued assistant work, native PiP motion/resize/restore, and clean failure/end states.
- Test/check results with clear separation between static checks, simulator tests, device tests, and live sandbox tests. Do not claim tests that were not run.
- Any remaining platform limitation or required deployment/snapshot change, stated explicitly.

## Apple references

- [AVPictureInPictureController](https://developer.apple.com/documentation/avkit/avpictureinpicturecontroller): supported content, capability/readiness checks, and background playback configuration.
- [PiP content sources](https://developer.apple.com/documentation/avkit/avpictureinpicturecontroller/contentsource-swift.class): player layers and sample-buffer display layers are supported sources.
- [Sample-buffer content source initializer](https://developer.apple.com/documentation/avkit/avpictureinpicturecontroller/contentsource-swift.class/init(samplebufferdisplaylayer:playbackdelegate:)): required playback delegate for that route.
- [PiP controller delegate](https://developer.apple.com/documentation/avkit/avpictureinpicturecontrollerdelegate): start/stop, failed-start, and restoration lifecycle.

Use public APIs for the actual desktop-video use case. Do not pretend this is a video call to obtain unrelated behavior or use private controls to imitate system PiP.
