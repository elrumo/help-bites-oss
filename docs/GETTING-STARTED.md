# Getting started

> **HelpBites is in public beta.** It runs in production for its author and every feature in these docs is on `main`,
> but expect rough edges, take a backup before you upgrade ([Self-hosting → Upgrades](DEPLOYMENT.md#upgrades)), and
> read the [release notes](../CHANGELOG.md) first. Found a bug? [Open an issue](https://github.com/elrumo/help-bites-oss/issues).

This is the shortest path from nothing to a working support inbox, feedback board and changelog. It takes about ten
minutes, plus whatever DNS needs. You need Docker with the Compose plugin and a machine to run it on. Nothing else.

## 1. Start it

```bash
git clone https://github.com/elrumo/help-bites-oss.git && cd help-bites-oss
scripts/install.sh                 # a trial on this machine: http://localhost:3100
docker compose up -d               # pulls elrumo/helpbites from Docker Hub
```

`install.sh` writes a `.env` with freshly generated secrets. For a real server pass your domain
(`scripts/install.sh help.example.com`), point `help.example.com` and `files.help.example.com` at the server first, and the
bundled Caddy gets the HTTPS certificates. The first boot takes a minute or two: the app creates its schema, runs the
migrations and loads the search model. Watch it with `docker compose logs -f app`, and check
`curl http://localhost:3100/v1/health` answers `"ok": true`.

The image is on [Docker Hub](https://hub.docker.com/r/elrumo/helpbites) (`elrumo/helpbites`) and
[GHCR](https://github.com/elrumo/help-bites-oss/pkgs/container/helpbites). Tags: `latest` (the newest release), `0.2.0`
(one release, pin it with `HELPBITES_VERSION=0.2.0` in `.env`) and `edge` (every push to `main`, for the curious).
Other ways to host it (Dokploy, your own proxy, split web and worker containers) are in [Self-hosting](DEPLOYMENT.md).

## 2. Create the first operator

Open the site. A fresh install asks you to create the first operator account; whoever does so first owns the instance,
so do it straight away (or set `SETUP_TOKEN` in `.env` and the form asks for it). That also creates your workspace.
Invite teammates later from **Settings → Team**.

Want to look around before you install anything? The [demo](https://helpbites.app/demo) (`/demo` on any HelpBites site) is the panel with sample data and no sign-in.

## 3. Create a project

A **project** is one of your apps or sites: its own inbox, feedback board, roadmap, changelog, knowledge and email.
**Projects → New project** gives you a public key (`pk_…`, safe in a page) and a secret (`sk_…`, for your server only).
Set the site URL and the origins that may load the widget.

The project's **Overview** carries a setup checklist: which parts HelpBites has seen working (the widget loading on your
site, a signed token arriving, mail that can go out, an assistant that is live) and which still need you. Each row opens
the page that fixes it.

## 4. Put it on your site

The one-line version, a floating chat on any page:

```html
<script src="https://YOUR-HELPBITES/widget.js" data-project="pk_…" defer></script>
```

The feedback board, roadmap and changelog are one script tag each (`/feedback.js`, `/changelog.js`), or one
`/helpbites.js` that adds whatever the project has switched on. If your app has signed-in users, sign an identity token
on your server so conversations belong to the right person: [Connect your app](CONNECTING.md) has the Node, Python and
curl versions and the Web and Swift snippets. Everything the panel does is also an API (`/_docs/scalar` on your instance).

## 5. Switch on the rest

Out of the box you have the inbox, feedback board, roadmap, changelog, knowledge base, onboarding, forms, legal
documents and pricing tables. These need an account or a key of yours, and each is optional:

| You want | You need | Guide |
|---|---|---|
| AI replies, drafts, titles, translations | An API key from any OpenAI-compatible provider | [Set up AI](SETUP.md#ai) |
| Email to your users (replies, notifications, campaigns) | A Mailgun account | [Set up email](SETUP.md#email) |
| Customers emailing `support@yourdomain` into the inbox | Mailgun, one DNS record or a forward | [Inbound email](INBOUND-EMAIL.md) |
| Commits and pull requests linked to the board, changelog drafted from pushes, AI error notes that read your code | A GitHub App | [Connect GitHub](SETUP.md#github) |
| Attachments and images | An S3-compatible bucket (a bundled one is available) | [Set up storage](SETUP.md#storage) |
| Error tracking with alerts | GlitchTip or Bugsink next to the app | [Set up error tracking](SETUP.md#error-tracking) |
| Revenue and plan next to each conversation | A Stripe (or other) key | [Revenue](REVENUE.md) |
| An assistant (Claude, Cursor, ChatGPT) working in your workspace | Nothing extra | [MCP](MCP.md) |
| The iPhone, iPad and Mac app | An Apple developer account to build it | [Native app](DEVELOPMENT.md#the-native-app) |

All of them are in [Setting things up](SETUP.md), with what to click and how to tell it worked.

## Next

- Teach the assistant your product: [Knowledge](KNOWLEDGE.md).
- Publish what you ship: **Project → Changelog**, or `helpbites changelog` from your repo ([the CLI](../cli/README.md)).
- Make the embeds yours: [Brand kit](BRAND.md) and [Styling](STYLE.md).
- Back it up and keep it current: [Self-hosting → Backups](DEPLOYMENT.md#backups) and [Upgrades](DEPLOYMENT.md#upgrades).
- Hack on it: [Development](DEVELOPMENT.md).
