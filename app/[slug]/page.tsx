import { ChatBotDemo } from '@/components/chat';

interface PageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function SlugPage({ params }: PageProps) {
  const { slug } = await params;
  // Normalize the slug: convert hyphens to spaces
  // e.g., "inner-work" -> "inner work"
  const normalizedMessage = slug.replace(/-/g, ' ');

  return <ChatBotDemo autoMessage={normalizedMessage} />;
}
