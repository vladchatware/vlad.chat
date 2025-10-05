import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['8f63fa0efd79.ngrok-free.app', 'localhost', 'vlad.chat'],
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
  /* config options here */
};

export default nextConfig;
