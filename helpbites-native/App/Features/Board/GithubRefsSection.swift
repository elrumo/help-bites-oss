import SwiftUI

/// A commit or pull request that mentions an item as `#12` (GET /v1/admin/github-refs, docs/GITHUB.md).
struct GithubRefLink: Decodable, Equatable, Identifiable, Sendable {
  let id, kind, ref, repo, title, url: String
  let closes: Bool
  let at: String?

  var isPullRequest: Bool { kind == "pull_request" }
  /// "#34" for a pull request, the short sha for a commit.
  var label: String { isPullRequest ? "#\(ref)" : String(ref.prefix(7)) }
}

/// The commits pushed to the default branch and the pull requests merged into it that mention a board
/// item or a feedback post (components/GithubRefs.vue). Invisible until GitHub has told HelpBites about
/// one, so an item with none shows nothing.
struct GithubRefsSection: View {
  let projectId: String
  /// "board" or "feedback".
  let kind: String
  let targetId: String
  @Environment(Workspace.self) private var workspace
  @Environment(\.openURL) private var openURL
  @State private var refs: [GithubRefLink] = []

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !refs.isEmpty {
        HStack(spacing: 6) {
          Text("Commits and pull requests").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text("\(refs.count)").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted)
        }
        Card {
          ForEach(Array(refs.enumerated()), id: \.element.id) { index, link in
            CardRow(divider: index < refs.count - 1) { row(link) }
          }
        }
      }
    }
    .task(id: "\(projectId)|\(kind)|\(targetId)") { await load() }
  }

  private func row(_ link: GithubRefLink) -> some View {
    Button {
      if let url = URL(string: link.url), !link.url.isEmpty { openURL(url) }
    } label: {
      HStack(spacing: 8) {
        Image(systemName: link.isPullRequest ? "arrow.triangle.pull" : "smallcircle.filled.circle").font(.system(size: 12)).foregroundStyle(Theme.textMuted).frame(width: 16)
          .accessibilityLabel(link.isPullRequest ? "Pull request" : "Commit")
        Text(link.label).monospacedDigit().foregroundStyle(Theme.textMuted)
        Text(link.title).foregroundStyle(Theme.text).lineLimit(1)
        Spacer(minLength: 4)
        if link.closes { ChangelogChip(text: String(localized: "closes"), tint: Theme.success) }
        Text(link.repo).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
      }
      .font(.lnMeta)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(link.url.isEmpty)
  }

  private func load() async {
    guard !targetId.isEmpty, !projectId.isEmpty else { refs = []; return }
    struct Response: Decodable, Sendable { let refs: [GithubRefLink] }
    do {
      let found: Response = try await workspace.session.get("/v1/admin/github-refs", query: ["project": projectId, "kind": kind, "id": targetId])
      refs = found.refs
    } catch {
      // Nothing to show is the same as nothing linked.
      if case APIError.cancelled = error { return }
      refs = []
    }
  }
}
