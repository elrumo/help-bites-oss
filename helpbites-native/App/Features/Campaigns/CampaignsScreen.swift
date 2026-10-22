import SwiftUI

/// The Campaigns, Sequences and Settings tabs of a project's Email (web: CampaignList, SequenceList and
/// EmailSettings, each a `?view=` of projects/[id]/email). `EmailLibraryScreen` draws the tab bar and
/// the setup strip; this is what sits under them, with the plan-lock notice of the tab's plan feature.
struct CampaignsScreen: View {
  let projectId: String
  var tab: EmailTab = .campaigns
  /// Called after Settings saves, so the setup strip above reads the project's email setup again.
  var onSettingsSaved: () -> Void = {}
  @Environment(SessionStore.self) private var session

  /// What the open tab needs from the plan. Settings shows its own notice, beside the event webhook.
  private var feature: String? { tab == .sequences ? "sequences" : tab == .campaigns ? "campaigns" : nil }

  var body: some View {
    VStack(spacing: 0) {
      if let feature, session.isLocked(feature) {
        PlanLockNotice(feature: feature).padding(.horizontal, Metrics.gutter).padding(.vertical, 8)
      }
      switch tab {
      case .sequences: SequencesList(projectId: projectId)
      case .settings: ProjectEmailSettingsView(projectId: projectId, onSaved: onSettingsSaved)
      default: CampaignsList(projectId: projectId)
      }
    }
  }
}

private struct CampaignsList: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var campaigns: [Campaign] = []
  @State private var loading = true
  @State private var error = ""
  @State private var open: Campaign?
  @State private var creating = false

  var body: some View {
    List {
      if !error.isEmpty { ErrorText(message: error).linearRow() }
      if loading && campaigns.isEmpty { SkeletonRows(count: 4).linearRow() }
      else if campaigns.isEmpty {
        EmptyState(systemImage: "megaphone", title: "No campaigns yet", message: "Send a newsletter or an announcement to your subscribers: everyone, a segment, or one topic's readers.") {
          Button("New campaign") { Task { await create() } }.buttonStyle(.lnPrimary).disabled(creating)
        }
        .linearRow()
      }
      ForEach(campaigns) { campaign in
        Button { open = campaign } label: {
          HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
              Text(campaign.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
              Text(campaign.templateName.isEmpty ? String(localized: "No template") : campaign.templateName).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
            }
            Spacer(minLength: 8)
            if campaign.stats.sent > 0 { Text("\(campaign.stats.sent.formatted()) · \(percent(campaign.stats.opened, max(campaign.stats.delivered, campaign.stats.sent))) opened").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted) }
            Tag(text: CampaignStatusStyle.label(campaign.status), tint: CampaignStatusStyle.tint(campaign.status))
            Text(DateText.short(campaign.finishedAt ?? campaign.startedAt ?? campaign.scheduledAt ?? campaign.updatedAt)).font(.lnCaption).foregroundStyle(Theme.textMuted).frame(minWidth: 28, alignment: .trailing)
          }
          .frame(minHeight: Metrics.rowHeight)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .linearRow()
      }
    }
    .linearList()
    .refreshable { await load() }
    .task { await load() }
    .toolbar {
      ToolbarItem(placement: .primaryAction) { Button { Task { await create() } } label: { Label("New campaign", systemImage: "plus") }.disabled(creating) }
    }
    .sheet(item: $open, onDismiss: { Task { await load() } }) { CampaignDetailSheet(projectId: projectId, campaign: $0) }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let campaigns: [Campaign] }
    do {
      campaigns = (try await session.get("/v1/campaigns", query: ["project": projectId]) as Response).campaigns
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  /// Like the web: a draft named "Untitled campaign", opened to fill in.
  private func create() async {
    struct Input: Encodable, Sendable { let project, name: String }
    struct Output: Decodable, Sendable { let campaign: Campaign }
    creating = true
    defer { creating = false }
    do {
      let output: Output = try await session.send("/v1/campaigns", body: Input(project: projectId, name: "Untitled campaign"))
      open = output.campaign
    } catch { self.error = error.localizedDescription }
  }
}
