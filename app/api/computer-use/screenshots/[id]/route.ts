import { NextResponse } from "next/server";
import { getScreenshot } from "@/lib/computer-use";

/** Shared screenshot fetch for web <img> and iOS URLSession. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id || !/^cu_[a-z0-9_]+$/i.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const artifact = getScreenshot(id);
  if (!artifact) {
    return new NextResponse("Expired or unknown screenshot", { status: 404 });
  }
  return new NextResponse(new Uint8Array(artifact.png), {
    status: 200,
    headers: {
      "Content-Type": artifact.contentType,
      "Cache-Control": "private, max-age=60",
      "X-Computer-Use-Session": artifact.sessionKey,
    },
  });
}
