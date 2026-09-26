"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ReactNode } from "react";
import posthog from "posthog-js";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

let posthogInitialized = false;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (typeof window !== "undefined" && !posthogInitialized) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST!,
      capture_pageview: false,
      persistence: "localStorage+cookie",
      autocapture: false,
    });
    posthogInitialized = true;
  }
  return <ConvexAuthNextjsProvider client={convex}>{children}</ConvexAuthNextjsProvider>;
}
