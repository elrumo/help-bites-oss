# Changelog

All notable changes to the community edition. HelpBites is in public beta. Versions are Docker image tags
(`elrumo/helpbites:<version>`).

## Unreleased

- **AI merge suggestions for the changelog** (web, native, API, MCP): with 2 or more entries selected, *Suggest merges* asks the AI which of them say the same thing and previews the merged text; it may suggest nothing, and nothing is saved until you merge. New route `POST /v1/admin/changelog/entries/suggest-merges` and MCP tool `suggest_changelog_merges`. No schema change.

- **Videos on planning cards, and a viewer for images and videos** (web, native, share sheet, API, MCP): MP4 and MOV videos attach to board items, posts and planning comments up to 100 MB (other files stay at 25 MB; the upload route is unchanged). Images and videos open in a viewer instead of a new tab or browser, and the iOS share sheet accepts videos and opens attachments on tap. No schema change.

- **Native app defaults to helpbites.app and can sign up there** (native): Release builds point at `https://helpbites.app` instead of a placeholder, and when the server's `/v1/admin/setup` answers `signup: "open"` (HelpBites Cloud) the sign-in screen offers *Create account* (`POST /v1/cloud/signup`). A self-hosted server is still one tap away under the server line, and keeps its first-run setup. `bun run testflight` archives and uploads the iOS and Mac builds (see the header of `scripts/testflight.mjs`).

- **Releases on the planning board are changelog releases** (web, native, API, MCP): a card's Release picker lists the project's changelog releases, and typing a name there creates a draft release that the changelog shows too. A board *release* card is gone: `kind` is `task` or `epic`, and `releaseId` is a changelog release's id (a `kind: release` is refused). Boards that planned releases as cards run `bun scripts/backfill-board-releases.mjs` once (a dry run first, then `--apply`): it creates the changelog releases and moves their cards; the old release cards stay as plain cards to delete.

## 0.2.1 — 2026-10-29

- **`schema:apply` checks and hardens security** (self-hosters): on every run it makes every class Parse holds master-only, including Parse's own (`_Role`, `_Session`, `_Installation`, …) and strays that `ensure-schema.mjs` does not declare, prints what was open, then asks each class for a row without any key and fails the run (exit `1`) if one answers. `bun run schema:acls` counts rows whose ACL is open to everyone, and `bun run schema:acls:apply` closes them (each closed row's `updatedAt` moves to now). Set `PARSE_CLIENT_KEY` for the script if your Parse requires a client key. No schema change.
- **One Export card** (web, native, API): the old **Export data** card and **Move to another HelpBites → Download** are one **Export and import** card, with **Download** and **Email me a link** (the background export for a big workspace), both taking the files and credentials choices. The file is the whole archive, as the emailed export always was (team list, usage and domains included); `GET /v1/admin/transfers/export` gains `include=importable` for a pull, and `POST /v1/admin/workspace/export` takes `files` and `secrets`. An import leaves out a connection that was exported without credentials. No schema or env change.
- **Export and import carry uploaded files, credentials and connections** (web, native, API): `GET /v1/admin/transfers/export` takes `files=urls|binary` (links to the bucket as they are, or the files themselves, which needs `S3_*` and `S3_PUBLIC_URL`) and `secrets=1` (Stripe, contact databases, revenue sources, webhook endpoints, AI provider keys and each project's secret, opened in the file and sealed again with the importing instance's `HELPBITES_SECRET`). `POST /v1/admin/transfers` takes the same `files` and `secrets` for a pull; an uploaded file is read as it was written. Brand, page and lead form file rows, Stripe payments and subscriptions now travel too. Imported files are stored under `imports/<workspaceId>/`, counted against storage, and removed with the workspace. Run `bun run schema:apply`: it adds `files` and `secrets` to `DataTransfer`. No env change.
- **Edition seam `checkOutgoing`**: the edition can inspect counted outgoing mail before it is sent. Community does nothing. No schema or env change.
- **Planning: estimates, saved views, filters and richer events** (web, native, API, MCP): items take an `estimate` in points that epics and releases add up, the board sorts by most votes, and a named view (layout, grouping, order, filters) can be saved for the project in `board.views`. `GET /v1/admin/board-items` filters by `assignee`, `priority`, `label` and `q`. Webhook endpoints can subscribe to the new `board.item.assigned`, `board.item.updated` and `board.item.commented` events, and every board event now carries `source` and `by`. Run `bun run schema:apply`: it adds `estimate` to `BoardItem`. No env change.

## 0.2.0 — 2026-10-28

HelpBites is in public beta from this release: every feature below is on `main` and in production for its author, but expect rough edges, back up before you upgrade and read these notes first.

- **Public beta, with a version number everywhere** (web, native, API): the release shows at the top of the landing page and the docs, in the panel's sidebar and **Settings → Account**, in the native app's Settings and in `GET /v1/meta` (`version`, `stage`), always with a Beta tag, linking to these notes. `package.json` is the one place the number lives (the native app's `MARKETING_VERSION` follows it; `tests/versionParity.test.ts` checks). No schema or env change.
- **Guides for getting started, setting things up and developing** (docs): *Getting started* (the ten-minute path), *Setting things up* (AI, email, inbound email, GitHub, storage, search, error tracking, revenue, domains, push and MCP, each with what to click and how to tell it worked) and *Development*, all published at `/docs`; `docs/RELEASING.md` covers cutting a release. No schema or env change.
- **Releases publish themselves** (maintainers): pushing a tag `vX.Y.Z` now checks it against `package.json` and this file, publishes the community image to Docker Hub (`elrumo/helpbites`, `:X.Y.Z`, `:X.Y`, `:latest`) and GHCR for amd64 and arm64, creates the GitHub release from this file's section and, where the repository's secrets are set, publishes the same section to a HelpBites project's public changelog with `scripts/publish-changelog.mjs`. HelpBites keeps its public changelog on its own HelpBites. No schema or env change for self-hosters.
- **Epics, releases and a list view on Planning** (web, native, API and MCP): an item can be a card, an epic that groups cards or a release that ships cards and epics; cards point at their epic and release and each of those lists its cards with progress. The board has a Board / List switch: the list is grouped by status, epic or release with every cell editable in place. API: `kind`, `epicId`, `releaseId` on `POST`/`PATCH /v1/admin/board-items` and the list's `kind`, `epic` and `release` filters. Run `bun scripts/ensure-schema.mjs --apply` on upgrade (new `kind`, `epicId`, `releaseId` fields and two indexes on `BoardItem`); existing items are cards. No env change.
- **The MCP server does what the panel does** (MCP): more than 300 tools now cover every panel section through a JSON route, where 83 covered a third of it. New: Pages, the blog, the brand kit, onboarding, lead forms, email templates, folders and components, transactional email and logs, sequences, segments, contacts, the AI assistants and their knowledge, conversation types, releases and reader comments on the changelog, legal wizard, versions and checks, error triage, alerts and reports, revenue, domains, webhook changes, project and Planning settings. Planning items now carry assignee, labels, target date, attachments and rank, and have delete, link, history and AI-title tools. Keys, teammates, project secrets, connecting services, file uploads, streams and the customer-facing surface stay out on purpose (`docs/MCP.md`, *Left out on purpose*); `tests/mcpCoverage.test.ts` fails when a `/v1` route has neither a tool nor a reason. The tool schema gained `PUT`, numbers and `as`. No schema or env change.
- **Planning polish** (web and native): drag a status, label or post type by its grip to reorder it in settings (the web settings panel is also laid out in grouped rows with a sticky save bar); a new item you did not create is kept and restored when the panel opens again (web: also new changelog entries), Cmd/Ctrl+Enter creates it, and an open item shows when it is saving and saved; the board order is remembered per project; cards show pills for images, files, a description, related items and an item filed from an error; fields in the item and changelog panels get a white fill. Browser and device storage only; no schema, API or env change.
- **Comments and threads on Planning items** (web, native, API and MCP): add internal comments and replies with up to 10 images or files. MCP comments display the connected assistant name while retaining the authorizing operator. New `BoardItemComment` schema and `GET|POST /v1/admin/board-items/:id/comments`, plus MCP upload, list and comment tools. File uploads accept base64 through MCP and return download URLs. The app entrypoint applies the schema on boot, or run `bun scripts/ensure-schema.mjs --apply` manually.
- **Edit history for Planning items** (web and native): each create or change records the changed fields, their before and after values, the time and the operator, tagged as web, app, API or MCP. Item changes, links and related-item changes are included. The collapsed **Edit history** section pages through the audit trail; `GET /v1/admin/board-items/:id/history` does the same for API clients. New `BoardItem.lastModifiedBy`, `BoardItem.lastModifiedSource` and `BoardItemHistory` schema; the app entrypoint applies it on boot, or run `bun scripts/ensure-schema.mjs --apply` manually. Edits made before this update cannot be reconstructed.
- **AI titles for planning items** (web, native and the iOS share sheet): an item created with no title gets one written by the AI from its description, a second after you stop typing or when you press Create (the description's first line stands in when no AI is configured); a sparkles button in the title field writes it on demand. New `POST /v1/admin/board-items/suggest-title` (`docs/FEEDBACK.md`). Needs an AI provider; no schema or env change.
- **Add to Planning from the iOS share sheet** (native): share a screenshot, photo, link or text from any app and file it as a planning item with all of *New item*'s fields; the shared image is uploaded and attached. A new app extension target (`HelpBitesShare`, run `xcodegen generate`), so set your team on it too and enable the **App Groups** capability (`group.com.helpbites.operator`) on both targets: the app shares its session, server and workspace with the extension through it. The session token moves into that keychain group the next time the app opens. Uses existing endpoints; no server, schema or env change.
- **Paste images into the blog editor** (web and native): an image on the clipboard is uploaded to the project's storage and put in the body, at the cursor on the web and at the end of the text in the native app. Uses the existing `POST /v1/admin/blog/images`; no schema or env change.
- **AI title and summary for a release** (web and native): the release editor has a *Write title and summary with AI* button that reads the release's entries and fills the form; nothing is saved until you press Save. New `POST /v1/admin/changelog/releases/:id/suggest` returns `{ title, summary }` (`docs/FEEDBACK.md`). Needs an AI provider; no schema or env change.
- **Reorder columns on Planning** (web and native, admins): drag a column's header onto another to move it. The new order is saved with the board's statuses through the same `PATCH /v1/admin/projects/:id`; no schema or env change.
- **Attachments in the AI chat** (web and native): paste, drop or pick images and files in the chat; every card the message creates gets them. `POST /v1/admin/projects/:id/ai-cards` takes `attachments` (from `POST /v1/feedback/attachments`). No schema or env change.
- **The AI chat on Planning changes items too** (web and native): it can change existing items (status, priority, labels, title, description, target date, public flag), and relate items to each other, in the same message that files new ones. Related items are a new two-way link between board items: *Related items* in the item editor (web and native), `kind: "item"` on `POST /v1/admin/board-items/:id/links`, and `relatedItemIds` on `BoardItem`. `POST /v1/admin/projects/:id/ai-cards` returns `updated`. Run `bun scripts/ensure-schema.mjs` on upgrade (new `relatedItemIds` field). No env change.
- **New columns on Planning** (web and native): add a status from the tile after the last column, with a name and a category (what the category means for the roadmap). It is saved with the board's statuses through `PATCH /v1/admin/projects/:id`, the call Settings → Statuses already uses; no schema or env change.
- **Order the planning board** (web and native): *Manual* (drag to reorder, as before), *Newest first* or *Oldest first* by when each item was made. Display only; no schema or API change.
- **Paste and drop images into feedback and planning items** (web): paste an image while the item editor is open, or drop files on its *Images and files* box, to attach them. Native: a *Paste* button.
- **Image width on the changelog** (web and native settings): `full`, `medium` or `small` for the images under entries, on the public changelog and the plug-and-play embed. Project setting `changelog.imageWidth` (default `full`); no schema change.
- **Drag entries between releases** (web): in the changelog panel, drop an entry on a release (or on *No release*) to move it. The native app moves it with the entry's Release field.
- **Images on changelog entries** (web, native, the public API and the plug-and-play embed): up to 10 per entry, uploaded with `POST /v1/feedback/attachments` and sent as `images` on `POST`/`PATCH /v1/admin/changelog/entries` (`docs/FEEDBACK.md`, Changelog → Images). Shown under the text in `changelog.js`, the board embed and the server-rendered snapshot. New `images` field on `ChangelogEntry` (`scripts/ensure-schema.mjs`; no migration: entries that kept an external `imageUrl` still show it). **Breaking for `imageUrl`**: it is still returned (the first image's url) but sending it is now `400`; send `images` instead.
- **Plan a feedback post** (web and native): right-click a post (or use its **Planning** button) to create planning items from it, written by the AI, which decides whether the post is one piece of work or several and sets the urgency, or to add it to an existing item; items attach feedback by search. New route `POST /v1/admin/board-items/from-feedback` (`docs/FEEDBACK.md`), MCP tool `create_board_item_from_feedback`. Uses the workspace AI provider or `LITELLM_API_BASE_URL`, and copies the post when there is none; no schema or env change.
- **Images and files on feedback posts and board items** (web, native and the public API): up to 10 per post or item, uploaded with new `POST /v1/feedback/attachments` and sent as `attachments` (`docs/FEEDBACK.md`). New `attachments` field on `FeedbackPost` and `BoardItem` (`ensure-schema` adds it); images need no change, files need your S3 bucket as before (`S3_*`). Run `bun scripts/ensure-schema.mjs` on upgrade.
- **AI cards on Feedback and Planning** (web and native): an AI chat that turns pasted text into separate feedback posts or board items. New route `POST /v1/admin/projects/:id/ai-cards` (`docs/FEEDBACK.md`). Uses the workspace AI provider or `LITELLM_API_BASE_URL`; no schema or env change.
- **Email-only users get your replies by email.** The address they typed shows on their contact (marked unverified until they enter the code,
  `pendingEmail` on `GET /v1/contacts`) and in the inbox, and replies from the team are mailed to it. Before, the reply failed with "User has
  no email" until they verified. In the inbox, **Open contact** now opens the contact over the conversation instead of leaving it. No schema
  or env change.
- **TestFlight usage on the Revenue tab** (web and native) when the App Store source is connected: installs, sessions, crashes, invites and
  feedback for each app's newest builds. New route `GET /v1/admin/revenue/testflight?project=` (`docs/REVENUE.md`). No schema or env change; the
  App Store API key needs a role that can see apps (Developer, App Manager or Admin), not only Sales and Reports.
- **Push live now** on a pricing table (⋯ menu, web and native): publishes again and re-reads Stripe at once; `POST /v1/admin/pricing-tables/:id/publish`
  takes `{ "force": true }`. New optional env `BUNNY_NET_API_KEY` (Bunny.net account API key) makes it purge the CDN's cached copies too.
- **Support email addresses** (`docs/INBOUND-EMAIL.md`). A project can have addresses such as `support@yourdomain.com`: mail sent to them becomes
  conversations in the inbox, and replies (yours, the assistant's, the API's) go back by email, threaded. Two kinds: an address on a domain whose
  MX points at Mailgun, or a HelpBites alias your own mailbox forwards to. New routes `GET`/`POST /v1/admin/projects/:id/inbound-addresses`,
  `DELETE …/inbound-addresses/:addressId`, `POST …/inbound-addresses/:addressId/verify` and `POST /v1/webhooks/mailgun-inbound`; conversations
  gain `channel` and `GET /v1/admin/conversations?channel=email`. The inbox shows an envelope and filters by channel (web and native). **To
  use it, add one Mailgun Route** (`match_recipient(".*")` → `forward("<APP_URL>/v1/webhooks/mailgun-inbound")`); optional env `INBOUND_DOMAIN`
  for forwarding aliases. Schema (needs `schema:apply`; the container does it on boot): new class `InboundAddress`, new fields
  `Conversation.channel` and `Message.emailMessageId` (indexed). New plan feature `inboundEmail` (on in community).
- **Custom domains for public pages** (`docs/CUSTOM-DOMAINS.md`). A project's hub, feedback board, roadmap, changelog and blog can be
  served on its own host (`feedback.example.com`): add it under Project → Settings → Custom domains (web and native), put a TXT and a
  CNAME in DNS, verify. New routes `GET`/`POST /v1/admin/projects/:id/domains`, `PATCH`/`DELETE …/domains/:domainId`,
  `POST …/domains/:domainId/verify` and `GET /v1/internal/domain-check` (the proxy's certificate check). Schema (needs `schema:apply`;
  the container does it on boot): new class `ProjectDomain`. Optional env: `CUSTOM_DOMAIN_TARGET`, `CUSTOM_DOMAIN_IP`,
  `CUSTOM_DOMAIN_RESERVED`. The bundled `Caddyfile` gains an on-demand TLS block (re-pull it if you copied it); any other proxy must
  send `/` of custom hosts to `/_domain`. New plan feature `customPublicDomain` (on in community).
- **Run maintenance scripts from your own machine.** Optional `PARSE_MASTER_KEY_EXTRA_IPS` (an extra IP allowed to use the master key)
  and `PARSE_TRUST_PROXY` (proxies in front of Parse, `1` for Traefik) on `sb-parse`, both off by default. Needed together when a script
  such as `backfill-contacts.mjs` runs outside the stack against a public Parse domain; unset them afterwards. No schema changes.
- **Saved, scheduled AI reports on errors.** "Analyze with AI" on the Errors page now saves every run as a report (view, copy and delete
  them; the latest 100 are kept), can run daily, weekly or monthly on workers, and reads the source of the most frequent errors from the
  project's GitHub repos (web and native). New routes `GET /v1/admin/errors/reports`, `DELETE /v1/admin/errors/reports/:id`,
  `GET`/`PUT /v1/admin/errors/schedule`. Schema (needs `schema:apply`; the container does it on boot): new class `ErrorReport`, new fields
  `Project.errorReportFrequency` and `Project.errorReportNextAt`. No env changes.
- **A welcome tour for new accounts.** Five skippable cards after sign-up or accepting an invitation, replayable from Settings (web and
  native). `PATCH /v1/admin/me` takes `tourPending: false`; `/me` returns it on `agent`. Schema (needs `schema:apply`; the container does it
  on boot): new field `_User.tourPending`. Existing accounts are not shown the tour. No env changes.
- **A step-by-step GitHub App guide, with screenshots** (`docs/GITHUB.md`, published at `/docs/github`). Settings → GitHub links to it
  (web and native) while the server has no `GITHUB_APP_*` set. No schema or env changes.
- **Leave out the changelog's and the feedback board's header.** `data-header="false"` on `changelog.js` and `feedback.js` (`?header=0` on the hosted
  pages) hides the logo, title and description for a page that already shows them; the feedback board keeps its view tabs and *New post*.
  No schema or env changes.
- **A domain on `sb-parse` no longer breaks the app on Dokploy.** The app and Parse now talk over `sb-parse-internal`, a name that exists
  only on the stack's own network. A Dokploy domain also joins a service to `dokploy-network`, and Docker could answer `sb-parse` with
  that address; the app then reached Parse from outside `SB_INTERNAL_SUBNET` and Parse refused the master key. Redeploy to pick it up
  (`PARSE_URL` and `PARSE_SERVER_URL` are set by the compose, so there is nothing to change in `.env`).
- **Revenue from more than Stripe** (`docs/REVENUE.md`). The Revenue tab now also reads RevenueCat (its webhook,
  `POST /v1/webhooks/revenuecat/{project}`, with a secret HelpBites makes), the App Store (Sales and Trends reports), Paddle and
  Lemon Squeezy (an API key), and a custom API (`POST /v1/admin/revenue/payments`) for anything else. The sources add up, each
  connects and disconnects on its own, and the tab shows what each brought in. New routes `GET /v1/admin/revenue/sources`,
  `POST /v1/admin/revenue/connect`, `POST /v1/admin/revenue/sync`, `DELETE /v1/admin/revenue` and `GET /v1/admin/revenue/report`
  (the report gains `sources`); the `/v1/admin/stripe` routes are unchanged. A person's billing lists payments and subscriptions
  from every source, the workspace overview and the setup checklist's row (now **Revenue**) read every source. Web and native.
  Schema (needs `schema:apply`; the container does it on boot): new class `RevenueSource`, new fields `StripePayment.source`,
  `StripeSubscription.source` and `StripeSubscription.eventAtSec`. No env changes. RevenueCat's history starts when the webhook
  does; Paddle, Lemon Squeezy and the App Store were written from the services' documentation and unit tests and have not been run
  against live accounts.
- **Every docs page as Markdown.** `/docs/<slug>.md` (for example `/docs/connect.md`) serves the guide as plain Markdown, `/docs.md` lists
  them, and each page has **Copy MD** and **Copy MD link** buttons at the top. `/llms.txt` is the same list with absolute links (it uses
  `APP_URL` when set). No schema changes.
- **Project style, and a style for the public changelog** (`docs/STYLE.md`). One style per project (logo and app icon, light and dark
  colours, corner radius, shadow, font) is edited from any style panel (changelog, Brand page, forms, onboarding, pricing, blog design,
  legal look: **Edit project style**, or **Save as project style** from what that panel has chosen). The public changelog page and embed
  wear it in light and dark, or the project's with `changelog.style` over it; `changelog.js` takes `data-accent`, `data-radius` and
  `data-shadow`; the public feedback board (list, roadmap and changelog views, `feedback.js`) takes the same (`feedback.style`,
  `feedbackStyle` on the public project and `GET /v1/feedback/config`). `style` on `PATCH /v1/admin/projects/{id}`, `look.style` on the public project and `style` on `GET /v1/changelog`. The
  project style's accent outranks the Brand kit's, and saving the accent in Settings keeps it in step. Schema (needs `schema:apply`;
  the container does it on boot): new field `Project.style`. The chat widget, hub, blog, brand page, legal pages, forms, onboarding and
  pricing tables wear it too, in light and dark (`widget.style`, `hub.style`, `blog.style`, `legal.style`, `brand.page.style` choose
  the project's or their own over it; a form, flow or table keeps its own fields on top; `widgetStyle`, `style` and `look` carry the
  finished style in the public payloads); `widget.js`, `helpbites.js`, `forms.js`, `onboarding.js`, `pricing.js`, `blog.js` and
  `brand.js` take `data-accent`, `data-radius`, `data-shadow` and `data-theme`. Schema (needs `schema:apply`): new field `Project.widget`.
  Blog and legal pages with no project style now render the default stone palette; pricing tables with no accent anywhere get the
  Brand kit's default accent. The native app edits the project style and the changelog's style, not the other features' yet.
  app edits the project style and the changelog's style, not the feedback board's yet.
- **Server rendering and caching for the embeds and the API** (`docs/SSR.md`, `public/ssr.mjs`). A helper for your server reads the public
  API within a time budget, keeps answers (stale-while-revalidate) and server-renders the changelog, roadmap, board and chat embeds as
  a snapshot or skeleton; `widget.js`, `feedback.js` and `changelog.js` show a skeleton while they load and accept `data-host` (a copy
  you serve yourself), `helpbites.js` accepts `data-scripts` and remembers the loader answer in the browser. The changelog frame now
  sends a `ready` message. No schema or env changes.
- **Optional Plausible stats** for HelpBites' own site and panel: set `NUXT_PUBLIC_PLAUSIBLE_SRC` to the script's address (off by default; the panel reads it at run
  time, the prerendered landing page and docs need it as a Docker build arg too). It is not loaded in the embeds or on the invite and OAuth pages, and its origin joins the panel's script policy. No schema changes.
- **Developer & MCP**: the workspace Developer page is now **Developer & MCP** and gains an AI assistants section with the
  `/mcp` address and a `claude mcp add` command (web and native); each project's Install & API page points to it. The MCP server gains 22 tools (feature flags, knowledge base answers,
  email templates, test sends and logs, campaigns, legal documents). No schema or env change.
- **Guest access (no account, no email)**: an admin can open chat, feedback and blog or changelog comments to visitors who sign in with
  nothing (Project → Settings → Chat widget → Guest access, web and native; `guestSurfaces` on `PATCH /v1/admin/projects/{id}`; off by
  default). `POST /v1/anonymous/guest` makes a session; guests are rate limited per IP, per project and per guest, cannot upload, carry no
  email, and expire after 30 days unused (`docs/CONNECTING.md`). The chat, board and blog embeds use it when the page has no sign-in of
  its own. Schema (needs `schema:apply`; the container does it on boot): new fields `Project.guestSurfaces`, `EndUser.guest`,
  `EndUserSession.expiresAt`.
- **Native app catches up with the panel**: Pages gets the component library and editor, the AI assistant (pages and components), the
  page wizard, undo and redo, and moving blocks between lists; links from the setup list open Email on the tab they name; the hosted
  edition's plan screen opens Stripe Checkout and the customer portal and manages sending domains. The app is translated into
  Catalan, Spanish, Japanese, Korean and Simplified Chinese (`App/Localizable.xcstrings`; it follows the device language).
  No schema, API or env changes.
- **Write with AI in the blog editor** (`POST /v1/admin/blog/ai`, `docs/BLOG.md`). Drafts, continues or improves a post, or suggests
  its title, excerpt, search description and tags, from the project's linked GitHub repos (read-only). It uses the workspace's AI
  provider or the server's gateway, so a self-hoster needs one configured (as for the other AI features); no schema or env changes.
- Events and webhook endpoints (`docs/EVENTS.md`). Everything that happens in a project is published as a domain event; the
  project's original single event webhook keeps the events it always had, and `WebhookEndpoint` rows (up to 10 a project, each with its
  own secret and an event filter) receive any of them: `/v1/admin/projects/{id}/webhooks`. A sequence can now start from any
  event (`{ "type": "event", "event": "onboarding.completed" }`), and four ready-made recipes install as draft sequences
  (`/v1/automations/recipes`). `contact.created` is not published per row for imports, database syncs and Stripe. Schema
  (needs `schema:apply`; the container does it on boot): new class `WebhookEndpoint`, new field `WebhookDelivery.endpoint`.
- `GET /v1/contacts/{id}/activity`: one person's conversations, posts, votes, emails, sequences, payments and onboarding in one
  list. Contacts get a `language` (also set by the identity token's new `locale` claim); segments get the fields Stripe plan,
  Language, Has an open conversation, Voted on a post, Has errors and Finished onboarding. New: `EndUser.language`, class
  `OnboardingCompletion` (`POST /v1/onboarding/{pk}/{key}/complete`). The MCP server gains 22 tools.
- The project's look is read one way everywhere (the Brand kit first, then the older Settings accent and logos): the
  widget, boards, forms, onboarding, legal and blog pages, campaign mail and brand page all agree. **The default accent is
  now `#4f46e5` everywhere** (forms and onboarding used `#5e6ad2` when a project had no colour); a project that never set a
  colour sees that change on its forms and flows. Saving the accent in project Settings writes the kit's page accent, and the
  panel and native app send it only when it changed. `legal.accent`, `legal.logoUrl` and `legal.font` stay as optional overrides
  for the legal pages. New field `Project.brandLook` (kept by the kit's files).
- One company profile. New field `Project.company` `{ name, legalName, address, email, phone, website, dpo }`, set with
  `PATCH /v1/admin/projects/{id}` `{ company }` and shown in project Settings. Legal documents and campaigns read it;
  `legal.entity` and `marketing.postalAddress` still work (they write to it, and mirror it). Nothing to run: a project that
  predates it is read from those two fields and the first read of the project list copies them into the profile.
- Email templates get `{{project.company}}`, `{{project.email}}`, `{{project.privacyUrl}}`, `{{project.termsUrl}}`,
  `{{project.cookiesUrl}}` and `{{project.refundUrl}}`. The links come from the new field `Project.legalLinks`, rebuilt when
  a legal document is published, unpublished, renamed or deleted (it needs `APP_URL`; a project whose documents were already
  published gets its links the next time one is touched). Not carried by exports.
- Public hub. New field `Project.hub` `{ enabled, title, tagline, sections, links, widgetHome }` (off by default); the page
  `/hub/{pk}`, `GET /v1/hub/{pk}` and `GET /v1/hub/{pk}/loader`; a Home tab in the chat widget (`hub.widgetHome`); and
  `public/helpbites.js`, one script tag that adds the chat, feedback, changelog and onboarding scripts (`docs/HUB.md`).
  Schema (needs `schema:apply`; the container does it on boot): `Project.company`, `Project.hub`, `Project.legalLinks`.
- The conversation panel is the customer's hub (`docs/SUPPORT.md`). New: `GET /v1/admin/conversations/{id}/context`
  (plan and MRR from the Stripe attributes, past conversations, linked feedback), `POST …/feedback-posts` (link, unlink or
  file a post as the customer, who follows it), `POST …/faq` (save an answer as an FAQ, origin `conversation`),
  `GET …/suggestions` and `POST …/draft` (FAQ and saved-reply picker, AI draft), and `/v1/admin/saved-replies`. Schema
  (needs `schema:apply`; the container does it on boot): new class `SavedReply`, new fields `Conversation.feedbackPostIds` and
  `Faq.conversationId`. `conversation.created`, `conversation.status_changed` and `conversation.feedback_linked` are now
  published. Exports now write feedback posts before conversations, so a link can be carried; older export files have no links and import as before.
- Shipping connects the features. When a changelog entry goes public, the followers of the feedback posts it
  links (and of the posts of the board items it links) get one "Shipped" email, once (new field
  `ChangelogEntry.followersNotifiedAt`; new domain event `changelog.entry.published`; it needs the feedback board's
  email notifications on and a mailer). The entry editor offers **Reply to N linked conversations**
  (`GET …/changelog/entries/:id/linked-conversations`, `POST …/reply-conversations`), never sent on its own.
- **File on board** on an error (`POST /v1/admin/errors/:id/board`): a board item titled from the issue, once per issue
  (new fields `BoardItem.errorRefs` and `BoardItem.errorKeys`, with an index; event `errors.filed_on_board`).
- GitHub: commits pushed to the default branch and pull requests merged into it that mention `#12` link to that board
  item or feedback post, and `fixes #12` moves the board item to the first done status (new class `GithubRef`, listed
  by `GET /v1/admin/github-refs`; events `github.commit.referenced`, `github.pull_request.merged`). All of these need
  `schema:apply`; the container does it on boot. **Self-hosters who registered the GitHub App: add the *Pull requests:
  read-only* permission and subscribe to the *Pull request* event** (GitHub app settings, then each installation
  accepts the new permission). Nothing breaks without it, but merged pull requests are not linked. See `docs/GITHUB.md`.
- Contacts have a language: new field `EndUser.language` (needs `schema:apply`; the container does it on boot), a language
  tag such as `es` or `pt-BR`. It is filled by the new optional `locale` claim of identity tokens (only into a gap),
  `language` on `POST`/`PATCH /v1/contacts`, the contact's page, a CSV or sync column mapped to Language, or a lead
  form's visitor (their browser language). Campaigns, sequence steps and lead-form welcome emails now go out in the
  translation of the template closest to each contact's language (the template's own otherwise); a translation without
  the unsubscribe link or postal address stops the campaign. New placeholder `{{contact.language}}`. A running campaign's
  frozen snapshot now also carries the template's translations; campaigns already sending carry on as designed.
- Onboarding reports who finished it: new class `OnboardingCompletion` (needs `schema:apply`), written by
  `POST /v1/onboarding/{pk}/{key}/complete` with a person's identity token, which `public/onboarding.js` calls itself
  when given `data-token` / `init({ token })`. Segments gain **Finished onboarding**.
- `POST /v1/sequences/{id}/enrollments` also takes `segment` (everyone in a segment, up to 5,000 per call) next to
  `contacts`, and answers `{ enrolled, skipped: { notSubscribed, optedOut, alreadyEnrolled, notFound }, truncated }`
  instead of `{ enrolled }`; `contacts` or `segment` is now required (`400` without).
- `GET /v1/contacts/{id}/activity`: one person's conversations, feedback, emails, sequences, payments and onboarding in a
  single paged list; the contact page (web and native) uses it. The revenue report's top customers and recent payments
  carry `contactId` and open the person.
- Easier to understand, across the panel and the native app:
  - A project's sidebar sections are grouped as Support, Product, Grow, Site and Build, and a project can hide the ones it
    does not use (**Project → Settings → Sidebar**, or `hiddenSections` on `PATCH /v1/admin/projects/:id`). Nothing is
    deleted; pages and API keep working. New fields `Project.hiddenSections` and `Project.identitySeenAt` (need
    `schema:apply`; the container does it on boot). `identitySeenAt` is stamped, at most hourly, when a signed identity
    token is accepted.
  - Renamed: Tickets is **Ticket types**, Dev is **Install & API**, email Masters are **Shared templates** (the API
    still says `master`), and the three things called "board" are **Feedback** (the public page), **Planning** (the
    private kanban, formerly Board) and the **Roadmap**. The feedback page's "Board" layout is **Columns**. API and
    embed names (`board`, `view=board`, `/v1/admin/board-items`) are unchanged.
  - Email is one section per project: **Templates, Campaigns, Sequences, Log, Settings**. Campaigns is no longer in the
    sidebar (`/projects/:id/campaigns` redirects to `/projects/:id/email?view=campaigns`), and the sender is one form under
    Email → Settings: the from name, address, domain, reply-to and "keep a copy" fields moved there from Project →
    Settings, where only "Notify when a user writes" stays. Campaigns and sequences use that sender unless the switch
    for their own address is on. Same `PATCH /v1/admin/projects/:id` fields as before.
  - ⌘K on the web also searches conversations and knowledge through `GET /v1/admin/search` (needs Meilisearch, as the
    native app's did).
  - `GET /v1/admin/projects/:id/setup`: a per-project setup checklist judged from what HelpBites has seen. The project
    overview returns it as `setup` and **no longer returns `health`**; its `attention` rows are now
    `{ key, kind, projectId, count, value, detail, section, at }` instead of `{ key, label, count, section }`.
  - `GET /v1/admin/attention`: one needs-attention list for the workspace (changelog drafts awaiting approval, failed
    contact and Stripe syncs, bounced or failed email, fired error alerts, a paused sender, open error reports, failed
    knowledge documents, feedback to triage), cached 15 seconds. `GET /v1/admin/unread` is the live inbox badge count. The
    panel keeps both live on every page, not only the inbox. See `docs/OVERVIEW.md`.
  - `GET /v1/admin/projects/:id/email-setup` says what a project's email still needs (mailer key, sender, delivery
    webhook, postal address, a paused sender); the Email tabs show it as a strip.
  - `GET /v1/admin/support-agents/:id` returns `readiness`, and `POST /v1/admin/support-agents/:id/test-answer` runs the
    real decision on a message (routing rules, then knowledge and the confidence bar) and says why. The internal note an
    assistant leaves when it hands over because no rule matched and its default is "hand to a human" now says so
    instead of claiming a rule did.
  - The ticket type editor and the inbox warn when a type has actions but the project has no action webhook URL and secret.
- Pricing tables: plan cards, rows, a paywall, a comparison table or a spotlight plan under **Project → Pricing** (web
  and native), embedded with `public/pricing.js`, on a hosted page at `/pricing/<public key>/<key>`, in SwiftUI, in an
  onboarding step, or read from `GET /v1/pricing/{pk}/{key}`; managed at `/v1/admin/pricing-tables`. See
  `docs/PRICING.md`. New classes `PricingTable` and `PricingStat`, and field `pricingTable` on onboarding steps (need
  `schema:apply`; the container does it on boot). Plans linked to Stripe read products, prices and Payment Links
  through the project's Stripe key (new `GET /v1/admin/stripe/catalog`); Stripe Checkout buttons need "Checkout
  Sessions: Write" on that key and purchase counting needs "Checkout Sessions: Read", so the key is no longer
  read-only when you use them. The marketing worker flushes view and click counts from Redis and checks Stripe for
  completed sessions every ten minutes per project with a published table. `/pricing/<pk>/<key>` joins the frameable
  paths. A/B tests, AI suggestions (the workspace's AI or the gateway) and 11 new MCP tools come with it.
- Changelog subscription emails link to hosted confirm and unsubscribe pages on this server
  (`/u/changelog/confirm/<token>`, `/u/changelog/unsubscribe/<token>`; they need `APP_URL`) instead of
  `{siteUrl}/changelog/confirm` and `…/unsubscribe` on the project's own site, which most projects never built.
  Saved configs holding those old defaults now read as hosted; a project with its own pages sets
  `changelog.confirmUrl` / `unsubscribeUrl` as before.
- Erasing a person (`DELETE /v1/end-users/:externalId`, `/v1/contacts/:id`, `/v1/anonymous/me`) now also deletes
  the changelog subscriptions made with just their address. Erasures run before this release may have left some
  behind: erase those people again to remove them.
- A campaign with no mailer configured is refused when scheduled, sent or resumed, and one already sending pauses
  with the reason, instead of retrying every five minutes for ever.
  Sequences too: activating one is refused, and a step that comes due with no mailer waits an hour without sending
  (it used to log a failed email every five minutes).
- AI hand-off: when a routing rule says "human", or no knowledge matches (well enough) and the assistant's fallback
  is "Hand to a human", the assistant no longer answers. The conversation gets the `needs-human` label and an
  internal note, and the assistant stays out of it until the label is removed.
- The public roadmap keeps listing feedback posts until the project board has a public item in a roadmap status;
  switching the board on no longer empties it.
- New field `Project.widgetSeenAt` (needs `schema:apply`; the container does it on boot): the chat widget's setup
  turns green only once the widget has loaded on a site.
- `GET /v1/admin/conversations` takes `view` (`unassigned`, `mine`, `open`, `unread`, `archived`) and returns
  `viewCounts`, each view counted under the list's own filters; the inbox views no longer filter only the loaded page.
- `GET /v1/feedback/config` returns `changelogPublic`.
- Lead forms: waitlist, "notify me" and interest forms under **Project → Forms** (web and native), embedded with
  `public/forms.js`, as a plain HTML form, on a hosted page at `/f/<public key>/<key>`, in SwiftUI, or through
  `GET`/`POST /v1/forms/{pk}/{key}`; managed at `/v1/admin/lead-forms`. Leads become contacts in a segment made for
  each form, with optional double opt-in (confirm links at `/f/confirm/<token>`), a welcome email and a sequence. See
  `docs/FORMS.md`. New class `LeadForm`, new fields `EndUser.origin` and `EndUser.leadForms` (with indexes) and
  `ContactSegment.auto` (need `schema:apply`; the container does it on boot). `/f` joins `/embed`, `/s`, `/brand` and
  `/p` as frameable. Welcome emails show in the email log with source `form`.
- Lead forms take files and speak the visitor's language. A `file` field (up to three per form; pictures, documents or
  either, up to 20 MB, checked by their bytes) sends the form as multipart; files are kept privately in the bucket
  under `<projectId>/forms/<formId>/`, listed and downloaded at `/v1/admin/lead-files` and erased with the contact.
  File fields need S3 configured (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`). Forms carry a
  translation per language (`POST /v1/admin/lead-forms/{id}/translate` uses the workspace's AI); `forms.js`, the hosted
  page and `GET /v1/forms/{pk}/{key}?locale=` show the visitor's, and errors, the confirmation page and email and the
  welcome email follow. New class `LeadFile` and fields `LeadForm.locale` and `LeadForm.translations` (need
  `schema:apply`; the container does it on boot). Confirmation links sent before this upgrade keep working.
- Contacts show how they were added (**Added via**: app user, lead form, sign-up, import, sync, Stripe, API, by hand,
  feedback import), filterable in the people list, segments (`origin`, `leadForms`) and `GET /v1/contacts?origin=`.
  New contacts record it themselves; run `bun scripts/backfill-contacts.mjs --apply` once to store it for older ones.
- Blog and newsletter (`docs/BLOG.md`): posts written in the panel's rich editor (Nuxt UI's TipTap, saved as
  Markdown) or through `/v1/admin/blog/*`, scheduled or published on a hosted, indexable blog at `/blog/<public key>`,
  drawn into any site by `public/blog.js` (MIT), served as JSON at `/v1/blog` and as RSS at
  `/v1/projects/<public key>/blog.rss`. Readers react and comment (identity token or email-only session); the team
  moderates and replies from the panel and the native app. Any published post can go to subscribers as a campaign,
  which in the cloud edition needs a plan with campaigns. New classes `BlogPost` and `BlogComment`, and fields
  `Project.blog` and `Campaign.blogPost` (need `schema:apply`; the container does it on boot). Images go to the bucket
  under `<projectId>/blog/`. A person's blog comments and reactions are erased with the rest of their data.
- Blog, the Ghost-like parts: pages, featured and members-only posts, SEO fields, HTML bodies (YouTube and Vimeo
  players allowed, sandboxed), the hosted blog's design (`Project.blog.design`: layout, typeface, colour scheme,
  accent, logo, cover, navigation, social links, footer), search, related posts and a sitemap at
  `/blog/<public key>/sitemap.xml`, publish-and-email (a scheduled post's newsletter waits for it), the
  `blog.post.published` / `.updated` / `.unpublished` / `.deleted` event webhooks (the worker announces scheduled
  posts as they go live) and `POST /v1/admin/blog/import` for a Ghost export. New `BlogPost` fields `type`,
  `featured`, `visibility`, `bodyFormat`, `coverImageAlt`, `metaTitle`, `metaDescription`, `ogImageUrl`,
  `canonicalUrl`, `externalId` and `announced`, with two indexes (need `schema:apply`; the container does it on
  boot). Existing posts read as public posts in Markdown. The body limit is now 200,000 characters.
- Languages and AI translation for onboarding flows, legal documents and email templates (`docs/LANGUAGES.md`). New
  fields `OnboardingFlow.locale` and `translations`, `LegalDocument.translationOf` and `EmailTemplate.locale` and
  `translations` (need `schema:apply`; the container does it on boot). `POST …/translate` on each uses the workspace's
  AI, or the gateway (`LITELLM_API_BASE_URL`), and is rate limited; `GET /v1/onboarding/<pk>/<key>?locale=`,
  `locale` on `POST /v1/emails/send` and `translations` on the public legal document pick a language. `onboarding.js`
  now asks for the visitor's language (`<html lang>`, else the browser's) and the Swift snippet for the user's first.
- Pages and headless CMS: landing pages built in a visual editor from templates and components, hosted at
  `/p/<public key>/<slug>`, embedded with `public/pages.js`, and served as JSON or HTML by the delivery API
  (`/v1/cms/{pk}/…`, read with `public/cms.mjs`); an AI assistant and wizard write pages, copy and components and can
  read the project's GitHub repos. See `docs/PAGES.md`. New classes `CmsComponent`, `CmsEntry`, `CmsAsset` and
  `CmsChatMessage`, and field `Project.cms` (needs `schema:apply`; the container does it on boot). Files go to the bucket
  under `<projectId>/cms/`. `/p` joins `/embed`, `/s` and `/brand` as frameable. Motion 14.5.0 (MIT) is vendored at
  `public/vendor/motion-14.5.0.js` and served by HelpBites for page animations. New event webhook types
  `cms.entry.published` and `cms.entry.unpublished`.
- MCP server at `/mcp`: Claude, ChatGPT, Cursor and other MCP clients can read the inbox, reply, triage feedback, move
  board items, write changelog entries and browse errors as the operator who connected them, with that operator's role
  and a key's project limit. Connect with an admin API key as a bearer header, or with the browser (OAuth, which
  claude.ai and ChatGPT need): that needs `HELPBITES_SECRET` set, a public https `APP_URL`, and your proxy to pass
  `/mcp`, `/.well-known/*` and `/oauth/authorize` through (the bundled Caddyfile already does). No schema change.
  See `docs/MCP.md`.
- The panel and the native app now open on **Overview** (`/overview`) instead of the inbox: a card per project, unread
  and open conversations, the latest unread messages, total revenue and revenue by project. Its data is
  `GET /v1/admin/overview` (see `docs/OVERVIEW.md`). No schema change; bookmarks to `/inbox` still work.
- Revenue: the monthly chart draws MRR at the end of each month over net revenue, and hovering or tapping a month shows
  its numbers. New `StripeSubscription` fields `monthly`, `paidFromMonth` and `endedMonth` (needs `schema:apply`; the
  container does it on boot); the MRR line fills in after the next Stripe sync, hourly or from **Sync**.
- **Security: keys can't mint access, read-only keys, no secrets in assistants' answers** (API and MCP). **Breaking for API keys:** creating, renaming and revoking API keys, adding, re-roling and removing teammates, inviting people, revealing or rotating a project secret, creating a project, changing the workspace's AI providers, deleting the workspace, connecting Telegram and registering a push device now need a signed-in person in the panel; an API key answers `403 session_required`. Before, a key (an OAuth-connected assistant's too) could mint a never-expiring unrestricted key that outlived revoking the connection, or add an admin teammate with a password. **Breaking for the `agent` role through `/v1`:** campaigns, sequences, sending email, suppressions and erasing a contact ask for the `marketing` role (admin), as the `/v1/admin` twins and `shared/roles.ts` always said; a project secret is unaffected. **New:** a read-only option for API keys and for assistant sign-ins (Settings, API keys, and the approval page; `readOnly` on `POST`/`PATCH /v1/admin/api-keys`): any call other than a read answers `403 key_read_only`, and an MCP connection on such a key is offered only the tools that read. **Fixed:** pointing an AI assistant at another endpoint kept its provider key, so editing one could send the key to a server of the editor's choosing; it now drops the key, as the workspace AI settings did. **MCP:** answers have credential keys (share tokens, signing secrets, provider keys, DSNs) and token query parameters cut, and a contacts write through the MCP can unsubscribe but never subscribe anyone. Run `bun scripts/ensure-schema.mjs` on upgrade (new `AdminApiKey.readOnly` field). The native app lists read-only keys but cannot yet create them.
- **Security: more hardening of the API and the MCP.** **Breaking for API keys:** the routes that decide where data, mail and credentials go (custom domains, inbound addresses, webhook endpoints, linked repositories, contact sources, workspace import and export links, GitHub, Stripe and revenue connections, error servers, push devices, OAuth approval, and a project's notification addresses, event and action webhooks, mail domain and sender) answer `403 session_required` to an API key; the MCP tools for webhook endpoints, domains, inbound addresses and repositories are gone. A key can't change an email log's content setting, and email logs show message content to signed-in admins only. `/mcp` refuses a panel session token. **MCP:** a path argument may only hold letters, digits, `-` and `_` and never a word naming a sibling route; a call times out after 30 s, a body is limited to 4 MB and a batch to 20; `start_conversation` fills a customer's name and email only when they have none. **OAuth:** assistant connections last 30 days and renew when used (refresh tokens 90 days), a refresh token used twice a minute apart revokes the connection, redirect addresses are limited to https, loopback and app schemes, client names are plain text, and the approval page shows the destination and selects *Read only* for an assistant it doesn't recognise. **Hardened:** HTML import, blog excerpts, plain-text conversion and legal imports read their input in linear time (a 200 KB body used to hold the server for seconds or minutes); CMS component HTML and SVG uploads are read like a browser reads them (`<svg/onload=…>`, `java&#115;cript:`); workspace export links no longer reveal the file's address and need `HELPBITES_SECRET`; export files may not have a line over 16 MB; Mailgun and GitHub webhooks bound their body and rate before reading it; outbound requests stop reading an answer at 20 MB and refuse more metadata and tunnel ranges (Azure, Oracle, site-local, 6to4, Teredo); one end user can't use up a project's request budget and the host's server has a budget of its own; password reset mails and invitations are limited per address; campaign mail goes through the edition's sender rewrite like every other mail; the blog preview is rate limited and the OAuth discovery documents vary by host. `GET /v1/meta` also returns `uploadsOrigin`, and remote images in operator-visible Markdown (FAQ, feedback, changelog) show as links.

## 0.1.0 — 2026-10-21

- Export and import between instances: **Settings → Workspace → Move to another HelpBites** (and **Settings → Data** in a
  project) downloads a workspace or one project, imports a file, or pulls straight from another HelpBites with an API key
  or login. See `docs/TRANSFER.md`. Needs `schema:apply` (the container does it on boot). To keep the original dates of
  imported rows, set `PARSE_SERVER_MAINTENANCE_KEY` and `PARSE_SERVER_MAINTENANCE_KEY_IPS` on Parse and the same value
  as `PARSE_MAINTENANCE_KEY` on the app; without it rows get the import time. Importing a file needs `S3_*`. The
  workspace export file now starts with `version: 2` and a `scope`; version 1 files still import.
- Onboarding: per-project flows of welcome screens, edited in the panel and the native app and published as versions
  at `GET /v1/onboarding/<public key>/<key>`. Show them with `/onboarding.js` or the SwiftUI snippet in
  `docs/ONBOARDING.md`; both keep a copy so a flow still shows when HelpBites is down. New class `OnboardingFlow`.
- Brand kit: logos, icons, screenshots, colours, fonts and guidelines per project, with a public page at
  `/brand/<public key>` (three templates), downloads, `/brand.js` and `GET /v1/brand/<public key>`. Files go to the S3
  bucket under `<projectId>/brand/` and count against storage. New class `BrandAsset` and field `Project.brand`. The
  brand page is framed by other sites, so `/brand` joins `/embed` and `/s` as frameable. Needs `schema:apply` (the
  container does it on boot).
- Inbox conversations can be archived and deleted, on the web and in the native app. Archived threads leave the queue and
  live under a new **Archived** view; they come back when the customer writes again. Deleting removes the conversation
  and all its messages for good. Needs `schema:apply` (the container does it on boot).
- Errors from GlitchTip and Bugsink no longer open inbox conversations or AI notes. The Errors page has cards that
  expand to the stack trace, event details, breadcrumbs and tags, an **Alerts** button for email rules (new error,
  total events, events within a time window), and AI that analyzes an error against the project's GitHub repos or
  copies a prompt for a coding agent. Alert webhooks now just trigger a check of the rules. Needs `schema:apply` (the
  container does it on boot). Conversations opened by earlier errors stay.
- Changelog entries can be drafted by AI from a project's GitHub commits (on demand, or on every push), always as drafts
  waiting for review unless the project turns on publishing without review. Select entries to approve or merge them.
- The public changelog is its own switch (`changelog.enabled`), no longer tied to the feedback board, and has its own embed
  (`/changelog.js`, `/embed/changelog`). Existing projects the board published are switched on by
  `scripts/migrate-changelog-public.mjs`, which the container runs on boot.
- Published as open source (AGPL-3.0). The community image is built and pushed to Docker Hub and GHCR on every tagged
  release, for amd64 and arm64.
- `docker-compose.yml` pulls the published image; `docker-compose.build.yml` builds from source.
- `scripts/install.sh` writes a `.env` with generated secrets. An optional bundled Caddy (`--profile proxy`) serves
  HTTPS.
- Production refuses to start with the `change-me` placeholder `PARSE_MASTER_KEY` or `MEILI_MASTER_KEY`.
- Parse accepts the master key only from the stack's own network (`SB_INTERNAL_SUBNET`, default `10.213.0.0/24`).
  An existing deployment must recreate its Compose network once: `docker compose down && docker compose up -d`.
