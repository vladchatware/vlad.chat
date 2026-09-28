# Computer viewer UX sketch

Standalone, interactive design sketch for the floating computer preview and expanded inspector. Open `index.html` directly in a browser; no install or build step.

## What is implemented

- One persistent illustrative desktop surface moves between floating preview and inspector.
- Floating preview expands, hides, reopens from the transcript entry, drags and docks, tucks at an edge, and resizes from its corner.
- Wide layouts use a trailing inspector. Phone-width layouts use a full-width inspector surface.
- Inspector trackpad uses relative cursor deltas. Touch-down does not teleport cursor. Primary/secondary click and fit actions show simulated feedback.
- Keyboard visibility and representative desktop keys; separate remote text field and chat draft.
- Agent working → taking control → you have control → resume agent.
- Connection menu shows connecting, reconnecting, failed and ended states. Retry is simulated.
- Light/dark switch and reduced-motion CSS.

## Simulated / omitted

The desktop is a purpose-built illustrative page, not a real remote capture or VNC session. Cursor, clicks, keyboard, ownership handoff, connection lifecycle and frame status are local simulations. The keyboard panel illustrates accessory keys; browser does not open a system keyboard for the fake remote computer. This sketch does not demonstrate transport continuity, streaming performance, touch latency, backend handoff or production accessibility of the remote page.

## Decisions to review

- Floating preview: 220–300 px on phone, 220–400 px on wider layouts; upper trailing dock.
- Inspector: 410 px trailing column on wide layouts; full-width surface below 760 px.
- Phone opens with keyboard accessory visible. Collapse/hide keep the session alive.
- First input asks for control; agent resume is explicit.

## Interaction checklist

Source interactions remain unexercised. Two user supplied wide screenshots were visually reviewed: floating preview and expanded inspector. Phone layout and gestures were not captured or tested.

- Floating tap/expand, drag/dock, edge tuck, corner resize and touch pinch resize.
- Inspector collapse, hide and transcript reopen preserve illustrative session/cursor state.
- Relative cursor movement, tap/double-click, right-click, wheel scroll and hold-drag have simulated feedback. Touch-down never sets cursor position.
- Keyboard accessory, remote text, control handoff, connection states, light/dark and reduced motion.
- Wide trailing inspector and compact full-width inspector CSS included.

Native keyboard, actual VNC input, physical-device behavior and performance remain outside this sketch. Supplied screenshots are not copied into this folder.
