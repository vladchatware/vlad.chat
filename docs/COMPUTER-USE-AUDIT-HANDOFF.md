# Computer-use native PiP: audited handoff

> **Product direction superseded.** Use [Computer viewer UX specification](COMPUTER-USE-VIEWER-UX-SPEC.md): ChatGPT-like in-app floating VNC preview, expanding into an inspector with keyboard and relative trackpad control. Native system PiP and server HLS are no longer requirements. The audit below remains historical evidence; its execution order and native-PiP gates are not the current plan.

Audited September 28, 2026, approximately 10:40 Asia/Bangkok. **Feature not complete. Physical PiP root cause unknown.** This document supersedes the older native-PiP handoff and E2E plan wherever they conflict.

## Assignment and boundaries

Finish native iPhone PiP for the agent's live desktop. Start automatically when usable media arrives during the agent turn. Use the actual website (Upwork) and the same sandbox controlled by the agent. Resume valid sessions. No Computer Open sheet, fake draggable viewer, or manual PiP launcher as a substitute.

This audit changed documentation only. No source changes, builds, test execution, deployments, environment mutations, or new sandbox creation. Read-only remote configuration checks and historical test-result inspection were performed.

- Repository: `/Users/mac/Projects/vlad.chat`.
- Branch: `feat/v85-ios-chat-ui-grok-polish`; HEAD: `03cb0d5a0ee08b793f4e2dcfb60fef29dee044e4`.
- Dirty checkout: 38 modified tracked files at audit start, plus new video-service files, session tests, and docs. HEAD alone does not describe implementation. Preserve unrelated edits; no reset or wholesale staging.
- User requested work on this branch. Account for dirty changes before isolating implementation slices. Follow AGENTS.md and hooks/PR policy. Audit created no branch or PR.
- Preview/dev only. User explicitly rejected production deployment. Prior authorized checks/rebuilds do not authorize arbitrary production work; this handoff grants no new permissions.
- Never print secrets or capability-bearing playback URLs. Keep test evidence free of them.
- Never end a usable sandbox merely because an agent message or test finishes.
- “Only xctest” clarified what was open on the phone. It was not an XCTest-only restriction and does not prove XCTest blocks PiP.

## Verified environment and deployment discrepancy

| Component | Read-only observation | Limit |
| --- | --- | --- |
| iOS Debug | Base config includes untracked `Local.xcconfig`, targeting `https://kindly-rat-915.convex.cloud` | Installed binary/config still needs verification. |
| Local Convex | `.env.local` selects deployment type `dev`, same URL | Convex URL was not lost. |
| Current branch Preview env | Public Convex URL is `kindly-rat-915.convex.cloud` | Current configured value, not proof of every immutable deployment's bundled config. |
| Convex dev MCP destination | Explicit read from `kindly-rat-915`: `NEXT_PUBLIC_SITE_URL=https://vladchatware-git-feat-v85-ios-chat-960694-vlad-rimshas-projects.vercel.app` | Destination used by `threads.ts:getMcpTools`. |
| That branch alias | Resolves to **`https://vladchatware-dm2fs3c38-vlad-rimshas-projects.vercel.app`**, `dpl_AGzdmGiyWdHj384T4uqDL4AawhXR`, Ready / Preview, created Sep 27 23:46 +07 | Deployed code equivalence unverified. |
| Prior direct MCP/stream tests | Used **`https://vladchatware-gkt8muw05-vlad-rimshas-projects.vercel.app`**, `dpl_9kwozX3sCTRqJvnSMwvowWQ4nPk9`, Ready / Preview, created Sep 28 01:15 +07 | Different, newer deployment. Those checks do not validate chat's destination. |
| Storage secret | Branch Preview env listing includes `COMPUTER_USE_STORAGE_SECRET`; Convex dev read returned nonempty value | Equality and presence within each immutable deployment unverified. Env export omitted it; omission does not prove absence. |
| Preview bypass | Convex dev `VERCEL_AUTOMATION_BYPASS_SECRET` returned nonempty value | Successful MCP authentication still needs proof. |
| Convex session endpoint | Unauthenticated POST `{}` to `https://kindly-rat-915.convex.site/computer-use/sessions` returned 401 | Route exists; function revision and successful publication unverified. |
| Preview deploy key | Exported `CONVEX_DEPLOY_KEY` has `prod:` prefix | Deployment credential concern, not proof that the separately configured dev runtime URL is production. Resolve deployment target before deploying. |
| Physical phone | Paired, available iPhone 13 Pro Max | Xcode UDID `00008110-00125021116A801E`; CoreDevice ID `74D3836A-B10C-5A01-A648-D662453CC128`. |
| Disk/build directory | About 14 GiB free; project DerivedData `Build/` exists | Earlier disk-full blocker no longer current. Directory existence does not prove build freshness. |

**First backend investigation:** compare the two deployments and trace a normal dev chat through its configured alias. Do not deploy blindly or treat this discrepancy as proof of the independent AVKit failure's cause.

Read-only commands used: `vercel inspect <URL>`, `vercel env ls preview <branch>`, temporary/redacted `vercel env pull`, and `node node_modules/convex/dist/cli.bundle.cjs env get NEXT_PUBLIC_SITE_URL --deployment-name kindly-rat-915`. Temporary export removed; secret reads reported only presence.

## Current implementation map

1. `convex/threads.ts:201`: discovers MCP tools through `NEXT_PUBLIC_SITE_URL`, sending user/session and thread headers. Around line 789, computer instruction is injected only when discovered tools include computer tools. Source contains the skill-loading path; actual deployed discovery is unverified.
2. `app/api/mcp/route.ts:634`, `lib/computer-use/mcp-session.ts`: propagate session/thread through async-local context. `sandbox.ts:getOrCreateSessionSandbox` uses `Sandbox.getOrCreate` and snapshot-fingerprinted sandbox names.
3. `lib/computer-use/sandbox-scripts/live-video.cjs`: Xvfb capture, H.264, 1280×720, 15 fps, no audio; roughly half-second HLS segments and 24-entry playlist on port 6081. Ordinary segmented HLS, not demonstrated low-latency transport.
4. `sandbox.ts:348`: ensures local media readiness and publishes descriptor before navigation. Publication failures are logged and swallowed. `artifacts.ts:132` also silently returns if nonproduction storage configuration is absent. Working HLS does not prove publication.
5. `convex/computerUseScreenshots.ts`: one stored session per session key; thread/expiry filtering; 30-minute TTL; 15-minute cleanup. `threads:getMobileChat` projects the session but omits `expiresAt`.
6. `ChatViewModel.swift:555,695`: subscription application reconciles media independently of cells. Updates may coalesce about 33 ms. Published descriptor preferred; active tool output fallback. Duplicate tools scored by parsed result and lifecycle.
7. `ComputerUseBox.swift:260`: AVPlayer and retained AVPictureInPictureController. `ChatListView.swift:88` hosts source: production 1×1 at opacity 0.001; harness 320×180 at opacity 1.
8. Product cards consume tool results. Old Computer Open sheet/custom floating VNC types are removed in inspected source. DEBUG harness selected in `VladChatApp.swift` bypasses normal chat/auth/subscriptions.

## Prioritized audit findings

These are code findings and verification gaps. **None establishes why AVKit reports `possible=false`.** Line numbers refer to the audited working tree.

### P1: Actual chat and direct tests use different deployments

Environment table proves destination mismatch. Establish deployed code/config parity or align the intended Preview target before calling tests E2E. Capture authenticated publication and matching thread delivery, not merely working HLS.

### P1: PiP can wait forever after the first frame

`ComputerUseBox.swift:382–393,452–458`: first-frame callback cancels the only deadline and sets `playing`; PiP request silently returns while `isPictureInPicturePossible` is false. No separate presentation deadline. This permits “playing, supported: yes, possible: no” indefinitely without a visible window. It explains missing bounded failure handling, not AVKit's underlying cause.

Product cards do not consume controller state/errors. `errorMessage` appears only in DEBUG harness. `retry()` has no product caller. Unsupported-device text promises inline video that the product does not show. The old handoff's claimed transcript failure/retry UI was not implemented.

### P1: Session removal and thread switching leave old playback

`ChatViewModel.swift:236–278,695–790`: create/select/delete do not stop or reconcile viewer ownership. Snapshot without an open tool or descriptor returns, leaving prior session unchanged. Descriptor disappearance after expiry/end can likewise leave playback unchanged with completed historical tools. Server filtering prevents delivery of A's descriptor to B but does not stop an existing A player.

A historical successful `computer_end` is processed before a fresh descriptor without session-ID matching. Test this ordering. Client receives no expiry timestamp, has no expiry timer, and observes no ongoing frame-progress/stall deadline. Query-time server filtering alone does not guarantee timely shutdown.

### P1: Current live test bypasses the product and weakens acceptance

`VladChatUITests.swift:237`: reads HLS fixture, launches `--ui-test-computer-video-live`, bypasses chat, discovery, publication and subscription, and changes source geometry. Checks first-frame label, not changing native PiP content. Unsupported devices return success. Lines 331–346 allow backgrounding and returning to convert immediate failure into a pass.

Split decoder smoke, background diagnostics, and strict foreground product acceptance. Unsupported PiP must explicitly skip/fail PiP acceptance. Background-only startup cannot satisfy the user's request. Earlier diagnostics reused a timed-out XCTestExpectation and crashed; current source uses a new expectation.

### P2: Layer/controller and dismissal lifecycle gaps

`ComputerUseBox.swift:396–415`: attaching a new AVPlayerLayer updates the stored layer, but existing PiP controller and ready observation remain bound to the old one. Host recreation can leave PiP attached to a detached source. Add targeted reproduction before selecting a fix.

PiP did-stop pauses player but leaves `playing` and requested session ID unchanged. Dedup prevents same-session startup; no product reopen route exists. Explicit `stop()` records a dismissed ID, so using it indiscriminately on thread switch would block legitimate resume. Separate dismissal, temporary detachment, ending and resumption. Queued delegate/KVO work lacks current-controller/layer generation guards; cover replacement races.

### P2: Audio and termination need verification

Controller activates shared `.playback/.moviePlayback` audio without coordinating release. Dictation changes the same session. Verify dictation before/after PiP and restoration; do not guess modes or suppress warnings.

`sandbox.ts:endComputerSession` clears publication before confirming stop, swallows stop errors and depends on process-local session state. Audit cold-instance end/resume and truthful termination. Current design has one user-scoped sandbox/session row; independent historical sessions per thread are not established.

Current navigation failure correctly returns `ok:false` while preserving available desktop/video, contradicting the old handoff's claim of converted success.

## Evidence ledger

| Evidence | Status at audit | Interpretation |
| --- | --- | --- |
| Historical unit `.xcresult` below | Re-read: 20 passed, 0 failed, simulator iOS 26.3.1 | Does not validate later edits or native PiP. |
| Prior simulator live tests | History reports first-frame success, PiP unsupported; `/tmp` bundles absent | Decoder evidence only. |
| Prior physical Upwork runs | History reports first frame, supported yes, possible no, inactive PiP; bundles absent | Failed PiP; cause unknown. |
| Visible source and activated audio experiments | History reports same phone failure | Neither established a fix. Do not repeat without new measurement. |
| Background diagnostic | History reports failure; final result save hit disk full | Final bundle incomplete then, absent now. Expectation crash was a test defect. |
| Actual normal chat → Preview → Convex → iPhone PiP | No verified run | Mandatory remaining gate. |
| Earlier 125 Bun tests / ESLint / tsc | Reported earlier, not rerun/recovered here | Historical claims only. |

Readable unit artifact:
`/Users/mac/Library/Developer/Xcode/DerivedData/VladChat-abrarowxvlepnmdpczjzbrekgzdr/Logs/Test/Test-VladChat-2026.09.28_01-46-55-+0700.xcresult`.

Prior `/tmp/VladChat-live-preview-3-passes-20260928.xcresult`, `/tmp/VladChat-live-upwork-iphone-audio-active-20260928.xcresult`, and `/tmp/VladChat-live-upwork-iphone-background-clean-20260928.xcresult` are absent. Do not cite them as available artifacts. Store future evidence durably outside `/tmp`, with exact source/build/deployment identity.

## Receiving developer: execution order

1. Preserve dirty baseline; record diff fingerprint and installed app identity. Confirm explicit dev/Preview destinations and phone state. No cleanup currently needed.
2. Trace actual backend route: compare alias and directly tested deployment; verify tool discovery, skill injection, authenticated publication, identity and subscription in one real chat. Correct only demonstrated mismatch.
3. Isolate AVKit on phone with fresh real-site HLS. Log scene activation, attached window/layer geometry, source identity, item status/tracks/size, timeControlStatus/rate, audio state/errors, PiP support/possible/active transitions and delegate errors. Redact URLs.
4. One hypothesis per experiment: state predicted outcomes and next decisions before running. XCTest interference remains a hypothesis; direct launch of the same harness is not product E2E. If availability stays false, vary one measured factor or compare a public-API minimal reference with same stream. Do not switch transport/VNC library/content-source API without evidence. Do not misuse video-call APIs.
5. Fix proven causes and audited state contracts in focused slices, with meaningful regressions. No warning suppression, fake fallback or weakened assertions.
6. Rebuild final changes and execute strict acceptance below. Retain readable bundles and visual proof. Only then follow authorized hooks/PR workflow and report completion per gate.

## Strict E2E gates

### Gate 0: Reproducible baseline

Record branch/HEAD/diff, installed build/config, device/OS, explicit Convex dev deployment, immutable Vercel destination and alias. Verify storage/bypass operation without printing secrets. Disposable dev chat/account, attached iPhone, healthy fresh stream. Prior URLs may be expired. Preserve session when test ends. Store redacted logs, screen recording, valid result bundle and manifest durably outside `/tmp` and Git.

### Gate 1: Actual chat publication

Launch normal chat without harness flags. Use `messageInput` / `sendMessageButton`: “Open Upwork in the computer, then scroll down and back up. Keep the session open.” A challenge page is real-site output; report it without bypassing it.

Correlate run/user/thread/session across tool discovery and instruction injection, media readiness, routed playlist/segment, authenticated publication, `getMobileChat.computerVideo`, and iOS startup. Publication warning followed by tool success fails this gate. No following text delta should be needed.

Record invocation, media-ready, publish, device-receipt, first-frame, PiP-start, tool-completion and assistant-completion times. Use monotonic clocks within a process and account for skew between processes. For deliberately slow navigation, prove publication/PiP before tool completion. For quick tools, require startup from availability during the continuing turn; do not delay production completion just to pass a test. Direct CLI calls without real user/thread identity are not E2E.

### Gate 2: Foreground physical PiP

Proposed budgets: preparation starts within 250 ms of usable descriptor; first frame and PiP each have a separate hard 15-second deadline. Warm 3-second startup remains an unproven performance target; record measured timing and provisioning separately.

Require did-start callback **and visible system PiP**, while chat remains foreground and agent continues. Support/possible flags and connected labels are insufficient. Record changing browser frames during real-site scroll within 10 seconds, and measure action-to-display lag. Verify native movement, snap/resize/hide, close/restore, and absence of old viewer UI and SwiftUI publication warnings.

Three consecutive physical runs of unchanged final implementation. Stop at first failure, investigate, then restart after justified fix. Backgrounding is a separately named diagnostic; it cannot convert foreground failure into a pass. Unsupported devices must explicitly skip/fail PiP acceptance, never silently pass. Simulator is decoder/state coverage only.

### Gate 3: Ownership and session lifecycle

| Case | Required result |
| --- | --- |
| Duplicate descriptors/tools, no text after descriptor | One prompt startup, no duplicate controller. |
| Agent finishes/stops, sandbox alive | Viewer stays usable, agent state truthful, sandbox retained. |
| User closes PiP, further results arrive | Session stays dismissed; no false live presentation state. |
| Switch A → empty B | A viewer not attributed to B; viewer detaches without ending A sandbox. |
| Return to valid A after completion / relaunch | Resume same valid session without fake UI or duplicate controller; detachment not permanent dismissal. |
| Fresh session plus historical successful end | Old end cannot stop new session. |
| Publication removed, expired or successfully ended | Viewer stops; terminal state; stale result cannot resurrect it. |
| Source host recreated / session replaced | Current layer/controller ownership, stale callbacks ignored. |
| Cold backend invocation / missing snapshot | Truthful identity, budgets, recovery and termination. |

No manual PiP launcher. If explicit dismissal versus later reopening requires product clarification, record that narrow ambiguity; do not invent the rejected page or block all old sessions indefinitely.

### Gate 4: Bounded failures in the product

Exercise provisioning/resume error, publication error, expired token/410, playlist/segment failure, encoder exit, frozen playback, unsupported PiP, and supported-but-impossible PiP. Each pending state must resolve to truthful compact transcript status by its deadline. First frame cannot cancel a pending presentation deadline. Errors only in DEBUG harness do not count.

Recovery targets a valid existing session or explicitly replaces an expired one. Distinguish navigation failure from desktop availability. Failed end must not falsely report sandbox termination. No hidden failures, indefinite spinner, or nonexistent inline fallback.

### Gate 5: Audio and app lifecycle

After foreground startup passes, separately test background/foreground, lock/unlock where supported, PiP restore and dictation before/during/after playback. No leaked audio ownership, paused-but-labelled-live state, duplicate controller, or accidental sandbox end. Background-only startup cannot satisfy Gate 2.

### Completion report

Report Gates 0–5 passed/failed/unverified, run IDs, valid artifact paths, source/diff/build/backend identities, device/OS, measured startup/lag and remaining limits. Rebuild after final edits. No new tests ran for this audit. **No completion claim until normal-chat physical PiP and lifecycle checks pass.**

## Copyable receiving-agent brief

> Continue from dirty branch `feat/v85-ios-chat-ui-grok-polish` in `/Users/mac/Projects/vlad.chat`. Read `docs/COMPUTER-USE-AUDIT-HANDOFF.md` first. Resolve the proven discrepancy between Convex's Preview alias and the immutable Preview used by direct stream tests. Separately diagnose physical AVKit `supported=yes, possible=no`; cause is unknown. Fix audited state, ownership and test gaps without a Computer Open sheet or fake PiP. Required: automatic native PiP during real chat work on the actual website, valid-session resume, Preview/dev only, rebuild and verification before completion. Preserve unrelated edits and secrets. Each experiment must discriminate a hypothesis. Harness success is not E2E proof.
