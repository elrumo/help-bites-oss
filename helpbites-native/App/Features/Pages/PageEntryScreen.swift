import SwiftUI

/// One entry (web: projects/[id]/pages/[entryId].vue and CmsEditor.vue): its block tree as an
/// outline beside a form for the selected block (a sheet on iPhone). Edits save together;
/// publishing freezes them into the next version visitors get. The web editor's live preview
/// and assistant have no native counterpart: open the hosted page after publishing.
struct PageEntryScreen: View {
  let projectId: String
  let entryId: String
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var entry: CmsEntry?
  @State private var draft: PageDraft?
  @State private var library = CmsLibrary()
  @State private var loading = true
  @State private var error = ""
  /// What the server changed when it checked the last save.
  @State private var notice = ""
  /// save, publish, unpublish or delete while that request runs.
  @State private var busy = ""
  /// The selected block's `_uid`; nil is the page itself.
  @State private var selection: String?
  /// iPhone: the form for the selection, in a sheet.
  @State private var inspecting = false
  @State private var confirm: Confirm?

  private enum Confirm: String, Identifiable { case unpublish, delete; var id: String { rawValue } }

  /// The form sits beside the outline on iPad and the Mac.
  private var wide: Bool { sizeClass != .compact }
  private var dirty: Bool {
    guard let entry, let draft else { return false }
    return PageDraft(entry) != draft
  }
  private var publicURL: URL? { entry.flatMap { LegalAPI.publicURL(session, $0.path) } }

  var body: some View {
    Group {
      if let entry, let draft = Binding($draft) {
        editor(entry, draft)
      } else if loading {
        SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
      } else {
        VStack(spacing: 12) {
          ErrorText(message: error.isEmpty ? "Page not found" : error)
          Button("Try again") { Task { await load() } }.buttonStyle(.lnSecondaryCompact)
        }
        .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      }
    }
    .projectScreen(projectId, entry?.name ?? "Page")
    .toolbar { if let entry { toolbar(entry) } }
    .confirmationDialog(confirm == .delete ? "Delete this page?" : "Unpublish this page?", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { item in
      switch item {
      case .unpublish: Button("Unpublish") { Task { await run("unpublish") } }
      case .delete: Button("Delete page", role: .destructive) { Task { await delete() } }
      }
    } message: { item in
      switch item {
      case .unpublish: Text("The page answers 404 and the delivery API stops serving it. Your working copy stays.")
      case .delete: Text("Its page stops working at once. This cannot be undone.")
      }
    }
    .sheet(isPresented: $inspecting) {
      NavigationStack {
        ScrollView {
          if let draft = Binding($draft) { inspector(draft).frame(maxWidth: 680, alignment: .leading).padding(20).frame(maxWidth: .infinity) }
        }
        .scrollDismissesKeyboard(.interactively)
        .panelScreen(selectionTitle)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { inspecting = false } } }
      }
      .presentationDetents([.large])
    }
    .task { if entry == nil { await load() } }
  }

  // MARK: Toolbar

  @ToolbarContentBuilder private func toolbar(_ entry: CmsEntry) -> some ToolbarContent {
    ToolbarItem(placement: .primaryAction) {
      Menu {
        if entry.isPublished, let publicURL {
          Button { openURL(publicURL) } label: { Label("Open page", systemImage: "arrow.up.right.square") }
          Button { Clipboard.copy(publicURL.absoluteString) } label: { Label("Copy link", systemImage: "link") }
          ShareLink(item: publicURL) { Label("Share…", systemImage: "square.and.arrow.up") }
          Button { confirm = .unpublish } label: { Label("Unpublish", systemImage: "eye.slash") }.disabled(busy != "")
          Divider()
        }
        Button(role: .destructive) { confirm = .delete } label: { Label("Delete page", systemImage: "trash") }.disabled(busy != "")
      } label: { Label("More", systemImage: "ellipsis.circle") }
    }
    ToolbarItem(placement: .primaryAction) {
      if dirty {
        Button { Task { _ = await save() } } label: { Text(busy == "save" ? "Saving…" : "Save") }
          .keyboardShortcut("s", modifiers: .command).disabled(busy != "")
      } else if !entry.isPublished || entry.changed {
        Button { Task { await run("publish") } } label: { Text(busy == "publish" ? "Publishing…" : entry.isPublished ? "Publish changes" : "Publish") }
          .disabled(busy != "")
      }
    }
  }

  // MARK: Layout

  @ViewBuilder private func editor(_ entry: CmsEntry, _ draft: Binding<PageDraft>) -> some View {
    let outline = ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        status(entry)
        ErrorText(message: error)
        if !notice.isEmpty { Label(notice, systemImage: "wand.and.stars").font(.lnCaption).foregroundStyle(Theme.warning) }
        outlineRows(draft.wrappedValue.content)
      }
      .padding(wide ? 12 : 16)
      .frame(maxWidth: wide ? nil : 680, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    if wide {
      HStack(spacing: 0) {
        outline.frame(width: 340)
        Rectangle().fill(Theme.border).frame(width: Hairline.width)
        ScrollView { inspector(draft).frame(maxWidth: 680, alignment: .leading).padding(20).frame(maxWidth: .infinity) }
          .scrollDismissesKeyboard(.interactively)
      }
    } else {
      outline
    }
  }

  private func inspector(_ draft: Binding<PageDraft>) -> some View {
    PageInspector(
      draft: draft, selection: selection, library: library, projectId: projectId,
      projectAccent: workspace.project(projectId)?.theme.accent,
      address: publicURL?.absoluteString ?? ""
    )
  }

  private var selectionTitle: String {
    guard let draft, let selection, selection != draft.content.uid, let block = draft.content.find(selection, library) else { return "Page" }
    return library[block.component]?.name ?? "Block"
  }

  private func status(_ entry: CmsEntry) -> some View {
    HStack(spacing: 8) {
      Tag(text: entry.statusLabel, tint: entry.isPublished ? Theme.success : Theme.textDimmed)
      if entry.changed { Tag(text: "Unpublished changes", tint: Theme.warning) }
      if dirty { Text("Unsaved changes").font(.lnCaption).foregroundStyle(Theme.warning) }
      Spacer(minLength: 0)
    }
  }

  // MARK: Outline

  private enum OutlineItem: Identifiable {
    case block(CmsBlock, depth: Int)
    case add(parent: CmsBlock, field: CmsField, depth: Int, labelled: Bool)
    var id: String {
      switch self {
      case .block(let block, _): block.uid
      case .add(let parent, let field, _, _): "add-\(parent.uid)-\(field.key)"
      }
    }
  }

  /// The tree flattened into rows, parents before children, each blocks field ending in its add row.
  private func items(_ block: CmsBlock, depth: Int = 0) -> [OutlineItem] {
    var out: [OutlineItem] = [.block(block, depth: depth)]
    let fields = block.childFields(library)
    for field in fields {
      for child in block.children(field.key) { out += items(child, depth: depth + 1) }
      out.append(.add(parent: block, field: field, depth: depth + 1, labelled: fields.count > 1))
    }
    return out
  }

  private func outlineRows(_ content: CmsBlock) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      ForEach(items(content)) { item in
        switch item {
        case .block(let block, let depth): blockRow(block, depth: depth)
        case .add(let parent, let field, let depth, let labelled): addRow(parent: parent, field: field, depth: depth, labelled: labelled)
        }
      }
    }
  }

  private func blockRow(_ block: CmsBlock, depth: Int) -> some View {
    let root = depth == 0
    let def = library[block.component]
    let selected = root ? selection == nil : selection == block.uid
    let slot = root ? nil : draft?.content.slot(of: block.uid, library)
    return HStack(spacing: 4) {
      Button {
        selection = root ? nil : block.uid
        if !wide { inspecting = true }
      } label: {
        HStack(spacing: 8) {
          Image(systemName: root ? "doc" : def == nil ? "questionmark.circle" : def?.isBuiltin == true ? "cube" : "puzzlepiece")
            .font(.system(size: 13)).foregroundStyle(Theme.textMuted).frame(width: 18)
          Text(def?.name ?? "Missing: \(block.component)").font(.lnRow).foregroundStyle(def == nil ? Theme.warning : Theme.textHighlighted).lineLimit(1).layoutPriority(1)
          if !block.title.isEmpty { Text(block.title).font(.lnCaption).foregroundStyle(Theme.textDimmed).lineLimit(1) }
          Spacer(minLength: 0)
          if block.animation != nil { Image(systemName: "sparkles").font(.system(size: 11)).foregroundStyle(Theme.textDimmed).accessibilityLabel("Animated") }
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      if !root {
        Menu {
          Button { move(block.uid, by: -1) } label: { Label("Move up", systemImage: "arrow.up") }.disabled(slot.map { $0.index == 0 } ?? true)
          Button { move(block.uid, by: 1) } label: { Label("Move down", systemImage: "arrow.down") }.disabled(slot.map { $0.index >= $0.count - 1 } ?? true)
          Button { duplicate(block.uid) } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
          Divider()
          Button(role: .destructive) { remove(block.uid) } label: { Label("Delete", systemImage: "trash") }
        } label: {
          Image(systemName: "ellipsis").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 28, height: 28).contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .accessibilityLabel("Actions for \(def?.name ?? block.component)")
      }
    }
    .padding(.leading, 8 + CGFloat(depth) * 14).padding(.trailing, 4)
    .frame(minHeight: 36)
    .background(selected ? Theme.accented : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radius))
  }

  /// The end of a blocks field: a menu of the components it takes, the built-ins first.
  private func addRow(parent: CmsBlock, field: CmsField, depth: Int, labelled: Bool) -> some View {
    let choices = library.choices(for: field)
    return Menu {
      Section("Built-in") { ForEach(choices.filter(\.isBuiltin)) { component in Button(component.name) { add(component, to: parent, field: field) } } }
      if choices.contains(where: { !$0.isBuiltin }) {
        Section("Your components") { ForEach(choices.filter { !$0.isBuiltin }) { component in Button(component.name) { add(component, to: parent, field: field) } } }
      }
    } label: {
      Label(labelled ? "Add to \(field.label)" : "Add block", systemImage: "plus").font(.lnCaption).foregroundStyle(Theme.textMuted)
        .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading).contentShape(Rectangle())
    }
    .menuStyle(.borderlessButton).menuIndicator(.hidden)
    .disabled(choices.isEmpty)
    .padding(.leading, 8 + CGFloat(depth) * 14)
  }

  // MARK: Editing

  private func add(_ component: CmsComponent, to parent: CmsBlock, field: CmsField) {
    guard var edited = draft else { return }
    let block = CmsBlock.new(component)
    if let why = edited.content.add(block, to: parent.uid, field: field.key, library) {
      error = why
      return
    }
    error = ""
    draft = edited
    selection = block.uid
  }

  private func move(_ id: String, by offset: Int) {
    draft?.content.move(id, by: offset, library)
  }

  private func duplicate(_ id: String) {
    guard var edited = draft, let copy = edited.content.duplicate(id, library) else { return }
    draft = edited
    selection = copy
  }

  private func remove(_ id: String) {
    draft?.content.remove(id, library)
    if let draft, selection.map({ draft.content.find($0, library) == nil }) == true {
      selection = nil
      inspecting = false
    }
  }

  // MARK: Requests

  private func load() async {
    struct Components: Decodable, Sendable { let components: [CmsComponent] }
    do {
      let response: CmsEntryResponse = try await session.get("/v1/admin/cms/entries/\(entryId)")
      let components: Components = try await session.get("/v1/admin/cms/components", query: ["project": projectId])
      library = CmsLibrary(components.components)
      entry = response.entry
      draft = PageDraft(response.entry)
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
  }

  /// `PATCH /v1/admin/cms/entries/:id` with the whole draft. The server fits the content to the
  /// components; the draft takes what it kept, and what it had to change is listed.
  private func save() async -> Bool {
    struct Input: Encodable, Sendable { let name, slug: String; let style: CmsStyle; let content: CmsBlock }
    guard let draft else { return false }
    let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
    let slug = draft.slug.trimmingCharacters(in: .whitespaces).lowercased()
    if name.isEmpty { error = "A page needs a name."; return false }
    if !CmsLimits.validSlug(slug) { error = CmsLimits.slugRule; return false }
    busy = "save"
    error = ""
    defer { busy = "" }
    do {
      let response: CmsEntryResponse = try await session.send("/v1/admin/cms/entries/\(entryId)", method: "PATCH", body: Input(name: name, slug: slug, style: draft.style, content: draft.content))
      entry = response.entry
      self.draft = PageDraft(response.entry)
      notice = response.issues.isEmpty ? "" : "Fixed on save: " + response.issues.prefix(3).joined(separator: " ")
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
  }

  /// `publish` or `unpublish`; publishing saves first.
  private func run(_ action: String) async {
    if action == "publish", dirty, !(await save()) { return }
    busy = action
    error = ""
    defer { busy = "" }
    do {
      let response: CmsEntryResponse = try await session.send("/v1/admin/cms/entries/\(entryId)/\(action)")
      entry = response.entry
      if !dirty { draft = PageDraft(response.entry) }
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func delete() async {
    busy = "delete"
    defer { busy = "" }
    do {
      try await session.delete("/v1/admin/cms/entries/\(entryId)")
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
