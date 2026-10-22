import Foundation

// The shapes of /v1/admin/pricing-tables, /v1/admin/stripe/catalog and the public
// /v1/pricing/{pk}/{key} (shared/pricing.ts, server/utils/pricing.ts,
// server/utils/pricingStats.ts and server/utils/pricingAi.ts).

/// `PRICING_LIMITS`, `PRICING_KEY` and the choices of shared/pricing.ts, ported by hand
/// (tests/pricingNativeParity.test.ts).
enum PricingLimits {
  static let tables = 50
  static let plans = 6
  static let features = 40
  static let name = 80
  static let title = 120
  static let subtitle = 300
  static let description = 240
  static let badge = 30
  static let feature = 120
  static let hint = 200
  static let cell = 40
  static let label = 40
  static let note = 80
  static let custom = 40
  static let footnote = 400
  static let url = 500
  static let product = 120
  static let radius = 32
  static let trialDays = 730
  static let amount = 1_000_000
  /// `PRICING_MAX_LOCALES`: translations one table keeps.
  static let locales = 20
  /// `PRICING_MAX_VARIANTS`: tables an A/B test splits visitors with, besides the control.
  static let maxVariants = 3
  /// What "Suggest with AI" takes as notes.
  static let notes = 1000
  /// A table's or a plan's key: lowercase letters, digits and dashes.
  static let key = "^[a-z0-9][a-z0-9-]{0,39}$"
  static let templates: [(id: String, label: String, hint: String, systemImage: String)] = [
    ("tiers", String(localized: "Cards"), String(localized: "Plans side by side; the highlighted one stands out."), "rectangle.split.3x1"),
    ("rows", String(localized: "Rows"), String(localized: "One compact line a plan, for narrow spaces."), "list.bullet.rectangle"),
    ("paywall", String(localized: "Paywall"), String(localized: "Benefits, selectable prices and one button, like an app's upgrade screen."), "iphone"),
    ("matrix", String(localized: "Comparison"), String(localized: "Every feature by plan, in a table."), "tablecells"),
    ("spotlight", String(localized: "Spotlight"), String(localized: "One wide card a plan: a single plan or a lifetime deal."), "rectangle.inset.filled")
  ]
  /// The price slots of a plan (`PRICING_INTERVALS`), in the order a toggle lists them.
  static let intervals: [(id: String, label: String)] = [("week", String(localized: "Weekly")), ("month", String(localized: "Monthly")), ("year", String(localized: "Yearly")), ("once", String(localized: "One-time"))]
  /// The slots a subscription bills in (`PRICING_RECURRING`); the toggle offers those a table has.
  static let recurring = ["week", "month", "year"]
  static func intervalLabel(_ id: String) -> String { intervals.first { $0.id == id }?.label ?? id }
  /// What "Suggest with AI" can work on (`PRICING_AI_FOCUS`).
  static let focus: [(id: String, label: String)] = [("copy", String(localized: "Words")), ("features", String(localized: "Features")), ("prices", String(localized: "Prices"))]
  static let actions: [(id: String, label: String, hint: String)] = [
    ("checkout", String(localized: "Stripe Checkout"), String(localized: "HelpBites opens Stripe Checkout for the price. The Stripe key needs \"Checkout Sessions: Write\".")),
    ("payment_link", String(localized: "Stripe Payment Link"), String(localized: "The Payment Link in Stripe that sells this price.")),
    ("url", String(localized: "A link of yours"), String(localized: "Your sign-up page or a contact form. {plan} and {interval} are filled in.")),
    ("none", String(localized: "No button"), String(localized: "Just the plan, no button."))
  ]
  static let fonts: [(id: String, label: String)] = [("system", String(localized: "System")), ("rounded", String(localized: "Rounded")), ("serif", String(localized: "Serif")), ("mono", String(localized: "Mono"))]
  static let densities: [(id: String, label: String)] = [("compact", String(localized: "Compact")), ("comfortable", String(localized: "Comfortable")), ("spacious", String(localized: "Spacious"))]
  static let surfaces: [(id: String, label: String)] = [("flat", String(localized: "Flat")), ("outline", String(localized: "Outlined")), ("shadow", String(localized: "Shadow"))]
  static let highlights: [(id: String, label: String)] = [("border", String(localized: "Border")), ("fill", String(localized: "Fill")), ("raise", String(localized: "Raised"))]
  static let yearlyAs: [(id: String, label: String)] = [("total", String(localized: "Yearly total")), ("monthly", String(localized: "A month"))]

  static func validKey(_ value: String) -> Bool { value.range(of: key, options: .regularExpression) != nil }
  static let keyRule = String(localized: "The key is 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit.")
  static func templateLabel(_ id: String) -> String { templates.first { $0.id == id }?.label ?? id }

  /// A key from a name (`pricingKeyFrom`): "Pro plan" → "pro-plan".
  static func keyFrom(_ name: String, fallback: String = "pricing") -> String {
    let folded = name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .init(identifier: "en")).lowercased()
    let key = String(folded.replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
      .replacingOccurrences(of: "^-+|-+$", with: "", options: .regularExpression).prefix(40))
      .replacingOccurrences(of: "-+$", with: "", options: .regularExpression)
    return key.isEmpty ? fallback : key
  }

  /// An id the server keeps (`/^[\w-]{1,40}$/`).
  static func newId(_ prefix: String) -> String { prefix + "_" + UUID().uuidString.prefix(13).lowercased().replacingOccurrences(of: "-", with: "") }
}

/// A plan's value for a feature: included, not, or included with a value ("10", "Unlimited").
enum PricingCell: Codable, Equatable, Sendable {
  case included(Bool)
  case value(String)

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let on = try? c.decode(Bool.self) { self = .included(on) } else { self = .value(try c.decode(String.self)) }
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .included(let on): try c.encode(on)
    case .value(let text): try c.encode(text)
    }
  }

  var isIncluded: Bool { if case .included(let on) = self { return on }; return true }
  var text: String { if case .value(let text) = self { return text }; return "" }
}

/// One price slot of a plan. Stripe wins: a written amount shows only when Stripe has no price for the slot.
struct PricingPriceRef: Codable, Equatable, Sendable {
  /// `price_…`, or '' for the product's current price (with a Stripe product) or none.
  var stripePrice = ""
  /// In the table's currency, written by hand; nil for none.
  var amount: Double?
  /// The written price in other currencies, by lowercase code: ["eur": 17.99]. A visitor who asks for one gets it.
  var amounts: [String: Double] = [:]
  var appStoreProduct = ""
}

extension PricingPriceRef {
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    stripePrice = try c.decodeIfPresent(String.self, forKey: .stripePrice) ?? ""
    amount = try c.decodeIfPresent(Double.self, forKey: .amount)
    amounts = try c.decodeIfPresent([String: Double].self, forKey: .amounts) ?? [:]
    appStoreProduct = try c.decodeIfPresent(String.self, forKey: .appStoreProduct) ?? ""
  }
}

struct PricingPrices: Codable, Equatable, Sendable {
  var week = PricingPriceRef()
  var month = PricingPriceRef()
  var year = PricingPriceRef()
  var once = PricingPriceRef()

  subscript(slot: String) -> PricingPriceRef {
    get { slot == "week" ? week : slot == "year" ? year : slot == "once" ? once : month }
    set {
      switch slot {
      case "week": week = newValue
      case "year": year = newValue
      case "once": once = newValue
      default: month = newValue
      }
    }
  }
}

extension PricingPrices {
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    week = try c.decodeIfPresent(PricingPriceRef.self, forKey: .week) ?? PricingPriceRef()
    month = try c.decodeIfPresent(PricingPriceRef.self, forKey: .month) ?? PricingPriceRef()
    year = try c.decodeIfPresent(PricingPriceRef.self, forKey: .year) ?? PricingPriceRef()
    once = try c.decodeIfPresent(PricingPriceRef.self, forKey: .once) ?? PricingPriceRef()
  }
}

struct PricingAction: Codable, Equatable, Sendable {
  /// checkout, payment_link, url or none.
  var type = "checkout"
  var label = ""
  var url = ""
}

struct PricingPlan: Codable, Identifiable, Equatable, Sendable {
  var id: String
  var key: String
  var name = ""
  var description = ""
  var badge = ""
  var highlighted = false
  var stripeProduct = ""
  var prices = PricingPrices()
  var customPrice = ""
  var priceNote = ""
  var trialDays = 0
  var action = PricingAction()
  /// By feature id; a feature not listed is not included.
  var features: [String: PricingCell] = [:]

  static func blank(index: Int) -> PricingPlan { PricingPlan(id: PricingLimits.newId("pl"), key: "plan-\(index + 1)") }
}

struct PricingFeature: Codable, Identifiable, Equatable, Sendable {
  var id: String
  /// feature, or a heading the comparison table groups rows under.
  var kind = "feature"
  var text = ""
  var hint = ""

  var isHeading: Bool { kind == "heading" }
  static func blank(heading: Bool = false) -> PricingFeature { PricingFeature(id: PricingLimits.newId("ft"), kind: heading ? "heading" : "feature") }
}

struct PricingContent: Codable, Equatable, Sendable {
  var title = ""
  var subtitle = ""
  var footnote = ""
  /// The toggle's words; '' uses the client's own (Weekly, Monthly, Yearly, Save {percent}%).
  var weeklyLabel = ""
  var monthlyLabel = ""
  var yearlyLabel = ""
  var savingsLabel = ""
  var termsUrl = ""
  var privacyUrl = ""
}

extension PricingContent {
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let text = { (key: CodingKeys) in try c.decodeIfPresent(String.self, forKey: key) ?? "" }
    title = try text(.title)
    subtitle = try text(.subtitle)
    footnote = try text(.footnote)
    weeklyLabel = try text(.weeklyLabel)
    monthlyLabel = try text(.monthlyLabel)
    yearlyLabel = try text(.yearlyLabel)
    savingsLabel = try text(.savingsLabel)
    termsUrl = try text(.termsUrl)
    privacyUrl = try text(.privacyUrl)
  }

  /// The fields a translation replaces (`CONTENT_TEXT`), with their limits.
  static let translatable: [(key: String, label: String, limit: Int)] = [
    ("title", String(localized: "Title"), PricingLimits.title), ("subtitle", String(localized: "Subtitle"), PricingLimits.subtitle), ("footnote", String(localized: "Small print"), PricingLimits.footnote),
    ("weeklyLabel", String(localized: "Weekly toggle"), PricingLimits.label), ("monthlyLabel", String(localized: "Monthly toggle"), PricingLimits.label),
    ("yearlyLabel", String(localized: "Yearly toggle"), PricingLimits.label), ("savingsLabel", String(localized: "Savings badge"), PricingLimits.label)
  ]

  subscript(field: String) -> String {
    switch field {
    case "title": title
    case "subtitle": subtitle
    case "footnote": footnote
    case "weeklyLabel": weeklyLabel
    case "monthlyLabel": monthlyLabel
    case "yearlyLabel": yearlyLabel
    case "savingsLabel": savingsLabel
    case "termsUrl": termsUrl
    case "privacyUrl": privacyUrl
    default: ""
    }
  }
}

struct PricingStyle: Codable, Equatable, Sendable {
  /// '#rrggbb', or '' for the project's accent.
  var accent: String
  /// '' follows light or dark.
  var background: String
  var text: String
  var radius: Int
  var font: String
  var density: String
  var surface: String
  var highlight: String
}

struct PricingOptions: Codable, Equatable, Sendable {
  /// week, month or year: the slot the toggle starts on.
  var defaultInterval: String
  var yearlyAs: String
  var cumulative: Bool
  var showExcluded: Bool
  var compare: Bool
  var currency: String
}

struct PricingCheckout: Codable, Equatable, Sendable {
  var successUrl: String
  var cancelUrl: String
  var allowPromotionCodes: Bool
}

/// An A/B test run from a table (the control): visitors are split by weight between it and
/// other published tables of the project (the variants). A visitor keeps their table for the run.
struct PricingExperiment: Codable, Equatable, Sendable {
  struct Variant: Codable, Equatable, Hashable, Sendable {
    /// The variant table's key.
    var table: String
    var weight: Int
  }
  /// off, running or ended.
  var status = "off"
  var runId = ""
  /// The control's share; the variants' are their own weight.
  var weight = 50
  var variants: [Variant] = []
  var startedAt: String?
  var endedAt: String?

  var isRunning: Bool { status == "running" }
}

extension PricingExperiment {
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    status = try c.decodeIfPresent(String.self, forKey: .status) ?? "off"
    runId = try c.decodeIfPresent(String.self, forKey: .runId) ?? ""
    weight = try c.decodeIfPresent(Int.self, forKey: .weight) ?? 50
    variants = try c.decodeIfPresent([Variant].self, forKey: .variants) ?? []
    startedAt = try c.decodeIfPresent(String.self, forKey: .startedAt)
    endedAt = try c.decodeIfPresent(String.self, forKey: .endedAt)
  }
}

// MARK: What apps receive

struct PublicPricingPrice: Codable, Equatable, Sendable {
  let interval: String
  let amount: Double
  let currency: String
  let intervalCount: Int
  let monthly: Double?
  let trialDays: Int
  let href: String?
  let source: String
  let stripePrice: String
  let appStoreProduct: String
}

struct PublicPricingPrices: Codable, Equatable, Sendable {
  let week: PublicPricingPrice?
  let month: PublicPricingPrice?
  let year: PublicPricingPrice?
  let once: PublicPricingPrice?

  subscript(slot: String) -> PublicPricingPrice? {
    switch slot {
    case "week": week
    case "year": year
    case "once": once
    default: month
    }
  }
  /// In the order a paywall lists them (pricing.js): yearly first, then monthly, weekly and one-time.
  var all: [PublicPricingPrice] { [year, month, week, once].compactMap { $0 } }
}

struct PublicPricingLine: Codable, Identifiable, Equatable, Sendable {
  let id, text, hint, value: String
  let included: Bool
}

struct PublicPricingPlan: Codable, Identifiable, Equatable, Sendable {
  struct Action: Codable, Equatable, Sendable { let type, label: String; let href: String? }
  let id, key, name, description, badge: String
  let highlighted: Bool
  let customPrice, priceNote, unitLabel: String
  let prices: PublicPricingPrices
  let savings: Int
  let action: Action
  let trialDays: Int
  let lines: [PublicPricingLine]
  let includes: String
  let cells: [String: PricingCell]
}

/// `PublicPricingTable`: what GET /v1/pricing/{pk}/{key} answers, and what a preview draws.
struct PublicPricingTable: Codable, Equatable, Sendable {
  struct Project: Codable, Equatable, Sendable { let name, logoUrl: String }
  struct Options: Codable, Equatable, Sendable { let defaultInterval, yearlyAs: String; let cumulative, showExcluded, compare: Bool }
  /// With an A/B test running: the test's table (`key` is the one shown) and its run. Send both back with events and checkout.
  struct Experiment: Codable, Equatable, Sendable { let table, run: String }
  let key, name, locale: String
  let locales: [String]
  let version: Int
  let publishedAt: String?
  let project: Project
  let template: String
  let style: PricingStyle
  let options: Options
  let content: PricingContent
  let intervals: [String]
  /// The currency the prices are in, and every currency every price can be shown in (a switcher offers them when there are two).
  let currency: String?
  let currencies: [String]?
  let experiment: Experiment?
  let savings: Int
  let features: [PricingFeature]
  let plans: [PublicPricingPlan]
}

// MARK: The admin API

struct PricingTable: Codable, Identifiable, Equatable, Sendable {
  struct CheckoutError: Codable, Equatable, Sendable { let message, at: String }
  let id: String
  var key: String
  var name: String
  /// draft or published.
  var status: String
  var version: Int
  var template: String
  var plans: [PricingPlan]
  var features: [PricingFeature]
  var content: PricingContent
  var style: PricingStyle
  var options: PricingOptions
  var checkout: PricingCheckout
  var locale: String
  /// By language, then by the flat keys of `texts` ("plans/<id>/name").
  var translations: [String: [String: String]]
  var changed: Bool
  var published: PublicPricingTable?
  var publishedAt: String?
  var warnings: [String]
  /// Every string a translation can replace, by flat key, as saved.
  var texts: [String: String]
  var checkoutError: CheckoutError?
  /// The A/B test this table runs, with other tables as its variants.
  var experiment: PricingExperiment?
  var path: String
  var pagePath: String
  var updatedAt: String?

  var isPublished: Bool { status == "published" }
  var statusLabel: String { isPublished ? String(localized: "Published v\(version)") : String(localized: "Draft") }
  var test: PricingExperiment { experiment ?? PricingExperiment() }
}

/// The parts of a table the editor changes; equal to the saved copy means nothing to save.
struct PricingDraft: Equatable, Encodable, Sendable {
  var name: String
  var key: String
  var template: String
  var plans: [PricingPlan]
  var features: [PricingFeature]
  var content: PricingContent
  var style: PricingStyle
  var options: PricingOptions
  var checkout: PricingCheckout
  var locale: String
  var translations: [String: [String: String]]
  /// The language `POST …/preview` draws in; nil for the table's own. Never set on a draft that is saved.
  var previewLocale: String?
  /// The languages the saved table has: one the draft dropped is sent as null, since a PATCH only replaces the languages it names.
  private let savedLanguages: [String]

  init(_ table: PricingTable) {
    name = table.name
    key = table.key
    template = table.template
    plans = table.plans
    features = table.features
    content = table.content
    style = table.style
    options = table.options
    checkout = table.checkout
    locale = table.locale
    translations = table.translations
    savedLanguages = table.translations.keys.sorted()
  }

  enum CodingKeys: String, CodingKey { case name, key, template, plans, features, content, style, options, checkout, locale, translations, previewLocale }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(name, forKey: .name)
    try c.encode(key, forKey: .key)
    try c.encode(template, forKey: .template)
    try c.encode(plans, forKey: .plans)
    try c.encode(features, forKey: .features)
    try c.encode(content, forKey: .content)
    try c.encode(style, forKey: .style)
    try c.encode(options, forKey: .options)
    try c.encode(checkout, forKey: .checkout)
    try c.encode(locale, forKey: .locale)
    var next: [String: [String: String]?] = translations.filter { !ContentLocale.same($0.key, locale) }
    for tag in savedLanguages where next[tag] == nil { next[tag] = .some(nil) }
    try c.encode(next, forKey: .translations)
    if let previewLocale { try c.encode(previewLocale, forKey: .previewLocale) }
  }

  /// Every string a translator works on, by its flat key (`pricingTextLimits`), in order, with where it
  /// belongs and its limit: `name`, `content/<field>`, `features/<id>/text|hint`, `plans/<id>/<field>`,
  /// `plans/<id>/action` and `plans/<id>/cells/<featureId>`. Empty ones are left out.
  var texts: [PricingText] {
    var out: [PricingText] = []
    func add(_ key: String, _ text: String, _ limit: Int, _ group: String, _ field: String) {
      if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append(PricingText(key: key, text: text, limit: limit, group: group, field: field)) }
    }
    add("name", name, PricingLimits.name, "Words", "Name")
    for field in PricingContent.translatable { add("content/\(field.key)", content[field.key], field.limit, "Words", field.label) }
    for f in features {
      add("features/\(f.id)/text", f.text, PricingLimits.feature, "Features", f.isHeading ? "Heading" : "Feature")
      add("features/\(f.id)/hint", f.hint, PricingLimits.hint, "Features", String(localized: "Tooltip · \(f.text)"))
    }
    for p in plans {
      let group = p.name.isEmpty ? p.key : p.name
      add("plans/\(p.id)/name", p.name, PricingLimits.name, group, "Name")
      add("plans/\(p.id)/description", p.description, PricingLimits.description, group, "Description")
      add("plans/\(p.id)/badge", p.badge, PricingLimits.badge, group, "Badge")
      add("plans/\(p.id)/customPrice", p.customPrice, PricingLimits.custom, group, "Label without a price")
      add("plans/\(p.id)/priceNote", p.priceNote, PricingLimits.note, group, "Under the price")
      add("plans/\(p.id)/action", p.action.label, PricingLimits.label, group, "Button label")
      for (fid, cell) in p.features.sorted(by: { $0.key < $1.key }) {
        if case .value(let value) = cell { add("plans/\(p.id)/cells/\(fid)", value, PricingLimits.cell, group, features.first { $0.id == fid }?.text ?? fid) }
      }
    }
    return out
  }
}

/// One translatable string of a table, for the translation sheet.
struct PricingText: Identifiable, Equatable, Sendable {
  let key: String
  let text: String
  let limit: Int
  /// Words, Features, or the plan's name.
  let group: String
  let field: String
  var id: String { key }
}

struct PricingTableResponse: Decodable, Sendable { let table: PricingTable }

/// A table as other screens offer it (an onboarding step's pricing table): its key, name, state and what apps get.
struct PricingTableChoice: Decodable, Equatable, Sendable {
  let key, name, status: String
  let published: PublicPricingTable?
  var isPublished: Bool { status == "published" }
}
struct PricingPreviewResponse: Decodable, Sendable { let preview: PublicPricingTable }

/// The project's Stripe products, prices and payment links, for the pickers (GET /v1/admin/stripe/catalog).
struct StripeCatalog: Codable, Equatable, Sendable {
  struct Product: Codable, Identifiable, Equatable, Sendable { let id, name, description, defaultPrice, unitLabel: String; let features: [String] }
  struct Price: Codable, Identifiable, Equatable, Sendable {
    let id, product, currency: String
    /// In the currency's smallest unit, like Stripe's.
    let amount: Int
    /// recurring or one_time.
    let type: String
    let interval: String
    let intervalCount: Int
    let nickname, lookupKey: String

    /// Other currencies it is sold in, in their smallest unit.
    let currencyOptions: [String: Int]?

    /// The slot it fills: week, month, year or once; nil for daily prices.
    var slot: String? { type == "one_time" ? "once" : PricingLimits.recurring.contains(interval) ? interval : nil }
  }
  struct Link: Codable, Equatable, Sendable { let id, url: String; let prices: [String]; let trialDays: Int }
  let products: [Product]
  let prices: [Price]
  let links: [Link]
}

struct StripeCatalogResponse: Decodable, Sendable {
  let connected: Bool
  let catalog: StripeCatalog?
  let paymentLinks: Bool
  let error: String
}

extension StripeCatalog.Price {
  /// "$12.00 / month · Pro monthly" for a picker.
  var label: String {
    let zeroDecimal = ["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"].contains(currency.lowercased())
    let units = zeroDecimal ? Double(amount) : Double(amount) / 100
    let money = units.formatted(.currency(code: currency.uppercased()))
    let every = type == "one_time" ? "" : intervalCount > 1 ? " / \(intervalCount) \(interval)s" : " / \(interval)"
    return money + every + (nickname.isEmpty ? "" : " · \(nickname)") + (lookupKey.isEmpty ? "" : " · \(lookupKey)")
  }
}

// MARK: Numbers and A/B tests (GET /v1/admin/pricing-tables/{id}/stats)

/// Views, visitors, clicks, checkouts and purchases, with revenue by currency in its smallest unit.
struct PricingFunnel: Decodable, Equatable, Sendable {
  struct PlanCounts: Decodable, Equatable, Sendable { let clicks, checkouts, conversions: Int }
  let views, visitors, clicks, checkouts, conversions: Int
  let revenue: [String: Double]
  /// By plan key.
  let plans: [String: PlanCounts]
}

struct PricingStats: Decodable, Sendable {
  /// One day's numbers (`{ day, ...funnel }`); only what the chart uses.
  struct Day: Decodable, Equatable, Sendable { let day: String; let visitors, conversions: Int }
  struct Conversions: Decodable, Equatable, Sendable { let at, error: String }
  let total: PricingFunnel
  let days: [Day]
  /// The table's A/B test over its last run; nil when it never ran one.
  let experiment: PricingExperimentReport?
  /// When Stripe was last read for purchases, and what went wrong; nil before the first time.
  let conversions: Conversions?
}

/// An A/B test's result: each table's numbers over the run, against the control's.
struct PricingExperimentReport: Decodable, Equatable, Sendable {
  struct Arm: Decodable, Equatable, Sendable {
    /// The table's key, its name and its id ('' once it is gone).
    let table, name, id: String
    let control: Bool
    let weight: Int
    let funnel: PricingFunnel
    /// Purchases per visitor.
    let rate: Double
    /// Against the control's rate; nil while the control has none.
    let lift: Double?
    /// How sure a two-proportion test is of the difference, 0 to 1.
    let confidence: Double
    /// 100 visitors each and 5 purchases between them.
    let enough: Bool
  }
  let status: String
  let runId: String
  let startedAt: String?
  let endedAt: String?
  let arms: [Arm]
  /// The table ahead with 95% confidence, if any.
  let leader: String?
}

// MARK: Suggest with AI (POST /v1/admin/pricing-tables/{id}/suggest)

struct PricingSuggestion: Decodable, Sendable {
  /// What to apply to the editor.
  struct Draft: Decodable, Sendable { let content: PricingContent; let plans: [PricingPlan]; let features: [PricingFeature] }
  struct Repo: Decodable, Sendable { let repo: String; let read: Bool }
  let summary: String
  let advice: [String]
  let draft: Draft
  /// The proposal as apps would get it.
  let preview: PublicPricingTable
  let repos: [Repo]
}

struct PricingSuggestionResponse: Decodable, Sendable { let suggestion: PricingSuggestion }
