# Changelog

All notable changes to the community edition. Versions are Docker image tags
(`elrumo/helpbites:<version>`).

## Unreleased

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
