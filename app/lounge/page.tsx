import { LoungeChat } from '@/components/lounge-chat';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: "The Lounge | vlad.chat",
  description: "An ephemeral group chat that resets daily. Join the conversation!",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#020617', // slate-950 - matches dark background
  colorScheme: 'dark',
};

export default function LoungePage() {
  return <LoungeChat />;
}

