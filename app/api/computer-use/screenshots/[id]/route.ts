import { NextResponse } from "next/server";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

/** Authenticated compatibility URL; native queries provide direct storage URLs. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id || !/^cu_[a-z0-9_]{8,80}$/i.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const authorization = req.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7) : await convexAuthNextjsToken();
  if (!token) return new NextResponse("Unauthorized", { status: 401 });
  const artifact = await fetchQuery(api.computerUseScreenshots.getArtifact, { artifactId: id }, { token });
  if (!artifact) {
    return new NextResponse("Unknown or unavailable screenshot", { status: 404 });
  }
  return NextResponse.redirect(artifact.url, {
    status: 307,
    headers: { "Cache-Control": "private, no-store" },
  });
}
