# Vlad for iOS

Native SwiftUI client backed by same Convex deployment as vlad.chat.

## Configure

1. Copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig`.
2. Set `VLAD_CONVEX_URL` to `NEXT_PUBLIC_CONVEX_URL` from repository `.env.local`.
3. Run `xcodegen generate` from this directory after changing `project.yml`.
4. Open `VladChat.xcodeproj` in Xcode.

## Current slice

- Anonymous Convex Auth session stored in Keychain
- Google account linking for anonymous sessions
- Sign in with Apple for anonymous sessions
- Reactive chat history from Convex
- Server-owned AI generation, credits, tools, and model access
- SwiftChat message renderer, sidebar, composer, model picker, and web-search UI
- Markdown, LaTeX, code blocks, citations, and attachment presentation from SwiftChat

StoreKit purchases, Convex attachment uploads, voice transcription and
multi-thread mutations remain follow-up slices.

To enable Apple sign-in, configure `AUTH_APPLE_ID` with an Apple Services ID
and `AUTH_APPLE_SECRET` with its generated client secret in the Convex
deployment. Apple requires the Sign in with Apple capability on the app ID;
the client secret expires every six months and must be renewed.

## SwiftChat source

UI source is pinned from [SwiftChat](https://github.com/sachaservan/SwiftChat) at
`d6f54ccf9e84d2fec672b7b89d5a67dd6ee0f957`; see `SWIFTCHAT_NOTICE.md`.
Its README claims MIT, but upstream omits the referenced LICENSE file while source
headers say “All rights reserved.” Resolve that conflict before distribution.
