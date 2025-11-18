'use client';

import { ChatBotDemo } from '@/components/chat';

interface PageProps {
  params: {
    slug: string;
  };
}

export default function SlugPage({ params }: PageProps) {
  // Normalize the slug: convert hyphens to spaces
  // e.g., "inner-work" -> "inner work"
  const normalizedMessage = params.slug.replace(/-/g, ' ');

  return <ChatBotDemo autoMessage={normalizedMessage} />;
}
