import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import { bearerToken, digestApiKey } from "@/lib/api-key";
import { openAiError } from "@/lib/openai-compat";

export async function authenticateProviderRequest(request: Request) {
  const secret = bearerToken(request);
  if (!secret || !secret.startsWith("vlad_")) {
    return {
      ok: false as const,
      error: openAiError(
        "Missing or malformed Bearer API key.",
        401,
        "authentication_error",
        "invalid_api_key",
      ),
    };
  }

  const digest = digestApiKey(secret);
  let principal;
  try {
    principal = await fetchQuery(api.users.resolveApiKey, { digest });
  } catch {
    return {
      ok: false as const,
      error: openAiError(
        "Provider authentication service is temporarily unavailable.",
        503,
        "server_error",
        "authentication_unavailable",
      ),
    };
  }
  if (!principal) {
    return {
      ok: false as const,
      error: openAiError(
        "Invalid or revoked API key.",
        401,
        "authentication_error",
        "invalid_api_key",
      ),
    };
  }

  return { ok: true as const, digest, hasCredits: principal.hasCredits };
}
