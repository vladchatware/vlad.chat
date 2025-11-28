import { LoungeChat } from '@/components/lounge-chat';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "The Lounge | vlad.chat",
  description: "An ephemeral group chat that resets daily. Join the conversation!",
};

export default function LoungePage() {
  return <LoungeChat />;
}

