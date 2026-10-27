# Feedback, planning and roadmap

A public feedback page per project where your users post ideas and bugs, vote on what
matters, comment, and follow progress through a roadmap and a changelog.
HelpBites knows nothing about your app: statuses, post types, platforms and
tags are configured per project, and identity is the same host-signed token the chat
uses.

- **Plug and play** — one script tag renders the whole feedback page (posts,
  roadmap, changelog, post pages, composer) inside your page.
- **Your own UI** — everything the embed does is on `/v1/feedback`.
- **Operators** — Project → Feedback in the panel: list or kanban, edit and
  moderate posts, reply as the team, configure the page.
- **Planning & roadmap** — Project → Planning: Linear-style items linked to
  posts and conversations; the ones you pick make the public roadmap (see
  [Planning & roadmap](#planning--roadmap)).

Three things used to share the word *board*. They are called **Feedback** (the
public page where users post and vote), **Planning** (your private kanban of
work items) and the **Roadmap** (the public view of the Planning items you
publish). The API and the embed keep their names: `view=board` is the feedback
page's column layout (*Columns* in the panel), and `board` and `board-items` are
Planning.

## 1. Turn it on

Panel → your project → **Feedback** → *Turn on feedback*. Then open
**Settings** to shape it:

| Setting | What it does |
|---|---|
| Statuses | Your own keys and labels. Each has a **category**: `open`, `planned`, `active`, `done` or `closed`. Categories carry the meaning: open/planned/active show by default, planned/active/done make the roadmap, and done/closed close voting. A done post can feed a [changelog entry](#changelog), but is not one itself. A bell marks statuses that email the post's followers when it moves there. |
| Post types | Keys, labels and an icon — an Iconify name (`lucide:bug`, `octicon:rocket-16`) or an emoji. |
| Platforms | Optional (`web`, `ios`, …), one per post. Empty hides the picker. |
| Tags | Optional labels with a colour (`editor`, `api`, …); a post carries up to 4. Empty hides the picker. |
| Post URL | Where a post lives on your site. `{id}`, `{number}` and `{slug}` are replaced: `https://app.example.com/feedback/{number}-{slug}`. Used by emails and RSS. |
| Options | Comments, authors editing their own posts, showing author names publicly, email notifications, roadmap and changelog views. |

**Style.** Project → Feedback → **Style** sets how the public board, its roadmap
and changelog views look, in light and dark: the project's own style (see
[Project style](STYLE.md)), or the project's with the board's own choices over
it (`feedback.style`: `{ "source": "project" | "custom", "custom": { … } }`). The
board's finished style is `feedbackStyle` on `GET /v1/projects/:pk/public`
and on `GET /v1/feedback/config`'s `project`.

The same settings are the `feedback` object on `PATCH /v1/admin/projects/:id`
(partial: send only what changes).

## 2a. Plug and play

```html
<div id="feedback"></div>
<script src="https://YOUR-SUPPORT-HOST/feedback.js" data-project="pk_…" data-target="#feedback" defer></script>
<script>
  window.HelpBitesFeedback = window.HelpBitesFeedback || []
  HelpBitesFeedback.push(['init', {
    // The chat's token endpoint works as is. Resolve to null when nobody is signed in.
    getToken: () => fetch('/api/support/token').then(r => r.ok ? r.json() : null).then(r => r && r.token),
    // Called when a signed-out visitor tries to post, vote or comment.
    onSignIn: () => openLoginModal()
  }])
</script>
```

- **Inline** (with `data-target`): the board is part of your page and the frame
  grows with its content. **Floating** (no target): a *Feedback* button opens it
  in a panel.
- **Reading is open to everyone** with the public key. Writing needs a token;
  without one the board shows a sign-in prompt and calls your `onSignIn`.
- After your user signs in or out: `HelpBitesFeedback.push(['refresh'])`.
- Other calls: `['open']`, `['close']`, `['openPost', id]`,
  `['setView', 'board' | 'roadmap' | 'changelog']`.
- Options (in `init` or as `data-*` on the script tag): `target`, `view`,
  `only` (`roadmap`: the roadmap alone, see below), `layout` (the roadmap's:
  `columns` · `timeline` · `list`; default the board's), `theme` (`system` ·
  `light` · `dark`; default follows a `dark`/`light` class on your `<html>`, else
  the board's style, else the visitor), `platform` (preselected for new posts),
  `position` (`right` · `left`), `label`, `accent`, `radius` (0 to 32), `shadow`
  (`none` · `soft` · `medium` · `strong`), `header` (`false` leaves out the logo,
  title and description when your page already shows them; the view tabs and
  *New post* stay), `deepLinkParam` (default `feedback`), `syncUrl`.
- Deep links: `?feedback=<postId>` on your page opens that post. Inline boards
  keep that parameter in your URL as people open posts, so links are shareable.
- The colours, logo and name come from the project settings.

Only the project's **allowed origins** can hand the board a token; any other
site still gets a read-only board.

**The changelog on its own page**: `https://YOUR-SUPPORT-HOST/changelog/pk_…`
(optional `?theme=light|dark|system`) shows the changelog, read-only. It needs only
*Public changelog* on in Project → Changelog → Settings, not the board; the
*Public changelog* button there copies the link. To put it in your page, add
`<div id="changelog"></div><script src="https://YOUR-SUPPORT-HOST/changelog.js" data-project="pk_…" data-target="#changelog" defer></script>`
(`data-theme` optional). It wears the changelog's **style** (Project → Changelog →
Style: the project's own style, or the project's with the changelog's own choices
over it), in light and dark; `data-accent`, `data-radius` and `data-shadow`
override it for one embed, and `data-header="false"` leaves out the logo, title
and description (your page already shows them), and `?accent=`, `?radius=` and `?shadow=` do on the
hosted page. See [Project style](STYLE.md). The same
entries are at `GET /v1/projects/pk_…/changelog.rss` and `GET /v1/changelog?pk=pk_…`;
see [Changelog](#changelog).

## 2b. Your own UI

Every route is in the OpenAPI spec (`/_docs/scalar`, tag *Feedback*).

| | |
|---|---|
| `GET /v1/feedback/config` | Statuses, types, platforms, options, project name/theme, the viewer |
| `GET /v1/feedback` | Posts. Filters: `view` (`board`, `roadmap`, `changelog` — posts marked `showOnChangelog`; **deprecated**, read `GET /v1/changelog`), `status`, `category`, `type`, `platform`, `tag`, `featured`, `mine`, `subscribed`, `q`; `sort` (`top`, `new`, `activity`, `completed`); `limit` ≤ 500, `offset` |
| `POST /v1/feedback` | New post: `{ title, body, type, platform, tags, attachments }` |
| `POST /v1/feedback/attachments` | Upload an image or file (multipart `file`); see *Images and files* below |
| `GET /v1/feedback/:id` | One post with its comments, plus `linked` (the `#N` posts it and its comments mention) and `backrefs` (posts mentioning it). `:id` may be the id, the number (`12` or `12-any-slug`) or the `externalId` it was imported with — in every per-post route |
| `PATCH /v1/feedback/:id` | Edit |
| `DELETE /v1/feedback/:id` | Delete |
| `POST /v1/feedback/:id/vote` | `{ "voted": true }` / `{ "voted": false }` (safe to retry), or `{}` to toggle |
| `POST /v1/feedback/:id/reactions` | `{ key }` toggles a reaction (`+1`, `-1`, `laugh`, `hooray`, `confused`, `heart`, `rocket`, `eyes`); add `reacted` to set it |
| `PUT /v1/feedback/:id/subscription` | `{ subscribed?, muted?, read? }`: follow, unfollow, mute, mark read |
| `GET /v1/feedback/:id/participants?q=` | Who `@` can complete in the thread |
| `POST /v1/feedback/:id/merge` | Admins: `{ into, status? }` merges a duplicate; `{ into: null }` unlinks |
| `GET`/`POST /v1/feedback/:id/comments` | Comments: `{ body, parentId?, replyToId?, visibility? }` |
| `PATCH`/`DELETE /v1/feedback/:id/comments/:commentId` | Edit (`body`; admins also `visibility`) or delete a comment |
| `POST /v1/feedback/:id/comments/:commentId/reactions` | React to a comment |
| `GET`/`PUT /v1/feedback/preferences` | `{ emails }`: the user's feedback email switch |
| `GET /v1/feedback/events` | Server-sent events for the board |
| `GET /v1/changelog` | The public changelog: published entries under their published releases (`?pk=`) |
| `GET /v1/projects/:pk/changelog.rss` | The changelog as RSS |

**Who is asking** decides what they can do:

| Caller | How | Can |
|---|---|---|
| Visitor | `?pk=pk_…` (or `X-Project-Key`) | Read the public board |
| User | `Authorization: Bearer <identity token>` | Post, vote, comment; edit and delete their own |
| Your staff | An identity token with `"role": "admin"` in its claims | Everything a user can, plus statuses, hiding, featuring, locking, pins, merges, team notes, changelog fields, any post or comment. Their comments are marked as the team. |
| Operator | Panel session or `ak_` admin key, plus `?project=<id>` | The same as staff |

`role: "admin"` is your decision, made where you mint the token — it is signed
with the project secret, so a browser cannot add it:

```js
const body = b64({ iss: PUBLIC_KEY, sub: user.id, name: user.name, email: user.email, username: user.handle, avatar: user.avatarUrl, ...(user.isStaff ? { role: 'admin' } : {}), iat: now, exp: now + 3600 })
```

`username` is the handle people `@mention` (never put an email address there:
handles are public); `avatar` is an http(s) image URL. Both are optional.

Things to know:

- Each post carries viewer fields — `hasVoted`, `isMine`, `canEdit`,
  `canDelete`, `canComment`, `canVote`, `subscribed`, `muted`, `unread` (and
  `reacted` per reaction) — so a UI never has to work out permissions itself.
- **Numbers.** Every post gets the board's next `number` (`#12`) and a `slug`
  from its title; `/feedback/12-dark-mode` style URLs resolve by number, so a
  renamed post keeps its links. `#12` in a post or comment is recorded as a
  reference (`refs`), which is how `backrefs` are found.
- **Locked** posts take votes, comments and reactions from admins only.
- **Comments** thread one level deep (`parentId`; `replyToId` names the comment
  answered). Admins can write `internal` notes and `hidden`-moderate comments:
  both reach admins only, never count in `commentCount` and never notify. An
  admin can pin one public top-level comment (`pinnedCommentId` on the post).
  Authors edit their comments while the board allows user edits (`editedAt`).
- **Merging** (`/merge`) moves the duplicate's votes onto the target (each voter
  once), copies its followers, links it as `duplicateOf` and locks it in a
  closed status. Unlinking does not move votes back.
- `adminNote` is a private note on the post, returned to admins only.
- **Bodies are untrusted.** `body`, `changelogBody` and comments are stored as
  sent (Markdown or HTML). Sanitize before rendering (DOMPurify or similar).
- Author names are hidden from the public unless the board shows them;
  admins also get `author.email` and `author.externalId`.
- Hidden posts are invisible to everyone but admins — their authors included —
  and only come back with `includeHidden=1`.
- Authors start with their own vote. Moving a post into a done status for the
  first time stamps `completedAt` (the changelog date); admins can set it.
- **Live events** (`feedback.post.created|updated|deleted`,
  `feedback.comment.created|updated|deleted`) carry posts and comments without
  viewer fields: merge them over your copy. Team notes and hidden comments only
  reach admins; a comment hidden after the fact arrives as `comment.deleted`.
  With `?pk=` the stream works with a plain `EventSource`.

## File cards with AI

The **AI cards** button on a project's Feedback and Planning pages (web and native) opens a chat. Paste or type text (customer emails, reviews, meeting notes, a list) and the AI splits it into separate cards: feedback posts on Feedback, board items on Planning. Each card is filed the way a hand-made one is, so numbers, events and webhooks are the usual ones; posts are authored by the team. You can keep talking to refine or add more.

- It only uses the post types, tags and labels the project defines (and a priority on board items); anything else is dropped, not guessed. It files at most 20 cards per message and treats pasted text as data, never as instructions.
- On Planning it can also **change existing items**: status, priority, labels, title, description, target date and the public flag. It does not touch the assignee, the order or the attachments. It is shown the board's 300 most recently changed items and only changes the ones it names by `#number`, or a card it creates in the same answer by that card's `ref`. A change goes through the same rules as `PATCH /v1/admin/board-items/:id`: a status change still moves linked posts when *Sync linked feedback* is on, and moving an item to done may draft a changelog entry. Values the board does not allow are dropped.
- On Planning it can also **relate items** to each other (`links`), the same as *Relate to another item* in the panel. Related items link both ways.
- Cards and changes that fail are listed in `failed`; the rest are kept, and the chat shows what changed under *Changed*. A message with nothing to file or change creates and changes none.
- **Attachments.** The chat takes images and files too: paste an image, drop files on the attachments field under the chat, or pick them (native: the Photos and Files buttons). They upload through `POST /v1/feedback/attachments`, and send as `attachments` with the message. Every card that message creates gets them (posts and items alike), so they travel with the work. The AI reads the text only, so say in the text what a file is for. A message needs text, and at most 10 files.
- It runs on the workspace's AI provider, or on the server's gateway where it spends AI credits. `501` when no AI is configured, `429` past 10 requests a minute per operator.
- It is an operator tool, so it has no embed. Build your own flow on the API, which needs an operator session or an `ak_` admin key:

```bash
curl -X POST https://helpbites.example/v1/admin/projects/$PROJECT_ID/ai-cards \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"kind":"feedback","messages":[{"role":"user","content":"Customers want CSV export. iOS crashes when I open settings."}]}'
# {"reply":"Filed 2 posts.","created":[{"id":"…","number":41,"title":"Export as CSV"},…],"updated":[],"failed":[]}
```

On Planning, the same call can change and relate items:

```bash
curl -X POST https://helpbites.example/v1/admin/projects/$PROJECT_ID/ai-cards \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"kind":"board","messages":[{"role":"user","content":"Mark #12 done and relate it to #14."}]}'
# {"reply":"Marked #12 done and related it to #14.","created":[],"updated":[{"id":"…","number":12,"title":"Export CSV","changes":["status: done","related to #14"]},{"id":"…","number":14,"title":"Export as CSV","changes":["related to #12"]}],"failed":[]}
```

`kind` is `feedback` or `board`; `messages` is the conversation so far (`user` and `assistant` turns, the last 12 are read, the last must be the user's).

## Images and files

Posts and Planning items can carry up to 10 images and files. Upload each with `POST /v1/feedback/attachments` (multipart field `file`), then pass what it returns as `attachments` when you create or edit the post (`POST`/`PATCH /v1/feedback`) or the board item (`POST`/`PATCH /v1/admin/board-items`). Changelog entries take up to 10 images the same way, as `images` ([Images](#images) under Changelog).

- **Types and sizes.** Images (PNG, JPEG, GIF, WebP) up to 8 MB; PDF, TXT, MD, CSV, LOG, JSON, ZIP, DOC(X), XLS(X), PPT(X), MP4 and MOV up to 25 MB. Files are stored and served as downloads under the type their extension implies, never as HTML. Uploads count against the workspace's storage (`402` when it is full).
- **Who.** Operators (session or `ak_` key, with `?project=<id>`) upload for posts and board items. End users upload with their identity token once their address is verified, and only where the project allows attachments (`403` otherwise); they can attach to their own posts. Each attachment must be one of the project's own uploads (`400` otherwise).
- **Where they show.** In the panel and native editors, and on the post in the public board. Board item attachments are private: the roadmap shows only the public description.
- **Paste and drop.** In the panel, paste an image anywhere while the editor is open, or drop files on the *Images and files* box, and they upload and attach. Changelog entries take images only. Native: the *Paste* button attaches the image on the clipboard.
- **Your own UI.** `attachments` is `[{ url, name, mime, size }]` on every post and item; `PATCH` with the list you want to keep removes the rest.

```bash
curl -X POST "https://helpbites.example/v1/feedback/attachments?project=$PROJECT_ID" \
  -H "Authorization: Bearer $ADMIN_KEY" -F file=@crash.png
# {"url":"https://cdn.example/…/crash.png","name":"crash.png","mime":"image/png","size":48213}
curl -X POST "https://helpbites.example/v1/feedback?project=$PROJECT_ID" \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Crash on launch","attachments":[{"url":"https://cdn.example/…/crash.png","name":"crash.png","mime":"image/png","size":48213}]}'
```

Web (an end user's signed-in post, with the identity token):

```js
const data = new FormData(); data.append('file', input.files[0])
const file = await (await fetch('/v1/feedback/attachments', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: data })).json()
await fetch('/v1/feedback', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title, attachments: [file] }) })
```

Swift (plain `URLSession`):

```swift
func upload(_ data: Data, name: String, token: String) async throws -> [String: Any] {
  let boundary = UUID().uuidString
  var request = URLRequest(url: URL(string: "https://helpbites.example/v1/feedback/attachments")!)
  request.httpMethod = "POST"
  request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
  request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
  var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\n\r\n".utf8)
  body.append(data); body.append(Data("\r\n--\(boundary)--\r\n".utf8))
  let (result, _) = try await URLSession.shared.upload(for: request, from: body)
  return try JSONSerialization.jsonObject(with: result) as? [String: Any] ?? [:]
}
```

Pass the returned dictionary in `attachments` when you post.

## Planning & roadmap

Each project can also use **Planning**: Linear-style items on a kanban, for
the work behind the feedback and the support conversations. The same items
drive the **public roadmap**. Projects without Planning keep the post-based
roadmap (planned, in-progress and done posts).

### In the panel

Project → **Planning** → *Turn on planning*.

- **Items** have a title, an internal Markdown description, a status, a
  priority, an assignee, labels, a target date and a `#number`. Drag a card
  across columns to change its status, or within one to reorder it; the order
  is kept. The tile after the last column adds one: a name and a category, saved
  with the board's statuses (the same list as Settings). Admins drag a column's
  header onto another to reorder them. `?item=<id>` opens an
  item, so links to it can be shared.
- **Unsaved new items** are kept in this browser (the app keeps them on the
  device) until you create the item, and come back when the panel opens again.
  Cmd/Ctrl+Enter creates it. The order you pick (manual, newest or oldest) is
  remembered per project. Cards carry pills for attachments, a description,
  related items and an item filed from an error. Nothing is stored on the server.
- **Links.** An item links up to 50 feedback posts, 50 conversations and 50 other items. In the
  item, *Link post* takes a post's `#N`. In the inbox, a conversation's
  **Planning** section files a new item from it (prefilled with its subject and
  the customer's last message) or adds it to an existing one; the link shows on
  the conversation's timeline as an internal event the customer never sees.
  The feedback post editor has the same **Planning** section.
- **From feedback.** Right-click a post on the Feedback page (list or kanban; long-press in the app)
  for **Create planning item** or **Add to planning item…**, or use the **Planning** button in the
  post's editor. *Create planning item* asks the AI (when the workspace has a provider) to decide
  whether the post is one piece of work or several (at most 5, nearly always one) and to write each
  item's title, Markdown description, **priority** (from the content, votes and comments) and labels
  from the board's own; every item is linked to the post. A toast, or the button's spinner, shows
  while the AI works. With no AI, or if its answer is unusable, you get one item copied from the
  post. A post can feed several items and an item can hold several posts.
- **Related items.** *Relate to another item* in an item's Related items section links it to another item of the board. The link is two-way: both items list each other, and an item cannot relate to itself. It is internal; the public roadmap does not show it. The API takes it as `kind: "item"` on `POST /v1/admin/board-items/:id/links`, and items carry `relatedItemIds` and the resolved `related` list.
- **Edit history.** The collapsed **Edit history** section in the web and native item editors shows each recorded change, the before and after values, who made it, where they made it (web, app, API or MCP), and when. Creating an item, changing any item field, moving it between columns or in column order, changing its links, and adding or removing a two-way related-item link all record history. `GET /v1/admin/board-items/:id/history?project=<id>&limit=50&offset=0` returns entries newest first; `limit` is 1–100 and `nextOffset` is null when there are no older entries. The history is workspace-scoped like the item. Existing items show their current last-modified time, but edits made before this feature was deployed are not available.
- **Comments and threads.** The collapsed **Comments** section in the web and native item editors supports internal comments, replies and up to 10 images or files per comment. Comments never appear on the public roadmap. MCP comments show the connected assistant's name (for example, ChatGPT or Claude); the operator who authorized the connection is retained in the record. `GET /v1/admin/board-items/:id/comments?project=<id>&limit=50&offset=0` returns comments oldest first, including `attachments`, `parentId` and `replyToId`. `POST /v1/admin/board-items/:id/comments?project=<id>` accepts `{ "body": "…", "attachments": [{ "url": "…", "name": "…", "mime": "…", "size": 123 }], "parentId": "…", "replyToId": "…" }`; omit both ids to start a thread, and text may be omitted when an attachment is present. Upload with `POST /v1/feedback/attachments?project=<id>` (multipart `file`, or JSON `{ "filename": "…", "contentBase64": "…" }` for MCP). The API returns a download URL; MCP comment reads return the same URL and metadata. Both comment routes accept an operator session or an admin API key and enforce the same workspace and project scope as the item.
- **Attach feedback by search.** In an item, *Search feedback to attach* finds posts by title,
  text, author or `#N` and links them; the *New item* form takes posts the same way and links them
  on creation.
- **Filed from an error.** The Errors page's **File on board** button makes an item from a
  tracker issue (see [ERRORS.md](ERRORS.md)); its drawer lists the errors it came from, each with
  its link back to the tracker.
- **Commits and pull requests.** When the GitHub App's webhook is on, a commit pushed to the
  default branch or a pull request merged into it that says `#12` is listed on item 12 (or on
  feedback post 12 when the board has no such item), with a *closes* marker for `fixes #12`.
  A closing keyword also moves the item to the board's first done status. See [GITHUB.md](GITHUB.md).
- **Votes.** An item's count is the sum of its linked posts' votes, hidden posts
  left out. People vote on the posts, from the feedback page or from the roadmap.
- **Settings** — statuses (with the same categories as Feedback),
  labels, the roadmap's layout and options, and **Sync linked feedback**: when
  an item moves to another status category, each linked post moves to the
  Feedback's first status of that category, exactly as if an admin had
  moved it — so followers get the usual status emails. Off by default.

The settings are the `board` object on `PATCH /v1/admin/projects/:id` (partial:
`roadmap` merges key by key; `statuses` and `labels` replace their lists).

### From the iOS share sheet

On iPhone and iPad, the app adds **Add to Planning** to the system share sheet. Share a screenshot or photo
(from Photos, the screenshot editor, Files or any app), a web page or some text, and a sheet opens with the
same fields as *New item*: project, title, internal description, status, priority, assignee, target date,
labels (type a new one to create it), images, feedback to attach, and whether it goes on the public roadmap
with its public description. The image you shared is attached and uploaded for you, and *Add images* picks more
(up to 10). A shared link or text is put in the description, and a page's title in the title. The sheet starts on the
project you used last. Only projects with Planning on are offered.

It is a native entry point to the same API, with nothing of its own to call: `GET /v1/admin/projects` (each
project's board, statuses and labels), `GET /v1/admin/agents`, `GET /v1/feedback`, `POST /v1/feedback/attachments`
(one call per image; HEIC and anything over 8 MB is sent as a JPEG that fits), `PATCH /v1/admin/projects/:id` (a new
label) and `POST /v1/admin/board-items`. It signs in with the app's session, which the app shares with the sheet through
an App Group (`group.com.helpbites.operator`): sign in to the app once, and enable the **App Groups** capability on both
targets when you build it yourself. The web panel has no equivalent, since a browser has no share sheet; the panel's
*New item* and the API cover the same ground.

### What goes public

The roadmap is published through the feedback page's public pages and API, so
Feedback must be on, with its Roadmap view.

Switching Planning on does not empty the roadmap: it keeps listing
feedback posts until at least one planning item is public in a planned, active or
done status. From then on Planning's public items are the roadmap.

- Items are **private by default**. Turn on *On public roadmap* per item.
- A public item shows **once its status is planned, in progress or done** (by
  category). Backlog and canceled items, and those statuses' names, never go
  out.
- The roadmap shows only the item's **public description** — never the
  internal one, not even as a fallback — its title, status, completion date and
  the linked posts that are not hidden (with their votes).
- **Labels and target dates are opt-in** (*Show labels*, *Show dates*); the
  timeline layout always sends dates. Numbers, priorities, assignees, ranks and
  conversations never leave the panel.

### Showing it

- **Its own page**: `https://YOUR-SUPPORT-HOST/roadmap/pk_…`, with optional
  `?layout=columns|timeline|list` and `?theme=light|dark|system`. The *Public
  roadmap* button on the board copies the link.
- **In your site**, inline or floating, with the feedback loader:

  ```html
  <div id="roadmap"></div>
  <script src="https://YOUR-SUPPORT-HOST/feedback.js" data-project="pk_…" data-view="roadmap" data-only="roadmap" data-label="Roadmap" data-target="#roadmap" defer></script>
  ```

  Leave out `data-target` for a floating *Roadmap* button. Hand it a token the
  same way as the board (`init` with `getToken`) so signed-in users can vote.
  The full board embed shows the board-driven roadmap in its Roadmap tab too.
- **Layouts**: `columns` (one per status), `timeline` (by target quarter, undated
  last) and `list` (compact rows under status headings). Clicking an item with
  one linked post opens that post (and its vote button); several posts list
  under the card. Vote totals update live.

### The API

- `GET /v1/feedback/roadmap` — `?pk=`, an identity token (adds `hasVoted` per
  post) or an operator with `?project=`. Returns `{ options, statuses, labels?,
  items }`; 404 unless the feedback board offers a roadmap and the project board
  is on. `GET /v1/feedback/config` says which roadmap applies:
  `roadmapSource: "board" | "posts"` (`board` once the board has a public item
  in a roadmap status).
- `GET|POST /v1/admin/board-items?project=<id>` (list, or create with optional
  `feedbackPostIds` / `conversationIds`), `PATCH|DELETE
  /v1/admin/board-items/:id`, `GET /v1/admin/board-items/:id/history`
  (newest first, `limit` 1–100 and `offset`), `POST /v1/admin/board-items/from-feedback`
  (below), and `POST /v1/admin/board-items/:id/links` with
  `{ kind: "feedback" | "conversation", id, linked }`. These take an operator
  session or an `ak_…` admin key, so release scripts and other tools can file
  and move items. The list filters by `&conversation=` or `&feedbackPost=`.
  Moving a card is a `PATCH` with `status` and a `rank` between its new
  neighbours (lower ranks come first).
- `GET /v1/admin/board-items/:id/comments?project=<id>&limit=50&offset=0` lists
  internal comments oldest first. Replies include `parentId` (the thread root)
  and `replyToId` (the specific comment). `POST` to the same path with
  `{ "body": "…", "attachments": [...], "parentId": "…", "replyToId": "…" }`
  adds a comment or reply; omit the ids to start a thread. `attachments` holds
  up to 10 objects returned by `POST /v1/feedback/attachments?project=<id>`;
  uploads accept multipart `file` or JSON `{ "filename", "contentBase64" }`.
  The returned URL is the download URL and also appears in comment reads. Both
  routes use the item's project scope. MCP comments display the assistant named
  by its connection's API key, while retaining the authorizing operator's id
  and name.

`POST /v1/admin/board-items/suggest-title?project=<id>` with `{ "description": "…" }` has the AI propose a short title
(in the description's language) and returns `{ title }`; nothing is saved, so you send it as `title` to
`POST /v1/admin/board-items`. It is what the panel, the app and the iOS share sheet use when you create an item with no
title (the first line of the description stands in when no AI is configured, so creating never stalls), a second after you
stop typing the description of a new item, and from the sparkles button in the title field (which also replaces a title). `501` with no AI
provider, `502` when the AI gives no usable answer, `429` past 30 a minute per project. Metered like every AI call.

`POST /v1/admin/board-items/from-feedback?project=<id>` with `{ "postId": "#12", "ai": true }` files items
for a post and links it to each: `{ item, items, ai }` (`item` is the first; `ai` says whether the AI wrote
them; `"ai": false` copies the post without calling it). It can take several seconds with AI on, is
limited to 20 AI drafts a minute per agent, and the post's text is treated as data, never as instructions.

```sh
curl -X POST -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{"postId":"#12"}' \
  "https://YOUR-SUPPORT-HOST/v1/admin/board-items/from-feedback?project=PROJECT_ID"
```

An item filed from an error carries `errorRefs: [{ provider, issueId, linkId, title, url }]`
(empty otherwise). `GET /v1/admin/github-refs?project=<id>&kind=board|feedback&id=<item or post>`
lists the commits and pull requests that mention it:

```sh
curl -H "Authorization: Bearer ak_…" \
  "https://YOUR-SUPPORT-HOST/v1/admin/github-refs?project=PROJECT_ID&kind=board&id=12"
# { "refs": [{ "kind": "pull_request", "ref": "34", "repo": "acme/web", "title": "Dark mode", "url": "https://github.com/…", "closes": true, "at": "…" }] }
```

**Known limit:** a person who voted on two posts linked to the same item counts
twice in that item's total — the sum is per post, not per person.

## Changelog

What shipped, in your own words. The changelog is its own kind of item, not a
view of feedback posts: an **entry** (title, Markdown text, a type — *New*,
*Improved*, *Fixed*, *Removed* or *Breaking*) optionally belongs to a **release**
(a version, with a title and summary). Project → **Changelog** is where you write
them; the public side reads the same data.

**Nothing is public by default.** An entry is public only when it is
*published* **and** its release, if it has one, is published too. Publishing a
release publishes the draft entries in it (dated with the release); an entry you
unpublish afterwards stays unpublished. A release with nothing published in it
does not show.

### Made from

An entry can link the **feedback posts**, **board items**, and **conversations**
(tickets and error issues) it answers — up to 50 of each. The panel shows each
link's status, so you can see what is done before you publish. Links are the
only connection: **nothing is copied from a source when you link it**, and the
public changelog never mentions them.

*New entry* from a source (the Changelog section of a post, board item or
conversation) starts you off with text that is already public:

| Source | What the new entry starts with |
|---|---|
| Feedback post | its changelog title and text, else its title and text; a type from the post's (`bug` → Fixed, `feature` → New, else Improved) |
| Board item | its title and **public** description (never the internal one) |
| Ticket or error issue | nothing but a type (errors → Fixed). Never the subject, messages or stack trace |

With **auto-draft** on (Project → Changelog → Settings), a feedback post or board
item reaching a done status drafts an entry for it, unless an entry already links
it. Drafts are never published for you. Tickets and errors are always manual.

**Write from commits (AI).** With GitHub repos connected to the project ([GITHUB.md](GITHUB.md)),
*Changelog → From commits* has the AI read the repos' commit messages (never the code) and draft
entries from them: for all commits, or only the last N days, weeks or months. It reads the newest
300 commits of each repo's default branch, ignores merge commits and any commit an entry already
cites, groups related commits, and skips what users would not notice (refactors, CI, dependency
bumps). The entries come back as **drafts** marked *AI*, waiting for review; nothing is public
until you approve one. In the list, select entries to approve several at once or **merge**
them into one new draft (the originals are archived); open one to edit it. Settings has two more
switches: **Write entries from new commits** drafts entries on every push to a repo's default
branch (needs the GitHub webhook), and **Publish them without review** makes those pushes
publish what they write with no human looking. That second one is off by default and only
applies to pushes; the button never publishes. A project's pushes run at most 20 times an hour.
Uses the workspace's AI like every other AI feature (and counts toward its credits).

### Images

An entry can show up to 10 pictures, under its text in the order they are listed. Upload each with the same route as post and board item attachments, `POST /v1/feedback/attachments` (multipart field `file`: PNG, JPEG, GIF or WebP, up to 8 MB), then send what it returns as `images` when you create or edit the entry (`POST /v1/admin/changelog/entries`, `PATCH /v1/admin/changelog/entries/:id`, or an item of `POST …/entries/import`). The list you send replaces the one there; `[]` or `null` removes them all.

- **Where they show.** Under the text on the public changelog page, in `changelog.js` (the plug-and-play embed, and its server-rendered snapshot), in the board embed's changelog tab, and in the panel and native editors. The public API has them as `images` on `GET /v1/changelog` and `GET /v1/changelog/:ref`.
- **Who.** Operators upload them (session or `ak_` key, with `?project=<id>`), as for board items. Only images are accepted: a file (PDF, video…) is `400`, and so is any image that is not one of the project's own uploads. Uploads count against the workspace's storage (`402` when it is full).
- **Width.** Project → Changelog → Settings → *Image width* (or `PATCH /v1/admin/projects/:id {"changelog":{"imageWidth":"medium"}}`): `full` (the whole column, the default), `medium` (60%) or `small` (35%). It applies on the public changelog page, in `changelog.js` (and its snapshot) and in the board embed. `GET /v1/changelog` returns it as `imageWidth`.
- **Your own UI.** `images` is `[{ url, name, mime, size }]`, in order. `imageUrl` is still returned: the first image's url, or `''`. Sending `imageUrl` is `400` and says to upload the picture and send it as `images`. An entry saved before `images` existed, with one external `imageUrl`, shows that picture as its only image.

```bash
curl -X POST "https://helpbites.example/v1/feedback/attachments?project=$PROJECT_ID" \
  -H "Authorization: Bearer $ADMIN_KEY" -F file=@csv-export.png
# {"url":"https://cdn.example/…/csv-export.png","name":"csv-export.png","mime":"image/png","size":48213}
curl -X PATCH "https://helpbites.example/v1/admin/changelog/entries/7?project=$PROJECT_ID" \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"images":[{"url":"https://cdn.example/…/csv-export.png","name":"csv-export.png","mime":"image/png","size":48213}]}'
```

### Telling the people it answers

Two things happen when an entry goes public, and a third is yours to press.

- **Followers of the posts it answers are emailed, once.** The posts the entry links, and the
  posts of the board items it links, are looked up; everyone following one of them (and not
  muted, not opted out of feedback mail, with an email) gets one "Shipped: …" mail with the
  entry's title and summary, a link to the public entry, and the posts they follow, listed.
  Someone following several of them gets one mail, not several. It uses the feedback board's
  switch (*Email notifications*) and the project's mailer, exactly like a status change. The
  event `changelog.entry.published` ([EVENTS.md](EVENTS.md)) is what triggers it. An entry counts
  as becoming public when it is created published, edited to published, approved, or when its
  draft release is published. Imports never mail. An entry published more than seven days
  ago (a backdated one) is history and is not mailed. Delivery is at-most-once, like the
  subscribers' mail: the entry is marked (`followersNotifiedAt`) before anything is sent, so
  a retry or a second server never mails twice, and a failed send is logged, never retried.
  This is separate from `changelog.notify`, which is about people who subscribed to the
  changelog itself; a follower who is also a subscriber can get both.
- **The same posts learn the version** (`shippedIn`), as before.
- **Reply to the linked conversations (a button, never automatic).** Once an entry is public
  and answers conversations (its own links, plus the conversations of its board items), the
  editor shows **Reply to N linked conversations**: a dialog with the list (untick any) and a
  message that starts as the entry's title and public address, yours to edit. Sending appends
  that message as the team to each conversation, through the same path as an inbox reply, and
  emails the customer unless you turn *Email them too* off. Error issues are left out (there is
  no customer). Sending the same words to the same conversation twice is a no-op.

```sh
# Who would be told
curl -H "Authorization: Bearer ak_…" \
  "https://YOUR-SUPPORT-HOST/v1/admin/changelog/entries/ENTRY_ID/linked-conversations?project=PROJECT_ID"
# { "count": 2, "conversations": [{ "id": "…", "subject": "Dark mode?", "endUserName": "Ada", "status": "open" }], "defaultBody": "Good news: “Dark mode” has just shipped.\n\nSee what changed: https://…" }

# Tell them (conversationIds optional: default is all of them)
curl -X POST -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  "https://YOUR-SUPPORT-HOST/v1/admin/changelog/entries/ENTRY_ID/reply-conversations?project=PROJECT_ID" \
  -d '{ "body": "Dark mode is live, thanks for asking!", "notifyByEmail": true }'
# { "sent": 2, "failed": 0, "results": [{ "conversationId": "…", "ok": true, "emailSent": true, "error": "" }] }
```

These are operator tools (an admin session or `ak_` key), not something a visitor's browser
calls, so there is no embed snippet for them; the public side of an entry is the changelog
page and `public/changelog.js` described below.

### Public

| | |
|---|---|
| Page | `https://YOUR-SUPPORT-HOST/changelog/pk_…` |
| JSON | `GET /v1/changelog?pk=pk_…`: `{ releases: [{ version, title, summary, publishedAt, entries }], entries }` — `entries` are the published ones that belong to no release |
| Flat list | `GET /v1/changelog?pk=pk_…&flat=1`, or any of `limit` (≤100), `skip`, `tag`, `area`, `version` (a release's), `since`: `{ entries, total, hasMore }`, newest first, each entry carrying its release's `version` |
| One entry | `GET /v1/changelog/:ref?pk=pk_…` by slug, `#N` number or id |
| RSS | `GET /v1/projects/pk_…/changelog.rss`, one item per published entry |
| In your page | `changelog.js` (a read-only embed that grows with its content; no board needed), the board embed's *Changelog* tab, or your own UI on the JSON above |

All of them need the changelog to be public: `changelog.enabled` (Project →
Changelog → Settings, or `PATCH /v1/admin/projects/:id {"changelog":{"enabled":true}}`).
It is its own switch: the feedback board's *Changelog* option only adds a tab to
the board, and only when this is on. (Projects that were public through the
board were switched on by `scripts/migrate-changelog-public.mjs`.) A public entry carries `slug`, `summary`,
`bodyHtml` (the text rendered and **sanitised once, when it was saved**: put it
in your page as it is), `excerpt`, `area`, `pinned`, `iconGlyph`, `accentColor`,
`images`, `imageUrl`, `links` and `commentCount` besides its title and tag (`images` are its pictures, in order; `imageUrl` is the first one's url; the response's `imageWidth` is the project's image width); never what it
was made from, its commits or its review. `body` is still the source (Markdown, or
HTML when `bodyFormat` is `html`). Anonymous responses may be cached for a minute;
anything sent with a token is `no-store`.

### API (writers)

Who may change the changelog (`?project=<id>` names the project for an operator; the secret and an admin token act on their own):

- an operator: an admin session or `ak_` key;
- your server: the project secret (`sk_…`), whose entries are marked `source: "internal"` and authored `automated`;
- your staff in their browser: an identity token with `"role": "admin"` (the entry is theirs).

Every route is in the OpenAPI spec, tag *Changelog*.

| | |
|---|---|
| `GET`/`POST /v1/admin/changelog/entries` | List (filters: `status` — `draft`, `published` or `archived`; none lists all but the archived — `release` — an id or `none`, `feedbackPost`, `boardItem`, `conversation`) or create `{ title, summary, body, bodyFormat, tag, area, slug, status, releaseId \| releaseVersion, publishedAt, pinned, iconGlyph, accentColor, images, links, commitShas, feedbackPostIds, boardItemIds, conversationIds }` (`images`: [Images](#images)) |
| `PATCH`/`DELETE /v1/admin/changelog/entries/:id` | Edit (the id, the slug, or the `#N` number) or delete. Set `status: "archived"` to retire an entry instead: never public, but it keeps its slug and its commits |
| `POST /v1/admin/changelog/entries/:id/review` | `{ action: "approve" \| "reject", notes }` on a draft: approve publishes it, reject keeps it a draft marked `rejected`. Records who and when |
| `POST /v1/admin/changelog/entries/batch` | Up to 50 entries; one that cites a commit an entry (an archived one too) already cites is **skipped** |
| `POST /v1/admin/changelog/entries/import` | Secret or operator only. Up to 100 entries with your own `externalId`: created, or updated when it exists. Keeps the `slug` and `publishedAt` it is given and the review trail; never drafts, links or tells anyone |
| `POST /v1/admin/changelog/entries/merge` | `{ refs: [2–10 entries], entry }`: creates the merged entry, which also cites the sources' commits, and archives the sources. Writing the merged text is yours |
| `POST /v1/admin/changelog/entries/:id/links` | `{ kind: "feedback" \| "board" \| "conversation", id, linked }` |
| `GET /v1/admin/changelog/entries/:id/linked-conversations` | Operator or `ak_` key. `{ count, conversations: [{ id, subject, endUserName, status }], defaultBody }`: the customer conversations the entry answers, its own and its board items' |
| `POST /v1/admin/changelog/entries/:id/reply-conversations` | Operator or `ak_` key. `{ body, conversationIds?, notifyByEmail? }` → `{ sent, failed, results }`: replies as the team to each chosen conversation (all linked ones when omitted; up to 100) |
| `GET`/`POST /v1/admin/changelog/releases` | List or create `{ version, title, summary }` |
| `PATCH`/`DELETE /v1/admin/changelog/releases/:id` | Edit, or delete (its entries stay, with no release) |
| `POST /v1/admin/changelog/releases/:id/publish` | Publish the release and its draft entries |
| `POST /v1/admin/changelog/releases/:id/suggest` | Operator, `ak_` key or secret. The AI reads the release's entries (drafts and published, up to 150) and returns `{ title, summary }`. Nothing is saved: keep it with `PATCH` on the release. `400` when the release has no entries, `501` without an AI provider, `502` when the model's answer is unusable; 20 a minute per project. The release editor's AI button in the panel and the app calls it |

A release script is two calls: create the release, then post each entry with
`releaseId`, then publish the release. If you think in versions rather than release
objects, send `releaseVersion` instead: the release of that version is found, or
created already published. `slug` is the entry's URL key (from the title unless you
send one, suffixed `-2`, `-3`… when taken, and never one the API or `changelog.reservedSlugs`
owns); it does not move when the title is edited. `changelog.areas`, when it lists any,
limits `area` to those.

### Comments

Readers can comment on a published entry when the project turns them on
(`changelog.comments`, off by default). A comment is written by a **signed-in
user**: an identity token, never the project secret, because a comment has an
author (the token's `sub`, shown as `authorId`; the name and avatar come from the
user's current profile). Markdown only, up to 4,000 characters, rendered once with
a strict allowlist: raw HTML is escaped, and there are no images, headings or tables,
at most 6 links (all marked `nofollow ugc`). Five comments per ten minutes per user,
and the same text twice in a row on one entry is a 409.

| | |
|---|---|
| `GET /v1/changelog/:ref/comments` | A thread, oldest first, `?limit` ≤ 100 and `?skip`: `{ comments, total, hasMore }`. Public with `?pk=`; a token adds `viewerIsAuthor`; an admin token or operator also sees `hidden` ones |
| `POST /v1/changelog/:ref/comments` | `{ body }` → `201 { comment, commentCount }`. Only on a public entry |
| `PATCH /v1/changelog/comments/:id` | `{ body }` is the author editing their own words (a moderator cannot rewrite them; the comment then shows as edited); `{ status: "hidden" \| "visible" }` is moderation, for an admin token or operator |
| `DELETE /v1/changelog/comments/:id` | The author, an admin token or an operator. The words go and the comment stops being returned; the row stays |
| `POST /v1/admin/changelog/comments/import` | Secret or operator only. Up to 100 comments `{ externalId, entry, body, status, authorId, authorName, authorAvatar, authorIsStaff, postedAt, editedAt }`: created or updated by `externalId`, keeping author, date and status; no rate limit, no notification |

An entry's `commentCount` is recomputed from its visible comments on every
change, never incremented. `changelog.commentNotify` (up to 5 addresses) is told
about each new comment that is not the team's own, when the project can send mail.
Erasing an end user (`DELETE /v1/end-users/:externalId`) deletes their changelog
comments too.

### Notifications

With `changelog.notify` on, people can ask to be emailed about the changelog: an
**instant** mail once a burst of publishes has gone quiet, or a **weekly** digest on
Monday morning. It is off by default, and also needs the server to have
`CHANGELOG_LINK_SECRET` (32+ characters) or `HELPBITES_SECRET` to sign its links
(and `ENABLE_CHANGELOG_NOTIFY=true` for the scheduler). A post's changelog title,
text and version (`changelogTitle`, `changelogBody`, `shippedIn`) stay blank for
everyone but admins until the post is on the changelog.

- **Signed in**: send their identity token (it carries an email). They are subscribed
  at once at `instant` or `weekly`, or `off` unsubscribes them. `GET /v1/changelog/subscription`
  says their cadence (`null` when none).
- **Anonymous**: `?pk=` and an `email`. Double opt-in: the address gets a confirm link
  (your `changelog-confirm` email template) and nothing is active until it is clicked.
  The answer is always `{ ok: true }`, whether or not the address is already subscribed;
  a repeat inside a day sends no second mail; ten requests an hour per IP and thirty
  confirm mails an hour per project.
- **Hosted pages** take the links by default: `/u/changelog/confirm/<token>` and
  `/u/changelog/unsubscribe/<token>` on this server (it needs `APP_URL`), in the project's accent
  and logo. Each shows one button, so a mail scanner opening the link changes nothing.
- **Or your own pages.** Set `changelog.confirmUrl` and `changelog.unsubscribeUrl` (an http(s)
  URL or `{siteUrl}/…`, containing `{token}`; `''` goes back to the hosted pages) and the mails
  point there instead. Your pages `POST` the token (from a click or button, never on load:
  mail scanners prefetch links) to `/v1/changelog/subscribe/confirm` and
  `/v1/changelog/subscribe/unsubscribe`. Every digest also carries an RFC 8058 `List-Unsubscribe`
  header pointing at the unsubscribe route on this server, which a mail provider POSTs with no
  page and no script. Confirm links expire after seven days; unsubscribe links never do.

| | |
|---|---|
| `POST /v1/changelog/subscribe` | `{ frequency: "instant" \| "weekly" \| "off", email }` (see above) |
| `GET /v1/changelog/subscription` | The signed-in user's `{ frequency }` |
| `POST /v1/changelog/subscribe/confirm` | `{ token }` → `{ frequency }` |
| `POST /v1/changelog/subscribe/unsubscribe` | `{ token }` or `?token=` → `{ ok: true }` |
| `GET /v1/admin/changelog/subscriptions/summary` | Counts: active `instant`, `weekly`, `pending`, `unsubscribed` |
| `POST /v1/admin/changelog/subscriptions/import` | Secret or operator only: `subscriptions` (up to 500) and past `runs`; created, or updated by `externalId`/email. Someone who unsubscribed here is never reactivated by an import, so a stale copy can be re-run safely; nobody is emailed |
| `POST /v1/admin/changelog/generate` | `{ days? }`: have the AI draft entries from the project's GitHub commits (all, or the last `days`). Background; always drafts (`aiGenerated: true`). `GET` returns `{ run }`: `running` / `done` / `failed`, with `created` and `skipped` |
| `POST /v1/admin/changelog/notify/run` | `{ job: "instant" \| "weekly", dryRun, now }`: run a beat by hand, or only report what it would do |

**What goes out and when.** A publish (an entry created published, a draft approved or
moved to published, a release published) stamps the entry; imports never do. The instant
sweep mails the stamped entries once the newest has waited `digest.quietMinutes` (30) or the
oldest `digest.maxWaitMinutes` (60), as one email; entries published more than a week ago are
history, not news. The weekly digest covers the previous Monday-to-Monday week in
`digest.timezone`, from `digest.weeklyHour` on Monday, once (a ledger row stops a second send).
An entry in a draft release waits for the release. Delivery is at-most-once: a run that crashes
mid-send is abandoned without resending, because a lost note beats the same note twice. Two
templates carry the design, in your project's email templates: `changelog` (variables
`subjectLine`, `preheader`, `firstName`, `intro`, `entriesHtml`, `changelogUrl`, `footerNote`,
`unsubscribeUrl`, `oneClickUnsubscribeUrl`) and `changelog-confirm` (`cadence`, `confirmUrl`). The
words (`changelog.siteName`, `changelog.copy`) are yours to change; the defaults are neutral
("We just shipped…"). Erasing an end user deletes their subscriptions too: the ones tied to their
user id and the ones made with their address alone.

### Moving a changelog over

Before entries existed the changelog was posts with `showOnChangelog` (and
`changelogTitle`, `changelogBody`, `shippedIn`). Those fields still exist and
`GET /v1/feedback?view=changelog` still answers, but nothing public reads them
any more. Copy them into entries once, after deploying:

```bash
bun scripts/backfill-changelog.mjs           # dry run
bun scripts/backfill-changelog.mjs --apply   # write
```

Every done, visible, marked post becomes a published entry linked to it, dated
with the post's `completedAt`; posts sharing a `shippedIn` get a published
release of that version. It is idempotent and does not change the posts. Until
you run it, a changelog that lived on posts shows nothing.

## Notifications

With email notifications on (and Mailgun configured) HelpBites emails a post's
**followers**. Its author follows it on posting, commenters on commenting, and
anyone `@mentioned` on being mentioned; anyone can follow, unfollow or mute
through `/subscription`.

- Followers, when it moves into a status with the bell on;
- followers, when someone posts a public comment;
- people `@mentioned` in a comment (only the thread's own participants can be
  mentioned) get a mention email instead of the comment email.

- followers, once, when a changelog entry that answers the post (or a board item that links it)
  goes public: a "Shipped: …" mail with the entry's title and a link to it (see *Telling the
  people it answers* under Changelog).

Never the person who acted, never for team notes or hidden posts. Only people
whose identity token carried an `email` can be emailed, and
`PUT /v1/feedback/preferences { "emails": false }` turns all of it off for one
user. One person hears about one post at most every ten minutes per kind.

## Moving an existing board over

`POST /v1/feedback/import` with the **project secret**, up to 100 posts a call:

```js
await fetch(`${HOST}/v1/feedback/import`, {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.HELP_BITES_SECRET}`, 'content-type': 'application/json' },
  body: JSON.stringify({ posts: [{
    externalId: 'legacy:8Jd2kQ',          // upsert key: re-running converges
    number: 12,                            // keep old #12 links (optional)
    title: 'Export as CSV', body: '<p>…</p>', type: 'feature', platform: 'web', tags: ['export'], status: 'planned',
    author: { externalId: 'user_42', name: 'Ada', email: 'ada@example.com', username: 'ada', avatarUrl: 'https://…', emailOptOut: false },
    createdAt: '2024-03-01T10:00:00Z', editedAt: null, completedAt: null,
    hidden: false, featured: false, locked: false, showOnChangelog: false, shippedIn: '', adminNote: '',
    votes: ['user_42', 'user_7'],          // exactly these voters
    reactions: { '+1': ['user_7'] },       // exactly these reactions
    subscriptions: [{ externalId: 'user_42' }, { externalId: 'user_7', muted: true }], // exactly these followers
    pinnedCommentExternalId: 'c1',
    duplicateOfExternalId: null,           // the post this one duplicates; import it first
    comments: [
      { externalId: 'c1', body: 'Yes please', author: { externalId: 'user_7' }, isTeam: false, createdAt: '2024-03-02T09:00:00Z' },
      { externalId: 'c2', body: 'Agreed', author: { externalId: 'user_9' }, parentExternalId: 'c1', replyToExternalId: 'c1', reactions: { heart: ['user_7'] } },
      { externalId: 'c3', body: 'Check the export queue first', isTeam: true, visibility: 'internal' }
    ]
  }] })
})
```

Authors and voters are your own user ids — the `sub` your tokens will carry —
so people keep their posts and votes when they next sign in. Without
`subscriptions` a post's author and public commenters follow it. Posts without
a `number` take the next free one, and the board's counter moves past every
imported number. Imports never send notifications.

The board must already define every `status`, `type`, `platform` and tag key the
posts use (set them first with `PATCH /v1/admin/projects/:id`); an unknown key
fails that post. Check `GET /v1/feedback/config?pk=` before a large import. Release scripts publish changelog entries with
`POST /v1/admin/changelog/entries` (see [Changelog](#changelog)), not by importing posts.

## Account deletion

Email-only users (see `docs/CONNECTING.md`) erase themselves with `DELETE /v1/anonymous/me`. For users your server signs in:

`DELETE /v1/end-users/:externalId` with the project secret removes everything
that user left in the project: their posts (with the votes, comments and
followers on them), their comments, votes, reactions and follows elsewhere,
their support conversations, and the end-user record. Call it from your own account-deletion flow.

## Upgrading a board from before numbers and follows

Boards created before post numbers and follows existed need one backfill after
the deploy (after `bun run schema:apply`):

```sh
bun scripts/backfill-feedback.mjs          # dry run
bun scripts/backfill-feedback.mjs --apply  # number old posts, add follows
```

It numbers unnumbered posts oldest first and makes each post's author and
commenters follow it, so emails keep reaching the people they did before.
