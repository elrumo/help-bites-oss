import SwiftUI

/// A project's blog (pages/projects/[id]/blog/index.vue): its posts, the comments
/// readers leave on them, and the settings. Nothing is public until the blog is on
/// and a post is published; a scheduled post goes live on its own.
struct BlogScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace

  var body: some View {
    BlogView(store: BlogStore(projectId: projectId, workspace: workspace))
  }
}

private enum BlogSheet: Identifiable {
  case post(String?), settings
  var id: String {
    switch self {
    case .post(let id): "post-\(id ?? "new")"
    case .settings: "settings"
    }
  }
}

private enum BlogTab: String, CaseIterable, Identifiable {
  case posts, comments
  var id: String { rawValue }
  var label: String { self == .posts ? "Posts" : "Comments" }
}

private struct BlogView: View {
  @State var store: BlogStore
  @State private var sheet: BlogSheet?
  @State private var tab: BlogTab = .posts
  @State private var deleting: BlogPost?
  @State private var deletingComment: BlogComment?
  @State private var replying: BlogComment?
  @State private var replyText = ""
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    content
      .panelScreen("Blog")
      .toolbar { toolbar }
      .sheet(item: $sheet) { route in
        switch route {
        case .post(let id): BlogPostEditor(store: store, postId: id)
        case .settings: BlogSettingsSheet(store: store)
        }
      }
      .feedbackErrorAlert($store.alert)
      .confirmationDialog("Delete this post?", isPresented: binding($deleting), titleVisibility: .visible, presenting: deleting) { post in
        Button("Delete post", role: .destructive) { Task { await delete(post) } }
      } message: { _ in
        Text("Its comments and reactions go with it. A newsletter it went out as stays under Campaigns.")
      }
      .confirmationDialog("Delete this comment?", isPresented: binding($deletingComment), titleVisibility: .visible, presenting: deletingComment) { comment in
        Button("Delete comment", role: .destructive) { Task { await store.deleteComment(comment) } }
      }
      .alert("Reply as the team", isPresented: binding($replying), presenting: replying) { comment in
        TextField("Your reply", text: $replyText)
        Button("Cancel", role: .cancel) { replyText = "" }
        Button("Reply") { Task { await reply(comment) } }
      } message: { comment in
        Text("To \(comment.authorName) on “\(comment.postTitle ?? "")”.")
      }
      .task { await store.load() }
      .onChange(of: scenePhase) { _, phase in
        if phase == .active { Task { await store.refresh() } }
      }
      .onChange(of: tab) { _, tab in
        if tab == .comments { Task { await store.loadComments() } }
      }
      .onChange(of: store.commentFilter) { _, _ in Task { await store.loadComments() } }
  }

  private func binding<Value>(_ value: Binding<Value?>) -> Binding<Bool> {
    Binding(get: { value.wrappedValue != nil }, set: { if !$0 { value.wrappedValue = nil } })
  }

  private func delete(_ post: BlogPost) async {
    do { try await store.delete(post.id) } catch { store.alert = error.localizedDescription }
  }

  private func reply(_ comment: BlogComment) async {
    let text = replyText.trimmingCharacters(in: .whitespacesAndNewlines)
    replyText = ""
    guard !text.isEmpty else { return }
    do { try await store.reply(to: comment, text) } catch { store.alert = error.localizedDescription }
  }

  // MARK: Content

  @ViewBuilder private var content: some View {
    if store.loading && !store.loaded {
      SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
    } else if !store.error.isEmpty, !store.loaded {
      EmptyState(systemImage: "exclamationmark.triangle", title: "Could not load the blog", message: store.error) {
        Button("Try again") { Task { await store.load() } }.buttonStyle(.lnSecondary)
      }
      .frame(maxHeight: .infinity)
    } else {
      VStack(spacing: 0) {
        Picker("View", selection: $tab) {
          ForEach(BlogTab.allCases) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 320)
        .padding(.horizontal, Metrics.gutter).padding(.top, 10)
        if tab == .posts { posts } else { comments }
      }
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .principal) {
      VStack(spacing: 1) {
        ProjectBreadcrumb(projectId: store.projectId, title: "Blog")
        if store.loaded {
          Text("\(store.liveCount) live, \(store.draftCount) \(store.draftCount == 1 ? "draft" : "drafts")")
            .font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
        }
      }
    }
    if store.loaded {
      ToolbarItemGroup(placement: .topBarTrailing) {
        Menu {
          if let url = store.publicURL {
            Link(destination: url) { Label("Open the public blog", systemImage: "safari") }
            ShareLink(item: url) { Label("Share the blog…", systemImage: "square.and.arrow.up") }
          } else {
            Button { sheet = .settings } label: { Label("The blog is off", systemImage: "eye.slash") }
          }
          if let feed = store.feedURL {
            Button { Clipboard.copy(feed.absoluteString) } label: { Label("Copy the RSS feed", systemImage: "dot.radiowaves.up.forward") }
          }
          Divider()
          Button { sheet = .settings } label: { Label("Settings", systemImage: "slider.horizontal.3") }
        } label: { Label("More", systemImage: "ellipsis.circle") }
        Button { sheet = .post(nil) } label: { Label("New post", systemImage: "plus") }
          .keyboardShortcut("n", modifiers: .command)
      }
    }
  }

  // MARK: Posts

  @ViewBuilder private var posts: some View {
    VStack(spacing: 10) {
      SearchField(text: $store.search, prompt: "Search posts or tags").padding(.horizontal, Metrics.gutter)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(BlogFilter.allCases) { filter in
            Pill(label: filter.label, count: store.count(filter), isActive: store.filter == filter) { store.filter = filter }
          }
        }
        .padding(.horizontal, Metrics.gutter)
      }
    }
    .padding(.vertical, 10)
    Rectangle().fill(Theme.border).frame(height: 1)
    if store.posts.isEmpty {
      ScrollView {
        EmptyState(systemImage: "newspaper", title: "No posts yet", message: "Write release notes, tutorials or stories. Published posts appear on your hosted blog, in the embed, in the RSS feed and, if you like, in your subscribers' inboxes.") {
          Button { sheet = .post(nil) } label: { Label("New post", systemImage: "plus") }.buttonStyle(.lnPrimary)
        }
      }
    } else {
      List {
        if !store.settings.enabled {
          offBanner.listRowSeparator(.hidden).listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 4, trailing: 12))
        }
        ForEach(store.shown) { post in row(post) }
        if store.shown.isEmpty {
          Text("No posts match.").font(.lnCaption).foregroundStyle(Theme.textMuted).linearRow().frame(minHeight: 36)
        }
      }
      .linearList()
      .refreshable { await store.refresh() }
    }
  }

  private var offBanner: some View {
    Button { sheet = .settings } label: {
      (Text("Nobody can read the blog yet. Turn on ") + Text("Public blog").bold() + Text(" in Settings: until then posts are only here, even published ones."))
        .font(.lnMeta).foregroundStyle(Theme.textMuted).multilineTextAlignment(.leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
        .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
    }
    .buttonStyle(.plain)
  }

  private func row(_ post: BlogPost) -> some View {
    Button { sheet = .post(post.id) } label: {
      HStack(spacing: 10) {
        Group {
          if let url = URL(string: post.coverImageUrl), !post.coverImageUrl.isEmpty {
            CachedAsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.elevated }
          } else {
            Image(systemName: "newspaper").foregroundStyle(Theme.textDimmed).frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.elevated)
          }
        }
        .frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: Metrics.radiusSmall))
        .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 5) {
          Text(post.title).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(2).multilineTextAlignment(.leading)
          HStack(spacing: 6) {
            BlogChip(text: post.state.label, tint: post.state.tint)
            if post.publishedAt != nil { Text(DateText.day(post.publishedAt)).font(.lnCaption).foregroundStyle(Theme.textMuted) }
            if let tag = post.tags.first { Text("#\(tag)").font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1) }
            if post.newsletter != nil { Image(systemName: "envelope").font(.system(size: 11)).foregroundStyle(Theme.textMuted).accessibilityLabel("Sent as a newsletter") }
          }
        }
        Spacer(minLength: 0)
        VStack(alignment: .trailing, spacing: 3) {
          Label("\(post.commentCount)", systemImage: "bubble.left")
          Label("\(post.reactionTotal)", systemImage: "heart")
        }
        .font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted).labelStyle(.titleAndIcon)
      }
      .padding(.vertical, 8)
      .frame(maxWidth: .infinity, minHeight: Metrics.rowHeight, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .linearRow()
    .contextMenu {
      Button { sheet = .post(post.id) } label: { Label("Open", systemImage: "square.and.pencil") }
      if post.live, let url = URL(string: post.url) {
        Link(destination: url) { Label("View the post", systemImage: "safari") }
      }
      Divider()
      Button(role: .destructive) { deleting = post } label: { Label("Delete", systemImage: "trash") }
    }
    .swipeActions(edge: .trailing) {
      Button(role: .destructive) { deleting = post } label: { Label("Delete", systemImage: "trash") }
    }
  }

  // MARK: Comments

  @ViewBuilder private var comments: some View {
    HStack(spacing: 6) {
      Pill(label: "All", isActive: store.commentFilter.isEmpty) { store.commentFilter = "" }
      Pill(label: "Visible", isActive: store.commentFilter == "visible") { store.commentFilter = "visible" }
      Pill(label: "Hidden", isActive: store.commentFilter == "hidden") { store.commentFilter = "hidden" }
      Spacer(minLength: 0)
      Text("\(store.commentTotal) \(store.commentTotal == 1 ? "comment" : "comments")").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
    }
    .padding(.horizontal, Metrics.gutter).padding(.vertical, 10)
    Rectangle().fill(Theme.border).frame(height: 1)
    if store.comments.isEmpty {
      ScrollView {
        EmptyState(systemImage: "bubble.left", title: "No comments yet", message: "When readers comment on your posts, they show here to answer, hide or remove.")
      }
    } else {
      List {
        ForEach(store.comments) { comment in commentRow(comment) }
        if store.commentsHaveMore {
          Button("Load more") { Task { await store.loadComments(more: true) } }.buttonStyle(.lnGhost).linearRow()
        }
      }
      .linearList()
      .refreshable { await store.loadComments() }
    }
  }

  private func commentRow(_ comment: BlogComment) -> some View {
    let hidden = comment.status == "hidden"
    return VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Avatar(name: comment.authorName, size: 22)
        Text(comment.authorName).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        if comment.authorIsStaff { BlogChip(text: "Team", tint: Theme.accentText) }
        if hidden { BlogChip(text: "Hidden", tint: Theme.warning) }
        Text(FeedbackFormat.timeAgo(comment.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted)
        Spacer(minLength: 0)
        Menu {
          Button { Task { await store.moderate(comment, status: hidden ? "visible" : "hidden") } } label: {
            Label(hidden ? "Show comment" : "Hide comment", systemImage: hidden ? "eye" : "eye.slash")
          }
          Button { replying = comment } label: { Label("Reply", systemImage: "arrowshape.turn.up.left") }
          Divider()
          Button(role: .destructive) { deletingComment = comment } label: { Label("Delete comment", systemImage: "trash") }
        } label: {
          Image(systemName: "ellipsis").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 28, height: 22).contentShape(Rectangle())
        }
        .accessibilityLabel("Comment actions")
      }
      Text(FeedbackFormat.attributed(comment.body)).font(.lnBody).foregroundStyle(Theme.text)
      if let title = comment.postTitle, !title.isEmpty {
        Text("on “\(title)”").font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
      }
    }
    .padding(.vertical, 8)
    .opacity(hidden ? 0.55 : 1)
    .linearRow()
  }
}
