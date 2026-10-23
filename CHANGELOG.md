# Changelog

All notable changes to the community edition. Versions are Docker image tags
(`elrumo/helpbites:<version>`).

## Unreleased

- **Optional Plausible stats** for HelpBites' own site and panel: set `NUXT_PUBLIC_PLAUSIBLE_SRC` to the script's address (off by default; the panel reads it at run
  time, the prerendered landing page and docs need it as a Docker build arg too). It is not loaded in the embeds or on the invite and OAuth pages, and its origin joins the panel's script policy. No schema changes.
- **Developer & MCP**: the workspace Developer page is now **Developer & MCP** and gains an AI assistants section with the
  `/mcp` address and a `claude mcp add` command (web and native); each project's Install & API page points to it. No schema or env change.
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
