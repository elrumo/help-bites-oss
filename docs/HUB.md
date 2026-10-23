# Public hub and the one-tag loader

Three things that make a project's public side one product instead of a pile of
embeds:

- **The hub**, a page at `/hub/<public key>` that gathers what the project
  already publishes: the changelog, roadmap, feedback board, blog, legal
  documents and brand kit, a way to chat, and a few links of your own.
- **The Home tab** of the chat widget: what's new, the top feedback and the
  onboarding flows, next to Messages.
- **`helpbites.js`**, one `<script>` tag that adds whichever of the chat,
  feedback board, changelog and onboarding your project has, so a feature you
  switch on later needs no edit to your site.

All three wear the project's look from its [Brand kit](BRAND.md): its accent,
logo, typefaces and corner radius. Change the kit and they follow.

## Turn it on

**Project → Settings → Public hub.** Nothing is on until you switch it on.

| Setting | Meaning |
|---|---|
| `enabled` | Turns the page at `/hub/<pk>` on. Off, it answers `404`. |
| `title` | The page's heading. Empty uses the project's name. |
| `tagline` | The line under it. Empty uses the Brand kit's tagline. |
| `sections` | Which sections the page lists, in order: `about`, `changelog`, `roadmap`, `feedback`, `blog`, `legal`, `brand`, `contact`. Default: all of them. |
| `links` | Up to 8 links of your own, `{ label, url }` (http or https), shown after the sections. |
| `widgetHome` | `{ enabled, sections }`: the chat widget's Home tab, with any of `changelog`, `feedback`, `onboarding`. Default off. It works without the page being on. |

Over the API, it is part of the project (the same call the panel makes). Only the
keys you send change; `sections` and `links` are replaced whole.

```bash
curl -X PATCH https://help.example.com/v1/admin/projects/PROJECT_ID \
  -H "Authorization: Bearer $HELPBITES_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"hub":{"enabled":true,"tagline":"Everything we ship","sections":["changelog","roadmap","feedback","contact"],"links":[{"label":"Docs","url":"https://docs.example.com"}],"widgetHome":{"enabled":true,"sections":["changelog","feedback"]}}}'
```

## The page

`https://YOUR-SUPPORT-HOST/hub/PROJECT_PUBLIC_KEY` needs no sign-in and works
without JavaScript. A section shows only when its feature has something public:

| Section | Shows when | What it lists |
|---|---|---|
| `about` | The Brand kit has an About text | That text. |
| `changelog` | The [public changelog](FEEDBACK.md) is on and has entries | The five latest, linking to `/changelog/<pk>`. |
| `roadmap` | The board has public items, or the feedback board has its roadmap on | A link to `/roadmap/<pk>`. |
| `feedback` | The feedback board is on | The three top posts and the board. |
| `blog` | The blog is on and has posts | The five latest, linking to `/blog/<pk>`. |
| `legal` | At least one legal document is published | Each document, once (translations are reached from the original). |
| `brand` | The Brand kit's page is public | A link to `/brand/<pk>`. |
| `contact` | Always | **Start a chat**, which opens the chat widget (the page loads `helpbites.js` for it). |

The page is plain server-rendered HTML with a strict Content Security Policy:
nothing from a user is shown as HTML, every link must be http(s), and the only
scripts are one fixed click handler and `helpbites.js` from the same origin.

## JSON: `GET /v1/hub/{pk}`

The same data, for the widget's Home tab, the snippets below, or your own UI.
Public, no sign-in, CORS open, rate limited per address, cached for a minute with
an `ETag`.

```bash
curl https://help.example.com/v1/hub/pk_abc123
```

```json
{
  "project": { "name": "Acme", "publicKey": "pk_abc123" },
  "look": { "accent": "#16a34a", "accentText": "#ffffff", "radiusPx": 8, "scheme": "auto",
            "logoUrl": "https://…/logo.svg", "fontFamily": { "display": "\"Fraunces\", …", "body": "…", "mono": "…" },
            "fontCssUrls": ["https://fonts.googleapis.com/css2?family=Fraunces"] },
  "hub": { "enabled": true, "title": "Acme", "tagline": "Everything we ship", "url": "https://help.example.com/hub/pk_abc123" },
  "sections": [
    { "key": "changelog", "title": "What is new", "url": "https://help.example.com/changelog/pk_abc123", "text": "", "action": "",
      "items": [{ "title": "Dark mode", "url": "https://help.example.com/changelog/pk_abc123", "meta": "Oct 1, 2026" }] },
    { "key": "contact", "title": "Contact us", "url": "", "text": "", "items": [], "action": "chat" }
  ],
  "links": [{ "label": "Docs", "url": "https://docs.example.com" }],
  "home": null
}
```

- `sections` and `links` are empty while the page is off (`hub.enabled` is
  `false`). `action: "chat"` means "open the chat" rather than "follow a link".
- `home` is the Home tab's data while `widgetHome` is on, otherwise `null`:
  `{ sections, changelog: { url, entries[] } | null, feedback: { url, posts[] } | null, onboarding: { flows: [{ key, name }] } | null }`.
- `look` is the project's look. Draw with it to match; it is the same object the
  chat embed uses (`GET /v1/projects/{pk}/public`).
- `404` when neither the page nor the Home tab is on, or the project is unknown.

## The chat widget's Home tab

With `widgetHome` on, the widget opens on **Home** and has two tabs at the
bottom, **Home** and **Messages** (with the unread count). Home shows:

- **What's new**: the three latest changelog entries and a link to the rest.
- **Feedback**: the top posts and **Share an idea**, which opens the board.
- **Getting started**: a button per published [onboarding](ONBOARDING.md) flow.
  It runs the flow in your page: if `onboarding.js` is on the page that copy
  runs, otherwise the widget adds it for that flow. Turn this section off in
  `widgetHome.sections` if you do not want every published flow offered.

A section with nothing to show is left out, and a project with the tab on but
nothing to put in it gets the chat as before. The wide inline layout
(`data-mode="inline"` in a panel wide enough for two columns) keeps its list and
thread side by side and has no Home tab. The unread badge and the host protocol
(`ready`, `token`, `unread`, `close`) are unchanged.

## One tag: `helpbites.js`

```html
<script src="https://YOUR-SUPPORT-HOST/helpbites.js" data-project="pk_…" async></script>
```

It asks `GET /v1/hub/{pk}/loader` which embeds the project has, then adds only
those, as the individual scripts (`widget.js`, `feedback.js`, `changelog.js`,
`onboarding.js`). It is MIT-licensed and has no dependencies. With nothing else
it adds the chat; the others draw on your page, so you opt in:

```html
<!-- the chat and a floating feedback button -->
<script src="https://YOUR-SUPPORT-HOST/helpbites.js" data-project="pk_…" data-features="chat,feedback" async></script>

<!-- the chat, the changelog inline, and the welcome flow once -->
<div id="changelog"></div>
<script src="https://YOUR-SUPPORT-HOST/helpbites.js" data-project="pk_…"
        data-changelog-target="#changelog" data-flow="welcome" async></script>
```

| Attribute | Meaning |
|---|---|
| `data-project` | The public key. Required. |
| `data-features` | Only these modules: `chat`, `feedback`, `changelog`, `onboarding`, comma separated. Without it: the chat, plus any module you gave its own setting below. |
| `data-changelog-target` | A selector: the changelog draws inline there. The changelog is inline-only, so it needs this. |
| `data-feedback-target` | A selector: the feedback board draws inline there. Without it the board is a floating button (on the left when the chat is on the right). |
| `data-flow` | An onboarding flow's key to show. With `data-features="onboarding"` and no flow, the project's `welcome` (else its first). |
| `data-accent`, `data-theme`, `data-position`, `data-locale`, `data-token` | Passed to every module that reads them. `data-token` is the person's identity token as a string; to fetch one when needed, call `HelpBites.push(['init', { getToken }])` as for the [chat](CONNECTING.md#3-show-the-chat). |
| `data-mode`, `data-target` | The chat's (`inline` and its element). |
| `data-<module>-<name>` | Aims one attribute at one module: `data-feedback-position="left"`, `data-onboarding-show="update"`, `data-chat-mode="inline"`. |
| `data-host` | Where HelpBites lives, when you serve `helpbites.js` from your own site. |
| `data-scripts` | The folder the module scripts are loaded from (your own site or a cache) instead of HelpBites; they are told `data-host` themselves. |
| `data-cache` | `false` stops it starting from the loader answer remembered in this browser (a week). |

A module the project has not set up (a feedback board that is off, no published
flows) is skipped, and a script already on the page is never added twice, so you
can move to this tag one module at a time. If HelpBites cannot be reached for the
loader call, the modules you named still load. Rendering on your server, serving the scripts
from your own domain and caching them: [SSR.md](SSR.md).

### Calls

`window.HelpBites.push` keeps working before and after the scripts have loaded.
The chat's own calls go to the chat, and a module name in front sends a call
there:

```js
window.HelpBites = window.HelpBites || []
HelpBites.push(['init', { getToken: () => fetch('/api/support/token').then(r => r.json()).then(r => r.token) }])
HelpBites.push(['open'])                    // the chat
HelpBites.push(['feedback', 'open'])        // HelpBitesFeedback.push(['open'])
HelpBites.push(['onboarding', 'open'])      // HelpBitesOnboarding.push(['open'])
```

If you do not call `init`, the loader starts the chat itself (with `data-token`
when there is one). The `helpbites:loaded` event on `window` says which modules
were added (`event.detail.modules`).

### What it reads: `GET /v1/hub/{pk}/loader`

```bash
curl https://help.example.com/v1/hub/pk_abc123/loader
# { "project": { "name": "Acme", "publicKey": "pk_abc123" },
#   "modules": { "chat": { "enabled": true, "home": true }, "feedback": { "enabled": true },
#                "changelog": { "enabled": true }, "onboarding": { "enabled": true, "flows": ["welcome"] } },
#   "hub": { "enabled": true, "url": "https://help.example.com/hub/pk_abc123" }, "accent": "#16a34a" }
```

## In a Swift app

Read the hub with `URLSession` and show what's new and a way to give feedback.
Colours, font and corner radius are parameters; leave them out to wear the
project's Brand kit.

```swift
// WhatsNew.swift. MIT. The changelog and a feedback button from a HelpBites hub.
import SwiftUI

struct WhatsNew: View {
  let host: URL                  // https://support.example.com
  let projectKey: String         // pk_…
  var accent: Color? = nil       // nil: the project's accent
  var font: Font = .body
  var cornerRadius: CGFloat? = nil

  struct Hub: Decodable {
    struct Look: Decodable { let accent: String; let radiusPx: Double }
    struct Item: Decodable { let title, url, meta: String }
    struct Section: Decodable { let key, title, url: String; let items: [Item] }
    let look: Look
    let sections: [Section]
    func section(_ key: String) -> Section? { sections.first { $0.key == key } }
  }

  @State private var hub: Hub?
  @Environment(\.openURL) private var openURL

  var body: some View {
    let tint = accent ?? hub.map { Color(hex: $0.look.accent) } ?? .accentColor
    let radius = cornerRadius ?? hub.map { CGFloat($0.look.radiusPx) } ?? 8
    VStack(alignment: .leading, spacing: 12) {
      if let news = hub?.section("changelog") {
        Text(news.title).bold()
        ForEach(news.items, id: \.title) { item in
          Button { open(item.url) } label: {
            HStack { Text(item.title); Spacer(); Text(item.meta).foregroundStyle(.secondary) }
          }
          .buttonStyle(.plain)
        }
      }
      if let feedback = hub?.section("feedback") {
        Button(feedback.title) { open(feedback.url) }
          .padding(.horizontal, 14).padding(.vertical, 8)
          .background(tint, in: RoundedRectangle(cornerRadius: radius))
          .foregroundStyle(.white)
      }
    }
    .font(font)
    .task { hub = try? await load() }
  }

  private func load() async throws -> Hub {
    let (data, _) = try await URLSession.shared.data(from: host.appending(path: "v1/hub/\(projectKey)"))
    return try JSONDecoder().decode(Hub.self, from: data)
  }

  private func open(_ link: String) { if let url = URL(string: link) { openURL(url) } }
}

private extension Color {
  init(hex: String) {
    let value = UInt64(hex.dropFirst(), radix: 16) ?? 0x4f46e5
    self.init(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
  }
}
```

The sections come back only while the public page is on. Turn on **Public page**
for this snippet; the hub does not have to be linked from anywhere.

## Your own UI

`GET /v1/hub/{pk}` is everything the page and the Home tab show. Draw it with your
components and the `look` object, and link to the pages it names. For one
widget on your site you do not need the API at all: the loader and the Home tab
are the same data with the project's look applied.

## Rules

- The page and `GET /v1/hub/{pk}` answer `404` while the hub is off; the JSON
  also answers when only the Home tab is on, with `sections` and `links` empty.
  The loader answers for any known project.
- Reads are limited per address (1,200 a minute) and cached for a minute.
- A hub exposes only what each feature already makes public (published posts,
  entries and documents, the public brand page). Hidden posts, drafts and private
  boards never appear.
- Custom links must be http(s); at most 8, labels up to 60 characters.
- `hub`, `company` and the rest of the project are set with
  `PATCH /v1/admin/projects/{id}` by an operator session or an `ak_` admin key.
