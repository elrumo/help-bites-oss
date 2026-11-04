import SwiftUI

/// A project's changelog (pages/projects/[id]/changelog.vue): entries, what shipped in
/// your own words, grouped into releases and linked to the posts, board items, tickets
/// and errors they come from. Nothing is public until the entry (and its release) is.
struct ChangelogScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace

  var body: some View {
    ChangelogView(store: ChangelogStore(projectId: projectId, workspace: workspace))
  }
}

private enum ChangelogSheet: Identifiable {
  case entry(String?), release(String?), settings, style, generate, subscribers, importer
  var id: String {
    switch self {
    case .entry(let id): "entry-\(id ?? "new")"
    case .release(let id): "release-\(id ?? "new")"
    case .settings: "settings"
    case .style: "style"
    case .generate: "generate"
    case .subscribers: "subscribers"
    case .importer: "import"
    }
  }
}

private enum ChangelogBulk: Identifiable {
  case approve, merge, delete
  var id: Self { self }
}

private struct ChangelogView: View {
  @State var store: ChangelogStore
  @State private var sheet: ChangelogSheet?
  @State private var deleting: ChangelogEntry?
  @State private var publishing: ChangelogRelease?
  @State private var bulk: ChangelogBulk?
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    content
      .panelScreen("Changelog")
      .toolbar { toolbar }
      .sheet(item: $sheet) { route in
        switch route {
        case .entry(let id): ChangelogEntryEditor(store: store, entryId: id)
        case .release(let id): ChangelogReleaseSheet(store: store, releaseId: id)
        case .settings: ChangelogSettingsSheet(store: store)
        case .style: ChangelogStyleSheet(store: store)
        case .generate: ChangelogGenerateSheet(store: store)
        case .subscribers: ChangelogSubscribersSheet(store: store)
        case .importer: ChangelogImportSheet(store: store)
        }
      }
      .feedbackErrorAlert($store.alert)
      .confirmationDialog("Delete this entry?", isPresented: binding($deleting), titleVisibility: .visible, presenting: deleting) { entry in
        Button("Delete entry", role: .destructive) { Task { await delete(entry) } }
      } message: { _ in
        Text("Its links go with it; the posts, planning items and conversations stay.")
      }
      .confirmationDialog("Publish this release?", isPresented: binding($publishing), titleVisibility: .visible, presenting: publishing) { release in
        Button("Publish \(release.version)") { Task { await store.publishRelease(release) } }
      } message: { _ in
        Text("It and every draft entry in it go public.")
      }
      .confirmationDialog(bulkTitle, isPresented: binding($bulk), titleVisibility: .visible, presenting: bulk) { action in
        switch action {
        case .approve: Button("Approve and publish") { Task { await store.approveSelected() } }
        case .merge: Button("Merge") { Task { await merge() } }
        case .delete: Button("Delete \(store.selected.count) entries", role: .destructive) { Task { await store.deleteSelected() } }
        }
      } message: { action in
        Text(bulkMessage(action))
      }
      .task { await store.load() }
      .onDisappear { store.stopWatching() }
      // No live sync between operators yet: coming back to the app refetches.
      .onChange(of: scenePhase) { _, phase in
        if phase == .active { Task { await store.refresh() } }
      }
      .onChange(of: store.filter) { _, filter in
        if filter == .archived { Task { await store.loadArchived() } }
      }
  }

  private func binding<Value>(_ value: Binding<Value?>) -> Binding<Bool> {
    Binding(get: { value.wrappedValue != nil }, set: { if !$0 { value.wrappedValue = nil } })
  }

  private var bulkTitle: String {
    switch bulk {
    case .approve: String(localized: "Publish \(store.selectedEntries.filter { $0.status == .draft }.count) drafts?")
    case .merge: String(localized: "Merge into one draft?")
    case .delete: String(localized: "Delete \(store.selected.count) entries?")
    case nil: ""
    }
  }

  private func bulkMessage(_ action: ChangelogBulk) -> String {
    switch action {
    case .approve: String(localized: "They go public, unless their release is still a draft.")
    case .merge: String(localized: "The originals are archived. Published ones go private until you publish the merged draft.")
    case .delete: String(localized: "This cannot be undone. The linked items stay.")
    }
  }

  private func delete(_ entry: ChangelogEntry) async {
    do { try await store.delete(entry.id) } catch { store.alert = error.localizedDescription }
  }

  private func merge() async {
    if let entry = await store.mergeSelected() { sheet = .entry(entry.id) }
  }

  // MARK: Content

  @ViewBuilder private var content: some View {
    if store.loading && !store.loaded {
      SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
    } else if !store.error.isEmpty, !store.loaded {
      EmptyState(systemImage: "exclamationmark.triangle", title: "Could not load the changelog", message: store.error) {
        Button("Try again") { Task { await store.load() } }.buttonStyle(.lnSecondary)
      }
      .frame(maxHeight: .infinity)
    } else {
      VStack(spacing: 0) {
        filterBar
        Rectangle().fill(Theme.border).frame(height: 1)
        list
      }
      .safeAreaInset(edge: .bottom, spacing: 0) { if store.selecting { selectionBar } }
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .principal) {
      VStack(spacing: 1) {
        ProjectBreadcrumb(projectId: store.projectId, title: "Changelog")
        if store.loaded {
          let drafts = store.draftCount == 1 ? String(localized: "1 draft") : String(localized: "\(store.draftCount) drafts")
          Text("\(store.publicCount) public, \(drafts)")
            .font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
        }
      }
    }
    if store.loaded {
      ToolbarItemGroup(placement: .topBarTrailing) {
        Button { withAnimation { store.selecting ? store.endSelecting() : (store.selecting = true) } } label: {
          Label(store.selecting ? "Done" : "Select", systemImage: store.selecting ? "checkmark.circle.fill" : "checkmark.circle")
        }
        Menu {
          if let url = store.publicURL {
            Button { Clipboard.copy(url.absoluteString) } label: { Label("Copy public link", systemImage: "doc.on.doc") }
            Link(destination: url) { Label("Open public changelog", systemImage: "safari") }
            ShareLink(item: url) { Label("Share public link…", systemImage: "square.and.arrow.up") }
          } else {
            Button { sheet = .settings } label: { Label("Public changelog is off", systemImage: "sparkles") }
          }
          Divider()
          Button { sheet = .generate } label: { Label("From commits", systemImage: "sparkles") }
          Button { sheet = .subscribers } label: { Label("Subscribers and email", systemImage: "envelope") }
          Button { sheet = .importer } label: { Label("Import", systemImage: "square.and.arrow.down") }
          Button { sheet = .style } label: { Label("Style", systemImage: "paintpalette") }
          Button { sheet = .settings } label: { Label("Settings", systemImage: "slider.horizontal.3") }
        } label: { Label("More", systemImage: "ellipsis.circle") }
        Menu {
          Button { sheet = .release(nil) } label: { Label("New release", systemImage: "shippingbox") }
        } label: {
          Label("New entry", systemImage: "plus")
        } primaryAction: { sheet = .entry(nil) }
        .keyboardShortcut("n", modifiers: .command)
      }
    }
  }

  // MARK: Filters

  private var filterBar: some View {
    VStack(spacing: 10) {
      SearchField(text: $store.search, prompt: "Search or #12").padding(.horizontal, Metrics.gutter)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(ChangelogFilter.allCases) { filter in
            Pill(label: filter.label, count: store.count(filter), isActive: store.filter == filter) { store.filter = filter }
          }
          Rectangle().fill(Theme.border).frame(width: 1, height: 18).padding(.horizontal, 4)
          ForEach(ChangelogTag.allCases) { tag in
            Pill(label: tag.label, isActive: store.tagFilter == tag) { store.tagFilter = store.tagFilter == tag ? nil : tag }
          }
          if store.filtering { Button("Clear") { store.clearFilters() }.buttonStyle(.lnGhost) }
        }
        .padding(.horizontal, Metrics.gutter)
      }
    }
    .padding(.vertical, 10)
  }

  // MARK: List

  @ViewBuilder private var list: some View {
    let groups = store.groups
    if groups.isEmpty && store.releases.isEmpty || groups.isEmpty && store.filtering {
      ScrollView { emptyState }
    } else {
      List {
        if !store.settings.enabled && store.project != nil && store.filter != .archived {
          offBanner.listRowSeparator(.hidden).listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 4, trailing: 12))
        }
        if store.aiPending > 0 && store.filter != .archived {
          aiBanner.listRowSeparator(.hidden).listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
        }
        ForEach(groups) { group in
          Section {
            ForEach(group.entries) { entry in row(entry) }
            if group.entries.isEmpty {
              Text("No entries yet. Add one and choose this release.").font(.lnCaption).foregroundStyle(Theme.textMuted)
                .linearRow().frame(minHeight: 36)
            }
          } header: { header(group) }
        }
      }
      .linearList()
      .refreshable { await store.refresh() }
    }
  }

  @ViewBuilder private var emptyState: some View {
    if store.filtering {
      EmptyState(systemImage: "magnifyingglass", title: store.filter == .archived ? "Nothing archived" : "No matching entries", message: "Try another search or filter.") {
        Button("Clear filters") { store.clearFilters() }.buttonStyle(.lnSecondary)
      }
    } else {
      EmptyState(
        systemImage: "scroll",
        title: "Nothing here yet",
        message: "Write what shipped, in your own words, and group it into releases. Entries stay private until you publish them; link the posts, planning items, tickets and errors they come from so you can see what is done."
      ) {
        Button { sheet = .entry(nil) } label: { Label("New entry", systemImage: "plus") }.buttonStyle(.lnPrimary)
      }
    }
  }

  private var offBanner: some View {
    Button { sheet = .settings } label: {
      (Text("The public changelog is off. Turn on ") + Text("Public changelog").bold() + Text(" in Settings to serve its page, JSON and RSS; it does not depend on Feedback."))
        .font(.lnMeta).foregroundStyle(Theme.textMuted).multilineTextAlignment(.leading)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
        .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
    }
    .buttonStyle(.plain)
  }

  private var aiBanner: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "sparkles").foregroundStyle(Theme.accentText)
      (Text(store.aiPending == 1 ? "1 AI-written draft is waiting for your review. " : "\(store.aiPending) AI-written drafts are waiting for your review. ").fontWeight(.medium).foregroundStyle(Theme.text)
        + Text("Nothing is public until you approve it."))
        .foregroundStyle(Theme.textMuted)
      Spacer(minLength: 0)
      if store.filter != .ai { Button("Review") { store.filter = .ai }.buttonStyle(.lnGhost) }
    }
    .font(.lnMeta)
    .padding(.horizontal, 12).padding(.vertical, 8)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  @ViewBuilder private func header(_ group: ChangelogGroup) -> some View {
    if let release = group.release {
      HStack(spacing: 8) {
        (Text(release.version).fontWeight(.semibold).foregroundStyle(Theme.textHighlighted)
          + Text(release.title.isEmpty ? "" : " · \(release.title)").foregroundStyle(Theme.textMuted))
          .font(.lnMeta).lineLimit(1)
        ChangelogChip(text: release.status == .published ? String(localized: "Published") : String(localized: "Draft"), tint: release.status == .published ? Theme.success : Theme.textToned)
        if release.publishedAt != nil { Text(DateText.day(release.publishedAt)).font(.lnCaption).foregroundStyle(Theme.textMuted) }
        Spacer(minLength: 0)
        if release.status == .draft {
          Button { publishing = release } label: {
            if store.bulkBusy == release.id { ProgressView().controlSize(.mini) } else { Label("Publish", systemImage: "paperplane") }
          }
          .buttonStyle(.lnSecondaryCompact)
          .disabled(!store.bulkBusy.isEmpty)
        }
        Button { sheet = .release(release.id) } label: { Image(systemName: "pencil").foregroundStyle(Theme.textMuted).frame(width: 28, height: 28).contentShape(Rectangle()) }
          .buttonStyle(.plain)
          .accessibilityLabel("Edit release \(release.version)")
      }
      .textCase(nil)
    } else {
      Text(store.filter == .archived ? "Archived" : "No release").font(.lnMeta.weight(.semibold)).foregroundStyle(Theme.textHighlighted).textCase(nil)
    }
  }

  private func row(_ entry: ChangelogEntry) -> some View {
    let state = store.state(entry)
    let picked = store.selected.contains(entry.id)
    return Button {
      if store.selecting { store.toggle(entry.id) } else { sheet = .entry(entry.id) }
    } label: {
      HStack(spacing: 10) {
        if store.selecting {
          Image(systemName: picked ? "checkmark.circle.fill" : "circle").font(.system(size: 18)).foregroundStyle(picked ? Theme.accent : Theme.textDimmed)
        }
        VStack(alignment: .leading, spacing: 5) {
          Text(entry.title).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(2).multilineTextAlignment(.leading)
          HStack(spacing: 6) {
            entry.tag.chip
            if let number = entry.number { Text("#\(number)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted) }
            // When it goes public, else when it was written.
            Text(DateText.day(entry.publishedAt ?? entry.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted)
            if !entry.sources.isEmpty {
              Label("\(entry.doneSources)/\(entry.sources.count)", systemImage: "link").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
                .help("\(entry.doneSources) of \(entry.sources.count) linked items are done")
            }
            if entry.aiGenerated { ChangelogChip(text: String(localized: "AI"), tint: Theme.accentText) }
            if entry.needsReview { ChangelogChip(text: entry.reviewStatus == .rejected ? String(localized: "Sent back") : String(localized: "Review"), tint: Theme.warning) }
            ChangelogChip(text: state.label, tint: state.tint)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(.vertical, 8)
      .frame(maxWidth: .infinity, minHeight: Metrics.rowHeight, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .linearRow(selected: picked)
    .contextMenu {
      Button { sheet = .entry(entry.id) } label: { Label("Open", systemImage: "square.and.pencil") }
      if entry.status == .draft {
        Button { Task { await approve(entry) } } label: { Label("Approve and publish", systemImage: "checkmark") }
      }
      if entry.status == .archived {
        Button { Task { await restore(entry) } } label: { Label("Restore as draft", systemImage: "arrow.uturn.backward") }
      }
      Button { store.selecting = true; store.selected.insert(entry.id) } label: { Label("Select", systemImage: "checkmark.circle") }
      Divider()
      Button(role: .destructive) { deleting = entry } label: { Label("Delete", systemImage: "trash") }
    }
    .swipeActions(edge: .trailing) {
      Button(role: .destructive) { deleting = entry } label: { Label("Delete", systemImage: "trash") }
    }
    .swipeActions(edge: .leading) {
      if entry.status == .draft {
        Button { Task { await approve(entry) } } label: { Label("Approve", systemImage: "checkmark") }.tint(Theme.success)
      }
    }
  }

  private func approve(_ entry: ChangelogEntry) async {
    do { _ = try await store.review(entry.id, approve: true) } catch { store.alert = error.localizedDescription }
  }

  private func restore(_ entry: ChangelogEntry) async {
    do { _ = try await store.update(entry.id, ["status": .string("draft")]) } catch { store.alert = error.localizedDescription }
  }

  // MARK: Selection bar

  private var selectionBar: some View {
    let drafts = store.selectedEntries.filter { $0.status == .draft }.count
    let count = store.selected.count
    return ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        Text("\(count) selected").font(.lnMetaMedium).monospacedDigit().foregroundStyle(Theme.textMuted)
        Button { bulk = .approve } label: { Label("Approve and publish", systemImage: "checkmark") }
          .buttonStyle(.lnSecondaryCompact).disabled(drafts == 0)
        Button { if store.selectedEntries.contains(where: { $0.status == .published }) { bulk = .merge } else { Task { await merge() } } } label: { Label("Merge", systemImage: "arrow.triangle.merge") }
          .buttonStyle(.lnSecondaryCompact).disabled(count < 2 || count > 10)
        Menu {
          Button("No release") { Task { await store.moveSelected(toRelease: "") } }
          ForEach(store.releases) { release in Button(release.pickerLabel) { Task { await store.moveSelected(toRelease: release.id) } } }
        } label: { Label("Move to release", systemImage: "shippingbox") }
          .menuStyle(.button).buttonStyle(.lnSecondaryCompact).fixedSize().disabled(count == 0)
        Button(role: .destructive) { bulk = .delete } label: { Label("Delete", systemImage: "trash") }
          .buttonStyle(.lnSecondaryCompact).disabled(count == 0)
        if !store.bulkBusy.isEmpty { ProgressView().controlSize(.small) }
        Button("Clear") { store.selected = [] }.buttonStyle(.lnGhost)
      }
      .padding(.horizontal, Metrics.gutter)
      .padding(.vertical, 10)
    }
    .background(Theme.panel)
    .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
    .disabled(!store.bulkBusy.isEmpty)
  }
}
