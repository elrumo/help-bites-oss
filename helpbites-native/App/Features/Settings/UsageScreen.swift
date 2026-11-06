import SwiftUI

/// Plan and usage (web: Settings → Usage, `GET /v1/admin/usage` and `/v1/admin/usage/storage`): on a plan with
/// limits, what the workspace has used against each, what is left and which features it includes; on every
/// edition, where its storage goes, by kind of file and by project.
struct UsageScreen: View {
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @State private var snapshot: UsageSnapshot?
  @State private var loading = true
  @State private var error = ""
  @State private var storage: StorageBreakdown?
  @State private var storageError = ""

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        if loading {
          SkeletonRows(count: 4).padding(-Metrics.gutter)
        } else if let snapshot, !snapshot.unlimited {
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
                      UsageBar(percent: row.percent, tint: row.full && !row.soft ? Theme.error : row.percent >= 80 ? Theme.warning : Theme.accent)
                      Text(row.note).font(.lnCaption).monospacedDigit().foregroundStyle(row.full && !row.soft ? Theme.error : Theme.textMuted)
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
                  Image(systemName: item.on ? "checkmark" : "xmark").font(.app(size: 11, weight: .semibold)).foregroundStyle(item.on ? Theme.accentText : Theme.textDimmed).frame(width: 16)
                  Text(item.label).font(.lnMeta).foregroundStyle(item.on ? Theme.text : Theme.textMuted)
                  Spacer(minLength: 0)
                }
              }
            }
          }
        }
        storageSection
        BillingSection()
        ErrorText(message: error)
      }
      .settingsColumn()
    }
    .panelScreen(session.plan?.unlimited == false ? "Plan & usage" : "Usage")
    .refreshable { await load() }
    .task(id: session.workspace?.id) { await load() }
  }

  /// The bucket is listed, so storage loads on its own and the plan shows first.
  @ViewBuilder private var storageSection: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(alignment: .firstTextBaseline) {
        SectionLabel("Storage")
        Spacer(minLength: 8)
        if let storage, storage.files > 0 {
          Text("\(UsageSnapshot.bytes(storage.bytes)) in \(storage.files.formatted()) files").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
        }
      }
      if let storage {
        if storage.files == 0 {
          EmptyState(systemImage: "internaldrive", title: "No files stored yet.") { EmptyView() }
        } else {
          VStack(alignment: .leading, spacing: 8) {
            Text("By type").font(.lnRow).foregroundStyle(Theme.textHighlighted)
            Card {
              ForEach(storage.types, id: \.type) { item in
                CardRow(divider: item.type != storage.types.last?.type) {
                  share(StorageKind.label(item.type), bytes: item.bytes, of: storage)
                }
              }
            }
          }
          VStack(alignment: .leading, spacing: 8) {
            Text("By project").font(.lnRow).foregroundStyle(Theme.textHighlighted)
            Card {
              ForEach(storage.projects, id: \.key) { row in
                CardRow(divider: row.key != storage.projects.last?.key) {
                  VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 10) {
                      if let id = row.id {
                        let project = workspace.projects.first { $0.id == id }
                        ProjectTile(id: id, name: row.name, accent: project?.theme.accent, icon: project?.iconUrl, size: 20)
                      } else {
                        Image(systemName: "building.2").font(.app(size: 13)).foregroundStyle(Theme.textMuted).frame(width: 20)
                      }
                      share(row.id == nil ? String(localized: "Whole workspace") : row.name, bytes: row.bytes, of: storage)
                    }
                    Text(row.id == nil ? String(localized: "Shared knowledge models and email templates, and imported files") : row.topTypes)
                      .font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
                  }
                }
              }
            }
            Text("Read from the bucket, so it can differ a little from what the plan counts.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
        }
      } else if storageError.isEmpty {
        SkeletonRows(count: 3).padding(-Metrics.gutter)
      }
      ErrorText(message: storageError)
    }
  }

  private func share(_ label: String, bytes: Double, of storage: StorageBreakdown) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(label).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        Spacer(minLength: 8)
        Text("\(UsageSnapshot.bytes(bytes)) · \(storage.share(bytes))%").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
      }
      UsageBar(percent: max(1, storage.share(bytes)), tint: Theme.accent)
    }
    .accessibilityElement(children: .combine)
  }

  private func load() async {
    async let storageLoad: Void = loadStorage()
    do { snapshot = try await session.get("/v1/admin/usage"); error = "" }
    catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
    await storageLoad
  }

  private func loadStorage() async {
    do { storage = try await session.get("/v1/admin/usage/storage"); storageError = "" }
    catch { if !Task.isCancelled { storageError = error.localizedDescription } }
  }
}

/// What stored files are, with their labels (shared/entitlements.ts STORAGE_TYPES, the web's
/// workspaceSettings.usage.types). Literal pairs, so a parity test can read them.
enum StorageKind {
  static let labels: [(key: String, label: String)] = [
    ("conversations", "Conversation attachments"), ("feedback", "Feedback and board files"), ("team", "Your team's uploads"),
    ("branding", "Logos and brand kit"), ("cms", "CMS files"), ("forms", "Form uploads"), ("emails", "Email images"),
    ("blog", "Blog images"), ("onboarding", "Onboarding images"), ("knowledge", "Knowledge documents"), ("other", "Other")
  ]
  static func label(_ key: String) -> String { labels.first { $0.key == key }.map { PlanFeature.localized($0.label) } ?? key }
}

/// `GET /v1/admin/usage/storage` (server/utils/usage.ts `storageBreakdown`). A project with no id is the whole workspace.
struct StorageBreakdown: Decodable, Sendable {
  struct Kind: Decodable, Sendable { let type: String; let bytes: Double; let files: Int }
  struct ProjectShare: Decodable, Sendable {
    let id: String?
    let name: String
    let bytes: Double
    let files: Int
    let types: [String: Double]
    var key: String { id ?? "" }
    /// Its three biggest kinds, as the web shows them.
    var topTypes: String {
      let top = types.sorted { $0.value > $1.value }.prefix(3).map { "\(StorageKind.label($0.key)) \(UsageSnapshot.bytes($0.value))" }
      return top.isEmpty ? "—" : top.joined(separator: " · ")
    }
  }
  let used: Double
  let limit: Double?
  let bytes: Double
  let files: Int
  let types: [Kind]
  let projects: [ProjectShare]

  func share(_ value: Double) -> Int { bytes > 0 ? Int((value / bytes * 100).rounded()) : 0 }
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

  struct Row: Identifiable, Equatable { let id, label, used, limit, note: String; let percent: Int; let soft, full: Bool }
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
      let isSoft = soft[key] ?? false
      let full = used >= limit
      // The web's Usage.vue: what is left, or how far past a soft limit.
      let note = used > limit && isSoft ? String(localized: "\(Self.amount(key, used - limit)) over, still counted")
        : full ? String(localized: "Limit reached") : String(localized: "\(Self.amount(key, limit - used)) left")
      return Row(id: key, label: label, used: Self.amount(key, used), limit: Self.amount(key, limit), note: note, percent: limit > 0 ? min(100, Int((used / limit * 100).rounded())) : 100, soft: isSoft, full: full)
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
