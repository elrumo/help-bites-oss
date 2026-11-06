import SwiftUI
import UniformTypeIdentifiers

/// The email page (pages/emails/index.vue, pages/projects/[id]/email.vue), as tabs (EmailTabs.vue).
/// A project's Email is one section: Templates (the component library behind it), Campaigns,
/// Sequences, the Log (the suppressed addresses behind it) and Settings, where its one sender lives.
/// With `projectId` nil it is the shared templates' page: Shared templates, Components, Log and
/// Suppressed. Templates are a folder of them (EmailLibrary.vue): the shared templates when
/// `projectId` is nil, else one project's templates next to the shared templates it links. Own
/// templates and shared templates open in the editor; a linked shared template opens this project's
/// values for it.
struct EmailLibraryScreen: View {
  let projectId: String?
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @State private var tab: EmailTab
  /// What the project's email still needs, under the tab bar (project tabs only).
  @State private var setup: EmailSetup?
  /// Bumped after Settings saves, so the setup strip reads the project again.
  @State private var setupVersion = 0

  /// `logBatch` opens the Log on one send's recipients (a campaign links here with its `cm_` id).
  private let logBatch: String

  init(projectId: String?, initialTab: EmailTab = .templates, logBatch: String = "") {
    self.projectId = projectId
    self.logBatch = logBatch
    let start = logBatch.isEmpty ? initialTab : .log
    // The shared templates' page has no Campaigns, Sequences or Settings.
    _tab = State(initialValue: projectId == nil && start.projectOnly ? .templates : start)
  }

  @State private var templates: [EmailTemplateItem] = []
  @State private var folders: [EmailFolderItem] = []
  @State private var usage: [String: Int] = [:]
  @State private var brand: EmailBrand?
  @State private var loading = true
  @State private var search = ""
  @State private var folderId: String?
  @State private var busy = false
  @State private var error = ""

  @State private var pickerOpen = false
  @State private var addMasterOpen = false
  @State private var importing = false
  @State private var importKind: ImportKind = .html
  @State private var testing: EmailTemplateItem?
  @State private var apiTemplate: EmailTemplateItem?
  @State private var sharedFile: EmailSharedFile?
  /// A one-line confirmation under the header (the web's toasts), with an optional "Open" target.
  @State private var notice = ""
  @State private var noticeTarget: EmailEditorTarget?
  @State private var editing: EmailEditorTarget?
  @State private var linked: EmailTemplateItem?
  @State private var sharing: EmailTemplateItem?
  @State private var prompt: Prompt?
  @State private var promptText = ""
  @State private var confirm: Confirm?
  /// Runs once a sheet has finished closing: SwiftUI can't present over a sheet on its way out.
  @State private var afterSheet: (() -> Void)?

  private enum Prompt {
    case newFolder, renameFolder(EmailFolderItem), renameTemplate(EmailTemplateItem)
    var title: String {
      switch self {
      case .newFolder: String(localized: "Folder name")
      case .renameFolder: String(localized: "Rename folder")
      case .renameTemplate: String(localized: "Rename template")
      }
    }
    var action: String { if case .newFolder = self { String(localized: "Create") } else { String(localized: "Rename") } }
  }

  private enum ImportKind { case html, json }

  /// A JSON import after its dry run, waiting for the go-ahead.
  private struct PendingImport {
    let templates: [JSONValue]
    let fileName: String
    let plan: EmailImportSummary
  }

  private enum Confirm {
    case deleteFolder(EmailFolderItem), deleteTemplate(EmailTemplateItem), detach(EmailTemplateItem), importJSON(PendingImport)
    var title: String {
      switch self {
      case .deleteFolder(let folder): return String(localized: "Delete “\(folder.name)”? What is inside moves up a level.")
      case .deleteTemplate(let t): return t.isLinked ? String(localized: "Remove “\(t.title)” from this project? The shared template stays.") : String(localized: "Delete “\(t.name)”? This cannot be undone.")
      case .detach: return String(localized: "Detach from the shared template? This project gets its own editable copy, and later edits to the shared template no longer reach it.")
      case .importJSON(let pending):
        let count = pending.templates.count
        let plan = pending.plan
        let errors = (plan.results ?? []).compactMap { r in r.error.map { "\(r.key ?? "?"): \($0)" } }.prefix(5).joined(separator: "\n")
        let failed = plan.failed ?? 0
        let head = count == 1 ? String(localized: "Import 1 template from \(pending.fileName)?") : String(localized: "Import \(count) templates from \(pending.fileName)?")
        let tally = String(localized: "\(plan.created ?? 0) new, \(plan.updated ?? 0) updated, \(plan.unchanged ?? 0) unchanged")
        return head + "\n\n" + tally + (failed > 0 ? String(localized: ", \(failed) with errors:\n\(errors)") : "")
      }
    }
    var action: String {
      switch self {
      case .deleteFolder: String(localized: "Delete")
      case .deleteTemplate(let t): t.isLinked ? String(localized: "Remove from project") : String(localized: "Delete")
      case .detach: String(localized: "Detach")
      case .importJSON: String(localized: "Import")
      }
    }
    var destructive: Bool { if case .importJSON = self { false } else { true } }
  }

  private var newLabel: String { projectId == nil ? String(localized: "New shared template") : String(localized: "New template") }

  private var screenTitle: String {
    if projectId != nil { return String(localized: "Email") }
    switch tab {
    case .templates: return String(localized: "Email templates")
    case .components: return String(localized: "Email components")
    case .log: return String(localized: "Email log")
    case .suppressed: return String(localized: "Suppressed addresses")
    // Not on this page (init sends them to Templates); a project's pages are titled "Email".
    case .campaigns, .sequences, .settings: return String(localized: "Email")
    }
  }

  /// A new key reads the setup again: another tab, or a save of the sender.
  private var setupKey: String { "\(projectId ?? "")-\(tab.rawValue)-\(setupVersion)" }

  var body: some View {
    VStack(spacing: 0) {
      tabBar
      if projectId != nil {
        EmailSetupStrip(checks: setup?.checks ?? [], bulk: tab.projectOnly) { tab = .settings }
      }
      switch tab {
      case .templates: templatesView
      case .components: EmailComponentLibrary(projectId: projectId)
      case .campaigns, .sequences, .settings:
        if let projectId { CampaignsScreen(projectId: projectId, tab: tab) { setupVersion += 1 } }
      case .log: EmailLogScreen(projectId: projectId, batch: logBatch)
      case .suppressed: EmailSuppressionsScreen(projectId: projectId)
      }
    }
    .panelScreen(screenTitle)
    .onAppear(perform: takePendingTab)
    .onChange(of: workspace.pendingEmailTab) { takePendingTab() }
    .toolbar {
      #if os(iOS)
      if let projectId { ToolbarItem(placement: .principal) { ProjectBreadcrumb(projectId: projectId, title: "Email") } }
      #endif
      // Suppressed addresses sit behind the Log, as on the web.
      if projectId != nil && tab == .log {
        ToolbarItem(placement: .topBarTrailing) { IconButton(systemImage: "envelope.badge.shield.half.filled", label: "Suppressed") { tab = .suppressed } }
      }
    }
    // Each tab reads the setup again, as each of the web's pages does, and so does a save of the sender.
    .task(id: setupKey) {
      guard let projectId else { return }
      let loaded = await EmailSetup.load(projectId, session: session)
      if !Task.isCancelled { setup = loaded }
    }
  }

  /// A link to one tab (`email?view=settings`) opens it.
  private func takePendingTab() {
    guard projectId != nil, let pending = workspace.pendingEmailTab else { return }
    workspace.pendingEmailTab = nil
    tab = pending
  }

  private func tabTitle(_ item: EmailTab) -> String {
    switch item {
    case .templates: projectId == nil ? String(localized: "Shared templates") : String(localized: "Templates")
    case .components: String(localized: "Components")
    case .campaigns: String(localized: "Campaigns")
    case .sequences: String(localized: "Sequences")
    case .log: String(localized: "Log")
    case .suppressed: String(localized: "Suppressed")
    case .settings: String(localized: "Settings")
    }
  }

  /// The page's sections, a row of pills above whichever is showing. A project's bar keeps Templates lit
  /// on the Components view and Log on the Suppressed one; pressing it goes back.
  private var tabBar: some View {
    let lit = projectId == nil ? tab : tab.inProjectBar
    // Campaigns and Sequences are one plan feature on the web's bar, and carry its lock.
    let locked = session.isLocked("campaigns")
    return ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        ForEach(EmailTab.bar(shared: projectId == nil)) { item in
          Pill(label: tabTitle(item), systemImage: locked && (item == .campaigns || item == .sequences) ? "lock" : nil, isActive: item == lit) { tab = item }
        }
      }
      .padding(.horizontal, Metrics.gutter)
    }
    .padding(.top, 10)
    .padding(.bottom, 2)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Email sections")
  }

  private var templatesView: some View {
    VStack(spacing: 0) {
      header
      content
    }
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        IconButton(systemImage: "folder.badge.plus", label: "New folder") { promptText = ""; prompt = .newFolder }
        Menu {
          Button { importKind = .html; importing = true } label: { Label("Import HTML…", systemImage: "chevron.left.forwardslash.chevron.right") }
          Button { importKind = .json; importing = true } label: { Label("Import JSON…", systemImage: "curlybraces") }
          Button { Task { await exportAll() } } label: { Label("Export all as JSON", systemImage: "square.and.arrow.up") }
        } label: {
          Image(systemName: "arrow.up.arrow.down.square")
            .font(.app(size: 14, weight: .medium))
            .foregroundStyle(Theme.textMuted)
            .frame(width: 32, height: 32)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Import or export")
        if projectId != nil { IconButton(systemImage: "puzzlepiece", label: "Components") { tab = .components } }
        if projectId != nil { IconButton(systemImage: "link", label: "Add shared template") { addMasterOpen = true } }
        if busy { ProgressView() } else { Button { pickerOpen = true } label: { Label(newLabel, systemImage: "plus") } }
      }
    }
    .task { await load() }
    .alert(error, isPresented: Binding(get: { !error.isEmpty }, set: { if !$0 { error = "" } })) { Button("OK", role: .cancel) {} }
    .confirmationDialog(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { action in
      Button(action.action, role: action.destructive ? .destructive : nil) { Task { await run(action) } }
    }
    .sheet(isPresented: $pickerOpen, onDismiss: runAfterSheet) {
      EmailStarterPicker(title: newLabel) { starter in
        afterSheet = { Task { await create(["starterId": .string(starter.id), "name": .string(starter.name)]) } }
        pickerOpen = false
      } onBlank: {
        afterSheet = { Task { await create([:]) } }
        pickerOpen = false
      }
    }
    .sheet(isPresented: $addMasterOpen, onDismiss: runAfterSheet) {
      EmailAddMasterSheet(inUse: Set(templates.compactMap(\.masterId))) { await link(master: $0) }
    }
    .sheet(item: $linked, onDismiss: runAfterSheet) { row in
      EmailLinkedPanel(template: row, brand: brand, onSaved: replace) { detached in
        replace(detached)
        afterSheet = { editing = EmailEditorTarget(id: detached.id, name: detached.name) }
        linked = nil
      } onRemoved: { id in
        templates.removeAll { $0.id == id }
        linked = nil
      }
    }
    .sheet(item: $sharing) { row in
      EmailShareSheet(template: row) { mode, token, expiresAt in
        guard let index = templates.firstIndex(where: { $0.id == row.id }) else { return }
        templates[index].shareMode = mode
        templates[index].shareToken = token
        templates[index].shareExpiresAt = expiresAt
      }
    }
    .sheet(item: $testing) { EmailTestSheet(template: $0) }
    .sheet(item: $apiTemplate) { row in
      EmailAPISheet(template: row) { key in
        if let index = templates.firstIndex(where: { $0.id == row.id }) { templates[index].key = key }
      }
    }
    .sheet(item: $sharedFile) { ShareSheet(url: $0.url).presentationDetents([.medium, .large]) }
    .fullScreenCover(item: $editing, onDismiss: { Task { await load() } }) { EmailEditorScreen(target: $0) }
    // One importer for both kinds: a second .fileImporter on the same view would never show.
    .fileImporter(isPresented: $importing, allowedContentTypes: importKind == .json ? [.json] : [.html]) { result in
      let kind = importKind
      Task {
        switch kind {
        case .html: await importHTML(result)
        case .json: await importJSON(result)
        }
      }
    }
  }

  // MARK: Layout

  private var header: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(projectId == nil
        ? "Shared templates: design once, link into any project. Each project fills in its brand and values."
        : "This project's templates, plus shared templates it uses with its own brand and values.")
        .font(.lnMeta)
        .foregroundStyle(Theme.textMuted)
      SearchField(text: $search)
      if !notice.isEmpty {
        HStack(spacing: 8) {
          Label(notice, systemImage: "checkmark.circle").font(.lnMeta).foregroundStyle(Theme.success).lineLimit(2)
          Spacer(minLength: 0)
          if let target = noticeTarget {
            Button("Open shared template") { editing = target; notice = ""; noticeTarget = nil }.buttonStyle(.lnGhost)
          }
          Button { notice = ""; noticeTarget = nil } label: { Image(systemName: "xmark").font(.app(size: 11, weight: .semibold)).foregroundStyle(Theme.textMuted) }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
      }
    }
    .padding(.horizontal, Metrics.gutter)
    .padding(.vertical, 10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 0.5) }
    .alert(prompt?.title ?? "", isPresented: Binding(get: { prompt != nil }, set: { if !$0 { prompt = nil } }), presenting: prompt) { current in
      TextField("Name", text: $promptText)
      Button("Cancel", role: .cancel) {}
      Button(current.action) { Task { await submit(current) } }
    }
  }

  @ViewBuilder private var content: some View {
    if loading {
      SkeletonRows(count: 6)
      Spacer(minLength: 0)
    } else {
      List {
        if !crumbs.isEmpty && search.isEmpty { breadcrumbs.linearRow() }
        ForEach(subfolders) { folderRow($0) }
        if visible.isEmpty {
          EmptyState(
            systemImage: "envelope",
            title: search.isEmpty ? "No templates here yet" : "No templates match",
            message: !search.isEmpty ? "Try another name." : projectId != nil
              ? "Start one from scratch, or add a shared template so this project shares its design."
              : "A shared template is designed once and reused by every project, each with its own logo, colours and copy."
          ) {
            if search.isEmpty { Button { pickerOpen = true } label: { Label(newLabel, systemImage: "plus") }.buttonStyle(.lnPrimaryCompact) }
          }
          .linearRow()
        } else {
          ForEach(visible) { templateRow($0) }
        }
      }
      .linearList()
      .refreshable { await load() }
    }
  }

  private var breadcrumbs: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        Button("All") { folderId = nil }.foregroundStyle(Theme.textMuted)
        ForEach(crumbs) { crumb in
          Image(systemName: "chevron.right").font(.app(size: 10, weight: .semibold)).foregroundStyle(Theme.textDimmed)
          Button(crumb.name) { folderId = crumb.id }
            .fontWeight(crumb.id == folderId ? .medium : .regular)
            .foregroundStyle(crumb.id == folderId ? Theme.textHighlighted : Theme.textMuted)
        }
      }
      .font(.lnCallout)
      .buttonStyle(.plain)
    }
    .frame(height: Metrics.scaled(36))
  }

  private func folderRow(_ folder: EmailFolderItem) -> some View {
    HStack(spacing: 8) {
      Button { folderId = folder.id } label: {
        HStack(spacing: 12) {
          Image(systemName: "folder").font(.app(size: 15)).foregroundStyle(Theme.textMuted).frame(width: 32)
          Text(folder.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Spacer(minLength: 0)
        }
        .frame(minHeight: Metrics.rowHeight)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Menu { folderActions(folder) } label: { ellipsis }.accessibilityLabel("Folder actions")
    }
    .contextMenu { folderActions(folder) }
    .linearRow()
  }

  @ViewBuilder private func folderActions(_ folder: EmailFolderItem) -> some View {
    Button { promptText = folder.name; prompt = .renameFolder(folder) } label: { Label("Rename", systemImage: "pencil") }
    Button(role: .destructive) { confirm = .deleteFolder(folder) } label: { Label("Delete", systemImage: "trash") }
  }

  private func templateRow(_ t: EmailTemplateItem) -> some View {
    HStack(spacing: 8) {
      Button { open(t) } label: {
        HStack(spacing: 12) {
          swatch(t)
          VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
              Text(t.title).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
              if t.isLinked { Tag(text: "Shared template", tint: Theme.accent).layoutPriority(1) }
              if t.shareMode != nil {
                Image(systemName: "globe").font(.app(size: 11)).foregroundStyle(Theme.textMuted).accessibilityLabel("Shared")
              }
            }
            HStack(spacing: 4) {
              if projectId != nil {
                Text(t.key).font(.lnMono)
              } else if let count = usage[t.id], count > 0 {
                Text(count == 1 ? "Used by 1 project" : "Used by \(count) projects")
              } else {
                Text("Not used yet")
              }
              if t.updated > 0 { Text("· \(DateText.day(epochMilliseconds: t.updated))") }
            }
            .font(.lnMeta)
            .foregroundStyle(Theme.textMuted)
            .lineLimit(1)
          }
          Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .frame(minHeight: Metrics.rowHeight)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Menu { templateActions(t) } label: { ellipsis }.accessibilityLabel("Template actions")
    }
    .contextMenu { templateActions(t) }
    .linearRow()
  }

  @ViewBuilder private func templateActions(_ t: EmailTemplateItem) -> some View {
    Section {
      Button { open(t) } label: { Label(t.isLinked ? "Open" : "Edit", systemImage: "pencil") }
      if let masterId = t.masterId {
        Button { editing = EmailEditorTarget(id: masterId, name: t.title) } label: { Label("Edit shared template", systemImage: "square.stack") }
      } else {
        Button { promptText = t.name; prompt = .renameTemplate(t) } label: { Label("Rename", systemImage: "character.cursor.ibeam") }
      }
      Button { Task { await duplicate(t) } } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
      Button { testing = t } label: { Label("Send test…", systemImage: "paperplane") }
      Button { sharing = t } label: { Label(t.shareMode == nil ? "Share…" : "Shared…", systemImage: t.shareMode == nil ? "square.and.arrow.up" : "globe") }
    }
    Section {
      Menu {
        Button {
          if let html = EmailExport.html(t, brand: brand) {
            Clipboard.copy(html)
            show(String(localized: "Email HTML copied"))
          }
        } label: { Label("Copy HTML", systemImage: "doc.on.clipboard") }
        Button { shareFile { try EmailExport.htmlFile(t, brand: brand) } } label: { Label("Share HTML file…", systemImage: "arrow.down.doc") }
        Button { shareFile { try EmailExport.jsonFile(t) } } label: { Label("Share JSON file…", systemImage: "curlybraces") }
        Button { apiTemplate = t } label: { Label("Use via API…", systemImage: "point.3.connected.trianglepath.dotted") }
      } label: { Label("Export", systemImage: "chevron.left.forwardslash.chevron.right") }
        .disabled(t.isLinked && t.master == nil)
    }
    Section {
      Menu {
        Button("Top level") { Task { await move(t, to: nil) } }
        ForEach(folders) { folder in Button(folder.name) { Task { await move(t, to: folder.id) } } }
      } label: { Label("Move to", systemImage: "folder") }
      if projectId != nil && !t.isLinked {
        Button { Task { await copyToMasters(t) } } label: { Label("Copy to shared templates", systemImage: "books.vertical") }
      }
      if t.isLinked { Button { confirm = .detach(t) } label: { Label("Detach", systemImage: "arrow.triangle.branch") } }
    }
    Section {
      Button(role: .destructive) { confirm = .deleteTemplate(t) } label: { Label(t.isLinked ? "Remove from project" : "Delete", systemImage: "trash") }
    }
  }

  private var ellipsis: some View {
    Image(systemName: "ellipsis")
      .font(.app(size: 14, weight: .medium))
      .foregroundStyle(Theme.textMuted)
      .frame(width: 32, height: 32)
      .contentShape(Rectangle())
  }

  /// A thumbnail in the email's own colours: page, card and button (the project accent on linked shared templates).
  private func swatch(_ t: EmailTemplateItem) -> some View {
    var doc = t.document ?? t.master?.document
    if t.isLinked, let current = doc, let brand { doc = EmailRender.applyProjectAccent(current, accent: brand.theme?.accent) }
    let colors = EmailRender.swatch(doc)
    return ZStack {
      RoundedRectangle(cornerRadius: Metrics.radiusSmall).fill(Color(hexString: colors.background) ?? Theme.elevated)
      if doc == nil {
        Image(systemName: "envelope").font(.app(size: 13)).foregroundStyle(Theme.textMuted)
      } else {
        VStack(alignment: .leading, spacing: 2.5) {
          Capsule().fill(Color(hexString: colors.button) ?? Theme.textDimmed).frame(width: 9, height: 2.5)
          Capsule().fill(Color(white: 0.55, opacity: 0.45)).frame(width: 14, height: 2.5)
          Capsule().fill(Color(white: 0.55, opacity: 0.3)).frame(width: 11, height: 2.5)
        }
        .padding(4)
        .frame(width: 22, height: 20, alignment: .topLeading)
        .background(Color(hexString: colors.surface) ?? Theme.field, in: RoundedRectangle(cornerRadius: 3))
      }
    }
    .frame(width: 32, height: 32)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusSmall).strokeBorder(Theme.border))
    .accessibilityHidden(true)
  }

  // MARK: Derived

  private var crumbs: [EmailFolderItem] {
    var out: [EmailFolderItem] = []
    var at = folders.first { $0.id == folderId }
    while let folder = at, out.count < folders.count {
      out.insert(folder, at: 0)
      at = folders.first { $0.id == folder.parentId }
    }
    return out
  }

  private var subfolders: [EmailFolderItem] { search.isEmpty ? folders.filter { $0.parentId == folderId } : [] }

  private var visible: [EmailTemplateItem] {
    let query = search.trimmingCharacters(in: .whitespaces).lowercased()
    return templates.filter { t in
      query.isEmpty ? t.folderId == folderId : "\(t.name) \(t.key) \(t.master?.name ?? "")".lowercased().contains(query)
    }
  }

  // MARK: Actions

  private func runAfterSheet() {
    let action = afterSheet
    afterSheet = nil
    action?()
  }

  private func open(_ t: EmailTemplateItem) {
    if t.isLinked { linked = t } else { editing = EmailEditorTarget(id: t.id, name: t.name) }
  }

  private func replace(_ updated: EmailTemplateItem) {
    guard let index = templates.firstIndex(where: { $0.id == updated.id }) else { return }
    var row = updated
    if row.isLinked && row.master == nil { row.master = templates[index].master }
    templates[index] = row
  }

  private func load() async {
    let query = projectId.map { ["project": $0] } ?? [:]
    let session = session
    do {
      async let list: EmailTemplateList = session.get("/v1/admin/emails", query: query)
      async let folderList: EmailFolderList = session.get("/v1/admin/email-folders", query: query)
      let (fetched, fetchedFolders) = try await (list, folderList)
      templates = fetched.templates
      usage = fetched.usage ?? [:]
      folders = fetchedFolders.folders
      if let folderId, !folders.contains(where: { $0.id == folderId }) { self.folderId = nil }
      if let projectId, let projects: EmailBrandList = try? await session.get("/v1/admin/projects") {
        brand = projects.projects.first { $0.id == projectId }
      }
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
    loading = false
  }

  /// POST /admin/emails into this project and folder; a new design opens in the editor.
  private func create(_ input: [String: JSONValue]) async {
    var body = input
    if let projectId { body["project"] = .string(projectId) }
    if let folderId { body["folder"] = .string(folderId) }
    busy = true
    defer { busy = false }
    do {
      let response: EmailTemplateResponse = try await session.send("/v1/admin/emails", body: body)
      templates.insert(response.template, at: 0)
      editing = EmailEditorTarget(id: response.template.id, name: response.template.name)
    } catch { self.error = error.localizedDescription }
  }

  /// Link a shared template into this project, then open its values. Returns an error for the sheet.
  private func link(master masterId: String) async -> String? {
    guard let projectId else { return nil }
    var body: [String: JSONValue] = ["master": .string(masterId), "project": .string(projectId)]
    if let folderId { body["folder"] = .string(folderId) }
    do {
      let response: EmailTemplateResponse = try await session.send("/v1/admin/emails", body: body)
      templates.insert(response.template, at: 0)
      afterSheet = { linked = response.template }
      addMasterOpen = false
      return nil
    } catch { return error.localizedDescription }
  }

  private func importHTML(_ result: Result<URL, Error>) async {
    let url: URL
    switch result {
    case .success(let picked): url = picked
    case .failure(let failure): error = failure.localizedDescription; return
    }
    let scoped = url.startAccessingSecurityScopedResource()
    let html = try? String(contentsOf: url, encoding: .utf8)
    if scoped { url.stopAccessingSecurityScopedResource() }
    guard let html else { error = String(localized: "Could not read that file."); return }
    // One raw-HTML block: the design stays as written; the title, hidden
    // preheader and page background move into the settings (shared/email/import.ts).
    var (document, title) = EmailHTMLImport.document(from: html)
    if title == "Untitled email" {
      let fallback = url.lastPathComponent.replacing(#/\.html?$/#.ignoresCase(), with: "")
      if !fallback.isEmpty {
        title = fallback
        document = EmailHTMLImport.retitle(document, fallback)
      }
    }
    await create(["document": document, "name": .string(title)])
  }

  // MARK: Export and JSON backup

  private func show(_ message: String, open target: EmailEditorTarget? = nil) {
    notice = message
    noticeTarget = target
  }

  private func shareFile(_ make: () throws -> URL) {
    do { sharedFile = EmailSharedFile(url: try make()) }
    catch { self.error = error.localizedDescription }
  }

  /// Every template of this project (or every shared template) in one file, in the format import takes.
  private func exportAll() async {
    let query = projectId.map { ["project": $0] } ?? [:]
    do {
      let data: JSONValue = try await session.get("/v1/admin/emails/export", query: query)
      let name = EmailFiles.slug(projectId == nil ? "masters" : brand?.name ?? "project", fallback: "emails")
      sharedFile = EmailSharedFile(url: try EmailFiles.write(try EmailFiles.prettyJSON(data), named: "helpbites-emails-\(name).json"))
    } catch { self.error = error.localizedDescription }
  }

  /// A JSON backup: a dry run first says what will change, then it's confirmed.
  private func importJSON(_ result: Result<URL, Error>) async {
    let url: URL
    switch result {
    case .success(let picked): url = picked
    case .failure(let failure): error = failure.localizedDescription; return
    }
    let scoped = url.startAccessingSecurityScopedResource()
    let data = try? Data(contentsOf: url)
    if scoped { url.stopAccessingSecurityScopedResource() }
    guard let data else { error = String(localized: "Could not read that file."); return }
    guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: data) else { error = String(localized: "That file is not valid JSON."); return }
    var items: [JSONValue] = []
    if case .array(let list) = parsed { items = list }
    else if case .object(let root) = parsed, case .array(let list)? = root["templates"] { items = list }
    guard !items.isEmpty else { error = String(localized: "No templates in that file"); return }
    busy = true
    defer { busy = false }
    do {
      let plan = try await runImport(items, dryRun: true)
      confirm = .importJSON(PendingImport(templates: items, fileName: url.lastPathComponent, plan: plan))
    } catch { self.error = error.localizedDescription }
  }

  /// POST /admin/emails/import takes 100 at a time; the totals add up across batches.
  private func runImport(_ items: [JSONValue], dryRun: Bool) async throws -> EmailImportSummary {
    struct Input: Encodable, Sendable { let project: String?; let mode: String; let dryRun: Bool; let templates: [JSONValue] }
    var total = EmailImportSummary(created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, results: [])
    var start = 0
    while start < items.count {
      let batch = Array(items[start..<min(start + 100, items.count)])
      let result: EmailImportSummary = try await session.send("/v1/admin/emails/import", body: Input(project: projectId, mode: "upsert", dryRun: dryRun, templates: batch))
      total.created = (total.created ?? 0) + (result.created ?? 0)
      total.updated = (total.updated ?? 0) + (result.updated ?? 0)
      total.unchanged = (total.unchanged ?? 0) + (result.unchanged ?? 0)
      total.skipped = (total.skipped ?? 0) + (result.skipped ?? 0)
      total.failed = (total.failed ?? 0) + (result.failed ?? 0)
      total.results = (total.results ?? []) + (result.results ?? [])
      start += 100
    }
    return total
  }

  private func finishImport(_ pending: PendingImport) async {
    busy = true
    defer { busy = false }
    do {
      let done = try await runImport(pending.templates, dryRun: false)
      let failed = done.failed ?? 0
      show(String(localized: "\(done.created ?? 0) created, \(done.updated ?? 0) updated") + (failed > 0 ? String(localized: "; \(failed) could not be imported") : ""))
      await load()
    } catch { self.error = error.localizedDescription }
  }

  /// A new shared template with this template's design and variables; the project keeps its own copy.
  private func copyToMasters(_ t: EmailTemplateItem) async {
    struct Input: Encodable, Sendable { let name: String; let document: JSONValue?; let variables: [EmailVariable] }
    do {
      let response: EmailTemplateResponse = try await session.send("/v1/admin/emails", body: Input(name: t.name, document: t.document, variables: t.variables))
      show(String(localized: "Copied “\(t.name)” to shared templates"), open: EmailEditorTarget(id: response.template.id, name: response.template.name))
    } catch { self.error = error.localizedDescription }
  }

  private func submit(_ current: Prompt) async {
    let name = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    do {
      switch current {
      case .newFolder:
        var body: [String: JSONValue] = ["name": .string(name)]
        if let projectId { body["project"] = .string(projectId) }
        if let folderId { body["parent"] = .string(folderId) }
        let response: EmailFolderResponse = try await session.send("/v1/admin/email-folders", body: body)
        folders.append(response.folder)
      case .renameFolder(let folder):
        guard name != folder.name else { return }
        let response: EmailFolderResponse = try await session.send("/v1/admin/email-folders/\(folder.id)", method: "PATCH", body: ["name": JSONValue.string(name)])
        if let index = folders.firstIndex(where: { $0.id == folder.id }) { folders[index] = response.folder }
      case .renameTemplate(let t):
        guard name != t.name else { return }
        let response: EmailTemplateResponse = try await session.send("/v1/admin/emails/\(t.id)", method: "PATCH", body: ["name": JSONValue.string(name)])
        replace(response.template)
      }
    } catch { self.error = error.localizedDescription }
  }

  private func run(_ action: Confirm) async {
    do {
      switch action {
      case .deleteFolder(let folder):
        try await session.delete("/v1/admin/email-folders/\(folder.id)")
        await load()
      case .deleteTemplate(let t):
        try await session.delete("/v1/admin/emails/\(t.id)")
        templates.removeAll { $0.id == t.id }
      case .detach(let t):
        let response: EmailTemplateResponse = try await session.send("/v1/admin/emails/\(t.id)/detach")
        replace(response.template)
        editing = EmailEditorTarget(id: response.template.id, name: response.template.name)
      case .importJSON(let pending):
        await finishImport(pending)
      }
    } catch { self.error = error.localizedDescription }
  }

  private func duplicate(_ t: EmailTemplateItem) async {
    do {
      let response: EmailTemplateResponse = try await session.send("/v1/admin/emails/\(t.id)/duplicate")
      var copy = response.template
      copy.master = t.master
      templates.insert(copy, at: 0)
    } catch { self.error = error.localizedDescription }
  }

  private func move(_ t: EmailTemplateItem, to folder: String?) async {
    do {
      // `folder: null` (not a missing key) is what moves it to the top level.
      let response: EmailTemplateResponse = try await session.send("/v1/admin/emails/\(t.id)", method: "PATCH", body: ["folder": folder.map(JSONValue.string) ?? .null])
      if let index = templates.firstIndex(where: { $0.id == t.id }) { templates[index].folderId = response.template.folderId }
    } catch { self.error = error.localizedDescription }
  }
}
