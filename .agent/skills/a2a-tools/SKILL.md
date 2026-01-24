# A2A Tools Skill

A skill for managing and verifying Agent-to-Agent (A2A) protocol integration.

## Purpose
Ensure that the `vlad.chat` agent is correctly exposing and responding to A2A messages.

## Instructions
1. **Verify Agent Card**: Check if `public/.well-known/agent.json` exists and contains the correct public key and capabilities.
2. **Verify API Route**: Ensure `app/api/a2a/route.ts` is correctly handling POST requests with the A2A header and payload.
3. **Automated Verification**: Run `node .agent/skills/a2a-tools/scripts/verify.js` to perform basic checks.
4. **Test Communication**: Use local scripts or `curl` to simulate an A2A message and verify the response (unary or streaming).
5. **Billing Check**: Verify that A2A usage is correctly linked to the user's balance/tokens in Convex.

## Metadata Reference
- `vladsAgentCard`: The metadata object defining the agent's identity.
- `A2A-JS`: The library used for protocol handling.
