import Charts
import SwiftUI

/// Every project at once (web: pages/overview.vue), the screen the app opens on: a card per
/// project, then the workspace's numbers, the latest unread messages and revenue by project.
/// Revenue is for admins and owners; agents see the rest.
struct OverviewScreen: View {
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @State private var overview: WorkspaceOverview?
  @State private var range = RevenueRange.d30
  @State private var error = ""
  @State private var selectedMonth: String?
  @State private var pendingReload: Task<Void, Never>?

  private var revenue: WorkspaceRevenue? { overview?.revenue }
  private var top: WorkspaceRevenue.Total? { revenue?.totals.first }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        ErrorText(message: error)
        if let overview {
          projectCards(overview)
          if !overview.projects.isEmpty {
            glance(overview)
            // Side by side when there's room, as on the web; stacked on a phone.
            ViewThatFits(in: .horizontal) {
              HStack(alignment: .top, spacing: 24) {
                unreadSection(overview).frame(minWidth: 340)
                if revenue != nil { revenueSection.frame(minWidth: 340) }
              }
              VStack(alignment: .leading, spacing: 28) {
                unreadSection(overview)
                if revenue != nil { revenueSection }
              }
            }
          }
        } else if error.isEmpty {
          SkeletonRows(count: 6)
        }
      }
      .frame(maxWidth: 1000, alignment: .leading)
      .padding(24)
      .frame(maxWidth: .infinity)
    }
    .refreshable { await load() }
    .panelScreen("Overview")
    .toolbar {
      if revenue != nil {
        ToolbarItem(placement: .primaryAction) {
          Menu {
            Picker("Period", selection: $range) { ForEach(RevenueRange.allCases) { Text($0.label).tag($0) } }
          } label: { Label(range.label, systemImage: "calendar") }
        }
      }
      ToolbarItem(placement: .primaryAction) {
        Button { Task { await load() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
      }
    }
    .task(id: range) { await load() }
    // The inbox store hears new messages live; when its badge moves, so do these numbers. A burst reloads once.
    .onChange(of: workspace.inbox.totalUnread) { _, _ in
      pendingReload?.cancel()
      pendingReload = Task {
        try? await Task.sleep(for: .seconds(1.5))
        if !Task.isCancelled { await load() }
      }
    }
  }

  // MARK: Projects

  @ViewBuilder private func projectCards(_ overview: WorkspaceOverview) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 6) {
        Text("Projects").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Text("\(overview.projects.count)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
      }
      if overview.projects.isEmpty {
        EmptyState(systemImage: "square.stack", title: "Add your first project", message: "A project is one of your apps. Its conversations, revenue and everything else show up here.") {
          Button("New project") { workspace.newProjectOpen = true }.buttonStyle(.lnPrimary)
        }
      } else {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 12)], spacing: 12) {
          ForEach(overview.projects) { stats in projectCard(stats) }
          Button { workspace.newProjectOpen = true } label: {
            Label("New project", systemImage: "plus")
              .font(.lnMetaMedium).foregroundStyle(Theme.textMuted)
              .frame(maxWidth: .infinity, minHeight: 104)
              .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.borderAccented, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
    }
  }

  private func projectCard(_ stats: WorkspaceOverview.ProjectStats) -> some View {
    let project = workspace.project(stats.id)
    let money = revenue?.projects.first { $0.projectId == stats.id }
    return Button { workspace.go(.project(stats.id, .overview)) } label: {
      VStack(alignment: .leading, spacing: 14) {
        HStack(spacing: 10) {
          ProjectTile(id: stats.id, name: project?.name ?? stats.name, accent: project?.theme.accent, icon: project?.iconUrl, size: 22)
          VStack(alignment: .leading, spacing: 1) {
            Text(project?.name ?? stats.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
            Text(host(project?.siteUrl) ?? "No site URL").font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
          }
          Spacer(minLength: 4)
          if stats.errors > 0 {
            Label("\(stats.errors)", systemImage: "ladybug").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.warning)
              .accessibilityLabel("\(stats.errors) open error report\(stats.errors == 1 ? "" : "s")")
          }
        }
        HStack(alignment: .top, spacing: 12) {
          cardStat("Unread", EmailStatusText.compactCount(stats.unread), dot: stats.unread > 0)
          cardStat("Open", EmailStatusText.compactCount(stats.open))
          if revenue != nil { cardStat("Revenue", money.map { Money.format($0.net, $0.currency) } ?? "—", dimmed: money == nil) }
        }
      }
      .padding(14)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func cardStat(_ label: String, _ value: String, dot: Bool = false, dimmed: Bool = false) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
      HStack(spacing: 5) {
        if dot { Circle().fill(Theme.accent).frame(width: 6, height: 6) }
        Text(value).font(.system(size: 17, weight: .semibold)).monospacedDigit().foregroundStyle(dimmed ? Theme.textDimmed : Theme.textHighlighted).lineLimit(1).minimumScaleFactor(0.7)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
    .accessibilityValue(dimmed ? "Stripe not connected" : "")
  }

  // MARK: At a glance

  private struct Tile: Identifiable { let id: String; let label, value: String; var hint = ""; var change: Double?; var opensInbox = false }

  private func tiles(_ overview: WorkspaceOverview) -> [Tile] {
    let totals = overview.totals
    var list = [
      Tile(id: "unread", label: "Unread conversations", value: EmailStatusText.compactCount(totals.unread), hint: "\(totals.unreadMessages) unread message\(totals.unreadMessages == 1 ? "" : "s")", opensInbox: true),
      Tile(id: "open", label: "Open conversations", value: EmailStatusText.compactCount(totals.open), opensInbox: true)
    ]
    guard revenue != nil else { return list + [Tile(id: "errors", label: "Open error reports", value: EmailStatusText.compactCount(totals.errors))] }
    if let top {
      list.append(Tile(id: "net", label: "Net revenue", value: Money.format(top.net, top.currency), hint: range.label, change: top.change))
      list.append(Tile(id: "mrr", label: "MRR", value: Money.format(top.mrr, top.currency), hint: "\(top.subscribers) subscriber\(top.subscribers == 1 ? "" : "s")"))
    } else {
      list.append(Tile(id: "net", label: "Net revenue", value: "—", hint: "Stripe not connected"))
      list.append(Tile(id: "mrr", label: "MRR", value: "—", hint: "Stripe not connected"))
    }
    return list
  }

  private func glance(_ overview: WorkspaceOverview) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("At a glance").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
        ForEach(tiles(overview)) { tile in
          Button { if tile.opensInbox { workspace.go(.inbox) } } label: {
            VStack(alignment: .leading, spacing: 4) {
              Text(tile.label).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
              Text(tile.value).font(.system(size: 22, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.textHighlighted).lineLimit(1).minimumScaleFactor(0.6)
              if let change = tile.change {
                HStack(spacing: 4) {
                  Label(abs(change).formatted(.percent.precision(.fractionLength(0))), systemImage: change >= 0 ? "arrow.up.right" : "arrow.down.right")
                    .font(.lnCaptionMedium).foregroundStyle(change >= 0 ? Theme.success : Theme.error)
                  Text(previousLabel).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
                }
              } else if !tile.hint.isEmpty {
                Text(tile.hint).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
              }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .disabled(!tile.opensInbox)
          .accessibilityElement(children: .combine)
        }
      }
    }
  }

  private var previousLabel: String {
    switch range {
    case .d30: "vs the 30 days before"
    case .d90: "vs the 90 days before"
    case .m12: "vs the 12 months before"
    case .all: ""
    }
  }

  // MARK: Unread

  private func unreadSection(_ overview: WorkspaceOverview) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("Unread messages").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Spacer(minLength: 8)
        Button("Open the inbox") { workspace.go(.inbox) }.font(.lnMetaMedium).foregroundStyle(Theme.textMuted).buttonStyle(.plain)
      }
      if overview.unread.isEmpty {
        EmptyState(systemImage: "tray", title: "Inbox zero", message: "Nobody is waiting on a reply.")
      } else {
        Card {
          ForEach(overview.unread) { item in
            CardRow(divider: item.id != overview.unread.last?.id) {
              Button { openConversation(item) } label: { unreadRow(item) }.buttonStyle(.plain)
            }
          }
        }
      }
    }
  }

  private func unreadRow(_ item: WorkspaceOverview.Unread) -> some View {
    let project = workspace.project(item.projectId)
    let name = [item.name, item.email, item.subject].first { !$0.isEmpty } ?? "Unknown customer"
    return HStack(spacing: 10) {
      Avatar(name: name, size: 28)
        .overlay(alignment: .bottomTrailing) {
          ProjectDot(id: item.projectId, accent: project?.theme.accent, icon: project?.iconUrl, size: 9)
            .overlay(Circle().strokeBorder(Theme.panel, lineWidth: 1.5))
            .offset(x: 2, y: 2)
        }
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(name).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Spacer(minLength: 4)
          Text(DateText.short(item.at)).font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
        }
        (Text(project.map { "\($0.name)  " } ?? "").font(.lnCaptionMedium).foregroundStyle(Theme.textToned)
          + Text(item.preview.isEmpty ? item.subject : item.preview).font(.lnCaption).foregroundStyle(Theme.textMuted))
          .lineLimit(1)
      }
      Text("\(item.unread)")
        .font(.system(size: 11, weight: .semibold)).monospacedDigit().foregroundStyle(.white)
        .padding(.horizontal, 6).frame(minWidth: 20, minHeight: 20)
        .background(Theme.accent, in: Capsule())
        .accessibilityLabel("\(item.unread) unread")
    }
    .contentShape(Rectangle())
  }

  /// The web links to `/inbox?c=<conversation>`. A filter to another project would hide it, so that one goes.
  private func openConversation(_ item: WorkspaceOverview.Unread) {
    let inbox = workspace.inbox
    if !inbox.projectFilter.isEmpty && inbox.projectFilter != item.projectId { inbox.projectFilter = "" }
    workspace.go(.inbox)
    Task { await inbox.select(item.conversationId) }
  }

  // MARK: Revenue

  @ViewBuilder private var revenueSection: some View {
    if let revenue {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Text("Revenue by project").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Spacer(minLength: 8)
          Text(range.label).font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
        if revenue.connected == 0 {
          EmptyState(systemImage: "dollarsign.circle", title: "No revenue yet", message: "Connect Stripe to a project to see its revenue here, next to your other apps.") {
            if let first = overview?.projects.first {
              Button("Connect Stripe") { workspace.go(.project(first.id, .revenue)) }.buttonStyle(.lnSecondary)
            }
          }
        } else if let top {
          monthChart(top)
          byProject(revenue)
          let others = revenue.totals.dropFirst().filter { $0.net > 0 }
          if !others.isEmpty {
            Text("Totals are in \(top.currency.uppercased()). Not included: \(others.map { Money.format($0.net, $0.currency) }.joined(separator: ", ")).").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
          let unconnected = max(0, (overview?.projects.count ?? 0) - revenue.connected)
          if unconnected > 0 {
            Text("\(unconnected) project\(unconnected == 1 ? " without Stripe is" : "s without Stripe are") not counted.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
        } else {
          EmptyState(systemImage: "hourglass", title: "Waiting for the first sync", message: "Payments show up here as soon as the first stretch has been read.")
        }
      }
    }
  }

  private func monthLabel(_ month: String, year: Bool = false) -> String {
    let parts = month.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2, let date = Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1])) else { return month }
    return year ? date.formatted(.dateTime.month(.abbreviated).year()) : date.formatted(.dateTime.month(.abbreviated))
  }

  /// One series, so no legend: the label names it, and the readout shows the touched month (else this one).
  private func monthChart(_ total: WorkspaceRevenue.Total) -> some View {
    let shown = total.months.first { $0.id == selectedMonth } ?? total.months.last
    return VStack(alignment: .leading, spacing: 12) {
      HStack {
        SectionLabel("Net revenue by month")
        if let shown {
          Text(monthLabel(shown.id, year: true)).font(.lnCaption).foregroundStyle(Theme.textMuted)
          Text(Money.format(shown.net, total.currency)).font(.lnCaption.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.textHighlighted)
        }
      }
      Chart(total.months) { month in
        BarMark(x: .value("Month", month.id), y: .value("Net", month.net), width: .ratio(0.7))
          .foregroundStyle(Theme.accent.opacity(month.id == shown?.id ? 1 : 0.55))
          .cornerRadius(4)
          .accessibilityLabel(monthLabel(month.id, year: true))
          .accessibilityValue(Money.format(month.net, total.currency))
      }
      .chartXSelection(value: $selectedMonth)
      .chartYAxis(.hidden)
      .chartXAxis {
        AxisMarks { value in AxisValueLabel { Text(monthLabel(value.as(String.self) ?? "")).font(.system(size: 10)).foregroundStyle(Theme.textMuted) } }
      }
      .frame(height: 140)
    }
    .padding(16)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  /// Ranked by net; each bar is the project's share of revenue in its currency.
  private func byProject(_ revenue: WorkspaceRevenue) -> some View {
    Card {
      ForEach(revenue.projects) { row in
        let project = workspace.project(row.projectId)
        let total = revenue.totals.first { $0.currency == row.currency }?.net ?? 0
        let share = total > 0 ? row.net / total : 0
        CardRow(divider: row.id != revenue.projects.last?.id) {
          Button { workspace.go(.project(row.projectId, .revenue)) } label: {
            VStack(alignment: .leading, spacing: 8) {
              HStack(spacing: 10) {
                ProjectTile(id: row.projectId, name: project?.name ?? "?", accent: project?.theme.accent, icon: project?.iconUrl)
                Text(project?.name ?? row.projectId).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
                Spacer(minLength: 8)
                if row.mrr > 0 { Text("\(Money.format(row.mrr, row.currency)) MRR").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted) }
                Text(Money.format(row.net, row.currency)).font(.lnRow).monospacedDigit().foregroundStyle(Theme.textHighlighted)
              }
              GeometryReader { proxy in
                ZStack(alignment: .leading) {
                  Capsule().fill(Theme.elevated)
                  Capsule().fill(Theme.projectColor(id: row.projectId, accent: project?.theme.accent)).frame(width: proxy.size.width * share)
                }
              }
              .frame(height: 6)
              .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityHint("\(share.formatted(.percent.precision(.fractionLength(0)))) of \(row.currency.uppercased()) revenue")
        }
      }
    }
  }

  // MARK: Requests

  private func host(_ url: String?) -> String? {
    guard let url, !url.isEmpty else { return nil }
    return URL(string: url)?.host ?? url
  }

  private func load() async {
    do {
      overview = try await session.get("/v1/admin/overview", query: ["range": range.rawValue])
      error = ""
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
  }
}
