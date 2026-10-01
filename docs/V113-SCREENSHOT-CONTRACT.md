# V-113 screenshot contract handoff

Issue: https://linear.app/vladchatware/issue/V-113/render-screenshot-tool-outputs-inline-with-stacked-image-history-on

Inspection base: `8e7aaa0cb18273d144ff24a5d8c01f09f35080a7`. Integration base: `a9a87ccb8848bd6c809c272a21cc2b8e31174c26` (main, including V-101 PR #59).

## Existing contract and demonstrated gaps

`ComputerToolResult` already carries `ok`, `op`, `screenshotId`, `screenshotUrl`, MIME type and dimensions. MCP carries compact JSON text alongside actual pixels; direct AI SDK tools use `toModelOutput` for pixels. Web `threads.getUIMessages` exposes ordered UI parts and stream deltas. Native `threads.getMobileChat` exposes ordered `response.parts` with canonical tool-call IDs; `response.tools` mirrors those parts. Both transcript queries authorize the thread owner. Mobile normalizes plain JSON, MCP wrappers/content arrays and canonical `{type: "content", value}` envelopes, with a 4,000-character preview limit.

Before this slice, the existing `computerUseScreenshots` table stored image bytes, artifact ID, user-scoped session key, MIME, size, capture time and a 30-minute expiry. Expiry deleted transcript images. The table lacked immutable thread/turn/tool-call/concrete-session association; repeated upload inserted duplicate artifact IDs despite `.unique()` lookup. The public Next screenshot route had no caller authorization. Native image metadata depended on the truncated JSON preview, dimensions were hardcoded, and asynchronous upload failures escaped the tool's failure handler.

## Smallest additive durable contract

Reuse the artifact table, stored tool outputs and ordered transcript. Upload records the capture's actual thread and concrete session ID, plus intrinsic image dimensions and a byte digest. The session ID comes from the capture operation, never from a subsequent live session or the user session key.

Only `computer_screenshot` is wrapped in the durable agent path. Before returning successful output, an atomic mutation binds the artifact to `runId`, prompt `order`, `stepNumber` and `toolCallId`, verifies capture/thread ownership and result identity, and marks it retained. Retained images survive sandbox stop, expiry, session replacement and temporary-artifact cleanup. Retry of the same call replays the original JSON and exact pixels; racing captures resolve to the first canonical artifact. Other computer calls retain their activity behavior and temporary-artifact treatment. Missing captures/upload failures produce `ok: false` with an explicit error; failed SDK tool execution retains its existing failure state.

Upload retries with the same artifact ID, byte digest and capture metadata return the original storage ID and discard the redundant uploaded blob. Conflicting bytes/ownership/session/dimensions are rejected. Unattached artifacts retain their existing temporary cleanup policy. No replacement history table or client-side screenshot storage is introduced.

## Web query/stream handoff

1. Consume canonical `threads.getUIMessages` tool parts and stream updates. Successful `computer_screenshot` output keeps `screenshotId`/`screenshotUrl`, and adds `screenshotSessionId`/`screenshotCreatedAt`.
2. Resolve captures with `computerUseScreenshots.getForThread({threadId, artifactIds})`, authenticated as the thread owner. Request at most 100 IDs; duplicate IDs are collapsed in request encounter order. The result is `[{id, screenshot: metadata | null}]`; `null` means unavailable or outside this thread. This is an ID resolver, not an independent timeline.
3. Metadata includes `id`, storage `url`, `threadId`, `toolCallId`, prompt `order`, `stepNumber`, concrete `sessionId`, `createdAt`, MIME type, byte `size`, and intrinsic `width`/`height` when present. Match `toolCallId` and message order before rendering. Storage URLs are bearer access URLs granted by the authorized query; treat them as private media access, not identity.
4. The existing Next screenshot URL now requires a web auth cookie or Convex bearer token and redirects to authorized storage access with `private, no-store`. Unknown/unattributed captures are unavailable. The secret-authenticated internal download path remains available for agent vision/replay and accepts retained captures after expiry.

Use `(threadId, toolCallId, screenshotId)` for identity. Use transcript message order and ordered part encounter position for chronology; timestamps and URLs are not deduplication keys. Group adjacent eligible screenshot tool parts and put the newest at the front while retaining every distinct capture. Do not duplicate captures into assistant text or render a compatibility projection as another history.

## Native query/stream handoff

`threads.getMobileChat` adds optional `tool.screenshot`, equally on live deltas and persisted replay. Extraction happens before preview truncation. The authenticated query then verifies artifact/thread/call/order association and hydrates the actual storage URL and metadata. A matching image has `availability: "available"`; missing or mismatched bytes have `{id, url: "", availability: "unavailable"}`. A pending/running/failed capture has no successful image projection. Capture failures remain explicit in the existing `ComputerToolResult` JSON/error states.

```json
{
  "id": "call-first",
  "name": "computer_screenshot",
  "status": "completed",
  "screenshot": {
    "id": "cu_capture_first",
    "url": "<authorized storage URL>",
    "mimeType": "image/png",
    "width": 1,
    "height": 1,
    "sessionId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "createdAt": 123,
    "size": 70,
    "availability": "available"
  }
}
```

Render `response.parts` for placement, including tool `id` and parent message `order`. `response.tools` is a compatibility mirror and must not create duplicate images. Use `tool.screenshot` instead of parsing bounded output for image access. Keep fetch loading/failure states explicit. An ended live sandbox never gates history reads. Reload obtains another authorized access URL while artifact/call identity stays fixed.

## Fixtures and regression evidence

- `lib/mobile-screenshot-contract.test.ts`: single/multiple captures, unchanged identity across reload, duplicate stream outputs, every existing output envelope, long preview text, failed/loading states, separate snapshots, non-screenshot calls, actual PNG/JPEG dimensions.
- `convex/computerUseScreenshotHistory.test.ts`: real HTTP upload/download and duplicate-blob cleanup; exact retained bytes after reload/completion/expiry/live-session replacement; call binding/retry races; wrong thread/user/session and legacy attribution rejection; unavailable bytes; real canonical Agent messages through `getMobileChat`; real AI SDK retry replay without another capture execution.
- `lib/computer-use/vision.test.ts`: existing model/MCP pixel transport plus explicit empty-capture and upload-failure coverage.

## Integration and limits

V-101 #59 was merged before delivery; this slice fast-forwarded onto its exact main commit and preserved its title/schema changes. `convex/schema.ts` edits only `computerUseScreenshots` fields/indexes. Localized `convex/threads.ts` edits are imports, the screenshot-tool wrapper immediately after `getMcpTools` in `runAgentStep`, the mobile tool return validator, and post-stream native screenshot hydration. No title generation, account linking, renderer, floating viewer, or unrelated MCP/workflow behavior is changed.

This contract applies to explicit `computer_screenshot` invocations in the durable conversation path. Nested `run_code` screenshot helpers are not separate transcript tool invocations and retain their existing behavior. Standalone/legacy paths outside durable runs remain temporary. Legacy rows without capture attribution are not attached to the current session by guesswork; already expired bytes cannot be recovered. Retained storage has no session TTL; a future thread/artifact lifecycle policy can remove orphaned/deleted-thread media without coupling history to live sandboxes.

Bun is authorized. Delivery checks are recorded in the PR/Linear handoff. No web/iOS build, deployment, live Convex/provider/sandbox run or renderer/device acceptance is claimed. V-113 remains open until both renderers and integrated behavior pass.
