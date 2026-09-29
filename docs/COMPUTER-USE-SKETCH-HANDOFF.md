# Handoff: computer viewer interaction sketch

Prepared September 28, 2026. Recipient: sketch/design implementation agent.

## Assignment

Implement an interactive sketch of the computer-viewer UX described in [COMPUTER-USE-VIEWER-UX-SPEC.md](COMPUTER-USE-VIEWER-UX-SPEC.md). Deliver the implemented sketch for discussion afterwards. The coordinating agent is preparing this handoff only and must not create or revise the sketch itself.

This is a sketch assignment, not authorization to implement the production viewer, integrate a VNC library, change the sandbox, deploy services or modify the existing app. The product specification remains the source of truth. Its proposed defaults are sufficient to proceed with the sketch; preserve them as reviewable decisions rather than seeking approval for each minor design choice.

## Required experience

1. **Floating preview:** a compact, rounded window with the visual restraint and feel of ChatGPT's floating window. Keep preview content dominant, chrome minimal, and chat usable behind it.
2. **Expand:** the same preview transitions into the computer inspector. No bottom sheet or intermediate Computer Open/loading page.
3. **Inspector:** live-desktop presentation area, relative trackpad input, keyboard and compact desktop-key controls.
4. **Collapse:** return to the previous floating size and dock without losing cursor position, entered text or session identity.
5. **Sandbox boundary:** production will use standard VNC with client-side presentation. No FFmpeg/HLS/AVKit work belongs to this sketch.

The user explicitly selected **trackpad behavior**: swiping moves the cursor relatively. Lifting and touching elsewhere must not teleport it. Tap clicks at the cursor, not at the touch point.

## References and precedence

- Primary: the written UX specification linked above.
- Spatial reference: the user-supplied Sidebar / Canvas / Inspector illustration. On wide layouts, conversations are left, chat is center, computer inspector is trailing. Do not copy the orange gradient or decorative desktop traffic lights.
- Visual reference: the floating window in ChatGPT. Use actual reference material where available; do not claim an exact match based only on generic PiP conventions. Proposed dimensions and chrome remain reviewable after delivery.
- Existing VladChat typography, spacing and light/dark appearance supply surrounding app context.
- **Do not use `docs/design/computer-inspector.html` as an approved design or implementation base.** It was created prematurely by the coordinating agent. The user requested a separate sketch implementer. Leave that artifact unchanged and create your own deliverable in a distinct location.
- Older native-PiP handoffs and acceptance gates are historical. Do not continue the AVKit investigation as a prerequisite for this assignment.

## Scope of the interactive sketch

Build one coherent design with responsive phone and regular-width layouts. Avoid an unsolicited gallery of competing designs.

| Interaction | Demonstrate |
| --- | --- |
| Session availability | Preview appears during an ongoing conversation; it does not wait for message completion. |
| Floating-window drag | Follows input smoothly, then docks; never moves remote cursor. |
| Resize / tuck | Bounded aspect-preserving size; edge tab restores prior size. |
| Expand / collapse | Same content and session state move between floating preview and inspector. |
| Phone inspector | Full-width content surface entering from trailing side, with usable preview above keyboard. |
| Wide inspector | Trailing column beside chat; sidebar yields space when necessary. |
| Trackpad | Relative pointer movement, click, secondary click and scroll; show clear feedback. |
| Keyboard | Show/hide, text entry and representative desktop keys, with focus distinct from chat composer. |
| Control ownership | Agent working → Taking control → You have control → Resume agent, using the spec's proposed policy. |
| Hide / reopen | Hide suppresses automatic reopening; transcript Computer entry restores the same valid session. |
| Connection state | Connecting, reconnecting, failed and ended are visible and bounded. |

Sketch state can be local and deterministic. Clearly identify simulated connection/control transitions and keyboard illustration. Do not claim a real remote session, backend handoff or functioning system keyboard from a visual simulation. Use an available real desktop/site capture for content where appropriate; label any placeholder. A running counter or animation does not establish production streaming performance.

## Keep the review focused

- No native system PiP, cross-app floating window, video conversion or transport experiments.
- No new settings dashboard, terminal, toolbar overload or unrelated chat redesign.
- Preview controls: expand and hide. Detailed input belongs in inspector.
- Respect the spec's distinction between collapse, hide, ending a session and resuming the agent.
- Preserve one apparent session across all transitions; do not fake continuity by resetting content after expansion.
- Treat sizing, keyboard defaults and control-transfer policy as proposed. Report actual choices after implementing them so the user can discuss a concrete result.

## Deliverables

1. A separately located, runnable interactive sketch with brief launch/open instructions.
2. Phone and wide-layout captures showing both floating and expanded states; a short interaction recording if supported.
3. A concise behavior checklist: implemented, simulated, omitted, and any known limitations.
4. A short list of design decisions for discussion after the sketch is ready. Do not present untested behavior as complete or pause repeatedly for minor aesthetic choices.

## Verification before handback

- Exercise expand/collapse repeatedly and verify retained content, cursor, text and dock position.
- Check phone portrait, landscape/narrow layout and regular width; no clipped controls or obscured composer.
- Verify floating gestures and inspector trackpad gestures do not leak into one another.
- Verify keyboard toggle, text focus, hide/reopen and connection-state transitions.
- Check light/dark contrast, readable labels, touch targets and reduced-motion treatment.
- Record which gestures were actually exercised. The sketch does not prove physical iOS performance or production VNC correctness.
- Preserve unrelated repository changes. Do not run app builds, Bun commands or deployments solely to produce a standalone sketch.

## Copyable assignment

> Implement an interactive sketch from `docs/COMPUTER-USE-SKETCH-HANDOFF.md` and `docs/COMPUTER-USE-VIEWER-UX-SPEC.md`. The floating computer preview should look like ChatGPT's floating window; expansion opens a trailing inspector with desktop preview, keyboard and relative trackpad navigation. On phone, adapt the inspector to a full-width content surface. Preserve one session and interaction state across transitions. Use the spec's proposed defaults, then deliver the implemented sketch with captures and a short review checklist; discussion comes afterwards. Do not use the coordinator's earlier `docs/design/computer-inspector.html` as an approved base. Do not change production app/backend code or implement FFmpeg/HLS/native PiP. Clearly label simulated behavior.
