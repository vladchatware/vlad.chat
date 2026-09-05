import { OpenTelemetry } from "@ai-sdk/otel";
import { PostHogSpanProcessor } from "@posthog/ai/otel";
import { registerOTel } from "@vercel/otel";
import { registerTelemetry } from "ai";

export function register() {
  registerTelemetry(new OpenTelemetry());

  registerOTel({
    serviceName: "vlad-chat",
    spanProcessors: [
      new PostHogSpanProcessor({
        projectToken: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      }),
    ],
  });
}
