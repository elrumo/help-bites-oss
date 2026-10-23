# Project style

One style for the whole project, shared by the features that have a style
panel: its logo and app icon, **light and dark** colours, corner radius, shadow
and font. Set it once and every public page wears all of it, in light and dark:
the changelog, feedback board, chat widget, hub, blog, brand page, legal pages,
forms, onboarding and pricing tables (see [Limits](#limits)).

## Where it is set

- **Project → Changelog → Style** and **Project → Feedback → Style** (and the same two buttons on the Brand page,
  Forms, Onboarding, Pricing, Blog design and Legal's look panels):
  **Edit project style** opens the editor, **Save as project style** takes what
  that panel has chosen (its accent, background, text, corner radius, font) and
  opens the same editor with it filled in, so you see exactly what will be saved.
- Over the API: the `style` object on `PATCH /v1/admin/projects/{id}`, read back
  as `style` (as saved) on the admin project and as `look.style` (every gap
  filled) on the public one.

The native app edits the project style too: **Brand → Style**, **Settings →
Branding** and **Changelog → More → Style** open the same editor (with a light and
dark preview), and the changelog's Style screen has **Save as project style**.

## The layers

Every value is optional. A value you leave empty comes from the layer below:

1. **A feature's own style** (`changelog.style.custom`, `feedback.style.custom`), only when its `source`
   is `custom`. Whatever it leaves empty still comes from the project style.
2. **The project style** (`style`).
3. **The Brand kit** (`Project.brand`): its accent (the page accent, else the
   first colour), corner radius, body font, logo and icon.
4. **Our defaults**: stone neutrals in light and dark, a soft shadow.

So changing the project style changes every feature that does not override it,
and a feature that overrides only the shadow keeps following the project's
colours.

| Field | Values |
|---|---|
| `scheme` | `auto` (follow the visitor), `light` or `dark`; empty is `auto`. |
| `light`, `dark` | `accent`, `background`, `surface` (cards), `text`, `muted` (secondary text), `border`: each `#rrggbb` or empty. An empty dark accent follows the light one. |
| `radius` | 0 to 32 CSS pixels, or `null` for the Brand kit's. |
| `shadow` | `none`, `soft`, `medium`, `strong`. |
| `font` | `system`, `serif` or `mono`; empty uses the Brand kit's body font. |
| `logoUrl`, `logoDarkUrl`, `iconUrl` | http(s) URLs; empty uses the Brand kit's. The dark logo falls back to the logo. |

`PATCH` is partial: only the keys you send change, `light` and `dark` merge
colour by colour, and an empty string (`null` for `radius`) clears a value.
Anything invalid is a `400` naming the field.

```bash
curl -X PATCH "https://YOUR-SUPPORT-HOST/v1/admin/projects/PROJECT_ID" \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{ "style": { "light": { "accent": "#e11d48" }, "dark": { "background": "#1e1b4b" }, "shadow": "medium", "radius": 14 } }'
```

## The feedback board

Project → Feedback → **Style** works exactly like the changelog's: use the
project style, or `feedback.style` (`{ "source": "custom", "custom": { … } }`,
same fields) over it. The board, its roadmap and its changelog views wear it in
light or dark, following the visitor unless the style fixes a `scheme`. The
finished style is `feedbackStyle` on `GET /v1/projects/{pk}/public` (and on
`GET /v1/feedback/config`'s `project`). The `feedback.js` script tag takes
`data-theme`, `data-accent`, `data-radius` and `data-shadow` as the changelog's
does, and the hosted board takes them as URL parameters. `data-header="false"` leaves out the logo, title and description (the view tabs and *New post* stay); `?header=0` does the same on the hosted board.

## The changelog

The public changelog page (`/changelog/pk_…`) and its embed wear its style in
light or dark, following the visitor unless the style fixes a `scheme`.

- **Use the project style** (`changelog.style.source: "project"`, the default).
- **Customise for the changelog** (`"custom"`): `changelog.style.custom` has the
  same fields as above. It is a partial `PATCH` like the rest of the changelog
  settings:

```bash
curl -X PATCH "https://YOUR-SUPPORT-HOST/v1/admin/projects/PROJECT_ID" \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{ "changelog": { "style": { "source": "custom", "custom": { "shadow": "none" } } } }'
```

`GET /v1/changelog?pk=pk_…` returns the finished style as `style`, so your own UI
can wear it too: the `light` and `dark` palettes are complete colours, `radius`
is pixels and `shadowCss` is a ready `box-shadow` value.

### On your site

```html
<div id="changelog"></div>
<script src="https://YOUR-SUPPORT-HOST/changelog.js" data-project="pk_…" data-target="#changelog" defer></script>
```

The embed is a frame, so your page's CSS does not reach it; the options are the
script tag's attributes, each overriding the style for this one embed:

| Attribute | Meaning |
|---|---|
| `data-theme` | `light`, `dark` or `system`. Without it: a `light` or `dark` class on your `<html>`, else the style's scheme, else the visitor's. |
| `data-accent` | `#rrggbb`, in light and dark. |
| `data-radius` | 0 to 32. |
| `data-shadow` | `none`, `soft`, `medium` or `strong`. |
| `data-header` | `false` leaves out the logo, title and description at the top, for a page that already shows them. The hosted page takes `?header=0`. |

The hosted page takes the same as URL parameters (`?theme=dark&accent=%23e11d48`).

## In a Swift app

The public project config carries the finished style, so a native screen can
wear the project in light and dark with `URLSession` and no package:

```swift
// ProjectStyle.swift. MIT. The project's palette, for the current light or dark appearance.
import SwiftUI

struct ProjectStyle: Decodable {
  struct Palette: Decodable { let accent, background, surface, text, muted, border: String }
  let radius: Int
  let light, dark: Palette
}

struct StyledCard<Content: View>: View {
  let style: ProjectStyle
  var cornerRadius: CGFloat? = nil   // override the project's
  @ViewBuilder var content: Content
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let palette = scheme == .dark ? style.dark : style.light
    content
      .foregroundStyle(Color(styleHex: palette.text))
      .padding()
      .background(Color(styleHex: palette.surface), in: .rect(cornerRadius: cornerRadius ?? CGFloat(style.radius)))
      .overlay(RoundedRectangle(cornerRadius: cornerRadius ?? CGFloat(style.radius)).stroke(Color(styleHex: palette.border)))
      .tint(Color(styleHex: palette.accent))
  }
}

extension Color {
  init(styleHex hex: String) {
    let v = Int(hex.dropFirst(), radix: 16) ?? 0
    self.init(red: Double(v >> 16 & 255) / 255, green: Double(v >> 8 & 255) / 255, blue: Double(v & 255) / 255)
  }
}

// let url = host.appending(path: "v1/projects/\(projectKey)/public")
// struct Answer: Decodable { struct Look: Decodable { let style: ProjectStyle }; let look: Look }
// let style = try JSONDecoder().decode(Answer.self, from: try await URLSession.shared.data(from: url).0).look.style
```

## Build your own

`look.style` and `GET /v1/changelog`'s `style` are everything a page needs: set
the colours of the current scheme as CSS variables, use `radius`, `shadowCss`
and `fontFamily` as they are, and pick `logoDarkUrl` on a dark background.

## The other public pages

**Hub, chat widget, blog, legal pages and brand page** each have a `style`
choice like the changelog's (`hub.style`, `widget.style`, `blog.style`,
`legal.style`, `brand.page.style`: `{ "source": "project" | "custom", "custom": { … } }`),
edited from a **Style** button in their panel and sent in a partial `PATCH` of
the project. The blog's design (accent, font, colour scheme), the legal look and
the brand page's theme, radius and accent stay as that feature's own layer on
top. The finished style is `style` on `GET /v1/hub/{pk}`, `GET /v1/blog` and
`GET /v1/brand/{pk}`, and `widgetStyle` on the public project.

**Forms, onboarding flows and pricing tables** keep the `style` each one has
(accent, background, text, radius, font…) as their own layer over the project
style: what a form, flow or table sets wins, in light and dark; what it leaves
empty comes from the project (dark palette, card colours, shadow, and the
project's radius and font where the form's are still at their default). The
finished style is `look` in their public payload.

Every script takes `data-accent`, `data-radius`, `data-shadow` and `data-theme`
(`widget.js` / `helpbites.js`, `blog.js`, `brand.js`, `forms.js`,
`onboarding.js`, `pricing.js`), each overriding the style for that embed;
the hosted pages take the same as URL parameters where they have them.

## Limits

- The Brand kit's typefaces are not loaded on the blog, legal, form, onboarding
  and pricing pages: they use the style's `system`, `serif` or `mono` family.
  The brand page and hub still load the kit's fonts.
- Forms, onboarding and pricing have no separate project-or-custom choice: their
  own style fields are that choice. Their panels can save their choices as the
  project style, and the project style shows through where they leave a field empty.
- The CMS pages (`pages.js`) do not wear the style yet.
- The native app edits the project style and the changelog's style, but not any
  other feature's, and its Swift snippets do not read the finished `look` / `style`.
