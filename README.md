# HelpBites

[![Docker Hub](https://img.shields.io/docker/v/elrumo/helpbites?label=docker%20hub&sort=semver)](https://hub.docker.com/r/elrumo/helpbites)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Status: beta](https://img.shields.io/badge/status-beta-orange)](CHANGELOG.md)

> **HelpBites is in public beta.** It runs in production for its author and everything below is on `main`, but expect
> rough edges, back up before you upgrade and read the [release notes](CHANGELOG.md) first (they are also public at
> [helpbites.app](https://helpbites.app/changelog/pk_68ccfcddaabeee44c8cd907a)). Issues and pull requests are welcome.

The all-in-one toolkit for indie developers: a support inbox, feedback board, roadmap, changelog and more for every app you run. Each app is a *project*; its users
keep their own accounts (the app signs an identity token), an operator answers
everything from one panel, and a drop-in widget or your own UI talks to a
documented API.

- **API** — `/v1/*`, OpenAPI at `/_docs/scalar`. Every `/v1/admin/*` operation accepts either an operator session or a general `ak_…` admin key created in the panel’s API keys page, either for the whole workspace or limited to chosen projects.
- **Panel** — `/inbox`, `/projects`, `/emails`, `/agents`, `/knowledge`, `/assistants`. A fresh install shows a sign-up form for the first operator (set `SETUP_TOKEN` so only you can complete it); teammates are added from the Team page (or `bun run add-agent`).
- **Knowledge** — upload `SUPPORT_FAQ.md`, review the detected FAQs, organize them in a path tree, and assign them to AI assistants that (optionally) send grounded answers and hand the rest to your team. Hybrid search via Meilisearch.
- **Widget** — `/widget.js` + `/embed`
- **Feedback and roadmap** — a public feedback page per project (posts, votes, comments, roadmap), with a private planning board behind it. Drop in `/feedback.js` or build on `/v1/feedback`; operators triage it under Project → Feedback.
- **Changelog** — entries grouped into releases, drafted from the posts, planning items, tickets and errors they came from, public at `/changelog/pk_…` + RSS. Operators write it under Project → Changelog.
- **Planning & roadmap** — Linear-style items per project on a kanban, linked to feedback posts and inbox conversations. Items you mark public make the roadmap at `/roadmap/<pk>`, in the feedback embed, or on `GET /v1/feedback/roadmap`; operators plan under Project → Planning.
- **Email** — a block email designer (sections, a reusable component library) with an AI designer (High / Ultra models) that converts pasted HTML into editable blocks. Master templates are designed once and linked into projects, each filling in its own brand and values. Projects send a template, their own HTML (or an uploaded `.html` file), a block document or a plain message with `POST /v1/emails/send`: per-recipient variables, attachments, custom headers, scheduling, idempotency keys and a per-project sender. Every message lands in a searchable log kept current by Mailgun's delivery webhook, bounces and complaints are suppressed automatically.
- **Error tracking** — optional GlitchTip or Bugsink projects provide Sentry-compatible DSNs; alerts become inbox conversations and status syncs both ways.
- Docs on the web: [helpbites.app/docs](https://helpbites.app/docs). Image: [Docker Hub](https://hub.docker.com/r/elrumo/helpbites). In this repo: [Getting started](docs/GETTING-STARTED.md), [Setting things up](docs/SETUP.md) (AI, email, GitHub, storage…), [Development](docs/DEVELOPMENT.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/CONNECTING.md](docs/CONNECTING.md), [docs/KNOWLEDGE.md](docs/KNOWLEDGE.md), [docs/FEEDBACK.md](docs/FEEDBACK.md), [docs/EMAIL.md](docs/EMAIL.md), [docs/ERRORS.md](docs/ERRORS.md)

## Self-host in two commands

```bash
git clone https://github.com/elrumo/help-bites-oss.git && cd help-bites-oss
scripts/install.sh help.example.com        # or no argument for a trial on http://localhost:3100
docker compose up -d                       # pulls elrumo/helpbites from Docker Hub
```

`install.sh` writes a `.env` with generated secrets. With a domain it also turns on the bundled Caddy for HTTPS (point
the domain and `files.<domain>` at the server first). Open the site and **create the first operator right away**:
whoever gets there first becomes the owner. The image is also at `ghcr.io/elrumo/helpbites`. Pin a version with
`HELPBITES_VERSION=0.2.0` in `.env`. AI, email and GitHub are switched on afterwards: [docs/SETUP.md](docs/SETUP.md). Full guide, upgrades and backups: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Develop it

Full guide: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```bash
cp .env.example .env                       # fill in keys
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d sb-mongo sb-parse sb-redis sb-meili sb-rustfs
bun install
bun run schema:apply                       # classes, CLPs, indexes (idempotent)
bun run search:setup                        # Meilisearch indexes + settings (idempotent)
bun run dev                                # http://localhost:3100 — the first visit asks you to create the operator account
```

Checks: `bun test` (pure logic), `bun run smoke` (end-to-end against the running stack),
and `bun run smoke:isolation` (one workspace can never reach another's data).
Seed a demo knowledge model: `bun run seed:knowledge` (against a running app). Backfill search: `bun run reindex`.

## Deploy

`docker compose up -d` runs sb-mongo, sb-parse, sb-redis, sb-meili and the app. Nothing publishes a host port
unless you use the bundled Caddy (`--profile proxy`): otherwise attach domains from Dokploy's Domains tab (or your
own proxy) by service name and container port (`app` → 3000). You don't need one on `sb-parse`: it holds the
data layer, and only the app uses it. The app container applies the schema on every boot. Attachments go to any S3-compatible bucket (`S3_*` env).

Full guide (Dokploy, plain Compose, every env var, backups, troubleshooting):
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). An install from before workspaces upgrades on its
own: its data moves into one workspace on the first boot.

Don't want to run it yourself? HelpBites Cloud is the hosted, paid edition. See
[docs/EDITIONS.md](docs/EDITIONS.md) for how it differs from the self-hosted one.

## Layout

```
server/routes/v1/**      the API, one file per route
server/utils/            auth (identity tokens, agent sessions), conversations (write rules), events (Redis → SSE), mailer, s3
shared/                  vocabulary and pure transcript helpers, used by server and app
shared/feedback.ts       feedback vocabulary, defaults and validation
shared/board.ts          planning and roadmap vocabulary, validation and grouping
app/                     Nuxt UI panel and the embed pages (/embed chat, /embed/feedback page)
public/widget.js         the chat loader host sites include
public/feedback.js       the feedback page loader
scripts/                 ensure-schema, migrate-workspaces, add-agent, dev-token, smoke (+ isolation)
cli/                     `helpbites changelog`: git changes → changelog entries (see cli/README.md)
```

## Editions & licensing

HelpBites comes in two editions built from this one repository:

- **Community.** Self-host it and get every feature, with no limits.
  - It is open source under the [GNU AGPL-3.0](LICENSE).
  - If you run a modified version for others, you must offer them its source. The panel's **Source code** link (or
    `/source`, set with `SOURCE_CODE_URL`) does that.
  - This is what `docker compose up` builds.
- **Cloud.** The hosted, paid service, with sign-up, plans and billing.
  - It adds a small commercial layer that is kept in a private repository and is not part of this one.

**What else is not AGPL**

| Code | License | Why |
|---|---|---|
| `public/widget.js`, `public/feedback.js` | [MIT](licenses/MIT.txt) | Your site embeds them |
| `cli/` | [MIT](licenses/MIT.txt) | Runs in your repo |

**Using the name**: "HelpBites" and the logo are trademarks. Forks and hosted services must use their own name; see
[TRADEMARKS.md](TRADEMARKS.md).

**Contributing**: contributions need a one-time [CLA](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md).

**More detail**: [docs/EDITIONS.md](docs/EDITIONS.md).
