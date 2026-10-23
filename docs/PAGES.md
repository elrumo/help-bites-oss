# Pages and headless CMS

Build landing pages in a visual editor and HelpBites hosts them, or keep your
copy, images and components here and read them from your own Vue, JavaScript
or Swift app. Both work off the same content: a page you design in the editor is
also JSON in the delivery API, and a component you write in code shows in the
editor like the built-in ones. An assistant can write the page, its copy and new
components for you, from a few questions or your GitHub repositories.

Everything here is in every plan. Files count against the workspace's storage,
and the assistant spends AI credits like the email designer.

## How content is shaped

**Components** are the building blocks. Each has a `key` (`hero`, `pricing`),
a list of **fields** (its schema) and, optionally, an HTML and CSS **template**
that hosted pages render. A component without a template is data only: your own
app renders it. Components are either **entry types** (`root`: a page, a blog
post) or **blocks** (`nestable`: they go inside another component), or both.

**Entries** are made of one entry type: a page, or a type you define. Each has
a `slug` (`home`, `pricing`, `blog/hello-world`; `/` separates folders) and a
content tree in the same shape as Storyblok's:

```json
{
  "_uid": "a1b2c3d4e5f6",
  "component": "page",
  "title": "Acme: invoices in one click",
  "body": [
    { "_uid": "f6e5d4c3b2a1", "component": "hero", "headline": "Invoices in one click", "primaryLabel": "Start free", "primaryUrl": "/signup" },
    { "_uid": "0a1b2c3d4e5f", "component": "features", "items": [
      { "_uid": "5f4e3d2c1b0a", "component": "feature", "icon": "⚡", "title": "Fast", "body": "Sent in seconds." }
    ] }
  ]
}
```

A `blocks` field holds more blocks, to any depth (eight levels at most). Every
block has a `_uid`; `_anim` holds its animation ([Animations](#animations)).

**Drafts and versions.** Editing changes the working copy. Publishing freezes it
into the next version, and visitors and the delivery API get that one until you
publish again. Unpublishing takes it offline and keeps the working copy.

**Files** (images, SVG, MP4, WebM and PDF, up to 20 MB each) live in the
project's file library. An asset field stores `{ id, url, alt, mime, width,
height }`, so content never needs a second request to show a picture.

## Templates and the editor

Project → Pages → **New page** starts from a template (SaaS launch, Mobile app,
Waitlist, Developer tool, Design tool, Blank), with the project's name in the
copy, or from the assistant's wizard ([The assistant](#the-assistant)).

The editor has the assistant and **Layers** on the left (drag a row onto another
to move it, into any list that takes it), the live page in the middle (click a
block to select it, drag a top-level block by its handle) and the **inspector**
on the right: the selected block's fields and animation, or, with the page
selected, its name, slug, link preview fields and style. Every change autosaves
and is one undo step; **Play** runs the page's animations once.

**Style** applies to the whole page: an accent (the project's when empty),
light, dark or follow-the-visitor mode, corner radius, heading and body fonts
(any Google Fonts family, or a font Apple and Windows devices have, such as
Avenir) and content width.

## Components in code

Project → Pages → Components lists the built-ins (read-only; **Duplicate** makes
an editable copy) and your own. The native app has the same tab and editor, and the same
assistant and wizard, without the live preview. A component's template is HTML and CSS:

```html
<section class="banner">
  {{#icon}}<span class="banner__icon">{{@icon}}</span>{{/icon}}
  <p>{{@text}}</p>
  {{#link}}<a class="hb-btn" href="{{@link}}">{{@label}}</a>{{/link}}
  {{^link}}<small>No link yet.</small>{{/link}}
</section>
```

| Syntax | Fills in |
|---|---|
| `{{@field}}` | The field's value, escaped. A `markdown` field becomes HTML (raw HTML in it is dropped), a `url` keeps only web, mail, phone and same-site links, a `color` only CSS colours, an `icon` becomes an inline SVG, a `blocks` field its children's HTML. |
| `{{@image.alt}}`, `.width`, `.height`, `.mime` | An asset's details (`{{@image}}` is its URL). |
| `{{#field}}…{{/field}}` | Only when the field is set (non-empty text, on, any blocks, a file). |
| `{{^field}}…{{/field}}` | Only when it is not. |
| `{{$pk}}`, `{{$host}}` | The project's public key and the HelpBites address, for forms. |
| `{{$uid}}`, `{{$parent}}` | The block's `_uid` and its parent's: radio groups, exclusive `<details>`. |

Field types: `text`, `textarea`, `markdown`, `number`, `boolean`, `color`,
`url`, `date`, `select` (with `options`), `icon` (a Lucide icon from the
built-in set; `options` narrows it), `asset` and `blocks` (`allow` lists the
component keys it takes; empty takes any block). Give every field a default so
the component looks right when inserted.

**Templates never run anything.** Hosted pages share HelpBites' address, so
`<script>`, `on…` attributes, `javascript:` links, `<object>`, `<embed>`,
`<base>`, `<link>` and `srcdoc` are refused when you save, and the page's
Content-Security-Policy blocks what slips past: only HelpBites' own page script
runs, forms post only to HelpBites, and frames load only YouTube and Vimeo
players. Interactions are CSS: `:hover`, `:has(input:checked)` tabs,
`<details>` accordions, scroll-driven animations.

The page's theme is CSS variables your component's CSS can use: `--hb-accent`,
`--hb-on-accent`, `--hb-bg`, `--hb-surface`, `--hb-text`, `--hb-muted`,
`--hb-line`, `--hb-radius`, `--hb-radius-sm`, `--hb-max` (content width),
`--hb-font` and `--hb-heading-font`. Helper classes: `.hb-container`,
`.hb-section`, `.hb-btn` (`--ghost`, `--ink`, `--soft`, `--glass`), `.hb-card`,
`.hb-grid` (set `--hb-cols`), `.hb-pill` (`--blue`, `--amber`, `--violet`,
`--emerald`, `--dark`), `.hb-title`, `.hb-heading`, `.hb-lead`, `.hb-checks`
(around a Markdown list) and `.hb-stage` (a tinted picture frame). Prefix your
own classes with the component's key: every component's CSS shares the page.

## Animations

Any block can animate: select it and pick an effect (fade, fade up, down, left
or right, zoom in or out, unblur, parallax), when it plays (as it scrolls into
view, on page load, or following the scroll position) and its duration, delay,
easing (including a spring), distance and **stagger** (its children one after
another). In content it is `_anim`:

```json
{ "effect": "fade-up", "trigger": "in-view", "duration": 600, "delay": 0, "easing": "ease-out", "stagger": 80, "once": true, "distance": 32 }
```

Hosted pages play them with [Motion](https://motion.dev) (MIT), served by
HelpBites itself, so visitors' browsers make no third-party requests. Inside a
template, `data-hb-anim="fade-up"` animates an inner element and
`data-hb-item` marks the children a stagger walks through. Visitors who ask
their system to reduce motion see everything in place, and if the script cannot
load, the page shows as it is after three seconds.

In your own app the same `_anim` arrives in the JSON; drive it with whatever you
use ([Vue](#vue)).

## The assistant

The **Assistant** tab writes and edits the page for you. It works through the
same tools the editor uses, so every turn shows as it happens and undoes in one
click. It can:

- build a layout from a template or from scratch, and write all the copy;
- read your GitHub repositories (the ones linked in the project's settings,
  read-only) to get the facts right;
- write new components, save them to the project and use them;
- add animations, restyle the page, rename it;
- work out your **messaging brief** with you: who it is for, the problem, a
  one-sentence value proposition, three to five key messages and the proof for
  each. Pages → Settings shows the brief, and every turn reads it.

The **wizard** (New page → Build it with the assistant) asks about the product,
the audience, the goal and the tone, fills what you leave empty from your
repositories on request, saves the answers as the brief and opens the editor
with the assistant already building the page. It never invents numbers,
customers or quotes: missing facts become marked placeholders.

## Hosted pages

A published page is at `https://<your HelpBites>/p/<public key>/<slug>`; the
`home` entry is at `/p/<public key>`. Links between your pages use those paths.
The page carries the entry's `title`, `description` and link preview image as
meta tags.

The built-in **Email sign-up** block posts to the project's newsletter sign-up
([double opt-in and topics](MARKETING.md)), so a waitlist needs nothing else.

### Put it on your site

```html
<div id="launch"></div>
<script src="https://YOUR-SUPPORT-HOST/pages.js" data-project="pk_…" data-page="launch" data-target="#launch" defer></script>
```

| Option | Meaning |
|---|---|
| `data-project` | The project's public key (required). |
| `data-page` | The entry's slug; `home` when left out. |
| `data-target` | Where the page goes, a CSS selector (required). |
| `data-height` | The starting height in px (720) until the page reports its own. |
| `data-title` | The frame's accessible name. |

The same keys work as `HelpBitesPages.push(['init', { page: 'launch', … }])`
before the script. The frame has the class `help-bites-page` and grows with its
content. The page wears its own style from the editor; for anything else, read
the content and render it yourself.

## Reading content from code

### Delivery API

Public, no key beyond the project's public one, open to any origin and cached
for a minute behind an ETag. Published entries only.

```bash
HOST=https://YOUR-SUPPORT-HOST
curl "$HOST/v1/cms/pk_…/entries/home"
curl "$HOST/v1/cms/pk_…/entries/home?format=html"
curl "$HOST/v1/cms/pk_…/entries?type=post&starts_with=blog/&per_page=10"
```

```json
{
  "entry": {
    "id": "Xq2b…", "slug": "home", "name": "Home", "type": "page", "version": 3,
    "publishedAt": "2026-10-21T14:00:00.000Z",
    "style": { "accent": "#3b82f6", "mode": "light", "radius": "round", "headingFont": "", "bodyFont": "", "width": "normal" },
    "content": { "_uid": "…", "component": "page", "title": "…", "body": [] }
  }
}
```

With `format=html` the answer adds `html` (the body rendered with the project's
components, blocks still carrying `data-hb-uid`) and `css` (the theme and each
component's styles), for a site that shows a page as it is. Its sign-up forms
post to HelpBites, so add your site to the project's allowed origins.

Drafts are not public. To preview unpublished content on your server, read the
entry with an admin key (`GET /v1/admin/cms/entries/{id}`), or use the live
bridge below, which needs no key at all.

### JavaScript

`cms.mjs` is a small client with no dependencies. Import it by URL or copy it
into your project:

```js
import { createClient, editable, bridge } from 'https://YOUR-SUPPORT-HOST/cms.mjs'

const cms = createClient({ host: 'https://YOUR-SUPPORT-HOST', pk: 'pk_…' })
const { entry } = await cms.getEntry('home')
const { entries } = await cms.getEntries({ type: 'post', startsWith: 'blog/' })
```

### Vue

Map component keys to your own components and render the tree:

```vue
<!-- HbBlocks.vue -->
<script setup>
import { editable } from '@/lib/cms.mjs'
import Hero from './blocks/Hero.vue'
import Features from './blocks/Features.vue'
defineProps({ blocks: { type: Array, default: () => [] } })
const map = { hero: Hero, features: Features }
</script>

<template>
  <template v-for="blok in blocks" :key="blok._uid">
    <component :is="map[blok.component]" v-if="map[blok.component]" :blok="blok" v-bind="editable(blok)" />
  </template>
</template>
```

A block component spreads `editable(blok)` on its outer element (above, through
`v-bind` on the root) and renders nested lists with `<HbBlocks :blocks="blok.items" />`.
To animate with [motion-v](https://motion.dev/docs/vue), turn `_anim` into its props:

```js
export function hbMotion(anim) {
  if (!anim) return {}
  const d = anim.distance ?? 32
  const from = { opacity: 0, ...{ 'fade-up': { y: d }, 'fade-down': { y: -d }, 'fade-left': { x: d }, 'fade-right': { x: -d }, 'zoom-in': { scale: 0.92 }, 'zoom-out': { scale: 1.08 }, blur: { filter: 'blur(12px)' } }[anim.effect] }
  const to = { opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)' }
  const transition = { duration: anim.duration / 1000, delay: anim.delay / 1000, ...(anim.easing === 'spring' ? { type: 'spring', bounce: 0.25 } : {}) }
  return anim.trigger === 'load'
    ? { initial: from, animate: to, transition }
    : { initial: from, whileInView: to, inViewOptions: { once: anim.once }, transition }
}
```

`<motion.section v-bind="hbMotion(blok._anim)">` then plays what the editor set.

### Live editing on your site

Set Pages → Settings → **Your site's preview URL** (`http://localhost:5173/{slug}`),
and the editor's **Your site** switch shows that page instead of the HelpBites
render. Add the bridge to it:

```js
import { bridge } from '@/lib/cms.mjs'

const page = ref(await cms.getEntry(slug).then(r => r.entry))
bridge({ host: 'https://YOUR-SUPPORT-HOST', onChange: entry => { page.value = entry } })
```

Inside the editor, `onChange` gets the unsaved draft on every edit, clicks on
`editable()` elements select the block in the editor (and the selection shows
on your page), and messages are only taken from your HelpBites origin. Outside
the editor `bridge()` does nothing. Your site must allow being framed by
HelpBites (a dev server usually does; check `frame-ancestors` and
`X-Frame-Options` in production).

### In a Swift app

```swift
// HelpBitesPage.swift. MIT. Shows a published HelpBites entry's text blocks natively.
import SwiftUI

struct HBBlock: Decodable, Identifiable {
  let _uid: String
  let component: String
  let fields: [String: JSONValue]
  var id: String { _uid }
  init(from decoder: Decoder) throws {
    let all = try decoder.singleValueContainer().decode([String: JSONValue].self)
    _uid = all["_uid"]?.string ?? UUID().uuidString
    component = all["component"]?.string ?? ""
    fields = all
  }
  func text(_ key: String) -> String? { fields[key]?.string }
  func blocks(_ key: String) -> [HBBlock] { fields[key]?.blocks ?? [] }
}

enum JSONValue: Decodable {
  case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let v = try? c.decode(String.self) { self = .string(v) }
    else if let v = try? c.decode(Double.self) { self = .number(v) }
    else if let v = try? c.decode(Bool.self) { self = .bool(v) }
    else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
    else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
    else { self = .null }
  }
  var string: String? { if case .string(let s) = self { s } else { nil } }
  var blocks: [HBBlock]? {
    guard case .array = self, let data = try? JSONEncoder().encode(AnyEncodable(self)) else { return nil }
    return try? JSONDecoder().decode([HBBlock].self, from: data)
  }
}

private struct AnyEncodable: Encodable {
  let value: JSONValue
  init(_ value: JSONValue) { self.value = value }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch value {
    case .string(let s): try c.encode(s)
    case .number(let n): try c.encode(n)
    case .bool(let b): try c.encode(b)
    case .array(let a): try c.encode(a.map(AnyEncodable.init))
    case .object(let o): try c.encode(o.mapValues(AnyEncodable.init))
    case .null: try c.encodeNil()
    }
  }
}

struct HelpBitesPage: View {
  let host: URL
  let projectKey: String
  var slug = "home"
  var accent: Color = .accentColor
  var titleFont: Font = .largeTitle.bold()
  var cornerRadius: CGFloat = 16
  @State private var blocks: [HBBlock] = []

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        ForEach(blocks) { block in
          VStack(alignment: .leading, spacing: 8) {
            if let title = block.text("headline") ?? block.text("title") { Text(title).font(titleFont) }
            if let body = block.text("subhead") ?? block.text("body") { Text(.init(body)).foregroundStyle(.secondary) }
            if let label = block.text("primaryLabel"), let link = block.text("primaryUrl"), let url = URL(string: link) {
              Link(label, destination: url).buttonStyle(.borderedProminent).tint(accent).clipShape(.rect(cornerRadius: cornerRadius))
            }
          }
        }
      }
      .padding()
    }
    .task {
      struct Envelope: Decodable { struct Entry: Decodable { let content: HBBlock }; let entry: Entry }
      let url = host.appending(path: "v1/cms/\(projectKey)/entries/\(slug)")
      if let (data, _) = try? await URLSession.shared.data(from: url), let page = try? JSONDecoder().decode(Envelope.self, from: data) {
        blocks = page.entry.content.blocks("body")
      }
    }
  }
}
```

`accent`, `titleFont` and `cornerRadius` style it; everything else is your
app's own look. It shows headlines, text and the main button of each top-level
block; switch on `block.component` to draw your own views for the rest.

## Managing content over the API

Every admin route takes an operator session or an `ak_` admin key and is scoped
to the workspace. `project` goes in the query or the body.

```bash
HOST=https://YOUR-SUPPORT-HOST; KEY=ak_...
curl -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"project":"PROJECT_ID","template":"saas","slug":"launch"}' "$HOST/v1/admin/cms/entries"
curl -X POST -H "authorization: Bearer $KEY" "$HOST/v1/admin/cms/entries/ENTRY_ID/publish"
curl -H "authorization: Bearer $KEY" -F project=PROJECT_ID -F file=@hero.png -F alt="The dashboard" "$HOST/v1/admin/cms/assets"
```

| Route | Does |
|---|---|
| `GET` / `POST /v1/admin/cms/components` | List (built-ins first) or create a component. |
| `GET` / `PATCH` / `DELETE /v1/admin/cms/components/{id}` | Read, change or delete one of the project's own. |
| `GET` / `POST /v1/admin/cms/entries` | List (`type`) or create an entry (`template`, `content`, `slug`, `type`). |
| `GET` / `PATCH` / `DELETE /v1/admin/cms/entries/{id}` | The working copy; changes report what was fixed in `issues`. |
| `POST /v1/admin/cms/entries/{id}/publish`, `…/unpublish` | Publish the next version, or take it offline. |
| `GET` / `POST /v1/admin/cms/assets`, `PATCH` / `DELETE …/{id}` | The file library (multipart upload). Add `compress=true` to store a PNG, JPEG or WebP smaller as WebP, or `formats=avif,webp` to store those modern formats next to the file, whose `url` is then a JPEG or PNG fallback every client reads; they come back as the asset's `variants`. See [BLOG.md](BLOG.md#smaller-images-and-modern-formats). |
| `GET /v1/admin/cms/templates` | The page templates. |
| `GET` / `PATCH /v1/admin/cms/settings` | The preview URL and the messaging brief. |
| `POST /v1/admin/cms/chat` (and `GET`, `DELETE`, `…/chat/stream`) | The assistant, as an AI SDK UI message stream. |
| `POST /v1/admin/cms/wizard/suggest` | Wizard answers read from the linked repos. |
| `GET /v1/cms/{pk}/entries`, `…/entries/{slug}` | The public delivery API. |

The full schema is in the API reference at `/_docs/scalar`.

**Webhooks.** With an event webhook set (Settings → Event webhook), publishing
sends `cms.entry.published` (`{ entry: { id, slug, type, version, publishedAt } }`)
and unpublishing `cms.entry.unpublished`: rebuild a static site on them.

## Limits

| What | Limit |
|---|---|
| Components per project | 200, with 40 fields each and 100 KB of HTML and of CSS |
| Entries per project | 1,000; 512 KB of content each, 100 blocks per list, 8 levels deep |
| Files | 2,000 per project, 20 MB each |
| Delivery API | 1,200 requests a minute per address |
| Assistant | 20 turns a minute per person |

Hosted pages also answer on a project's [custom domain](CUSTOM-DOMAINS.md).

Not built yet: scripts in components, content
translations per field (folders such as `es/…` work today), scheduled
publishing and version history, and generated TypeScript types.
