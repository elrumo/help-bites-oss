import Charts
import SwiftUI

/// A project's revenue (web: projects/[id]/revenue.vue): connect Stripe, then net revenue,
/// MRR, subscribers, revenue by month, plans, top customers and recent payments from the
/// last sync. HelpBites only reads from Stripe. Reports are for owners and admins (`marketing`).
struct RevenueScreen: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var connection: StripeConnection?
  @State private var ready = true
  @State private var report: RevenueReport?
  @State private var range = RevenueRange.d30
  @State private var loading = true
  @State private var apiKey = ""
  @State private var connecting = false
  @State private var error = ""
  @State private var confirmDisconnect = false
  @State private var confirmResync = false

  /// A running sync fills the numbers in as it goes; poll while it does.
  private var shouldPoll: Bool {
    guard let connection, connection.connected else { return false }
    return connection.isRunning || (report == nil && connection.lastError.isEmpty)
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
        } else if connection?.connected != true {
          connectCard
        } else if let connection {
          content(connection)
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
      if connection?.connected == true {
        ToolbarItemGroup(placement: .topBarTrailing) {
          Menu {
            Picker("Period", selection: $range) { ForEach(RevenueRange.allCases) { Text($0.label).tag($0) } }
          } label: { Label(range.label, systemImage: "calendar") }
          Button { Task { await sync(reset: false) } } label: { Label("Sync", systemImage: "arrow.clockwise") }
            .disabled(connection?.isRunning == true)
          Menu {
            Button { confirmResync = true } label: { Label("Sync everything again", systemImage: "clock.arrow.circlepath") }
            Button(role: .destructive) { confirmDisconnect = true } label: { Label("Disconnect Stripe", systemImage: "bolt.slash") }
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
    .confirmationDialog("Disconnect Stripe? The key and the payments synced from Stripe are forgotten. Contacts keep their Stripe attributes.", isPresented: $confirmDisconnect, titleVisibility: .visible) {
      Button("Disconnect", role: .destructive) { Task { await disconnect() } }
    }
    .confirmationDialog("Read every charge again? This picks up refunds on old payments and can take a while.", isPresented: $confirmResync, titleVisibility: .visible) {
      Button("Sync everything again") { Task { await sync(reset: true) } }
    }
  }

  // MARK: Connect

  private var connectCard: some View {
    VStack(alignment: .leading, spacing: 16) {
      EmptyState(systemImage: "dollarsign.circle", title: "Connect Stripe", message: "See revenue, subscribers and each person's payments next to their conversations. HelpBites only reads from Stripe.")
      VStack(alignment: .leading, spacing: 12) {
        LabeledField(label: "Restricted API key", hint: "Stripe → Developers → API keys → Create restricted key. Give it read access to Charges, Customers, Subscriptions and Products.") {
          SecureField("rk_live_…", text: $apiKey).textFieldStyle(.linear).autocorrectionDisabled().onSubmit { Task { await connect() } }
        }
        if !ready { ErrorText(message: "Set HELPBITES_SECRET on the server first: the key is stored sealed with it.") }
        Button { Task { await connect() } } label: { if connecting { ProgressView() } else { Text("Connect Stripe") } }
          .buttonStyle(.lnPrimary).disabled(apiKey.trimmingCharacters(in: .whitespaces).isEmpty || !ready || connecting)
      }
      .frame(maxWidth: 440, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
  }

  // MARK: Report

  @ViewBuilder private func content(_ connection: StripeConnection) -> some View {
    HStack(spacing: 8) {
      Tag(text: connection.livemode ? "Live" : "Test mode", tint: connection.livemode ? Theme.success : Theme.warning)
      Group {
        Text(connection.accountName.isEmpty ? "Stripe" : connection.accountName)
        if connection.isRunning { Text("· syncing… \(connection.stats.payments.formatted()) payments so far") }
        else if let run = connection.lastRunAt { Text("· synced \(Money.logTime(run)), \(connection.stats.payments.formatted()) payments, \(connection.stats.subscriptions.formatted()) subscriptions") }
      }
      .font(.lnCaption).foregroundStyle(Theme.textMuted)
      Spacer(minLength: 0)
    }
    if !connection.lastError.isEmpty {
      Label { VStack(alignment: .leading, spacing: 2) { Text("The last sync failed").font(.lnRow); Text(connection.lastError).font(.lnMeta) } } icon: { Image(systemName: "exclamationmark.triangle") }
        .foregroundStyle(Theme.error).padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.error.opacity(0.08), in: RoundedRectangle(cornerRadius: Metrics.radius))
    }

    if let report {
      RevenueReportView(projectId: projectId, report: report)
    } else {
      EmptyState(systemImage: "hourglass", title: "Waiting for the first sync", message: "Payments show up here as soon as the first stretch has been read.")
    }
  }

  // MARK: Requests

  private func load() async {
    do {
      let state: StripeState = try await session.get("/v1/admin/stripe", query: ["project": projectId])
      connection = state.connection; ready = state.ready
      if state.connection.connected { await loadReport() } else { report = nil }
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  private func loadReport() async {
    struct Output: Decodable, Sendable { let report: RevenueReport? }
    guard connection?.connected == true else { return }
    do {
      let output: Output = try await session.get("/v1/admin/stripe/report", query: ["project": projectId, "range": range.rawValue])
      report = output.report
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
  }

  private func connect() async {
    struct Input: Encodable, Sendable { let project, apiKey: String }
    struct Output: Decodable, Sendable { let connection: StripeConnection }
    guard !connecting, !apiKey.trimmingCharacters(in: .whitespaces).isEmpty else { return }
    connecting = true; error = ""
    defer { connecting = false }
    do {
      let output: Output = try await session.send("/v1/admin/stripe/connect", body: Input(project: projectId, apiKey: apiKey.trimmingCharacters(in: .whitespaces)))
      connection = output.connection; apiKey = ""
    } catch { self.error = error.localizedDescription }
  }

  private func sync(reset: Bool) async {
    struct Input: Encodable, Sendable { let project: String; let reset: Bool }
    struct Output: Decodable, Sendable { let connection: StripeConnection }
    error = ""
    do {
      let output: Output = try await session.send("/v1/admin/stripe/sync", body: Input(project: projectId, reset: reset))
      connection = output.connection
    } catch { self.error = error.localizedDescription }
  }

  private func disconnect() async {
    error = ""
    do {
      try await session.delete("/v1/admin/stripe?project=\(projectId)")
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
    let subscriberHint = [subscribers.trialing > 0 ? "\(subscribers.trialing) trialing" : nil, subscribers.pastDue > 0 ? "\(subscribers.pastDue) past due" : nil].compactMap { $0 }.joined(separator: ", ")
    return [
      ("Net revenue", money(report.net), report.refunds > 0 ? "\(money(report.gross)) gross, \(money(report.refunds)) refunded" : "\(report.payments.formatted()) payments"),
      ("MRR", money(report.mrr), "\(money(report.arr)) a year"),
      ("Subscribers", String(subscribers.active + subscribers.pastDue), subscriberHint.isEmpty ? "\(report.newSubscribers) new, \(report.churned) canceled in this period" : subscriberHint),
      ("Paying customers", report.customers.formatted(), "\(money(report.allTimeNet)) all time")
    ]
  }

  var body: some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 12)], spacing: 12) {
      ForEach(kpis, id: \.label) { kpi in
        VStack(alignment: .leading, spacing: 4) {
          Text(kpi.label).font(.lnCaption).foregroundStyle(Theme.textMuted)
          Text(kpi.value).font(.system(size: 24, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.textHighlighted).lineLimit(1).minimumScaleFactor(0.6)
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
        AxisMarks { value in AxisValueLabel { Text(String((value.as(String.self) ?? "").suffix(2))).font(.system(size: 10)).foregroundStyle(Theme.textMuted) } }
      }
      .frame(height: 176)
    }
    .padding(16)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))

    ViewThatFits(in: .horizontal) {
      HStack(alignment: .top, spacing: 24) { plans; customers }
      VStack(alignment: .leading, spacing: 24) { plans; customers }
    }

    VStack(alignment: .leading, spacing: 8) {
      SectionLabel("Recent payments")
      if report.recent.isEmpty {
        Text("No payments yet.").font(.lnMeta).foregroundStyle(Theme.textMuted).frame(maxWidth: .infinity).padding(.vertical, 20)
          .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
      } else {
        Card {
          ForEach(report.recent) { payment in
            CardRow(divider: payment.id != report.recent.last?.id) { PaymentRow(payment: payment, showCustomer: true) { openContact = OpenContact(id: $0) } }
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
      Text("net revenue · \(month.payments) payment\(month.payments == 1 ? "" : "s")").font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
    HStack(spacing: 6) {
      Capsule().fill(Theme.textHighlighted).frame(width: 10, height: 2)
      Text(money(month.mrr)).font(.lnCaption.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.textHighlighted)
      Text("MRR").font(.lnCaption).foregroundStyle(Theme.textMuted)
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
                Text("\(plan.subscribers) subscriber\(plan.subscribers == 1 ? "" : "s")").font(.lnCaption).foregroundStyle(Theme.textMuted)
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
                Text("\(customer.payments) payment\(customer.payments == 1 ? "" : "s")").font(.lnCaption).foregroundStyle(Theme.textMuted)
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

/// One payment: who or what, a status badge for failed and refunded ones, the amount (a receipt link when
/// Stripe has one) and when. Used by the report and by a contact's billing.
struct PaymentRow: View {
  let payment: StripePayment
  var showCustomer = false
  @Environment(\.openURL) private var openURL
  /// With a customer shown, tapping their name opens the person (their contact id) when they are one.
  var onOpenContact: ((String) -> Void)? = nil

  private var title: String {
    showCustomer ? (payment.email.isEmpty ? (payment.customerId.isEmpty ? "Guest" : payment.customerId) : payment.email) : (payment.description.isEmpty ? "Payment" : payment.description)
  }

  var body: some View {
    HStack(spacing: 10) {
      let label = (Text(title) + Text(showCustomer && !payment.description.isEmpty ? " · \(payment.description)" : "").foregroundStyle(Theme.textMuted))
        .font(.lnCallout).foregroundStyle(Theme.text).lineLimit(1)
      if showCustomer, let contactId = payment.contactId, !contactId.isEmpty, let onOpenContact {
        Button { onOpenContact(contactId) } label: { label.underline() }.buttonStyle(.plain).accessibilityHint("Opens this person")
      } else { label }
      Spacer(minLength: 8)
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
