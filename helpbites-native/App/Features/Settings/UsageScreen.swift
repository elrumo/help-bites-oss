import SwiftUI

/// Plan and usage (web: Settings → Plan & usage, `GET /v1/admin/usage`): what the
/// workspace has used against each limit, and which features the plan includes.
struct UsageScreen: View {
  @Environment(SessionStore.self) private var session
  @State private var snapshot: UsageSnapshot?
  @State private var loading = true
  @State private var error = ""

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        if loading {
          SkeletonRows(count: 4).padding(-Metrics.gutter)
        } else if let snapshot {
          VStack(alignment: .leading, spacing: 4) {
            Text("\(snapshot.plan.name) plan").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
            Text("Monthly counts start over on the 1st, and daily ones at midnight (UTC).").font(.lnMeta).foregroundStyle(Theme.textMuted)
          }

          let rows = snapshot.rows
          if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
              SectionLabel("Usage")
              Card {
                ForEach(rows) { row in
                  CardRow(divider: row.id != rows.last?.id) {
                    VStack(alignment: .leading, spacing: 8) {
                      HStack(spacing: 8) {
                        Text(row.label).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
                        if row.soft { Tag(text: "Soft") }
                        Spacer(minLength: 8)
                        Text("\(row.used) / \(row.limit)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
                      }
                      UsageBar(percent: row.percent, tint: row.percent >= 100 && !row.soft ? Theme.error : row.percent >= 80 ? Theme.warning : Theme.accent)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityValue("\(row.percent) percent")
                  }
                }
              }
              if rows.contains(where: \.soft) { Text("Soft limits are counted, but going past one never stops anything.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
            }
          }

          VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Included")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), alignment: .leading)], alignment: .leading, spacing: 8) {
              ForEach(snapshot.included, id: \.label) { item in
                HStack(spacing: 8) {
                  Image(systemName: item.on ? "checkmark" : "xmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(item.on ? Theme.accentText : Theme.textDimmed).frame(width: 16)
                  Text(item.label).font(.lnMeta).foregroundStyle(item.on ? Theme.text : Theme.textMuted)
                  Spacer(minLength: 0)
                }
              }
            }
          }
        }
        BillingSection()
        ErrorText(message: error)
      }
      .settingsColumn()
    }
    .panelScreen("Plan & usage")
    .refreshable { await load() }
    .task(id: session.workspace?.id) { await load() }
  }

  private func load() async {
    do { snapshot = try await session.get("/v1/admin/usage"); error = "" }
    catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }
}

/// The features a plan can include, with their labels (shared/entitlements.ts FEATURES and FEATURE_LABELS).
enum PlanFeature {
  static let labels: [(key: String, label: String)] = [
    ("campaigns", "Campaigns"), ("sequences", "Sequences"), ("contactSources", "Database sync"), ("eventWebhooks", "Event webhooks"),
    ("customSendingDomain", "A custom sending domain"), ("removeBranding", "Removing the HelpBites branding"), ("byoLlm", "Your own AI provider"),
    ("emailAiUltra", "The Ultra AI designer"), ("multiWorkspace", "More workspaces"), ("legalDocs", "Hosted legal documents"),
    ("customPublicDomain", "Your own domain for public pages"), ("inboundEmail", "Support email addresses")
  ]

  /// The labels stay literal pairs (a parity test reads them); they are looked up in the catalog where they are shown.
  static func label(_ key: String) -> String { labels.first { $0.key == key }.map { localized($0.label) } ?? key }
  static func localized(_ text: String) -> String { String(localized: String.LocalizationValue(text)) }
}

private struct UsageBar: View {
  let percent: Int
  let tint: Color
  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        Capsule().fill(Theme.elevated)
        Capsule().fill(tint).frame(width: proxy.size.width * CGFloat(min(max(percent, 0), 100)) / 100)
      }
    }
    .frame(height: 4)
  }
}

/// `GET /v1/admin/usage` (server/utils/usage.ts). A `null` limit means unlimited.
struct UsageSnapshot: Decodable, Sendable {
  struct Plan: Decodable, Sendable { let id, name: String }
  let plan: Plan
  let unlimited: Bool
  let limits: [String: Double?]
  let soft: [String: Bool]
  let features: [String: Bool]
  let apiPerMinute: Int?
  let emailLogDays: Int?
  let usage: [String: Double]

  struct Row: Identifiable, Equatable { let id, label, used, limit: String; let percent: Int; let soft: Bool }
  struct Included { let label: String; let on: Bool }

  // shared/entitlements.ts: counters then gauges, the features in plan order.
  private static let metrics: [(key: String, label: String)] = [
    ("conversations", String(localized: "New conversations this month")), ("emails", String(localized: "Emails this month")), ("emailsPerDay", String(localized: "Emails today")), ("aiCredits", String(localized: "AI credits this month")),
    ("projects", String(localized: "Projects")), ("seats", String(localized: "Teammates")), ("apiKeys", String(localized: "API keys")), ("knowledgeModels", String(localized: "Knowledge models")),
    ("assistants", String(localized: "Assistants")), ("faqs", String(localized: "FAQs")), ("contacts", String(localized: "Contacts")), ("storageBytes", String(localized: "Storage"))
  ]
  var rows: [Row] {
    Self.metrics.compactMap { key, label in
      guard let entry = limits[key], let limit = entry else { return nil }
      let used = usage[key] ?? 0
      return Row(id: key, label: label, used: Self.amount(key, used), limit: Self.amount(key, limit), percent: limit > 0 ? min(100, Int((used / limit * 100).rounded())) : 100, soft: soft[key] ?? false)
    }
  }

  var included: [Included] {
    PlanFeature.labels.map { Included(label: PlanFeature.localized($0.label), on: features[$0.key] ?? false) }
      + (apiPerMinute.map { [Included(label: String(localized: "Admin API: \($0.formatted()) requests a minute"), on: true)] } ?? [])
      + (emailLogDays.map { [Included(label: String(localized: "Email log kept for \($0) days"), on: true)] } ?? [])
  }

  private static func amount(_ key: String, _ value: Double) -> String {
    key == "storageBytes" ? bytes(value) : Int(value).formatted()
  }

  /// shared/entitlements.ts `formatBytes`.
  static func bytes(_ value: Double) -> String {
    if value < 1024 { return "\(Int(value)) B" }
    let units = ["KB", "MB", "GB", "TB"]
    var scaled = value / 1024, unit = 0
    while scaled >= 1024, unit < units.count - 1 { scaled /= 1024; unit += 1 }
    let rounded = scaled >= 10 ? scaled.rounded() : (scaled * 10).rounded() / 10
    return "\(rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)) \(units[unit])"
  }
}
