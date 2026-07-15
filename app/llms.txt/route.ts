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

- [MCP API](https://vlad.chat/api/mcp): Model Context Protocol endpoint for Notion workspace access
- [Checkout API](https://vlad.chat/api/checkout_session): POST endpoint for Stripe payment processing

## Shop (shop.vlad.chat)

### Categories

- Framework
- Introspective Tools
- AI Agents
- Letters
- About

### Prompt Taxonomy (from chat prompts in lib/ai.ts)

- Operation Systems
- Scrolls
- Mental Models
- Playbooks

### Product Catalog Links

#### Operation Systems

- [Habits Notion Template](https://shop.vlad.chat/l/habits): Daily/weekly habit execution loop with tracking and review.
- [The Master Key Notion Template](https://shop.vlad.chat/l/the-master-key): Personal progress dashboard for reflection and consistency.
- [The Inner Work Notion Template](https://shop.vlad.chat/l/the-inner-work): Structured emotional processing and self-reflection workflow.
#### Scrolls

- [Notion Scroll: Uncovering Hidden Truths - ACT I](https://shop.vlad.chat/l/hidden-truths): Guided prompts for surfacing assumptions and blind spots.
- [The Complete Scrolls Collection](https://shop.vlad.chat/l/scrolls): Bundle of all scroll-based introspection frameworks.
- [Notion Scroll: The Idea Generation Framework - ACT III](https://shop.vlad.chat/l/idea): Prompted system for generating and refining ideas.
- [Notion Scroll: Breaking the Limits - ACT II (Limitless)](https://shop.vlad.chat/l/limitless): Framework for identifying and removing self-imposed constraints.
- [Notion Scroll: Emotional Trading](https://shop.vlad.chat/l/trading): Reflection framework for decision quality under emotional pressure.

#### Mental Models

- [Decision Compass](https://shop.vlad.chat/l/framework): Core decision model for moving from uncertainty to clear next action.
- [Stable Self Concept](https://shop.vlad.chat/l/owmffz): Model for identity stability and behavior alignment.

#### Playbooks

- [Notion Playbook - Sales Almanac](https://shop.vlad.chat/l/sales): Repeatable sales planning and execution playbook.
- [Shackleton Decision Manual](https://shop.vlad.chat/l/kyiegz): Adversity-oriented decision procedure for uncertain environments.
- [Combating learned helplessness](https://shop.vlad.chat/l/help): Recovery playbook for rebuilding agency through small repeatable actions.
- [Effective Communication](https://shop.vlad.chat/l/ijyrqe): Communication routines and checklists for clearer outcomes.
- [Geido Playbook](https://shop.vlad.chat/l/plrdb): Craft-discipline playbook for deliberate practice and iterative improvement.

#### AI Agents

- [Digital Twin Terminal](https://shop.vlad.chat/l/chat): Conversational AI agent product.
- [Music Streaming Agent](https://shop.vlad.chat/l/music): Agent workflow for AI-assisted music streaming use cases.
- [Social Media Agent: Content Engine](https://shop.vlad.chat/l/media): Agent workflow for AI-generated social content operations.
- [The Complete Scrolls Collection](https://shop.vlad.chat/l/scrolls): Cross-listed bundle from introspective tools.

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
