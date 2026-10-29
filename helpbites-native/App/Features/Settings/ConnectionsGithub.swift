import SwiftUI

/// `GET /v1/admin/github`: the GitHub accounts and organisations connected to this workspace.
struct GithubInstallation: Decodable, Identifiable, Equatable, Sendable {
  let id, account, type: String
  let avatar: String?
}

private struct GithubState: Decodable, Sendable {
  let configured: Bool
  let installations: [GithubInstallation]
}

/// GitHub (web: `GithubConnection.vue`): connect accounts, then each project picks its repos.
/// HelpBites only ever reads. Connecting hands off to GitHub in the browser.
struct GithubSection: View {
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.openURL) private var openURL
  @Environment(\.scenePhase) private var scenePhase
  @State private var installations: [GithubInstallation] = []
  @State private var configured = true
  @State private var loading = true
  @State private var starting = false
  @State private var error = ""
  @State private var removing: GithubInstallation?
  @State private var reposFor: Project?

  var body: some View {
    SettingsSection(title: "GitHub", systemImage: "chevron.left.forwardslash.chevron.right", trailing: {
      if configured && session.canManage {
        Button { Task { await connect() } } label: { if starting { ProgressView() } else { Label("Connect GitHub", systemImage: "plus") } }
          .buttonStyle(.lnSecondaryCompact).disabled(starting)
      }
    }) {
      VStack(alignment: .leading, spacing: 12) {
        Text("Connect GitHub accounts and organisations. Each project then picks the repos it uses, so AI error notes and legal documents can read your code. HelpBites only ever reads.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        if loading {
          SkeletonRows(count: 2).padding(-Metrics.gutter)
        } else if !configured {
          DashedEmptyState(systemImage: "chevron.left.forwardslash.chevron.right", title: "GitHub isn't set up on this server", message: "The server owner registers a GitHub App once and sets GITHUB_APP_* (docs/GITHUB.md).") {
            if let guide = URL(string: session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/docs/github") {
              Link(destination: guide) { Label("Read the guide", systemImage: "book") }.font(.lnMeta).foregroundStyle(Theme.accentText)
            }
          }
        } else if installations.isEmpty {
          DashedEmptyState(systemImage: "chevron.left.forwardslash.chevron.right", title: "No GitHub accounts connected", message: "Install the HelpBites app on your account or organisation and choose which repos it can see.")
        } else {
          ForEach(installations) { item in
            HStack(spacing: 12) {
              CachedAsyncImage(url: item.avatar.flatMap(URL.init(string:))) { $0.resizable().scaledToFill() } placeholder: { Theme.elevated }
                .frame(width: 28, height: 28).clipShape(Circle())
              VStack(alignment: .leading, spacing: 2) {
                Text(item.account).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
                Text(item.type == "Organization" ? String(localized: "Organisation") : String(localized: "Personal account")).font(.lnCaption).foregroundStyle(Theme.textMuted)
              }
              Spacer(minLength: 8)
              if session.canManage { IconButton(systemImage: "bolt.slash", label: "Disconnect \(item.account)") { removing = item } }
            }
            .padding(.horizontal, 14).padding(.vertical, 8).frame(minHeight: 48)
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
          }
          Text("To change which repos are visible, or to revoke access, use the app's settings on GitHub.").font(.lnCaption).foregroundStyle(Theme.textMuted)

          if !workspace.projects.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
              SectionLabel("Project repos")
              Card {
                ForEach(workspace.projects) { project in
                  CardRow(divider: project.id != workspace.projects.last?.id) {
                    Button { reposFor = project } label: {
                      HStack(spacing: 10) {
                        ProjectTile(id: project.id, name: project.name, accent: project.theme.accent, icon: project.iconUrl, size: 20)
                        Text(project.name).font(.lnRow).foregroundStyle(Theme.text)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
                      }
                      .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                  }
                }
              }
            }
          }
        }
        ErrorText(message: error)
      }
    }
    .task { await load() }
    // Back from GitHub's install page in the browser: pick up the new connection.
    .onChange(of: scenePhase) { _, phase in if phase == .active, starting || installations.isEmpty { Task { await load() } } }
    .confirmationDialog("Disconnect \(removing?.account ?? "")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { item in
      Button("Disconnect", role: .destructive) { Task { await remove(item) } }
    }
    .sheet(item: $reposFor) { project in ProjectReposSheet(project: project) }
  }

  private func load() async {
    do {
      let state: GithubState = try await session.get("/v1/admin/github")
      configured = state.configured; installations = state.installations; error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
    starting = false
  }

  private func connect() async {
    struct Output: Decodable, Sendable { let url: String }
    starting = true; error = ""
    do {
      let output: Output = try await session.send("/v1/admin/github/install")
      if let url = URL(string: output.url) { openURL(url) }
    } catch { self.error = error.localizedDescription; starting = false }
  }

  private func remove(_ item: GithubInstallation) async {
    struct Output: Decodable, Sendable { let installations: [GithubInstallation] }
    error = ""
    do {
      let output: Output = try await session.send("/v1/admin/github/installations/\(item.id)", method: "DELETE")
      installations = output.installations
    } catch { self.error = error.localizedDescription }
  }
}

/// A project's GitHub repos (web: `ProjectRepos.vue`): up to 10, each visible to one of the workspace's
/// connections. Also usable on its own from a project's settings.
struct ProjectReposSheet: View {
  let project: Project
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      ScrollView { ProjectReposSection(projectId: project.id).padding(20) }
        .panelScreen("\(project.name) repos")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .presentationDetents([.medium, .large])
  }
}

struct ProjectReposSection: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var connections: [GithubInstallation] = []
  @State private var configured = true
  @State private var repos: [Repo] = []
  @State private var available: [AvailableRepo] = []
  @State private var connection = ""
  @State private var loading = true
  @State private var listing = false
  @State private var saving = false
  @State private var picking = false
  @State private var error = ""

  private struct Repo: Decodable, Identifiable, Equatable, Sendable { let installationId: String; let id: Int; let fullName, defaultBranch: String }
  private struct RepoRef: Encodable, Sendable { let installationId: String; let id: Int }

  private var choices: [AvailableRepo] { available.filter { item in !repos.contains { $0.id == item.id } } }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if loading {
        SkeletonRows(count: 2).padding(-Metrics.gutter)
      } else if connections.isEmpty {
        Text(configured ? String(localized: "Connect a GitHub account first (Settings → Connections).") : String(localized: "GitHub isn't set up on this server.")).font(.lnMeta).foregroundStyle(Theme.textMuted)
      } else {
        if repos.isEmpty {
          Text("No repos yet.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        } else {
          Card {
            ForEach(repos) { repo in
              CardRow(divider: repo.id != repos.last?.id) {
                HStack(spacing: 10) {
                  Image(systemName: "arrow.triangle.branch").font(.system(size: 13)).foregroundStyle(Theme.textMuted)
                  Text(repo.fullName).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
                  Spacer(minLength: 8)
                  Text(repo.defaultBranch).font(.lnCaption).foregroundStyle(Theme.textMuted)
                  if session.canManage { IconButton(systemImage: "xmark", label: "Remove \(repo.fullName)") { Task { await save(repos.filter { $0.id != repo.id }.map { RepoRef(installationId: $0.installationId, id: $0.id) }) } }.disabled(saving) }
                }
              }
            }
          }
        }
        if session.canManage && repos.count < 10 {
          HStack(spacing: 8) {
            if connections.count > 1 {
              MenuPicker(selection: Binding(get: { connection }, set: { connection = $0; Task { await list() } }), options: connections.map { PickerOption(value: $0.id, label: $0.account) }, title: "GitHub account")
                .frame(maxWidth: 180)
            }
            Button { picking = true } label: {
              HStack { if listing { ProgressView().controlSize(.small) }; Label("Add a repo", systemImage: "plus") }
            }
            .disabled(saving || listing || choices.isEmpty)
          }
        }
      }
      ErrorText(message: error)
    }
    .task { await load() }
    .sheet(isPresented: $picking) {
      GithubRepoPickerSheet(choices: choices) { item in
        Task { await save((repos.map { RepoRef(installationId: $0.installationId, id: $0.id) }) + [RepoRef(installationId: connection, id: item.id)]) }
      }
    }
  }

  private func load() async {
    do {
      async let github: GithubState = session.get("/v1/admin/github")
      struct Mine: Decodable, Sendable { let repos: [Repo] }
      async let mine: Mine = session.get("/v1/admin/projects/\(projectId)/repos")
      let (state, saved) = try await (github, mine)
      configured = state.configured; connections = state.installations; repos = saved.repos
      connection = connections.first?.id ?? ""
      if !connection.isEmpty { await list() }
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  private func list() async {
    struct Output: Decodable, Sendable { let repos: [AvailableRepo] }
    listing = true; error = ""
    defer { listing = false }
    do { available = (try await session.get("/v1/admin/github/installations/\(connection)/repos") as Output).repos }
    catch { available = []; self.error = error.localizedDescription }
  }

  private func save(_ next: [RepoRef]) async {
    struct Input: Encodable, Sendable { let repos: [RepoRef] }
    struct Output: Decodable, Sendable { let repos: [Repo] }
    saving = true; error = ""
    defer { saving = false }
    do { repos = (try await session.send("/v1/admin/projects/\(projectId)/repos", method: "PUT", body: Input(repos: next)) as Output).repos }
    catch { self.error = error.localizedDescription }
  }
}

/// One repo a connection can read (`GET /v1/admin/github/installations/:id/repos`).
private struct AvailableRepo: Decodable, Identifiable, Sendable {
  let id: Int
  let fullName: String
  let `private`: Bool
  let defaultBranch: String
}

/// "Add a repo": everything the connection can read, searchable by owner or name. The caller decides what picking means.
private struct GithubRepoPickerSheet: View {
  let choices: [AvailableRepo]
  let pick: (AvailableRepo) -> Void
  @State private var query = ""
  @Environment(\.dismiss) private var dismiss

  private var matches: [AvailableRepo] {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return needle.isEmpty ? choices : choices.filter { $0.fullName.localizedStandardContains(needle) }
  }

  var body: some View {
    NavigationStack {
      Group {
        if matches.isEmpty {
          EmptyState(systemImage: "magnifyingglass", title: "Nothing matches")
            .frame(maxHeight: .infinity, alignment: .top)
        } else {
          List(matches) { item in
            Button {
              pick(item)
              dismiss()
            } label: {
              HStack(spacing: 8) {
                Image(systemName: item.private ? "lock" : "arrow.triangle.branch").font(.system(size: 13)).foregroundStyle(Theme.textMuted).frame(width: 18)
                Text(item.fullName).foregroundStyle(Theme.text).lineLimit(1)
                Spacer(minLength: 8)
                Text(item.defaultBranch).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
              }
              .font(.lnMeta)
              .frame(minHeight: 36)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .linearRow()
          }
          .linearList()
        }
      }
      .searchable(text: $query, prompt: "Search repos")
      .panelScreen("Add a repo")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
    }
    .presentationDetents([.medium, .large])
  }
}
