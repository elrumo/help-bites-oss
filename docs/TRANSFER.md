# Moving between HelpBites instances

Export a whole workspace or a single project, and import it into another HelpBites: self-hosted to cloud, cloud to
self-hosted, or one self-hosted install to another. You choose how **uploaded files** travel (as links, or as the files
themselves) and whether **credentials and connections** come along. Import from a file you downloaded, or have your new HelpBites pull
everything straight from the old one in the background with a login for it.

Nothing is changed on the instance you export from, so you can try an import, check it, and switch your sites over when
you are ready.

## What moves

Everything you built and everyone who wrote in:

- projects and their settings (look, sender, allowed origins, board, changelog and legal options, feature flags)
- conversations, messages and the customers behind them (contacts, their segments, email suppressions)
- the knowledge base: models, folders, documents, FAQs, and which assistants use which
- assistants
- the feedback board with votes, comments and subscribers, and the project board
- the changelog: releases, entries, comments and subscribers
- legal documents with every version, and onboarding flows
- email templates, folders, components, the email log and AI chat history of each template
- sequences (see below), and error analyses
- brand kit, page and lead form file records, and Stripe payments and subscriptions
- with **credentials**: Stripe, revenue-source and contact-database connections, webhook endpoints with their secrets, each
  project's secret and webhook and error-tracker tokens, assistants' own API keys, template share links, and the
  workspace's own AI providers (see below)
- with **the files themselves**: message attachments, logos, brand and page files, lead form uploads, knowledge
  originals and email images

## Uploaded files

Files live in the bucket (`S3_*`), outside the database. Choose how they travel when you export or pull:

| Choice | `files=` | What happens |
| --- | --- | --- |
| **Links** (default) | `urls` | The rows keep the links they have, so images and attachments keep showing from the old storage. Small and fast, but the old bucket has to stay up. Files that are only reachable by key (lead form uploads, knowledge originals) are not carried: the row comes across without its file and the summary says so. |
| **The files** | `binary` | Every file the workspace's rows use goes inside the export (up to 100 MB each, only files under the workspace's own projects, models and templates). The importing instance stores them in its own bucket under `imports/<workspace>/`, counts them against storage and rewrites each link and key to the new copy. The export is much larger; importing it needs `S3_*` and `S3_PUBLIC_URL` on the new instance. |

The import follows the file: a file written with `binary` is restored as files, one written with links is left as links.
Restored files are served as the type they had if it is an image or a known document type, and as a plain download
otherwise (never as a page). A failed import removes the files it stored.

## Credentials and connections

Off by default. With **Include credentials and connections** (`secrets=1`) the export also carries what a person would
otherwise have to enter again: Stripe, RevenueCat/Apple/Paddle/Lemon Squeezy and contact-database connections, webhook
endpoints and their signing secrets, each project's secret and webhook and error-tracker tokens, assistants' own API keys
and the workspace's AI providers. They are written **in plain text** (they are sealed on the server with its
`HELPBITES_SECRET`, which the other instance does not have), so the file is as sensitive as the keys in it: move it over
a private channel and delete it afterwards. The importing instance seals them again with its own key. A project keeps its
secret when nothing else there uses it, so your server code keeps working; connections that sync (Stripe, contact
databases) start syncing on the new instance as soon as the import ends, and keep doing so on the old one until you
disconnect them there. The workspace's AI providers are only filled in when the new workspace has none and its plan
includes your own AI provider.

## What stays behind

A file made with **Download** or **Email me a link** carries these as well, so nothing the workspace held is missing
from the archive; an import reads what it can use and lists the rest as left out. A connection that was exported
without its credentials is left out of an import too, rather than coming in unable to connect.

| Left out of an import | Why | What to do |
| --- | --- | --- |
| Passwords, and the hashes of API keys and sessions | They belong to an account or session on one instance | Make new admin API keys. People sign in again. |
| GitHub and Telegram connections | The repos a project reads and the bot's webhook are registered per instance | Connect them again. |
| Team members and invitations | Accounts live on one instance | Invite the team again. |
| Campaigns and who is on a sequence | They could send again by themselves | Recreate the campaign from its template. Sequences come across **paused**; turn them on when ready. |
| Which operator replied or was assigned | Operators are accounts on the old instance | Messages keep their text and time; assignments are empty. |
| Custom domains, inbound addresses, sending domains, usage counters | Verified and routed per instance | Add them again where DNS points. |

Without **credentials**, also left out: Stripe, revenue and contact-database connections, webhook endpoints, project
secrets (each imported project gets a new one; rotate it under the project's keys) and the workspace's AI providers.

Your projects' **public keys** (`pk_…`) are kept when nothing on the new instance uses them, so the widget on your site
keeps working once you point it at the new address. If a key is taken, the project gets a new one and the import
summary says so.

## In the panel

**Settings → Workspace → Export and import**

- **Download** gives you one `.jsonl.gz` file for the whole workspace, **everything it holds**: besides what an import
  can use, the team list, usage counters and domains, so the file is also a complete archive. In a project's
  **Settings → Data** it is that project alone. Above it, choose whether uploaded files are links or included, and
  whether to include credentials.
- **Email me a link** makes the same file in the background and mails you a link that works for 7 days (the last one
  is also linked under the buttons). Use it for a workspace too big to download in one go. It needs file storage and
  mail on the server, and takes the same two choices; a file with credentials is a link to plain-text keys in your
  inbox, so tick it only when you mean it.
- **Import → From a file** takes a file from either of the above.
- **Import → From another HelpBites** asks for its address and either an admin API key or a username and password. It
  lists the workspaces and projects it can see; pick everything or one project, choose the same two options, and start. You can close the page: the
  import runs in the background and the list shows progress, then what came in and what was left out.

An import always **adds** new projects to the workspace you are in. It never overwrites, so importing twice gives you two
copies. If it fails for any reason, everything it had created is deleted again and the list says why. One import runs
at a time per workspace. You need to be an owner or admin on both sides.

The login you give is kept sealed until the import ends and then removed; a session made from a username and password
is signed out again. Prefer an admin API key: make a short-lived one (a few days) on the old instance and revoke it
afterwards.

## Plans (cloud)

Importing counts against the plan like creating the data by hand: projects, contacts, knowledge models, assistants and
FAQs are checked before they are created, and an import that would go over is refused whole. Legal documents and
sequences are left out (and listed) on a plan that does not include them. Exporting is never limited.

## The API

All `/v1/admin/transfers` calls take an operator session or an admin API key (`Authorization: Bearer …`), act in the
workspace named by `X-Workspace` (or the key's own), and need the owner or admin role. A key limited to some projects is
refused. They are in the OpenAPI reference under **Workspace**.

Export a workspace, or one project, to a file. It is everything the workspace holds; add `include=importable` for just
what another HelpBites can use (what **From another HelpBites** asks for):

```bash
curl -H "Authorization: Bearer ak_…" -o helpbites.jsonl.gz \
  "https://help.example.com/v1/admin/transfers/export"
curl -H "Authorization: Bearer ak_…" -o project.jsonl.gz \
  "https://help.example.com/v1/admin/transfers/export?project=PROJECT_ID"
# have it made in the background and mailed as a link (same two choices as a body)
curl -X POST -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{ "files": "urls", "secrets": false }' "https://help.example.com/v1/admin/workspace/export"
# the files themselves, and credentials and connections too
curl -H "Authorization: Bearer ak_…" -o everything.jsonl.gz \
  "https://help.example.com/v1/admin/transfers/export?files=binary&secrets=1"
```

Import a file into another instance (needs file storage there; up to 2 GB; send it as the body):

```bash
curl -X POST -H "Authorization: Bearer ak_…" -H "Content-Type: application/gzip" \
  --data-binary @helpbites.jsonl.gz "https://new.example.com/v1/admin/transfers/upload"
```

Or have the new instance pull from the old one (`projectId` is optional; leave it out for the whole workspace). Use
`apiKey`, or `login` and `password`:

```bash
curl -X POST "https://new.example.com/v1/admin/transfers" \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{ "source": { "url": "https://old.example.com", "apiKey": "ak_…" }, "projectId": "PROJECT_ID", "files": "binary", "secrets": true }'
```

Check a source first (lists its workspaces and projects, stores nothing):

```bash
curl -X POST "https://new.example.com/v1/admin/transfers/inspect" \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{ "url": "https://old.example.com", "login": "me@example.com", "password": "…" }'
```

Both import calls answer `202` with the queued import. Follow it:

```bash
curl -H "Authorization: Bearer ak_…" "https://new.example.com/v1/admin/transfers"
# { "transfers": [{ "id", "source": "file|instance", "host", "scope", "files": "urls|binary", "secrets", "status": "queued|running|done|failed",
#   "progress": { "className", "rows" }, "summary": { "rows", "skipped", "projects", "files", "notes" }, "error", … }] }
```

### Rules

- One import at a time per workspace (`409` otherwise); 10 imports and 20 source checks an hour (`429`); 20 exports an
  hour.
- Not idempotent by design: every import creates new projects. Delete a project you imported by mistake.
- All or nothing: a failed import deletes what it created. An import interrupted by a server restart cannot say what it
  created and is marked failed; delete the half-imported project and import again.
- The other instance must be a version that has `/v1/admin/transfers/export` (`404` otherwise: update it, or move a file
  from an older export, which imports the same way).
- This is an operator tool, not something to embed in a site, so there is no web snippet or Swift view for it. Build your
  own on the API above if you need one.

## The file

`.jsonl.gz`: gzip of JSON Lines. The first line is `{ "format": "helpbites-export", "version": 2, "scope":
"workspace|project", "workspaceId", "exportedAt" }`, then one `{ "class", "data" }` line per row, a class at a time and
each class after the ones it points at. Version 3 (written when files or credentials are included) adds `"files":
"urls|binary"`, `"fileBase"` (the old storage's public address) and `"secrets"` to that line, a `_WorkspaceSettings`
line, and `_File` lines (`key`, `index`, `last`, `headers` on the first, `b64`: a file in 4 MB pieces) ahead of the
rows that use them; a credential is `{ "$sealed": "plain text" }`. Versions 1 and 2 import too; an older HelpBites
refuses version 3. You can read it with `zcat file | jq`.

## Self-hosting notes

- **File storage.** Importing a file stores it in your bucket (`S3_*`) while the job runs, then deletes it. Pulling from
  another instance needs no storage, unless you pull the files themselves (`files=binary`), which also needs
  `S3_PUBLIC_URL`. Exporting the files themselves needs both on the instance you export from.
- **Keeping the original dates.** Parse only accepts a row's original creation time through its *maintenance key*. Set
  the same random value as `PARSE_SERVER_MAINTENANCE_KEY` on the Parse server (with `PARSE_SERVER_MAINTENANCE_KEY_IPS`
  covering the app, like `PARSE_SERVER_MASTER_KEY_IPS`) and as `PARSE_MAINTENANCE_KEY` on the app. Without it, rows get
  the time of the import and are created oldest first, so conversations keep their order, but dates read "today", and a
  single class may not exceed 250,000 rows.
- **Private networks.** Pulling from an instance on a private address (another box on your LAN) needs
  `ALLOW_PRIVATE_NETWORK=1` on the importing instance, as for any address you type in. Cloud and public hosts need
  nothing.
- **Search and knowledge.** Imported conversations and contacts are added to search, and each knowledge model is
  re-indexed in the background, so AI answers work a little after the import finishes.
