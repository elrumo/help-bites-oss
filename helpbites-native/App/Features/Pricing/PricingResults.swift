import SwiftUI

/// A table's numbers and A/B test (web: components/pricing/PricingResults.vue): views, visitors and
/// clicks counted by pricing.js, the hosted page and the onboarding tour; purchases and revenue read
/// from Stripe; and a test that splits visitors between this table and up to three others.
/// For admins and owners (`marketing`).
struct PricingResultsPanel: View {
  let projectId: String
  let table: PricingTable
  let stripeConnected: Bool
  /// The form has unsaved changes, which adopting a variant replaces.
  let dirty: Bool
  /// The table came back with a new test: the form stays as it is.
  let onUpdate: (PricingTable) -> Void
  /// A variant's working copy became this table's: the form is replaced.
  let onAdopt: (PricingTable) -> Void
  @Environment(SessionStore.self) private var session
  @State private var stats: PricingStats?
  @State private var days = 30
  /// load, refresh, save, variant, start or stop while that request runs.
  @State private var busy = ""
  @State private var error = ""
  /// The project's other tables, for variants.
  @State private var tables: [Row] = []
  /// The test being set up: the control's weight and the variants.
  @State private var test = PricingExperiment()
  @State private var adopting: Row?

  private struct Row: Decodable, Identifiable, Equatable, Sendable { let id, key, name, status: String }
  private struct TablesResponse: Decodable, Sendable { let tables: [Row] }

  private var running: Bool { table.test.isRunning }
  private var changed: Bool { test.weight != table.test.weight || test.variants != table.test.variants }
  private var totalWeight: Int { test.weight + test.variants.reduce(0) { $0 + $1.weight } }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      LegalPanel(title: "Results", trailing: {
        Menu {
          Picker("Period", selection: $days) { ForEach([7, 30, 90], id: \.self) { Text("Last \($0) days").tag($0) } }
        } label: { Label("Last \(days) days", systemImage: "calendar") }
          .menuStyle(.button).buttonStyle(.lnSecondaryCompact).fixedSize()
      }, content: {
        Text("Views and clicks are counted by pricing.js, the hosted page and the onboarding tour; purchases and revenue are read from Stripe.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        ErrorText(message: error)
        if let stats { numbers(stats) } else if busy == "load" { SkeletonRows(count: 2) }
      })
      experimentPanel
    }
    .task(id: days) { await load(refresh: false) }
    .task { await loadTables() }
    .onAppear { test = table.test }
    .onChange(of: table.test) { _, value in test = value }
    .confirmationDialog("Use \(adopting?.name ?? "the variant")?", isPresented: Binding(get: { adopting != nil }, set: { if !$0 { adopting = nil } }), titleVisibility: .visible, presenting: adopting) { row in
      Button("Stop and use \(row.name)") { Task { await stop(adopt: row.key) } }
    } message: { row in
      Text(String(localized: "The plans, words and look of \(row.name) replace this table's. Publish to make them live.") + (dirty ? String(localized: " Your unsaved changes here are lost.") : ""))
    }
  }

  // MARK: Numbers

  @ViewBuilder private func numbers(_ stats: PricingStats) -> some View {
    let total = stats.total
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 10)], spacing: 10) {
      tile("Visitors", total.visitors.formatted(), String(localized: "\(total.views.formatted()) views"))
      tile("Clicks", total.clicks.formatted(), share(total.clicks, of: total.visitors))
      tile("Checkouts started", total.checkouts.formatted(), share(total.checkouts, of: total.visitors))
      tile("Purchases", total.conversions.formatted(), share(total.conversions, of: total.visitors))
      let revenue = total.revenue.filter { $0.value > 0 }.sorted { $0.key < $1.key }.map { Money.minor($0.value, $0.key) }
      tile("Revenue", revenue.first ?? "–", revenue.dropFirst().joined(separator: " · "))
    }
    Text(conversionNote(stats)).font(.lnCaption).foregroundStyle(Theme.textMuted)
    HStack {
      Spacer()
      Button { Task { await load(refresh: true) } } label: { Label(busy == "refresh" ? "Checking…" : "Check Stripe now", systemImage: "arrow.clockwise") }
        .buttonStyle(.lnGhost).disabled(!stripeConnected || busy != "")
    }
    let series = daySeries(stats)
    let most = series.map(\.visitors).max() ?? 0
    if most > 0 {
      LabeledField(label: "Visitors by day") {
        HStack(alignment: .bottom, spacing: 1) {
          ForEach(series, id: \.day) { day in
            RoundedRectangle(cornerRadius: 2)
              .fill(day.visitors > 0 ? Theme.accent.opacity(0.6) : Theme.elevated)
              .frame(maxWidth: .infinity)
              .frame(height: day.visitors > 0 ? max(3, 48 * CGFloat(day.visitors) / CGFloat(most)) : 2)
          }
        }
        .frame(height: 48, alignment: .bottom)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(total.visitors) visitors over \(days) days")
      }
    } else {
      Text("No visits yet. The numbers start once the table is on a page or in your app.").font(.lnMeta).foregroundStyle(Theme.textMuted)
    }
    let plans = total.plans.sorted { $0.value.clicks > $1.value.clicks }
    if !plans.isEmpty {
      VStack(spacing: 0) {
        ForEach(plans, id: \.key) { entry in
          HStack(spacing: 8) {
            Text(planName(entry.key)).font(.lnRow).foregroundStyle(Theme.text).lineLimit(1)
            Spacer(minLength: 4)
            Text("\(entry.value.clicks) clicks · \(entry.value.checkouts) checkouts · \(entry.value.conversions) purchases").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
          }
          .padding(.vertical, 6)
        }
      }
    }
  }

  private func planName(_ key: String) -> String {
    guard let plan = table.plans.first(where: { $0.key == key }), !plan.name.isEmpty else { return key }
    return plan.name
  }

  private func tile(_ label: String, _ value: String, _ hint: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(LocalizedStringKey(label)).font(.lnCaption).foregroundStyle(Theme.textMuted)
      Text(value).font(.app(size: 20, weight: .semibold)).foregroundStyle(Theme.textHighlighted).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
      Text(hint.isEmpty ? " " : hint).font(.lnCaption).foregroundStyle(Theme.textDimmed).lineLimit(1)
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.elevated.opacity(0.5), in: RoundedRectangle(cornerRadius: Metrics.radius))
    .accessibilityElement(children: .combine)
  }

  private func share(_ count: Int, of visitors: Int) -> String {
    visitors > 0 ? String(localized: "\(percent(Double(count) / Double(visitors))) of visitors") : ""
  }

  private func percent(_ value: Double) -> String { value.formatted(.percent.precision(.fractionLength(0...1))) }

  private func conversionNote(_ stats: PricingStats) -> String {
    guard stripeConnected else { return String(localized: "Connect Stripe to count purchases and revenue.") }
    guard let status = stats.conversions else { return String(localized: "Stripe is checked for purchases every ten minutes while a table is published.") }
    return status.error.isEmpty ? String(localized: "Purchases read from Stripe \(Money.logTime(status.at)).") : String(localized: "Could not read purchases from Stripe: \(status.error)")
  }

  /// Every day of the range, so a quiet day shows as a gap.
  private func daySeries(_ stats: PricingStats) -> [PricingStats.Day] {
    let byDay = Dictionary(stats.days.map { ($0.day, $0) }, uniquingKeysWith: { a, _ in a })
    let format = Date.ISO8601FormatStyle(timeZone: .gmt).year().month().day()
    return (0..<days).map { i in
      let day = Date(timeIntervalSinceNow: -Double(days - 1 - i) * 86_400).formatted(format)
      return byDay[day] ?? PricingStats.Day(day: day, visitors: 0, conversions: 0)
    }
  }

  // MARK: A/B test

  private var experimentPanel: some View {
    LegalPanel(title: "A/B test", trailing: {
      Tag(text: statusLabel, tint: running ? Theme.success : Theme.textDimmed)
    }, content: {
      Text("Split visitors between this table and up to three others, by weight. Each visitor keeps the table they first saw, and the one that sells more on Stripe wins. Sites and apps keep asking for this table's key.")
        .font(.lnMeta).foregroundStyle(Theme.textMuted)
      VStack(spacing: 8) {
        arm(name: String(localized: "This table"), key: table.key, note: nil, weight: Binding(get: { test.weight }, set: { test.weight = $0 }), remove: nil, id: nil)
        ForEach(test.variants, id: \.table) { variant in
          let row = tables.first { $0.key == variant.table }
          arm(
            name: row?.name ?? variant.table, key: variant.table,
            note: row == nil ? String(localized: "no longer exists") : row?.status == "published" ? nil : String(localized: "not published"),
            weight: Binding(get: { test.variants.first { $0.table == variant.table }?.weight ?? 0 }, set: { value in
              if let index = test.variants.firstIndex(where: { $0.table == variant.table }) { test.variants[index].weight = value }
            }),
            remove: { test.variants.removeAll { $0.table == variant.table } },
            id: row?.id
          )
        }
      }
      if running {
        HStack {
          Text("Variants and weights stay as they are while the test runs.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          Spacer(minLength: 8)
          Menu {
            Button { Task { await stop(adopt: nil) } } label: { Label("Stop and keep this table", systemImage: "stop") }
            ForEach(test.variants, id: \.table) { variant in
              if let row = tables.first(where: { $0.key == variant.table }) {
                Button { adopting = row } label: { Label("Stop and use \(row.name)", systemImage: "trophy") }
              }
            }
          } label: { Label(busy == "stop" ? "Stopping…" : "Stop test", systemImage: "stop.circle") }
            .menuStyle(.button).buttonStyle(.lnSecondaryCompact).fixedSize().disabled(busy != "")
        }
      } else {
        FlowLayout(spacing: 8) {
          Button { Task { await addVariant() } } label: { Label(busy == "variant" ? "Adding…" : "Add a variant", systemImage: "plus.square.on.square") }
            .buttonStyle(.lnSecondaryCompact).disabled(test.variants.count >= PricingLimits.maxVariants || busy != "")
          let others = tables.filter { row in row.key != table.key && !test.variants.contains { $0.table == row.key } }
          if !others.isEmpty {
            Menu {
              ForEach(others) { row in Button(row.name) { test.variants.append(.init(table: row.key, weight: test.weight > 0 ? test.weight : 50)) } }
            } label: { Label("Test another table", systemImage: "tablecells") }
              .menuStyle(.button).buttonStyle(.lnSecondaryCompact).fixedSize().disabled(test.variants.count >= PricingLimits.maxVariants)
          }
          if changed {
            Button { Task { await saveTest() } } label: { Text(busy == "save" ? "Saving…" : "Save test") }.buttonStyle(.lnSecondaryCompact).disabled(busy != "")
          }
          Button { Task { await start() } } label: { Label(busy == "start" ? "Starting…" : "Start test", systemImage: "play.fill") }
            .buttonStyle(.lnPrimaryCompact).disabled(test.variants.isEmpty || busy != "")
        }
      }
      if let report = stats?.experiment, !report.arms.isEmpty { reportView(report) }
    })
  }

  private var statusLabel: String {
    switch table.test.status {
    case "running": String(localized: "Running since \(DateText.day(table.test.startedAt))")
    case "ended": String(localized: "Ended \(DateText.day(table.test.endedAt))")
    default: String(localized: "Not running")
    }
  }

  private func arm(name: String, key: String, note: String?, weight: Binding<Int>, remove: (() -> Void)?, id: String?) -> some View {
    HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text(name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        HStack(spacing: 4) {
          Text(key).font(.lnMono).foregroundStyle(Theme.textDimmed).lineLimit(1)
          if let note { Text("· \(note)").font(.lnCaption).foregroundStyle(Theme.warning) }
        }
      }
      Spacer(minLength: 4)
      Text(totalWeight > 0 ? percent(Double(weight.wrappedValue) / Double(totalWeight)) : "–").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
      Stepper("Weight of \(name)", value: weight, in: 0...100, step: 5).labelsHidden().disabled(running)
      if let id, !id.isEmpty {
        NavigationLink(value: AppRoute.pricingTable(projectId, id)) { Text("Edit") }.buttonStyle(.lnGhost)
      }
      if let remove { IconButton(systemImage: "xmark", label: "Remove variant", action: remove).disabled(running) }
    }
    .padding(.horizontal, 12).padding(.vertical, 8)
    .background(Theme.elevated.opacity(0.5), in: RoundedRectangle(cornerRadius: Metrics.radius))
  }

  private func reportView(_ report: PricingExperimentReport) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Since \(DateText.day(report.startedAt))").font(.lnMetaMedium).foregroundStyle(Theme.textToned)
      ForEach(report.arms, id: \.table) { arm in
        VStack(alignment: .leading, spacing: 3) {
          HStack(spacing: 6) {
            Text(arm.control ? String(localized: "This table") : arm.name).font(.lnRow).foregroundStyle(Theme.text)
            if report.leader == arm.table { Tag(text: "Ahead", tint: Theme.success) }
          }
          Text(armLine(arm)).font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
        }
        .padding(.vertical, 4)
      }
    }
  }

  private func armLine(_ arm: PricingExperimentReport.Arm) -> String {
    var parts = [String(localized: "\(arm.funnel.visitors.formatted()) visitors"), String(localized: "\(arm.funnel.clicks.formatted()) clicks"), String(localized: "\(arm.funnel.conversions.formatted()) purchases"), String(localized: "\(percent(arm.rate)) conversion")]
    if !arm.control {
      if let lift = arm.lift { parts.append(String(localized: "\(lift > 0 ? "+" : "")\(percent(lift)) lift")) }
      parts.append(arm.enough ? String(localized: "\(Int((arm.confidence * 100).rounded()))% sure") : String(localized: "too early"))
    }
    return parts.joined(separator: " · ")
  }

  // MARK: Requests

  private func load(refresh: Bool) async {
    busy = refresh ? "refresh" : "load"
    defer { busy = "" }
    do {
      let response: PricingStats = try await session.get("/v1/admin/pricing-tables/\(table.id)/stats", query: ["days": String(days)].merging(refresh ? ["refresh": "1"] : [:]) { a, _ in a })
      stats = response
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
  }

  private func loadTables() async {
    if let response: TablesResponse = try? await session.get("/v1/admin/pricing-tables", query: ["project": projectId]) { tables = response.tables }
  }

  /// Runs one request that answers `{ table }`, then reads the numbers and the tables again.
  private func perform(_ kind: String, adopt: Bool = false, _ request: () async throws -> PricingTable) async {
    busy = kind
    error = ""
    do {
      let next = try await request()
      if adopt { onAdopt(next) } else { onUpdate(next) }
    } catch {
      busy = ""
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
      return
    }
    busy = ""
    await loadTables()
    await load(refresh: false)
  }

  private struct TestBody: Encodable, Sendable {
    struct Test: Encodable, Sendable { let weight: Int; let variants: [PricingExperiment.Variant] }
    let experiment: Test
  }

  private func saveTest() async {
    let body = TestBody(experiment: .init(weight: test.weight, variants: test.variants))
    await perform("save") {
      let response: PricingTableResponse = try await session.send("/v1/admin/pricing-tables/\(table.id)", method: "PATCH", body: body)
      return response.table
    }
  }

  /// A draft copy of this table, added to the test: edit it, publish it, then start.
  private func addVariant() async {
    struct Response: Decodable, Sendable { let table: PricingTable; let variant: PricingTable }
    if changed { await saveTest() }
    await perform("variant") {
      let response: Response = try await session.send("/v1/admin/pricing-tables/\(table.id)/variants")
      return response.table
    }
  }

  private func start() async {
    if changed { await saveTest() }
    await perform("start") {
      let response: PricingTableResponse = try await session.send("/v1/admin/pricing-tables/\(table.id)/experiment/start")
      return response.table
    }
  }

  private func stop(adopt: String?) async {
    struct Body: Encodable, Sendable { let adopt: String? }
    await perform("stop", adopt: adopt != nil) {
      let response: PricingTableResponse = try await session.send("/v1/admin/pricing-tables/\(table.id)/experiment/stop", body: Body(adopt: adopt))
      return response.table
    }
  }
}
