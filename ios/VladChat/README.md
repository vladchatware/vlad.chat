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
it does not charge a customer or verify through Apple's production API. The app
can credit local transactions on a Convex dev deployment when
`ALLOW_XCODE_STOREKIT_REDEMPTION=true` is set there. Keep this flag unset in
production. Use an App Store sandbox purchase to test Apple's verification and
credit delivery end to end.

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

## Agent Live Activities

The `VladAgentLiveActivity` WidgetKit extension shares only a run ID, thread ID,
phase, step count, and update time with ActivityKit. Chat titles, prompts,
message text, tool arguments/results, and failure details are excluded. Runs
observed for at least five seconds, or when leaving the app, appear on supported system surfaces when
Live Activities are enabled. Initial conversation loading keeps its in-thread
indicator. User dismissal is respected for the remainder of that run.

The native controller tracks active conversations independently of chat
selection, restores activities on relaunch, ends them on terminal snapshots,
and clears them on logout or conversation deletion. An activity older than its
freshness deadline shows an outdated-status hint. Tapping opens its conversation
after the authenticated chat list loads.

App subscriptions update activities while the process runs. Configured APNs
delivery updates and ends them after iOS suspends the process. For deterministic simulator inspection,
launch a Debug build with `--ui-test-agent-activity`. It uses the production
controller and widget with synthetic lifecycle states and no backend traffic.

### Background delivery setup

Enable **Push Notifications** on the `chat.vlad.ios` App ID in Apple Developer,
then regenerate provisioning profiles. The app target includes the capability
and `aps-environment`; Debug uses `development`, Release uses `production`.
ActivityKit supplies its own per-activity tokens; notification-alert permission
and `registerForRemoteNotifications()` are not needed for these updates.

Create an APNs token signing key in Apple Developer. Configure the backend with:

- `APNS_KEY_ID`: the APNs key ID.
- `APNS_TEAM_ID`: the Apple Developer team ID.
- `APNS_PRIVATE_KEY`: the `.p8` contents, kept outside the repository.
- `APNS_BUNDLE_ID`: optional, defaults to `chat.vlad.ios`.

The authenticated availability query enables push token requests only when the
three signing values exist. Without configuration, local activities still work
and show outdated status after two minutes without an update. Token registration
verifies run ownership, replaces rotated tokens, expires registrations after
eight hours, and unregisters on dismissal/logout. Run lifecycle mutations
schedule coalesced, versioned deliveries, rather than polling. HTTP/2 requests
use the `liveactivity` topic; updates use priority 5 and terminal ends priority 10.

Before shipping, use a provisioned iPhone build to verify sandbox token
registration, model/tool updates while the app is suspended, stop/pause/resume,
and completion/failure removing the activity. Repeat with a production-signed
TestFlight build. Mock transport tests and unsigned simulator fixtures do not
verify APNs credentials, provisioning, or actual remote delivery. No backend
deployment is performed by adding this code.

## SwiftChat source

UI source is pinned from [SwiftChat](https://github.com/sachaservan/SwiftChat) at
`d6f54ccf9e84d2fec672b7b89d5a67dd6ee0f957`; see `SWIFTCHAT_NOTICE.md`.
Its README claims MIT, but upstream omits the referenced LICENSE file while source
headers say “All rights reserved.” Resolve that conflict before distribution.
