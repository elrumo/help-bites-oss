# HelpBites Native — build plan

## Current implementation

`HelpBitesNative.xcodeproj` is one SwiftUI target that runs natively on iPhone,
iPad and the Mac (iOS 18 / macOS 15 and later; no Mac Catalyst). The Mac gets a
real sidebar window (`Shell/MacShell.swift`); the few UIKit/AppKit differences
live in `Core/Platform.swift` and `Core/PlatformCompat.swift`. Open it in Xcode,
set `APP_BASE_URL` in `Config/Debug.xcconfig` to a reachable HTTPS tunnel/LAN
address for a physical device, then run the `HelpBitesNative` scheme on a
simulator, a device, or My Mac.

Launch speed: the signed-in shell paints from `SnapshotCache` (last `/me`,
projects and inbox page) before the network answers, startup requests run in
parallel, notification permission waits until after sign-in, and remote images
go through `CachedAsyncImage`. Release builds use whole-module optimisation and
thin LTO. The simulator default is
`http://localhost:3100`.

The companion server changes live outside this directory: `Device` schema,
device registration routes, and the event-bus APNs fan-out. Push stays disabled
until APNs credentials are present in the server environment.

The app is translated into the panel's languages (English, Catalan, Spanish, Japanese, Korean, Simplified
Chinese): every string lives in `App/Localizable.xcstrings`, Xcode adds new ones as you build, and the app follows the
device's language (per-app language in Settings on iOS, System Settings on the Mac). Text shown through a plain `String`
needs `String(localized:)` where it is defined; SwiftUI literals and the Design components' labels are picked up
automatically.

The app covers every page of the web panel (inbox, projects and all their
sections including Changelog, Onboarding, Legal, Brand, Pages and Revenue, Knowledge, Email, workspace
settings, AI, connections, team and invitations). It wears the web panel's
Linear-style design, and gets around the way each platform does. iPhone has a tab bar (Overview, Inbox, Projects, Templates, Settings by default), with
each tab's pages pushed beneath it: Projects › project › section. Settings › Tab bar picks up to five shortcuts
(also Planning, which lists the projects that have a planning board, and Knowledge) and their order, kept on the
device (`Shell/TabShortcuts.swift`); Settings always stays on the bar. On iPad the
tabs open into a sidebar, which is all the Mac shows; the sidebar also lists
every project's sections, as the web's does. The Mac menu bar (and iPad's ⌘
menu) carries the web's shortcuts. Sources are generated into the project by
XcodeGen (`xcodegen generate` after adding files):

```
App/
  Core/       APIClient, shared models, SessionStore (auth + request helpers), push
  Design/     Theme (the web panel's tokens, light/dark), glyphs, components
  Shell/      RootView, sign in, AppShell (tabs/sidebar, routes, menu bar), Workspace, ⌘K palette
  Features/   one folder per area of the panel: Inbox, Projects, Contacts, Knowledge,
              Assistants, Tickets, Feedback, Board, Changelog, Onboarding, Legal, Brand, Pages, Email,
              Campaigns, Flags, Settings
```

Every screen calls the API through `SessionStore.get/send/delete/upload`, which
add the bearer and send you back to sign in on a 401.

**Share sheet.** `HelpBitesShare/` is an iPhone/iPad share extension, *Add to Planning*: share a screenshot, photo,
video, link or text from any app and it opens the board's New item form (title, description, status, priority, assignee, target
date, labels, images and videos, feedback, public roadmap), with the shared image or video uploaded and attached (videos up to 100 MB are
streamed from a temporary file, never held in memory); tap a thumbnail to view it full screen. It is its own target
(SwiftUI over the same `/v1/admin/*` API, in Swift 5 mode because `NSItemProvider` is not `Sendable`) and shares
`Core/SharedCredentials.swift` with the app. The app publishes its server and workspace to the App Group
`group.com.helpbites.operator` and keeps the session token in the keychain group of the same name; enable the **App
Groups** capability on both targets (Signing & Capabilities) after setting your team, or the sheet says to sign in.
`tests/shareSheetNativeParity.test.ts` checks the constants it copies.

The email editor is native (`Features/Email/EmailEditor*.swift`). The design
stays the JSON the server stores (`EmailDesign`, with typed accessors), and
`EmailRender` (a port of `shared/email/render.ts`) turns it into the exact HTML
for Preview and exports. The canvas draws each block in SwiftUI: tap to select,
long-press to drag or for its actions, + to insert. On iPhone the inspector,
email settings, variables, layers and the AI designer share one sheet; on iPad
and Mac they're the web's sidebar and inspector. Edits autosave 800 ms after the
last one (`PATCH /v1/admin/emails/:id`), merge into one undo step when they're
within 600 ms, and other editors' saves arrive over `/v1/admin/emails/:id/events`.
The AI designer reads the same AI SDK stream as the web (`POST …/chat`). Image
blocks upload through `POST /v1/admin/emails/:id/image`. The ports of
`theme.ts`, `lint.ts` and `ops.ts` live in `EmailDesign*.swift`;
`tests/emailNativeParity.test.ts` checks their constants against `shared/email`.

A single SwiftUI app (iOS · iPadOS · macOS) for **operators/agents** — the admin
side of help-bites. It talks to the existing `/v1/admin/*` API, so it needs no
new product surface, only a native client plus **one backend addition: push
notifications (APNs)**, which the server does not have today.

The panel is a *global* agent inbox: any signed-in agent sees every project's
conversations. There is no per-agent project scoping to replicate. Auth is a
single `Authorization: Bearer r:<parseSessionToken>` header on every admin route.

---

## 1. What "everything the web app can do" actually is

Every admin capability maps to an existing endpoint. Nothing here is new API work.

| Web feature | Native screen | Endpoint(s) |
|---|---|---|
| First-run signup | Onboarding (only when setup needed) | `GET /v1/admin/setup` (is it needed) · `POST /v1/admin/setup` → `{sessionToken, agent}` |
| Sign in | Login | `POST /v1/admin/login` → `{sessionToken, agent}` |
| Create an account (HelpBites Cloud, the default server) | Sign in → Create account; shown only when `GET /v1/admin/setup` says `signup: "open"`. Change server under the server line | `POST /v1/cloud/signup` → `{sessionToken, agent}` |
| Session / who am I | app boot + 401 recovery | `GET /v1/admin/me` |
| Sign out | Settings | `POST /v1/admin/logout` |
| Inbox (filter by project/status/unread, search, paginate, unread total) | Inbox list | `GET /v1/admin/conversations?project&status&unread&q&before&limit` → `{conversations, endUsers, hasMore, totalUnread}` |
| Start a conversation | New chat | `POST /v1/admin/conversations` |
| Open one conversation (+ end user + project) | Conversation header | `GET /v1/admin/conversations/:id` |
| Transcript (paged) | Conversation scroll | `GET /v1/admin/conversations/:id/messages?before&limit` |
| Reply as the team (+ image attachments, optional email) | Composer | `POST /v1/admin/conversations/:id/messages` |
| Mark read | on view / scroll-to-bottom | `POST /v1/admin/conversations/:id/read` |
| Open / close (done) | Conversation menu | `POST /v1/admin/conversations/:id/status` |
| Delete a message | message long-press | `DELETE /v1/admin/messages/:id` |
| Upload image for a reply | composer attach | `POST /v1/admin/attachments` (multipart `file` + `conversationId`) → `{url, mime, size}` |
| Projects list / create / edit settings | Projects | `GET`/`POST /v1/admin/projects` · `PATCH /v1/admin/projects/:id` |
| Reveal / rotate project secret | Project detail | `GET /v1/admin/projects/:id/secret` · `POST /v1/admin/projects/:id/rotate-secret` |
| Team: list / add / remove agents | Team | `GET`/`POST /v1/admin/agents` · `DELETE /v1/admin/agents/:id` |
| End-user search | People / conversation context | `GET /v1/admin/end-users?project&q` |
| Live updates | everywhere (foreground) | `GET /v1/admin/events?project` (SSE: `message.created`, `message.deleted`, `conversation.updated`) |
| Developer page (embed snippet, identity-token contract, API docs) | Settings → Developer (mostly static + link to `/_docs/scalar`) | reference only |
| Reset password from the emailed link | Sign in → Forgot password → I have a link (or open the link in the app) | `POST /v1/admin/reset-password` |
| Project icon | Project › Dev → Project icon; drawn in the sidebar, lists and headers | `POST /v1/admin/projects/:id/logo` · `PATCH …/projects/:id {iconUrl}` |
| Project email sender (from, domain, reply-to, keep content) | Project › Dev → Email sending | `GET /v1/admin/email-settings` · `PATCH …/projects/:id` |
| Error tracking: issues, status, connect GlitchTip/Bugsink | Project › Errors, Dev → Error tracking | `GET /v1/admin/errors` · `PUT /v1/admin/errors/:id` · `GET /v1/admin/errors/providers` · `POST /v1/admin/errors/connect` |
| A customer's recent errors | Conversation details | `GET /v1/admin/errors?project&user&limit=5` |
| Email log and suppressions | Templates / project Email → Log, Suppressed | `/v1/admin/email-logs[/:id\|/stats]` · `/v1/admin/email-suppressions` |
| Knowledge across projects | ⌘K → Knowledge | `GET /v1/admin/knowledge/models` |
| Project board: items on a kanban (drag to move or reorder), the item editor, board settings, the public roadmap link | Project › Board | `GET`/`POST /v1/admin/board-items?project` · `PATCH`/`DELETE /v1/admin/board-items/:id` · `PATCH /v1/admin/projects/:id {board}` |
| Link conversations and feedback posts to board items (new item, add to existing, unlink) | Conversation details › Board · feedback post editor › Board | `GET /v1/admin/board-items?project&conversation\|feedbackPost` · `POST /v1/admin/board-items/:id/links` |

Reply attachments are **images only** (server whitelists image MIME types) and a
message caps at a small number of them — mirror that in the composer.

---

## 2. Architecture

- **One multiplatform SwiftUI app target.** iOS/iPadOS/macOS share ~all code.
  Split only at the edges that genuinely differ: navigation (three-column
  `NavigationSplitView` on iPad/Mac, stack on iPhone), image picking
  (`PhotosPicker` vs `.fileImporter`), and push registration entry points.
  `#if os(macOS)` at those seams, nothing more.
- **State:** `@Observable` view models (Observation framework), plain
  `async/await`. No Redux/TCA — the app is a thin client over a REST API.
- **Networking:** one `APIClient` actor. Base URL from an `.xcconfig`; injects
  the bearer header; decodes `Codable` DTOs; maps non-2xx → typed errors; a
  central **401 → drop session → route to Login** rule.
- **Models:** `Codable` structs mirroring the server serializers exactly
  (`serializeConversation`, `serializeMessage`, `serializeEndUser`,
  `serializeAdminProject`, `serializeAgent`). All ids are strings; dates are ISO
  8601 strings — decode with a shared `ISO8601`/fractional formatter.
- **No third-party dependencies** for v1. URLSession covers REST, uploads, and
  SSE (byte stream). Add SPM packages only if a real need appears.

Suggested layout inside this folder:

```
HelpBitesNative.xcodeproj
Config/            Debug.xcconfig, Release.xcconfig, Secrets.xcconfig (gitignored)
App/               entry point, root routing, session store
Networking/        APIClient, Endpoints, SSEClient, errors
Models/            Conversation, Message, EndUser, Project, Agent DTOs
Auth/              Login, Setup, KeychainStore
Features/
  Inbox/           list, filters, search, view models
  Conversation/    transcript, composer, attachments, status/read
  Projects/        list, detail (settings, secret)
  Team/            agents
  Settings/        account, developer info, sign out
Push/              registration, APNs token upload, notification handling
Shared/            date decoding, design tokens, small views
```

---

## 3. Auth & session

- Login/setup returns `{ sessionToken, agent }`. The token is `r:…`.
- **Store the token in Keychain** (`kSecClassGenericPassword`), never
  `UserDefaults`. Cache `agent` for display.
- Send `Authorization: Bearer <token>` on every admin call.
- Parse sessions carry an `expiresAt` the server checks; there is **no refresh
  token**. On any `401`, clear Keychain + in-memory session and present Login.
- On cold start: if Keychain has a token, call `GET /me`; success → Inbox,
  failure → Login. If no agents exist yet the server's `setup` route is how the
  very first operator is created — surface onboarding only when
  `GET /v1/admin/setup` says setup is needed.

---

## 4. Real-time (foreground) — SSE

- Reuse `GET /v1/admin/events` via a `URLSession.bytes(for:)` line reader that
  parses `event:`/`data:` frames. Handle the server's `ready` and `ping`
  (8s heartbeat) frames; treat a silent gap > ~20s as dead and reconnect with
  backoff.
- Apply events to local state without refetch (payloads are already the
  serialized objects): `message.created` appends + bumps the conversation to
  top and its unread count; `conversation.updated` replaces summary;
  `message.deleted` removes.
- SSE only runs while the app is foregrounded (especially on iOS). Backgrounded
  / terminated delivery is **push's job** — see §5. On `scenePhase` → active,
  reconnect SSE and refetch the inbox head to close any gap.

---

## 5. Push notifications (the one backend addition)

SSE needs a live connection; iOS suspends it in the background. So an operator
only finds out about a new customer message via **APNs**. Today the server fans a
new user message out to SSE + Mailgun email only — we add APNs alongside them.

### App side
1. Add the **Push Notifications** capability + `aps-environment` entitlement;
   `UIApplication.registerForRemoteNotifications()` (macOS:
   `NSApplication`). Request alert/sound/badge authorization.
2. On receiving the APNs device token, `POST /v1/admin/devices`
   `{ token, platform: "ios|ipados|macos", env: "sandbox|production" }` with the
   agent bearer. Re-register on every launch (tokens rotate) and after login.
3. Tapping a notification deep-links to the conversation
   (`conversationId` in the payload) → push that conversation view.
4. Maintain the app icon badge from `totalUnread`.
5. On sign-out, `DELETE /v1/admin/devices/:token` before dropping the session.

### Server side (new, small, isolated)
- **New Parse class `Device`**: `agent` (Pointer `_User`), `token` (String,
  unique), `platform` (String), `env` (String), `updatedAt`. Add to
  `scripts/ensure-schema.mjs` (master-only CLP + a `token` index) — it applies on
  every boot, so this is the only migration step.
- **New routes:** `POST /v1/admin/devices` (upsert by token, stamp the agent
  from `requireAgent`) and `DELETE /v1/admin/devices/:token`.
- **APNs sender util** (`server/utils/apns.ts`): token-based auth (`.p8` key).
  Sign an ES256 JWT (`kid`, `iss=teamId`, `iat`), cache it ~50 min, POST to
  `https://api.push.apple.com/3/device/<token>` with `apns-topic: <bundleId>`.
  Env: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY` (p8 body),
  `APNS_ENV`. Payload: `{aps:{alert:{title,body}, sound, badge}, conversationId}`.
- **Fan-out hook — reuse the existing event bus, don't touch the write path.**
  A nitro plugin subscribes once via `subscribeEvents` (the same Redis channel
  the SSE layer uses) and, on `message.created` where `message.sender === 'user'`,
  loads all `Device` rows and sends APNs. This is the lazy root-cause spot: the
  fan-out already happens there for SSE, so push rides the same signal with zero
  changes to `appendMessage`. Dedupe across processes with the same
  `redis SET NX` pattern `mailer.ts` already uses (one send per message id), and
  prune tokens APNs reports as `410 Unregistered`.

> **One real spike:** APNs requires **HTTP/2**. Confirm outbound h2 works under
> the Bun runtime (`nitro preset: 'bun'`). If Bun's client h2 is not reliable,
> fall back to the maintained `apn` npm package or a tiny Node sidecar for the
> sender only. Time-box this before committing to the in-process sender.

Prerequisite: an **Apple Developer account** to create the APNs Auth Key (`.p8`),
the App ID with Push enabled, and provisioning. Without it, push cannot be built
or tested — everything else in the app can.

---

## 6. Platform-native niceties (cheap, high value)
- iPad/Mac: three-column layout (projects/filters · conversation list · thread).
- Keyboard shortcuts on Mac (⌘F search, ⌘↩ send, ⌘] next conversation).
- Pull-to-refresh, swipe-to-close (done) / swipe-to-mark-read on rows.
- Menu bar extra on macOS showing unread count (optional, later).
- Dark mode + Dynamic Type for free with system styling (matches the web UI's
  "follow the platform's own type" stance).

---

## 7. Milestones

1. **Scaffold + auth** — Xcode project, `.xcconfig` base URL, `APIClient`,
   Keychain, Login/Setup, `GET /me` boot routing. *Exit:* sign in, land on an
   empty Inbox.
2. **Inbox + conversation (read)** — list with filters/search/pagination,
   transcript, end-user/project header, unread + status display. *Exit:* browse
   everything read-only.
3. **Replies + actions** — composer, image upload/attach, mark read, open/close,
   delete message, new conversation. *Exit:* full feature parity minus live/push.
4. **SSE live updates** — stream client, event reducers, reconnect on foreground.
   *Exit:* second window/web reply appears instantly.
5. **Push (backend + app)** — `Device` class + routes + APNs sender + fan-out
   plugin; app registration, deep-link tap, badge. *Exit:* backgrounded device
   gets a tap-through notification on a new user message.
6. **Platform polish + ship** — split-view/shortcuts, error/empty/offline states,
   projects & team screens finalized, TestFlight / notarized macOS build.

Projects and Team screens are low-traffic CRUD; fold them into milestone 3 or 6
as time allows — the inbox is the product.

---

## 8. Tooling & accounts needed
- Xcode 16+ (Swift 6, Observation, latest SwiftUI). macOS to build.
- Apple Developer Program membership — **required for push** and for
  TestFlight/notarization; a simulator + free signing covers everything else.
- A reachable API base URL for the device (LAN IP or a tunnel to `:3100`; the
  dev server binds `nuxt dev --port 3100`). ATS: use HTTPS, or an ATS exception
  only for local dev.
- Server env for push: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`,
  `APNS_KEY`, `APNS_ENV` (add to `.env.example`).

---

## 9. Open decisions
- **Bundle id** (e.g. `com.helpbites.operator`) — also the APNs topic.
- **Min OS targets** (proposed: iOS/iPadOS 17, macOS 14 — needed for
  `@Observable`).
- **App name** in stores (HelpBites? HelpBites Operator?).
- **HTTP/2 under Bun** for APNs — resolve the §5 spike first.
- Whether Projects/Team editing ships in v1 or read-only first.
```
