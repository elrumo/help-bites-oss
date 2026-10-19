import SwiftUI

/// A project's sections: the web sidebar's nested items as a page, the step
/// between Projects and a section where there's no sidebar to list them (iPhone).
struct ProjectScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace

  var body: some View {
    let project = workspace.project(projectId)
    List {
      ForEach(ProjectSection.allCases) { section in
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
    .linearList()
    .panelScreen(project?.name ?? "Project")
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
}

/// `GET /v1/admin/projects/:id/overview`. `section` is the web's section path,
/// sometimes with a query (`email?view=log`).
struct ProjectOverview: Decodable, Sendable {
  struct Stat: Decodable, Identifiable, Sendable { let key, label: String; let value: Int; let section: String; var id: String { key } }
  struct Health: Decodable, Identifiable, Sendable { let key, label, state, detail, section: String; var id: String { key } }
  struct Attention: Decodable, Identifiable, Sendable { let key, label: String; let count: Int; let section: String; var id: String { key } }
  struct Activity: Decodable, Identifiable, Sendable { let id, title, detail, at, section: String; let conversationId: String? }
  let stats: [Stat]
  let health: [Health]
  let attention: [Attention]
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
                  Text(stat.label).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
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
              Card {
                ForEach(overview.attention) { item in
                  CardRow(divider: item.id != overview.attention.last?.id) {
                    Button { open(item.section) } label: {
                      HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.circle").foregroundStyle(Theme.warning)
                        Text(item.label).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
                        Spacer(minLength: 8)
                        Text("\(item.count)").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
                      }
                      .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                  }
                }
              }
            }
          }

          VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Status")
            Card {
              ForEach(overview.health) { row in
                CardRow(divider: row.id != overview.health.last?.id) {
                  Button { open(row.section) } label: {
                    HStack(spacing: 10) {
                      Text(row.label).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                      Spacer(minLength: 8)
                      Tag(text: row.detail, tint: row.state == "ok" ? Theme.success : row.state == "warn" ? Theme.warning : nil)
                    }
                    .contentShape(Rectangle())
                  }
                  .buttonStyle(.plain)
                }
              }
            }
          }

          VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Latest activity")
            if overview.activity.isEmpty {
              EmptyState(systemImage: "clock", title: "Nothing yet", message: "Conversations, feedback and finished board items will show up here.")
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

  /// The web's `settings` section lives on native Dev; `?view=` is dropped.
  private func section(_ path: String) -> ProjectSection {
    ProjectSection(rawValue: String(path.split(separator: "?").first ?? "")) ?? .dev
  }

  private func open(_ path: String) { workspace.go(.project(projectId, section(path))) }

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
