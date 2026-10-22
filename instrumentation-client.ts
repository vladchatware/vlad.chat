import posthog from "posthog-js"

const apiHost = process.env.NODE_ENV === "development"
  ? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com"
  : "/ingest"

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  api_host: apiHost,
  ui_host: "https://us.posthog.com",
  defaults: '2025-05-24',
  capture_exceptions: true, // This enables capturing exceptions using Error Tracking, set to false if you don't want this
  debug: process.env.NODE_ENV === "development",
});
