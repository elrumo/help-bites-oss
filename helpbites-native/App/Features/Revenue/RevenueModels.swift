import Foundation

// shared/stripe.ts, shared/revenue.ts and server/routes/v1/admin/{stripe,revenue}/**: payments and
// subscriptions come from the project's revenue sources (Stripe, RevenueCat, App Store, Paddle,
// Lemon Squeezy, your own API). The Stripe-only types serve Settings → Connections and a contact's billing.

/// `GET /v1/admin/stripe?project=` → `{ connection, ready }`.
struct StripeConnection: Decodable, Equatable, Sendable {
  struct Stats: Decodable, Equatable, Sendable { var payments = 0, subscriptions = 0, contacts = 0 }
  var connected: Bool
  var accountName = ""
  /// The currency totals are shown in: the one with the most revenue.
  var currency = ""
  var livemode = false
  /// idle, running or error.
  var status = "idle"
  var lastRunAt: String?
  var lastError = ""
  var stats = Stats()

  var isRunning: Bool { status == "running" }
}

struct StripeState: Decodable, Sendable {
  var connection: StripeConnection
  var ready: Bool
}

/// A connected revenue source: `GET /v1/admin/revenue/sources?project=` → `{ sources }`, Stripe first.
/// `lastRunAt` is the last run, or for a push source its last event. A push source also carries the
/// `webhook` to paste into the service; `token` is '' unless the member manages the project.
struct RevenueConnection: Decodable, Equatable, Identifiable, Sendable {
  struct Stats: Decodable, Equatable, Sendable { var payments = 0, subscriptions = 0 }
  struct Webhook: Decodable, Equatable, Sendable { let url, token: String }
  let source: String
  var accountName = ""
  var livemode = false
  /// idle, running or error.
  var status = "idle"
  var lastRunAt: String?
  var lastError = ""
  var stats = Stats()
  var webhook: Webhook?

  var id: String { source }
  var isRunning: Bool { status == "running" }
  var catalog: RevenueSource? { RevenueSource.named(source) }
}

enum RevenueRange: String, CaseIterable, Identifiable, Sendable {
  case d30 = "30d", d90 = "90d", m12 = "12m", all
  var id: String { rawValue }
  var label: String {
    switch self {
    case .d30: String(localized: "Last 30 days")
    case .d90: String(localized: "Last 90 days")
    case .m12: String(localized: "Last 12 months")
    case .all: String(localized: "All time")
    }
  }
}

/// `GET /v1/admin/revenue/report`, over every connected source. Totals are already in the currency's major units
/// (19.99), unlike the payments in `recent`, which are in the smallest unit (1999).
struct RevenueReport: Decodable, Equatable, Sendable {
  struct Subscribers: Decodable, Equatable, Sendable { let active, trialing, pastDue: Int }
  /// `mrr` is the MRR at the end of the month (this month: today).
  struct Month: Decodable, Equatable, Sendable, Identifiable { let month: String; let net: Double; let payments: Int; let mrr: Double; var id: String { month } }
  struct Plan: Decodable, Equatable, Sendable, Identifiable { let plan: String; let subscribers: Int; let mrr: Double; var id: String { plan } }
  /// `contactId` is the person in HelpBites this customer is ('' when nobody matches), so a row can open them.
  struct Customer: Decodable, Equatable, Sendable, Identifiable { let customerId, email: String; let contactId: String?; let net: Double; let payments: Int; var id: String { customerId } }
  struct OtherCurrency: Decodable, Equatable, Sendable { let currency: String; let net: Double }
  /// What one source brought in the period, biggest first.
  struct Source: Decodable, Equatable, Sendable, Identifiable { let source: String; let net: Double; let payments: Int; let mrr: Double; var id: String { source } }

  let currency: String
  let net, gross, refunds: Double
  let payments, customers: Int
  let allTimeNet, mrr, arr: Double
  let subscribers: Subscribers
  let newSubscribers, churned: Int
  let months: [Month]
  let plans: [Plan]
  let topCustomers: [Customer]
  let recent: [StripePayment]
  let otherCurrencies: [OtherCurrency]
  let sources: [Source]
}

struct StripePayment: Decodable, Equatable, Identifiable, Sendable {
  let id, customerId, email: String
  /// The revenue source it came from (shared/revenue.ts ids).
  let source: String?
  /// The person in HelpBites this belongs to ('' when nobody matches); only the revenue report adds it.
  let contactId: String?
  let amount, refunded: Double
  let currency, status, description, receiptUrl: String
  let paidAt: String?
}

struct StripeSubscription: Decodable, Equatable, Identifiable, Sendable {
  let id, customerId, email, status, plan: String
  let mrr, amount: Double
  let interval: String
  let intervalCount: Int
  let currency: String
  let startedAt, canceledAt, currentPeriodEnd: String?
  let cancelAtPeriodEnd: Bool
}

/// A Stripe customer as read live; `balance` is in the smallest unit of `currency`, negative when they have credit.
struct StripeCustomer: Decodable, Equatable, Sendable {
  let id, name, email: String
  let createdAt: String?
  let country: String
  let delinquent: Bool
  let balance: Double
  let currency: String
  let livemode: Bool
}

/// `GET /v1/admin/stripe/contact`; empty (and `currency` blank) when Stripe isn't connected.
/// `customer` is read from Stripe live and is nil when they aren't a customer or Stripe didn't answer.
struct ContactBilling: Decodable, Equatable, Sendable {
  let currency: String
  let customer: StripeCustomer?
  let subscriptions: [StripeSubscription]
  let payments: [StripePayment]
}

enum Money {
  // Stripe amounts are in the currency's smallest unit; these have no cents.
  private static let zeroDecimal: Set<String> = ["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]

  /// Stripe's smallest-unit amount as a number of the currency's units (1999 usd → 19.99).
  static func fromMinor(_ amount: Double, _ currency: String) -> Double {
    zeroDecimal.contains(currency.lowercased()) ? amount : amount.rounded() / 100
  }

  /// "$1,234" or "$19.99": whole amounts drop the cents, as on the web.
  static func format(_ amount: Double, _ currency: String) -> String {
    let code = currency.isEmpty ? "USD" : currency.uppercased()
    let whole = amount.truncatingRemainder(dividingBy: 1) == 0
    return amount.formatted(.currency(code: code).precision(.fractionLength(whole ? 0 : 2)))
  }

  static func minor(_ amount: Double, _ currency: String) -> String { format(fromMinor(amount, currency), currency) }

  /// emailStatus.ts `logTime`: the time today, otherwise "Sep 12" (with the year when it isn't this one).
  @MainActor static func logTime(_ raw: String?) -> String {
    guard let date = DateText.date(raw) else { return "" }
    if Calendar.current.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
    return Calendar.current.isDate(date, equalTo: Date(), toGranularity: .year) ? date.formatted(.dateTime.month(.abbreviated).day()) : date.formatted(.dateTime.month(.abbreviated).day().year())
  }
}
