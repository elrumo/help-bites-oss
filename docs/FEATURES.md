# Features

Everything HelpBites does today, grouped by where you meet it. Each line
describes code that is on `main`; the link in brackets goes to the doc with the
detail. The machine-readable version is [features.json](../features.json), which
every feature change must update (see [CLAUDE.md](../CLAUDE.md)).

Sections 1–12 are in every build. Section 13 is the hosted edition only. See
[EDITIONS.md](EDITIONS.md). Section 14 lists what is not built yet.

## 1. Chat widget in your app

- **Floating bubble or a page of your app.** One script tag. Give it a container
  with `data-mode="inline"` and the same chat sits in your layout. [CONNECTING.md](CONNECTING.md)
- **Users never make an account.** Your server signs a one-hour token for the
  user who is already signed in. [CONNECTING.md](CONNECTING.md)
- **Page context.** Attach what the user is looking at (a page, a record, a
  link) and update it as they move. [CONNECTING.md](CONNECTING.md)
- **Images.** Paste or pick PNG, JPEG, GIF or WebP.
- **Messages.** Reply, unsend, react, and see read receipts. Retries are safe:
  a repeated `clientId` returns the message that already landed.
- **Live.** Messages arrive over server-sent events, not polling.
- **Launcher options.** Position (`data-position`), accent colour
  (`data-accent`), open and close from code, and `?sb=` links that open a
  conversation directly.
- **Build your own UI.** Every widget action is on the documented `/v1` API,
  in the OpenAPI docs at `/_docs/scalar`.
- **Feedback board embed.** One script (`feedback.js`) renders the board,
  roadmap, changelog, post pages and composer. [FEEDBACK.md](FEEDBACK.md)

## 2. Operator inbox

- **One inbox for every project.** Projects are colour-coded, with one unread
  count and filters for All, Mine, Unassigned, Open, Unread and Archived. Search by text.
- **Triage.** Assign a teammate, set priority (low, normal, high, urgent), add
  tags, and mark a conversation open or done. A customer who writes into a done
  conversation reopens it.
- **Archive and delete.** Archive a conversation to clear it from the queue; it
  waits in the Archived view and returns if the customer writes again. Delete
  removes it and every message for good.
- **Replies.** Reply as the team with images. The customer also gets it by
  email, unless the reply turns that off.
- **Internal notes.** Notes on the conversation timeline that the customer never
  sees.
- **Write first.** Start a conversation with a user, for example after a failed
  payment.
- **Unsend and react.** Delete a message, or add a reaction.
- **Customer context.** The user's record, their recent errors, and any board
  items or feedback posts linked to the conversation.
- **Email alerts.** Each project emails the addresses you choose when someone
  writes. Users who gave an address get replies by email, with a link back into
  the thread.
- **Live updates** over server-sent events, with read receipts.
- **Teammates.** Invite by email, with roles (section 9). Everyone works the same
  inbox.

## 3. Ticket types and actions

- **Support by default.** Every project has a `support` type. [CONNECTING.md](CONNECTING.md)
- **Your own ticket types.** Define statuses, intake fields and operator actions
  per type (`/v1/admin/projects/:id/types`). [CONNECTING.md](CONNECTING.md)
- **Filed from your backend.** `POST /v1/tickets` with the project secret, an
  idempotency key, and a reference to the thing the ticket is about.
- **Actions call back to your app.** An operator runs an action such as
  "delete". It can require an internal note. HelpBites then POSTs a payload
  signed with HMAC-SHA256 to your webhook. [CONNECTING.md](CONNECTING.md)

## 4. Knowledge base and AI assistants

**Knowledge base** [KNOWLEDGE.md](KNOWLEDGE.md)

- **Upload an FAQ.** A `.md`, `.markdown` or `.txt` file becomes a path tree of
  categories, questions and answers.
- **Review before import.** The preview shows new, duplicate and empty sections.
  Deselect or edit before you commit. A re-upload creates a new version.
- **Safe re-imports.** Matching is stable, so re-running never duplicates. Edited
  FAQs are protected. FAQs that vanished from the source are marked outdated,
  never deleted.
- **Edit in the panel.** An FAQ editor, a path tree you can move and rename, and a
  dashboard per model.
- **Search.** Hybrid keyword and vector search through Meilisearch. Without
  embeddings it falls back to keyword search.
- **Embeddings.** A local model by default, a remote OpenAI-style endpoint, or
  none.

**AI assistants** [KNOWLEDGE.md](KNOWLEDGE.md)

- **Per-project assistants.** A system prompt, a model, your own LLM endpoint,
  temperature, and a fallback behaviour. The API key is write-only.
- **Off by default.** Auto-reply is a switch on each assistant. When it is on,
  the assistant answers only from the knowledge it was given, and says so when it
  does not know.
- **Routing rules.** For each conversation type or keyword, decide AI or a human.
  Set a default action and a minimum confidence.
- **You decide what it sees.** Assign knowledge to an assistant by model, by
  path, or by single FAQ, with exclusions.
- **Test before you turn it on.** Test retrieval in the panel, or test answers
  over the API.
- **Workspace AI settings.** Bring your own LLM endpoint, with a connection test.
- **AI elsewhere.** The email designer (section 6), a cause-and-fix note on new
  errors (section 8), and the changelog CLI (section 11).

## 5. Feedback, roadmap and changelog

**Feedback board** [FEEDBACK.md](FEEDBACK.md)

- **Public board per project.** Users post ideas and bugs. Post types, platforms,
  tags and statuses are yours to define.
- **Statuses with meaning.** Each status belongs to a category (open, planned,
  active, done or closed). The category drives voting and the roadmap.
- **Votes, comments, reactions, @mentions.** Threaded comments. Reactions on posts
  and comments. Mention people in comments.
- **Moderation.** Hide, feature or lock a post. Pin a comment. Mark a duplicate
  or merge posts. Leave team-only notes.
- **Follow and get emailed.** Authors and commenters follow automatically.
  Followers hear about status changes, public comments and mentions. Anyone can
  mute or unfollow.
- **Panel views.** A list or a kanban. Edit posts and reply as the team.
  Configure statuses, types, tags and options in Settings.
- **Import an existing board.** Up to 100 posts per call, keeping votes, comments
  and numbers.

**Project board and roadmap** [FEEDBACK.md](FEEDBACK.md#board--roadmap)

- **Internal board.** Linear-style items on a kanban: title, Markdown description,
  status, priority, assignee, labels, target date and `#number`. Drag to move or
  reorder.
- **Links.** Connect an item to up to 50 feedback posts and 50 conversations.
  Votes add up across the linked posts.
- **Sync to feedback.** Optionally, moving an item into a status category moves
  its linked posts to the matching feedback status.
- **Public roadmap.** Items stay private until you publish them. A published item
  appears once it is planned, active or done, and shows only its public
  description. Layouts: columns, timeline or list. It has its own page at
  `/roadmap/pk_…` and can be embedded.

**Changelog** [FEEDBACK.md](FEEDBACK.md#changelog)

- **Entries and releases.** Entries are typed New, Improved, Fixed, Removed or
  Breaking, and group into versioned releases.
- **Review before publishing.** Approve or reject a draft. Nothing is public until
  it is published. Archive or merge entries.
- **Drafts from shipped work.** With auto-draft on, a done post or board item
  drafts an entry for you. Entries keep links to their sources in the panel, and
  the public changelog never shows those links.
- **Public changelog.** A page at `/changelog/pk_…`, plus JSON, a filtered flat
  list, and RSS.
- **Reader comments.** Opt-in. Only signed-in users can comment. Comments are
  Markdown and moderated.
- **Digest emails.** Readers subscribe to instant or weekly digests. Sign-up uses
  double opt-in, and every email has one-click unsubscribe.
- **Writable by script.** Batch, import and release-publish endpoints, plus the
  `helpbites changelog` CLI, which writes entries from git history
  ([cli/README.md](../cli/README.md)).

## 6. Email

**Design and templates** [EMAIL.md](EMAIL.md)

- **Block designer.** Headings, text, buttons, images, columns, sections, custom
  HTML and reusable components. Renders table-based HTML that holds up in Gmail,
  Apple Mail and Outlook.
- **Checks.** Flags a missing subject or preheader, missing alt text, low
  contrast, placeholder links, and tags that mail clients strip.
- **AI designer.** Turns pasted HTML into editable blocks, or edits on request.
  Each turn can be undone.
- **Shared masters.** One master design can be linked into many projects. Each
  project fills in its own brand and values. Detach to take a private copy.
- **Components library.** Reusable blocks with editable fields, shared across
  projects or kept to one.
- **Share, test, import, export.** Share a view or edit link, send test emails,
  import and export HTML or JSON, and use folders and starter templates.
- **Native editor.** The iPhone, iPad and Mac app has its own editor on the same
  design format.

**Sending** [EMAIL.md](EMAIL.md)

- **Send API.** `POST /v1/emails/send` with a template, your own HTML (inline or
  uploaded), a block document, or a plain message. It supports per-recipient
  variables, up to 50 recipients, CC and BCC, custom headers, tags, metadata,
  attachments, scheduled sends up to 72 hours ahead, idempotency keys, and a
  test mode.
- **Render and fetch.** Preview a send without sending it, or fetch a template
  rendered for your own mail provider.
- **Per-project sender.** Its own from name and address, sending domain, and
  reply-to.
- **Delivery log.** One entry per recipient, with a timeline kept current by
  Mailgun's delivery webhook. Stats by status, source and template. Log retention
  is configurable, and secret-looking values are redacted.
- **Suppressions.** Bounces, complaints and unsubscribes are suppressed
  automatically. Add or remove addresses by hand or through the API.

## 7. Contacts, segments and campaigns

**Contacts** [CONTACTS.md](CONTACTS.md)

- **One record per person.** Identified by your user id or by email, with
  attributes, tags, a subscription status, and a consent record.
- **Imports.** CSV in the panel, mapped in the browser. The batch API takes up to
  1,000 rows.
- **Sync from your database.** Reads Parse Server, Postgres or Supabase (read-only)
  and Firestore. Incremental when the table has an updated-at column. Runs every
  15 minutes to daily, or on demand.
- **Segments.** A rule builder (match all or any, on attributes, tags, dates and
  subscription) with a live count.
- **Erasure.** Deleting a person removes their conversations, feedback and email
  history.

**Campaigns and sequences** [MARKETING.md](MARKETING.md)

- **Broadcast campaigns.** Send a template to a segment or topic. Test, schedule
  or send now, then pause, resume or cancel. Opens and clicks update live.
- **Sequences.** Timed drip emails, started by a subscription, an event from your
  app, or manual enrollment.
- **Sign-up forms.** A hosted page or a plain HTML form, with double opt-in, a
  honeypot field and rate limits.
- **Preferences page.** Topics, unsubscribe from all, and resubscribe.
- **Compliance by default.** Campaigns require an unsubscribe link and a postal
  address, and send RFC 8058 one-click unsubscribe headers.
- **Event webhook.** Signed notifications when a subscription or suppression
  changes.

## 8. Errors and feature flags

**Error tracking** [ERRORS.md](ERRORS.md)

- **Connect GlitchTip or Bugsink.** HelpBites creates the Sentry-compatible project
  and DSN for you, and wires the alerts.
- **Browse and triage.** The Errors page lists issues; open one for its stack trace,
  event details, breadcrumbs and tags, and resolve or ignore it. Errors don't create
  inbox conversations.
- **Alert rules.** Email the team when an error is new, passes a total, or happens
  N times within a time window.
- **Fix with AI.** Analyze an error for cause and fix (reading the stack-trace files
  from the project's GitHub repos), or copy the same context as a prompt for a
  coding agent (the analysis needs an LLM endpoint).
- **Customer errors.** A customer's recent errors show alongside their
  conversation.

**Feature flags** [FLAGS.md](FLAGS.md)

- **Three states.** Off, on, or admins only, with an allow list of users or
  emails.
- **Fallbacks.** Each flag has a value your app uses when HelpBites cannot be
  reached.
- **Targets.** Tag flags for frontend, backend or iOS, and each client asks only
  for its own.
- **Read from anywhere.** Your server reads the full list with the secret. A
  browser reads its own evaluated values with an identity token or the public key.

## 9. Teams, accounts and workspaces

- **First run.** On a self-hosted install, the first visitor creates the operator
  account. Teammates come from the panel. [README](../README.md)
- **Roles.** *Agent* answers the inbox and edits content. *Admin* also runs
  projects, assistants, marketing, the team, API keys, settings and export.
  *Owner* also handles billing, deleting the workspace, and other owners.
  ([shared/roles.ts](../shared/roles.ts))
- **Invitations.** Invite by email, and accept at the link you receive.
- **Workspaces.** Several per account, switchable from the sidebar.
- **Workspace settings.** AI provider, data export (a download link), and
  workspace deletion for owners.
- **Accounts.** Edit your name and email, reset your password by email, choose
  light, dark or system theme, and sign out.
- **Admin API keys.** Create, rename and revoke `ak_…` keys for scripts and tools.
- **Projects.** Create a project, then set its site URL, allowed widget origins,
  reply name, notification addresses, accent colour and logo. See and rotate its
  secret. An overview page summarises it. [CONNECTING.md](CONNECTING.md)

## 10. Native apps (iPhone, iPad, Mac)

[helpbites-native/README.md](../helpbites-native/README.md)

- **One SwiftUI app.** Tabs on iPhone, a sidebar on iPad, and Mac via Catalyst.
- **Inbox.** Conversations, replies with images, status, deleting a message, and
  starting a new conversation.
- **Most of the panel.** Projects and their settings, team, API keys, the developer
  page, contacts, knowledge, assistants, tickets, feedback, board, the email editor
  with its AI designer, email log and suppressions, campaigns, flags, and errors.
- **Push notifications.** A new customer message can notify the device. This needs
  Apple push (APNs) credentials on the server.
- **Keyboard shortcuts** on iPad and Mac, and a ⌘K palette.

## 11. Developer platform

- **Documented REST API** under `/v1`, with OpenAPI docs at `/_docs/scalar`.
- **Four ways in.** The project secret (server only), the public key (browser
  reads), an identity token (one user), and an admin API key (operators and tools).
  [CONNECTING.md](CONNECTING.md)
- **Realtime streams.** Server-sent events for end users, operators, the feedback
  board, and shared email previews.
- **Webhooks.** A signed action webhook for ticket actions, a signed event webhook
  for contacts, Mailgun's delivery webhook, and the GlitchTip and Bugsink alert
  webhooks.
- **Idempotency.** Message sends and email sends accept idempotency keys.
- **Health checks.** `/v1/health` and `/v1/health/live`.
- **Embed scripts.** `widget.js` and `feedback.js`, both MIT-licensed, so the site
  that embeds them carries no copyleft obligations.
- **CLI.** `helpbites changelog` turns git changes into changelog entries. It never
- **Moving between instances.** Download a workspace, or one project, as a portable
  file; import a file; or pull straight from another HelpBites (self-hosted or
  cloud) with an API key or a login. Runs in the background, adds new projects,
  keeps public keys, and is all-or-nothing. Credentials, team members and uploaded
  files stay behind. [TRANSFER.md](TRANSFER.md)
  pushes. [cli/README.md](../cli/README.md)
- **Scripts.** Backfills for feedback, changelog and contacts; a reindex; a demo
  knowledge seed; and a workspace migration.
  See [`scripts/`](../scripts/).

## 12. Running it yourself

- **One compose file.** The app, MongoDB, Parse and Redis. Optional profiles add
  GlitchTip and Bugsink. Meilisearch handles search, and any S3-compatible bucket
  stores attachments. [DEPLOYMENT.md](DEPLOYMENT.md)
- **Schema on boot.** The schema and search indexes apply on startup, and are
  safe to re-run.
- **Background work.** A job queue and workers handle AI replies, contact syncs,
  campaign sends, changelog digests and email log retention.
- **Limits.** Rate limits per IP and per project. Email sends are capped at 120
  requests a minute per project. Widgets only load on allowed origins.
- **Security.** Source credentials are sealed at rest with AES-256-GCM. Security
  headers and CORS are set by middleware. Secret-looking values are redacted in
  the email log.
- **Source link.** `/source` points visitors to the source code, as the AGPL
  requires (`SOURCE_CODE_URL`).
- **Demo.** `/demo` runs the real panel on sample data. Nothing is saved.
- **AI is optional.** Everything works without an LLM. Search falls back to
  keywords.

## 13. Hosted edition only

HelpBites Cloud, the paid hosted service, adds open sign-up, Free and Pro plans, Stripe billing, verified sending
domains and a staff console on top of everything above. The code for it is not part of this repository.
See [EDITIONS.md](EDITIONS.md).

## 14. Not built yet, and known limits

- **Native app.** No workspace picker yet, so it works in the user's default workspace.
- **Push.** Off until APNs credentials are set on the server.
- **Contact sync.** Rows deleted upstream are not noticed yet. Erase them through
  the API. [CONTACTS.md](CONTACTS.md)
- **Feedback votes.** Someone who voted on two posts linked to one board item
  counts twice in that item's total. [FEEDBACK.md](FEEDBACK.md)
- **Bugsink.** Its issues cannot be searched by customer, so a customer's errors do
  not appear in their conversation. [ERRORS.md](ERRORS.md)
- **Language.** The panel is translated into Spanish, Catalan, Chinese, Japanese and Korean; the widgets are English only.
