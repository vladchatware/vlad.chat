import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const convexMiddleware = convexAuthNextjsMiddleware();

export default async function middleware(request: NextRequest) {
  // Skip Convex auth middleware for Notion OAuth routes to preserve query params
  if (
    request.nextUrl.pathname.startsWith('/api/auth/notion') ||
    request.nextUrl.pathname.startsWith('/auth/notion')
  ) {
    return NextResponse.next();
  }
  
  return convexMiddleware(request);
}

export const config = {
  // The following matcher runs middleware on all routes
  // except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
