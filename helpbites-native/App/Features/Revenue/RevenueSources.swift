import Foundation

// shared/revenue.ts REVENUE_SOURCES, ported by hand: where a project's payments and subscriptions
// come from. Keep the ids, kinds and credential keys in step; tests/revenueNativeParity.test.ts does.
//
//   pull    HelpBites reads the service with a credential, on the worker's tick.
//   push    The service calls HelpBites (a webhook) with a secret HelpBites made.
//   manual  Nothing is read: you send payments to the API.

struct RevenueSource: Identifiable, Equatable, Sendable {
  enum Kind: String, Sendable { case pull, push, manual }

  /// What a person types to connect it. `secret` shows as dots and is never returned by the API.
  struct Field: Identifiable, Equatable, Sendable {
    let key: String
    var placeholder = ""
    var secret = false
    var multiline = false
    var optional = false
    var id: String { key }
  }

  let id: String
  /// The product's name, as the server writes it.
  let name: String
  /// An SF Symbol.
  let icon: String
  let kind: Kind
  /// False when the source only reports payments: no MRR, subscribers or plans.
  let subscriptions: Bool
  let fields: [Field]

  static let all: [RevenueSource] = [
    RevenueSource(id: "stripe", name: "Stripe", icon: "creditcard", kind: .pull, subscriptions: true, fields: [
      .init(key: "apiKey", placeholder: "rk_live_…", secret: true)
    ]),
    RevenueSource(id: "revenuecat", name: "RevenueCat", icon: "cat", kind: .push, subscriptions: true, fields: []),
    RevenueSource(id: "apple", name: "App Store", icon: "apple.logo", kind: .pull, subscriptions: false, fields: [
      .init(key: "issuerId", placeholder: "69a6de70-…"),
      .init(key: "keyId", placeholder: "ABC123DEFG"),
      .init(key: "vendorNumber", placeholder: "12345678"),
      .init(key: "privateKey", placeholder: "-----BEGIN PRIVATE KEY-----", secret: true, multiline: true)
    ]),
    RevenueSource(id: "paddle", name: "Paddle", icon: "water.waves", kind: .pull, subscriptions: true, fields: [
      .init(key: "apiKey", placeholder: "pdl_live_apikey_…", secret: true)
    ]),
    RevenueSource(id: "lemonsqueezy", name: "Lemon Squeezy", icon: "leaf", kind: .pull, subscriptions: true, fields: [
      .init(key: "apiKey", placeholder: "eyJ0eXAiOiJKV1Qi…", secret: true)
    ]),
    RevenueSource(id: "custom", name: "Custom API", icon: "chevron.left.forwardslash.chevron.right", kind: .manual, subscriptions: true, fields: [])
  ]

  static func named(_ id: String) -> RevenueSource? { all.first { $0.id == id } }
}
