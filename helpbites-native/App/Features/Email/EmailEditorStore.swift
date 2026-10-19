import ImageIO
import SwiftUI
import UniformTypeIdentifiers

/// The native email editor's state (web: EmailEditor.vue): the design, what's
/// selected, undo, autosave and live sync with other editors. Every local
/// change goes through `edit`, which records an undo step and saves 800 ms
/// after the last change, as the web editor does.
@MainActor @Observable final class EmailEditorStore {
  enum SaveState: Equatable { case saved, pending, saving, failed(String) }
  enum Mode: String, CaseIterable, Identifiable { case edit, preview; var id: String { rawValue } }
  enum Device: String, CaseIterable, Identifiable {
    case desktop, phone
    var id: String { rawValue }
    var label: String { self == .desktop ? "Desktop" : "Phone" }
    var systemImage: String { self == .desktop ? "desktopcomputer" : "iphone" }
    /// The web editor's preview frames.
    var width: CGFloat { self == .desktop ? 720 : 390 }
  }
  struct Snapshot: Equatable { var design: EmailDesign; var name: String; var variables: [EmailVariable] }

  let session: SessionStore
  /// This editor's saves come back over the live stream tagged with it, so it can skip them.
  let actorId = UUID().uuidString
  let chat: EmailChatStore

  /// The template being edited (a linked row opens its master).
  private(set) var id: String
  private(set) var template: EmailTemplateItem?
  private(set) var brand: EmailBrand?
  private(set) var loading = true
  private(set) var loadError = ""

  private(set) var design = EmailDesign(nil)
  private(set) var name: String
  private(set) var variables: [EmailVariable] = []
  /// The design with sample values and the project brand filled in: what the canvas shows.
  private(set) var resolved = EmailDesign(nil)
  private(set) var issues: [EmailIssue] = []
  private(set) var saveState = SaveState.saved

  var selectedId: String?
  var mode = Mode.edit
  var device = Device.desktop
  /// A problem to show briefly (an upload that failed, a starter that didn't load).
  var notice = ""

  /// The component library: the shared components, plus this project's own.
  private(set) var library: [EmailComponentDef] = []
  /// The library route answered. Sections and components are offered only then,
  /// so this app never adds block types an older server would strip.
  private(set) var supportsComponents = false
  /// The component sheet to show (Save as component, Edit component, New component…).
  var componentRequest: EmailComponentRequest?
  /// The AI's provisional design while a turn writes it: shown, never saved.
  private(set) var draft: EmailDesign?
  /// The draft as the canvas shows it (sample values and brand filled in).
  private(set) var resolvedDraft: EmailDesign?

  private var undoStack: [Snapshot] = []
  private var redoStack: [Snapshot] = []
  private var lastEditAt = Date.distantPast
  private var revision = 0
  private var savedRevision = 0
  private var saving = false
  private var saveAgain = false
  private var debounce: Task<Void, Never>?
  private var starters: [String: (name: String, document: JSONValue)] = [:]
  private var libraryRequested = false

  init(target: EmailEditorTarget, session: SessionStore) {
    self.session = session
    id = target.id
    name = target.name
    chat = EmailChatStore(session: session)
    chat.editor = self
  }

  var isMaster: Bool { template?.projectId == nil }
  var canUndo: Bool { !undoStack.isEmpty }
  var canRedo: Bool { !redoStack.isEmpty }
  var selected: EmailDesignBlock? { selectedId.flatMap(design.block) }
  var errorCount: Int { issues.filter { $0.level == .error }.count }

  /// The exact email, for Preview and exports (the AI's draft while it writes one, as on the web).
  var previewHTML: String { EmailRender.html((resolvedDraft ?? resolved).json) }

  /// The template as it stands right now, for the test, share, export and API sheets.
  var currentItem: EmailTemplateItem? {
    guard var item = template else { return nil }
    item.document = design.json
    item.variables = variables
    item.name = name
    return item
  }

  /// What "Fix with AI" asks for (EmailEditor.vue fixWithAi).
  var fixPrompt: String {
    "Fix these problems found by the email checks (skip any that need information only I have, and tell me what I must do):\n" + issues.map { "- \($0.fix)" }.joined(separator: "\n")
  }

  /// The share sheet and "Use via API" change the row itself, not the design.
  func updateShare(mode: String?, token: String?) {
    template?.shareMode = mode
    template?.shareToken = token
  }

  func updateKey(_ key: String) { template?.key = key }

  /// EmailVariables.vue: every placeholder in the design, with what's stored about it.
  var detectedVariables: [EmailVariable] {
    design.placeholderKeys.map { key in variables.first { $0.key == key } ?? EmailVariable(key: key) }
  }

  // MARK: Loading

  /// Loads the template, then follows its live stream until the view goes away.
  func start() async {
    if template == nil { await load() }
    guard template != nil else { return }
    if !libraryRequested {
      libraryRequested = true
      Task { await loadLibrary() }
    }
    await listen()
  }

  /// The component library, once per editor (the starters are cached the same way).
  private func loadLibrary() async {
    do {
      library = try await EmailComponentAPI.list(session, projectId: template?.projectId)
      supportsComponents = true
    } catch {} // the editor works without it
  }

  /// A component saved here or by the AI replaces its old version (EmailEditor.vue keepInLibrary).
  func keepInLibrary(_ component: EmailComponentDef) {
    library = (library.filter { $0.id != component.id } + [component]).sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
  }

  /// The AI's draft (data-draft), or nil once the real edit arrives or the turn ends.
  func setDraft(_ next: EmailDesign?) {
    guard next != draft else { return }
    draft = next
    resolvedDraft = next.map { EmailDesign(EmailRender.resolve(document: $0.json, variables: variables, values: [:], linked: false, brand: brand)) }
  }

  private func load() async {
    loading = true
    loadError = ""
    do {
      var response: EmailTemplateResponse = try await session.get("/v1/admin/emails/\(id)")
      // A linked row is designed in its master (pages/emails/[id].vue redirects the same way).
      if let masterId = response.template.masterId {
        id = masterId
        response = try await session.get("/v1/admin/emails/\(masterId)")
      }
      let loaded = response.template
      if let projectId = loaded.projectId {
        let list: EmailBrandList? = try? await session.get("/v1/admin/projects")
        brand = list?.projects.first { $0.id == projectId }
      }
      template = loaded
      design = EmailDesign(loaded.document)
      name = loaded.name
      variables = loaded.variables
      recompute()
      // An imported HTML email has nothing to edit natively but its source: show it as it sends.
      if !design.blocks.isEmpty, design.blocks.allSatisfy({ $0.kind == .html }) { mode = .preview }
    } catch {
      loadError = error.localizedDescription
    }
    loading = false
  }

  // MARK: Editing

  /// The one path for local changes: an undo step (edits within 600 ms merge), then an autosave.
  func edit(_ change: (inout EmailDesign) -> Void) {
    var next = design
    change(&next)
    guard next != design else { return }
    let now = Date()
    if now.timeIntervalSince(lastEditAt) > 0.6 { pushUndo() }
    lastEditAt = now
    design = next
    changed()
  }

  func editBlock(_ id: String, _ change: (inout EmailDesignBlock) -> Void) {
    edit { $0.update(id, change) }
  }

  /// A binding to one field of one block, for the inspector.
  func binding<Value>(_ id: String, _ field: WritableKeyPath<EmailDesignBlock, Value>, default fallback: Value) -> Binding<Value> {
    Binding(
      get: { [weak self] in self?.design.block(id)?[keyPath: field] ?? fallback },
      set: { [weak self] value in self?.editBlock(id) { $0[keyPath: field] = value } }
    )
  }

  /// A binding to one email setting.
  func binding<Value>(_ field: WritableKeyPath<EmailDesignSettings, Value>) -> Binding<Value> {
    let fallback = design.settings[keyPath: field]
    return Binding(
      get: { [weak self] in self?.design.settings[keyPath: field] ?? fallback },
      set: { [weak self] value in self?.edit { $0.settings[keyPath: field] = value } }
    )
  }

  func applyTheme(_ change: (inout EmailDesignTheme) -> Void) {
    edit { $0.applyTheme(change) }
  }

  func setName(_ value: String) {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed != name else { return }
    name = trimmed
    changed()
  }

  /// A variable's label or sample value (EmailVariables.vue emits every detected key).
  func setVariable(_ key: String, label: String? = nil, sample: String? = nil) {
    var list = detectedVariables
    guard let index = list.firstIndex(where: { $0.key == key }) else { return }
    if let label { list[index].label = label.isEmpty ? nil : label }
    if let sample { list[index].defaultValue = sample.isEmpty ? nil : sample }
    guard list != variables else { return }
    variables = list
    changed()
  }

  /// Replace the whole design: the AI's stream (no undo step of its own) or a starter / turn undo.
  func replace(_ next: EmailDesign, history: Bool) {
    guard next != design else { return }
    if history { pushUndo() }
    lastEditAt = .distantPast
    design = next
    changed()
  }

  /// One undo step for what comes next (an AI turn).
  func checkpoint() {
    pushUndo()
    lastEditAt = .distantPast
  }

  /// The design before a change, to hand back later (an AI turn's "Undo these changes").
  var snapshot: Snapshot { Snapshot(design: design, name: name, variables: variables) }

  func restore(_ snapshot: Snapshot) {
    pushUndo()
    apply(snapshot)
  }

  /// Variables the AI gave labels and samples to (set_variables).
  func replaceVariables(_ next: [EmailVariable]) {
    guard next != variables else { return }
    variables = next
    changed()
  }

  func undo() {
    guard let previous = undoStack.popLast() else { return }
    redoStack.append(snapshot)
    apply(previous)
  }

  func redo() {
    guard let next = redoStack.popLast() else { return }
    undoStack.append(snapshot)
    apply(next)
  }

  private func pushUndo() {
    undoStack.append(snapshot)
    if undoStack.count > 50 { undoStack.removeFirst(undoStack.count - 50) }
    redoStack.removeAll()
  }

  private func apply(_ snapshot: Snapshot) {
    design = snapshot.design
    name = snapshot.name
    variables = snapshot.variables
    lastEditAt = .distantPast
    changed()
  }

  // MARK: Blocks

  /// Where an Add menu puts a block.
  enum Placement: Equatable {
    /// EmailEditor.vue insert(): after the selection in its own list, at the end of a
    /// selected section, at the end of the email with nothing selected.
    case afterSelection
    /// A top-level position (the canvas's + handles and its Add row).
    case top(Int)
    /// The end of one list of a container: a column, or a section's blocks (column 0).
    case inside(parent: String, column: Int)
  }

  /// The block types an Add menu offers there: never a component (those come from
  /// the library), sections only when the server has them, and no containers in columns.
  func addableKinds(inColumns: Bool = false) -> [EmailBlockKind] {
    EmailBlockKind.allCases.filter { kind in
      kind != .component && (kind != .section || supportsComponents) && !(inColumns && kind.isContainer)
    }
  }

  func add(_ kind: EmailBlockKind, _ placement: Placement = .afterSelection) {
    var block = kind.make(id: freshId())
    block.fields.merge(kind.start) { $1 }
    insert(block, placement)
  }

  /// A library component, as a new instance at its defaults.
  func add(_ component: EmailComponentDef, _ placement: Placement = .afterSelection) {
    insert(component.instance(id: freshId()), placement)
  }

  private func insert(_ block: EmailDesignBlock, _ placement: Placement) {
    let container = block.kind?.isContainer == true
    switch placement {
    case .top(let index):
      edit { $0.insert(block, at: index) }
    case .inside(let parent, let column):
      // Sections and columns never go inside columns.
      guard !(container && design.block(parent)?.kind == .columns) else { return }
      edit { $0.insert(block, inColumnsOf: parent, column: column) }
    case .afterSelection:
      let target = afterSelection(container: container)
      edit { design in
        if let parent = target.parent { design.insert(block, inColumnsOf: parent, column: target.column, at: target.index) }
        else { design.insert(block, at: target.index) }
      }
    }
    selectedId = block.id
  }

  /// After the selection in its own list; inside a selected section, at its end; with
  /// nothing selected, at the end. A container that would land in a column goes after the columns block.
  private func afterSelection(container: Bool) -> (parent: String?, column: Int, index: Int?) {
    guard let id = selectedId, let at = design.location(of: id) else { return (nil, 0, nil) }
    func after(_ location: EmailDesign.Location) -> (parent: String?, column: Int, index: Int?) {
      switch location {
      case .top(let index): (nil, 0, index + 1)
      case .column(let parent, let column, let index): (parent, column, index + 1)
      }
    }
    if container, case .column(let parent, _, _) = at, design.block(parent)?.kind == .columns, let columns = design.location(of: parent) {
      return after(columns)
    }
    return design.block(id)?.kind == .section ? (id, 0, nil) : after(at)
  }

  /// replaceBlockWith(): a block swapped for others in its place (fresh ids where
  /// needed); the first is selected.
  func replace(_ id: String, with blocks: [EmailDesignBlock]) {
    var ids: [String]?
    edit { ids = $0.replace(id, with: blocks) }
    if let first = ids?.first { selectedId = first }
  }

  /// "Save as component": the sheet starts from the block's HTML (a section's as a
  /// rendered table, `{{variables}}` kept), and the block becomes what it saves.
  func saveAsComponent(_ id: String) {
    guard let block = design.block(id) else { return }
    let html = block.kind == .html ? block.html : EmailRender.blockTable(block.json, design.settings.contentWidth)
    componentRequest = EmailComponentRequest(html: html, replaceId: id)
  }

  /// "Edit component": the library's version, or this copy as a new one when the library no longer has it.
  func editComponent(_ id: String) {
    guard let block = design.block(id) else { return }
    if let component = library.first(where: { $0.id == block.componentId }) {
      componentRequest = EmailComponentRequest(component: component, replaceId: id)
    } else {
      componentRequest = EmailComponentRequest(name: block.name, html: block.html, replaceId: id)
    }
  }

  /// EmailEditor.vue onComponentSaved(): the library gets it, and the block it came
  /// from becomes it (an instance of it already brings its values along).
  func componentSaved(_ component: EmailComponentDef, replacing replaceId: String?) {
    keepInLibrary(component)
    guard let replaceId, let old = design.block(replaceId) else { return }
    var next: EmailDesignBlock
    if old.kind == .component, old.componentId == component.id {
      next = old
      component.refresh(&next)
    } else {
      next = component.instance(id: "") // replace() gives it a fresh id
      // Only custom HTML keeps its padding and background outside its markup; a
      // section's rendered HTML already holds them, so they would double up.
      if old.kind == .html || old.kind == .component {
        next.padding = old.padding
        next.background = old.background
      }
    }
    replace(replaceId, with: [next])
  }

  func remove(_ id: String) {
    edit { $0.remove(id) }
    if selectedId == id || design.block(selectedId ?? "") == nil { selectedId = nil }
  }

  func duplicate(_ id: String) {
    var copyId: String?
    edit { copyId = $0.duplicate(id) }
    if let copyId { selectedId = copyId }
  }

  func shift(_ id: String, by offset: Int) { edit { $0.shift(id, by: offset) } }

  /// moveBlock: a top-level block to an index (drag and drop, the layers list).
  func move(_ id: String, to index: Int) { edit { $0.move(id, to: index) } }

  /// 1–4 columns; a removed column's blocks move into the one before it.
  func setColumnCount(_ id: String, _ count: Int) {
    editBlock(id) { block in
      var columns = block.columns
      let target = min(4, max(1, count))
      while columns.count < target { columns.append([]) }
      while columns.count > target {
        let last = columns.removeLast()
        columns[columns.count - 1].append(contentsOf: last)
      }
      block.columns = columns
    }
  }

  /// The section or columns block a nested block sits in, if any.
  func parent(of id: String) -> String? {
    if case .column(let parent, _, _)? = design.location(of: id) { return parent }
    return nil
  }

  private func freshId() -> String { EmailDesignBlock.newId(avoiding: Set(design.allBlocks.map(\.id))) }

  // MARK: Starters

  /// "Start from a template": its design (and name) replace this one; undo brings it back.
  func applyStarter(_ starterId: String) async {
    struct Starter: Decodable, Sendable { let id, name: String; let document: JSONValue }
    struct Response: Decodable, Sendable { let starters: [Starter] }
    if starters.isEmpty {
      do {
        let response: Response = try await session.get("/v1/admin/emails/starters")
        for starter in response.starters { starters[starter.id] = (starter.name, starter.document) }
      } catch {
        notice = error.localizedDescription
        return
      }
    }
    guard let starter = starters[starterId] else { notice = "That starter isn't available on this server."; return }
    pushUndo()
    design = EmailDesign(starter.document)
    name = starter.name
    selectedId = nil
    lastEditAt = .distantPast
    changed()
  }

  func applyBlank() {
    replace(EmailDesign(EmailRender.emptyDocument), history: true)
    selectedId = nil
  }

  // MARK: Images

  /// Upload a picked image and put it in the block it was picked for: an image's
  /// `src`, or a component's image field (`field`).
  func uploadImage(_ data: Data, into blockId: String, field: String? = nil) async {
    do {
      let file = try EmailImageUpload.prepare(data)
      let stored: Attachment = try await session.upload("/v1/admin/emails/\(id)/image", file: file.data, filename: "image.\(file.ext)", mimeType: file.mime)
      editBlock(blockId) { block in
        if let field { block.setComponentValue(field, stored.url) } else { block.src = stored.url }
      }
    } catch {
      notice = error.localizedDescription
    }
  }

  // MARK: Saving

  private func changed() {
    if let selectedId, design.block(selectedId) == nil { self.selectedId = nil }
    recompute()
    revision += 1
    saveState = .pending
    debounce?.cancel()
    debounce = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(800))
      guard !Task.isCancelled else { return }
      // Its own task: the next keystroke cancels the wait, never a save in flight.
      Task { await self?.save() }
    }
  }

  private func recompute() {
    resolved = EmailDesign(EmailRender.resolve(document: design.json, variables: variables, values: [:], linked: false, brand: brand))
    issues = EmailLint.issues(design, master: isMaster)
  }

  /// PATCH the design; the server's reconciled variables come back and are kept
  /// unless something changed meanwhile.
  func save() async {
    guard template != nil else { return }
    if saving { saveAgain = true; return }
    saving = true
    saveState = .saving
    let sent = revision
    struct Input: Encodable, Sendable { let document: JSONValue; let name: String; let variables: [EmailVariable]; let actorId: String }
    do {
      let response: EmailTemplateResponse = try await session.send("/v1/admin/emails/\(id)", method: "PATCH", body: Input(document: design.json, name: name, variables: variables, actorId: actorId))
      template = response.template
      savedRevision = max(savedRevision, sent)
      if revision == sent {
        if response.template.variables != variables { variables = response.template.variables; recompute() }
        saveState = .saved
      }
    } catch {
      if revision == sent { saveState = .failed(error.localizedDescription) }
    }
    saving = false
    if saveAgain {
      saveAgain = false
      await save()
    }
  }

  var hasUnsavedChanges: Bool { revision != savedRevision }

  /// Save now (Done, going to the background, before Stop wins over the AI's own save).
  func flush() async {
    debounce?.cancel()
    while saving { try? await Task.sleep(for: .milliseconds(50)) }
    if hasUnsavedChanges { await save() }
  }

  // MARK: Live sync

  /// What GET /v1/admin/emails/:id/events sends after every save.
  private struct LiveEvent: Decodable, Sendable {
    struct Template: Decodable, Sendable {
      let id: String?
      let name: String?
      let document: JSONValue?
      let variables: [EmailVariable]?
      let lastActorId: String?
    }
    let type: String?
    let template: Template?
  }

  /// Another editor's saves (the web panel, a teammate, the AI's final save)
  /// replace this design, as on the web; our own come back tagged and are skipped.
  private func listen() async {
    var attempt = 0
    while !Task.isCancelled {
      do {
        guard let url = URL(string: "\(session.endpoint)/v1/admin/emails/\(id)/events") else { return }
        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { await session.recover(APIError.unauthorized); return }
        guard status == 200 else { throw URLError(.badServerResponse) }
        if attempt > 0 { await catchUp() }
        attempt = 0
        for try await line in bytes.lines where line.hasPrefix("data:") {
          guard let event = try? JSONDecoder().decode(LiveEvent.self, from: Data(line.dropFirst(5).utf8)),
                event.type == "email.updated", let remote = event.template, remote.id == nil || remote.id == id,
                remote.lastActorId != actorId else { continue }
          applyRemote(name: remote.name, document: remote.document, variables: remote.variables)
        }
      } catch {}
      if Task.isCancelled { return }
      attempt += 1
      try? await Task.sleep(for: .seconds(min(30, 1 << min(attempt, 5))))
    }
  }

  /// After a dropped connection: take the saved design unless we have edits of our own waiting.
  private func catchUp() async {
    guard !hasUnsavedChanges, !saving, let response: EmailTemplateResponse = try? await session.get("/v1/admin/emails/\(id)") else { return }
    guard response.template.lastActorId != actorId else { return }
    applyRemote(name: response.template.name, document: response.template.document, variables: response.template.variables)
  }

  private func applyRemote(name remoteName: String?, document: JSONValue?, variables remoteVariables: [EmailVariable]?) {
    debounce?.cancel()
    if let document { design = EmailDesign(document) }
    if let remoteName { name = remoteName }
    if let remoteVariables { variables = remoteVariables }
    if let selectedId, design.block(selectedId) == nil { self.selectedId = nil }
    recompute()
    savedRevision = revision
    saveState = .saved
  }
}

// MARK: - Image upload

/// A picked image made ready for an email: PNG, GIF and WebP up to 2 MB go up
/// as they are; everything else (HEIC, big photos) becomes a JPEG at most
/// 1200 px wide, which is plenty for a 600 px email and stays far under the
/// server's 8 MB cap.
enum EmailImageUpload {
  static let maxBytes = 2 * 1024 * 1024
  static let maxPixels = 1200

  static func prepare(_ data: Data) throws -> (data: Data, mime: String, ext: String) {
    let kept: [(magic: [UInt8], mime: String, ext: String)] = [
      ([0x89, 0x50, 0x4E, 0x47], "image/png", "png"),
      ([0x47, 0x49, 0x46], "image/gif", "gif"),
      ([0x52, 0x49, 0x46, 0x46], "image/webp", "webp"),
      ([0xFF, 0xD8, 0xFF], "image/jpeg", "jpg")
    ]
    if data.count <= maxBytes, let match = kept.first(where: { data.starts(with: $0.magic) }) {
      return (data, match.mime, match.ext)
    }
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw APIError.server("Couldn't read that image.") }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw APIError.server("Couldn't read that image.") }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else { throw APIError.server("Couldn't read that image.") }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw APIError.server("Couldn't read that image.") }
    return (output as Data, "image/jpeg", "jpg")
  }
}
