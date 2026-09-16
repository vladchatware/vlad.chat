# Vlad for iOS

Native SwiftUI client backed by same Convex deployment as vlad.chat.

## Configure

1. Copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig`.
2. Set `VLAD_CONVEX_URL` to `NEXT_PUBLIC_CONVEX_URL` from repository `.env.local`.
3. Run `xcodegen generate` from this directory after changing `project.yml`.
4. Open `VladChat.xcodeproj` in Xcode.

## Current slice

- Anonymous Convex Auth session stored in Keychain
- Reactive chat history from Convex
- Server-owned AI generation, credits, tools, and model access
- SwiftChat message renderer, sidebar, composer, model picker, and web-search UI
- Markdown, LaTeX, code blocks, citations, and attachment presentation from SwiftChat

Google/account linking, StoreKit purchases, Convex attachment uploads, voice
transcription, multi-thread mutations, and stream-delta decoding remain follow-up
slices.

## SwiftChat source

UI source is pinned from [SwiftChat](https://github.com/sachaservan/SwiftChat) at
`d6f54ccf9e84d2fec672b7b89d5a67dd6ee0f957`; see `SWIFTCHAT_NOTICE.md`.
Its README claims MIT, but upstream omits the referenced LICENSE file while source
headers say “All rights reserved.” Resolve that conflict before distribution.
