import SwiftUI

/// One entry (web: projects/[id]/pages/[entryId].vue and CmsEditor.vue): its block tree as an
/// outline beside a form for the selected block (a sheet on iPhone). Edits save together;
/// publishing freezes them into the next version visitors get. Undo and redo step through the
/// draft, and the assistant (PagesChat.swift) edits it as it works. The web editor's live preview has
/// no native counterpart: open the hosted page after publishing.
struct PageEntryScreen: View {
  let projectId: String
  let entryId: String
  /// The assistant sends this once, when its chat is empty (the wizard's brief).
  var firstPrompt: String? = nil
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
  /// Earlier drafts, newest last; edits within 600 ms of each other share one step.
  @State private var undoStack: [PageDraft] = []
  @State private var redoStack: [PageDraft] = []
  @State private var lastEdit = Date.distantPast
  @State private var restoring = false
  /// The assistant is at work: its edits are one undo step, taken when its turn began.
  @State private var assisting = false
  @State private var chat: PagesChatStore?
  @State private var assistantOpen = false
  /// The outline's search text, and the blocks folded shut.
  @State private var query = ""
  @State private var collapsed: Set<String> = []

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
          ErrorText(message: error.isEmpty ? String(localized: "Page not found") : error)
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
    .onChange(of: draft) { old, new in record(from: old, to: new) }
    .sheet(isPresented: $assistantOpen) {
      if let chat {
        NavigationStack {
          PagesChatPanel(chat: chat, library: library, selected: selectedBlock, content: draft?.content) { selection = $0 }
            .panelScreen("Assistant")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { assistantOpen = false } } }
        }
        .presentationDetents([.medium, .large])
      }
    }
    .task { if entry == nil { await load() } }
  }

  // MARK: History

  private func record(from old: PageDraft?, to new: PageDraft?) {
    if restoring { restoring = false; return }
    guard let old, new != nil, !assisting else { return }
    if Date().timeIntervalSince(lastEdit) > 0.6 {
      undoStack.append(old)
      if undoStack.count > 50 { undoStack.removeFirst() }
    }
    lastEdit = Date()
    redoStack.removeAll()
  }

  private func undo() {
    guard let previous = undoStack.popLast(), let draft else { return }
    redoStack.append(draft)
    restoring = true
    self.draft = previous
    lastEdit = .distantPast
    reselect()
  }

  private func redo() {
    guard let next = redoStack.popLast(), let draft else { return }
    undoStack.append(draft)
    restoring = true
    self.draft = next
    lastEdit = .distantPast
    reselect()
  }

  /// The selection goes to the page when its block no longer exists.
  private func reselect() {
    if let draft, let selection, draft.content.find(selection, library) == nil { self.selection = nil; inspecting = false }
  }

  // MARK: Toolbar

  @ToolbarContentBuilder private func toolbar(_ entry: CmsEntry) -> some ToolbarContent {
    ToolbarItemGroup(placement: .primaryAction) {
      Button { assistantOpen = true } label: { Label("Assistant", systemImage: "sparkles") }
      Button { undo() } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
        .keyboardShortcut("z", modifiers: .command).disabled(undoStack.isEmpty || busy != "")
      Button { redo() } label: { Label("Redo", systemImage: "arrow.uturn.forward") }
        .keyboardShortcut("z", modifiers: [.command, .shift]).disabled(redoStack.isEmpty || busy != "")
    }
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
        searchField
        outlineRows(draft.wrappedValue.content)
      }
      .padding(wide ? 12 : 16)
      .frame(maxWidth: wide ? nil : 680, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    // The page's own add menu stays in reach however long the outline is.
    .safeAreaInset(edge: .bottom, spacing: 0) {
      let fields = draft.wrappedValue.content.childFields(library)
      if !fields.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          Rectangle().fill(Theme.border).frame(height: Hairline.width)
          ForEach(fields) { field in addRow(parent: draft.wrappedValue.content, field: field, depth: 0, labelled: fields.count > 1).padding(.horizontal, wide ? 12 : 16) }
        }
        .background(.bar)
      }
    }
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

  private var selectedBlock: CmsBlock? {
    guard let draft, let selection, selection != draft.content.uid else { return nil }
    return draft.content.find(selection, library)
  }

  /// The assistant edits this page: its content and settings stream into the draft.
  private func makeChat() -> PagesChatStore {
    let store = PagesChatStore(session: session, scope: PagesChatScope(projectId: projectId, entryId: entryId))
    store.firstPrompt = firstPrompt
    store.content = { draft?.content }
    store.selectedId = { selection }
    store.snapshot = { draft }
    store.restore = { previous in
      draft = previous
      reselect()
    }
    store.applyContent = { block in
      draft?.content = block
      reselect()
    }
    store.applyPage = { name, slug, style in
      if let name { draft?.name = name }
      if let slug { draft?.slug = slug }
      if let style { draft?.style = style }
    }
    store.componentSaved = { Task { await reloadLibrary() } }
    store.turnStarted = {
      if let draft { undoStack.append(draft); if undoStack.count > 50 { undoStack.removeFirst() } }
      redoStack.removeAll()
      assisting = true
    }
    store.turnEnded = { assisting = false }
    return store
  }

  private func reloadLibrary() async {
    struct Components: Decodable, Sendable { let components: [CmsComponent] }
    if let components: Components = try? await session.get("/v1/admin/cms/components", query: ["project": projectId]) { library = CmsLibrary(components.components) }
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

  private var searching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }
  private var found: (matches: Set<String>, shown: Set<String>) { draft?.content.search(query, library) ?? ([], []) }

  /// The tree flattened into rows, parents before children, each nested blocks field ending in its add row
  /// (the page's own is the bar below). Folded blocks hide their children; a search keeps `shown` only, folds open.
  private func items(_ block: CmsBlock, depth: Int = 0, shown: Set<String>? = nil) -> [OutlineItem] {
    var out: [OutlineItem] = [.block(block, depth: depth)]
    guard shown != nil || !collapsed.contains(block.uid) else { return out }
    let fields = block.childFields(library)
    for field in fields {
      for child in block.children(field.key) where shown?.contains(child.uid) != false { out += items(child, depth: depth + 1, shown: shown) }
      if shown == nil && depth > 0 { out.append(.add(parent: block, field: field, depth: depth + 1, labelled: fields.count > 1)) }
    }
    return out
  }

  private var searchField: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(Theme.textMuted)
      TextField("Search the text on the page", text: $query).textFieldStyle(.plain).font(.lnRow).autocorrectionDisabled().textInputAutocapitalization(.never)
      if !query.isEmpty {
        Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDimmed) }.buttonStyle(.plain).accessibilityLabel("Clear search")
      }
    }
    .padding(.horizontal, 10).frame(minHeight: 36)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).stroke(Theme.border, lineWidth: Hairline.width))
  }

  private func outlineRows(_ content: CmsBlock) -> some View {
    let shown: Set<String>? = searching ? found.shown : nil
    return VStack(alignment: .leading, spacing: 2) {
      if let shown, shown.isEmpty { Text("Nothing on this page says “\(query.trimmingCharacters(in: .whitespaces))”.").font(.lnCaption).foregroundStyle(Theme.textMuted).padding(8) }
      ForEach(shown?.isEmpty == true ? [] : items(content, shown: shown)) { item in
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
    let lists = !root && !block.childFields(library).isEmpty
    let folded = collapsed.contains(block.uid) && !searching
    return HStack(spacing: 4) {
      if !root {
        if lists {
          Button { if collapsed.contains(block.uid) { collapsed.remove(block.uid) } else { collapsed.insert(block.uid) } } label: {
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textMuted).rotationEffect(.degrees(folded ? 0 : 90)).frame(width: 20, height: 28).contentShape(Rectangle())
          }
          .buttonStyle(.plain).accessibilityLabel(folded ? "Expand" : "Collapse")
        } else {
          Color.clear.frame(width: 20, height: 28)
        }
      }
      Button {
        selection = root ? nil : block.uid
        if !wide { inspecting = true }
      } label: {
        HStack(spacing: 8) {
          Image(systemName: root ? "doc" : def == nil ? "questionmark.circle" : def?.isBuiltin == true ? "cube" : "puzzlepiece")
            .font(.system(size: 13)).foregroundStyle(Theme.textMuted).frame(width: 18)
          Text(def?.name ?? String(localized: "Missing: \(block.component)")).font(.lnRow).foregroundStyle(def == nil ? Theme.warning : Theme.textHighlighted).lineLimit(1).layoutPriority(1)
          if !block.title.isEmpty { Text(block.title).font(.lnCaption).foregroundStyle(Theme.textDimmed).lineLimit(1) }
          Spacer(minLength: 0)
          if folded { Text("\(block.childFields(library).reduce(0) { $0 + block.children($1.key).count })").font(.lnCaption).foregroundStyle(Theme.textMuted) }
          if block.isHidden { Image(systemName: "eye.slash").font(.system(size: 11)).foregroundStyle(Theme.textDimmed).accessibilityLabel("Hidden") }
          if block.animation != nil { Image(systemName: "sparkles").font(.system(size: 11)).foregroundStyle(Theme.textDimmed).accessibilityLabel("Animated") }
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .opacity(block.isHidden ? 0.5 : 1)
      if !root {
        Menu {
          Button { toggleHidden(block.uid) } label: { Label(block.isHidden ? "Show on the page" : "Hide from the page", systemImage: block.isHidden ? "eye" : "eye.slash") }
          Button { move(block.uid, by: -1) } label: { Label("Move up", systemImage: "arrow.up") }.disabled(slot.map { $0.index == 0 } ?? true)
          Button { move(block.uid, by: 1) } label: { Label("Move down", systemImage: "arrow.down") }.disabled(slot.map { $0.index >= $0.count - 1 } ?? true)
          Button { duplicate(block.uid) } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
          moveMenu(block)
          Divider()
          Button(role: .destructive) { remove(block.uid) } label: { Label("Delete", systemImage: "trash") }
        } label: {
          Image(systemName: "ellipsis").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 28, height: 28).contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .accessibilityLabel("Actions for \(def?.name ?? block.component)")
      }
    }
    .padding(.leading, 4 + CGFloat(depth) * 14).padding(.trailing, 4)
    .frame(minHeight: 36)
    .background(selected ? Theme.accented : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay { if searching && found.matches.contains(block.uid) { RoundedRectangle(cornerRadius: Metrics.radius).stroke(Theme.accent.opacity(0.5), lineWidth: 1) } }
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
    query = ""
    selection = block.uid
  }

  /// "Move to": the other lists that take this block.
  @ViewBuilder private func moveMenu(_ block: CmsBlock) -> some View {
    let targets = draft?.content.moveTargets(for: block.uid, library) ?? []
    if !targets.isEmpty {
      Menu {
        ForEach(Array(targets.enumerated()), id: \.offset) { _, target in
          Button("\(library[target.parent.component]?.name ?? target.parent.component) › \(target.field.label)") { moveToList(block.uid, target.parent, target.field) }
        }
      } label: { Label("Move to…", systemImage: "arrow.right.square") }
    }
  }

  private func moveToList(_ id: String, _ parent: CmsBlock, _ field: CmsField) {
    guard var edited = draft else { return }
    if let why = edited.content.moveToList(id, parent: parent.uid, field: field.key, library) { error = why; return }
    error = ""
    draft = edited
  }

  private func toggleHidden(_ id: String) {
    draft?.content.edit(id, library) { block in
      if block.isHidden { block.values.removeValue(forKey: "_hidden") } else { block.values["_hidden"] = .bool(true) }
    }
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
      if chat == nil {
        chat = makeChat()
        assistantOpen = firstPrompt != nil
      }
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
    if name.isEmpty { error = String(localized: "A page needs a name."); return false }
    if !CmsLimits.validSlug(slug) { error = CmsLimits.slugRule; return false }
    busy = "save"
    error = ""
    defer { busy = "" }
    do {
      let response: CmsEntryResponse = try await session.send("/v1/admin/cms/entries/\(entryId)", method: "PATCH", body: Input(name: name, slug: slug, style: draft.style, content: draft.content))
      entry = response.entry
      self.draft = PageDraft(response.entry)
      notice = response.issues.isEmpty ? "" : String(localized: "Fixed on save: \(response.issues.prefix(3).joined(separator: " "))")
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
