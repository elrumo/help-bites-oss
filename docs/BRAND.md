# Brand kit

Keep your logos, app icons, favicons, screenshots, colours, fonts and brand
guidelines in one place, and share them with anyone: a press page at
`/brand/<public key>`, an embed for your own site, and an API. People you share
it with need no account.

## What goes in it

**Files.** PNG, JPEG, GIF, WebP, SVG, ICO and PDF, up to 20 MB each and 200 per
project. The type is read from the file itself, not its name. Each file has:

| Field | Meaning |
|---|---|
| `kind` | `logo`, `icon` (app icon), `favicon`, `screenshot`, `social` (an Open Graph or store banner) or `other`. Left out, it is guessed: tiny squares are favicons, tall images screenshots, large squares icons. |
| `name`, `description` | What people see, and the name a download is saved under. |
| `background` | `light`, `dark` or `any`: what a logo is drawn to sit on, so its tile on the page matches. |
| `public` | `false` keeps a file in the kit but off the public page and API (working files, drafts). |
| `order` | Files sort by it, lowest first. |

SVGs that contain scripts, event handlers or embedded pages are refused; export
them again as plain SVG. Files count against the workspace's storage.

**Words.** A `tagline` (up to 160 characters) and an `about` text (up to 2,000;
blank lines start a new paragraph).

**Colours.** Up to 24, each with a `name`, a `hex` (`#rrggbb`) and a `usage`
note ("Buttons and links").

**Fonts.** Up to 6, each with a `name`, a `role` (`display`, `body`, `mono` or
`other`), `weights` ("400, 600"), a `sample` sentence, a `downloadUrl` and a
`cssUrl`. When `cssUrl` is a Google Fonts stylesheet
(`https://fonts.googleapis.com/css2?family=…`), the page loads it and is set in
your own type: the display font for headings, the body font for text. Other
hosts are refused, because the page only lets that one in.

**Guidelines.** Up to 20 sections, each a `title` and a Markdown `body`: clear
space, minimum sizes, what not to do, tone of voice.

## The public page

Turn it on under **Project → Brand → Page** (or `page.public: true`). It is at
`https://YOUR-SUPPORT-HOST/brand/PROJECT_PUBLIC_KEY`, needs no sign-in, works
without JavaScript, and prints cleanly. Every file has a **Download** button that
saves it under its name, and selecting a colour copies its hex value.

Choose how it looks:

| Setting | Values |
|---|---|
| `template` | `minimal` (default): your logo on your colour, then a quiet grid. `editorial`: a centred, type-led page for kits with a lot of guidelines. `split`: a panel in your colour beside the content, like a printed brand book. |
| `theme` | `auto` (follows the visitor), `light` or `dark`. |
| `radius` | `sharp`, `soft` or `round` corners. |
| `accent` | `#rrggbb`. Empty uses your first colour, then the project's accent. |
| `headline`, `intro` | The page's heading and lead. Empty uses the project's name and the tagline. |
| `sections` | Which sections show, in order: `colors`, `typography`, `logos` (logos and app icons), `screenshots`, `assets` (favicons, social images and other files) and `guidelines`. A section with nothing in it is left out. |

The page wears the [project style](STYLE.md): its light and dark colours (page,
card and text colours follow the visitor's scheme), corner radius and shadow.
**Brand → Page → Style** uses it as it is, or lays the page's own choices over it
(`page.style`, `{ "source": "custom", "custom": { … } }`, same fields as the
project style). `theme`, `radius` and `accent` above stay the page's own layer on
top of both; a `soft` radius (the default) follows the style's when it sets one.
The kit's own typefaces still set the page's type. `GET /v1/brand/{pk}` returns the
finished style as `style`.

The hero shows a logo drawn for the accent's shade (`background: dark` on a dark
accent), else any logo, else the app icon, else your name set in your display
font. With the page off, `/brand/…` and `GET /v1/brand/…` answer `404`.

## Put it on your site

One script tag frames the page into yours and keeps the frame as tall as its
content:

```html
<div id="brand"></div>
<script src="https://YOUR-SUPPORT-HOST/brand.js" data-project="pk_…" data-target="#brand" defer></script>
```

`brand.js` is MIT-licensed with no dependencies. Inside the frame there is no top
bar (your site has its own) and downloads still work. Any of the page's
settings can be overridden per embed:

```html
<script src="https://YOUR-SUPPORT-HOST/brand.js" data-project="pk_…" data-target="#press"
  data-template="editorial" data-theme="dark" data-radius="round" data-accent="#fca311" data-shadow="none"
  data-sections="logos,colors,typography" defer></script>
```

`data-radius` is `sharp`, `soft` or `round`, or a number of pixels (0 to 32);
`data-shadow` is `none`, `soft`, `medium` or `strong`.

Without `data-theme` the frame follows a `dark` or `light` class on your
`<html>`, then the kit page's style. The same overrides work on the page's URL
(`/brand/pk_…?template=split&theme=light&sections=logos,colors`), which is handy
for linking a journalist straight to the logos.

## In a Swift app

Most apps link to the page (an About screen's "Press kit" row). To show the kit
inside your app instead, read the public API with `URLSession`:

```swift
// BrandKitView.swift. MIT. A list of a HelpBites brand kit's colours and logos.
import SwiftUI

struct BrandKit: Decodable {
  struct Colour: Decodable, Hashable { let name, hex, usage: String }
  struct Asset: Decodable, Identifiable { let id, kind, name, url, downloadUrl: String }
  let name, tagline: String
  let colors: [Colour]
  let assets: [Asset]
}

struct BrandKitView: View {
  let host: URL
  let projectKey: String
  var cornerRadius: CGFloat = 12
  @State private var kit: BrandKit?

  var body: some View {
    List {
      if let kit {
        Section(kit.tagline) {
          ForEach(kit.colors, id: \.self) { colour in
            HStack {
              RoundedRectangle(cornerRadius: cornerRadius / 2).fill(Color(brandHex: colour.hex)).frame(width: 36, height: 36)
              VStack(alignment: .leading) { Text(colour.name); Text(colour.hex.uppercased()).font(.caption.monospaced()).foregroundStyle(.secondary) }
            }
          }
        }
        Section("Logos") {
          ForEach(kit.assets.filter { $0.kind == "logo" || $0.kind == "icon" }) { asset in
            Link(destination: host.appending(path: String(asset.downloadUrl.dropFirst()))) {
              HStack {
                AsyncImage(url: URL(string: asset.url)) { $0.resizable().scaledToFit() } placeholder: { Color.clear }
                  .frame(width: 56, height: 40).padding(6).background(.quaternary, in: .rect(cornerRadius: cornerRadius))
                Text(asset.name)
              }
            }
          }
        }
      }
    }
    .navigationTitle(kit?.name ?? "Brand")
    .task {
      struct Envelope: Decodable { let brand: BrandKit }
      let url = host.appending(path: "v1/brand/\(projectKey)")
      if let answer = try? await URLSession.shared.data(from: url) { kit = try? JSONDecoder().decode(Envelope.self, from: answer.0).brand }
    }
  }
}

extension Color {
  init(brandHex hex: String) {
    let v = Int(hex.dropFirst(), radix: 16) ?? 0
    self.init(red: Double(v >> 16 & 255) / 255, green: Double(v >> 8 & 255) / 255, blue: Double(v & 255) / 255)
  }
}
```

`cornerRadius` sets the shape of the swatches and tiles; fonts and colours come
from your app's own environment. It is your file, so change anything.

## Your own UI

The kit is one public request, open to any origin, for a press page you build
yourself:

```bash
curl -s https://YOUR-SUPPORT-HOST/v1/brand/PROJECT_PUBLIC_KEY
```

```json
{
  "brand": {
    "name": "Acme", "tagline": "Orders, sorted.", "about": "…", "accent": "#14213d",
    "colors": [{ "name": "Ink", "hex": "#14213d", "usage": "Text and the wordmark" }],
    "fonts": [{ "name": "Fraunces", "role": "display", "cssUrl": "https://fonts.googleapis.com/css2?family=Fraunces", "downloadUrl": "", "weights": "400, 600", "sample": "" }],
    "guidelines": [{ "id": "g_1", "title": "Clear space", "body": "Leave the height of the **A**.", "html": "<p>Leave the height of the <strong>A</strong>.</p>" }],
    "assets": [{ "id": "a1", "kind": "logo", "name": "Wordmark", "description": "", "url": "https://bucket.example.com/…/a.svg", "downloadUrl": "/brand/pk_…/files/a1", "mime": "image/svg+xml", "size": 2048, "width": 120, "height": 40, "background": "dark", "createdAt": "…" }],
    "page": { "url": "/brand/pk_…", "template": "minimal", "theme": "auto" }
  }
}
```

`url` is the file in the bucket, for `<img>`; `downloadUrl` (relative to
HelpBites) saves it under its name. Guidelines come as Markdown and as
sanitised `html`. Only public files are listed. Answers may be cached for a
minute; reads are limited to 600 a minute per IP address.

## Managing the kit over the API

Use an admin API key (**API keys**) or an operator session. Every route is
scoped to your workspace.

```bash
HOST=https://YOUR-SUPPORT-HOST
KEY=ak_...

# Upload a logo drawn for dark backgrounds
curl -s $HOST/v1/admin/brand/assets -H "authorization: Bearer $KEY" \
  -F project=PROJECT_ID -F file=@wordmark-white.svg -F kind=logo -F background=dark -F name="Wordmark, white"

# Set colours, a font and the page, and turn the page on
curl -s -X PATCH "$HOST/v1/admin/brand?project=PROJECT_ID" -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{
  "tagline": "Orders, sorted.",
  "colors": [{ "name": "Ink", "hex": "#14213d", "usage": "Text and the wordmark" }, { "name": "Signal", "hex": "#fca311", "usage": "Buttons" }],
  "fonts": [{ "name": "Fraunces", "role": "display", "cssUrl": "https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&display=swap" }],
  "page": { "public": true, "template": "split" }
}'
```

| Route | What it does |
|---|---|
| `GET /v1/admin/brand?project=` | The kit and every file, private ones too, and the page's `url`. |
| `PATCH /v1/admin/brand?project=` | Change the kit. `colors`, `fonts` and `guidelines` are full lists; `page` merges key by key. |
| `POST /v1/admin/brand/preview?project=` | The page's HTML with unsaved changes (`{ brand: … }`) applied. Nothing is saved; works while the page is off. |
| `POST /v1/admin/brand/assets` | Upload a file (multipart: `project`, `file`, and optionally `kind`, `name`, `description`, `background`, `public`). `402` when storage is full, `413` over 20 MB, `415` for other types. |
| `PATCH /v1/admin/brand/assets/{id}` | Change `name`, `description`, `kind`, `background`, `public` or `order`. |
| `DELETE /v1/admin/brand/assets/{id}` | Delete a file and free its storage. |
| `GET /v1/brand/{pk}` | Public: the kit. |
| `GET /brand/{pk}` | Public: the page. |
| `GET /brand/{pk}/files/{id}` | Public: one file, as a download. |

Invalid values answer `400` with every problem listed, and nothing is changed.
The full schema is in the OpenAPI docs at `/_docs/scalar`.

## Using the kit elsewhere in HelpBites

The kit is the project's look. Its accent (the page's `accent`, else the first
colour), logo, icon, typefaces and corner radius are what the chat widget,
feedback board, forms, onboarding, legal and blog pages, campaign mail and the
[public hub](HUB.md) all wear, and the API hands them out as `look` (for example
in `GET /v1/projects/{pk}/public`). The accent in the project's Settings is this
same colour: changing it there writes it here. Projects that never filled the kit
in keep using the older Settings accent and logo until they do.

In the panel, a logo or icon's menu has **Use as project logo** and **Use as
project icon**, which the chat widget, feedback board, emails and legal pages
already show. Onboarding steps can use any kit image as their picture.
