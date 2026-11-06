import Charts
import SwiftUI

/// A project's revenue (web: projects/[id]/revenue.vue): connect the places you sell through, then net
/// revenue, MRR, subscribers, revenue by month, plans, top customers and recent payments over all of
/// them. HelpBites only reads from Stripe, App Store, Paddle and Lemon Squeezy; RevenueCat and your own
/// code send to it. Reports are for owners and admins (`marketing`).
struct RevenueScreen: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var sources: [RevenueConnection] = []
  @State private var report: RevenueReport?
  @State private var range = RevenueRange.d30
  @State private var loading = true
  @State private var error = ""
  @State private var connect: ConnectTarget?
  @State private var setup: RevenueConnection?
  @State private var disconnecting: RevenueConnection?

  /// What the connect sheet opens on: the source whose card was tapped, or the picker.
  private struct ConnectTarget: Identifiable { let id = UUID(); let start: RevenueSource? }

  /// The sources HelpBites reads; the rest send to it.
  private var pulled: [RevenueConnection] { sources.filter { $0.catalog?.kind == .pull } }
  private var available: [RevenueSource] { RevenueSource.all.filter { source in !sources.contains { $0.source == source.id } } }

  /// A running sync fills the numbers in as it goes; poll while one does.
  private var shouldPoll: Bool {
    sources.contains { $0.isRunning } || (!sources.isEmpty && report == nil && !sources.contains { !$0.lastError.isEmpty })
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        if loading {
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            ForEach(0..<4, id: \.self) { _ in RoundedRectangle(cornerRadius: Metrics.radiusLarge).fill(Theme.elevated).frame(height: 92) }
          }
          .redacted(reason: .placeholder)
        } else if !session.canManage {
          EmptyState(systemImage: "lock", title: "Revenue is for admins and owners", message: "Ask an admin of this workspace for access.")
        } else if sources.isEmpty {
          connectCard
        } else {
          content
        }
        ErrorText(message: error)
      }
      .frame(maxWidth: 1000, alignment: .leading)
      .padding(24)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .projectScreen(projectId, "Revenue")
    .toolbar {
      if !sources.isEmpty {
        ToolbarItemGroup(placement: .topBarTrailing) {
          Menu {
            Picker("Period", selection: $range) { ForEach(RevenueRange.allCases) { Text($0.label).tag($0) } }
          } label: { Label(range.label, systemImage: "calendar") }
          if !pulled.isEmpty {
            Button { Task { for connection in pulled where !connection.isRunning { await sync(connection.source, reset: false) } } } label: { Label("Sync", systemImage: "arrow.clockwise") }
              .disabled(pulled.allSatisfy { $0.isRunning })
          }
          Menu {
            if !available.isEmpty { Button { connect = ConnectTarget(start: nil) } label: { Label("Add a source", systemImage: "plus") } }
            ForEach(pulled) { connection in
              Button { Task { await sync(connection.source, reset: true) } } label: { Label("Sync \(connection.title) again from the start", systemImage: "clock.arrow.circlepath") }
            }
            ForEach(sources) { connection in
              Button(role: .destructive) { disconnecting = connection } label: { Label("Disconnect \(connection.title)", systemImage: "bolt.slash") }
            }
          } label: { Label("More", systemImage: "ellipsis") }
        }
      }
    }
    .task(id: projectId) {
      await load()
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(4))
        if shouldPoll { await load() }
      }
    }
    .onChange(of: range) { _, _ in Task { await loadReport() } }
    .sheet(item: $connect) { target in
      RevenueConnectSheet(projectId: projectId, available: available, start: target.start) { await load() }
    }
    .sheet(item: $setup) { RevenueSetupSheet(projectId: projectId, connection: $0) }
    .confirmationDialog(
      "Disconnect \(disconnecting?.title ?? "")? Its credentials and the payments and subscriptions it brought are forgotten. Your other sources are kept.",
      isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } }), titleVisibility: .visible, presenting: disconnecting
    ) { connection in
      Button("Disconnect", role: .destructive) { Task { await disconnect(connection.source) } }
    }
  }

  // MARK: Connect

  private var connectCard: some View {
    VStack(spacing: 16) {
      EmptyState(systemImage: "dollarsign.circle", title: "Connect a revenue source", message: "See revenue, subscribers and each person's payments next to their conversations. Connect every place you sell through and the numbers add up.")
      RevenueSourcePicker(sources: RevenueSource.all) { connect = ConnectTarget(start: $0) }
        .frame(maxWidth: 560)
    }
    .frame(maxWidth: .infinity)
  }

  // MARK: Report

  @ViewBuilder private var content: some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(sources) { connection in statusLine(connection) }
    }
    ForEach(sources.filter { !$0.lastError.isEmpty }) { connection in
      Label { VStack(alignment: .leading, spacing: 2) { Text("\(connection.title): The last sync failed").font(.lnRow); Text(connection.lastError).font(.lnMeta) } } icon: { Image(systemName: "exclamationmark.triangle") }
        .foregroundStyle(Theme.error).padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.error.opacity(0.08), in: RoundedRectangle(cornerRadius: Metrics.radius))
    }

    if let report {
      RevenueReportView(projectId: projectId, report: report)
    } else {
      EmptyState(systemImage: "hourglass", title: "Waiting for the first payments", message: "Payments show up here as soon as a source has read some or sent its first event.")
    }

    // TestFlight shares the App Store source's key.
    if sources.contains(where: { $0.source == "apple" }) { TestflightSection(projectId: projectId) }
  }

  /// One line per source: its name, Live or Test mode for the ones HelpBites reads, when it last ran or heard from the service, and how much it has brought.
  private func statusLine(_ connection: RevenueConnection) -> some View {
    let kind = connection.catalog?.kind
    return FlowLayout(spacing: 8) {
      Image(systemName: connection.catalog?.icon ?? "dollarsign.circle").font(.app(size: 12)).foregroundStyle(Theme.textMuted)
      Text(connection.title).font(.lnCaptionMedium).foregroundStyle(Theme.text)
      if kind == .pull { Tag(text: connection.livemode ? "Live" : "Test mode", tint: connection.livemode ? Theme.success : Theme.warning) }
      if !connection.accountName.isEmpty, connection.accountName != connection.title { Text(connection.accountName).font(.lnCaption).foregroundStyle(Theme.textMuted) }
      Text(statusText(connection)).font(.lnCaption).foregroundStyle(Theme.textMuted)
      if kind != .pull { Button("Setup") { setup = connection }.buttonStyle(.lnGhost) }
    }
  }

  private func statusText(_ connection: RevenueConnection) -> String {
    let payments = connection.stats.payments.formatted(), subscriptions = connection.stats.subscriptions.formatted()
    let time = Money.logTime(connection.lastRunAt)
    if connection.isRunning { return String(localized: "syncing…") }
    switch connection.catalog?.kind {
    case .push: return connection.lastRunAt == nil ? String(localized: "waiting for the first event") : String(localized: "last event \(time), \(payments) payments")
    case .manual: return connection.lastRunAt == nil ? String(localized: "nothing sent yet") : String(localized: "last sent \(time), \(payments) payments, \(subscriptions) subscriptions")
    default: return connection.lastRunAt == nil ? "" : String(localized: "synced \(time), \(payments) payments, \(subscriptions) subscriptions")
    }
  }

  // MARK: Requests

  private func load() async {
    struct Output: Decodable, Sendable { let sources: [RevenueConnection] }
    do {
      let output: Output = try await session.get("/v1/admin/revenue/sources", query: ["project": projectId])
      sources = output.sources
      if output.sources.isEmpty { report = nil } else { await loadReport() }
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  private func loadReport() async {
    struct Output: Decodable, Sendable { let report: RevenueReport? }
    guard !sources.isEmpty else { return }
    do {
      let output: Output = try await session.get("/v1/admin/revenue/report", query: ["project": projectId, "range": range.rawValue])
      report = output.report
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
  }

  private func sync(_ source: String, reset: Bool) async {
    struct Input: Encodable, Sendable { let project, source: String; let reset: Bool }
    struct Output: Decodable, Sendable { let connection: RevenueConnection }
    error = ""
    do {
      let output: Output = try await session.send("/v1/admin/revenue/sync", body: Input(project: projectId, source: source, reset: reset))
      sources = sources.map { $0.source == source ? output.connection : $0 }
    } catch { self.error = error.localizedDescription }
  }

  private func disconnect(_ source: String) async {
    error = ""
    do {
      try await session.delete("/v1/admin/revenue?project=\(projectId)&source=\(source)")
      report = nil
      await load()
    } catch { self.error = error.localizedDescription }
  }
}

private struct OpenContact: Identifiable { let id: String }

/// The numbers: four tiles, revenue and MRR by month, plans, top customers, recent payments.
private struct RevenueReportView: View {
  let projectId: String
  let report: RevenueReport
  /// The month picked by touching the chart; the readout shows the latest one otherwise.
  @State private var selected: String?
  /// The customer being looked at: a row that is also a contact opens them.
  @State private var openContact: OpenContact?

  private func money(_ amount: Double) -> String { Money.format(amount, report.currency) }
  private var shown: RevenueReport.Month? { report.months.first { $0.id == selected } ?? report.months.last }

  private func monthLabel(_ month: String) -> String {
    let parts = month.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2, let date = Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1])) else { return month }
    return date.formatted(.dateTime.month(.abbreviated).year())
  }

  private var kpis: [(label: String, value: String, hint: String)] {
    let subscribers = report.subscribers
    let subscriberHint = [subscribers.trialing > 0 ? String(localized: "\(subscribers.trialing) trialing") : nil, subscribers.pastDue > 0 ? String(localized: "\(subscribers.pastDue) past due") : nil].compactMap { $0 }.joined(separator: ", ")
    return [
      (String(localized: "Net revenue"), money(report.net), report.refunds > 0 ? String(localized: "\(money(report.gross)) gross, \(money(report.refunds)) refunded") : String(localized: "\(report.payments.formatted()) payments")),
      (String(localized: "MRR"), money(report.mrr), String(localized: "\(money(report.arr)) a year")),
      (String(localized: "Subscribers"), String(subscribers.active + subscribers.pastDue), subscriberHint.isEmpty ? String(localized: "\(report.newSubscribers) new, \(report.churned) canceled in this period") : subscriberHint),
      (String(localized: "Paying customers"), report.customers.formatted(), String(localized: "\(money(report.allTimeNet)) all time"))
    ]
  }

  var body: some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 12)], spacing: 12) {
      ForEach(kpis, id: \.label) { kpi in
        VStack(alignment: .leading, spacing: 4) {
          Text(kpi.label).font(.lnCaption).foregroundStyle(Theme.textMuted)
          Text(kpi.value).font(.app(size: 24, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.textHighlighted).lineLimit(1).minimumScaleFactor(0.6)
          Text(kpi.hint).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(2)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
        .accessibilityElement(children: .combine)
      }
    }

    VStack(alignment: .leading, spacing: 12) {
      SectionLabel("Revenue by month")
      // The readout doubles as the legend: touch or drag across the chart to read any month.
      if let shown {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 12) { readout(shown) }
          VStack(alignment: .leading, spacing: 4) { readout(shown) }
        }
      }
      // Net revenue and MRR share the one axis: both are money in the same currency.
      Chart {
        ForEach(report.months) { month in
          BarMark(x: .value("Month", month.id), y: .value("Amount", month.net), width: .ratio(0.85))
            .foregroundStyle(Theme.accent.opacity(month.id == selected ? 1 : 0.7))
            .cornerRadius(3)
            .accessibilityLabel(monthLabel(month.id))
            .accessibilityValue("\(money(month.net)) from \(month.payments) payments")
        }
        ForEach(report.months) { month in
          LineMark(x: .value("Month", month.id), y: .value("Amount", month.mrr), series: .value("Series", "MRR"))
            .foregroundStyle(Theme.textHighlighted)
            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            .accessibilityLabel(monthLabel(month.id))
            .accessibilityValue("\(money(month.mrr)) MRR")
        }
        if let selected, let point = report.months.first(where: { $0.id == selected }) {
          PointMark(x: .value("Month", point.id), y: .value("Amount", point.mrr)).foregroundStyle(Theme.textHighlighted).symbolSize(64)
        }
      }
      .chartXSelection(value: $selected)
      .chartYAxis(.hidden)
      .chartXAxis {
        AxisMarks { value in AxisValueLabel { Text(String((value.as(String.self) ?? "").suffix(2))).font(.app(size: 10)).foregroundStyle(Theme.textMuted) } }
      }
      .frame(height: 176)
    }
    .padding(16)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))

    ViewThatFits(in: .horizontal) {
      HStack(alignment: .top, spacing: 24) { plans; customers }
      VStack(alignment: .leading, spacing: 24) { plans; customers }
    }

    if report.sources.count > 1 { bySource }

    VStack(alignment: .leading, spacing: 8) {
      SectionLabel("Recent payments")
      if report.recent.isEmpty {
        Text("No payments yet.").font(.lnMeta).foregroundStyle(Theme.textMuted).frame(maxWidth: .infinity).padding(.vertical, 20)
          .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
      } else {
        Card {
          ForEach(report.recent) { payment in
            CardRow(divider: payment.id != report.recent.last?.id) {
              PaymentRow(payment: payment, showCustomer: true, sourceName: report.sources.count > 1 ? RevenueSource.title(of: payment.source ?? "stripe") : nil) { openContact = OpenContact(id: $0) }
            }
          }
        }
      }
    }
    .sheet(item: $openContact) { ContactSheetByID(projectId: projectId, contactId: $0.id) }

    if !report.otherCurrencies.isEmpty {
      Text("Totals are in \(report.currency.uppercased()). Not included: \(report.otherCurrencies.map { Money.format($0.net, $0.currency) }.joined(separator: ", ")).").font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  @ViewBuilder private func readout(_ month: RevenueReport.Month) -> some View {
    Text(monthLabel(month.id)).font(.lnCaption).foregroundStyle(Theme.textHighlighted)
    HStack(spacing: 6) {
      RoundedRectangle(cornerRadius: 2).fill(Theme.accent.opacity(0.7)).frame(width: 9, height: 9)
      Text(money(month.net)).font(.lnCaption.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.textHighlighted)
      Text(month.payments == 1 ? "net revenue · 1 payment" : "net revenue · \(month.payments) payments").font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
    HStack(spacing: 6) {
      Capsule().fill(Theme.textHighlighted).frame(width: 10, height: 2)
      Text(money(month.mrr)).font(.lnCaption.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.textHighlighted)
      Text("MRR").font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  /// What each source brought in the period, shown once there is more than one.
  private var bySource: some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionLabel("By source")
      Card {
        ForEach(report.sources) { row in
          CardRow(divider: row.id != report.sources.last?.id) {
            HStack(spacing: 10) {
              Image(systemName: RevenueSource.named(row.source)?.icon ?? "dollarsign.circle").font(.app(size: 13)).foregroundStyle(Theme.textMuted).frame(width: 16)
              Text(RevenueSource.title(of: row.source)).font(.lnCallout).foregroundStyle(Theme.text).lineLimit(1)
              Spacer(minLength: 8)
              Text(row.payments == 1 ? "1 payment" : "\(row.payments) payments").font(.lnCaption).foregroundStyle(Theme.textMuted)
              if row.mrr > 0 { Text("\(money(row.mrr))/mo").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted) }
              Text(money(row.net)).font(.lnCallout).monospacedDigit().foregroundStyle(Theme.text)
            }
          }
        }
      }
    }
  }

  private var plans: some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionLabel("Plans")
      if report.plans.isEmpty {
        Text("No paying subscribers.").font(.lnCaption).foregroundStyle(Theme.textDimmed)
      } else {
        Card {
          ForEach(report.plans) { plan in
            CardRow(divider: plan.id != report.plans.last?.id) {
              HStack(spacing: 10) {
                Text(plan.plan).font(.lnCallout).foregroundStyle(Theme.text).lineLimit(1)
                Spacer(minLength: 8)
                Text(plan.subscribers == 1 ? "1 subscriber" : "\(plan.subscribers) subscribers").font(.lnCaption).foregroundStyle(Theme.textMuted)
                Text("\(money(plan.mrr))/mo").font(.lnCallout).monospacedDigit().foregroundStyle(Theme.text)
              }
            }
          }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var customers: some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionLabel("Top customers")
      if report.topCustomers.isEmpty {
        Text("No payments yet.").font(.lnCaption).foregroundStyle(Theme.textDimmed)
      } else {
        Card {
          ForEach(report.topCustomers) { customer in
            CardRow(divider: customer.id != report.topCustomers.last?.id) {
              HStack(spacing: 10) {
                let who = Text(customer.email.isEmpty ? customer.customerId : customer.email).font(.lnCallout).foregroundStyle(Theme.text).lineLimit(1)
                if let contactId = customer.contactId, !contactId.isEmpty {
                  Button { openContact = OpenContact(id: contactId) } label: { who.underline() }.buttonStyle(.plain).accessibilityHint("Opens this person")
                } else { who }
                Spacer(minLength: 8)
                Text(customer.payments == 1 ? "1 payment" : "\(customer.payments) payments").font(.lnCaption).foregroundStyle(Theme.textMuted)
                Text(money(customer.net)).font(.lnCallout).monospacedDigit().foregroundStyle(Theme.text)
              }
            }
          }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// One payment: who or what, the source it came from when the report has several, a status badge for failed
/// and refunded ones, the amount (a receipt link when the service has one) and when. Used by the report and by a contact's billing.
struct PaymentRow: View {
  let payment: StripePayment
  var showCustomer = false
  /// Shown when the project has more than one source.
  var sourceName: String? = nil
  @Environment(\.openURL) private var openURL
  /// With a customer shown, tapping their name opens the person (their contact id) when they are one.
  var onOpenContact: ((String) -> Void)? = nil

  private var title: String {
    showCustomer ? (payment.email.isEmpty ? (payment.customerId.isEmpty ? String(localized: "Guest") : payment.customerId) : payment.email) : (payment.description.isEmpty ? String(localized: "Payment") : payment.description)
  }

  var body: some View {
    HStack(spacing: 10) {
      let label = (Text(title) + Text(showCustomer && !payment.description.isEmpty ? " · \(payment.description)" : "").foregroundStyle(Theme.textMuted))
        .font(.lnCallout).foregroundStyle(Theme.text).lineLimit(1)
      if showCustomer, let contactId = payment.contactId, !contactId.isEmpty, let onOpenContact {
        Button { onOpenContact(contactId) } label: { label.underline() }.buttonStyle(.plain).accessibilityHint("Opens this person")
      } else { label }
      Spacer(minLength: 8)
      if let sourceName { Text(sourceName).font(.lnCaption).foregroundStyle(Theme.textDimmed).lineLimit(1) }
      if payment.status != "succeeded" { Tag(text: payment.status, tint: Theme.error) }
      else if payment.refunded > 0 { Tag(text: payment.refunded >= payment.amount ? "Refunded" : "Part refunded") }
      if let receipt = URL(string: payment.receiptUrl), !payment.receiptUrl.isEmpty {
        Button { openURL(receipt) } label: { Text(Money.minor(payment.amount, payment.currency)).monospacedDigit().underline() }.buttonStyle(.plain).font(.lnCallout).foregroundStyle(Theme.text)
          .accessibilityHint("Opens the receipt")
      } else {
        Text(Money.minor(payment.amount, payment.currency)).font(.lnCallout).monospacedDigit().foregroundStyle(Theme.text)
      }
      Text(Money.logTime(payment.paidAt)).font(.lnCaption).foregroundStyle(Theme.textMuted).frame(minWidth: 44, alignment: .trailing)
    }
  }
}
