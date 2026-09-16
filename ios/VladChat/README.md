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

Tap Vlad's picture or name in the chat header to open Account. Anonymous users
can link Google or Apple there; linked users see their identity and credit
balances.

Multiple Convex threads and attachment uploads are supported. StoreKit purchases
remain follow-up slices.

To enable Apple sign-in, enable Sign in with Apple on the app ID, create an
Apple Services ID and key, then set `AUTH_APPLE_ID` and `AUTH_APPLE_SECRET` in
each Convex deployment. Register the callback URL
`https://<deployment>.convex.site/api/auth/callback/apple` with Apple. Keep the
client secret in Convex environment variables, outside the repo; it expires
every six months and must be renewed.

## SwiftChat source

UI source is pinned from [SwiftChat](https://github.com/sachaservan/SwiftChat) at
`d6f54ccf9e84d2fec672b7b89d5a67dd6ee0f957`; see `SWIFTCHAT_NOTICE.md`.
Its README claims MIT, but upstream omits the referenced LICENSE file while source
headers say “All rights reserved.” Resolve that conflict before distribution.
