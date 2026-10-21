# Moving between HelpBites instances

Export a whole workspace or a single project, and import it into another HelpBites: self-hosted to cloud, cloud to
self-hosted, or one self-hosted install to another. Import from a file you downloaded, or have your new HelpBites pull
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

## What stays behind

| Left out | Why | What to do |
| --- | --- | --- |
| Passwords, API keys, project secrets, webhook secrets | Credentials never go in an export | Each imported project gets a new secret; rotate it under the project's keys. Make new admin API keys. |
| Stripe, GitHub, Telegram, error-tracker and contact-database connections | Their credentials are not exported | Connect them again. |
| Team members and invitations | Accounts live on one instance | Invite the team again. |
| Uploaded files (message attachments, logos, brand assets, knowledge documents' originals) | They sit in the old instance's bucket | The text, FAQs and links come across; re-upload images you still need. |
| Campaigns and who is on a sequence | They could send again by themselves | Recreate the campaign from its template. Sequences come across **paused**; turn them on when ready. |
| Which operator replied or was assigned | Operators are accounts on the old instance | Messages keep their text and time; assignments are empty. |
| Sending domains, usage counters | Per instance | Set up the domain again. |

Your projects' **public keys** (`pk_…`) are kept when nothing on the new instance uses them, so the widget on your site
keeps working once you point it at the new address. If a key is taken, the project gets a new one and the import
summary says so.

## In the panel

**Settings → Workspace → Move to another HelpBites**

- **Download** gives you one `.jsonl.gz` file for the whole workspace. In a project's **Settings → Data** it is that
  project alone.
- **Import → From a file** takes a file from either of the above (or the workspace export that arrives by email).
- **Import → From another HelpBites** asks for its address and either an admin API key or a username and password. It
  lists the workspaces and projects it can see; pick everything or one project and start. You can close the page: the
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

Export a workspace, or one project, to a file:

```bash
curl -H "Authorization: Bearer ak_…" -o helpbites.jsonl.gz \
  "https://help.example.com/v1/admin/transfers/export"
curl -H "Authorization: Bearer ak_…" -o project.jsonl.gz \
  "https://help.example.com/v1/admin/transfers/export?project=PROJECT_ID"
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
  -d '{ "source": { "url": "https://old.example.com", "apiKey": "ak_…" }, "projectId": "PROJECT_ID" }'
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
# { "transfers": [{ "id", "source": "file|instance", "host", "scope", "status": "queued|running|done|failed",
#   "progress": { "className", "rows" }, "summary": { "rows", "skipped", "projects", "notes" }, "error", … }] }
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
each class after the ones it points at. Version 1 files (the earlier workspace export) import too. You can read it with
`zcat file | jq`.

## Self-hosting notes

- **File storage.** Importing a file stores it in your bucket (`S3_*`) while the job runs, then deletes it. Pulling from
  another instance needs no storage.
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
