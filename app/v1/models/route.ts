import { authenticateProviderRequest } from "@/lib/provider-auth";
import { PROVIDER_MODELS, isModelEnabled } from "@/lib/provider";

export async function GET(request: Request) {
  const authentication = await authenticateProviderRequest(request);
  if (!authentication.ok) return authentication.error;

  // Eligibility mirrors /v1/chat/completions: free models are listed while
  // operationally enabled; premium models (enabled:false by definition) are
  // listed for subscribers.
  const visible = PROVIDER_MODELS.filter(
    (model) => isModelEnabled(model.id) || authentication.premiumAllowed,
  );

  return Response.json({
    object: "list",
    data: visible.map((model) => ({
      id: model.id,
      object: "model",
      created: 0,
      owned_by: "vlad.chat",
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
