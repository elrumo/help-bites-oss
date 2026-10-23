# Project style

One style for the whole project, shared by the features that have a style
panel: its logo and app icon, **light and dark** colours, corner radius, shadow
and font. Set it once and the public changelog and feedback board wear all of it;
forms, onboarding, pricing tables, the blog and legal pages take its accent (see
[Limits](#limits)).

## Where it is set

- **Project → Changelog → Style** and **Project → Feedback → Style** (and the same two buttons on the Brand page,
  Forms, Onboarding, Pricing, Blog design and Legal's look panels):
  **Edit project style** opens the editor, **Save as project style** takes what
  that panel has chosen (its accent, background, text, corner radius, font) and
  opens the same editor with it filled in, so you see exactly what will be saved.
- Over the API: the `style` object on `PATCH /v1/admin/projects/{id}`, read back
  as `style` (as saved) on the admin project and as `look.style` (every gap
  filled) on the public one.

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
does, and the hosted board takes them as URL parameters.

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

## Limits

- Forms, onboarding, pricing tables, the blog and legal pages keep their own
  accent, background, text, radius and font fields. They take the project's
  **accent** when theirs is empty; the rest of the project style (dark palette,
  shadow, cards) is not applied to them yet. Their panels can save their
  choices as the project style, but not the other way round.
- The chat widget, the public hub, the brand and blog pages and the other embeds do not wear the full style yet, only the accent they already read. The native app does not edit the project style or the changelog's or feedback board's style yet.
