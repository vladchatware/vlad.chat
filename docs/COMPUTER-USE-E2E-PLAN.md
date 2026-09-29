# Computer Use E2E Plan

> **Superseded historical plan.** Use [the current viewer UX acceptance tests](COMPUTER-USE-VIEWER-UX-SPEC.md#12-acceptance-tests-for-the-receiving-developer). Current scope is in-app floating VNC plus inspector/keyboard/relative trackpad; native-PiP and HLS tests below are obsolete. Historical environment and evidence limitations remain in [the audit](COMPUTER-USE-AUDIT-HANDOFF.md).

## Goal

Prove computer-use video works across the sandbox, Vercel stream, Convex session update, and iOS player. A successful run must show changing browser frames in system PiP before `computer_open` finishes. The app has no Computer Open detail page, drawer, inline viewer, or manual PiP launcher. A failed stream must reach a bounded error state while the transcript keeps its compact status card.

The September 27 simulator report includes repeated `Cannot resume sandbox: no snapshot available` errors and a Computer Open sheet that stayed on `Connecting to live browser…`. The sheet has since been removed. Treat sandbox recovery and video playback as separate failure stages; a build or PiP unit test cannot verify either end to end.

## Test environments

- Use the named iOS Simulator `Vlad Streaming UX E2E` on iOS 26.3.
- Treat the simulator as a video-decoding check only; this runtime reports native PiP unsupported. Native PiP acceptance requires a connected physical iPhone.
- Use a dedicated Convex dev deployment and disposable chat/thread. Never exercise the production account or production Convex data.
- Run the Vercel sandbox path from the feature branch. The sandbox must expose the existing authenticated HLS endpoint and test page.
- The live UI test reads `computer-use-video-url.txt` from the XCTest runner app's own Documents container. After booting the simulator, write the Preview stream URL there with `xcrun simctl get_app_container <device-id> chat.vlad.ios.uitests.xctrunner data`; the Mac's `~/Documents` folder is not that container.
- Keep the existing screenshot and `.xcresult` for every failed run. Capture sandbox logs, HLS health/playlist responses, Convex session state, iOS accessibility state, and app logs under one run ID.

## E2E cases

### 1. Fresh open streams before tool completion

1. Reset the disposable sandbox and start a chat prompt that invokes `computer_open` on a deterministic test page. Page shows a frame counter that changes once per second.
2. Observe the matching Convex thread subscription before the MCP tool completes.
3. Do not tap the transcript status card. Assert it has no detail-page affordance and no sheet appears.
4. Assert native PiP appears before tool completion, displays at least two visibly different frames within 10 seconds, and remains attached while the agent performs another browser action.
5. Assert system PiP controls can stop and restore playback without duplicate controllers or SwiftUI publication warnings.

### 2. Sandbox resume failure does not masquerade as a live session

1. Use a disposable thread with an expired/missing sandbox snapshot.
2. Invoke `computer_open` and record the sandbox response.
3. Assert the tool becomes failed with the resume error, no active video session is published, the transcript status is terminal, and no viewer sheet can be opened.
4. Send a new computer-use request. Assert it creates or resumes a valid sandbox and a fresh session ID; a stale URL from the failed attempt must not play.

### 3. Stream endpoint failure is bounded and recoverable

Run separate cases for an invalid/expired stream token, unavailable playlist, and missing media segment. Assert the player enters an explicit failed state within 15 seconds, pauses, reports failure in the transcript status, and does not leave a viewer or loading page onscreen. Start a new computer-use request and assert its healthy stream recovers.

### 4. Thread isolation and lifecycle

Publish a session for thread A while thread B is selected. Assert B never starts A's player. Return to A while the published session is still unexpired and assert the same session resumes even if its owning message finished, without a second player. Relaunch while that session remains valid and assert it can reopen. End or expire the session, switch chats, and relaunch; assert ended/expired sessions never resurrect PiP.

## Required evidence

- Unit/contract tests: session URL validation, thread ownership, deduplication, terminal-state handling, and stale-session rejection.
- Backend integration: `computer_open` publishes the session only after the authenticated HLS endpoint is healthy; HLS playlist and segment are retrievable; sandbox failure publishes a structured terminal result and no live session.
- iOS UI tests: launch with deterministic fixtures for fresh stream, expired stream, and sandbox failure; assert accessibility state reaches native PiP readiness or an explicit transcript error, never an unbounded spinner or Computer Open page.
- Simulator acceptance: run the fresh-open and forced-resume-failure cases three times each on the named iOS 26.3 simulator. Save a screenshot/video and `.xcresult` per run. The fresh-open evidence must prove changing frames, not merely a non-black first frame or `AVPlayerItem.status == readyToPlay`.

## Exit criteria

- Fresh stream shows at least two changing frames within 10 seconds in all three simulator runs, before tool completion.
- Resume failure yields terminal UI and actionable error within 15 seconds in all three runs; retry produces a new healthy session.
- No cross-thread playback, stale-session resurrection, blank-frame success, or SwiftUI publishing warnings.
- A valid published session can reopen from its owning thread after tool completion or app relaunch; ended/expired sessions cannot.
- A failed gate blocks any claim that Computer Use is finished. Report which layer failed and include its run ID and artifact path.

## Current baseline

September 28 Preview runs opened the real Upwork site; runs reached both its marketplace and its bot challenge. The HLS playlist and segment returned 200, and ffprobe decoded H.264 at 1280×720, 15 fps. The simulator test fetched the real playlist and segment, then confirmed `AVPlayerLayer.isReadyForDisplay` on three runs in 10.6, 8.9, and 8.2 seconds. The test reports the video path as passed but records that the simulator cannot validate native PiP. The earlier two-second harness timeout caused a false failure and now matches the app's 15-second timeout.

FFmpeg also caps retained segments by playlist duration. An eight-entry playlist kept too little history for a ten-second segment read, so the stream now advertises 24 half-second segments alongside a 20-segment delete threshold. In Preview, a segment stayed available after a 20-second delay while the playlist advanced and retained 24 entries. A local FFmpeg run also kept the captured segment after 20 seconds with 24 entries. This validates the bounded HLS history change on both the local encoder and Preview.

The previous timeout results came from two test setup errors: the fixture had been written to macOS Documents instead of the simulator runner's Documents container, and the live harness used a two-second timeout. Both are fixed. The latest repeated-run evidence is `/tmp/VladChat-live-preview-3-passes-20260928.xcresult`. Native PiP, visibly changing frames in the PiP window, and the mid-tool Convex-to-iOS handoff remain pending on a connected physical iPhone.

The shared Xcode test plan previously omitted `VladChatTests`, so its unit suite could not run. The plan now includes it. Twenty iOS unit tests pass, including checks that a published session starts before the tool result arrives and that a completed tool can resume its still-live session. These verify the client transition logic, not system PiP. The iPhone 13 Pro Max is still unavailable to `devicectl`.

The Convex session projection is now covered for owning-thread isolation and expiry. `bun run test` passes all 125 tests, targeted ESLint passes, and `bunx tsc --noEmit` passes. These checks do not replace physical PiP verification.
