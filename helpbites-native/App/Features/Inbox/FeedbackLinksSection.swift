import SwiftUI

/// The feedback posts a conversation is behind (web: components/FeedbackLinks.vue): open one,
/// unlink it, file a new one as the customer, or add one that is already on the board. The
/// customer follows what is linked, so they hear when it ships. The list comes with the
/// conversation's context (`InboxStore.context`); changes go through POST …/feedback-posts.
/// A contact with no user id cannot follow or author a post, so only linking is offered.
struct FeedbackLinksSection: View {
  let projectId: String
  let conversationId: String
  /// What a new post starts with: the ticket's subject and the customer's latest words.
  let title: String
  let description: String
  @Environment(Workspace.self) private var workspace
  @State private var busy = ""
  @State private var error = ""
  @State private var composing = false
  @State private var newTitle = ""
  @State private var newBody = ""
  @State private var creating = false
  @State private var picking = false

  private var context: ConversationHubContext? {
    workspace.inbox.selectedId == conversationId ? workspace.inbox.context : nil
  }

  private var canAuthor: Bool { context?.contact.externalId.isEmpty == false }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      if let context {
        ForEach(context.feedbackPosts) { post in row(post) }
        if context.feedbackPosts.isEmpty && !composing {
          Text("No post linked yet.").font(.lnMeta).foregroundStyle(Theme.textMuted).padding(.horizontal, 8).padding(.vertical, 6)
        }
        if composing {
          compose(context)
        } else {
          HStack(spacing: 6) {
            Button { start() } label: { Label("File a post", systemImage: "plus") }
              .buttonStyle(.lnSecondaryCompact)
              .disabled(!canAuthor)
            Button { picking = true } label: { Label("Add existing", systemImage: "lightbulb") }
              .buttonStyle(.lnSecondaryCompact)
          }
          .padding(.horizontal, 8)
          .padding(.top, 4)
        }
        if !canAuthor {
          Text("This contact has no user id, so they can't follow a post or file one. You can still link an existing post.")
            .font(.lnCaption)
            .foregroundStyle(Theme.textMuted)
            .padding(.horizontal, 8)
            .padding(.top, 4)
        }
        ErrorText(message: error).padding(.horizontal, 8).padding(.top, 4)
      } else {
        RoundedRectangle(cornerRadius: Metrics.radiusSmall).fill(Theme.elevated).frame(height: 28).padding(.horizontal, 8)
      }
    }
    .sheet(isPresented: $picking) {
      FeedbackPostPicker(projectId: projectId, exclude: Set(context?.feedbackPosts.map(\.id) ?? [])) { post in Task { await link(post.id, true) } }
        .environment(workspace)
    }
  }

  private func row(_ post: HubFeedbackPost) -> some View {
    HStack(spacing: 8) {
      HStack(spacing: 8) {
        Circle().fill(Self.tint(post.statusCategory)).frame(width: 7, height: 7).accessibilityLabel(post.statusLabel.isEmpty ? post.status : post.statusLabel)
        if let number = post.number { Text("#\(number)").monospacedDigit().foregroundStyle(Theme.textMuted) }
        Text(post.title).foregroundStyle(Theme.text).lineLimit(1)
        Image(systemName: post.following ? "bell.badge" : "bell.slash")
          .font(.system(size: 10))
          .foregroundStyle(post.following ? Theme.accentText : Theme.textDimmed)
          .accessibilityLabel(post.following ? "Follows this post" : "Not following")
        Spacer(minLength: 0)
      }
      .font(.lnMeta)
      .contentShape(Rectangle())
      Button { Task { await link(post.id, false) } } label: {
        Group {
          if busy == post.id { ProgressView().controlSize(.mini) } else { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.textDimmed) }
        }
        .frame(width: 24, height: 24)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(!busy.isEmpty)
      .accessibilityLabel("Unlink \(post.number.map { "#\($0) " } ?? "")\(post.title)")
    }
    .padding(.horizontal, 8)
    .frame(height: 32)
  }

  private func compose(_ context: ConversationHubContext) -> some View {
    let who = context.contact.name.isEmpty ? (context.contact.email.isEmpty ? context.contact.externalId : context.contact.email) : context.contact.name
    return VStack(alignment: .leading, spacing: 8) {
      Text("Creates a post written by \(who). They follow it and hear when it changes.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      TextField("Title", text: $newTitle).textFieldStyle(.linear)
      LinearTextEditor(text: $newBody, placeholder: String(localized: "Details"), minHeight: 80)
      HStack(spacing: 6) {
        Button { Task { await create() } } label: {
          HStack(spacing: 6) {
            if creating { ProgressView().controlSize(.mini) }
            Text("File and follow")
          }
        }
        .buttonStyle(.lnPrimaryCompact)
        .disabled(creating || newTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        Button("Cancel") { composing = false }.buttonStyle(.lnGhost)
      }
    }
    .padding(.horizontal, 8)
    .padding(.top, 4)
  }

  private static func tint(_ category: String) -> Color {
    switch category {
    case "planned": Theme.info
    case "active": Theme.accent
    case "done": Theme.success
    default: Theme.textDimmed
    }
  }

  /// Starts from the ticket's subject and the customer's own words; both stay editable.
  private func start() {
    let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
    let subject = title.trimmingCharacters(in: .whitespacesAndNewlines)
    newTitle = String(subject.isEmpty ? (FeedbackFormat.plainText(text, limit: 80).components(separatedBy: "\n").first ?? "") : subject)
    newBody = text
    error = ""
    composing = true
  }

  private func link(_ postId: String, _ on: Bool) async {
    busy = postId
    defer { busy = "" }
    error = ""
    do {
      try await workspace.inbox.linkFeedbackPost(postId, linked: on)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func create() async {
    creating = true
    defer { creating = false }
    error = ""
    do {
      try await workspace.inbox.fileFeedbackPost(title: String(newTitle.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)), body: newBody.trimmingCharacters(in: .whitespacesAndNewlines))
      composing = false
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// Posts on the project's feedback board, searchable by title or `#12`, for "Add existing".
private struct FeedbackPostPicker: View {
  let projectId: String
  let exclude: Set<String>
  let pick: (HubPostHit) -> Void
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  @State private var posts: [HubPostHit] = []
  @State private var loaded = false
  @State private var error = ""

  private struct Page: Decodable, Sendable { let posts: [HubPostHit] }

  private var candidates: [HubPostHit] { posts.filter { !exclude.contains($0.id) } }

  var body: some View {
    NavigationStack {
      Group {
        if !error.isEmpty {
          ErrorText(message: error).padding(20).frame(maxHeight: .infinity, alignment: .top)
        } else if !loaded {
          SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
        } else if candidates.isEmpty {
          EmptyState(systemImage: "lightbulb", title: "Nothing matches", message: query.isEmpty ? "Every post on the board is linked here already, or the board is empty." : nil)
            .frame(maxHeight: .infinity, alignment: .top)
        } else {
          List(candidates) { post in
            Button {
              pick(post)
              dismiss()
            } label: {
              HStack(spacing: 8) {
                if let number = post.number { Text("#\(number)").monospacedDigit().foregroundStyle(Theme.textMuted) }
                Text(post.title).foregroundStyle(Theme.text).lineLimit(1)
                Spacer(minLength: 0)
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
      .searchable(text: $query, prompt: "Search posts by title")
      .panelScreen("Add an existing post")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
      .task(id: query) {
        if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
        if Task.isCancelled { return }
        await load()
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func load() async {
    var params = ["project": projectId, "includeHidden": "1", "limit": "30", "sort": "new"]
    let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if !term.isEmpty { params["q"] = term.hasPrefix("#") ? String(term.dropFirst()) : term }
    do {
      let page: Page = try await workspace.session.get("/v1/feedback", query: params)
      posts = page.posts
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loaded = true
  }
}
