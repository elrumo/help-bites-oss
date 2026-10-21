# Onboarding

Show new users a few screens that explain your app, and change them from the
panel without shipping a release. You write the screens in HelpBites, publish,
and your web or Swift app shows them once to each person.

Onboarding runs on the first launch, which is exactly when a failing network
hurts most. So a flow is plain JSON your app can keep: the web script and the
Swift snippet below show the last copy they got, and you can ship a copy inside
your app for the very first launch. If HelpBites is down, onboarding still
shows.

## A flow

A flow is a list of steps under a **key**, the name your app asks for it by
(`welcome`, `pro-upgrade`). Each step has:

| Field | Meaning |
|---|---|
| `title` | Up to 120 characters. |
| `body` | Up to 600 characters. Line breaks are kept. |
| `imageUrl`, `imageAlt` | An optional picture (any https URL; uploads and brand kit files work too) and its description for screen readers. |
| `buttonLabel` | The button text. Empty uses the client's own: **Continue**, and **Get started** on the last step. |
| `pricingTable` | The key of one of the project's [pricing tables](PRICING.md) to show under the text, such as a paywall at the end of the tour; choosing a plan finishes the tour. The public flow carries the published table as the step's `pricing` (null while it is a draft). `onboarding.js` draws it; the Swift snippet below shows the step's text only. |

A flow has up to 12 steps, and a project up to 50 flows. The flow also has a
`style` and `options`:

| Field | Meaning |
|---|---|
| `style.accent` | `#rrggbb`. Empty uses the project's accent. |
| `style.background`, `style.text` | `#rrggbb`. Empty follows the app's light or dark theme. |
| `style.radius` | The card's corner radius, 0 to 32. Default 20. |
| `style.font` | `system`, `rounded`, `serif` or `mono`. |
| `options.skippable` | Show **Skip** (and let Escape close it). Default `true`. |
| `options.progress` | `bar`, `dots` or `none`. |

Create and edit flows under **Project → Onboarding**, in the web panel or the
native app.

## Drafts and versions

Editing changes the working copy only. Your apps keep getting the published
version until you **Publish** again, which freezes the working copy into the
next version (1, 2, 3…). The panel tells you when there are changes you have
not published.

**Unpublish** makes the public URL answer `404`. The web script forgets its
cached copy when it sees that, and the Swift snippet deletes its own, so the flow
stops showing. Changing a published flow's key moves its URL in the same way.

## Plug and play: web

One script tag. It shows the flow `welcome` as a dialog, once per browser:

```html
<script src="https://YOUR-SUPPORT-HOST/onboarding.js" data-project="pk_…" data-flow="welcome" defer></script>
```

It is MIT-licensed, has no dependencies, and draws the flow from JSON in your
page (in a shadow root, so your CSS and its CSS never collide). It never waits
long: when HelpBites does not answer within four seconds it uses the last copy
it saved, and the dialog never blocks your page from loading.

### Options

Set them as `data-*` attributes or in `init`:

| Option | Meaning |
|---|---|
| `flow` | The flow's key. Default `welcome`. |
| `show` | `once` (default) shows it one time per browser. `update` shows it again after each publish. `always` shows it on every load (handy while you test). `manual` only shows it when you call `open`. |
| `target` | A selector. Draws the flow inline in that element, as a card on your own welcome page, instead of a dialog. |
| `theme` | `system`, `light` or `dark`. Defaults to a `dark` or `light` class on your `<html>`, then the visitor's system setting. |
| `accent`, `radius`, `font` | Override the flow's style. |
| `fallback` | A selector for a `<script type="application/json">` holding an offline copy (see below), or the copy itself in `init`. |
| `locale` | The translation to show, a language tag such as `es` or `pt-BR`. Defaults to your `<html lang>`, then the browser's language. A flow without that translation shows in its own language. See [Languages](LANGUAGES.md). |
| `host` | Where HelpBites is, when you serve `onboarding.js` from your own site. |

```html
<script>
  window.HelpBitesOnboarding = window.HelpBitesOnboarding || []
  HelpBitesOnboarding.push(['init', {
    show: 'update',
    labels: { next: 'Next', done: 'Start', back: 'Back', skip: 'Not now' },
    onComplete: (flow) => analytics.track('onboarding_done', { version: flow.version }),
    onSkip: (flow, step) => analytics.track('onboarding_skipped', { step }),
    onStep: (step, flow) => {}
  }])
</script>
<script src="https://YOUR-SUPPORT-HOST/onboarding.js" data-project="pk_…" data-flow="welcome" defer></script>
```

Other calls: `HelpBitesOnboarding.push(['open'])` shows it now whatever the
visitor saw before (a "Take the tour" link), `['close']`, and `['reset']`
forgets that this browser saw it. Every outcome is also a
`helpbites:onboarding` event on `window`, with `detail.type` set to `show`,
`step`, `complete` or `skip`.

### Restyle it

The flow's style is the starting point; your CSS can change any of it. Set these
variables on `.help-bites-onboarding`:

```css
.help-bites-onboarding {
  --hb-onboarding-accent: #0ea5e9;
  --hb-onboarding-on-accent: #fff;     /* text on the button */
  --hb-onboarding-bg: #fff;
  --hb-onboarding-text: #0f172a;
  --hb-onboarding-muted: #64748b;
  --hb-onboarding-radius: 24px;
  --hb-onboarding-font: "Inter", sans-serif;
  --hb-onboarding-backdrop: rgb(15 23 42 / 0.6);
  --hb-onboarding-width: 440px;
}
.help-bites-onboarding::part(title) { letter-spacing: -0.02em; }
```

Parts you can style: `overlay`, `card`, `progress`, `skip`, `media`, `image`,
`title`, `body`, `actions`, `back` and `next`. The layout is HelpBites'.

### Offline copy

Each flow has **Download offline copy** in the panel. It saves
`onboarding-<key>.json`, the same JSON the API returns. Put it in your page for
visitors who arrive while HelpBites is down and have no saved copy yet:

```html
<script type="application/json" id="welcome-flow">{ "flow": { "key": "welcome", … } }</script>
<script src="https://YOUR-SUPPORT-HOST/onboarding.js" data-project="pk_…" data-flow="welcome" data-fallback="#welcome-flow" defer></script>
```

The script itself is cached by browsers for five minutes and may be served
stale for a week if HelpBites cannot be reached. For a first visit that works
with HelpBites entirely down, serve `onboarding.js` from your own site as well
and tell it where HelpBites is:

```html
<script src="/js/onboarding.js" data-host="https://YOUR-SUPPORT-HOST" data-project="pk_…" data-flow="welcome" data-fallback="#welcome-flow" defer></script>
```

**What it tries, in order:** a copy it saved in the last ten minutes, then
HelpBites (four seconds), then any copy it saved, then your offline copy. With
none of them, it shows nothing. A step whose image does not load shows without
it.

## Plug and play: Swift

Paste this file into your app. It needs no package: plain `URLSession` against
the public API.

```swift
// HelpBitesOnboarding.swift. MIT. Shows a HelpBites onboarding flow once. iOS 17, macOS 14.
import SwiftUI

struct HelpBitesFlow: Codable, Identifiable, Equatable {
  struct Step: Codable, Identifiable, Equatable { let id, title, body, imageUrl, imageAlt, buttonLabel: String }
  struct Style: Codable, Equatable { let accent, background, text, font: String; let radius: Double }
  struct Options: Codable, Equatable { let skippable: Bool; let progress: String }
  let key, name, locale: String
  let version: Int
  let style: Style
  let options: Options
  let steps: [Step]
  var id: String { key }
}

enum HelpBitesOnboarding {
  /// The freshest copy that answers: HelpBites (4 s), then the last good copy, then `onboarding-<key>.json` in your bundle.
  /// `locale` is the translation to ask for: the user's first language unless you say otherwise.
  static func load(host: URL, projectKey: String, flow key: String, locale: String = Locale.preferredLanguages.first ?? "en") async -> HelpBitesFlow? {
    let saved = URL.cachesDirectory.appending(path: "helpbites-onboarding-\(key)-\(locale).json")
    var url = URLComponents(url: host.appending(path: "v1/onboarding/\(projectKey)/\(key)"), resolvingAgainstBaseURL: false)!
    url.queryItems = [URLQueryItem(name: "locale", value: locale)]
    let request = URLRequest(url: url.url!, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 4)
    if let answer = try? await URLSession.shared.data(for: request), let status = (answer.1 as? HTTPURLResponse)?.statusCode {
      if status == 404 { try? FileManager.default.removeItem(at: saved); return nil }
      if status == 200, let flow = decode(answer.0) { try? answer.0.write(to: saved); return flow }
    }
    if let data = try? Data(contentsOf: saved), let flow = decode(data) { return flow }
    if let url = Bundle.main.url(forResource: "onboarding-\(key)", withExtension: "json"), let data = try? Data(contentsOf: url) { return decode(data) }
    return nil
  }

  private struct Envelope: Decodable { let flow: HelpBitesFlow }
  static func decode(_ data: Data) -> HelpBitesFlow? { try? JSONDecoder().decode(Envelope.self, from: data).flow }
}

extension View {
  /// Shows the flow once, or again after each publish with `everyVersion`. `onFinish(true)` when completed, `false` when skipped.
  func helpBitesOnboarding(host: URL, projectKey: String, flow key: String, locale: String? = nil, everyVersion: Bool = false,
                           accent: Color? = nil, cornerRadius: CGFloat? = nil, design: Font.Design? = nil,
                           onFinish: @escaping (Bool) -> Void = { _ in }) -> some View {
    modifier(HelpBitesOnboardingPresenter(host: host, projectKey: projectKey, key: key, locale: locale, everyVersion: everyVersion,
                                          accent: accent, cornerRadius: cornerRadius, design: design, onFinish: onFinish))
  }
}

private struct HelpBitesOnboardingPresenter: ViewModifier {
  let host: URL, projectKey: String, key: String, locale: String?, everyVersion: Bool
  let accent: Color?, cornerRadius: CGFloat?, design: Font.Design?
  let onFinish: (Bool) -> Void
  @State private var flow: HelpBitesFlow?

  func body(content: Content) -> some View {
    content
      .task {
        guard let loaded = await HelpBitesOnboarding.load(host: host, projectKey: projectKey, flow: key, locale: locale ?? Locale.preferredLanguages.first ?? "en"), !loaded.steps.isEmpty else { return }
        let seen = UserDefaults.standard.integer(forKey: "helpbites.onboarding.\(key)")
        if seen == 0 || (everyVersion && seen < loaded.version) { flow = loaded }
      }
      .sheet(item: $flow) { flow in
        HelpBitesOnboardingView(flow: flow, accent: accent, cornerRadius: cornerRadius, design: design) { completed in
          UserDefaults.standard.set(flow.version, forKey: "helpbites.onboarding.\(key)")
          self.flow = nil
          onFinish(completed)
        }
        .interactiveDismissDisabled(!flow.options.skippable)
      }
  }
}

struct HelpBitesOnboardingView: View {
  let flow: HelpBitesFlow
  var accent: Color?
  var cornerRadius: CGFloat?
  var design: Font.Design?
  let onFinish: (Bool) -> Void
  @State private var index = 0

  var body: some View {
    let step = flow.steps[index], last = index == flow.steps.count - 1
    let tint = accent ?? Color(hex: flow.style.accent) ?? .accentColor
    let onTint = accent == nil && Color(hex: flow.style.accent) != nil ? Color.readable(on: flow.style.accent) : .white
    let radius = cornerRadius ?? flow.style.radius
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 5) {
        if flow.options.progress != "none" && flow.steps.count > 1 {
          ForEach(flow.steps.indices, id: \.self) { i in
            let dots = flow.options.progress == "dots"
            Capsule().fill(i == index || (!dots && i < index) ? tint : Color.secondary.opacity(0.2))
              .frame(width: dots ? (i == index ? 18 : 6) : nil, height: dots ? 6 : 3)
              .frame(maxWidth: dots ? nil : .infinity)
          }
        }
        Spacer(minLength: 12)
        if flow.options.skippable && !last { Button("Skip") { onFinish(false) }.buttonStyle(.plain).foregroundStyle(.secondary) }
      }
      .frame(minHeight: 28)
      if let url = URL(string: step.imageUrl), !step.imageUrl.isEmpty {
        AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { Color.clear }
          .frame(maxWidth: .infinity).aspectRatio(4 / 3, contentMode: .fit)
          .background(tint.opacity(0.1), in: .rect(cornerRadius: max(0, radius - 8)))
          .accessibilityLabel(step.imageAlt)
      }
      Text(step.title).font(.title2.weight(.semibold))
      Text(step.body).foregroundStyle(.secondary)
      Spacer(minLength: 0)
      HStack(spacing: 10) {
        if index > 0 { Button("Back") { withAnimation { index -= 1 } }.buttonStyle(.bordered).controlSize(.large) }
        Button {
          if last { onFinish(true) } else { withAnimation { index += 1 } }
        } label: {
          // A step's own label is shown as written; the defaults are your app's own strings, so they follow its localisation.
          (step.buttonLabel.isEmpty ? Text(LocalizedStringKey(last ? "Get started" : "Continue")) : Text(verbatim: step.buttonLabel)).fontWeight(.semibold)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(tint, in: .rect(cornerRadius: max(6, radius * 0.6))).foregroundStyle(onTint)
        }
        .buttonStyle(.plain)
      }
    }
    .padding(24)
    .fontDesign(design ?? Self.designs[flow.style.font] ?? .default)
    .background(Color(hex: flow.style.background) ?? Color.clear)
    .foregroundStyle(Color(hex: flow.style.text).map { AnyShapeStyle($0) } ?? AnyShapeStyle(.primary))
  }

  private static let designs: [String: Font.Design] = ["rounded": .rounded, "serif": .serif, "mono": .monospaced]
}

extension Color {
  init?(hex: String) {
    guard hex.count == 7, hex.hasPrefix("#"), let v = Int(hex.dropFirst(), radix: 16) else { return nil }
    self.init(red: Double(v >> 16 & 255) / 255, green: Double(v >> 8 & 255) / 255, blue: Double(v & 255) / 255)
  }

  /// Black or white, whichever reads better on `hex`.
  static func readable(on hex: String) -> Color {
    let v = Int(hex.dropFirst(), radix: 16) ?? 0
    let lin = { (c: Int) -> Double in let s = Double(c) / 255; return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4) }
    return 0.2126 * lin(v >> 16 & 255) + 0.7152 * lin(v >> 8 & 255) + 0.0722 * lin(v & 255) > 0.179 ? .black : .white
  }
}
```

Then, on your first screen:

```swift
ContentView()
  .helpBitesOnboarding(host: URL(string: "https://YOUR-SUPPORT-HOST")!, projectKey: "pk_…", flow: "welcome")
```

**Languages.** The flow is requested in the user's first language
(`Locale.preferredLanguages`), or the one you pass as `locale:`. HelpBites answers
with that translation when the flow has it and with the flow's own language
otherwise (see [Languages](LANGUAGES.md)). The words the snippet itself adds
("Continue", "Get started", "Skip", "Back") are your app's strings: add them to
your `Localizable.xcstrings`.

**Customise it** with `accent`, `cornerRadius` and `design` (`.rounded`,
`.serif`…), or skip the presenter and put `HelpBitesOnboardingView` wherever you
like: in a `fullScreenCover`, a page of your own, or a `TabView`. It is your
file, so change anything.

**Offline.** Add the panel's **Download offline copy** file
(`onboarding-welcome.json`) to your app target. A first launch without a
network then shows that copy; later launches show the last copy they saved in
the Caches folder. Images load from their URLs and are left out when they
cannot load; for a fully offline first launch, use flows without images or point
them at files your app can reach.

## Your own UI

The flow is one public request, open to any origin:

```bash
curl -s https://YOUR-SUPPORT-HOST/v1/onboarding/PROJECT_PUBLIC_KEY/welcome
```

```json
{
  "flow": {
    "key": "welcome", "name": "Welcome", "locale": "en", "locales": ["en", "es"], "version": 3, "publishedAt": "2026-10-21T09:00:00.000Z",
    "project": { "name": "Acme", "logoUrl": "https://cdn.acme.test/icon.png" },
    "style": { "accent": "#0ea5e9", "background": "", "text": "", "radius": 20, "font": "system" },
    "options": { "skippable": true, "progress": "bar" },
    "steps": [{ "id": "st_1", "title": "Welcome to Acme", "body": "Track every order in one place.", "imageUrl": "", "imageAlt": "", "buttonLabel": "" }]
  }
}
```

- `404` for an unknown project, an unknown key, or a flow that is not published.
  Treat it as "show nothing", and drop any copy you saved.
- `?locale=es` (or an `Accept-Language` header) asks for a translation. You get
  the first language the flow has, matching `es-MX` to `es`, and the flow's own
  language when it has none; `locale` says which one you got and `locales` lists
  every language the flow has. Answers `Vary` on `Accept-Language`.
- Answers carry an `ETag` (send it back as `If-None-Match` for a `304`) and may be
  cached for 60 seconds. A CDN in front of HelpBites may serve a stale answer for
  a day while it refreshes, and for a week if HelpBites is down
  (`stale-if-error`).
- Reads are limited to 1,200 a minute per IP address (`429` past that).

Remember yourself whether a user has seen a version: store the `version` they
finished, and show the flow again when the API returns a higher one if you want
them to see updates.

## Managing flows over the API

Use an admin API key (**API keys**) or an operator session. Every route is
scoped to your workspace; a key limited to some projects only reaches those.

```bash
HOST=https://YOUR-SUPPORT-HOST
KEY=ak_...

# Create a flow (it starts with three starter steps unless you send `steps`)
curl -s $HOST/v1/admin/onboarding/flows -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{ "project": "PROJECT_ID", "name": "Welcome", "key": "welcome" }'

# Replace its steps and change its look
curl -s -X PATCH $HOST/v1/admin/onboarding/flows/FLOW_ID -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{
  "steps": [
    { "title": "Welcome to Acme", "body": "Track every order in one place." },
    { "title": "Get notified", "body": "We tell you when an order ships.", "buttonLabel": "Turn on alerts" }
  ],
  "style": { "accent": "#0ea5e9", "font": "rounded" },
  "options": { "progress": "dots" }
}'

# Publish it (version 1)
curl -s -X POST $HOST/v1/admin/onboarding/flows/FLOW_ID/publish -H "authorization: Bearer $KEY"
```

| Route | What it does |
|---|---|
| `GET /v1/admin/onboarding/flows?project=` | Every flow, with its working copy, `published` (what apps get, or `null`) and `changed`. |
| `POST /v1/admin/onboarding/flows` | Create a draft. `key` must be unused in the project (`409`). |
| `GET /v1/admin/onboarding/flows/{id}` | One flow. |
| `PATCH /v1/admin/onboarding/flows/{id}` | Change `name`, `key`, `steps` (the full list), `style` or `options` (merged), `locale` (the language it is written in) or `translations` (below). |
| `POST /v1/admin/onboarding/flows/{id}/translate` | Translate the working copy with AI into `locales`, e.g. `["es","fr"]`; `overwrite: true` redoes strings that already have a translation. |
| `POST /v1/admin/onboarding/flows/{id}/publish` | Publish the working copy as the next version. `400` with no steps. |
| `POST /v1/admin/onboarding/flows/{id}/unpublish` | Back to a draft; the public URL answers `404`. |
| `DELETE /v1/admin/onboarding/flows/{id}` | Delete it. |
| `GET /v1/onboarding/{pk}/{key}` | Public: the published flow. |

Invalid values answer `400` with every problem listed. The full schema is in the
OpenAPI docs at `/_docs/scalar`.

## Languages

A flow is written in one language (`locale`, default `en`) and can carry a
translation per language: its name and, for each step, the `title`, `body`,
`imageAlt` and `buttonLabel`. A word a translation leaves out is shown in the
flow's own language, so a half-translated flow never shows a blank.

```json
"locale": "en",
"translations": {
  "es": { "name": "Bienvenida", "steps": { "st_1": { "title": "Te damos la bienvenida a Acme", "body": "Sigue todos tus pedidos en un solo lugar." } } }
}
```

Send `translations` to `PATCH` to write them yourself: a language you send
replaces that language, and `null` removes it. **Translate with AI** (in the
panel, or `POST …/translate`) fills the missing words and keeps what you wrote.
Translations are part of the version you publish, so they reach apps with it.
See [Languages](LANGUAGES.md) for how the AI translation works.
