import { ChatBotDemo } from '@/components/chat';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const capitalizedSlug = slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  const title = `What Vlad knows about ${capitalizedSlug} - Expert insights and answers`;
  const description = `Discover what Vlad knows about ${capitalizedSlug}. Get expert insights, ask questions, and learn from a software developer with over a decade of experience. Start your conversation today.`;
  const imageUrl = `/${slug}/opengraph-image`;
  
  return {
    title: `${title} | Vlad.chat`,
    description,
    openGraph: {
      type: "article",
      url: `/${slug}`,
      title,
      description,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function SlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Normalize the slug: convert hyphens to spaces
  // e.g., "inner-work" -> "inner work"
  const normalizedMessage = slug.replace(/-/g, ' ');

  return <ChatBotDemo autoMessage={normalizedMessage} />;
}
