import { authenticateProviderRequest } from "@/lib/provider-auth";
import { PROVIDER_MODELS } from "@/lib/provider";

export async function GET(request: Request) {
  const authentication = await authenticateProviderRequest(request);
  if (!authentication.ok) return authentication.error;

  return Response.json({
    object: "list",
    data: PROVIDER_MODELS.map((model) => ({
      id: model.id,
      object: "model",
      created: 0,
      owned_by: "vlad.chat",
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
