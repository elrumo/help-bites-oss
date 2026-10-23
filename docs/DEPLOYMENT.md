# Deploying HelpBites

Everything you need to run HelpBites yourself, from a laptop to production. No
prior knowledge of the codebase assumed.

HelpBites is one support inbox for every app you run. It ships as a single Nuxt
app plus a handful of stateful services you run alongside it. This guide covers
what those services are, how to wire them up, every environment variable, and
three ways to deploy: local dev, Dokploy (the blessed path), and plain Docker
Compose behind your own reverse proxy.

- New here? Start with [Quick start (local)](#quick-start-local).
- Going to production? Read [Architecture](#architecture) then jump to
  [Dokploy](#deploy-on-dokploy) or [Plain Docker Compose](#deploy-with-plain-docker-compose).
- Just need a variable? [Environment reference](#environment-reference).

---

## Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick start (local)](#quick-start-local)
- [Deploy on Dokploy](#deploy-on-dokploy)
- [Deploy with plain Docker Compose](#deploy-with-plain-docker-compose)
- [Environment reference](#environment-reference)
- [External services](#external-services)
- [First run](#first-run)
- [Operations](#operations)
- [Verifying a deployment](#verifying-a-deployment)
- [Upgrades](#upgrades)
- [Licensing notes for the services](#licensing-notes-for-the-services)
- [Troubleshooting](#troubleshooting)
- [Security checklist](#security-checklist)

---

## Architecture

One app container, four stateful services. The app is the only holder of the
Parse master key and the only thing your users and operators ever talk to.

```
                         ┌───────────────────────────────┐
   browser widget  ──────▶                               │
   operator panel  ──────▶   app  (Nuxt + Nitro, :3000)  │
   your own API    ──────▶                               │
                         └──┬───────┬────────┬────────┬──┘
                            │       │        │        │
              master key    │       │        │        │  hybrid search
                 ┌──────────▼──┐ ┌──▼────┐ ┌─▼─────┐ ┌▼──────────┐
                 │  sb-parse   │ │sb-redis│ │  S3   │ │  sb-meili │
                 │ (Parse 9)   │ │ (7)   │ │bucket │ │ (Meili)   │
                 └──────┬──────┘ └───────┘ └───────┘ └───────────┘
                        │  SSE fan-out,     attachments  knowledge
                 ┌──────▼──────┐ rate limits, + knowledge  search
                 │  sb-mongo   │ email throttle  docs
                 │ (Mongo 7)   │
                 └─────────────┘
```

| Service | Image | Role | Required? |
|---|---|---|---|
| **app** | built from `Dockerfile` | The panel, the `/v1/*` API, the widget. Listens on `:3000`. Applies the DB schema on every boot. | Yes |
| **sb-mongo** | `mongo:7` | Parse's datastore. All conversations, projects, knowledge, users. | Yes |
| **sb-parse** | `parseplatform/parse-server:9.10.0` | Data layer (classes, CLPs, sessions). Only the app holds its master key. | Yes |
| **sb-redis** | `redis:7-alpine` | SSE fan-out (pub/sub), rate limits, email throttle. | Yes |
| **sb-meili** | `getmeili/meilisearch:v1.53` | Hybrid knowledge + full-text search. App falls back to a Parse keyword scan if it's down. | Recommended |
| **S3 bucket** | any S3-compatible (MinIO, Garage, RustFS, AWS S3) | Image attachments and uploaded knowledge documents. | For attachments/uploads |

Optional integrations (all off unless configured): a **LLM endpoint** for AI
auto-reply, **Mailgun** for email notifications, **APNs** for native operator
push, and a **remote embeddings** service if you don't want to run the model
in-process.

**Why the `sb-` prefix?** On a shared Dokploy network, other projects run
services literally named `parse`, `redis`, or `mongo`. Docker DNS would resolve a
bare name to any of them. The prefix keeps HelpBites talking to its own services.

**Scaling note:** every write publishes on one Redis channel and each app
process fans it out to its own SSE clients, so you can run **multiple `app`
replicas** behind a load balancer. Rate limits are shared through Redis. The one
per-process cost is the local embedding model (cached on a volume per instance) —
if you scale out, either accept the per-replica model cache or point
`EMBEDDING_ENDPOINT` at a shared embeddings service.

---

## Prerequisites

- **Docker** + the Compose plugin (`docker compose version` ≥ v2).
- A **domain** and TLS for production. Dokploy or a reverse proxy terminates TLS;
  no HelpBites service publishes a host port on its own.
- For building/hacking locally: **[Bun](https://bun.sh) 1.x**.
- Optional accounts, only if you want the matching feature: an S3 provider, a
  Mailgun account, an OpenAI-style LLM endpoint, an Apple developer account (push).

Nothing else. Mongo, Parse, Redis, and Meili all run as containers from the
provided Compose file.

---

## Quick start (local)

The fastest path to a running app on your machine. Uses the dev Compose overlay,
which publishes ports on `localhost` and adds a Parse dashboard and RustFS.

```bash
git clone https://github.com/elrumo/help-bites-oss.git help-bites
cd help-bites
cp .env.example .env          # defaults already point at localhost
bun install
```

Bring up the backing services (note the `--profile dev` — it adds RustFS and the
Parse dashboard):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d sb-mongo sb-parse sb-redis sb-meili sb-rustfs
```

Apply the schema and search setup (both idempotent — safe to re-run any time):

```bash
bun run schema:apply
bun run search:setup
```

Run the app in dev mode:

```bash
bun run dev
```

Open **http://localhost:3100**. The first visit shows a sign-up form — that
creates your first operator account. From there: create a project, upload
knowledge, grab the widget snippet.

What you get locally:

| URL | What |
|---|---|
| http://localhost:3100 | The app (panel + API + widget) |
| http://localhost:3100/_docs/scalar | Interactive API docs |
| http://localhost:4040 | Parse dashboard (`admin` / `admin`) |
| http://localhost:9001 | RustFS console (`rustfsadmin` / `rustfsadmin`) |
| http://localhost:7700 | Meilisearch |

Seed some demo knowledge and run the end-to-end smoke test against the running
app:

```bash
bun run seed:knowledge
bun run smoke
```

> The dev overlay (`docker-compose.dev.yml`) is **never** used in production — it
> exists only to expose localhost ports so `bun run dev` and the Parse dashboard
> can reach the stack.

---

## Deploy on Dokploy

This is what HelpBites is built for. Dokploy runs the base `docker-compose.yml`
as a "Docker Compose" application and attaches domains per service — **no service
publishes a host port**.

### 1. Create the application

1. In Dokploy, **Create → Compose** (Docker Compose app).
2. Point it at your Git repository (Dokploy re-clones on each deploy) or paste
   the compose. Use the repo's `docker-compose.yml` as-is.
3. Set the build context so the `app` service's `build: .` finds the `Dockerfile`.

> **Persistence:** a git-sourced deploy re-clones the code directory on every
> deploy, so nothing durable may live under it. All state lives in the named
> volumes (`mongo-data`, `redis-data`, `meili-data`, `model-cache`) — those
> survive redeploys. Don't bind-mount app state into the repo tree.

### 2. Set environment variables

Paste your production values into Dokploy's **Environment** tab (this becomes the
`.env` the `app` service reads via `env_file: .env`). See the
[Environment reference](#environment-reference) and the
[production `.env` example](#example-production-env) below. At minimum set:
`APP_URL`, `PARSE_ID`, `PARSE_MASTER_KEY`, `MEILI_MASTER_KEY`, and the `S3_*`
group.

The compose file injects the internal service URLs for you, so **do not** set
these in production — they're overridden anyway:

```yaml
PARSE_URL: http://sb-parse:1337/parse
REDIS_URL: redis://sb-redis:6379
MEILI_URL: http://sb-meili:7700
TRANSFORMERS_CACHE: /models
NITRO_PORT: "3000"
```

### 3. Attach domains

From the **Domains** tab, attach domains by **service name + container port**:

| Service | Container port | Domain | Notes |
|---|---|---|---|
| `app` | `3000` | `support.yourdomain.com` | The whole product. Required. |
| `sb-meili` | `7700` | `help-search.yourdomain.com` | Only if you run a Meilisearch UI elsewhere pointing at it. **Exposes the API — see below.** |
| `sb-parse` | `1337` | **Don't, unless you need it** | The app talks to Parse internally (as `sb-parse-internal`, so a domain here never changes how it reaches Parse). Parse only honours the master key from the stack's own network (`PARSE_SERVER_MASTER_KEY_IPS`), but a public `sb-parse` still exposes Parse's REST API, and `/parse/login` has none of the app's rate limits. |

Dokploy terminates TLS and routes to the container port. Point `APP_URL` at the
`app` domain.

> **If you expose `sb-meili` publicly:** the compose runs it with
> `MEILI_ENV=production`, and `/health` is unauthenticated. Set a strong
> `MEILI_MASTER_KEY` — it's the only thing protecting your search data and
> settings — and give the app its own scoped `MEILI_API_KEY` (see
> [Meilisearch](#meilisearch)). Better still, restrict the domain to the
> addresses that need it (a Traefik `ipAllowList` middleware), or don't attach a
> domain to it at all if you don't need external search access.

### 4. Deploy

Hit **Deploy**. On boot the `app` container runs, in order:

```sh
bun scripts/ensure-schema.mjs --apply      # create/patch classes, CLPs, indexes
bun scripts/migrate-workspaces.mjs --apply # an older install moves into one workspace
bun scripts/migrate-changelog-public.mjs --apply # projects whose board published the changelog get their own switch
bun scripts/ensure-search.mjs              # create Meili indexes + settings, backfill workspaceId
bun .output/server/index.mjs               # start the app
```

All are idempotent. `ensure-search` never fails the boot (Meili is
optional). There is no separate migration step: the schema is reconciled, and an
install from before workspaces is moved into one, on every boot (see
[Upgrades](#upgrading-to-workspaces)). With more than one app container, let one
of them migrate and set `RUN_MIGRATIONS=0` on the rest.

Then open your `app` domain and [create the first operator](#first-run).

---

## Deploy with plain Docker Compose

Not on Dokploy? Same compose, you just supply the reverse proxy. Because no
service publishes a host port, put a proxy in front of `app:3000`.

### 1. Configure

The quick way: `scripts/install.sh help.example.com` writes `.env` with generated
secrets, bundled storage and the bundled Caddy (`--profile proxy`) for HTTPS. Point DNS for
`help.example.com` and `files.help.example.com` at the server first; Caddy gets the
certificates by itself. Without a domain it prepares a trial on `http://localhost:3100`.

By hand:

```bash
git clone https://github.com/elrumo/help-bites-oss.git && cd help-bites-oss
cp .env.example .env
$EDITOR .env      # replace every change-me value (see Environment reference)
```

Set `APP_URL` to your public HTTPS URL. Leave `PARSE_URL`, `REDIS_URL`,
`MEILI_URL` as the compose provides them (internal service DNS). Production refuses
to start while `PARSE_MASTER_KEY` or `MEILI_MASTER_KEY` still holds the `change-me`
placeholder.

### 2. Start the stack

```bash
docker compose up -d
```

This starts `sb-mongo`, `sb-parse`, `sb-redis`, `sb-meili`, and `app` (pulled from
Docker Hub as `elrumo/helpbites`; add `-f docker-compose.build.yml --build` to build it
from your checkout instead). `parse-dashboard` stays down (it's behind the `dev` profile), and
so does the bundled `sb-rustfs` unless you opt in with `--profile rustfs` (see
[S3 storage](#s3-storage)).

### 3. Put a proxy in front

The `app` container listens on `3000` but publishes nothing to the host. Add a
reverse proxy on the same Docker network. A minimal **Caddy** example
(auto-TLS) — save as `Caddyfile` and run Caddy on the compose network:

```caddyfile
support.yourdomain.com {
    reverse_proxy app:3000
}
```

The bundled `Caddyfile` (the `proxy` profile) also serves your projects' [custom domains](CUSTOM-DOMAINS.md): it asks the app
(`/v1/internal/domain-check`) before requesting a certificate for a new host. Any other proxy needs the same two things, described there.
Optional variables: `CUSTOM_DOMAIN_TARGET`, `CUSTOM_DOMAIN_IP`, `CUSTOM_DOMAIN_RESERVED`.

To receive mail at a project's address ([inbound email](INBOUND-EMAIL.md)), add one Mailgun Route (`match_recipient(".*")` → `forward("<APP_URL>/v1/webhooks/mailgun-inbound")`) and, for forwarding aliases, set `INBOUND_DOMAIN` to a Mailgun domain whose MX points at Mailgun.

Or an **nginx** server block if you terminate TLS elsewhere:

```nginx
server {
    listen 80;
    server_name support.yourdomain.com;

    location / {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Server-Sent Events (/v1/events) — do not buffer, keep it open.
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

> **SSE matters.** HelpBites pushes live updates over `/v1/events` (Server-Sent
> Events). Any proxy in front must **disable response buffering** and allow long
> read timeouts on that path, or messages will arrive in laggy bursts. Caddy
> handles this automatically; nginx needs `proxy_buffering off` as shown.

### 4. Point a bucket at it

If you're not using AWS S3, the simplest self-hosted option is the bundled RustFS
(`docker compose --profile rustfs up -d`) — or point at a separate
MinIO/Garage/RustFS deployment, then set the `S3_*` variables to match. See
[S3 storage](#s3-storage).

---

## Environment reference

The app reads a `.env` file (Compose passes it to the `app` service via
`env_file: .env`). Copy `.env.example` and fill it in. Below, **Required** means
the app won't function without it; **Recommended** means a core feature degrades
without it; **Optional** means a feature stays off until you set it.

### Core

| Variable | Required | Default | Notes |
|---|---|---|---|
| `APP_URL` | **Yes** (prod) | `http://localhost:3100` | Public origin of this deployment. Used by `widget.js`, email CTAs, and the API examples in the panel. Set to your real HTTPS domain. |
| `ADMIN_URL` | Optional | falls back to `APP_URL` | Only set if the operator panel lives on a different host than `APP_URL`. Used in operator email links (e.g. password reset, new-message CTAs). |
| `SETUP_TOKEN` | Recommended | _(empty: open)_ | While no operator exists, the first sign-up must enter this value, so whoever reaches a fresh deploy first can't claim it. Any long random string; unused once the first operator exists. `scripts/install.sh help.example.com` generates one. |
| `TRUST_PROXY_HOPS` | Optional | `1` | How many reverse proxies stand in front of the app. Per-IP rate limits read the client from `X-Forwarded-For` counting this many entries from the right, since the left-most entry is whatever the client sent. `1` fits Dokploy's Traefik; set `2` behind e.g. Cloudflare → Traefik. |
| `NITRO_PORT` | No | `3000` (set by compose) | Port the app listens on inside the container. Leave it. |
| `APP_ROLE` | Optional | `all` | `all` runs everything in one process. The hosted overlay splits `web`, `worker` (schedulers, the job queue, pushes: whatever must run once) and `embedder` (the local model, served at `/v1/internal/embeddings`). |
| `RUN_MIGRATIONS` | Optional | `1` | Run the schema, workspace and search migrations on boot. With several app containers, keep it on one and set `0` on the rest. |
| `SOURCE_CODE_URL` | Optional | the upstream repository | Where the panel's **Source code** link and `/source` point. The AGPL asks a modified deployment to offer its users the source it runs: set your fork. With `GIT_SHA` baked in at build time, a GitHub URL points at the exact commit. |
| `DEFAULT_WORKSPACE_NAME` | Optional | `HelpBites` | The workspace an install from before workspaces moves into. |
| `ALLOW_PRIVATE_NETWORK` | Optional | off | URLs typed into the panel (assistant LLM endpoints, the workspace's AI provider, error-tracker URLs, webhooks, database syncs) may not point at private or loopback addresses unless this is `1`. Self-hosting a LiteLLM or GlitchTip next to the app? Set it. Never set it on a shared, hosted service. Server-side env URLs (`LITELLM_API_BASE_URL`, `GLITCHTIP_API_URL`) are not affected. |
| `HELPBITES_EDITION` | Build arg | `community` | `cloud` builds the hosted edition (adds `ee/`). See [EDITIONS.md](EDITIONS.md). |
| `NODE_ENV` | No | `production` (set by Dockerfile) | — |

### Parse + MongoDB

The app is the only master-key holder. In production, Compose sets `PARSE_URL`
for you.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PARSE_ID` | **Yes** | `helpbites` | Parse application id. Must match the `sb-parse` service. |
| `PARSE_MASTER_KEY` | **Yes** | `change-me-master` | **Change this.** The master key; grants full data access. Only the app should have it. |
| `PARSE_MAINTENANCE_KEY` | No | unset | Keeps the original dates of rows imported from another HelpBites; must equal `PARSE_SERVER_MAINTENANCE_KEY` on Parse. See [TRANSFER.md](TRANSFER.md). |
| `PARSE_URL` | **Yes** | `http://localhost:1337/parse` (compose overrides to `http://sb-parse:1337/parse`) | Where the app reaches Parse. Don't set in prod. |
| `PARSE_SERVER_DATABASE_URI` | **Yes** | `mongodb://sb-mongo:27017/helpbites` | Mongo connection string the `sb-parse` container reads. Point at an external Mongo/Atlas here if you don't run `sb-mongo`. |

### Redis

| Variable | Required | Default | Notes |
|---|---|---|---|
| `REDIS_URL` | **Yes** | `redis://localhost:6379` (compose overrides to `redis://sb-redis:6379`) | SSE fan-out, rate limits, email throttle. Rate limiting fails **open** if Redis is down (requests are allowed). |

### Search (Meilisearch)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MEILI_URL` | Recommended | `http://localhost:7700` (compose overrides to `http://sb-meili:7700`) | Hybrid knowledge + full-text search. If unreachable, the app falls back to a Parse keyword scan. |
| `MEILI_MASTER_KEY` | Recommended | `change-me-meili` | **Set a strong value in production**, especially if `sb-meili` is exposed via a domain — the container runs with `MEILI_ENV=production`. `sb-meili` needs it; the app only as a fallback for `MEILI_API_KEY`. |
| `MEILI_API_KEY` | Recommended | _(empty: the master key)_ | The app's scoped Meilisearch key, printed by `bun run search:key` (see [Meilisearch](#meilisearch)). |

### Knowledge embeddings

Semantic search runs a CLIP text encoder in-process by default (via
transformers.js on the onnxruntime-node backend). You have three modes: **local
model** (default), **remote endpoint**, or **lexical-only**.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ICON_EMBEDDING_MODEL` | No | `Xenova/clip-vit-large-patch14` | The local embedding model. |
| `ICON_EMBEDDING_DEVICE` | No | `cpu` (empty = cpu) | `cpu` or `cuda` **only** (Linux + GPU). `wasm`/`webgpu` are browser-only and throw "Unsupported device". |
| `TRANSFORMERS_CACHE` | No | `.data/models` (compose sets `/models` on a volume) | Where the model is cached across boots. |
| `KNOWLEDGE_DISABLE_EMBEDDINGS` | No | _(off)_ | Set `1` to skip embeddings entirely and run lexical-only search. Fastest boot, no model download. |
| `EMBEDDING_ENDPOINT` | No | _(off)_ | Point at a remote OpenAI-style embeddings service instead of running the model in-process. Recommended if you run multiple app replicas. |
| `EMBEDDING_API_KEY` | No | _(off)_ | Auth for `EMBEDDING_ENDPOINT`. |

### AI support agents (auto-reply)

Off unless a project has an assistant with `autoReply` enabled **and** an LLM
configured. OpenAI-compatible / LiteLLM style.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `LITELLM_API_BASE_URL` | Optional | _(off)_ | Default LLM endpoint. Per-agent settings can override it. |
| `LITELLM_API_KEY` | Optional | _(off)_ | Auth for the endpoint. |
| `LLM_DEFAULT_MODEL` | Optional | `openai/mimo-v2.6-flash` | Model used when an agent doesn't specify one. |

### Error tracking (GlitchTip or Bugsink)

Optional, and either tracker (or both) can be set up. The bundled `glitchtip` Compose profile runs a Sentry-compatible
GlitchTip instance with its own Postgres database. Attach a public domain to
`sb-glitchtip:8000`; Sentry SDKs must be able to reach that domain. Follow the
bootstrap and connection steps in [ERRORS.md](ERRORS.md). The `bugsink` profile
runs a single-container Bugsink on SQLite; attach a public domain to
`sb-bugsink:8000` the same way.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GLITCHTIP_URL` | Optional | _(off)_ | Public GlitchTip URL, used in DSNs and operator links. |
| `GLITCHTIP_TOKEN` | Optional | _(off)_ | API token. Can be entered in Connect error tracking instead, which wins over these. |
| `GLITCHTIP_ORG` | With token | _(off)_ | GlitchTip organisation slug. |
| `GLITCHTIP_TEAM` | No | `helpbites` | Team created or reused for HelpBites projects. |
| `GLITCHTIP_SECRET_KEY` | With bundled service | — | Set a strong random value. |
| `GLITCHTIP_DB_PASSWORD` | With bundled service | — | Postgres password for GlitchTip only. |
| `BUGSINK_URL` | Optional | _(off)_ | Public Bugsink URL (its `BASE_URL`), used in operator links. |
| `BUGSINK_TOKEN` | Optional | _(off)_ | Bugsink API token. Can be entered in Connect error tracking instead, which wins over these. |
| `BUGSINK_TEAM` | No | `HelpBites` | Team created or reused for HelpBites projects. |
| `BUGSINK_SECRET_KEY` | With bundled service | — | Set a strong random value. |
| `ERRORS_WEBHOOK_BASE` | No | `APP_URL` | Reachable HelpBites base URL for alert callbacks. `GLITCHTIP_WEBHOOK_BASE` is still read as a fallback. |
| `NUXT_PUBLIC_SENTRY_DSN` | No | _(off)_ | A project DSN for HelpBites' own browser and server errors. |
| `NUXT_PUBLIC_PLAUSIBLE_SRC` | No | _(off)_ | The address of a [Plausible](https://plausible.io) script (`https://stats.example.com/js/pa-….js`) for page-view stats of HelpBites' own site and panel. Not loaded in the embeds or on invite and OAuth pages; the script's origin is added to the panel's script policy. The panel reads it at run time; the landing page and docs are prerendered, so also pass it as a Docker build arg to track them. |

An external GlitchTip installation works too: set `GLITCHTIP_URL` and, if its
API is on another origin, `GLITCHTIP_API_URL` (or the API URL field in Connect
error tracking).

### S3 storage

Holds image attachments and uploaded knowledge documents. Works with any
S3-compatible provider. The app throws when an upload is attempted and these
aren't set, so configure them for any real deployment.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `S3_ENDPOINT` | **Yes** | `localhost` | Host of the S3 API (no scheme). e.g. `s3.amazonaws.com`, `sb-rustfs`, `s3.eu-west-1.amazonaws.com`. |
| `S3_PORT` | No | provider default | Set for self-hosted (`9000` for RustFS). Omit for AWS. |
| `S3_USE_SSL` | No | `true` (anything but `false`) | Set `false` for plain-HTTP RustFS on a private network. |
| `S3_ACCESS_KEY` | **Yes** | `rustfsadmin` | — |
| `S3_SECRET_KEY` | **Yes** | `rustfsadmin` | **Change this.** |
| `S3_BUCKET` | **Yes** | `help-bites` | Created automatically if it doesn't exist. |
| `S3_PUBLIC_URL` | **Yes** | `http://localhost:9000/help-bites` | Public base URL of the bucket — this is what ends up in attachment URLs served to browsers. |
| `S3_REGION` | No | `us-east-1` | Region for the S3 client. |
| `S3_SET_PUBLIC_POLICY` | No | _(on)_ | On first use the app sets a public-read bucket policy (good for RustFS). Set `false` on AWS S3 where you manage the bucket policy / ACLs yourself. |

> Attachments and knowledge docs are stored under unguessable, project-prefixed
> keys. The bucket is public-read by design (attachment URLs are shared into
> conversations). Knowledge source documents are only ever served through an
> authenticated admin route, not their public URL.

### Email (Mailgun)

Optional. Enables the email send API and the email notifications to end users
and operators. All three of the first must be set or email is skipped (the send
API answers 503).

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MAILGUN_API_KEY` | Optional | _(off)_ | — |
| `MAILGUN_DOMAIN` | Optional | _(off)_ | Your Mailgun sending domain. A project can send through another domain of the same account (Project → Email → Settings). |
| `BUNNY_NET_API_KEY` | No | _(off)_ | Your Bunny.net account API key. With it, **Push live now** on a pricing table also purges the CDN's cached copies of the table's JSON and hosted page. |
| `MAILGUN_API_BASE_URL` | No | `https://api.eu.mailgun.net` | Use `https://api.mailgun.net` for US region. |
| `MAILGUN_FROM_EMAIL` | Optional | `support@example.com` | The default from-address. Projects can set their own address and from name. |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | Optional | _(off)_ | Turns on `/v1/webhooks/mailgun`: delivery status in the email log, and automatic suppression of bounces, complaints and unsubscribes. |
| `EMAIL_LOG_RETENTION_DAYS` | No | `180` | Days of email log to keep; `0` keeps everything. |
| `CHANGELOG_LINK_SECRET` | For changelog emails | derived from `HELPBITES_SECRET` | Signs the confirm and unsubscribe links in changelog subscription mail. Its own secret, so rotating a project secret never breaks unsubscribe links already sent. 32+ characters; a shorter one counts as unset. Unset, a key derived from `HELPBITES_SECRET` signs them (setting this later voids those links). With neither, subscribing answers 503 and the scheduler logs a warning and does not start. |
| `ENABLE_CHANGELOG_NOTIFY` | No | off | Set `true` to run the changelog scheduler (every five minutes: the instant sweep and the Monday digest, for each project with `changelog.notify` on). Off, nothing is mailed to subscribers, so a deploy never starts before you say so, and a system that still sends the same digests can be switched off first. `POST /v1/admin/changelog/notify/run` runs a beat by hand either way. |

### Native push (APNs)

Optional. Required only for the native operator app's push notifications.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `APNS_KEY_ID` | Optional | _(off)_ | Apple key id. |
| `APNS_TEAM_ID` | Optional | _(off)_ | Apple team id. |
| `APNS_BUNDLE_ID` | Optional | `com.helpbites.operator` | The operator app's bundle id. |
| `APNS_KEY` | Optional | _(off)_ | The full `.p8` private key body. Literal `\n` sequences are accepted (handy for single-line env vars). |
| `APNS_ENV` | No | `sandbox` | `sandbox` or `production`. |

### Agent seeding (CLI only)

Defaults for `bun run add-agent`; command-line args override them. Not read by
the running app.

| Variable | Default | Notes |
|---|---|---|
| `AGENT_USER` | `elias` | Default username for `add-agent`. |
| `AGENT_PASS` | `test1234` | Default password. Change or override on real use. |
| `AGENT_EMAIL` | _(empty)_ | Optional. |

### Script-only

Read by helper scripts, not the app.

| Variable | Default | Notes |
|---|---|---|
| `BASE` | `http://localhost:3100` | Target URL for `bun run smoke` and `bun run seed:knowledge`. Point at a remote deployment to test it. |
| `SKIP_SSE` | _(off)_ | Set to skip the SSE check in `bun run smoke`. |

### Example production `.env`

```bash
# --- app ---
APP_URL=https://support.yourdomain.com

# --- Parse (change the master key!) ---
PARSE_ID=helpbites
PARSE_MASTER_KEY=<64+ random chars>
PARSE_SERVER_DATABASE_URI=mongodb://sb-mongo:27017/helpbites
# PARSE_URL / REDIS_URL / MEILI_URL are injected by docker-compose — leave unset.

# --- Meilisearch (strong key; the endpoint may be public) ---
MEILI_MASTER_KEY=<32+ random chars>
# The app's scoped key, from `docker compose exec app bun scripts/meili-key.mjs` after the first deploy.
MEILI_API_KEY=<printed key>

# --- Embeddings: run locally on CPU (default). To offload:
# EMBEDDING_ENDPOINT=https://embeddings.yourdomain.com/v1/embeddings
# EMBEDDING_API_KEY=...
# ...or go lexical-only:
# KNOWLEDGE_DISABLE_EMBEDDINGS=1

# --- S3 (example: AWS) ---
S3_ENDPOINT=s3.eu-west-1.amazonaws.com
S3_USE_SSL=true
S3_ACCESS_KEY=<key>
S3_SECRET_KEY=<secret>
S3_BUCKET=help-bites-prod
S3_PUBLIC_URL=https://help-bites-prod.s3.eu-west-1.amazonaws.com
S3_REGION=eu-west-1
S3_SET_PUBLIC_POLICY=false   # manage the bucket policy in AWS yourself

# --- Email (optional) ---
MAILGUN_API_KEY=<key>
MAILGUN_DOMAIN=mg.yourdomain.com
MAILGUN_API_BASE_URL=https://api.eu.mailgun.net
MAILGUN_FROM_EMAIL=support@yourdomain.com

# --- AI auto-reply (optional) ---
# LITELLM_API_BASE_URL=https://llm.yourdomain.com
# LITELLM_API_KEY=<key>
# LLM_DEFAULT_MODEL=mimo-pro-v2

# --- Native push (optional) ---
# APNS_KEY_ID=...
# APNS_TEAM_ID=...
# APNS_BUNDLE_ID=com.helpbites.operator
# APNS_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
# APNS_ENV=production
```

Generate secrets with, e.g.:

```bash
openssl rand -base64 48
```

---

## External services

You can run everything in the provided Compose file, or point HelpBites at
managed services. Mix and match.

### MongoDB

Provided as `sb-mongo` (Mongo 7). To use a managed Mongo (Atlas, etc.) instead,
drop `sb-mongo` and set `PARSE_SERVER_DATABASE_URI` to your connection string.
Parse needs `disableIndexFieldValidation` (the compose sets this via
`PARSE_SERVER_DATABASE_OPTIONS`) so the schema script can declare indexes on
Mongo's own key names.

### S3 storage

Any S3-compatible bucket works. Two common setups:

**Self-hosted** (RustFS/MinIO/Garage — the dev overlay bundles RustFS on
`localhost:9000`):

```bash
S3_ENDPOINT=localhost
S3_PORT=9000
S3_USE_SSL=false
S3_ACCESS_KEY=rustfsadmin
S3_SECRET_KEY=rustfsadmin
S3_BUCKET=help-bites
S3_PUBLIC_URL=http://localhost:9000/help-bites
```

**AWS S3** — omit `S3_PORT`, use SSL, set the region, and manage the bucket
policy yourself:

```bash
S3_ENDPOINT=s3.eu-west-1.amazonaws.com
S3_USE_SSL=true
S3_BUCKET=help-bites-prod
S3_PUBLIC_URL=https://help-bites-prod.s3.eu-west-1.amazonaws.com
S3_REGION=eu-west-1
S3_SET_PUBLIC_POLICY=false
```

The bucket is created on first use if missing. On non-AWS providers, the app also
applies a public-read policy unless `S3_SET_PUBLIC_POLICY=false`.

**Bundled RustFS** (`--profile rustfs`) — if you don't want to run an external
bucket, the compose can bring up a [RustFS](https://rustfs.com) instance
alongside the app. It's **off by default**; the app uses your external S3 unless
you opt in. Enable it and point `S3_*` at it:

```bash
# start the stack with RustFS included
docker compose --profile rustfs up -d
```

```bash
# .env — use the bundled bucket
S3_ENDPOINT=sb-rustfs
S3_PORT=9000
S3_USE_SSL=false
S3_ACCESS_KEY=<pick one>          # sb-rustfs reuses these two
S3_SECRET_KEY=<pick a strong one> # (default rustfsadmin — change it)
S3_BUCKET=help-bites
S3_PUBLIC_URL=https://files.yourdomain.com   # a URL browsers can reach — see below
```

Notes:

- **`sb-rustfs` and the app share `S3_ACCESS_KEY` / `S3_SECRET_KEY`.** Set them
  once; RustFS boots with those credentials and the app authenticates with them.
- **`S3_PUBLIC_URL` must be browser-reachable.** `sb-rustfs` only `expose`s its
  ports on the internal network (like every other service here), so
  `http://sb-rustfs:9000` works app→storage but not from a browser. Attach a
  domain to `sb-rustfs` → **9000** (Dokploy Domains tab) and set `S3_PUBLIC_URL`
  to it. The console is on **9001** if you want a UI.
- **Data lives in four named volumes** (`rustfs-data-0…3`). RustFS runs as UID
  10001 and enforces a 4-path disk layout, so a one-shot `sb-rustfs-init`
  container pre-owns the volumes before it starts. This mirrors RustFS's own
  single-node reference compose — back up these four volumes like any other state.
- In production there's no published port for `sb-rustfs`; the dev overlay
  (`docker-compose.dev.yml`, `--profile dev`) publishes **9000/9001** on
  `localhost` for local use.

### Meilisearch

Provided as `sb-meili` (v1.53). `bun run search:setup` (and the boot entrypoint)
creates the indexes, settings, and the userProvided embedder. If you expose it
publicly, set a strong `MEILI_MASTER_KEY`. To use Meilisearch Cloud, set
`MEILI_URL` and `MEILI_MASTER_KEY` and drop the `sb-meili` service.

The app shouldn't hold the master key, which can mint keys and delete every
index. Give it a scoped one:

1. `docker compose exec app bun scripts/meili-key.mjs` (locally: `bun run
   search:key`). It creates the app's key, limited to the `knowledge`,
   `conversations` and `endusers` indexes and the actions the app uses, and
   prints it. Re-running prints the same key.
2. Put `MEILI_API_KEY=<that key>` in `.env` and redeploy.
3. Uncomment `MEILI_MASTER_KEY: ""` under the `app` service in
   `docker-compose.yml` and redeploy again: the app container no longer carries
   the master key; `sb-meili` keeps it.

Until `MEILI_API_KEY` is set the app uses `MEILI_MASTER_KEY` and logs a warning.

### LLM endpoint (AI auto-reply)

Any OpenAI-compatible / LiteLLM endpoint. Set `LITELLM_API_BASE_URL`,
`LITELLM_API_KEY`, and `LLM_DEFAULT_MODEL`. Auto-reply stays off until a project
has an assistant with `autoReply` enabled — the env vars just make it *possible*.
Per-agent endpoint/key/model settings override the defaults. See
[docs/KNOWLEDGE.md](KNOWLEDGE.md) for how knowledge grounds the answers.

### Mailgun (email)

Set `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and `MAILGUN_FROM_EMAIL`. Pick the
region base URL (`MAILGUN_API_BASE_URL`). Without all three, email notifications
are simply skipped and the send API answers 503 — the app runs fine.

For delivery status, set `MAILGUN_WEBHOOK_SIGNING_KEY` (Mailgun → Sending →
Webhooks → HTTP webhook signing key) and add `https://<your domain>/v1/webhooks/mailgun`
for delivered, opened, clicked, permanent and temporary failure, complaints and
unsubscribes, on every domain your projects send from. See
[docs/EMAIL.md](EMAIL.md#delivery-webhooks).

### APNs (native push)

Only for the native operator app ([helpbites-native](../helpbites-native/)).
Create an APNs auth key in your Apple developer account and set the `APNS_*`
group. Push stays disabled until these are present.

---

## First run

1. **Create the first operator.** Open `APP_URL` — a fresh install shows a
   sign-up form. That first sign-up becomes the first operator, so set
   `SETUP_TOKEN` (the form then asks for it) or finish it straight after
   deploying: until then anyone who finds the URL can claim the instance. (Add
   teammates later from the Team page, or
   `docker compose exec app bun scripts/add-agent.mjs`.) Admin API keys act as
   their owner, expire after 90 days unless you choose otherwise, and are
   revoked with a password reset. Changing an account's email asks for the
   password and tells the old address, and Parse locks an account for 15
   minutes after ten wrong passwords.
2. **Create a project.** Panel → Projects → New project. You get a public key
   (`pk_…`) and a secret (`sk_…`). Set the site URL, allowed widget origins, the
   reply name, and notification emails.
3. **Add knowledge (optional).** Upload a `SUPPORT_FAQ.md`, review detected FAQs,
   organize them, and assign them to an assistant. See [docs/KNOWLEDGE.md](KNOWLEDGE.md).
4. **Connect your app.** Mint identity tokens on your backend and drop in the
   widget (or use the API directly). Full walkthrough:
   [docs/CONNECTING.md](CONNECTING.md). Interactive API reference lives at
   `APP_URL/_docs/scalar`.

Mint a test token against a running deployment without writing any host code:

```bash
bun scripts/dev-token.mjs <projectId> <userId> "Demo user" demo@example.com
```

---

## Operations

### Schema migrations

There is no manual migration step. The `app` container runs
`ensure-schema.mjs --apply` on **every boot**: it creates missing classes,
adds missing fields, and re-asserts CLPs and indexes. Existing data is
preserved. To preview pending changes without applying (exits `2` when work is
pending):

```bash
bun run schema
```

### Backups

All durable state is in named Docker volumes. Back these up:

| Volume | Contains |
|---|---|
| `mongo-data` | **Everything** — conversations, projects, users, knowledge. The critical one. |
| `meili-data` | Search index. Rebuildable with `bun run reindex` + re-indexing knowledge. |
| `redis-data` | Ephemeral (SSE/rate limits). Safe to lose. |
| `model-cache` | Downloaded embedding model. Re-downloads if lost. |

Plus your **S3 bucket** (attachments + knowledge docs) — back that up with your
provider's tooling. Example Mongo dump:

```bash
docker compose exec sb-mongo mongodump --db helpbites --archive > helpbites-$(date +%F).archive
```

Restore into an empty database with the stack stopped except Mongo:

```bash
docker compose up -d sb-mongo
docker compose exec -T sb-mongo mongorestore --db helpbites --archive --drop < helpbites-2026-01-31.archive
docker compose up -d
```

A nightly dump from cron is enough for most installs:

```cron
0 3 * * * cd /opt/helpbites && docker compose exec -T sb-mongo mongodump --db helpbites --archive | gzip > /var/backups/helpbites-$(date +\%F).archive.gz
```

### Rebuilding the search index

If Meili data is lost or you want to backfill:

```bash
bun run search:setup   # recreate indexes + settings
bun run reindex        # backfill conversations / end-users / FAQs (lexical)
```

Knowledge FAQs re-embed as they're reindexed (unless embeddings are disabled).

### Scaling out

Run multiple `app` replicas behind your load balancer — SSE fan-out goes through
Redis pub/sub, so a client connected to replica A still gets events from a write
on replica B. Rate limits are shared through Redis. If you scale the app, prefer
`EMBEDDING_ENDPOINT` (a shared embeddings service) over each replica caching the
model. Mongo, Redis, and Meili remain single logical instances (or their own
managed clusters).

### Health checks

Mongo, Parse, Redis and `app` have a healthcheck; `app` waits for `sb-parse` and
`sb-redis` to be healthy before starting. `GET /v1/health/live` only says the process
is up (the container healthcheck uses it). `GET /v1/health` also checks Parse, Redis,
Meilisearch, S3 and the worker: point your uptime monitor at that one.

### Logs

```bash
docker compose logs -f app          # the app
docker compose logs -f sb-parse     # data layer
docker compose logs --tail=100 app  # recent
```

---

## Verifying a deployment

The smoke test drives a real conversation end-to-end (auth, messages,
attachments, SSE) against a running app. Point `BASE` at your deployment:

```bash
BASE=https://support.yourdomain.com bun run smoke
```

If SSE can't be reached from where you run it (e.g. through a strict proxy), skip
just that check:

```bash
SKIP_SSE=1 BASE=https://support.yourdomain.com bun run smoke
```

Pure-logic unit tests (no running stack needed):

```bash
bun test
```

Quick manual checks:

- `APP_URL/` loads the landing page.
- `APP_URL/_docs/scalar` renders the API docs.
- Sign-up creates an operator; the panel loads at `/inbox`.
- Send a widget/API message and confirm it appears live in the panel (SSE works).

---

## Upgrades

Read [CHANGELOG.md](../CHANGELOG.md) first. Plain Compose pulls the new image; the
entrypoint reconciles the schema on boot:

```bash
git pull                 # new compose file and Caddyfile, if any
docker compose pull
docker compose up -d
```

Pin a release with `HELPBITES_VERSION=0.1.0` in `.env` (default `latest`). To roll
back, set the previous version and run `docker compose up -d` again. Back up first:
a rollback does not undo a schema change. Building from source instead: add
`-f docker-compose.build.yml` and `--build`. On Dokploy, redeploy.

Volumes persist, so data carries over. The schema script patches the DB forward
automatically. To also pull newer service images (Mongo/Parse/Redis/Meili),
bump the pinned tags in `docker-compose.yml` deliberately and:

```bash
docker compose pull && docker compose up -d
```

> Service image tags are pinned on purpose (`mongo:7`, `parse-server:9.10.0`,
> `redis:7-alpine`, `meilisearch:v1.53.2`). Upgrade them one at a time and test —
> Parse and Meili occasionally have breaking changes between majors.

### Upgrading to workspaces

Versions from before workspaces upgrade on their own, on the first boot of the
new image:

- Everything moves into one workspace (`DEFAULT_WORKSPACE_NAME`). The oldest
  operator becomes its owner and every other operator an admin, which is the
  access everyone had before.
- Error-tracker settings move from the install into the workspace.
- Search documents gain their workspace id in place. Nothing is re-embedded.
- The panel looks the same with one workspace: the switcher only appears once
  there is a second.
- API keys keep working and now belong to that workspace.

The migration is idempotent; running it again changes nothing. Two things now
need a setting that did not before:

- An assistant's LLM endpoint or an error-tracker URL typed into the panel that
  points at a private address (a LiteLLM or GlitchTip next to the app) needs
  `ALLOW_PRIVATE_NETWORK=1`.
- Outbound requests to those URLs now connect to the exact address that passed
  the safety check. Behind an HTTP proxy that allows hosts by name, they will be
  refused (the proxy is asked for an IP). No proxy is set by default.

---

## Licensing notes for the services

HelpBites itself is AGPL-3.0 (and `ee/` commercial; see [EDITIONS.md](EDITIONS.md)).
The services it runs next to have their own licenses, which matter mostly if you
offer HelpBites as a service:

| Service | License | What it means here |
|---|---|---|
| Parse Server | Apache-2.0 | No restrictions. |
| MongoDB Community | SSPL | Fine as the private database of your service. It restricts offering MongoDB *itself* as a service. |
| Redis 7.4+ | RSALv2 / SSPL | The base compose pins `redis:7-alpine`. The hosted overlay uses **Valkey 8** (BSD), the community fork. |
| Meilisearch Community | MIT | No restrictions. |
| RustFS | Apache-2.0 | No restrictions. |
| GlitchTip | MIT | Fine to offer to customers. |
| Bugsink | PolyForm Shield | Fine for your own error tracking. Don't offer it to customers as part of a hosted service. The cloud edition does not give tenants the server's Bugsink. |

---

---

## Troubleshooting

**App can't reach Parse / "master key rejected".** Parse 7+ refuses the master
key from non-loopback addresses unless allow-listed. The compose allows the
stack's own subnet (`SB_INTERNAL_SUBNET`, `10.213.0.0/24` by default) — keep it, and
keep the app on `PARSE_URL=http://sb-parse-internal:1337/parse`: that name exists only
on the stack's network. The plain `sb-parse` can resolve to Dokploy's shared network
once the service has a domain, and a call from there is outside the subnet. Parse logs
`masterKeyIps` when it refuses one. Also confirm `PARSE_ID` and `PARSE_MASTER_KEY`
match between the app and `sb-parse`.

**A maintenance script run from your laptop gets `403 unauthorized`.** The same rule: your IP is
outside the allow-list. Prefer `docker compose exec app bun scripts/<name>.mjs`. To run it from
your machine instead, set `PARSE_MASTER_KEY_EXTRA_IPS=<your public IP>` and `PARSE_TRUST_PROXY=1`
(one proxy, Traefik; use `2` behind Cloudflare too) on the stack, redeploy, and unset both when done.

**Services resolve to the wrong container.** On a shared network, use the `sb-`
prefixed names (`sb-parse`, `sb-redis`, `sb-mongo`, `sb-meili`). A bare `parse`
or `redis` may resolve to another project's service.

**"Unsupported device" on boot / embeddings.** `ICON_EMBEDDING_DEVICE` must be
`cpu` (default) or `cuda` (Linux + GPU). `wasm`/`webgpu` are browser-only. To
avoid the model entirely, set `KNOWLEDGE_DISABLE_EMBEDDINGS=1` or point
`EMBEDDING_ENDPOINT` at a remote service.

**Slow first boot.** The local embedding model downloads on first use and caches
to `TRANSFORMERS_CACHE` (`/models` volume). Subsequent boots are fast. Disable
embeddings or use a remote endpoint to skip the download.

**Attachments/knowledge uploads fail with an S3 error.** `S3_ENDPOINT`,
`S3_ACCESS_KEY`, and `S3_SECRET_KEY` must all be set. On AWS, set
`S3_SET_PUBLIC_POLICY=false` and manage the bucket policy yourself (the app can't
set a public policy on a locked-down AWS bucket). Confirm `S3_PUBLIC_URL`
actually resolves to the bucket from a browser.

**Search returns nothing / degraded.** If Meili is down the app falls back to a
Parse keyword scan — functional but not hybrid. Check `sb-meili` health and
`MEILI_URL`. Run `bun run search:setup` then `bun run reindex`.

**Live updates lag or arrive in bursts.** Your proxy is buffering SSE. Disable
response buffering on `/v1/events` (`proxy_buffering off` in nginx; Caddy is fine
by default) and allow long read timeouts.

**Meili rejects requests / 403.** In production it needs a key: the app sends
`MEILI_API_KEY`, or `MEILI_MASTER_KEY` when that is unset. A scoped key made for
another master key (the master key changed) is refused; run `meili-key.mjs`
again with the current one. With only the master key, make sure the same value
is set for both `sb-meili` and the app.

**Email never sends.** All three of `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`,
`MAILGUN_FROM_EMAIL` must be set, and `MAILGUN_API_BASE_URL` must match your
Mailgun region (EU vs US).

---

## Security checklist

Before you expose a deployment:

- [ ] Changed `PARSE_MASTER_KEY` from the default to a long random value.
- [ ] Changed `MEILI_MASTER_KEY` (especially if `sb-meili` has a public domain), and gave the app a scoped `MEILI_API_KEY`.
- [ ] Set `SETUP_TOKEN` before the first visit, so only you can create the first operator.
- [ ] Changed `S3_SECRET_KEY` (RustFS reuses it as its root credential if self-hosting).
- [ ] `APP_URL` is your real HTTPS origin; TLS terminated by Dokploy/proxy.
- [ ] Did **not** attach a public domain to `sb-parse` unless you need it.
- [ ] Set restrictive **allowed widget origins** on each project (the widget only
      loads from listed origins; anything else gets no token).
- [ ] Project **secrets (`sk_…`) live only on your backend** — never shipped to a
      browser. Rotate from the project page if one leaks.
- [ ] The dev overlay (`docker-compose.dev.yml`) and the `parse-dashboard`
      service are **not** running in production. Use the bundled RustFS in prod
      via `--profile rustfs` (not the dev overlay), so it isn't published on
      `localhost` with dev-default credentials.
- [ ] Backups configured for `mongo-data` and your S3 bucket.
- [ ] On AWS S3, `S3_SET_PUBLIC_POLICY=false` and the bucket policy scoped to
      exactly what attachment serving needs.
- [ ] `ALLOW_PRIVATE_NETWORK` is off unless something the panel calls really
      lives on your private network.

---

Related docs: [Editions](EDITIONS.md) · [Connecting an app](CONNECTING.md) ·
[Knowledge & AI assistants](KNOWLEDGE.md) · API reference at `APP_URL/_docs/scalar`.
