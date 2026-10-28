# Setting things up

HelpBites runs with nothing but Docker ([Getting started](GETTING-STARTED.md)). Everything below is optional and
independent: switch on what you need, in any order. Each section says what you need, what to do, and how to tell it
worked. The deep guides are linked from each, and every environment variable is in the
[reference](DEPLOYMENT.md#environment-reference).

Where a setting can be made in the panel or in `.env`, the panel is the easy way and `.env` is the way for a whole
server. After editing `.env`, restart with `docker compose up -d`.

| | Needs | Without it |
|---|---|---|
| [AI](#ai) | An API key from an OpenAI-compatible provider | No AI replies, drafts, titles or translations; the AI buttons answer "no AI provider" |
| [Email](#email) | A Mailgun account and a domain | No mail to users; the send API answers `503`; the panel still works |
| [Inbound email](#inbound-email) | Mailgun | Conversations start from the widget and API only |
| [GitHub](#github) | A GitHub App you register once | No repo linking, commit-driven changelog or code-aware error notes |
| [Storage](#storage) | An S3-compatible bucket | No image or file uploads (`install.sh` bundles one) |
| [Search and knowledge](#search-and-knowledge) | Nothing (bundled) | Always on; the model is tunable |
| [Error tracking](#error-tracking) | GlitchTip or Bugsink | No Errors page |
| [Revenue](#revenue) | A Stripe, App Store, RevenueCat, Paddle or Lemon Squeezy key | No revenue beside conversations |
| [Custom domains](#custom-domains) | A DNS record per domain | Public pages live on your HelpBites host |
| [Push notifications](#push-notifications) | An Apple developer account | The native app works without push |
| [An AI assistant over MCP](#assistants-and-api-keys-mcp) | Nothing | — |

## AI

HelpBites speaks the OpenAI chat-completions protocol, so any provider with that API works: OpenAI, Anthropic and
Gemini (through their compatibility endpoints), OpenRouter, Mistral, Groq, xAI, DeepSeek, or a model you run yourself
(LiteLLM, Ollama, vLLM). You bring the key; the community edition never meters or limits it.

**In the panel (recommended).** *Settings → AI → Add a provider*:

1. Pick the provider. The endpoint fills in; choose **Custom** for your own server and type its URL.
2. Pick a model (type any model name your provider offers; the list is only suggestions).
3. Paste your API key. It is stored sealed and never shown again.
4. Optionally name an **Ultra** model, a stronger one used by the email designer's Ultra mode and other heavy jobs.
5. Press **Test**. A reply from the model means it works; an error shows the provider's message.
6. Save. With several providers, mark one active.

A model on your own network (a LiteLLM or Ollama next to the app) needs `ALLOW_PRIVATE_NETWORK=1` in `.env`, because the
panel refuses to point at private addresses by default.

**For the whole server.** Set `LITELLM_API_BASE_URL`, `LITELLM_API_KEY` and `LLM_DEFAULT_MODEL` in `.env`. Every
workspace then has an AI without adding a provider; a workspace's own provider still wins.

**Which one a call uses**, in order: the assistant's own endpoint (an assistant can bring its own endpoint, key and model, on its page under
*Assistants*), then the workspace's active provider, then the server's gateway.

**What uses it**: AI assistants that answer customers ([Knowledge](KNOWLEDGE.md)), reply drafts in the inbox, the AI chat
that turns pasted text into feedback posts or planning items, titles for planning items, changelog entries drafted from
commits and shipped work, error analysis, the email designer, blog editing and translations of forms and pages.

**An assistant that replies by itself** is a separate switch, on purpose. *Assistants → New assistant*, give it
knowledge, test it in the panel, and only then turn on auto-reply; its readiness list names what is still missing
(a provider, knowledge to read, an answer it got right).

Embeddings (how knowledge is searched) are separate and need no key: see [Search and knowledge](#search-and-knowledge).

## Email

HelpBites sends through [Mailgun](https://www.mailgun.com): replies to customers, notifications, verification codes,
changelog digests, campaigns and the transactional send API.

1. **Create a Mailgun account** and add a sending domain. Use a subdomain such as `mail.yourdomain.com` so your normal
   mail is untouched. Pick the EU or US region.
2. **Add the DNS records** Mailgun shows (SPF, DKIM, and optionally the tracking CNAME) at your DNS host, and wait for
   the domain to read *Verified*.
3. **Create an API key** (Mailgun → your name → *API security* → *Add new key*).
4. **Put it in `.env`:**

   ```
   MAILGUN_API_KEY=key-…
   MAILGUN_DOMAIN=mail.yourdomain.com
   MAILGUN_FROM_EMAIL=support@mail.yourdomain.com   # on that domain, so SPF and DKIM line up
   MAILGUN_API_BASE_URL=https://api.mailgun.net      # US; the default is the EU https://api.eu.mailgun.net
   ```

5. **Turn on delivery tracking** (so the email log learns about deliveries, opens, bounces and complaints, and bounces
   are suppressed automatically): Mailgun → *Sending* → *Webhooks* → copy the **HTTP webhook signing key** into
   `MAILGUN_WEBHOOK_SIGNING_KEY`, then add `https://YOUR-HELPBITES/v1/webhooks/mailgun` for *Delivered, Opened, Clicked,
   Permanent failure, Temporary failure, Spam complaints* and *Unsubscribes*. Do this for every domain a project sends from.
6. Restart, then open **Project → Email**. A strip across the top lists what is still missing and disappears when
   nothing is. Send yourself a test from a template, and check it in the **Log** tab.

Each project can send as itself (its own from name, address, sending domain and reply-to) under *Project → Email →
Settings → Sender*. Campaigns and sequences also need a postal address there, the law in most places.

Everything else (templates, variables, the designer, the API) is in [Email](EMAIL.md).

## Inbound email

Customers who write to `support@yourdomain.com` become conversations in the inbox, and your replies go back by email,
threaded. Needs Mailgun set up as above. Two ways, both in *Project → Email → Settings → Support email addresses*:

- **Forward your mailbox.** HelpBites gives you an alias; your existing mailbox forwards to it. No DNS changes.
- **Use your domain.** Point a subdomain's MX at Mailgun. The panel shows the records.

Either needs one Mailgun *Route* that forwards to HelpBites, and `INBOUND_DOMAIN` for the forwarding aliases. The
steps, with the values to paste, are in [Inbound email](INBOUND-EMAIL.md).

## GitHub

Connecting GitHub lets HelpBites **read** your repos (it never writes): AI error notes read the failing file,
*Changelog → From commits* drafts entries from commit messages, the legal wizard suggests documents from your
dependencies, and with the webhook on, `#12` in a commit or merged pull request links to board item 12 (and
`fixes #12` moves it to done).

There are two parts. The server owner registers a GitHub App once, then each workspace connects it.

**Once per server (about five minutes).** GitHub → *Settings → Developer settings → GitHub Apps → New GitHub App*:

1. Homepage URL is your `APP_URL`; Callback URL is `APP_URL/v1/github/callback`; tick *Request user authorization
   (OAuth) during installation*.
2. Optional but useful: tick *Active* on the webhook, set its URL to `APP_URL/v1/webhooks/github` and a secret.
3. Permissions: *Contents*, *Pull requests* and *Metadata*, all **read-only**. Subscribe to *Pull request* and *Push*.
4. Create the app, copy the App ID and Client ID, generate a client secret and a private key (`.pem`).
5. Put them in `.env`:

   ```
   GITHUB_APP_ID=…
   GITHUB_APP_SLUG=…
   GITHUB_APP_CLIENT_ID=…
   GITHUB_APP_CLIENT_SECRET=…
   GITHUB_APP_PRIVATE_KEY=…        # the .pem; literal \n is accepted
   GITHUB_APP_WEBHOOK_SECRET=…     # if you turned the webhook on
   HELPBITES_SECRET=…              # signs the install link (openssl rand -base64 48)
   ```

The screenshots, every field and the upgrade notes are in
[GitHub](GITHUB.md#registering-the-github-app-server-owner-once).

**Per workspace.** *Settings → GitHub → Connect GitHub*, install the app on your account or organisation and pick the
repos it may see. Then *Project → Settings → GitHub repos* picks the (up to 10) repos each project uses. Until the server
is set up, the GitHub tab says "GitHub isn't set up on this server".

Using GitHub to publish **your own** changelog from commits, from a script or a CI job rather than the panel, is the
[command-line tool](../cli/README.md).

## Storage

Attachments, images in changelog entries and posts, brand logos and exports go to an S3-compatible bucket.
`scripts/install.sh` already configures the bundled [RustFS](https://rustfs.com) one (`COMPOSE_PROFILES=rustfs`), so a
fresh install works. For production, decide where files live:

- **Keep the bundled bucket.** Back up its four volumes, and give `sb-rustfs` port `9000` a domain (the bundled Caddy
  does this as `files.<your domain>`). `S3_PUBLIC_URL` must be a URL browsers can reach.
- **Use your own** (AWS S3, Cloudflare R2, Backblaze, Garage, MinIO): set `S3_ENDPOINT`, `S3_PORT`, `S3_USE_SSL`,
  `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` and `S3_PUBLIC_URL`, and remove `rustfs` from `COMPOSE_PROFILES`.

Check it by attaching an image to a feedback post. The settings for AWS and for the bundled bucket are in
[Self-hosting → S3 storage](DEPLOYMENT.md#s3-storage).

## Search and knowledge

Nothing to do: Meilisearch is bundled and the app creates its indexes on boot. Knowledge search is hybrid (words and
meaning); the meaning half runs an embedding model on the CPU inside the app. Three choices if that is not what you want:

- Keep it (the default). First boot downloads the model, then it is cached on a volume.
- Offload it to an OpenAI-style embeddings service with `EMBEDDING_ENDPOINT` and `EMBEDDING_API_KEY`. Do this if you
  run more than one app container.
- Turn it off with `KNOWLEDGE_DISABLE_EMBEDDINGS=1` for faster boots and plain keyword search.

Before the app is public, set a strong `MEILI_MASTER_KEY`, then run `docker compose exec app bun scripts/meili-key.mjs`
and put the printed key in `MEILI_API_KEY`: the app then holds a key that can only do what it needs.

## Error tracking

Turn each project's errors into an **Errors** page with alerts and AI notes, through a [GlitchTip](https://glitchtip.com)
or [Bugsink](https://www.bugsink.com) you run next to HelpBites (both are Sentry-compatible, so your app uses its
normal Sentry SDK with a DSN HelpBites gives it).

1. Start the tracker: `COMPOSE_PROFILES=glitchtip` or `bugsink` (add to the list, comma separated), set its `*_SECRET_KEY`
   and, for GlitchTip, `GLITCHTIP_DB_PASSWORD`, and give it a public domain (`sb-glitchtip:8000` or `sb-bugsink:8000`):
   your app's SDK sends events there.
2. Create an API token in the tracker and enter it under *Connect error tracking* in the panel (or in `.env`).
3. Open *Project → Errors*, connect, and copy the DSN into your app's Sentry SDK.
4. *Alerts* emails you on new or frequent errors (needs [email](#email)); *Analyze with AI* needs [AI](#ai).

The bootstrap steps for each tracker, one tracker project per app, and the SDK snippets are in [Errors](ERRORS.md).

## Revenue

*Project → Revenue* shows MRR, plans, top customers and payments beside each conversation. Connect any mix of Stripe
(a restricted read-only key), RevenueCat, the App Store (an App Store Connect API key, which also unlocks TestFlight
numbers), Paddle, Lemon Squeezy or your own API. Each source is a form in the panel that explains the key it needs and
tests it: [Revenue](REVENUE.md).

## Custom domains

Serve a project's hub, feedback board, roadmap, changelog and blog from your own host (`feedback.example.com`): add the
host in the project's settings, create the TXT and CNAME records the panel shows, and press verify. The bundled Caddy
gets certificates only for verified hosts. With your own proxy you need the same two checks:
[Custom domains](CUSTOM-DOMAINS.md).

## Push notifications

Only for the native iPhone, iPad and Mac app. Create an APNs auth key (*Apple Developer → Keys*), and set
`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY` (the whole `.p8`) and `APNS_ENV` (`sandbox` for builds from
Xcode, `production` for TestFlight and the App Store). Building the app is in [Development](DEVELOPMENT.md#the-native-app).

## Assistants and API keys (MCP)

Nothing to install on the server. In *Settings → API keys* you create an `ak_…` key for scripts, or you connect Claude,
ChatGPT, Cursor or any MCP client to `https://YOUR-HELPBITES/mcp` and sign in with your browser; the assistant then acts
as you, in one workspace, and you can cut it off from the same page. [MCP](MCP.md) lists what it can do.

## Is it working?

- `GET /v1/health` reports each dependency (Parse, Redis, Meilisearch, the bucket, the worker).
- `GET /v1/meta` reports the version, the edition and whether sign-up is open.
- *Project → Overview* carries the setup checklist, judged from what HelpBites has actually seen.
- Something off? [Self-hosting → Troubleshooting](DEPLOYMENT.md#troubleshooting).
