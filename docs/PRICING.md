# Pricing tables

Show your plans on your site, in your app and in your onboarding, and change
them from the panel without a release. Write the plans, features and words in
HelpBites; link each plan to Stripe if you like, so its prices and checkout come
from Stripe and a change there shows everywhere. Then add one line to your site
or paste one file into your app.

## A table

A project has up to 50 tables, each with up to 6 plans and 40 feature rows.
Each table is drawn with one of five templates, and your site or app can pick a
different one when it shows it:

| Template | Suits |
|---|---|
| `tiers` (Cards) | Plans side by side, the highlighted one standing out. The classic pricing page. |
| `rows` | One compact line a plan: sidebars, settings screens, narrow spaces. |
| `paywall` | Benefits, selectable price rows and one button, like an app's upgrade screen. |
| `matrix` (Comparison) | Every feature by plan, in a table. |
| `spotlight` | One wide card a plan: a single plan or a lifetime deal. |

A **plan** has a name, a description, a badge ("Most popular"), whether it is
highlighted, up to four prices (weekly, monthly, yearly and one-time), a label
for a plan with no price ("Custom"), a line under the price ("per seat"), a free
trial and a button.

**Features** are rows shared by every plan: tick what each plan includes, or
give it a value ("10", "Unlimited") that shows beside the feature and in the
comparison table's cell. Headings group rows. With **Each plan builds on the one
before**, a card says "Everything in Starter, plus:" and lists only what it adds.

**Look:** accent, background and text colours (empty follows the project's
accent and the visitor's light or dark), corner radius, font (system, rounded,
serif, mono), spacing, flat, outlined or shadowed cards, and how the highlighted
plan stands out.

**Project style.** Whatever the table leaves empty comes from the project style
(**Project style** in the Look section, or [STYLE.md](STYLE.md)): its light and
dark colours, corner radius and shadow, and its font. A table that sets a colour
keeps it in light and dark; a radius or font left at the table's default (16,
system) follows the project's once the project sets one. A project with no style
of its own keeps the table exactly as it was.

**Drafts and versions.** You edit a working copy. Nothing changes on your site
or in your app until you publish; each publish is a new version, and
**Unpublish** takes the table down everywhere.
**Push live now** (the ⋯ menu, web and native) saves, publishes again even with nothing new
and re-reads Stripe at once, instead of from its short cache (`POST …/{id}/publish`
with `{ "force": true }`). The server keeps no copy of the public JSON, so it is live
at once; a visitor's browser or a CDN may hold the old answer for up to a minute. On the
web the panel also reloads the public JSON past its own browser's cache.
With `BUNNY_NET_API_KEY` set (your Bunny.net account API key), it also purges the CDN's
copies of the table's JSON (every language and currency) and hosted page, on `APP_URL`
and the address you opened the panel at; the answer then carries `cdn: { purged, error }`,
and a failed purge is reported but never blocks the publish.

## Stripe

Connect Stripe under **Revenue** in the panel, with a restricted key. Pricing
tables use these permissions of that key:

| Permission | For |
|---|---|
| Products: Read, Prices: Read | The product and price pickers, and the prices shown. |
| Payment Links: Read | Buttons that open a Stripe Payment Link. |
| Checkout Sessions: Write | Buttons that open Stripe Checkout. |
| Checkout Sessions: Read | Counting purchases and revenue for the table's numbers and A/B tests. |

Pick a **Stripe product** for a plan and each slot takes the product's current
price for that period, or pick a price yourself. A Stripe price wins over a
written one, so Stripe stays the truth for what you charge; the plan's name,
description and features stay yours (empty name and description show Stripe's,
and **Add Stripe's features** copies the product's marketing features into
rows). Plans without Stripe show the prices you write.

HelpBites reads Stripe through the key and keeps the answer for five minutes
(**Read Stripe again** asks now). Publishing keeps a copy of the Stripe prices it
used, so a published table still shows the right prices if Stripe is briefly
unreachable. **Check before publishing** lists what would not work: a plan with
no price, a plan set to Checkout without a Stripe price, a Payment Link button
with no active link for its price, a product or price archived in Stripe. When a
checkout fails (a key without "Checkout Sessions: Write", say), the editor shows
the last error.

Metered and tiered prices are left out: a table shows fixed prices.

## Billing periods and currencies

Each plan has four slots: `week`, `month`, `year` and `once`. When the plans have
prices for two or more of the periods that bill again, the table shows a toggle
(with the best yearly saving as a badge); a one-time price shows on its own.
**Toggle starts on** picks the slot it opens on. A yearly price shows as the
yearly total, or as a month billed yearly; in an iPhone app, show the total, as
the App Store wants the amount billed to stand out.

The table has a **currency**: written prices are in it, and a Stripe price that
sells in several currencies shows in it. Visitors can see another one:

- A Stripe price with **currency options** can be shown in each of its
  currencies.
- A written price can have **prices in other currencies** (under the plan's
  prices in the panel, or `amounts` in the API: `{ "eur": 9, "gbp": 8 }`).

Ask for a currency with `currency=eur` (the web script's `data-currency`, or
`auto` for the visitor's region). The table shows in it when every price has it,
and lists in `currencies` every currency all its prices share, for a switcher.
Otherwise it shows in its own currency.

## Buttons and checkout

Each plan's button does one of four things:

| Button | What happens |
|---|---|
| Stripe Checkout | HelpBites opens a new Stripe Checkout Session for the price, with the plan's trial and **Accept promotion codes**. The key needs "Checkout Sessions: Write"; without it, a Payment Link for the same price is used when there is one. |
| Stripe Payment Link | The Payment Link that sells the price. |
| A link of yours | Your sign-up page, a contact form, anything. `{plan}` and `{interval}` are filled in with the plan's key and `week`, `month`, `year` or `once`. |
| No button | Just the plan. |

A Checkout button links to `GET /v1/pricing/{pk}/{key}/checkout?plan=pro&interval=year`,
which answers `303` to Stripe, so a plain link, an email button or an app's
`openURL` all work. Add `prefilled_email`, `client_reference_id` (your id for the
buyer) and `return_url`. After paying, Stripe sends the buyer to the table's
**After paying** URL, else `return_url` (when its site is one of the project's
allowed origins, or any while it lists none), else the project's site, else the
hosted page, with `?checkout=success&session_id=…`; going back adds
`?checkout=canceled`. `POST` the same URL with JSON for `{ url }` instead.

The session's metadata carries `helpbites_table`, `helpbites_plan`,
`helpbites_interval` and, during a test, `helpbites_experiment` and
`helpbites_run`. `client_reference_id` is not verified (anyone can send any): give
the account in a Stripe webhook of your own, matched by the email or the
metadata, with your own checks.

## Plug and play: web

One script tag draws the table where you put it:

```html
<script src="https://YOUR-SUPPORT-HOST/pricing.js" data-project="pk_…" data-table="pricing" defer></script>
```

It is MIT-licensed, has no dependencies, and draws from JSON in your page (in a
shadow root, so your CSS and its CSS never collide). Without `data-table` it
draws the project's first published table.

### Options

Set them as `data-*` attributes or in `init`:

| Option | Meaning |
|---|---|
| `table` | The table's key. |
| `target` | A selector to draw into, instead of where the script tag is. |
| `template` | `tiers`, `rows`, `paywall`, `matrix` or `spotlight`: overrides the table's. |
| `theme` | `light`, `dark` or `system`. Defaults to a `dark` or `light` class on your `<html>`, then the project style's scheme if it fixes one, then the colour behind the table. |
| `accent`, `radius`, `font`, `density` | Override the table's look. `radius` is 0 to 32. |
| `shadow` | `none`, `soft`, `medium` or `strong`: the shadow of tables whose cards are shadowed. Defaults to the project style's. |
| `interval` | `week`, `month` or `year`: where the toggle starts. |
| `currency` | A three-letter code, or `auto` for the visitor's region. A switcher offers the others when there are any. |
| `locale` | A language tag. Defaults to your `<html lang>`, then the browser's. See [Languages](LANGUAGES.md). |
| `show` | The parts to show: `title,subtitle,toggle,currency,features,footnote,logo` by default, `none` for just the plans. |
| `current` | The key of the visitor's plan: its button says "Current plan". |
| `email`, `ref` | Filled into checkout: the buyer's email and your id for them. |
| `return` | Where checkout comes back to. Default: this page. |
| `host` | Where HelpBites is, when you serve `pricing.js` from your own site. |

```html
<script>
  window.HelpBitesPricing = window.HelpBitesPricing || []
  HelpBitesPricing.push(['init', {
    email: currentUser.email, ref: currentUser.id, current: 'starter',
    labels: { yearly: 'Annual', choose: 'Choose' },
    // Return false to handle it yourself: your own checkout, a sign-up first.
    onSelect: (plan, interval, price) => {}
  }])
  HelpBitesPricing.push(['render', { table: 'teams', target: '#team-pricing' }])   // a second table
</script>
<script src="https://YOUR-SUPPORT-HOST/pricing.js" data-project="pk_…" data-table="pricing" defer></script>
```

Every outcome is also a `helpbites:pricing` event on `window`, with
`detail.type` and the table's key.

### Restyle it

The table's look is the starting point; your CSS can change any of it. Set these
variables on `.help-bites-pricing`:

```css
.help-bites-pricing {
  --hb-pricing-accent: #0ea5e9;
  --hb-pricing-on-accent: #fff;   /* text on the accent */
  --hb-pricing-bg: transparent;
  --hb-pricing-card: #fff;
  --hb-pricing-text: #0f172a;
  --hb-pricing-muted: #64748b;
  --hb-pricing-border: #e2e8f0;
  --hb-pricing-radius: 20px;
  --hb-pricing-font: "Inter", sans-serif;
  --hb-pricing-gap: 20px;
  --hb-pricing-max-width: 1100px;
}
.help-bites-pricing::part(plan-highlighted) { transform: scale(1.03); }
```

Parts you can style: `root`, `head`, `title`, `subtitle`, `toggle`,
`toggle-option`, `savings`, `plans`, `plan`, `plan-highlighted`, `badge`, `name`,
`description`, `price`, `amount`, `period`, `compare`, `note`, `trial`, `button`,
`includes`, `features`, `feature`, `value`, `hint`, `option`, `table`,
`footnote` and `links`. The layout is HelpBites'.

## A hosted page

Every published table has a page of its own, to link to from an email or open in
an app's web view, or to put in an iframe:

```
https://YOUR-SUPPORT-HOST/pricing/PROJECT_PUBLIC_KEY/pricing
```

It wears the project style in light and dark (following the visitor unless the style fixes a scheme), shows in the visitor's language, and checkout comes back to it when the table
names nowhere else.

## Plug and play: Swift

Paste this file into your app. It needs no package: plain `URLSession` against
the public API.

```swift
// HelpBitesPricing.swift. MIT. Shows a HelpBites pricing table. iOS 17, macOS 14.
import SwiftUI

struct HelpBitesPricingTable: Codable, Equatable {
  struct Price: Codable, Equatable {
    let interval, currency, appStoreProduct: String
    let amount: Double
    let monthly: Double?
    let intervalCount, trialDays: Int
    let href: String?
  }
  struct Line: Codable, Equatable, Identifiable { let id, text, hint, value: String; let included: Bool }
  struct Action: Codable, Equatable { let type, label: String; let href: String? }
  struct Plan: Codable, Equatable, Identifiable {
    let id, key, name, description, badge, customPrice, priceNote, includes: String
    let highlighted: Bool
    let savings: Int
    let prices: [String: Price]
    let action: Action
    let lines: [Line]
  }
  struct Content: Codable, Equatable { let title, subtitle, footnote, weeklyLabel, monthlyLabel, yearlyLabel, savingsLabel: String }
  struct Style: Codable, Equatable { let accent, font: String; let radius: Double }
  struct Options: Codable, Equatable { let defaultInterval, yearlyAs: String }
  struct Experiment: Codable, Equatable { let table, run: String }
  let key, locale, currency: String
  let version: Int
  let intervals, currencies: [String]
  let experiment: Experiment?
  let content: Content
  let style: Style
  let options: Options
  let plans: [Plan]
}

enum HelpBitesPricing {
  /// HelpBites (8 s), else the last copy that loaded. `currency` is a three-letter code: the table's own when not every price has it.
  static func load(host: URL, projectKey: String, table key: String, locale: String = Locale.preferredLanguages.first ?? "en",
                   currency: String = Locale.current.currency?.identifier ?? "") async -> HelpBitesPricingTable? {
    let saved = URL.cachesDirectory.appending(path: "helpbites-pricing-\(key)-\(locale)-\(currency).json")
    var url = URLComponents(url: host.appending(path: "v1/pricing/\(projectKey)/\(key)"), resolvingAgainstBaseURL: false)!
    url.queryItems = [URLQueryItem(name: "locale", value: locale), URLQueryItem(name: "currency", value: currency.lowercased()), URLQueryItem(name: "visitor", value: visitor)]
    let request = URLRequest(url: url.url!, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 8)
    if let answer = try? await URLSession.shared.data(for: request), let status = (answer.1 as? HTTPURLResponse)?.statusCode {
      if status == 404 { try? FileManager.default.removeItem(at: saved); return nil }
      if status == 200, let table = decode(answer.0) { try? answer.0.write(to: saved); return table }
    }
    return (try? Data(contentsOf: saved)).flatMap(decode)
  }

  /// An id kept for this install: the table's numbers count each person once, and an A/B test shows them the same table.
  static var visitor: String {
    if let id = UserDefaults.standard.string(forKey: "helpbites.visitor") { return id }
    let id = "v_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16).lowercased()
    UserDefaults.standard.set(id, forKey: "helpbites.visitor")
    return id
  }

  /// A view or a click for the table's numbers: sent and forgotten.
  static func count(_ type: String, host: URL, projectKey: String, table: HelpBitesPricingTable, plan: String? = nil, interval: String? = nil) {
    var request = URLRequest(url: host.appending(path: "v1/pricing/\(projectKey)/\(table.key)/events"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    var body = ["type": type, "visitor": visitor]
    if let plan { body["plan"] = plan }
    if let interval { body["interval"] = interval }
    if let experiment = table.experiment { body["experiment"] = experiment.table; body["run"] = experiment.run }
    request.httpBody = try? JSONEncoder().encode(body)
    Task.detached { _ = try? await URLSession.shared.data(for: request) }
  }

  private struct Envelope: Decodable { let table: HelpBitesPricingTable }
  static func decode(_ data: Data) -> HelpBitesPricingTable? { try? JSONDecoder().decode(Envelope.self, from: data).table }
}

struct HelpBitesPricingView: View {
  let host: URL, projectKey: String, table: String
  var locale: String?
  var currency: String?
  /// The key of the user's plan: its button says "Current plan".
  var current: String?
  var accent: Color?
  var cornerRadius: CGFloat?
  var design: Font.Design?
  /// Return true when you handled it (StoreKit with `price.appStoreProduct`, a sign-up first); otherwise its link opens.
  var onSelect: (HelpBitesPricingTable.Plan, HelpBitesPricingTable.Price?) -> Bool = { _, _ in false }
  @State private var loaded: HelpBitesPricingTable?
  @State private var interval = ""
  @Environment(\.openURL) private var openURL

  var body: some View {
    Group {
      if let loaded { content(loaded) } else { ProgressView().frame(maxWidth: .infinity, minHeight: 160) }
    }
    .task {
      guard let table = await HelpBitesPricing.load(host: host, projectKey: projectKey, table: self.table, locale: locale ?? Locale.preferredLanguages.first ?? "en",
                                                    currency: currency ?? Locale.current.currency?.identifier ?? "") else { return }
      let recurring = table.intervals.filter { $0 != "once" }
      interval = recurring.contains(table.options.defaultInterval) ? table.options.defaultInterval : recurring.first ?? table.intervals.first ?? ""
      loaded = table
      HelpBitesPricing.count("view", host: host, projectKey: projectKey, table: table)
    }
  }

  private func content(_ t: HelpBitesPricingTable) -> some View {
    let tint = accent ?? hexColor(t.style.accent) ?? .accentColor
    let radius = cornerRadius ?? t.style.radius
    let recurring = t.intervals.filter { $0 != "once" }
    return VStack(spacing: 16) {
      if !t.content.title.isEmpty { Text(t.content.title).font(.title2.weight(.bold)).multilineTextAlignment(.center) }
      if !t.content.subtitle.isEmpty { Text(t.content.subtitle).foregroundStyle(.secondary).multilineTextAlignment(.center) }
      if recurring.count > 1 {
        Picker("Billing period", selection: $interval) {
          ForEach(recurring, id: \.self) { slot in Text(verbatim: periodLabel(slot, t)).tag(slot) }
        }
        .pickerStyle(.segmented)
      }
      ForEach(t.plans) { plan in card(plan, t, tint: tint, radius: radius) }
      if !t.content.footnote.isEmpty { Text(t.content.footnote).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center) }
    }
    .fontDesign(design ?? Self.designs[t.style.font] ?? .default)
  }

  private func card(_ plan: HelpBitesPricingTable.Plan, _ t: HelpBitesPricingTable, tint: Color, radius: CGFloat) -> some View {
    let price = plan.prices[interval] ?? plan.prices["once"] ?? plan.prices.values.first
    return VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(plan.name).font(.headline)
        Spacer(minLength: 8)
        if !plan.badge.isEmpty {
          Text(plan.badge).font(.caption.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 3)
            .background(tint.opacity(0.15), in: Capsule()).foregroundStyle(tint)
        }
      }
      if !plan.description.isEmpty { Text(plan.description).font(.subheadline).foregroundStyle(.secondary) }
      priceLines(plan, price, t)
      if !plan.includes.isEmpty { Text(plan.includes).font(.footnote.weight(.semibold)) }
      ForEach(plan.lines) { line in
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Image(systemName: line.included ? "checkmark" : "minus").font(.footnote.weight(.bold)).foregroundStyle(line.included ? tint : Color.secondary)
          Text(line.text).foregroundStyle(line.included ? Color.primary : Color.secondary)
          Spacer(minLength: 8)
          if !line.value.isEmpty { Text(line.value).fontWeight(.semibold) }
        }
        .font(.subheadline)
      }
      if plan.action.type != "none" { button(plan, price, t, tint: tint, radius: radius) }
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.background, in: .rect(cornerRadius: radius))
    .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(plan.highlighted ? tint : Color.secondary.opacity(0.25), lineWidth: plan.highlighted ? 2 : 1))
  }

  @ViewBuilder private func priceLines(_ plan: HelpBitesPricingTable.Plan, _ price: HelpBitesPricingTable.Price?, _ t: HelpBitesPricingTable) -> some View {
    if let price {
      let monthly = price.interval == "year" && t.options.yearlyAs == "monthly" ? price.monthly : nil
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(price.amount == 0 ? String(localized: "Free") : money(monthly ?? price.amount, price.currency)).font(.largeTitle.weight(.bold))
        if price.amount > 0 { Text(verbatim: period(price, monthly: monthly != nil)).foregroundStyle(.secondary) }
      }
      if price.interval == "year", plan.savings > 0 {
        let words = t.content.savingsLabel.isEmpty ? String(localized: "Save \(plan.savings)%") : t.content.savingsLabel.replacingOccurrences(of: "{percent}", with: "\(plan.savings)")
        Text(verbatim: words).font(.caption.weight(.semibold)).foregroundStyle(.green)
      }
      if price.trialDays > 0 { Text("\(price.trialDays)-day free trial").font(.footnote.weight(.medium)) }
    } else if !plan.customPrice.isEmpty {
      Text(plan.customPrice).font(.largeTitle.weight(.bold))
    }
    if !plan.priceNote.isEmpty { Text(plan.priceNote).font(.footnote).foregroundStyle(.secondary) }
  }

  private func button(_ plan: HelpBitesPricingTable.Plan, _ price: HelpBitesPricingTable.Price?, _ t: HelpBitesPricingTable, tint: Color, radius: CGFloat) -> some View {
    let isCurrent = current == plan.key
    let label = isCurrent ? String(localized: "Current plan") : !plan.action.label.isEmpty ? plan.action.label
      : (price?.trialDays ?? 0) > 0 ? String(localized: "Start free trial") : String(localized: "Get started")
    return Button {
      HelpBitesPricing.count("click", host: host, projectKey: projectKey, table: t, plan: plan.key, interval: price?.interval)
      if onSelect(plan, price) { return }
      guard let link = price?.href ?? plan.action.href, var url = URLComponents(string: link) else { return }
      var items = url.queryItems ?? []
      // The same visitor at checkout, so a purchase during an A/B test counts for the table they saw.
      if link.contains("/checkout?") { items.append(URLQueryItem(name: "visitor", value: HelpBitesPricing.visitor)) }
      else if let test = t.experiment, plan.action.type == "payment_link", !items.contains(where: { $0.name == "client_reference_id" }) {
        items.append(URLQueryItem(name: "client_reference_id", value: "hbx__\(test.table)__\(t.key)__\(test.run)"))
      }
      url.queryItems = items.isEmpty ? nil : items
      if let target = url.url { openURL(target) }
    } label: {
      Text(verbatim: label).fontWeight(.semibold).frame(maxWidth: .infinity, minHeight: 44)
        .background(plan.highlighted ? tint : tint.opacity(0.12), in: .rect(cornerRadius: max(6, radius * 0.6)))
        .foregroundStyle(plan.highlighted ? Color.white : tint)
    }
    .buttonStyle(.plain)
    .disabled(isCurrent)
  }

  private func periodLabel(_ slot: String, _ t: HelpBitesPricingTable) -> String {
    let own = ["week": t.content.weeklyLabel, "month": t.content.monthlyLabel, "year": t.content.yearlyLabel][slot] ?? ""
    if !own.isEmpty { return own }
    return slot == "week" ? String(localized: "Weekly") : slot == "month" ? String(localized: "Monthly") : String(localized: "Yearly")
  }

  private func period(_ price: HelpBitesPricingTable.Price, monthly: Bool) -> String {
    let n = price.intervalCount
    if monthly { return String(localized: "/month, billed yearly") }
    switch price.interval {
    case "week": return n > 1 ? String(localized: "every \(n) weeks") : String(localized: "/week")
    case "month": return n > 1 ? String(localized: "every \(n) months") : String(localized: "/month")
    case "year": return n > 1 ? String(localized: "every \(n) years") : String(localized: "/year")
    default: return String(localized: "once")
    }
  }

  private func money(_ amount: Double, _ currency: String) -> String {
    amount.formatted(.currency(code: currency.uppercased()).precision(.fractionLength(amount.rounded() == amount ? 0 : 2)))
  }

  private static let designs: [String: Font.Design] = ["rounded": .rounded, "serif": .serif, "mono": .monospaced]
}

private func hexColor(_ hex: String) -> Color? {
  guard hex.count == 7, hex.hasPrefix("#"), let v = Int(hex.dropFirst(), radix: 16) else { return nil }
  return Color(red: Double(v >> 16 & 255) / 255, green: Double(v >> 8 & 255) / 255, blue: Double(v & 255) / 255)
}
```

Then, wherever you sell:

```swift
ScrollView {
  HelpBitesPricingView(host: URL(string: "https://YOUR-SUPPORT-HOST")!, projectKey: "pk_…", table: "pricing")
    .padding()
}
```

**In-App Purchase.** In an iPhone or iPad app, digital goods are usually sold
with In-App Purchase, and Apple's rules on linking to other ways to pay differ
by country and change; check the App Review Guidelines before showing a Stripe
button in your app. Give each price an **App Store product** in the panel and
buy it with StoreKit in `onSelect`:

```swift
HelpBitesPricingView(host: host, projectKey: "pk_…", table: "paywall", current: user.planKey) { plan, price in
  guard let id = price?.appStoreProduct, !id.isEmpty else { return false }
  Task { if let product = try? await Product.products(for: [id]).first { _ = try? await product.purchase() } }
  return true
}
```

**Customise it** with `accent`, `cornerRadius`, `design` (`.rounded`,
`.serif`…), `locale` and `currency` (the user's region's by default), or keep
`HelpBitesPricing.load` and draw the table your own way. It is your file, so
change anything. The words the snippet adds ("Get started", "/month", "Save 20%")
are your app's strings: add them to your `Localizable.xcstrings`.

**Offline.** It shows the last copy it loaded when HelpBites cannot be reached,
and nothing on a first launch without a network.

## In onboarding

An onboarding step can show a pricing table under its text: pick it under the
step in the onboarding editor. It suits a paywall at the end of a tour; the
step's own button becomes the quiet way on, and choosing a plan finishes the
tour. The flow's JSON then has the published table in the step's `pricing`, in
the flow's language, in the same shape as `GET /v1/pricing/…`: decode it with
`HelpBitesPricingTable` from the Swift snippet above to draw it after the
[Onboarding](ONBOARDING.md) snippet's screens, or show `HelpBitesPricingView`
for the same table. A step whose table is a draft shows its text only.

## Numbers and A/B tests

Each table counts views and unique visitors (pricing.js, the hosted page, the
onboarding tour and the Swift snippet send them), clicks on each plan's button,
checkouts started through HelpBites, and purchases and revenue read from Stripe:
completed Checkout Sessions that HelpBites started for the table, and those that
came through a Payment Link the table shows. Stripe is checked every ten
minutes while a table is published, or now with **Check Stripe now**. The
numbers are under **Results** in the editor, by day and by plan.

An **A/B test** splits a table's visitors between it and up to three other
tables, by weight:

1. **Add a variant** copies the table into a new draft (`pricing-b`). Change
   what you want to test: prices, the template, the words, which plan is
   highlighted. Publish it. Or test against a table you already have.
2. **Start test.** Your site and app keep asking for `pricing`; each visitor
   gets one of the tables, the same one every visit (by the visitor id the web
   script and the Swift snippet keep). The JSON's `key` says which one they got,
   and `experiment` names the test.
3. **Results** shows each table's visitors, clicks, purchases, conversion rate,
   lift over the original and how sure a two-proportion test is of the
   difference. It says "Too early" until each table has 100 visitors and there
   are 5 purchases, and marks a table **Ahead** once it is better with 95%
   certainty.
4. **Stop test** keeps the original, or **Stop and use** a variant: its plans,
   words and look become the original's working copy, to publish under the key
   your site and app already use.

Each start is a new run with numbers of its own; variants and weights stay
fixed while it runs. Purchases count for the table the visitor saw when they
came through its button: Checkout links carry the test, and Payment Links get a
`client_reference_id` of `hbx__<table>__<shown>__<run>` unless you set your own.

## Suggest with AI

**Suggest with AI** reads the project's connected GitHub repos (read-only, up
to three), the table as it stands, your Stripe products and prices, the last 90
days of revenue by plan and the table's own numbers, and proposes plan names and
descriptions, a feature list with each plan's values, and prices. Choose what
it works on (words, features, prices), which repos to read, and anything it
should know. Nothing changes until you **Apply** it to the editor, and then you
save or publish as usual. A plan linked to Stripe keeps its link: a different
price for it comes back as advice to create that price in Stripe. It uses the
workspace's AI provider (or the server's, metered in AI credits).

## Languages

Add languages to a table and translate its words with AI or by hand, as with
onboarding (see [Languages](LANGUAGES.md)). Every visible string can be
translated: the title and small print, the toggle labels, each plan's name,
description, badge, price label, note and button, each feature and tooltip, and
each value in the comparison table. The table is requested in the visitor's
language and answers with that translation, or its own language when it has
none; `locale` says which. Words the table adds itself ("Monthly", "/year",
"Get started") come in ten languages in pricing.js.

## Your own UI

The published table is one public request, open to any origin:

```bash
curl -s "https://YOUR-SUPPORT-HOST/v1/pricing/PROJECT_PUBLIC_KEY/pricing?locale=es&currency=eur&visitor=v_8f2c1d4e"
```

```json
{
  "table": {
    "key": "pricing", "name": "Pricing", "locale": "es", "locales": ["en", "es"], "version": 3,
    "template": "tiers", "intervals": ["month", "year"], "currency": "eur", "currencies": ["usd", "eur"],
    "experiment": null, "savings": 16,
    "content": { "title": "Precios sencillos", "subtitle": "…", "footnote": "…", "monthlyLabel": "", "yearlyLabel": "", "savingsLabel": "" },
    "style": { "accent": "#5e6ad2", "radius": 16, "font": "system", "density": "comfortable", "surface": "outline", "highlight": "border" },
    "look": { "scheme": "auto", "radius": 16, "shadow": "soft", "fontFamily": "…", "light": { "accent": "#5e6ad2", "background": "#ffffff", "surface": "#fafaf9", "text": "#1c1917", "muted": "#78716c", "border": "#e7e5e4" }, "dark": { "…": "…" } },
    "options": { "defaultInterval": "year", "yearlyAs": "total", "cumulative": true, "showExcluded": false, "compare": false },
    "plans": [{
      "key": "pro", "name": "Pro", "description": "…", "badge": "Más popular", "highlighted": true,
      "prices": {
        "month": { "interval": "month", "amount": 11, "currency": "eur", "intervalCount": 1, "monthly": null, "trialDays": 14,
                   "href": "https://YOUR-SUPPORT-HOST/v1/pricing/pk_…/pricing/checkout?plan=pro&interval=month", "source": "stripe",
                   "stripePrice": "price_…", "appStoreProduct": "com.acme.pro.monthly" },
        "year": { "interval": "year", "amount": 110, "monthly": 9.17, "…": "…" }
      },
      "savings": 16, "action": { "type": "checkout", "label": "", "href": null },
      "lines": [{ "id": "ft_…", "text": "Proyectos", "hint": "", "value": "10", "included": true }],
      "includes": "Starter", "cells": { "ft_…": "10" }
    }],
    "features": [{ "id": "ft_…", "kind": "feature", "text": "Proyectos", "hint": "" }]
  }
}
```

Amounts are in the currency's units (19.99). A price's `href` is where its button
goes (`null` for no button). `GET /v1/pricing/{pk}` answers the project's first
published table. The answer has an `ETag` and may be cached for a minute.

To count views and clicks from your own UI, send them, and keep sending the same
`visitor` you asked with:

```bash
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/pricing/PROJECT_PUBLIC_KEY/pricing/events \
  -H "Content-Type: application/json" \
  -d '{"type":"click","visitor":"v_8f2c1d4e","plan":"pro","interval":"year"}'
```

During a test, add the JSON's `experiment.table` and `experiment.run` as
`experiment` and `run`, and use the `key` of the table you were given in the
path. The answer is always `204`.

## Managing tables over the API

With an admin API key (`ak_…`, **Settings → API keys**) or from an
[AI assistant](MCP.md):

```bash
# Create a draft (it starts with example plans that fit the template)
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/pricing-tables \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{"project":"PROJECT_ID","name":"Pricing","template":"paywall"}'

# Your Stripe products and prices, to link plans to
curl -s "https://YOUR-SUPPORT-HOST/v1/admin/stripe/catalog?project=PROJECT_ID" -H "Authorization: Bearer ak_…"

# Change the words and the look (only what you send changes; a list replaces the old one)
curl -s -X PATCH https://YOUR-SUPPORT-HOST/v1/admin/pricing-tables/TABLE_ID \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{"content":{"title":"Simple pricing"},"style":{"accent":"#0ea5e9","radius":20}}'

# Publish it
curl -s -X POST https://YOUR-SUPPORT-HOST/v1/admin/pricing-tables/TABLE_ID/publish -H "Authorization: Bearer ak_…"

# Its numbers over the last 30 days, and its A/B test
curl -s "https://YOUR-SUPPORT-HOST/v1/admin/pricing-tables/TABLE_ID/stats?days=30" -H "Authorization: Bearer ak_…"
```

The rest: `GET /v1/admin/pricing-tables?project=…`, `GET` and `DELETE …/{id}`,
`POST …/{id}/unpublish`, `…/translate`, `…/preview` (the working copy, or the
fields you send, as apps would get it), `…/variants`, `…/experiment/start`,
`…/experiment/stop` and `…/suggest`. Every field and answer is in the
[API reference](/_docs/scalar). Reading a table needs a role that can edit
content; changing one, reading Stripe and the numbers need one that can run
marketing.

## Limits and rules

- 50 tables a project, 6 plans a table, 40 feature rows, 3 variants a test, 20
  languages a table.
- Keys are lowercase letters, digits and dashes, up to 40, unique in the project
  (a plan's key, in the table).
- Written prices are 0 to 1,000,000 in the currency's units; trials are up to 730
  days; corner radius 0 to 32.
- Button links must be `http` or `https`.
- Public reads are limited to 1,200 a minute per address, checkouts to 30 and
  events to 600.
- A test's variants must be published tables of the same project; weights are
  0 to 100.

## Not built yet

- Usage-based (metered) and tiered Stripe prices are not shown.
- No Stripe Customer Portal: a "Manage plan" button is a link of yours.
- The Swift snippet draws cards only; the other templates are web-only (the
  native app's preview draws all five).
- Purchases are counted from Stripe only; App Store purchases are not counted.
