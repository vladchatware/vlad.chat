import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { api } from "@/convex/_generated/api";

const requestSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function POST(request: Request) {
  const token = await convexAuthNextjsToken();
  const user = await fetchQuery(api.users.viewer, {}, { token });
  if (!user || user.isAnonymous) {
    return NextResponse.json({ error: "Sign in with Google before creating an API key." }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "API key name must be between 1 and 80 characters." }, { status: 400 });
  }

  try {
    const generated = await fetchAction(api.apiKeys.create, {
      name: parsed.data.name,
    }, { token });

    return NextResponse.json(
      generated,
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create API key.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

}
