import type { Metadata } from "next";

import { ProviderDashboard } from "@/components/provider-dashboard";

export const metadata: Metadata = {
  title: "Provider API",
  description: "Create vlad.chat API keys and connect OpenCode or DeepSeek Harness.",
};

export default function ProviderPage() {
  return <ProviderDashboard />;
}
