import SwiftUI
import Observation

// The Pages assistant (web: components/cms/CmsChat.vue), modelled on the email designer's chat
// (Email/EmailChat.swift, whose message, chunk and request types it shares). One conversation
// per page or per component. Every turn sends the live content; the assistant's edits stream
// back as `data-content` and `data-page` parts and go straight into the editor, and a snapshot
// from before the turn undoes it in one tap. A turn keeps running on the server if the app goes
// away; its changes are saved there at the end.

/// What the assistant is talking about: one page (entry), or one component.
struct PagesChatScope: Equatable, Sendable {
  let projectId: String
  var entryId: String?
  var componentId: String?

  /// `base` with the scope (and `extra`) as its query, for a call that takes the path alone.
  func path(_ base: String, extra: [String: String] = [:]) -> String {
    var parts = URLComponents()
    parts.queryItems = query.merging(extra) { $1 }.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
    return base + "?" + (parts.percentEncodedQuery ?? "")
  }

  var query: [String: String] {
    var out = ["project": projectId]
    if let entryId { out["entry"] = entryId }
    if let componentId { out["component"] = componentId }
    return out
  }
}

/// The CmsChat.vue `EDITS`: tools that change the page.
private let pagesEditingTools: Set<String> = ["set_content", "apply_template", "add_block", "update_blocks", "move_block", "remove_block", "update_page"]

@MainActor @Observable final class PagesChatStore {
  let session: SessionStore
  let scope: PagesChatScope

  private(set) var messages: [EmailChatMessage] = []
  private(set) var busy = false
  var error = ""
  private(set) var tier: String
  private(set) var loadingHistory = true

  // What the editor lends the conversation (set by the screen that owns it).
  @ObservationIgnored var content: () -> CmsBlock? = { nil }
  @ObservationIgnored var selectedId: () -> String? = { nil }
  @ObservationIgnored var snapshot: () -> PageDraft? = { nil }
  @ObservationIgnored var restore: (PageDraft) -> Void = { _ in }
  @ObservationIgnored var applyContent: (CmsBlock) -> Void = { _ in }
  @ObservationIgnored var applyPage: (_ name: String?, _ slug: String?, _ style: CmsStyle?) -> Void = { _, _, _ in }
  /// The assistant saved a component (its key): the library is read again.
  @ObservationIgnored var componentSaved: () -> Void = {}
  /// A turn starts (the editor keeps one undo step for all of it) and ends.
  @ObservationIgnored var turnStarted: () -> Void = {}
  @ObservationIgnored var turnEnded: () -> Void = {}

  private var before: [String: PageDraft] = [:]
  @ObservationIgnored private var task: Task<Void, Never>?
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var assistantId: String?
  @ObservationIgnored private var activeText: [String: Int] = [:]
  /// Sent once, when the chat opens empty (the wizard's brief).
  @ObservationIgnored var firstPrompt: String?

  private static let tierKey = "helpbites.emailAiTier"

  init(session: SessionStore, scope: PagesChatScope) {
    self.session = session
    self.scope = scope
    tier = EmailChatTier.named(UserDefaults.standard.string(forKey: Self.tierKey)).value
  }

  var currentTier: EmailChatTier { EmailChatTier.named(tier) }

  func setTier(_ value: String) {
    tier = EmailChatTier.named(value).value
    UserDefaults.standard.set(tier, forKey: Self.tierKey)
  }

  // MARK: History

  func loadHistory() async {
    defer { loadingHistory = false }
    guard messages.isEmpty, !busy else { return }
    do {
      let response: EmailChatHistory = try await session.get("/v1/admin/cms/chat", query: scope.query)
      guard messages.isEmpty, !busy else { return }
      var seen = Set<String>()
      var loaded: [EmailChatMessage] = []
      for stored in response.messages {
        let role = stored.role == "assistant" ? "assistant" : "user"
        var id = stored.id ?? ""
        if id.isEmpty || seen.contains(id) {
          if role == "user", !id.isEmpty { continue }
          id = UUID().uuidString
        }
        seen.insert(id)
        let parts = (stored.parts ?? []).compactMap { EmailChatStore.part($0) }
        guard !parts.isEmpty else { continue }
        loaded.append(EmailChatMessage(id: id, role: role, parts: parts))
      }
      messages = loaded
    } catch {}
    if messages.isEmpty, let prompt = firstPrompt {
      firstPrompt = nil
      send(prompt)
    }
  }

  // MARK: Turns

  @discardableResult
  func send(_ text: String) -> Bool {
    let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !message.isEmpty, !busy else { return false }
    let id = UUID().uuidString
    if let draft = snapshot() { before[id] = draft }
    turnStarted()
    messages.append(EmailChatMessage(id: id, role: "user", parts: [.text(message)]))
    startStreaming()
    return true
  }

  /// Stop the turn; what it already changed stays. The server is told, so it stops too.
  func stop() {
    let asked = messages.last(where: \.isUser)?.id
    task?.cancel()
    task = nil
    generation += 1
    settle()
    busy = false
    assistantId = nil
    activeText = [:]
    turnEnded()
    let path = scope.path("/v1/admin/cms/chat/stream", extra: asked.map { ["message": $0] } ?? [:])
    Task { [session] in try? await session.delete(path) }
  }

  func retry() {
    guard !busy, let last = messages.lastIndex(where: \.isUser) else { return }
    if let draft = before[messages[last].id] { restore(draft) }
    if last + 1 < messages.count { messages.removeSubrange((last + 1)...) }
    turnStarted()
    startStreaming()
  }

  func clear() async {
    if busy { stop() }
    try? await session.delete(scope.path("/v1/admin/cms/chat"))
    messages = []
    before = [:]
    error = ""
  }

  // MARK: Undo a turn

  private func snapshot(before assistantMessageId: String) -> PageDraft? {
    guard let index = messages.firstIndex(where: { $0.id == assistantMessageId }), index > 0 else { return nil }
    let asked = messages[index - 1]
    return asked.isUser ? before[asked.id] : nil
  }

  func changedPage(_ message: EmailChatMessage) -> Bool {
    message.parts.contains { part in
      guard let tool = part.toolValue else { return false }
      return pagesEditingTools.contains(tool.name) && tool.state == "output-available"
    }
  }

  func canUndoTurn(_ assistantMessageId: String) -> Bool {
    guard let index = messages.firstIndex(where: { $0.id == assistantMessageId }) else { return false }
    let message = messages[index]
    guard !message.isUser, changedPage(message) else { return false }
    if busy, index == messages.count - 1 { return false }
    return snapshot(before: assistantMessageId) != nil
  }

  func undoTurn(_ assistantMessageId: String) {
    if let draft = snapshot(before: assistantMessageId) { restore(draft) }
  }

  // MARK: Streaming

  private func startStreaming() {
    task?.cancel()
    error = ""
    generation += 1
    let turn = generation
    busy = true
    assistantId = nil
    activeText = [:]
    task = Task { [weak self] in await self?.stream(turn) }
  }

  private func stream(_ turn: Int) async {
    defer {
      if turn == generation {
        settle()
        busy = false
        assistantId = nil
        activeText = [:]
        task = nil
        turnEnded()
      }
    }
    do {
      guard let request = try makeRequest() else { return }
      let (bytes, response) = try await URLSession.shared.bytes(for: request)
      guard turn == generation else { return }
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if status == 401 {
        await session.recover(APIError.unauthorized)
        if turn == generation { error = APIError.unauthorized.localizedDescription }
        return
      }
      guard status == 200 else {
        var data = Data()
        for try await byte in bytes {
          data.append(byte)
          if data.count >= 65_536 { break }
        }
        let decoded = try? JSONDecoder().decode(EmailChatErrorBody.self, from: data)
        throw APIError.server(decoded?.statusMessage ?? decoded?.message ?? String(localized: "Request failed (\(status))."))
      }
      for try await line in bytes.lines {
        guard turn == generation else { return }
        guard line.hasPrefix("data:") else { continue }
        var payload = line.dropFirst(5)
        if payload.first == " " { payload = payload.dropFirst() }
        if payload == "[DONE]" { break }
        guard let chunk = try? JSONDecoder().decode(EmailChatChunk.self, from: Data(payload.utf8)) else { continue }
        apply(chunk)
      }
    } catch {
      guard turn == generation, !Task.isCancelled else { return }
      if let urlError = error as? URLError, urlError.code == .cancelled { return }
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
  }

  private struct Request: Encodable, Sendable {
    let project: String
    let entry, component: String?
    let messages: [EmailChatRequest.Message]
    let content: CmsBlock?
    let selectedId: String?
    let tier: String
  }

  private func makeRequest() throws -> URLRequest? {
    guard let url = URL(string: "\(session.endpoint)/v1/admin/cms/chat") else { throw APIError.invalidURL }
    let history = messages.suffix(20).compactMap { message -> EmailChatRequest.Message? in
      let parts = message.parts.compactMap(\.textValue).filter { !$0.isEmpty }.map { EmailChatRequest.TextPart(type: "text", text: $0) }
      return parts.isEmpty ? nil : EmailChatRequest.Message(id: message.id, role: message.role, parts: parts)
    }
    let body = Request(project: scope.projectId, entry: scope.entryId, component: scope.componentId, messages: history, content: content(), selectedId: selectedId(), tier: tier)
    var request = URLRequest(url: url, timeoutInterval: 300)
    request.httpMethod = "POST"
    request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    request.httpBody = try JSONEncoder().encode(body)
    return request
  }

  private func apply(_ chunk: EmailChatChunk) {
    switch chunk.type {
    case "start":
      if currentAssistantIndex() == nil { startAssistant(chunk.messageId) }
    case "text-start":
      let index = assistantIndex()
      messages[index].parts.append(.text(""))
      if let key = chunk.id { activeText[key] = messages[index].parts.count - 1 }
    case "text-delta":
      appendText(chunk.delta ?? "", key: chunk.id)
    case "text-end":
      if let key = chunk.id { activeText[key] = nil }
    case "tool-input-start":
      guard let callId = chunk.toolCallId else { return }
      messages[assistantIndex()].updateTool(callId, name: chunk.toolName ?? "tool") { $0.state = "input-streaming" }
    case "tool-input-available":
      guard let callId = chunk.toolCallId else { return }
      let input = chunk.input
      messages[assistantIndex()].updateTool(callId, name: chunk.toolName ?? "tool") { tool in
        tool.input = input
        tool.state = "input-available"
      }
    case "tool-output-available":
      guard let callId = chunk.toolCallId, let index = currentAssistantIndex() else { return }
      let output = chunk.output
      messages[index].updateTool(callId, name: nil) { tool in
        tool.output = output
        tool.state = "output-available"
      }
    case "tool-output-error", "tool-input-error":
      guard let callId = chunk.toolCallId else { return }
      let input = chunk.input
      let errorText = chunk.errorText
      messages[assistantIndex()].updateTool(callId, name: chunk.type == "tool-input-error" ? (chunk.toolName ?? "tool") : nil) { tool in
        if let input { tool.input = input }
        tool.state = "output-error"
        tool.errorText = errorText
      }
    case "data-content":
      // Each edit streams the whole content tree.
      if let data = chunk.data, let block = Self.decode(CmsBlock.self, data) { applyContent(block) }
    case "data-page":
      guard case .object(let fields)? = chunk.data else { return }
      var name: String?, slug: String?
      if case .string(let value)? = fields["name"] { name = value }
      if case .string(let value)? = fields["slug"] { slug = value }
      let style = fields["style"].flatMap { Self.decode(CmsStyle.self, $0) }
      applyPage(name, slug, style)
    case "data-component":
      componentSaved()
    case "error":
      error = chunk.errorText ?? String(localized: "The assistant hit a problem")
    default:
      break
    }
  }

  nonisolated private static func decode<T: Decodable>(_ type: T.Type, _ json: JSONValue) -> T? {
    guard let data = try? JSONEncoder().encode(json) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  private func appendText(_ delta: String, key: String?) {
    let index = assistantIndex()
    if let key, let part = activeText[key], messages[index].parts.indices.contains(part), case .text(let current) = messages[index].parts[part] {
      messages[index].parts[part] = .text(current + delta)
    } else if let part = messages[index].parts.indices.last, case .text(let current) = messages[index].parts[part] {
      messages[index].parts[part] = .text(current + delta)
      if let key { activeText[key] = part }
    } else {
      messages[index].parts.append(.text(delta))
      if let key { activeText[key] = messages[index].parts.count - 1 }
    }
  }

  private func currentAssistantIndex() -> Int? {
    guard let assistantId else { return nil }
    return messages.lastIndex { $0.id == assistantId }
  }

  private func assistantIndex() -> Int { currentAssistantIndex() ?? startAssistant(nil) }

  @discardableResult
  private func startAssistant(_ preferredId: String?) -> Int {
    var id = preferredId ?? ""
    if id.isEmpty || messages.contains(where: { $0.id == id }) { id = UUID().uuidString }
    messages.append(EmailChatMessage(id: id, role: "assistant", parts: []))
    assistantId = id
    return messages.count - 1
  }

  private func settle() {
    guard let index = currentAssistantIndex() else { return }
    if messages[index].parts.isEmpty {
      messages.remove(at: index)
      return
    }
    for part in messages[index].parts.indices {
      if case .tool(var tool) = messages[index].parts[part], tool.isRunning {
        tool.state = "output-error"
        if tool.errorText == nil { tool.errorText = String(localized: "Stopped") }
        messages[index].parts[part] = .tool(tool)
      }
    }
  }
}

// MARK: - Panel

/// The assistant's conversation. No navigation chrome of its own: the editor shows it in a sheet.
struct PagesChatPanel: View {
  @Bindable var chat: PagesChatStore
  let library: CmsLibrary
  /// The block the next request is about, with a way to point at the whole page again.
  let selected: CmsBlock?
  let content: CmsBlock?
  let onSelect: (String?) -> Void
  @State private var draft = ""
  @State private var confirmClear = false
  @FocusState private var focused: Bool

  private static let bottom = "pages-chat-bottom"
  private var isComponent: Bool { chat.scope.componentId != nil }

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(Theme.border).frame(height: 0.5)
      if chat.messages.isEmpty { emptyState } else { transcript }
      footer
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Theme.panel)
    .task { await chat.loadHistory() }
    .confirmationDialog("Start a new chat? The page stays as it is.", isPresented: $confirmClear, titleVisibility: .visible) {
      Button("New chat", role: .destructive) { Task { await chat.clear() } }
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Picker("Model", selection: Binding(get: { chat.tier }, set: { chat.setTier($0) })) {
          ForEach(EmailChatTier.all) { Text($0.label).tag($0.value) }
        }
        .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 200)
        Spacer(minLength: 0)
        if !chat.messages.isEmpty {
          IconButton(systemImage: "square.and.pencil", label: "New chat") { confirmClear = true }.disabled(chat.busy).opacity(chat.busy ? 0.4 : 1)
        }
      }
      Text(chat.currentTier.hint).font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
    .padding(.horizontal, 12).padding(.vertical, 10)
  }

  // MARK: Empty

  private var emptyState: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        if chat.loadingHistory {
          RoundedRectangle(cornerRadius: Metrics.radius).fill(Theme.elevated).frame(height: 96)
        } else {
          Text("What shall we build?").font(.lnRow).foregroundStyle(Theme.textHighlighted)
          Text(isComponent ? "Describe the component, or ask for changes to it." : "Ask for a layout, copy, a component or animations. Click a block first to talk about it.")
            .font(.lnCaption).foregroundStyle(Theme.textMuted).padding(.top, 4)
          VStack(spacing: 8) {
            ForEach(isComponent ? PagesChatPrompts.componentStarters : PagesChatPrompts.pageStarters) { starter in starterButton(starter) }
          }
          .padding(.top, 16)
        }
      }
      .padding(.horizontal, 16).padding(.vertical, 24)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxHeight: .infinity)
    .scrollDismissesKeyboard(.interactively)
  }

  private func starterButton(_ starter: EmailChatSuggestion) -> some View {
    Button { _ = chat.send(starter.prompt) } label: {
      HStack(alignment: .top, spacing: 10) {
        Image(systemName: starter.systemImage).font(.app(size: 13, weight: .medium)).foregroundStyle(Theme.accentText).frame(width: 16).padding(.top, 1)
        VStack(alignment: .leading, spacing: 2) {
          Text(starter.label).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
          Text(starter.prompt).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(2).multilineTextAlignment(.leading)
        }
        Spacer(minLength: 0)
      }
      .padding(10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
      .contentShape(RoundedRectangle(cornerRadius: Metrics.radius))
    }
    .buttonStyle(.plain)
    .disabled(chat.busy)
  }

  // MARK: Transcript

  private var transcript: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          ForEach(chat.messages) { message in
            if message.isUser { userBubble(message) } else { assistantReply(message) }
          }
          if waiting {
            HStack(spacing: 8) { avatar; ProgressView().controlSize(.small) }
              .accessibilityElement(children: .ignore).accessibilityLabel("Working")
          }
          Color.clear.frame(height: 1).id(Self.bottom)
        }
        .padding(.horizontal, 12).padding(.vertical, 14)
      }
      .defaultScrollAnchor(.bottom)
      .scrollDismissesKeyboard(.interactively)
      .frame(maxHeight: .infinity)
      .onAppear { proxy.scrollTo(Self.bottom, anchor: .bottom) }
      .onChange(of: scrollKey) { _, _ in proxy.scrollTo(Self.bottom, anchor: .bottom) }
    }
  }

  private var waiting: Bool {
    guard chat.busy, let last = chat.messages.last else { return false }
    return last.isUser || last.parts.isEmpty
  }

  private var scrollKey: String {
    guard let last = chat.messages.last else { return "" }
    var length = 0
    for part in last.parts { length += part.textValue?.utf8.count ?? 0 }
    return "\(chat.messages.count)|\(last.id)|\(last.parts.count)|\(length)|\(chat.busy)"
  }

  private var avatar: some View {
    Image(systemName: "sparkles").font(.app(size: 11, weight: .semibold)).foregroundStyle(Theme.accentText)
      .frame(width: 22, height: 22).background(Theme.elevated, in: Circle())
  }

  private func userBubble(_ message: EmailChatMessage) -> some View {
    Text(message.text).font(.lnCallout).foregroundStyle(Theme.textHighlighted).textSelection(.enabled)
      .padding(.horizontal, 12).padding(.vertical, 8)
      .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge, style: .continuous))
      .frame(maxWidth: .infinity, alignment: .trailing).padding(.leading, 40)
  }

  private func assistantReply(_ message: EmailChatMessage) -> some View {
    HStack(alignment: .top, spacing: 8) {
      avatar
      VStack(alignment: .leading, spacing: 8) {
        ForEach(Array(message.parts.enumerated()), id: \.offset) { _, part in
          switch part {
          case .text(let text): if !text.isEmpty { KnowledgeMarkdown(text: text) }
          case .tool(let tool): EmailChatChangeChip(change: describe(tool)) { onSelect($0) }
          }
        }
        if chat.canUndoTurn(message.id) {
          Button { chat.undoTurn(message.id) } label: { Label("Undo these changes", systemImage: "arrow.uturn.backward") }
            .buttonStyle(.lnGhost).padding(.leading, -10)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  // MARK: Reading a turn

  private func blockName(_ uid: String?) -> String {
    guard let uid, let content, let block = content.find(uid, library) else { return String(localized: "a block") }
    return library[block.component]?.name ?? block.component
  }

  /// CmsChat.vue describe().
  private func describe(_ tool: EmailChatMessage.Tool) -> EmailChatChange {
    func text(_ key: String) -> String {
      if case .object(let fields)? = tool.input, case .string(let value)? = fields[key] { return value }
      return ""
    }
    func change(_ image: String, _ words: String, uid: String? = nil) -> EmailChatChange {
      EmailChatChange(systemImage: image, text: words, blockId: uid, running: tool.isRunning, failed: tool.state == "output-error")
    }
    var componentName: String {
      if case .object(let fields)? = tool.input, case .object(let block)? = fields["block"], case .string(let key)? = block["component"] { return library[key]?.name ?? key }
      return ""
    }
    switch tool.name {
    case "set_content": return change("rectangle.3.group", tool.isRunning ? String(localized: "Designing the page") : String(localized: "Designed the page"))
    case "apply_template": return change("rectangle.3.group", String(localized: "Started from \(text("template"))"))
    case "add_block": return change("plus", String(localized: "Added \(componentName)"))
    case "update_blocks":
      if case .object(let fields)? = tool.input, case .array(let updates)? = fields["updates"] {
        if updates.count == 1, case .object(let first) = updates[0], case .string(let uid)? = first["uid"] { return change("pencil", String(localized: "Edited \(blockName(uid))"), uid: uid) }
        return change("pencil", String(localized: "Edited \(updates.count) blocks"))
      }
      return change("pencil", String(localized: "Edited blocks"))
    case "move_block": return change("arrow.up.arrow.down", String(localized: "Moved \(blockName(text("uid")))"), uid: text("uid"))
    case "remove_block": return change("trash", String(localized: "Removed a block"))
    case "update_page": return change("paintpalette", String(localized: "Changed the page settings"))
    case "save_component": return change("puzzlepiece", tool.isRunning ? String(localized: "Writing a component") : String(localized: "Saved the component \(text("name").isEmpty ? text("key") : text("name"))"))
    case "get_component": return change("cube", String(localized: "Read \(text("key"))"))
    case "update_brief": return change("target", String(localized: "Updated the messaging brief"))
    case "read_repo": return change("chevron.left.forwardslash.chevron.right", tool.isRunning ? String(localized: "Reading the repository") : String(localized: "Read \(text("repo"))"))
    default: return change("wand.and.stars", tool.name.replacingOccurrences(of: "_", with: " "))
    }
  }

  // MARK: Footer

  private var footer: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !chat.error.isEmpty { errorLine }
      if let selected { selectionPill(selected) }
      if !chat.messages.isEmpty { quickActions }
      composer
    }
    .padding(12)
    .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 0.5) }
  }

  private var errorLine: some View {
    HStack(spacing: 8) {
      Image(systemName: "exclamationmark.circle").font(.app(size: 12, weight: .medium))
      Text(chat.error).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
      Button("Retry") { chat.retry() }.buttonStyle(GhostButtonStyle(tint: Theme.error)).disabled(chat.busy)
    }
    .font(.lnCaption).foregroundStyle(Theme.error)
    .padding(.leading, 10).padding(.vertical, 2)
    .background(Theme.error.opacity(0.08), in: RoundedRectangle(cornerRadius: Metrics.radius))
  }

  private func selectionPill(_ block: CmsBlock) -> some View {
    HStack(spacing: 6) {
      Image(systemName: "cube").font(.app(size: 11, weight: .semibold))
      Text(library[block.component]?.name ?? block.component).lineLimit(1)
      Button { onSelect(nil) } label: {
        Image(systemName: "xmark").font(.app(size: 9, weight: .bold)).foregroundStyle(Theme.textMuted).frame(width: 20, height: 20).contentShape(Circle())
      }
      .buttonStyle(.plain).accessibilityLabel("Clear selection")
    }
    .font(.lnCaptionMedium).foregroundStyle(Theme.textToned)
    .padding(.leading, 10).padding(.trailing, 3).frame(height: Metrics.scaled(26))
    .background(Theme.elevated, in: Capsule())
    .overlay(Capsule().strokeBorder(Theme.border))
  }

  private var quickActions: some View {
    let actions = isComponent ? PagesChatPrompts.componentActions : selected != nil ? PagesChatPrompts.blockActions : PagesChatPrompts.pageActions
    return ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        ForEach(actions) { action in
          Pill(label: action.label) { _ = chat.send(action.prompt) }.disabled(chat.busy).opacity(chat.busy ? 0.5 : 1)
        }
      }
      .padding(.vertical, 1)
    }
  }

  private var placeholder: String {
    if let selected { return String(localized: "Change the \(library[selected.component]?.name ?? selected.component)…") }
    return isComponent ? String(localized: "Describe the component…") : String(localized: "Describe a change, or ask about your messaging…")
  }

  private var canSend: Bool { !chat.busy && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  private var composer: some View {
    HStack(alignment: .bottom, spacing: 6) {
      TextField(placeholder, text: $draft, axis: .vertical)
        .font(.lnBody).lineLimit(1...6).focused($focused).padding(.vertical, 6).padding(.leading, 8)
      if chat.busy {
        Button { chat.stop() } label: {
          Image(systemName: "stop.circle.fill").font(.app(size: 26)).foregroundStyle(Theme.textHighlighted).frame(width: 32, height: 32).contentShape(Circle())
        }
        .buttonStyle(.plain).accessibilityLabel("Stop")
      } else {
        Button(action: submit) {
          Image(systemName: "arrow.up.circle.fill").font(.app(size: 26)).foregroundStyle(canSend ? Theme.accent : Theme.textDimmed).frame(width: 32, height: 32).contentShape(Circle())
        }
        .buttonStyle(.plain).disabled(!canSend).keyboardShortcut(.return, modifiers: .command).accessibilityLabel("Send")
      }
    }
    .padding(5)
    .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge, style: .continuous).strokeBorder(focused ? Theme.borderAccented : Theme.border))
  }

  private func submit() {
    guard chat.send(draft) else { return }
    draft = ""
  }
}

/// CmsChat.vue's starters and quick actions, word for word (en.json projectTools.pages.ai).
enum PagesChatPrompts {
  static let pageStarters = [
    EmailChatSuggestion(systemImage: "chevron.left.forwardslash.chevron.right", label: String(localized: "Build it from my repo"), prompt: "Read my repositories, work out what the product does and who it is for, then rewrite this page's copy to match. Update the messaging brief with what you learn."),
    EmailChatSuggestion(systemImage: "target", label: String(localized: "Sharpen my value proposition"), prompt: "Help me land the value proposition: read the brief and my repositories, propose the audience, the problem, a one-sentence value proposition and three to five key messages with proof, and explain how the page should communicate them."),
    EmailChatSuggestion(systemImage: "pencil.line", label: String(localized: "Rewrite the hero"), prompt: "Rewrite the hero: one concrete promise as the headline, a subhead saying who it is for and how it works, and a clear main button."),
    EmailChatSuggestion(systemImage: "sparkles", label: String(localized: "Add animations"), prompt: "Add tasteful animations: the hero on load, sections fading up as they scroll in, a stagger on grids. Keep it subtle."),
    EmailChatSuggestion(systemImage: "puzzlepiece", label: String(localized: "Write a component"), prompt: "Write a new component this page needs that the built-ins do not cover, then add it to the page.")
  ]
  static let componentStarters = [
    EmailChatSuggestion(systemImage: "puzzlepiece", label: String(localized: "Write it from a description"), prompt: "Write this component: "),
    EmailChatSuggestion(systemImage: "iphone", label: String(localized: "Make it responsive"), prompt: "Make this component work well on phones and tablets."),
    EmailChatSuggestion(systemImage: "text.badge.plus", label: String(localized: "Add fields for the copy"), prompt: "Turn every piece of copy, link and image in this component into a field with a sensible default.")
  ]
  static let componentActions = [
    EmailChatSuggestion(label: String(localized: "Polish the design"), prompt: "Polish the component's design: spacing, type scale, contrast and hover states, using the theme variables."),
    EmailChatSuggestion(label: String(localized: "Make it responsive"), prompt: "Make this component work well on phones and tablets.")
  ]
  static let blockActions = [
    EmailChatSuggestion(label: String(localized: "Rewrite this"), prompt: "Rewrite the copy of the selected block to be more specific and concrete."),
    EmailChatSuggestion(label: String(localized: "Shorter"), prompt: "Make the selected block's copy shorter without losing the point."),
    EmailChatSuggestion(label: String(localized: "Animate this"), prompt: "Add a subtle animation to the selected block."),
    EmailChatSuggestion(label: String(localized: "Make it a component"), prompt: "Turn the selected block into a custom component the project can reuse, with fields for its copy.")
  ]
  static let pageActions = [
    EmailChatSuggestion(label: String(localized: "Improve all the copy"), prompt: "Go through the whole page and improve the copy: specific, outcome-first, no hype, consistent with the brief."),
    EmailChatSuggestion(label: String(localized: "Sharpen my value proposition"), prompt: "Help me land the value proposition: read the brief and my repositories, propose the audience, the problem, a one-sentence value proposition and three to five key messages with proof, and explain how the page should communicate them."),
    EmailChatSuggestion(label: String(localized: "Add social proof"), prompt: "Add social proof where the page makes claims: numbers, logos, testimonials. Use placeholders where I need to fill in real ones."),
    EmailChatSuggestion(label: String(localized: "Answer the objections"), prompt: "Write an FAQ that answers the main objections someone in the audience would have before signing up.")
  ]
}
