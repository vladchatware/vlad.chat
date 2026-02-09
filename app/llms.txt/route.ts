import { NextResponse } from 'next/server';

const llmsTxtContent = `# vlad.chat

> AI chat as the primary surface, connected to Vlad's store, music app, and media engine.

vlad.chat is an AI-powered conversational interface for interacting with Vlad, his public products, and project ecosystem.

## Ecosystem

- [vlad.chat](https://vlad.chat): Main chat interface and knowledge access
- [shop.vlad.chat](https://shop.vlad.chat): Product storefront (templates, frameworks, agents, letters)
- [music.vlad.chat](https://music.vlad.chat): AI-assisted music player experience
- [media.vlad.chat](https://media.vlad.chat): AI content generation engine

## Main Pages

- [Home](https://vlad.chat/): Primary chat experience
- [The Lounge](https://vlad.chat/lounge): Group chat space
- [Shop](https://shop.vlad.chat): Storefront
- [Music](https://music.vlad.chat): Music application
- [Media](https://media.vlad.chat): Media/content engine

## API Endpoints

- [Chat API](https://vlad.chat/api/chat): POST endpoint for sending messages and receiving streaming AI responses
- [MCP API](https://vlad.chat/api/mcp): Model Context Protocol endpoint for Notion workspace access
- [Checkout API](https://vlad.chat/api/checkout_session): POST endpoint for Stripe payment processing

## Shop (shop.vlad.chat)

### Categories

- Framework
- Introspective Tools
- AI Agents
- Letters
- About

### Representative Products (Public Links)

- [Decision Compass](https://shop.vlad.chat/l/framework)
- [The Master Key Notion Template](https://shop.vlad.chat/l/the-master-key)
- [The Inner Work Notion Template](https://shop.vlad.chat/l/the-inner-work)
- [Habits Notion Template](https://shop.vlad.chat/l/habits)
- [Notion Scroll: Breaking the Limits - ACT II (Limitless)](https://shop.vlad.chat/l/limitless)
- [Notion Scroll: Emotional Trading](https://shop.vlad.chat/l/trading)
- [The Complete Scrolls Collection](https://shop.vlad.chat/l/scrolls)
- [Music Streaming Agent](https://shop.vlad.chat/l/music)
- [Social Media Agent: Content Engine](https://shop.vlad.chat/l/media)
- [Digital Twin Terminal](https://shop.vlad.chat/l/chat)

## Music (music.vlad.chat)

- Site: [music.vlad.chat](https://music.vlad.chat)
- Repository: [vladchatware/music.vlad.chat](https://github.com/vladchatware/music.vlad.chat)
- Capabilities:
  - AI DJ interaction for music requests
  - SoundCloud-backed track discovery and playback
  - Real-time 3D audio visualization
  - Authentication and credit/payment flows

## Media (media.vlad.chat)

- Site: [media.vlad.chat](https://media.vlad.chat)
- Repository: [vladchatware/media.vlad.chat](https://github.com/vladchatware/media.vlad.chat)
- Capabilities:
  - AI-generated short-form workflows (story, carousel, tweet, thread, video)
  - MCP endpoint integration for tool-based generation
  - Remotion-based rendering pipeline for media output
`;

export async function GET() {
  return new NextResponse(llmsTxtContent, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
