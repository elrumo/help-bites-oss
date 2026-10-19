import Foundation
import Observation

// The AI designer's conversation (web: EmailChat.vue + the AI SDK's Chat).
// Every turn sends the live design; the model's edits stream back as
// `data-document` / `data-variables` parts and go straight into the editor,
// with one undo step for the whole turn and a snapshot from before it so the
// turn can be undone in one tap. A big edit shows as a `data-draft` while it's
// written (never saved), and components the designer saves (`data-component`)
// join the editor's library. The conversation is stored per template.

// MARK: - Model

/// One message of the conversation, as the AI SDK's UI messages carry it:
/// only text and tool parts are kept (steps, reasoning and data parts aren't shown).
struct EmailChatMessage: Identifiable, Equatable, Sendable {
  /// One tool call (`tool-<name>` part) and how far it got.
  struct Tool: Equatable, Sendable {
    var name: String
    /// input-streaming, input-available, output-available or output-error.
    var state: String
    var input: JSONValue?
    var output: JSONValue?
    var errorText: String?
    let toolCallId: String

    var isRunning: Bool { state == "input-streaming" || state == "input-available" }
  }

  enum Part: Equatable, Sendable {
    case text(String)
    case tool(Tool)

    var textValue: String? {
      if case .text(let value) = self { return value }
      return nil
    }

    var toolValue: Tool? {
      if case .tool(let value) = self { return value }
      return nil
    }
  }

  /// The tools that change the design (EmailChat.vue EDITING_TOOLS).
  static let editingTools: Set<String> = ["set_document", "update_settings", "update_blocks", "add_block", "replace_block", "remove_block", "move_block", "set_theme", "set_variables", "save_component"]

  let id: String
  /// "user" or "assistant".
  let role: String
  var parts: [Part]

  var isUser: Bool { role == "user" }

  /// The words of the message (its text parts).
  var text: String { parts.compactMap(\.textValue).joined(separator: "\n") }

  /// changedDesign(): a design tool finished in this reply.
  var changedDesign: Bool {
    parts.contains { part in
      guard let tool = part.toolValue else { return false }
      return Self.editingTools.contains(tool.name) && tool.state == "output-available"
    }
  }

  /// Change one tool part by its call id; with a `name`, a missing part is added first.
  mutating func updateTool(_ toolCallId: String, name: String?, _ change: (inout Tool) -> Void) {
    for index in parts.indices {
      if case .tool(var tool) = parts[index], tool.toolCallId == toolCallId {
        change(&tool)
        parts[index] = .tool(tool)
        return
      }
    }
    guard let name else { return }
    var tool = Tool(name: name, state: "input-streaming", input: nil, output: nil, errorText: nil, toolCallId: toolCallId)
    change(&tool)
    parts.append(.tool(tool))
  }
}

/// shared/email/ai.ts EMAIL_AI_TIERS: High (fast) and Ultra (strongest).
struct EmailChatTier: Identifiable, Equatable, Sendable {
  let value: String
  let label: String
  let hint: String
  var id: String { value }

  static let all = [
    EmailChatTier(value: "high", label: "High", hint: "Fast. Good for edits and copy."),
    EmailChatTier(value: "ultra", label: "Ultra", hint: "Strongest. New designs and big rewrites.")
  ]

  /// emailAiTier(): anything but "ultra" is High.
  static func named(_ value: String?) -> EmailChatTier { value == "ultra" ? all[1] : all[0] }
}

// MARK: - Wire

/// GET /v1/admin/emails/:id/chat: AI SDK UI messages, oldest first.
private struct EmailChatHistory: Decodable, Sendable {
  struct Message: Decodable, Sendable {
    let id: String?
    let role: String?
    let parts: [JSONValue]?
  }
  let messages: [Message]
}

/// POST /v1/admin/emails/:id/chat. Earlier turns go as their words only: the
/// server keeps only text for them anyway, and old tool inputs are whole documents.
private struct EmailChatRequest: Encodable, Sendable {
  struct Message: Encodable, Sendable {
    let id: String
    let role: String
    let parts: [TextPart]
  }
  struct TextPart: Encodable, Sendable {
    let type: String
    let text: String
  }
  let messages: [Message]
  let document: JSONValue
  let variables: [EmailVariable]
  /// Left out of the JSON when nothing is selected.
  let selectedId: String?
  let tier: String
  let actorId: String
}

/// One chunk of the AI SDK UI message stream. Every field but `type` is read
/// leniently: a chunk with a field of an unexpected shape still applies.
private struct EmailChatChunk: Decodable, Sendable {
  let type: String
  let id: String?
  let delta: String?
  let messageId: String?
  let toolCallId: String?
  let toolName: String?
  let errorText: String?
  let input: JSONValue?
  let output: JSONValue?
  let data: JSONValue?

  private enum CodingKeys: String, CodingKey {
    case type, id, delta, messageId, toolCallId, toolName, errorText, input, output, data
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    type = try container.decode(String.self, forKey: .type)
    id = try? container.decodeIfPresent(String.self, forKey: .id)
    delta = try? container.decodeIfPresent(String.self, forKey: .delta)
    messageId = try? container.decodeIfPresent(String.self, forKey: .messageId)
    toolCallId = try? container.decodeIfPresent(String.self, forKey: .toolCallId)
    toolName = try? container.decodeIfPresent(String.self, forKey: .toolName)
    errorText = try? container.decodeIfPresent(String.self, forKey: .errorText)
    input = try? container.decodeIfPresent(JSONValue.self, forKey: .input)
    output = try? container.decodeIfPresent(JSONValue.self, forKey: .output)
    data = try? container.decodeIfPresent(JSONValue.self, forKey: .data)
  }
}

/// A failed request's JSON body (h3's createError).
private struct EmailChatErrorBody: Decodable, Sendable {
  let statusMessage: String?
  let message: String?
}

// MARK: - Store

@MainActor @Observable final class EmailChatStore {
  let session: SessionStore
  /// The editor this conversation designs (it owns this store).
  @ObservationIgnored weak var editor: EmailEditorStore?

  private(set) var messages: [EmailChatMessage] = []
  /// A turn is being sent or streamed.
  private(set) var busy = false
  /// The last turn's problem, shown with Retry.
  var error = ""
  /// "high" or "ultra", remembered on this device.
  private(set) var tier: String
  /// True until the stored conversation has been fetched once.
  private(set) var loadingHistory = true

  /// The design before each turn, by the user message that started it.
  private var before: [String: EmailEditorStore.Snapshot] = [:]

  // The turn in flight. `generation` changes on every new turn and on Stop, so a
  // cancelled stream that still delivers a buffered line can't touch the next one.
  @ObservationIgnored private var task: Task<Void, Never>?
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var assistantId: String?
  /// Open text parts: the stream's text id → index in the reply's parts.
  @ObservationIgnored private var activeText: [String: Int] = [:]

  private static let tierKey = "helpbites.emailAiTier"

  init(session: SessionStore) {
    self.session = session
    tier = EmailChatTier.named(UserDefaults.standard.string(forKey: Self.tierKey)).value
  }

  var currentTier: EmailChatTier { EmailChatTier.named(tier) }

  func setTier(_ value: String) {
    let next = EmailChatTier.named(value).value
    tier = next
    UserDefaults.standard.set(next, forKey: Self.tierKey)
  }

  // MARK: History

  /// The stored conversation, unless this one already has messages.
  func loadHistory() async {
    defer { loadingHistory = false }
    // A linked row's editor switches to its master while it loads: ask for the right one.
    while editor?.loading == true, !Task.isCancelled {
      try? await Task.sleep(for: .milliseconds(150))
    }
    guard let editor, messages.isEmpty, !busy else { return }
    do {
      let response: EmailChatHistory = try await session.get("/v1/admin/emails/\(editor.id)/chat")
      guard messages.isEmpty, !busy else { return }
      var seen = Set<String>()
      var loaded: [EmailChatMessage] = []
      for stored in response.messages {
        let role = stored.role == "assistant" ? "assistant" : "user"
        var id = stored.id ?? ""
        if id.isEmpty || seen.contains(id) {
          // A retried turn stores its question again under the same id.
          if role == "user", !id.isEmpty { continue }
          id = UUID().uuidString
        }
        seen.insert(id)
        let parts = (stored.parts ?? []).compactMap { Self.part($0) }
        guard !parts.isEmpty else { continue }
        loaded.append(EmailChatMessage(id: id, role: role, parts: parts))
      }
      messages = loaded
    } catch {}
  }

  /// A stored UI message part: text and `tool-<name>`; everything else is skipped.
  nonisolated private static func part(_ json: JSONValue) -> EmailChatMessage.Part? {
    guard case .object(let fields) = json, case .string(let type)? = fields["type"] else { return nil }
    if type == "text" {
      if case .string(let text)? = fields["text"] { return .text(text) }
      return nil
    }
    guard type.hasPrefix("tool-") else { return nil }
    var state = "output-available"
    if case .string(let value)? = fields["state"] { state = value }
    var callId = UUID().uuidString
    if case .string(let value)? = fields["toolCallId"], !value.isEmpty { callId = value }
    var errorText: String?
    if case .string(let value)? = fields["errorText"] { errorText = value }
    return .tool(EmailChatMessage.Tool(
      name: String(type.dropFirst(5)),
      state: state,
      input: fields["input"],
      output: fields["output"],
      errorText: errorText,
      toolCallId: callId
    ))
  }

  // MARK: Turns

  /// Ask the designer. Ignored while a turn runs or when there's nothing to say.
  @discardableResult
  func send(_ text: String) -> Bool {
    let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !message.isEmpty, !busy, let editor else { return false }
    let id = UUID().uuidString
    before[id] = editor.snapshot
    editor.checkpoint() // one undo step for the whole turn
    messages.append(EmailChatMessage(id: id, role: "user", parts: [.text(message)]))
    startStreaming()
    return true
  }

  /// Stop the turn; what it already changed stays. Saving right away makes this
  /// app's design win over the server's end-of-turn save.
  func stop() {
    task?.cancel()
    task = nil
    generation += 1
    settle()
    busy = false
    assistantId = nil
    activeText = [:]
    editor?.setDraft(nil) // a draft only lives while its turn does
    Task { [weak self] in await self?.editor?.flush() }
  }

  /// Ask again for the last question (chat.regenerate()).
  func retry() {
    guard !busy, let last = messages.lastIndex(where: \.isUser) else { return }
    if last + 1 < messages.count { messages.removeSubrange((last + 1)...) }
    startStreaming()
  }

  /// Forget the conversation (here and on the server); the email stays as it is.
  func clear() async {
    stop()
    if let editor { try? await session.delete("/v1/admin/emails/\(editor.id)/chat") }
    messages = []
    before = [:]
    error = ""
  }

  // MARK: Undo a turn

  /// The design before the question an assistant reply answers.
  private func snapshot(before assistantMessageId: String) -> EmailEditorStore.Snapshot? {
    guard let index = messages.firstIndex(where: { $0.id == assistantMessageId }), index > 0 else { return nil }
    let asked = messages[index - 1]
    return asked.isUser ? before[asked.id] : nil
  }

  /// "Undo these changes": the reply changed the design, its turn's snapshot is
  /// here, and it isn't still streaming.
  func canUndoTurn(_ assistantMessageId: String) -> Bool {
    guard let index = messages.firstIndex(where: { $0.id == assistantMessageId }) else { return false }
    let message = messages[index]
    guard !message.isUser, message.changedDesign else { return false }
    if busy, index == messages.count - 1 { return false }
    return snapshot(before: assistantMessageId) != nil
  }

  func undoTurn(_ assistantMessageId: String) {
    guard let snapshot = snapshot(before: assistantMessageId) else { return }
    editor?.restore(snapshot)
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
        editor?.setDraft(nil) // a draft only lives while its turn does
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
        throw APIError.server(decoded?.statusMessage ?? decoded?.message ?? "Request failed (\(status)).")
      }
      // One `data:` line per chunk; bytes.lines drops the blank line between frames.
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

  /// The turn's request: the last 20 messages' words, the live design and
  /// variables, the selection, the tier, and this editor's actor id (so the
  /// server's end-of-turn save doesn't come back to it over the live stream).
  private func makeRequest() throws -> URLRequest? {
    guard let editor else { return nil }
    guard let url = URL(string: "\(session.endpoint)/v1/admin/emails/\(editor.id)/chat") else { throw APIError.invalidURL }
    let history = messages.suffix(20).compactMap { message -> EmailChatRequest.Message? in
      let parts = message.parts.compactMap(\.textValue).filter { !$0.isEmpty }.map { EmailChatRequest.TextPart(type: "text", text: $0) }
      return parts.isEmpty ? nil : EmailChatRequest.Message(id: message.id, role: message.role, parts: parts)
    }
    let body = EmailChatRequest(
      messages: history,
      document: editor.design.json,
      variables: editor.variables,
      selectedId: editor.selectedId,
      tier: tier,
      actorId: editor.actorId
    )
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
      let index = assistantIndex()
      messages[index].updateTool(callId, name: chunk.toolName ?? "tool") { tool in
        tool.state = "input-streaming"
      }

    case "tool-input-available":
      guard let callId = chunk.toolCallId else { return }
      let index = assistantIndex()
      let input = chunk.input
      messages[index].updateTool(callId, name: chunk.toolName ?? "tool") { tool in
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
      let index = assistantIndex()
      let input = chunk.input
      let errorText = chunk.errorText
      // An input error can be the first we hear of the call; an output error never is.
      messages[index].updateTool(callId, name: chunk.type == "tool-input-error" ? (chunk.toolName ?? "tool") : nil) { tool in
        if let input { tool.input = input }
        tool.state = "output-error"
        tool.errorText = errorText
      }

    case "data-document":
      // Each edit streams the whole design; anything else isn't a design.
      guard case .object(let root)? = chunk.data, root["settings"] != nil, root["blocks"] != nil else { return }
      editor?.setDraft(nil)
      editor?.replace(EmailDesign(chunk.data), history: false)

    case "data-draft":
      // The email as the call being written would leave it: shown, never saved.
      guard case .object(let root)? = chunk.data, root["settings"] != nil, root["blocks"] != nil else { return }
      editor?.setDraft(EmailDesign(chunk.data))

    case "data-component":
      // The designer saved a component to the library (save_component).
      guard let data = chunk.data, let component = EmailComponentDef(json: data) else { return }
      editor?.keepInLibrary(component)

    case "data-variables":
      guard case .object(let root)? = chunk.data, case .array(let list)? = root["variables"] else { return }
      editor?.replaceVariables(list.compactMap { Self.variable($0) })

    case "error":
      error = chunk.errorText ?? "The AI designer hit a problem"

    default:
      // start-step, finish-step, finish, reasoning-*, tool-input-delta, other data-*.
      break
    }
  }

  /// One `{ key, label?, defaultValue? }` from set_variables.
  nonisolated private static func variable(_ json: JSONValue) -> EmailVariable? {
    guard case .object(let fields) = json, case .string(let key)? = fields["key"], !key.isEmpty else { return nil }
    var variable = EmailVariable(key: key)
    if case .string(let label)? = fields["label"] { variable.label = label }
    if case .string(let value)? = fields["defaultValue"] { variable.defaultValue = value }
    return variable
  }

  private func appendText(_ delta: String, key: String?) {
    let index = assistantIndex()
    if let key, let part = activeText[key], messages[index].parts.indices.contains(part), case .text(let current) = messages[index].parts[part] {
      messages[index].parts[part] = .text(current + delta)
    } else if let part = messages[index].parts.indices.last, case .text(let current) = messages[index].parts[part] {
      // No text-start for it: keep writing the text that's already open.
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

  /// The reply being streamed, started if the stream hasn't said `start` yet.
  private func assistantIndex() -> Int {
    currentAssistantIndex() ?? startAssistant(nil)
  }

  @discardableResult
  private func startAssistant(_ preferredId: String?) -> Int {
    var id = preferredId ?? ""
    if id.isEmpty || messages.contains(where: { $0.id == id }) { id = UUID().uuidString }
    messages.append(EmailChatMessage(id: id, role: "assistant", parts: []))
    assistantId = id
    return messages.count - 1
  }

  /// After a turn ends or stops: calls that never finished show as failed (not
  /// spinning forever), and a reply with nothing in it goes.
  private func settle() {
    guard let index = currentAssistantIndex() else { return }
    if messages[index].parts.isEmpty {
      messages.remove(at: index)
      return
    }
    for part in messages[index].parts.indices {
      if case .tool(var tool) = messages[index].parts[part], tool.isRunning {
        tool.state = "output-error"
        if tool.errorText == nil { tool.errorText = "Stopped" }
        messages[index].parts[part] = .tool(tool)
      }
    }
  }
}
