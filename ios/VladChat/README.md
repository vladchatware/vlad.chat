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

Multiple Convex threads and attachment uploads are supported. Linked accounts
can buy credit packs from Account; StoreKit transactions are verified by the
backend and redeemed idempotently.

## StoreKit credit pack setup

The product ID is `chat.vlad.tokens.5` and must be a **Consumable** In-App
Purchase in App Store Connect. Add its localized name and description, set a
price and storefront availability, and submit it for review with an app version.
The App Store Connect product must use the same ID; the local configuration below
does not create or publish the App Store product.

The shared `VladChat` Xcode scheme uses `Configuration.storekit` for local Run
actions. It supplies a $4.99 simulator product so the purchase UI and flow can
be exercised before App Store Connect setup. The local purchase is simulated;
it does not charge a customer or verify through Apple's production API.

For backend redemption, create an In-App Purchase key in App Store Connect and
set these environment variables in **both** Convex dev and production
deployments:

- `APPLE_BUNDLE_ID=chat.vlad.ios`
- `APPLE_ISSUER_ID` from App Store Connect API keys
- `APPLE_KEY_ID` from the In-App Purchase key
- `APPLE_PRIVATE_KEY` with the complete PEM contents of that `.p8` file

Keep the `.p8` file outside the repository. Once variables are set, run a
sandbox purchase from a TestFlight or sandbox build to verify StoreKit product
availability, Apple's transaction lookup, and Convex crediting end to end.
Sign In with Apple keys can't authenticate App Store Server API requests; create
a separate key under **Users and Access → Integrations → In-App Purchase**.

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
