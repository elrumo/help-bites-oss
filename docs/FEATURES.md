# Features

Everything HelpBites does today, grouped by where you meet it. Each line
describes code that is on `main`; the link in brackets goes to the doc with the
detail. The machine-readable version is [features.json](../features.json), which
every feature change must update (see [CLAUDE.md](../CLAUDE.md)).

Sections 1–12 are in every build. Section 13 is the hosted edition only. See
[EDITIONS.md](EDITIONS.md). Section 14 lists what is not built yet.

## 1. Chat widget, onboarding and pricing in your app

**Chat widget** [CONNECTING.md](CONNECTING.md)

- **Floating bubble or a page of your app.** One script tag. Give it a container
  with `data-mode="inline"` and the same chat sits in your layout. [CONNECTING.md](CONNECTING.md)
- **Users never make an account.** Your server signs a one-hour token for the
  user who is already signed in. [CONNECTING.md](CONNECTING.md)
- **Guests.** Where an admin opens it (Project → Settings → Chat widget → Guest
  access), visitors chat, post feedback or comment with no sign-in and no email,
  rate limited, without uploads or reply mail. [CONNECTING.md](CONNECTING.md)
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
- **Feedback embed.** One script (`feedback.js`) renders the feedback page,
  roadmap, changelog, post pages and composer. [FEEDBACK.md](FEEDBACK.md)
- **Your Brand kit's look.** The chat, boards, forms, onboarding, legal and blog
  pages and campaign mail all wear the project's Brand kit: its accent, logo,
  typefaces and corner radius, set once. [BRAND.md](BRAND.md) A **project style**
  on top of it adds light and dark colours, a shadow and its own logo and icon,
  and the chat widget, hub, blog, brand and legal pages, forms, onboarding and
  pricing tables wear all of it in light and dark (the blog, legal, brand, hub and
  widget can take their own over it; a form, flow or table keeps its own fields on
  top). [STYLE.md](STYLE.md)
- **A Home tab.** Turn it on and the chat opens on Home, with what is new, the top
  feedback and a button per onboarding flow, next to Messages. [HUB.md](HUB.md)
- **One tag for everything.** `helpbites.js` asks the project which embeds it has
  and adds the chat, feedback board, changelog and onboarding scripts, with your
  `data-*` attributes and one `HelpBites.push` queue, never adding a script twice.
  [HUB.md](HUB.md)

**Custom domains** [CUSTOM-DOMAINS.md](CUSTOM-DOMAINS.md): serve a project's hub, feedback board, roadmap, changelog and blog on `feedback.example.com`; verify with a TXT and a CNAME; the bundled Caddy gets certificates on demand. Pro in the cloud edition.

**Public hub** [HUB.md](HUB.md)

- **One public page per project.** `/hub/pk_…` gathers the latest changelog
  entries, the roadmap, the top feedback, the latest blog posts, the published
  legal documents and the brand kit, a **Start a chat** button and up to 8 links of
  your own. A section appears only when its feature has something public. Pick the
  sections and their order; off until you turn it on.
- **In the project's look.** Accent, logo, typefaces, corner radius and light or
  dark come from the Brand kit; the page is plain HTML under a strict Content
  Security Policy.
- **The same data as JSON.** `GET /v1/hub/{pk}` (public, cached, rate limited) is
  what the Home tab and the web and SwiftUI snippets read, or build your own UI on.

**Onboarding** [ONBOARDING.md](ONBOARDING.md)

- **Welcome screens from the panel.** Flows of up to 12 steps (title, text, a
  picture, a button label) under a key your app asks for. Edit without shipping a
  release; nothing changes for users until you publish the next version.
- **One script tag or one Swift file.** `onboarding.js` (MIT) shows a flow once
  per browser, again after each publish, every time, or only when you call it;
  as a dialog or inline in a page. A copy-paste SwiftUI file does the same in an
  app.
- **Shows when HelpBites is down.** Both keep the last copy they got and fall
  back to an offline copy you ship with the app (**Download offline copy**).
  The public read carries an ETag and `stale-if-error` caching.
- **Your look.** Accent, background, text, corner radius and font per flow;
  the web script also takes CSS variables and `::part()` styles, and calls you
  back on each step, completion and skip.
- **Who finished it.** Hand the script (`data-token`) or one POST the person's
  identity token and HelpBites remembers whether they finished or skipped. Segments
  can ask for **Finished onboarding**, and `onboarding.completed` is an event that
  can start a sequence. A Swift snippet does the same.
- **A live preview** in the panel, drawn by the same script your site loads.
- **A paywall at the end.** A step can show a pricing table under its text;
  choosing a plan finishes the tour.

**Pricing tables** [PRICING.md](PRICING.md)

- **Five templates.** Cards side by side, compact rows, a mobile paywall with
  selectable prices, a comparison table, or one wide spotlight plan; your site
  can pick another when it shows the table.
- **Stripe as the source of truth, optionally.** Link a plan to a Stripe product
  or price and its prices come from Stripe (read live, kept five minutes); the
  names, descriptions, features and buttons stay yours. Plans without Stripe show
  the prices you write. **Check before publishing** names what would not work.
- **Weekly, monthly, yearly and one-time prices**, with a toggle and the best
  yearly saving as a badge, trials, a label for plans with no price, and a line
  under the price.
- **Currencies.** Stripe's currency options and written prices in other
  currencies; a visitor's own currency (`data-currency="auto"`) when every price
  has it, and a switcher.
- **Buttons.** Stripe Checkout (HelpBites opens the session, with trials and
  promotion codes), a Stripe Payment Link, or any link of yours with `{plan}` and
  `{interval}` filled in.
- **One script tag, a hosted page or one Swift file.** `pricing.js` (MIT) draws
  the table in a shadow root with `data-*` options, CSS variables and `::part()`
  hooks; a copy-paste SwiftUI file draws the cards and buys through StoreKit or a
  link.
- **Features by plan.** Ticks or values ("10", "Unlimited"), headings,
  tooltips, and "Everything in Starter, plus" lists.
- **Numbers and A/B tests.** Views, visitors, clicks, checkouts, purchases and
  revenue (read from Stripe) by day and plan. Split visitors between up to four
  tables by weight, each visitor kept on one; the results give lift and how sure
  a two-proportion test is, and the winner can replace the original.
- **Suggest with AI.** Proposes plans, features and prices from the project's
  GitHub repos, Stripe, revenue and the table's numbers; nothing changes until
  you apply it.
- **A live preview** in the panel and the native app, light and dark, desktop and
  phone. On the web, click a word in it to edit it there. **Push live now** publishes again and re-reads Stripe at once.

**Languages and AI translation** [LANGUAGES.md](LANGUAGES.md)

- **Onboarding, pricing, legal documents, emails and lead forms in your users'
  languages.** A flow, a pricing table, an email template and a lead form carry a
  translation per language; a legal document has a linked copy per language, each
  with its own page.
- **Translate with AI, or write it.** One button per language fills what is
  missing through the workspace's AI (or the server's gateway) and keeps what you
  edited. Placeholders, links and HTML survive, or the string stays in the
  original language.
- **Contacts have a language.** Set by the identity token's `locale`, the API, the
  panel, a CSV or sync column, or a lead form's visitor. Campaigns, sequence steps
  and a lead form's welcome email send each person the translation of the template
  closest to their language, and the template's own otherwise.
- **Apps pick the language.** `?locale=` on the onboarding, pricing, lead form and email reads,
  `locale` on the send API (per recipient too), `data-locale` on the web script
  and a `locale:` parameter on the Swift snippet. A language that is missing gets
  the original.
- **Legal pages link their languages** with a switcher and `hreflang`, and speak
  the document's language.

## 2. Operator inbox

- **Email as a channel.** A project can have addresses such as `support@yourdomain.com` (an address on a domain whose MX points at Mailgun, or a HelpBites alias your own mailbox forwards to). Mail to them becomes conversations, replies go back by email threaded (`In-Reply-To`, `Reply-To` with the conversation id), auto-replies and loops are dropped, and the inbox shows an envelope and filters by channel. Web and native. Pro in the cloud edition. [INBOUND-EMAIL.md](INBOUND-EMAIL.md)
- **Overview first.** Signing in opens the workspace overview: a card per project
  with its unread and open conversations, revenue and open errors, then unread and
  open totals, net revenue against the period before, MRR, the latest unread
  messages and revenue by project. Revenue is for admins and owners, each project in
  its own currency. It updates as messages arrive. Web and native.
  [OVERVIEW.md](OVERVIEW.md)
- **One list of what needs attention.** Changelog drafts waiting for approval,
  contact and Stripe syncs that failed, emails that bounced or failed, error alerts
  that fired, a paused sender, and each project's open error reports, documents
  that would not process and feedback to triage: one list for the workspace, the
  same rows inside each project. A count sits beside Overview in the sidebar and the
  inbox's unread badge stays live on every page, not only the inbox. Web and
  native. [OVERVIEW.md](OVERVIEW.md)
- **⌘K searches what is written.** Besides jumping to a page or project, the web
  palette finds conversations and knowledge answers through `/v1/admin/search`
  (the native palette already did).
- **A setup checklist per project.** Widget seen on your site, a signed identity
  token seen, someone notified, a sender mail can go out from, an assistant that is
  live, Stripe synced, GitHub linked, errors connected, judged from what HelpBites
  has actually seen, not boxes ticked. Web and native. [OVERVIEW.md](OVERVIEW.md)
- **A sidebar that groups and hides.** A project's sections sit under Support,
  Product, Grow, Site and Build, and a project can hide the ones it does not use
  (Project → Settings → Sidebar), in the sidebar and the palette; nothing is
  deleted. Web and native. [OVERVIEW.md](OVERVIEW.md)
- **One inbox for every project.** Projects are colour-coded, with one unread
  count and filters for All, Mine, Unassigned, Open, Unread and Archived. Search by
  the customer's name, email or user ID.
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
- **Customer context.** The user's record, their recent errors, and the planning
  items and changelog entries linked to the conversation.
- **The customer hub.** The panel beside a conversation also shows the customer's
  Stripe plan, MRR and subscription status (only when Stripe found them), their
  earlier conversations, and an Open contact link. [SUPPORT.md](SUPPORT.md)
- **Feedback they follow.** Link a feedback post to a conversation, or file one as
  the customer; they follow it and hear when it ships. Web and native.
  [SUPPORT.md](SUPPORT.md)
- **Saved replies and FAQs.** A picker beside the reply box searches the project's
  saved replies (`{{firstName}}` and `{{name}}` are filled from the customer) and
  FAQs from the assistants' knowledge. Web and native. [SUPPORT.md](SUPPORT.md)
- **AI draft.** One button writes a reply from the assistant's knowledge and the
  public thread for you to edit; nothing is sent. [SUPPORT.md](SUPPORT.md)
- **Save as FAQ.** Turn one of your replies into an FAQ in a knowledge model.
  [SUPPORT.md](SUPPORT.md)
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
- **A warning when an action has nowhere to go.** The type editor, and the actions
  in the inbox, say so while the project has no action webhook URL and secret
  (they would fail), and link to Install & API where it is set.

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
  the assistant answers only from the knowledge it was given.
- **Routing rules.** For each conversation type or keyword, decide AI or a human.
  Set a default action and a minimum confidence.
- **Hand-off.** When a rule says "a human", or no knowledge matches well enough
  and the fallback is "Hand to a human", the assistant does not answer: it labels
  the conversation `needs-human`, leaves an internal note saying why, and stays
  out of that conversation until a teammate removes the label. "Stay silent" just
  does not answer.
- **You decide what it sees.** Assign knowledge to an assistant by model, by
  path, or by single FAQ, with exclusions.
- **Readiness at a glance.** The assistant's page opens with what it still needs
  before it answers customers by itself: an AI provider, knowledge to read, an
  active status and auto-reply on. The project's setup checklist uses the same
  checks.
- **Test answer, with the reason.** Ask a question the way a customer would and see
  what it would do: answer (with the reply it would send), hand it to the team or
  stay silent, and why: which routing rule decided, or that nothing matched, or
  that the best match scored under the confidence bar, with the knowledge it found.
  It makes the same decision as a real message. Over the API too:
  `POST /v1/admin/support-agents/:id/test-answer`.
- **Workspace AI settings.** Bring your own LLM endpoint, with a connection test.
- **AI elsewhere.** The email designer (section 6), a cause-and-fix note on new
  errors (section 8), and the changelog CLI (section 11).

## 5. Feedback, roadmap, changelog, blog, brand kit and pages

**Feedback** [FEEDBACK.md](FEEDBACK.md)

- **Public feedback page per project.** Users post ideas and bugs. Post types, platforms,
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
- **Panel views.** A list or columns. Edit posts and reply as the team.
  Configure statuses, types, tags and options in Settings.
- **Import an existing feedback page.** Up to 100 posts per call, keeping votes, comments
  and numbers.

- **Images, files and videos.** Posts and Planning items take up to 10 attachments (images up to 8 MB, any file but programs and scripts up to 25 MB, MP4/MOV videos up to 100 MB), through the panel, the app, the iOS share sheet, the public board, the API and MCP. Images and videos open in a viewer. [FEEDBACK.md](FEEDBACK.md#images-and-files)
- **AI cards.** On Feedback and Planning, an AI chat turns pasted text into
  separate posts or board items, using only the types, tags and labels you
  defined. On Planning it can also change existing items and relate them to each
  other. [FEEDBACK.md](FEEDBACK.md#file-cards-with-ai)

**Planning and the public roadmap** [FEEDBACK.md](FEEDBACK.md#planning--roadmap)

- **Planning.** Linear-style items on a kanban: title, Markdown description,
  status, priority, assignee, labels, target date and `#number`. Drag to move or
  reorder. Type a new name in an item's label picker to create the label. Add a column from the tile after the last one: a name and a category,
  which decides whether its items show on the roadmap. Admins reorder columns by
  dragging a column's header onto another. In settings, drag a status, label or
  post type by its grip to reorder it.
- **Epics, releases and the list view.** An item is a card or an epic that
  groups cards. A card points at its epic and at a **release**, and a release is
  a changelog release: one list per project, shared with the changelog. A card's
  Release picker lists those releases and creates a draft one from a typed name,
  which the changelog shows too. Switch the board to a Monday-style list grouped
  by status, epic or release, with every cell editable in place. The Epic and
  Release filters narrow the board to one epic's cards or one release's cards;
  on native, a card's or row's menu puts it into an epic or release, or takes it
  out, as the list's cells do on the web. Deleting an epic or a changelog release
  frees its cards at once. Web and native, API (`kind`, `epicId`, `releaseId`)
  and MCP. [FEEDBACK.md](FEEDBACK.md#planning--roadmap)
- **Estimates, saved views and more events.** Give an item an estimate in points
  (an epic or release adds up its cards), sort the board by most votes, and save
  the current layout, grouping, order and filters as a named view the whole project
  can apply (admins save them). The board's list endpoint also filters by assignee,
  priority, label and text, and cards publish `board.item.assigned`, `.updated` and
  `.commented` events for webhooks. Web, native, API and MCP; a view keeps its
  epic and release filters on both. [FEEDBACK.md](FEEDBACK.md#planning--roadmap)
- **Drafts, shortcuts and card pills.** A new item that was not created comes
  back as you left it when the panel (or, on the web, a reload) opens again; the
  same holds for new changelog entries on the web. Cmd/Ctrl+Enter creates the
  item, and an open item's footer shows when it is saving and when it saved. The
  board order (manual, newest, oldest) is remembered per project. Cards show small
  pills for images, files, a description, related items and an item filed from an
  error.
- **Copy an item's link.** On the native app, press and hold a card (kanban or list) and choose *Copy link*: it copies
  the item's panel address (`/projects/<id>/board?item=<id>`), the one the web keeps in its address bar while an item is
  open, which opens that item's editor.
- **Comments and threads.** Add private comments and replies from the web and native item editors, or through the API and MCP. An assistant comment shows the MCP client's name; its authorizing operator remains recorded.
- **Edit history.** The web and native item editors have a collapsed history of
  field and link changes, with before and after values, who made them, whether
  they came from web, app, API or MCP, and when. The API returns the same history.
  Changes from before this feature was enabled cannot be reconstructed.
- **AI titles.** A new item with no title gets one written by the AI from its description: a second after you stop
  typing, or when you press Create. A sparkles button in the title field writes (or rewrites) it on demand, with a spinner
  in the field while it works. Panel, native app and the iOS share sheet.
  [FEEDBACK.md](FEEDBACK.md#the-api)
- **AI public descriptions.** A sparkles button on an item's public description has the AI write the roadmap's text from
  the title and internal description, for your users: brand names, comparisons to other products ("like X does") and
  internal details left out. Panel, native app and the iOS share sheet, which also puts an item on the roadmap.
  [FEEDBACK.md](FEEDBACK.md#the-api)
- **Add to Planning from the share sheet** (iPhone and iPad). Share a screenshot, photo, link or text from any
  app and file it as an item: a sheet with every field of *New item*, the shared image attached and uploaded, more
  images on request. Images and videos start uploading as soon as they are added, so sending only creates the item.
  A sheet closed without sending (a swipe, Cancel with *Save Draft*) opens with its text and files the next time,
  with *Start over* to keep only what was just shared. [FEEDBACK.md](FEEDBACK.md#from-the-ios-share-sheet)
- **Long descriptions.** A description over 20,000 characters (a pasted log) is not refused: the whole text is attached
  to the item as `description.txt` and the description keeps its start and a note. Panel, app, share sheet, API and MCP.
  [FEEDBACK.md](FEEDBACK.md#images-files-and-videos)
- **Planning offline** (native app). Every board opens without a connection as it was last loaded. New items, from the
  app or the share sheet, with their images and videos, wait on the device marked *Waiting to upload* and go up by
  themselves once the server can be reached; none is lost to a dropped connection or a closed app, and a retried upload
  never makes a second item (`clientId` on `POST /v1/admin/board-items`). Offline, Apple Intelligence on the device
  writes the title and, from its AI button, the public description. [FEEDBACK.md](FEEDBACK.md#offline-in-the-native-app)
- **Links.** Connect an item to up to 50 feedback posts, 50 conversations and 50 other items
  (related items link both ways). Votes add up across the linked posts. Search feedback to attach it to an item
  (or while creating one); right-click a post, or use its Planning button, to
  file it as new items written by the AI (it decides whether the post needs one
  item or several, and sets the urgency) or add it to an existing item.
- **Sync to feedback.** Optionally, moving an item into a status category moves
  its linked posts to the matching feedback status.
- **Filed from an error.** An error on the Errors page can be filed as an item in
  one click (once per issue); the item keeps a link back to the tracker.
  [ERRORS.md](ERRORS.md)
- **Commits and pull requests.** With the GitHub App's webhook on, a commit pushed
  to the default branch or a pull request merged into it that says `#12` shows on
  that item (or feedback post), and `fixes #12` moves the item to done.
  [GITHUB.md](GITHUB.md)
- **Public roadmap.** Items stay private until you publish them. A published item
  appears once it is planned, active or done, and shows only its public
  description. Until Planning has a published item, the roadmap keeps listing
  feedback posts, so switching Planning on never empties it. Layouts: columns, timeline or list. It has its own page at
  `/roadmap/pk_…` and can be embedded.

**Changelog** [FEEDBACK.md](FEEDBACK.md#changelog)

- **Entries and releases.** Entries are typed New, Improved, Fixed, Removed or
  Breaking, and group into versioned releases.
- **Review before publishing.** Approve or reject a draft. Nothing is public until
  it is published. Archive or merge entries.
- **AI merge suggestions.** With two or more entries selected, **Suggest merges**
  (panel and native app) has the AI look for entries that describe the same change
  and shows a preview: the entries it would fold and the new title, text and tag.
  It may suggest nothing. Nothing changes until you press Merge; each chosen
  suggestion becomes one draft and its originals are archived.
- **AI release copy.** A release's editor (panel and native app) has an AI button
  that reads the release's entries and fills in its title and summary. Nothing is
  saved until you press Save.
- **Move between releases.** In the panel, drag an entry onto a release (or onto
  *No release*); dragging a selected entry takes the whole selection, and the
  selection bar's **Move to** menu does the same. The native app moves entries
  with the Release field and its Move to release menu.
- **Ordered and dated.** Releases list highest version first (0.8.1 above 0.8.0)
  and collapse in the panel. Every entry shows its date (when it goes public, else
  when it was written); the editor shows the exact time it was created.
- **Drafts from shipped work.** With auto-draft on, a done post or planning item
  drafts an entry for you. Entries keep links to their sources in the panel, and
  the public changelog never shows those links.
- **Tell the people it answers.** When an entry goes public, everyone following a
  post it links (or a post of a board item it links) gets one "Shipped" email, once.
  The editor also offers **Reply to N linked conversations**: an editable message
  sent as the team to the conversations the entry answers, only when you press send.
- **Public changelog.** A page at `/changelog/pk_…`, plus JSON, a filtered flat
  list, and RSS.
- **Images on entries.** Up to 10 pictures under an entry's text, uploaded in the
  panel or native app, shown on the page, in `changelog.js` and in the API. [FEEDBACK.md](FEEDBACK.md#images)
- **Reader comments.** Opt-in. Only signed-in users can comment. Comments are
  Markdown and moderated.
- **Digest emails.** Readers subscribe to instant or weekly digests. Sign-up uses
  double opt-in, and every email has one-click unsubscribe.
- **Writable by script.** Batch, import and release-publish endpoints, plus the
  `helpbites changelog` CLI, which writes entries from git history
  ([cli/README.md](../cli/README.md)).
- **A style of its own.** The public page and embed (and the feedback board) wear the project's style in
  light and dark (logo, colours, corners, shadow, font), or the project's with
  the changelog's own choices over it. `data-accent`, `data-radius` and
  `data-shadow` override it per embed. [STYLE.md](STYLE.md)

**Blog and newsletter** [BLOG.md](BLOG.md)

- **A rich editor.** Nuxt UI's TipTap editor: headings, lists, quotes, code,
  links and uploaded images, a `/` menu and a formatting bubble. Posts are saved
  as Markdown (an imported post stays HTML) and rendered once, through an
  allowlist that lets YouTube and Vimeo players through, sandboxed. Drafts save
  themselves; a live post changes only when you press Update.
- **Write with AI.** Draft a post from a one-line brief, continue it, improve its
  text, or get a title, excerpt, search description and tags, all grounded in the
  project's connected GitHub repos (read-only). Nothing changes until you apply
  the proposal in the editor, on web and native. The web editor also has it as a `/`
  block and as a button on selected text.
- **Publish or schedule.** A cover with alt text, an excerpt, up to 10 tags, the
  author and a slug per post. A later date schedules it; it goes live on its own.
  **Featured** posts lead; **members-only** posts show their excerpt to everyone
  and the rest to signed-in readers (your app's users, or readers who confirmed
  their email). A title, description, image and canonical address for search
  engines and link previews, with a preview.
- **Pages.** About, Contact and the like: published like posts, kept out of the
  list, the feed and the newsletter, linked from the blog's navigation.
- **Hosted, embedded and in RSS.** An indexable blog at `/blog/pk_…` in your
  design (list, grid or magazine layout, sans or serif, light, dark or automatic,
  accent, logo, cover, up to 8 navigation links, social links, a footer) with
  search, tag pages, related posts, newer and older links, link previews,
  structured data and a sitemap. `blog.js` (MIT) draws the blog in your own page
  (or only the reactions, comments and members sign-in under posts you render
  yourself), the public JSON API serves your own UI (search, featured, pages), a
  SwiftUI snippet, and an RSS feed with full posts.
- **Reactions and comments.** Readers signed in by your app (an identity token)
  or with just their email react and comment; replies one level deep. The team
  answers as the team, hides, shows or deletes from the panel or the app, and can
  close one post's thread. New comments can be emailed to you.
- **Newsletter.** Any published post goes to your subscribers as a campaign, with
  topics, segments, test sends, the unsubscribe footer and its numbers; **Publish
  and email** does both at once, and a scheduled post's email waits for it. A
  sign-up form can sit under each hosted post. In the cloud edition this part
  needs a plan with campaigns.
- **Webhooks and moving in.** `blog.post.published`, `.updated`, `.unpublished`
  and `.deleted` events (scheduled posts too) to rebuild a site or announce a
  post. An import takes a Ghost export: posts, pages, tags, authors, dates, SEO
  fields, featured and visibility; Ghost's members CSV goes into Contacts.

**Brand kit** [BRAND.md](BRAND.md)

- **Every brand file in one place.** Logos, app icons, favicons, store
  screenshots, social images and PDFs (PNG, JPEG, GIF, WebP, SVG, ICO, PDF; up to
  20 MB each). Kinds and sizes are read from the files. Private files stay in the
  kit for the team.
- **Colours, fonts and guidelines.** Named colours with usage notes, fonts with
  roles, weights and Google Fonts links, and Markdown guideline sections.
- **A public press page.** `/brand/pk_…` in one of three templates (minimal,
  editorial, split), light, dark or automatic, set in your own fonts, with a
  download button on every file and click-to-copy colours. Choose which sections
  show and in which order. No account needed to view it.
- **On your site or in your app.** `brand.js` (MIT) frames the page into yours,
  with the template, theme, accent and sections as options; `GET /v1/brand/pk_…`
  for your own press page; a SwiftUI snippet for an in-app kit.
- **Feeds the rest of HelpBites.** Make any logo the project's logo or icon, and
  use kit images in onboarding steps. The kit is the project's look: its accent
  (the one in project Settings), logo, fonts and corner radius are what every public
  page, the widget and campaign mail wear.

**Pages and headless CMS** [PAGES.md](PAGES.md)

- **Landing pages in a visual editor.** Start from a template (SaaS launch, mobile
  app, waitlist, developer tool, design tool) or blank; drag blocks in Layers or on
  the page, edit fields in the inspector, set the accent, mode, fonts and width,
  undo anything. Drafts and published versions, like onboarding flows. The editor
  plays the page as it opens.
- **Hide, fold, search.** Any block (a section or a component inside it) has a *Hide
  from the page* toggle: it stays in Layers, dimmed, and in the content, but visitors,
  the hosted page and the delivery API never get it. Layers fold shut behind a
  chevron, a search box finds blocks by the text in any of their fields, hovering a
  layer lights the block on the page and the other way round (each scrolls the other
  into view), and the add button stays at the bottom. Its menu is narrow and shows
  what the hovered component looks like.
- **Components, built in or your own.** Fifty-five built-ins (hero, gradient hero,
  features, bento, pricing, FAQ, sign-up, Dock mockup, code window…, and the
  project's own blog, changelog, pricing table, feedback board, chat, forms and
  release sign-up), or write one
  as HTML and CSS with `{{@field}}` slots and a field schema. Components with no
  template are data for your own app. No scripts, ever: hosted pages share the
  HelpBites address.
- **Files and animations.** A file library (images, SVG, MP4, WebM, PDF) with alt
  text, and the brand kit in the picker. Entrance, stagger, scroll-scrubbed and
  parallax animations played by Motion from HelpBites itself.
- **An assistant and a wizard.** It builds layouts, writes the copy and new
  components, adds animations, reads the project's GitHub repos and keeps a
  messaging brief (audience, problem, value proposition, key messages, proof) that
  every turn reads. The wizard turns a few answers into a first draft.
- **Hosted, embedded or headless.** Pages live at `/p/pk_…/slug` with link preview
  tags and a working email sign-up; `pages.js` (MIT) frames one into your site; the
  delivery API serves published content as JSON or rendered HTML, `cms.mjs` reads it
  from Vue or any JavaScript, and its bridge lets the editor live-edit your own
  site. Publishing sends a webhook so static sites can rebuild.

## 6. Email

**Design and templates** [EMAIL.md](EMAIL.md)

- **Block designer.** Headings, text, buttons, images, columns, sections, custom
  HTML and reusable components. Renders table-based HTML that holds up in Gmail,
  Apple Mail and Outlook.
- **Checks.** Flags a missing subject or preheader, missing alt text, low
  contrast, placeholder links, and tags that mail clients strip.
- **AI designer.** Turns pasted HTML into editable blocks, or edits on request.
  Each turn can be undone.
- **Shared templates.** One shared template (called a master before) can be linked
  into many projects. Each project fills in its own brand and values. Detach to take
  a private copy.
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
- **One email section per project.** Templates, Campaigns, Sequences, Log and
  Settings in a single place, with the component library behind Templates and the
  suppressed addresses behind the Log.
- **One sender form.** Email → Settings holds the project's own from name and
  address, sending domain and reply-to, with a switch to give campaigns and
  sequences an address of their own, next to the newsletter's settings.
- **A strip that says what is missing.** Across the top of every email tab: the
  mailer key on the server, a sender, Mailgun's delivery webhook, and (for campaigns
  and sequences) a postal address and a sender that is not paused. Also at
  `GET /v1/admin/projects/:id/email-setup`.
- **Delivery log.** One entry per recipient, with a timeline kept current by
  Mailgun's delivery webhook. Stats by status, source and template. Log retention
  is configurable, and secret-looking values are redacted.
- **Suppressions.** Bounces, complaints and unsubscribes are suppressed
  automatically. Add or remove addresses by hand or through the API.

## 7. Contacts, segments and campaigns

**Contacts** [CONTACTS.md](CONTACTS.md)

- **One record per person.** Identified by your user id or by email, with
  attributes, tags, a subscription status, a consent record, and the language to
  write to them in. Web and native.
- **How each person was added.** Every contact shows **Added via**: an app user, a
  lead form (and which), the newsletter sign-up, a CSV import, a database sync,
  Stripe, the API, by hand or a feedback import. The people list and segments filter
  by it. Web and native.
- **Imports.** CSV in the panel, mapped in the browser. The batch API takes up to
  1,000 rows.
- **Sync from your database.** Reads Parse Server, Postgres or Supabase (read-only)
  and Firestore. Incremental when the table has an updated-at column. Runs every
  15 minutes to daily, or on demand.
- **Segments.** A rule builder (match all or any, on attributes, tags, dates,
  subscription, language, how people were added and which lead form) with a live
  count. Built-in fields answer from other records: has an open conversation,
  voted on a post, has errors (best effort, from the newest 50 open issues of the
  connected tracker), finished onboarding, and Stripe plan.
- **One timeline per person.** `GET /v1/contacts/:id/activity` merges their
  conversations, feedback posts, comments and votes, emails, sequences, payments and
  onboarding, newest first and paged. The contact page shows it with icons,
  relative times and links, web and native.
- **Onto a sequence.** From a contact's page, or for a whole segment (up to 5,000
  per call) from the segment list or the people list; the answer says who was left
  out and why. Web and native.
- **Stripe billing.** With Stripe connected, a person's page looks them up in Stripe
  live (by their linked customer, else their email) and shows when they became a
  customer, their country, credit or balance owed and an overdue flag, next to their
  subscriptions and payments from the hourly sync. Web and native.
- **Revenue.** A project's Revenue tab totals net revenue, MRR, subscribers and
  paying customers for a period, charts the last twelve months of net revenue with
  MRR at the end of each month (hover, focus or touch a month for its numbers), and
  lists plans, top customers and recent payments. A customer who is also a contact
  opens their page from the report. It reads from every place you sell through,
  and the sources add up: Stripe (a restricted key, read hourly), RevenueCat (its
  webhook, so purchases, renewals, refunds and expirations show as they happen),
  the App Store (the Sales and Trends reports: your proceeds, no customers; the same key
  also shows TestFlight installs, sessions, crashes, invites and feedback per build), Paddle
  and Lemon Squeezy (an API key, read hourly), and a custom API for anything else
  (Google Play reports, Gumroad, PayPal, past months). Each source connects and
  disconnects on its own and the tab shows what each brought in. A person's page
  lists their payments and subscriptions from every source. Read-only. Web and
  native. [REVENUE.md](REVENUE.md)
- **Erasure.** Deleting a person removes their conversations, feedback, the files
  they sent through forms, email history and changelog subscriptions, including
  ones made by address alone.

**Lead forms** [FORMS.md](FORMS.md)

- **Waitlists and interest forms.** As many forms per project as you need, from a
  single email box on one row to up to 12 fields (name, text, number, website,
  phone, a choice, a checkbox, a file). Each answer is saved on the contact. Web and native.
- **File uploads.** Up to three file fields per form (pictures, documents or
  either, up to 20 MB), checked by their contents and kept privately: the team
  downloads them from the contact or the form. Erasing a person deletes them.
- **In the visitor's language.** A translation per language of the form's words,
  written by hand or by AI. The script, the hosted page, the Swift snippet and the
  API show the visitor's language; errors, the confirmation and the welcome email
  follow.
- **Anywhere.** One script tag (`forms.js`, MIT) styled by `data-*` options, CSS
  variables and parts; a plain HTML form; a hosted page at `/f/<public key>/<key>`;
  a copy-paste SwiftUI view; or the public API from your own UI.
- **Leads land in Contacts.** New people are marked **Added via: Lead form**, get
  the form's tags, and fall into a segment made for the form (plus **All leads**).
- **After sign-up.** Optional double opt-in with your own confirmation template, a
  welcome email from any template (sent once), a sequence to start, and where to
  send people next.

**Campaigns and sequences** [MARKETING.md](MARKETING.md) (tabs of a project's Email section)

- **Broadcast campaigns.** Send a template to a segment or topic. Test, schedule
  or send now, then pause, resume or cancel. Opens and clicks update live.
- **Sequences.** Timed drip emails, started by a subscription, an event from your
  app, or by hand for one person or a whole segment.
- **In each reader's language.** A campaign, a sequence step or a lead form's welcome
  email goes out in the translation of its template closest to the contact's
  language; the template's own language is the fallback. Every translation must keep
  the unsubscribe link and postal address.
- **Sign-up forms.** A hosted page or a plain HTML form, with double opt-in, a
  honeypot field and rate limits.
- **Preferences page.** Topics, unsubscribe from all, and resubscribe.
- **Compliance by default.** Campaigns require an unsubscribe link and a postal
  address (the project's company profile), and send RFC 8058 one-click
  unsubscribe headers.
- **Event webhook.** Signed notifications when a subscription or suppression
  changes.

## 8. Errors and feature flags

**Error tracking** [ERRORS.md](ERRORS.md)

- **Connect GlitchTip or Bugsink.** HelpBites creates the Sentry-compatible project
  and DSN for you, and wires the alerts.
- **Browse and triage.** The Errors page lists issues; open one for its stack trace,
  event details, breadcrumbs and tags, and resolve or ignore it. Errors don't create
  inbox conversations. **Copy all** puts the whole error (summary, stack trace, event
  details, breadcrumbs, tags and the saved AI analysis) on the clipboard as text, or
  just the parts ticked in its dropdown.
- **Alert rules.** Email the team when an error is new, passes a total, or happens
  N times within a time window.
- **Fix with AI.** Analyze an error for cause and fix (reading the stack-trace files
  from the project's GitHub repos), or copy the same context as a prompt for a
  coding agent (the analysis needs an LLM endpoint).
- **AI reports.** Analyze with AI triages all open errors into a saved report (the
  most frequent errors' source is read from connected GitHub repos). Reports can be
  copied, listed and deleted, and made to run daily, weekly or monthly.
- **Customer errors.** A customer's recent errors show alongside their
  conversation.
- **File on board.** Turn an error into a board item (titled from the issue, with
  its tracker link), once per issue, linked to the error's conversation.

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
- **Workspace settings.** AI provider, export and import (one Export card: download now or have a link
  emailed, with the same file and options either way), and workspace deletion for owners.
- **Usage and storage.** Settings → Usage shows where the workspace's storage goes, by kind of file (conversation
  attachments, feedback and board files, team uploads, branding, CMS files, form uploads, email, blog and onboarding
  images, knowledge documents) and by project, read from the bucket. On a plan with limits it is Plan & usage and
  also shows what is used and left against each limit. Web and native. [USAGE.md](USAGE.md)
- **Moving between instances.** Download a workspace, or one project, as a portable
  file; import a file; or pull straight from another HelpBites (self-hosted or
  cloud) with an API key or a login. Runs in the background, adds new projects,
  keeps public keys, and is all-or-nothing. Uploaded files travel as links or as the
  files themselves, and credentials and connections (Stripe, contact databases,
  webhook secrets, AI keys, project secrets) can come along when you ask. Team
  members, API keys, custom domains and campaigns stay behind. [TRANSFER.md](TRANSFER.md)
- **Welcome tour.** A new account (first run, an accepted invitation, a cloud sign-up) sees five short
  cards once: projects, the inbox, feedback and the changelog, then team and API keys. Skip it at any
  point; finishing or skipping is stored on the account, so no device shows it again. Replay it from
  Settings → Account (web) or Settings (native). Accounts that predate it never see it unasked.
- **Accounts.** Edit your name and email, reset your password by email, choose
  light, dark or system theme, and sign out.
- **Admin API keys.** Create, rename and revoke `ak_…` keys for scripts and tools.
  A key can be made **read-only** (it reads, and any other call answers `403 key_read_only`), and creating, renaming
  or revoking keys, adding or removing teammates, invitations, project secrets and AI providers are for a signed-in
  person: an API key gets `403 session_required`.
- **Projects.** Create a project, then set its site URL, allowed widget origins,
  reply name, notification addresses, accent colour (the Brand kit's) and logo, and choose which
  sections show in its sidebar. See and rotate its secret. An overview page
  summarises it, with its setup checklist and what needs attention. [CONNECTING.md](CONNECTING.md)
- **Company profile.** Who is behind the product (name, legal name, postal
  address, email, phone, website, data protection officer), written once in project
  Settings. Legal documents name it as the operator, campaign footers print its
  address, and email templates fill in `{{project.company}}`, `{{project.address}}`
  and `{{project.email}}`. Projects that predate it start from their legal identity
  and postal address. [LEGAL.md](LEGAL.md)
- **Legal links in email.** `{{project.privacyUrl}}`, `{{project.termsUrl}}`,
  `{{project.cookiesUrl}}` and `{{project.refundUrl}}` fill in with the public page
  of the project's published legal document, kept up to date as documents are
  published, renamed or deleted. [EMAIL.md](EMAIL.md)

## 10. Native apps (iPhone, iPad, Mac)

[helpbites-native/README.md](../helpbites-native/README.md)

- **One SwiftUI app.** Tabs on iPhone, a sidebar on iPad, and a native Mac window (not Catalyst): the sidebar beside
  the page, the section as the window title with its project and counts under it (the web's breadcrumb: *Planning*,
  *LightBites · 243 items, 41 on the roadmap*), filters as the system's pull-down buttons, ⌘[ to go back, and a ⌘K
  palette driven from the keyboard (↑ ↓, Return, Esc).
- **Text size.** *Settings → Text size* makes every screen's text, rows and controls larger or smaller (85% to 150%),
  kept on the device. On the Mac, *View → Make Text Bigger / Make Text Smaller* (⌘+ and ⌘−) and *Actual Size* (⌥⌘0) do
  the same, and the sidebar follows. The Mac starts at 110%; iPhone and iPad at 100%.
- **Fast to open.** The shell, the Overview and the inbox paint from what the last launch showed, then refresh; a
  page you come back to shows its last contents at once while it reloads (Overview, feedback, errors, contacts).
- **Project settings in pages.** A project's Settings open on a list like Apple's Settings: who the project is, then
  groups (*Project*: General, Branding, Company, Sidebar; *Chat and people*: Chat widget, Notifications, Collaborators;
  *Publishing and code*: Public hub, Custom domains, GitHub repos; *Advanced*: Data, Keys and webhooks), each opening
  its own screen. The search field finds a single setting by name or by a related word ("dns", "color", "webhook") and
  opens its page scrolled to it. The form is saved as a whole from any page. Native only: the web keeps the same
  settings on one long page.
- **Your own tab bar.** *Settings → Tab bar* chooses which shortcuts sit along the bottom of the iPhone app (and the
  top of the iPad sidebar) and their order: Overview, Inbox, Projects, Templates, Knowledge and Settings, plus
  *Planning*, a list of every project that has a planning board, each opening its board. The bar holds five, Settings
  always stays so the screen can be found again, and the choice is kept on that device. Native only: the web panel
  has no tab bar, and the Mac sidebar lists everything.
- **Overview.** The first tab on iPhone and the top of the sidebar on iPad and Mac
  (⌘0): every project's card, the workspace's numbers, unread messages and revenue
  by project, as on the web.
- **Inbox.** Conversations, replies with images, status, deleting a message, and
  starting a new conversation.
- **Most of the panel.** Projects and their settings, team, API keys, the developer
  page, contacts, knowledge, assistants, ticket types, feedback, planning, changelog, legal,
  onboarding (with a live preview), pricing tables (with a live preview, results,
  A/B tests and AI suggestions), the brand kit, the email editor with its AI
  designer, email log and suppressions, campaigns, flags, and errors.
- **Offline.** Every page the app has opened opens again from the device when the server can't be reached, and every
  planning board is read ahead so it opens offline even if you never visited it. New planning items made offline (in the
  app or the share sheet) wait on the device and upload by themselves; see Planning offline above.
- **Share sheet.** *Add to Planning* in the system share sheet (iPhone and iPad): a screenshot, photo, link or text
  becomes a planning item without opening the app.
- **Push notifications.** A new customer message can notify the device. This needs
  Apple push (APNs) credentials on the server.
- **Keyboard shortcuts** on iPad and Mac, and a ⌘K palette that also searches
  conversations and knowledge. In a planning item, ⇧⌘C (or *Copy link* in its toolbar) copies the item's web
  address, `/projects/<id>/board?item=<id>`.
- **The same navigation and prerequisites.** Sections grouped and hideable per
  project, the setup checklist and needs-attention list, the assistant readiness
  strip with test answer, the email setup strip and the one Email section.

## 11. Developer platform

- **Documented REST API** under `/v1`, with OpenAPI docs at `/_docs/scalar`.
- **Every guide as Markdown.** `/docs/<slug>.md` serves a published guide as plain Markdown (links
  go to the other guides' `.md` or to GitHub), `/docs.md` lists them, and each `/docs` page has
  **Copy MD** and **Copy MD link** buttons at the top, so a guide can be pasted or linked to an AI
  assistant. `/llms.txt` is the same list with absolute links, for assistants that look for it.
- **Four ways in.** The project secret (server only), the public key (browser
  reads), an identity token (one user), and an admin API key (operators and tools).
  [CONNECTING.md](CONNECTING.md)
- **Events and webhook endpoints.** Every change in a project (a conversation starts,
  a post is voted on, a changelog entry goes public, a pull request merges) is a domain
  event. Webhook endpoints receive the ones they filter for, signed per endpoint and
  retried; a sequence can start from any of them, and four recipes (welcome, after
  onboarding, thank-you for feedback, check-in after support) install as drafts.
  [EVENTS.md](EVENTS.md)
- **AI assistants (MCP).** An MCP server at `/mcp` lets Claude, ChatGPT, Cursor or
  any MCP client work in a workspace as the operator who connected it, with a tool for
  what the panel does: the inbox and the AI assistants, feedback, planning items (labels,
  assignees, links, history, comments with images and files), the changelog and its
  releases, the knowledge base, contacts, segments, sequences and campaigns, lead forms
  and onboarding, email templates and sending, pricing tables (edit, publish, A/B test,
  AI suggestions), legal documents, errors, Pages, the blog, the brand kit, webhooks,
  domains and the project's settings. Keys, teammates, project secrets and connecting
  services, file uploads, streams and the public customer surface are left out on
  purpose. Sign in with the browser (OAuth with PKCE and dynamic registration, for
  claude.ai and ChatGPT) or paste an admin API key. Each tool is a `/v1` call, so the
  operator's role, the workspace and a key's project limit apply; connections are API
  keys you can revoke in **Settings → API keys** and from the address and a ready-made
  `claude mcp add` command on the workspace's **Developer & MCP** page (the old
  Developer page), in the panel and the native app. A test fails when a `/v1` route has
  neither a tool nor a reasoned exclusion.
  [MCP.md](MCP.md)
- **Realtime streams.** Server-sent events for end users, operators, the feedback
  page, and shared email previews.
- **Webhooks.** A signed action webhook for ticket actions, a signed event webhook
  for contacts, Mailgun's delivery webhook, and the GlitchTip and Bugsink alert
  webhooks.
- **Idempotency.** Message sends and email sends accept idempotency keys.
- **Health checks.** `/v1/health` and `/v1/health/live`.
- **Embed scripts.** `widget.js`, `feedback.js`, `changelog.js`, `onboarding.js`,
  `pricing.js`, `forms.js` and `brand.js`, all MIT-licensed, so the site that embeds
  them carries no copyleft obligations. Onboarding, pricing tables, lead forms and
  the brand kit also have copy-paste SwiftUI snippets.
- **Server rendering and caching.** `ssr.mjs` reads the public API from your server
  within a time budget (from memory, refreshed behind the reader, or a skeleton and a
  browser load when HelpBites is slow), server-renders the changelog, roadmap, board and
  chat embeds so the scripts take over from a snapshot, and keeps self-hosted copies of
  the scripts. The scripts show a skeleton while they load and take `data-host`;
  `helpbites.js` remembers the project's embeds in the browser. [SSR.md](SSR.md)
- **CLI.** `helpbites changelog` turns git changes into changelog entries. It never
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
- **Version and beta.** The release number lives in `package.json` and shows,
  with a Beta tag, on the docs, in the panel (sidebar and
  Settings → Account), in the native app's Settings and in `GET /v1/meta`. It
  links to the project's public changelog. [RELEASING.md](RELEASING.md)
- **Releases.** A tag `vX.Y.Z` builds the community image for Docker Hub
  (`elrumo/helpbites`) and GHCR, creates the GitHub release and publishes the
  version's `CHANGELOG.md` section to the HelpBites project's own public
  changelog, so HelpBites keeps its changelog on HelpBites.
- **Guides.** *Getting started*, *Setting things up* (AI, email, inbound email,
  GitHub, storage, search, error tracking, revenue, domains, push, MCP) and
  *Development* are published at `/docs`. [GETTING-STARTED.md](GETTING-STARTED.md),
  [SETUP.md](SETUP.md), [DEVELOPMENT.md](DEVELOPMENT.md)
- **AI is optional.** Everything works without an LLM. Search falls back to
  keywords.

## 13. Hosted edition only

HelpBites Cloud, the paid hosted service, adds open sign-up, a pricing page, Free and Pro plans, Stripe billing,
verified sending domains and a staff console (`/admin`: every account and workspace, plans given by hand, suspension)
on top of everything above. The code for it is not part of this
repository. See [EDITIONS.md](EDITIONS.md).
HelpBites Cloud, the paid hosted service, adds open sign-up, the public landing page with its plans and prices, Free
and Pro plans, Stripe billing, verified sending domains and a staff console on top of everything above. The code for
it is not part of this repository; a self-hosted server's `/` goes straight to the panel. See [EDITIONS.md](EDITIONS.md).

- **Billing.** Settings → Billing (web and native) makes the case for Pro on the Free plan: the price, monthly or
  yearly, what Pro unlocks, Free and Pro limit by limit, and the limits a workspace is close to. On Pro it shows the
  subscription and opens Stripe's portal.

- **Plan locks.** On a plan that leaves a feature out, the panel says so before anyone fills in a form: a lock on
  Campaigns and Legal in the sidebar, and a note on the pages for campaigns, sequences, database sync, event webhooks
  and legal documents, with the Upgrade button. The native app shows the same notes. A self-hosted install is on the
  unlimited plan, so it never shows any of this.

## 14. Not built yet, and known limits

- **Read-only keys on native.** The native app lists API keys with their read-only state but cannot create a read-only
  key or switch one; Settings → API keys and the assistant approval page on the web do. The API takes `readOnly`.
- **Planning on native.** Statuses and labels are reordered with arrow buttons (the web panel drags them), and the
  editor saves with its Save button (Cmd and Return on a keyboard) instead of as you go.
- **Share sheet.** *Add to Planning* is an iPhone and iPad share extension only: the Mac app has none, and the web
  panel has no equivalent (a browser has no share sheet; use *New item* or the API).
  [FEEDBACK.md](FEEDBACK.md#from-the-ios-share-sheet)
- **Offline.** Only the native app works offline, and offline it only creates planning items (and changes them before
  they upload): editing an existing item, comments and every other write still need the server. The app uploads what
  waits while it is open, not in the background. The web panel has no offline mode. Apple Intelligence titles and public
  descriptions need iOS or macOS 26 or later with Apple Intelligence on. [FEEDBACK.md](FEEDBACK.md#offline-in-the-native-app)
- **Pricing preview.** On the web the preview can be edited in place (click a title,
  plan name, description, badge, button, feature or footnote and type); the native
  preview is read-only. [PRICING.md](PRICING.md)
- **Conversation panel.** A contact with no user id cannot follow a feedback post
  or have one filed as them (linking still works). Saved replies are inserted from
  the picker, not by typing `/shortcut`; Save as FAQ lives on a reply's context menu;
  the AI draft answers the latest customer message only and takes no instructions.
  [SUPPORT.md](SUPPORT.md)
- **Native app.** Translated into the panel's five other languages (Catalan, Spanish,
  Japanese, Korean, Simplified Chinese) through a string catalog, and it follows the
  device's language (the per-app language setting on iOS and macOS); text that comes
  from the server (error messages, names, AI output) stays as the server wrote it.
  In the hosted edition it shows the plan, usage, locks and
  sending domains, and opens Stripe's Checkout and customer portal in the browser.
- **Project style.** The native app edits the project style and the
  changelog's style (Brand, Settings, Changelog → Style), not any other feature's
  yet (the panel does, and the API is the same), and its Swift snippets do not
  read the finished `look` the public payloads carry. Kit typefaces are not
  loaded on the blog, legal, form, onboarding or pricing pages.
  [STYLE.md](STYLE.md)
- **Blog preview.** The web editor has Preview and Live preview (the draft in the
  blog's design, `POST /v1/admin/blog/preview`); the native editor has neither yet.
  [BLOG.md](BLOG.md)
- **Push.** Off until APNs credentials are set on the server.
- **Contact sync.** Rows deleted upstream are not noticed yet. Erase them through
  the API. [CONTACTS.md](CONTACTS.md)
- **Feedback votes.** Someone who voted on two posts linked to one planning item
  counts twice in that item's total. [FEEDBACK.md](FEEDBACK.md)
- **Bugsink.** Its issues cannot be searched by customer, so a customer's errors do
  not appear in their conversation. [ERRORS.md](ERRORS.md)
- **Staff console.** The hosted edition's `/admin` (accounts and workspaces) is web only; the native app has no
  super-admin screens.
- **GitHub links.** The Pull requests permission and event are new: a GitHub App
  registered before them must add both (and each installation accept them) before
  merged pull requests link; pushes link without it. Only merged pull requests and
  pushes to the default branch count, a closing keyword moves board items only, and
  links are rebuilt from new pushes rather than carried by an export.
  [GITHUB.md](GITHUB.md)
- **Shipped mail.** The email to a changelog entry's followers is the feedback
  board's plain message mail, with no per-project wording yet. [FEEDBACK.md](FEEDBACK.md)
- **Contacts.** The people list has no row selection, so adding people to a sequence
  works for one contact or for a whole segment, not for hand-picked rows. The
  **Has errors** segment field is best effort (the newest 50 open issues of the
  connected tracker, cached 10 minutes), and the activity timeline links to a section of
  the panel, not to the exact post or log row. [CONTACTS.md](CONTACTS.md)
- **Onboarding.** HelpBites keeps only the latest outcome (finished or skipped) per
  person and flow, for apps that send the identity token: no funnel statistics or
  per-step drop-off yet. [ONBOARDING.md](ONBOARDING.md)
- **Brand kit.** No download-everything archive yet; files download one by one.
  [BRAND.md](BRAND.md)
- **Public hub and Home tab.** The hub page is English only (it lives at `/hub/<public key>`,
  or on a [custom domain](CUSTOM-DOMAINS.md)) and has fixed sections plus up to 8 links. The chat
  widget's Home tab is web only (the native operator app edits its settings), is
  not shown in the wide inline layout, and offers every published onboarding flow.
  `helpbites.js` adds the chat, feedback, changelog and onboarding scripts only,
  and cannot fetch an identity token for you. [HUB.md](HUB.md)
- **Company profile and legal links.** Every legal document names the same
  operator. The legal page links used in email are rebuilt when a document is
  published, unpublished, renamed or deleted, are not carried by an export or
  import until the next publish, and are blank while `APP_URL` is unset.
  [LEGAL.md](LEGAL.md)
- **Pages and CMS.** The native app lists, creates, edits, publishes and deletes
  entries (a block outline with each block's fields and animation, hide, fold and search,
  undo and redo, moving a block between lists), writes components (fields, HTML and CSS), runs the assistant
  and the page wizard, and manages files and settings; the live previews are web-only
  (open the hosted page after publishing). No
  scripts in components, no per-field translations, scheduled publishing, version
  history or generated TypeScript types yet. [PAGES.md](PAGES.md)
- **Translations.** Onboarding, pricing tables, legal documents, template emails, lead forms,
  campaigns, sequences and lead-form welcome emails have them; blog newsletters, the
  mail HelpBites sends itself, the chat, feedback and changelog embeds and CMS pages
  do not yet, and the send API does not read a contact's language (pass `locale`).
  [LANGUAGES.md](LANGUAGES.md)
- **Lead forms.** No CAPTCHA (a honeypot and rate limits only) and no A/B tests
  yet. Answers are saved on the contact, not kept as separate submissions, and a
  form never overwrites an answer a contact already has. Files are not scanned for
  malware (only their type and size are checked). [FORMS.md](FORMS.md)
- **Revenue sources.** RevenueCat's history starts when its webhook does (it cannot
  replay events, and there is no REST backfill: send earlier months to the custom
  API). The App Store source reads proceeds from the Sales and Trends reports, which
  name no customers, so it has no top customers, subscribers or MRR. No direct Google
  Play, PayPal, Gumroad or Polar source: use the custom API, or RevenueCat for Google
  Play. Only Stripe customers become `stripe_*` attributes on contacts, so the People
  billing filters, segments and campaigns do not see the other sources' customers.
  Paddle, Lemon Squeezy and the App Store were written from the services'
  documentation and unit tests, not run against live accounts.
  [REVENUE.md](REVENUE.md)
- **Pricing tables.** Fixed prices only: metered and tiered Stripe prices are left
  out. No Stripe Customer Portal button (a "Manage plan" button is a link of
  yours). Purchases are counted from Stripe, not the App Store, and the Swift
  snippet draws the cards template only. [PRICING.md](PRICING.md)
- **Blog.** The native app edits a post's Markdown (or an imported post's HTML)
  as text, with a preview: the rich editor is web-only. A pasted or picked image
  goes where the text ends, not at the cursor. No translations of posts
  or the embed, no paid tiers for
  members-only posts (a member is a signed-in reader), images from a Ghost import
  stay on the old site. [BLOG.md](BLOG.md)
- **MCP.** The server offers tools only: no prompts, resources or live notifications.
  A connection has the operator's whole role: there is no read-only option or lower
  role yet, only a project limit and an expiry. It uploads planning attachments and
  Pages files (as base64 or from a URL); knowledge document uploads, blog and email
  images and brand files stay in the panel. OAuth connections use
  rotating refresh tokens. [MCP.md](MCP.md)
- **Native translations.** The legal screen cannot yet link an existing document as
  a translation of another (the API and web can); the email editor shows translation
  edits made elsewhere after a reload; the onboarding offline copy holds only the
  flow's own language. [LANGUAGES.md](LANGUAGES.md)
- **Needs attention.** The list is read every minute and when the web panel's tab comes
  back; only the inbox badge follows messages as they arrive. [OVERVIEW.md](OVERVIEW.md)
- **Native navigation.** The iPad sidebar lists a project's sections in the grouped
  order without group headings.
- **Language.** The panel is translated into Spanish, Catalan, Chinese, Japanese and Korean; the widgets are English only.
