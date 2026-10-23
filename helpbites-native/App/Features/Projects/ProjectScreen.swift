import SwiftUI

/// A project's sections: the web sidebar's nested items as a page, the step
/// between Projects and a section where there's no sidebar to list them (iPhone).
/// Grouped under the sidebar's headings, without the sections the project hid.
struct ProjectScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace

  var body: some View {
    let project = workspace.project(projectId)
    let layout = workspace.layout(projectId)
    List {
      row(.overview)
      ForEach(layout.groups) { entry in
        Section {
          ForEach(entry.sections) { section in row(section) }
        } header: {
          Text(entry.group.label).font(.lnCaptionMedium).foregroundStyle(Theme.textMuted).textCase(nil)
        }
      }
      row(.settings)
    }
    .linearList()
    .panelScreen(project?.name ?? String(localized: "Project"))
    .toolbar {
      if let project {
        ToolbarItem(placement: .principal) {
          HStack(spacing: 8) {
            ProjectTile(id: project.id, name: project.name, accent: project.theme.accent, icon: project.iconUrl)
            Text(project.name).font(.lnHeading).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          }
        }
      }
    }
  }

  private func row(_ section: ProjectSection) -> some View {
    NavigationLink(value: AppRoute.project(projectId, section)) {
      Label {
        Text(section.label).font(.lnRow).foregroundStyle(Theme.text)
      } icon: {
        Image(systemName: section.systemImage).font(.system(size: 14)).foregroundStyle(Theme.textMuted)
      }
      .frame(minHeight: Metrics.rowHeight)
    }
    .linearRow()
  }
}

/// `GET /v1/admin/projects/:id/overview`. `section` is the web's section path,
/// sometimes with a query (`email?view=log`).
struct ProjectOverview: Decodable, Sendable {
  struct Stat: Decodable, Identifiable, Sendable { let key, label: String; let value: Int; let section: String; var id: String { key } }
  struct Activity: Decodable, Identifiable, Sendable { let id, title, detail, at, section: String; let conversationId: String? }
  let stats: [Stat]
  let setup: ProjectSetup
  let attention: [AttentionItem]
  let activity: [Activity]
}

/// A project at a glance (web: projects/[id]/overview.vue): headline numbers,
/// what needs attention, setup status and the latest activity.
struct ProjectOverviewScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @State private var overview: ProjectOverview?
  @State private var error = ""

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        ErrorText(message: error)
        if let overview {
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
            ForEach(overview.stats) { stat in
              Button { open(stat.section) } label: {
                VStack(alignment: .leading, spacing: 4) {
                  Text(LocalizedStringKey(stat.label)).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
                  Text(EmailStatusText.compactCount(stat.value)).font(.system(size: 22, weight: .semibold)).foregroundStyle(Theme.textHighlighted).monospacedDigit()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
                .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
              }
              .buttonStyle(.plain)
            }
          }

          VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Needs attention")
            if overview.attention.isEmpty {
              Label("All clear. Nothing needs you right now.", systemImage: "checkmark.circle").font(.lnMeta).foregroundStyle(Theme.textMuted)
            } else {
              AttentionList(items: overview.attention)
            }
          }

          VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Text("Setup").font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
              Text("\(overview.setup.done) of \(overview.setup.total) done").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textDimmed)
            }
            SetupChecklist(projectId: projectId, setup: overview.setup)
          }

          VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Latest activity")
            if overview.activity.isEmpty {
              EmptyState(systemImage: "clock", title: "Nothing yet", message: "Conversations, feedback and finished planning items will show up here.")
            } else {
              Card {
                ForEach(overview.activity) { item in
                  CardRow(divider: item.id != overview.activity.last?.id) {
                    Button { if let id = item.conversationId, !id.isEmpty { openConversation(id) } else { open(item.section) } } label: {
                      HStack(spacing: 10) {
                        Image(systemName: section(item.section).systemImage).font(.system(size: 13)).foregroundStyle(Theme.textMuted).frame(width: 18)
                        VStack(alignment: .leading, spacing: 2) {
                          Text(item.title).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
                          if !item.detail.isEmpty { Text(item.detail).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1) }
                        }
                        Spacer(minLength: 8)
                        Text(DateText.short(item.at)).font(.lnMeta).foregroundStyle(Theme.textDimmed)
                      }
                      .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                  }
                }
              }
            }
          }
        } else if error.isEmpty {
          SkeletonRows(count: 6)
        }
      }
      .frame(maxWidth: 720, alignment: .leading)
      .padding(24)
      .frame(maxWidth: .infinity)
    }
    .refreshable { await load() }
    .projectScreen(projectId, "Overview")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button { Task { await load() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
      }
    }
    .task { await load() }
  }

  /// `#anchor` is dropped; an unknown section opens Developer & MCP.
  private func section(_ path: String) -> ProjectSection {
    ProjectSection.fromWeb(path) ?? .dev
  }

  /// `?view=` opens an Email tab.
  private func open(_ path: String) { workspace.go(webPath: path, project: projectId) }

  /// The web links to `/inbox?c=<conversation>`.
  private func openConversation(_ id: String) {
    workspace.inbox.projectFilter = projectId
    workspace.go(.inbox)
    Task { await workspace.inbox.select(id) }
  }

  private func load() async {
    do {
      overview = try await session.get("/v1/admin/projects/\(projectId)/overview")
      error = ""
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
  }
}

/// A project's setup, row by row (web: SetupChecklist.vue): an icon for where it stands, what it is, a
/// line on why, and a tap to the page that fixes it. Optional rows still to do say so.
struct SetupChecklist: View {
  let projectId: String
  let setup: ProjectSetup
  @Environment(Workspace.self) private var workspace

  var body: some View {
    Card {
      ForEach(setup.items) { item in
        CardRow(divider: item.id != setup.items.last?.id) {
          Button { workspace.go(webPath: item.section, project: projectId) } label: { row(item) }.buttonStyle(.plain)
        }
      }
    }
  }

  private func row(_ item: SetupItem) -> some View {
    HStack(spacing: 10) {
      Image(systemName: icon(item.state)).font(.system(size: 14)).foregroundStyle(tint(item.state)).frame(width: 18)
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 8) {
          Text(item.title).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          if item.isOptional && item.state != "done" { Text("Optional").font(.lnCaption).foregroundStyle(Theme.textDimmed) }
        }
        Text(item.text).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(2).multilineTextAlignment(.leading)
      }
      Spacer(minLength: 8)
      Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
    }
    .contentShape(Rectangle())
  }

  /// done: a green check, todo: a grey circle, attention: a warning triangle.
  private func icon(_ state: String) -> String {
    switch state {
    case "done": "checkmark.circle"
    case "attention": "exclamationmark.triangle"
    default: "circle"
    }
  }

  private func tint(_ state: String) -> Color {
    switch state {
    case "done": Theme.success
    case "attention": Theme.warning
    default: Theme.textDimmed
    }
  }
}
