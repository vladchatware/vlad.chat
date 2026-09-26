/**
 * Computer-use agent skill — runtime copy of `skills/computer-use/SKILL.md`.
 * Inject into generateReply / chat / lounge instructions when computer_* tools
 * are present. Keep this file in sync with the SKILL.md body.
 */
export const COMPUTER_USE_SKILL_NAME = "computer-use" as const;

/** Full SKILL.md body (no YAML frontmatter) for system-prompt injection. */
export const COMPUTER_USE_SKILL_BODY = `# Computer use playbook

## When to use

Use this skill when driving the **vlad.chat sandbox computer**:

- Tools: \`computer_open\`, \`computer_screenshot\`, \`computer_act\`, \`computer_handoff\`, \`computer_end\`
- Live watch / human handoff: \`viewerUrl\` (noVNC desk)
- Desk driver: **cua-driver** first for screenshot and act; CDP/Playwright if the driver fails

Prefer a dedicated connector or MCP when one already covers the site. Use the desk for visual / no-connector flows.

## Control loop

Always:

1. **Screenshot** — \`computer_screenshot\` (or the fresh shot returned after an act).
2. **Plan from the latest frame** — decide the next gesture only from that image and tool JSON.
3. **One act** — a single \`computer_act\`.
4. **Screenshot verify** — after every act, re-shot before the next decision.

Never chain multiple guessed acts from a stale frame. **After every act, always re-shot before the next decision.**

## Coordinates and focus

- Use **window-local coordinates from the shot just taken** (not an older frame, not guessed layout).
- **Focus the field before typing**: click the input (or otherwise focus it), then \`type\` / \`key\`. Do not type into an unfocused page.
- Prefer small, deliberate clicks on clearly visible targets in the latest screenshot.

### \`computer_act\` shapes

| Action | Payload |
|---|---|
| click | \`{ type: "click", x, y, button?: "left"\\|"right"\\|"middle" }\` |
| type | \`{ type: "type", text }\` |
| key | \`{ type: "key", key }\` |
| scroll | \`{ type: "scroll", x, y, deltaX?, deltaY? }\` |
| wait | \`{ type: "wait", ms? }\` |
| drag | \`{ type: "drag", fromX, fromY, toX, toY }\` |

## viewerUrl vs tools

- **\`viewerUrl\`**: for the human to watch live, take over, or finish a gated step. Share it when handoff or observation matters.
- **Tools**: for agent control (\`computer_screenshot\` / \`computer_act\`). Do not assume the human saw what you did unless they have \`viewerUrl\` or you describe the latest shot.

## Sessions

- **Reuse** the open session for the same task.
- Call **\`computer_open\` only** to navigate to a URL or start a new session after teardown / reclaim — do not open a second browser.
- Call **\`computer_end\`** when the browser task is finished so the sandbox is released.

## Caps and safety

- Respect session **TTL** and **step budget** (fail closed when hit). Keep tasks short; end and reopen for a new short task if caps trip.
- **Never pay, sign, approve allowances, submit checkout, or confirm purchases** unless the user **explicitly asked for that action in the same turn**.
- Payment / signing-like text in \`type\` is refused by the tools — use \`computer_handoff\` instead of forcing through.
- Do not paste secrets unless the user supplied them **this turn** for that purpose.

## Handoff

Call \`computer_handoff\` and stop acting when you hit:

- SSO / OAuth login
- 2FA / OTP
- Captcha
- Payment / checkout confirmation
- Passkey / WebAuthn / wallet signing

Tell the user to finish in \`viewerUrl\`, then continue only after they confirm — with a fresh screenshot on the **same** session (do not open a new sandbox unless the old one ended).

## Driver fallback

1. Prefer **cua-driver** (desk bridge) for screenshot and act.
2. If the driver fails, **CDP / Playwright** is OK for the same gesture.
3. Keep the **same loop** either way: shot → plan → one act → shot verify.

## Action scenarios

Full catalog (mouse, keyboard, session, takeover, safety, Grok Bot parity): [\`docs/V83-COMPUTER-USE-ACTION-SCENARIOS.md\`](../../docs/V83-COMPUTER-USE-ACTION-SCENARIOS.md). Keep this skill as the short loop; do not duplicate the catalog here.

## Done

When the user goal is met (or blocked on handoff they will finish themselves), call \`computer_end\` unless they still need the live desk open.
`;

/** Instruction fragment to append when computer_* tools are available. */
export function computerUseInstruction(): string {
  return `\n\n${COMPUTER_USE_SKILL_BODY}`;
}

/** True when the toolset includes any computer_* MCP/tool entry. */
export function hasComputerUseTools(
  tools: Record<string, unknown> | null | undefined,
): boolean {
  if (!tools) return false;
  return (
    "computer_open" in tools ||
    "computer_screenshot" in tools ||
    "computer_act" in tools ||
    "computer_handoff" in tools ||
    "computer_end" in tools
  );
}
