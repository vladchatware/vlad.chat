import "server-only";

export { digestApiKey, generateApiKey } from "@/lib/api-key-secret";

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}
