# Blog and newsletter

Write posts in the panel's editor and publish them on a hosted blog at
`/blog/<public key>`, inside your own site with one script tag, in an RSS feed,
and in your subscribers' inboxes. Readers react to posts and comment on them.
Much of what Ghost does is here: standalone pages, featured and members-only
posts, a designed front page with navigation and search, what search engines
see, a sitemap, publish-and-email, and an import from Ghost.
Panel: **Project → Blog** (Posts, Pages, Comments, Design, Settings); the native
app has the same screens.

Everything here is in both editions. In HelpBites Cloud, emailing a post to
subscribers is a campaign, so it needs a plan with campaigns (Pro); the blog,
comments, reactions and RSS are on every plan.

## Setup

1. **Project → Blog → Settings → Public blog** on. Until then nothing is public,
   not even published posts.
2. Optionally name it and describe it (the name shows at the top and in the
   feed; it defaults to "<project> blog").
3. Pick what readers may do: **Reactions** and **Comments** (both on by default),
   and who is emailed about new comments.
4. If your posts also live on your own site (rendered from the API), set
   **Post address on your site**, for example `{siteUrl}/blog/{slug}`. The feed,
   the newsletter and the hosted page's canonical link then point there.
5. **Design**: the hosted blog's layout, typeface, colours, logo, cover,
   navigation, social links and footer (below).
6. Moving from Ghost? **… → Import from Ghost** (below).

## Writing

The editor is Nuxt UI's (TipTap): headings, bold, italic, strikethrough, code,
lists, quotes, code blocks, dividers, links and images. Type `/` for blocks;
select text for the formatting bubble. Images are uploaded to the project's
storage (8 MB each, PNG, JPEG, GIF or WebP); they count against the workspace's
storage. See [Smaller images](#smaller-images-and-modern-formats) to send them
smaller.

- **Saved as Markdown.** That is what the API takes and returns as `body`. It is
  rendered once on save into `bodyHtml`, through an allowlist: no scripts,
  forms, inline styles or event handlers, and no frames except a YouTube or
  Vimeo player (sandboxed; in the newsletter it becomes a link to the video). An
  `h1` in the body becomes an `h2` (the title is the page's `h1`).
- **Or HTML.** A post imported from Ghost keeps its HTML (`bodyFormat: "html"`);
  the editor edits it as HTML, and it goes through the same allowlist. The API
  takes `bodyFormat: "html"` too.
- **Drafts save themselves** a moment after you stop typing. A **live or
  scheduled** post keeps your edits until you press **Update**, so half a
  sentence never goes public. ⌘S / Ctrl+S saves either way.
- **Write with AI.** The **Write with AI** button (web and the native app) reads
  the project's connected GitHub repos (read-only: README, manifests and file
  list, three repos at most) and the post as it stands, and proposes Markdown:
  **write** a whole post from a one-line brief, **continue** it, **improve** its
  text, or suggest a **title, excerpt, search description and tags**. Nothing is
  saved until you apply the proposal to the editor, where it saves like any
  edit. In the web editor it is also a block: type `/` and pick **Write with AI**
  to describe a passage for the cursor, or select text and press the sparkle in
  the formatting bubble to rewrite just that (say how, or leave it empty to tidy it). It runs on the workspace's AI provider (or the server's gateway, in AI
  credits), is told not to invent features the repos do not show, and is not
  offered for a post kept as HTML. See [over the API](#write-with-ai-over-the-api).
- **Settings beside the editor**: status, publish date, address (`slug`),
  **Featured**, **Who can read it** (everyone, or members only), excerpt, cover
  image and its alt text, up to 10 tags, author, whether the post takes
  comments, and **Search and social**: a title and description for search
  engines (with a preview), the image link previews show, and a canonical
  address for a post that first appeared elsewhere. Each falls back to the
  post's own when empty.

## Smaller images and modern formats

An upload can be re-encoded on the way in (**Image uploads** in the panel, next to
the cover and design pickers and in the editor; remembered in the browser, smaller
by default). Over the API it is off unless asked, with `POST /v1/admin/blog/images`:

| Field (or query parameter) | |
|---|---|
| `compress=true` | One file: WebP at quality 80, scaled down to 2560 px when larger. A GIF is kept as sent, and so is any file that would not come out smaller. |
| `formats=avif,webp` | A set for a `<picture>`: the formats asked for that came out smaller than the fallback (AVIF, then WebP), and the **fallback** every browser, app and mail client reads: a JPEG for a JPEG, a PNG for anything else (so transparency survives). Implies `compress`. |

The answer adds `compressed` and `originalSize`; with `formats`, `url` is the
fallback, `variants` lists every stored file (most efficient first, the fallback
last) and `picture` is a ready-made `<picture>`. Every file counts against the
storage; the 8 MB limit is on what was sent.

```bash
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/blog/images \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -F project=PROJECT_ID -F formats=avif,webp -F file=@shot.png
# { "url": ".../x.png", "variants": [{ "format": "avif", "url": ".../x.avif", … }, { "format": "webp", … }, { "format": "png", … }],
#   "picture": "<picture><source type=\"image/avif\" srcset=\".../x.avif\"><source type=\"image/webp\" …><img src=\".../x.png\" …></picture>", … }
```

A post's body allows `<picture>` and `<source>`, so paste `picture` into an HTML
post (or into Markdown, which passes it through the same filter) and readers get
the smallest format their browser reads. The editor's own uploads always send one
smaller file. The newsletter keeps only the fallback `<img>`.

## Your own data on a post

A post can carry a JSON object of your own, `data` (up to 200,000 characters as
JSON), for a site that renders its posts itself from the API: steps, a gallery,
settings, anything the Markdown body can't say. It is saved with `POST` /
`PATCH /v1/admin/blog/posts`, `null` clears it, and it comes back as `data` on
the post (admin) and on `GET /v1/blog/<slug>` (public, with `bodyHtml`; not in
the list, and not on a post that is `locked`). The hosted blog, the embed, the
feed and the newsletter ignore it. Keep the body readable on its own: that is
what they show.

## Publishing

| | |
|---|---|
| **Publish** | Live now. The date is now unless you set one. |
| **Schedule** | Publish with a later date: it goes live on its own at that moment (the hosted page, the API and the feed all wait for it). |
| **Publish and email** / **Schedule and email** | The arrow beside Publish: publishes (or schedules) and opens the newsletter. A scheduled post's newsletter waits for it. |
| **Unpublish** | Back to a draft (… menu). The date stays for when it comes back. A newsletter scheduled with it goes back to a draft too. |

The `slug` comes from the title ("Cómo empezar" → `como-empezar`). A slug another
post has gets `-2`, `-3`…; `comments`, `rss`, `feed`, `tags` and `subscribe` are
reserved. Changing the slug of a live post breaks links to the old one.

The **excerpt** is the lead-in on the list, in the feed and in link previews. Leave
it empty and it is taken from the text (headings left out), and follows the text
as you edit.

A **featured** post is shown first: large above the rest on the magazine layout,
marked on the others; `?featured=true` on the API lists only those.

## Pages

**Pages** (the tab next to Posts) are for what stands on its own: About, Contact,
a reading list. They are written and published like posts and live at the same
addresses (`/blog/<pk>/about`), but stay out of the list, the feed, the
newsletter and webhooks, and take no comments, reactions, tags or author. Link
them from the blog's navigation (**Design → Navigation**, `/about`). The API
lists them with `?type=page`.

## Members-only posts

Set **Who can read it → Members only** and everyone sees the title, excerpt and
cover, while the rest is for members: a user your app signed in (an identity
token, as for comments) or a reader who confirmed their email with the 6-digit
code (needs **Allow email-only users**). On the hosted page the post shows its
lead-in and a sign-in; once the reader is in, the rest appears in place. The API
returns such a post `locked`, without `bodyHtml`, until then; the feed carries
only its excerpt and a link; its comments are for members too. Search engines are
told it is behind a sign-in (`isAccessibleForFree: false`), so the gate is not
read as cloaking.

There are no paid tiers (yet): members-only means signed in, not paying.

## Readers: reactions and comments

Reading is open to everyone. Reacting and commenting need to know who the reader
is, in one of two ways:

- **Your user, signed in on your site.** Hand the embed the same identity token
  the chat uses ([CONNECTING.md](CONNECTING.md)): your server signs it with the
  project secret. Comments then carry your user's name and avatar. The `role:
  "admin"` claim marks your own staff, who also moderate.
- **Just an email address.** With **Project → Settings → Allow email-only users** on,
  readers of the hosted blog (or of an embed without `getToken`) sign in with
  their address; after a few writes they confirm it with a 6-digit code.

Reactions are ❤️ 👍 🎉 😄 🚀 👀, one of each per reader, toggled. Comments are
Markdown, up to 4,000 characters, rendered with a strict allowlist (no raw HTML,
images or headings, at most 6 links). Replies are one level deep: a reply to a
reply joins the thread of the comment it answers.

Rules:
- Five comments per ten minutes per reader; the same text twice in a row on one
  post is refused (409).
- The author edits and deletes their own comment. A deleted comment's words are
  gone; replies to it stay.
- **Moderation**: **Project → Blog → Comments** lists every comment, newest first.
  Hide (only the team then sees it), show, delete, or reply: the team's comments
  are marked **Team**.
- **Close a thread** per post (Comments on this post), or turn comments off for
  the whole blog. Old comments stay readable.
- A person erased with `DELETE /v1/end-users/{externalId}` (or from their contact)
  loses their comments and reactions too.

## Newsletter

Any published post can go to your subscribers: **Send as newsletter** beside the
editor (admins). It becomes a campaign ([MARKETING.md](MARKETING.md)), so it has
everything campaigns have: one message per subscribed contact with an email,
topics, segments, test sends, pause and cancel, the delivery log and its numbers,
under **Email → Campaigns**.

- The email is built from the post when sending starts: your logo, the title,
  date and reading time, the cover, the body (styled for mail clients), a
  **Read it on the blog** button and the footer with the unsubscribe link, the
  preferences link and your postal address.
- **Postal address required** (Email → Settings), as for every campaign.
- **Audience**: subscribed contacts with an email. **Topic** (default: the blog's
  **Default topic**) leaves out whoever opted out of it; a **segment** narrows it.
- **Send now**, **Schedule**, or **Save as a draft** to send a test from the
  campaign first. For a scheduled post, **Send when published** schedules the
  email for the moment the post goes live, and a later time is fine, an earlier
  one is not; reschedule the post later and the email follows.
- **A post goes out once.** A draft campaign is reused if you send again; only a
  canceled one can be replaced. Editing the post afterwards changes the blog, not
  the email that went.

Readers subscribe through the sign-up form under each hosted post (**Sign-up
form under posts** in Settings), any other sign-up form of yours
([MARKETING.md](MARKETING.md)), or your own app.

## RSS

`GET /v1/projects/<public key>/blog.rss`: the latest 30 live posts, newest first,
as RSS 2.0 with their full HTML (`content:encoded`), cover, author and tags. A
members-only post carries its excerpt and a link instead of its body; pages are
left out. The hosted pages link to it for feed readers.

## The hosted blog

`/blog/<public key>` is server-rendered HTML, readable without JavaScript and
meant to be indexed. **Project → Blog → Design** sets how it looks:

| | |
|---|---|
| **Layout** | **List** (one column), **Grid** (cards), or **Magazine** (the newest featured post, or the newest post, large above a grid). |
| **Typeface** | Sans serif or serif, for the whole blog. |
| **Colour scheme** | Follow the reader's system, or always light or dark. |
| **Accent colour** | Links, buttons and tags; the project's accent unless you pick one. |
| **Logo** and **cover image** | Beside the name, and a wide image across the top of the front page. |
| **Navigation** | Up to 8 links in the header: `/` (the blog), `/<page slug>` (a page), or any address. |
| **Social links** | X, Bluesky, Mastodon (with `rel="me"`, so Mastodon verifies it), GitHub, LinkedIn, Instagram, YouTube, a website. |
| **Footer** | A line at the bottom of every page. |

Beyond the look, every page has a search box (`?q=` finds words in titles,
excerpts and tags; result pages are `noindex`), tag pages (`?tag=`), and paging.
A post has its date, author and reading time, its tags, **Newer** and **Older**
links, and up to three **Keep reading** posts that share a tag. For search
engines and link previews: the title, description, image and canonical address
from **Search and social**, Open Graph and Twitter cards, and structured data
(`Blog`, `BlogPosting`, `WebPage`). The sitemap is
`/blog/<public key>/sitemap.xml` (shown in Settings), listing the front page and
every live post and page whose canonical copy is the hosted one: hand it to
Google Search Console.

The design is the hosted blog's. The embed takes your page's look instead, and
the layout (`layout` below).


## Put it on your site

One script tag draws the blog inside your page, no iframe, so it takes your
page's width and fonts. The list opens each post in place, with its reactions,
comments and the sign-up form; the open post is kept in the URL (`?post=slug`),
so links and the Back button work.

```html
<div id="blog"></div>
<script src="https://YOUR-SUPPORT-HOST/blog.js" data-project="pk_…" data-target="#blog" defer></script>
```

To let your signed-in users react and comment:

```html
<script>
  window.HelpBitesBlog = window.HelpBitesBlog || []
  HelpBitesBlog.push(['init', {
    getToken: () => fetch('/api/support/token').then(r => r.ok ? r.json() : null).then(r => r && r.token),
    onSignIn: () => openYourLoginModal()   // a signed-out reader tried to write
  }])
  // After your user signs in or out:
  HelpBitesBlog.push(['refresh'])
</script>
```

Already rendering posts yourself (from the API, for SEO)? Add only what goes
under one:

```html
<div id="extras"></div>
<script src="https://YOUR-SUPPORT-HOST/blog.js" data-project="pk_…" data-view="extras" data-post="my-post-slug" data-target="#extras" defer></script>
```

### Options

As `data-*` attributes or in `init`:

| Option | |
|---|---|
| `project` | The public key. Required. |
| `target` | A selector; without it the blog is drawn where the script tag is. |
| `view` | `blog` (the list; the default), `post` (one post with everything) or `extras` (reactions, comments and sign-up only). |
| `post` | The slug, for `post` and `extras`. |
| `tag` | Only posts with this tag. |
| `q` | A search, as if typed in the search box. |
| `layout` | `list`, `grid` or `magazine` (the first post across the top); defaults to the hosted blog's. |
| `body` | With `view="extras"` under your own copy of a members-only post: a selector the post's HTML goes into once the reader may read it. |
| `limit` | Posts per page (10). |
| `theme` | `system`, `light` or `dark`; defaults to a `dark`/`light` class on your `<html>`. |
| `accent` | A colour; defaults to the project's. |
| `radius` | Corner radius in px (14). |
| `font` | `inherit` (your page's; the default), `system`, `serif` or `mono`. |
| `show` | Which parts: `cover,excerpt,tags,author,date,badges,search,reactions,comments,subscribe`. |
| `deep-link-param` | The URL parameter an open post is kept in (`post`). |
| `host` | Where HelpBites is, when you serve `blog.js` from your own site (it is MIT). |
| `labels` | `init` only: any of the words, e.g. `{ back: 'Back to the blog', post: 'Send' }`. |

Calls: `HelpBitesBlog.push(['open', 'slug'])`, `(['back'])`, `(['refresh'])`.
Every reader action is a `helpbites:blog` event on `window`, with
`detail: { type: 'open' | 'react' | 'comment' | 'subscribe', slug }`.

### Restyle it

It is drawn in a shadow root, so your CSS does not leak in by accident. Change it
on purpose with variables on `.help-bites-blog`:

```css
.help-bites-blog {
  --hb-blog-accent: #0f766e;
  --hb-blog-on-accent: #fff;
  --hb-blog-bg: transparent;
  --hb-blog-card: #fff;
  --hb-blog-text: #111;
  --hb-blog-muted: #666;
  --hb-blog-line: #e5e5e5;
  --hb-blog-radius: 8px;
  --hb-blog-font: inherit;
  --hb-blog-width: 720px;
}
.help-bites-blog::part(card) { box-shadow: 0 1px 2px rgb(0 0 0 / 0.06); }
```

Parts: `header`, `search`, `list`, `card`, `cover`, `title`, `meta`, `excerpt`,
`tag`, `badge`, `post`, `body`, `gate`, `reactions`, `reaction`, `comments`,
`comment`, `composer`, `button`, `subscribe`.

A members-only post shows its excerpt and a **This post is for members** box
(the `gate` part) with the sign-in: your `onSignIn`, or the email form with its
code. With `getToken` handing over a signed-in user, it simply opens.

## In a Swift app

A list of posts that opens each one, with its reactions, read with plain
`URLSession` against the public API. Pass `token` (your user's identity token,
from your server) and readers can react; leave it out and the view is read-only.

```swift
// BlogView.swift. MIT. A HelpBites blog: posts, one post, its reactions.
import SwiftUI

struct BlogPost: Decodable, Identifiable, Hashable {
  struct Reaction: Decodable, Hashable { let key: String; let count: Int; let reacted: Bool? }
  let id, slug, title, excerpt, publishedAt, authorName: String
  let coverImageUrl: String
  let readingMinutes: Int
  var reactions: [Reaction]
  var bodyHtml: String?
}

struct BlogView: View {
  let host: URL
  let projectKey: String
  var token: String? = nil
  var accent: Color = .accentColor
  var cornerRadius: CGFloat = 12
  @State private var posts: [BlogPost] = []

  var body: some View {
    List(posts) { post in
      NavigationLink(value: post) {
        VStack(alignment: .leading, spacing: 6) {
          if let url = URL(string: post.coverImageUrl), !post.coverImageUrl.isEmpty {
            AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.1) }
              .frame(height: 140).clipShape(.rect(cornerRadius: cornerRadius))
          }
          Text(post.title).font(.headline)
          Text(post.excerpt).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
        }
      }
    }
    .navigationTitle("Blog")
    .navigationDestination(for: BlogPost.self) { BlogPostView(api: api, slug: $0.slug, accent: accent) }
    .task {
      struct Page: Decodable { let posts: [BlogPost] }
      if let page: Page = try? await api.get("blog") { posts = page.posts }
    }
  }

  private var api: BlogAPI { BlogAPI(host: host, projectKey: projectKey, token: token) }
}

struct BlogPostView: View {
  let api: BlogAPI
  let slug: String
  let accent: Color
  @State private var post: BlogPost?
  @State private var text = AttributedString()
  private let emoji = ["heart": "❤️", "+1": "👍", "hooray": "🎉", "laugh": "😄", "rocket": "🚀", "eyes": "👀"]

  var body: some View {
    ScrollView {
      if let post {
        VStack(alignment: .leading, spacing: 12) {
          Text(post.title).font(.largeTitle.bold())
          Text("\(post.authorName) · \(post.readingMinutes) min read").font(.subheadline).foregroundStyle(.secondary)
          Text(text)
          HStack {
            ForEach(["heart", "+1", "hooray", "laugh", "rocket", "eyes"], id: \.self) { key in
              let reaction = post.reactions.first { $0.key == key }
              Button { Task { await react(key) } } label: {
                Text("\(emoji[key] ?? "")\(reaction.map { " \($0.count)" } ?? "")")
              }
              .buttonStyle(.bordered).tint(reaction?.reacted == true ? accent : .secondary)
              .disabled(api.token == nil)
            }
          }
        }
        .padding()
      }
    }
    .task {
      struct One: Decodable { let post: BlogPost }
      guard let one: One = try? await api.get("blog/\(slug)") else { return }
      post = one.post
      // The body is sanitised HTML; this keeps its headings, lists and links.
      if let data = (one.post.bodyHtml ?? "").data(using: .utf8),
         let html = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil),
         let rendered = try? AttributedString(html, including: \.uiKit) {
        text = rendered
      }
    }
  }

  private func react(_ key: String) async {
    struct Reactions: Decodable { let reactions: [BlogPost.Reaction] }
    if let answer: Reactions = try? await api.post("blog/\(slug)/reactions", body: ["reaction": key]) { post?.reactions = answer.reactions }
  }
}

struct BlogAPI {
  let host: URL
  let projectKey: String
  let token: String?

  func get<T: Decodable>(_ path: String) async throws -> T {
    try await send(URLRequest(url: url(path)))
  }

  func post<T: Decodable>(_ path: String, body: [String: String]) async throws -> T {
    var request = URLRequest(url: url(path))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)
    return try await send(request)
  }

  private func url(_ path: String) -> URL {
    // Signed in, the token names the project; signed out, the public key does.
    var components = URLComponents(url: host.appending(path: "v1/\(path)"), resolvingAgainstBaseURL: false)!
    if token == nil { components.queryItems = [URLQueryItem(name: "pk", value: projectKey)] }
    return components.url!
  }

  private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
    var request = request
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode(T.self, from: data)
  }
}
```

Use it inside a `NavigationStack`: `BlogView(host: URL(string: "https://YOUR-SUPPORT-HOST")!, projectKey: "pk_…")`.
`accent` and `cornerRadius` set the colours of the reactions and the shape of the
covers; fonts come from your app's environment. The HTML conversion uses UIKit;
on macOS use `\.appKit` instead of `\.uiKit`. It is your file, so change anything:
comments are `GET`/`POST v1/blog/<slug>/comments`, below.

## Your own UI

Everything the hosted page and the embed draw is public JSON, open to any origin,
for a blog you build yourself (a Nuxt or Next site rendering posts for SEO, an app
screen):

```bash
# The live posts, newest first (no bodies), and the blog's name, layout and options
curl -s "https://YOUR-SUPPORT-HOST/v1/blog?pk=PROJECT_PUBLIC_KEY&limit=20&tag=engineering"

# A search; the featured posts; the pages
curl -s "https://YOUR-SUPPORT-HOST/v1/blog?pk=PROJECT_PUBLIC_KEY&q=offline"
curl -s "https://YOUR-SUPPORT-HOST/v1/blog?pk=PROJECT_PUBLIC_KEY&featured=true&limit=1"
curl -s "https://YOUR-SUPPORT-HOST/v1/blog?pk=PROJECT_PUBLIC_KEY&type=page"

# One post, with its sanitised HTML: safe to put straight into your page
curl -s "https://YOUR-SUPPORT-HOST/v1/blog/my-post-slug?pk=PROJECT_PUBLIC_KEY"

# Its comments, oldest first (replies have parentId)
curl -s "https://YOUR-SUPPORT-HOST/v1/blog/my-post-slug/comments?pk=PROJECT_PUBLIC_KEY"

# As a signed-in reader (an identity token): react, comment, reply
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/blog/my-post-slug/reactions \
  -H "Authorization: Bearer $IDENTITY_TOKEN" -H 'Content-Type: application/json' -d '{"reaction":"heart"}'
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/blog/my-post-slug/comments \
  -H "Authorization: Bearer $IDENTITY_TOKEN" -H 'Content-Type: application/json' -d '{"body":"Nice post!"}'
```

A reader's request with a token is never cached; an anonymous one may be cached
for a minute. 404 means the project's blog is off, or the post is a draft or
scheduled. Each post carries `type`, `featured`, `visibility`, `locked` (a
members-only post this viewer may not read: no `bodyHtml`), the SEO fields
(`metaTitle`, `metaDescription`, `ogImageUrl`, `canonicalUrl`, each empty when
the post's own applies) and `coverImageAlt`.

## Managing posts over the API

With an admin key (`ak_…`) or an operator session, scoped to the key's
workspace (and projects):

```bash
# Write a post (Markdown) and publish it now; tags and a cover are optional
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/blog/posts \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"project":"PROJECT_ID","title":"Release 3.0","body":"## What is new\n\nA lot.","tags":["Releases"],"status":"published"}'

# Schedule a draft for tomorrow morning
curl -s -X PATCH https://YOUR-SUPPORT-HOST/v1/admin/blog/posts/POST_ID \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"status":"published","publishedAt":"2026-11-02T08:00:00Z"}'

# An About page (pages stay out of the list and the feed)
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/blog/posts \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"project":"PROJECT_ID","type":"page","title":"About","slug":"about","body":"We are three people.","status":"published"}'

# Members only, featured, with its own search title
curl -s -X PATCH https://YOUR-SUPPORT-HOST/v1/admin/blog/posts/POST_ID \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"visibility":"members","featured":true,"metaTitle":"Release 3.0: what is new"}'

# Upload an image for the body or the cover
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/blog/images \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -F project=PROJECT_ID -F file=@shot.png

# Email it to the "blog" topic's subscribers now (a plan with campaigns)
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/blog/posts/POST_ID/newsletter \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"send":"now","audience":{"topic":"blog"}}'

# Every comment, for moderation; hide one
curl -s "https://YOUR-SUPPORT-HOST/v1/admin/blog/comments?project=PROJECT_ID" -H "Authorization: Bearer $HELPBITES_ADMIN_KEY"
curl -s -X PATCH https://YOUR-SUPPORT-HOST/v1/blog/comments/COMMENT_ID \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H 'Content-Type: application/json' -d '{"status":"hidden"}'
```

The settings are `PATCH /v1/admin/projects/{id}` with `{ blog: { … } }` (admins;
only the keys sent change): `enabled`, `title`, `description`, `comments`,
`reactions`, `commentNotify`, `postUrl`, `newsletterTopic`, `subscribeForm` and
`design` (`layout`, `font`, `colorScheme`, `accent`, `logoUrl`, `coverImageUrl`,
`navigation`, `social`, `footer`; partial too, and `social` merges per network,
`""` removing one). The whole reference is in the OpenAPI document at
`/_docs/scalar`, under **Blog**.

```bash
# The magazine layout, serif, with an About link
curl -s -X PATCH https://YOUR-SUPPORT-HOST/v1/admin/projects/PROJECT_ID \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"blog":{"design":{"layout":"magazine","font":"serif","navigation":[{"label":"About","url":"/about"}]}}}'
```

### Write with AI over the API

`POST /v1/admin/blog/ai` is what the editor's button calls. Nothing is saved: you
get a proposal and send what you keep to the create or update endpoint above.

```bash
curl -X POST https://your-helpbites.example/v1/admin/blog/ai \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{ "project": "PROJECT_ID", "mode": "write",
        "instruction": "Announce our new offline mode, for a technical audience." }'
# { "result": { "title": "…", "excerpt": "…", "metaDescription": "…", "tags": ["…"],
#               "body": "## …", "notes": "…", "repos": [{ "repo": "you/app", "read": true }] } }
```

- `mode`: `write` (needs `instruction` or `title`), `continue`, `improve` and `meta`
  (these need `body`, the Markdown so far) and `insert` (needs `instruction`: a
  passage for the cursor). `continue` and `insert` return only the text to add.
  Send `selection` (Markdown) with `improve` to rewrite only that passage; `body` is
  then its replacement and `instruction` says how.
- `repos`: `owner/name` of linked repos to read; all of the project's when left out.
  `GET /v1/admin/cms/repos?project=…` lists them.
- Fields a mode does not produce are empty. Errors: `400` nothing to go on, `501`
  no AI provider configured, `502` the provider failed, `429` six a minute per operator.

## Webhooks

With the project's event webhook set (**Email → Settings**; see
[MARKETING.md](MARKETING.md)), the blog sends, signed and retried like every
event:

| Event | When |
|---|---|
| `blog.post.published` | A post went public: published now, or its scheduled moment came. |
| `blog.post.updated` | A public post was changed. |
| `blog.post.unpublished` | A public post stopped being public: unpublished, or rescheduled into the future. |
| `blog.post.deleted` | A public post was deleted. |

`data` is `{ post: { id, slug, title, visibility, publishedAt, url } }`. Rebuild
a static site, post to social media, or ping a search engine on them. Pages and
imports send nothing.

## Moving from Ghost

**Project → Blog → … → Import from Ghost** takes the file Ghost makes under
**Settings → Advanced → Import/Export → Export content** (a `.json`):

- Posts and pages, with their HTML (kept as HTML), slug, excerpt, cover and its
  alt text, tags (Ghost's internal `#tags` left out), first author, publish date,
  featured flag, meta title and description, social image and canonical URL.
- Published posts stay published with their dates, scheduled ones stay scheduled,
  drafts stay drafts. Email-only posts (`sent`) come in as drafts.
- **Visibility**: `public` stays public; `members` is members-only; `paid` and
  `tiers` become members-only too (there are no paid tiers here), and the import
  says how many.
- **Your Ghost site's address**: the export writes its own links and images as
  `__GHOST_URL__/…`; give the address and they point there again. The images stay
  on that site, so keep it up until you have moved them (upload them here and
  change the posts), or the posts will show broken images.
- Importing the same file again skips what came in before (matched by Ghost's
  id); **Overwrite posts imported before** replaces them with the file's copy.
  Nothing is emailed and no webhook fires. Up to 2,000 posts per file.
- **Members** are a separate CSV in Ghost (**Members → Export**). Import it under
  **Contacts → Import**: `email`, `name`, `labels` (as tags) and
  `subscribed_to_emails` (as newsletter consent) are picked up; unset the `id`
  column, which is Ghost's, not your app's.

Over the API:

```bash
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/blog/import \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d "{\"project\":\"PROJECT_ID\",\"siteUrl\":\"https://blog.example.com\",\"export\":$(cat my-blog.ghost.json)}"
# → { "created": 41, "updated": 0, "skipped": 0, "warnings": ["2 paid or tier-only posts are members-only here: …"] }
```

## Limits

| | |
|---|---|
| Title | 200 characters |
| Body | 200,000 characters (Markdown or HTML) |
| `data` | 200,000 characters as JSON |
| Search and social | title 300, description 500, alt text 300 characters |
| Navigation | 8 links |
| Ghost import | 2,000 posts per file |
| Excerpt | 300 characters |
| Write with AI | 2,000 characters of instruction, 3 repos, 6 requests a minute per operator |
| Tags | 10 per post, 40 characters each |
| Images | 8 MB, PNG, JPEG, GIF or WebP |
| Comments | 4,000 characters, 6 links, five per ten minutes per reader |
| Reactions | 60 a minute per reader |
| Public reads | 1,200 a minute per IP |
| Feed | the latest 30 posts |
