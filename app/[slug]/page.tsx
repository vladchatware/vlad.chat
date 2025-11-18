import { ChatBotDemo } from '@/components/chat';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Chat - ${slug}`,
  };
}

export default async function SlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Normalize the slug: convert hyphens to spaces
  // e.g., "inner-work" -> "inner work"
  const normalizedMessage = slug.replace(/-/g, ' ');

  return <ChatBotDemo autoMessage={normalizedMessage} />;
}
