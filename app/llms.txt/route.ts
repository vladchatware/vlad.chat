import { NextResponse } from 'next/server';

const llmsTxtContent = `# vlad.chat

> A personal AI chatbot application where users can interact with Vlad, a software developer, to ask questions, explore Notion templates, and access knowledge from his Notion workspace.

vlad.chat is an AI-powered conversational interface that provides access to Vlad's knowledge base, projects, and Notion templates. The application features real-time streaming responses, supports multiple AI models (including Kimi K2, GPT 5.2 Codex, Grok 4, and DeepSeek 3.2), and integrates with Notion for knowledge management. Users can chat anonymously or sign in with Google for unlimited access. The platform also includes a lounge feature for group conversations and provides access to Vlad's shop and music.

## Main Pages

- [Home](https://vlad.chat/): Main chat interface where users interact with Vlad
- [The Lounge](https://vlad.chat/lounge): Group chat feature for casual conversations
- [Shop](https://shop.vlad.chat): Vlad's product store featuring Notion templates and introspective tools
- [Music](https://music.vlad.chat): Vlad's music collection

## API Endpoints

- [Chat API](https://vlad.chat/api/chat): POST endpoint for sending messages and receiving streaming AI responses
- [MCP API](https://vlad.chat/api/mcp): Model Context Protocol endpoint for Notion workspace access
- [Checkout API](https://vlad.chat/api/checkout_session): POST endpoint for Stripe payment processing

## Features

- AI-powered conversations with streaming responses
- Notion knowledge base integration for accessing Vlad's projects, templates, and information
- Multiple AI model support (Kimi K2, GPT 5.2 Codex, Grok 4, DeepSeek 3.2)
- Anonymous and Google OAuth authentication
- Credit-based usage system with trial messages
- Real-time reasoning display for AI responses
- Source citations and references
`;

export async function GET() {
  return new NextResponse(llmsTxtContent, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}