import { timingSafeEqual } from "node:crypto";
import { cleanupExpiredComputerUseSandboxes } from "@/lib/computer-use/cleanup";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;

  const secretBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(authorization.slice("Bearer ".length));
  return (
    secretBytes.length === suppliedBytes.length &&
    timingSafeEqual(secretBytes, suppliedBytes)
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await cleanupExpiredComputerUseSandboxes();
    if (result.failed > 0) {
      return Response.json(result, {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Computer-use sandbox cleanup failed", error);
    return Response.json({ error: "Sandbox cleanup failed" }, { status: 500 });
  }
}
