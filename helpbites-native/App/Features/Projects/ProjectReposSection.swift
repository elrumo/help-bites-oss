import SwiftUI

/// The GitHub repos a project reads (web: settings/ProjectRepos.vue). AI error
/// notes and legal documents read them; HelpBites never writes to them.
struct ProjectReposSection: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @State private var connections: [Connection] = []
  @State private var configured = true
  @State private var repos: [Repo] = []
  @State private var available: [Available] = []
  @State private var connection = ""
  @State private var loading = true
  @State private var listing = false
  @State private var saving = false
  @State private var error = ""

  private struct Connection: Decodable, Identifiable, Sendable { let id, account: String }
  private struct Repo: Decodable, Identifiable, Sendable { let installationId: String; let id: Int; let fullName, defaultBranch: String }
  private struct Available: Decodable, Identifiable, Sendable { let id: Int; let fullName, defaultBranch: String; let `private`: Bool }

  private var choices: [Available] { available.filter { pick in !repos.contains { $0.id == pick.id } } }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ErrorText(message: error)
      if loading {
        SkeletonRows(count: 2).padding(-Metrics.gutter)
      } else if connections.isEmpty {
        Text(configured ? "Connect a GitHub account first." : "GitHub isn't set up on this server.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        if configured {
          Button { workspace.go(.connections) } label: { Label("Connect GitHub", systemImage: "link") }.buttonStyle(.lnSecondaryCompact)
        }
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
                  IconButton(systemImage: "xmark", label: "Remove \(repo.fullName)") { Task { await save(repos.filter { $0.id != repo.id }) } }
                    .disabled(saving)
                }
              }
            }
          }
        }
        if repos.count < 10 { adder }
      }
    }
    .task { await load() }
  }

  private var adder: some View {
    HStack(spacing: 8) {
      if connections.count > 1 {
        Picker("GitHub account", selection: $connection) { ForEach(connections) { Text($0.account).tag($0.id) } }
          .labelsHidden().tint(Theme.text)
          .onChange(of: connection) { Task { await listRepos() } }
      }
      Menu {
        ForEach(choices) { repo in
          Button("\(repo.fullName)\(repo.private ? " (private)" : "")") { Task { await save(repos + [Repo(installationId: connection, id: repo.id, fullName: repo.fullName, defaultBranch: repo.defaultBranch)]) } }
        }
      } label: {
        if listing { ProgressView().controlSize(.small) } else { Label("Add a repo", systemImage: "plus") }
      }
      .buttonStyle(.lnSecondaryCompact)
      .disabled(saving || listing || choices.isEmpty)
    }
  }

  private func load() async {
    struct GitHub: Decodable, Sendable { let configured: Bool; let installations: [Connection] }
    struct Mine: Decodable, Sendable { let repos: [Repo] }
    defer { loading = false }
    do {
      async let github: GitHub = session.get("/v1/admin/github")
      async let mine: Mine = session.get("/v1/admin/projects/\(projectId)/repos")
      let (installed, current) = try await (github, mine)
      configured = installed.configured
      connections = installed.installations
      repos = current.repos
      connection = connections.first?.id ?? ""
      if !connection.isEmpty { await listRepos() }
    } catch { self.error = error.localizedDescription }
  }

  private func listRepos() async {
    struct Response: Decodable, Sendable { let repos: [Available] }
    guard !connection.isEmpty else { return }
    listing = true; error = ""
    defer { listing = false }
    do {
      let response: Response = try await session.get("/v1/admin/github/installations/\(connection)/repos")
      available = response.repos
    } catch { available = []; self.error = error.localizedDescription }
  }

  /// `PUT /projects/:id/repos` replaces the list.
  private func save(_ next: [Repo]) async {
    struct Item: Encodable, Sendable { let installationId: String; let id: Int }
    struct Input: Encodable, Sendable { let repos: [Item] }
    struct Output: Decodable, Sendable { let repos: [Repo] }
    saving = true; error = ""
    defer { saving = false }
    do {
      let output: Output = try await session.send("/v1/admin/projects/\(projectId)/repos", method: "PUT", body: Input(repos: next.map { Item(installationId: $0.installationId, id: $0.id) }))
      repos = output.repos
    } catch { self.error = error.localizedDescription }
  }
}
