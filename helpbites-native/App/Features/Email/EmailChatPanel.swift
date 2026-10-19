import SwiftUI

/// The AI designer pane (web: EmailChat.vue). No navigation chrome of its own:
/// the editor shows it in a sheet on iPhone and beside the canvas on iPad and Mac.
struct EmailChatPanel: View {
  @Bindable var store: EmailEditorStore
  @State private var draft = ""
  @State private var confirmClear = false
  @FocusState private var focused: Bool

  private static let bottom = "email-chat-bottom"

  private var chat: EmailChatStore { store.chat }

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(Theme.border).frame(height: 0.5)
      if chat.messages.isEmpty { emptyState } else { transcript }
      footer
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Theme.panel)
    .task { await store.chat.loadHistory() }
    .confirmationDialog("Clear this conversation? The email stays as it is.", isPresented: $confirmClear, titleVisibility: .visible) {
      Button("Clear conversation", role: .destructive) { Task { await store.chat.clear() } }
    }
  }

  // MARK: Header

  /// The model tier (remembered on this device) and Clear conversation.
  private var header: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Picker("Model", selection: Binding(get: { store.chat.tier }, set: { store.chat.setTier($0) })) {
          ForEach(EmailChatTier.all) { tier in Text(tier.label).tag(tier.value) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(maxWidth: 200)
        Spacer(minLength: 0)
        if !chat.messages.isEmpty {
          IconButton(systemImage: "trash", label: "Clear conversation") { confirmClear = true }
            .disabled(chat.busy)
            .opacity(chat.busy ? 0.4 : 1)
        }
      }
      Text(chat.currentTier.hint).font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
  }

  // MARK: Empty

  /// Context-aware starting points.
  private var emptyState: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        if chat.loadingHistory {
          RoundedRectangle(cornerRadius: Metrics.radius).fill(Theme.elevated).frame(height: 96)
        } else {
          Text("What should this email do?").font(.lnRow).foregroundStyle(Theme.textHighlighted)
          Text(emptyHint)
            .font(.lnCaption)
            .foregroundStyle(Theme.textMuted)
            .padding(.top, 4)
          VStack(spacing: 8) {
            ForEach(store.isMaster ? EmailChatPrompts.masterStarters : EmailChatPrompts.projectStarters) { starter in
              starterButton(starter)
            }
          }
          .padding(.top, 16)
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 24)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxHeight: .infinity)
    .scrollDismissesKeyboard(.interactively)
  }

  private var emptyHint: String {
    let scope = store.isMaster ? "As a master it uses each project's logo, name and accent, so write it once for all of them." : "Click any block to point at it."
    return "Describe it, or start from one of these. " + scope
  }

  private func starterButton(_ starter: EmailChatSuggestion) -> some View {
    Button { _ = store.chat.send(starter.prompt) } label: {
      HStack(alignment: .top, spacing: 10) {
        Image(systemName: starter.systemImage)
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(Theme.accentText)
          .frame(width: 16)
          .padding(.top, 1)
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
            HStack(spacing: 8) {
              avatar
              ProgressView().controlSize(.small)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Working")
          }
          Color.clear.frame(height: 1).id(Self.bottom)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 14)
      }
      .defaultScrollAnchor(.bottom)
      .scrollDismissesKeyboard(.interactively)
      .frame(maxHeight: .infinity)
      .onAppear { proxy.scrollTo(Self.bottom, anchor: .bottom) }
      // Follow the reply as it streams in.
      .onChange(of: scrollKey) { _, _ in proxy.scrollTo(Self.bottom, anchor: .bottom) }
    }
  }

  /// Sent, but nothing of the reply has arrived yet.
  private var waiting: Bool {
    guard chat.busy, let last = chat.messages.last else { return false }
    return last.isUser || last.parts.isEmpty
  }

  /// Changes whenever the transcript grows: a message, a part, or streamed words.
  private var scrollKey: String {
    guard let last = chat.messages.last else { return "" }
    var length = 0
    for part in last.parts { length += part.textValue?.utf8.count ?? 0 }
    return "\(chat.messages.count)|\(last.id)|\(last.parts.count)|\(length)|\(chat.busy)"
  }

  private var avatar: some View {
    Image(systemName: "sparkles")
      .font(.system(size: 11, weight: .semibold))
      .foregroundStyle(Theme.accentText)
      .frame(width: 22, height: 22)
      .background(Theme.elevated, in: Circle())
  }

  private func userBubble(_ message: EmailChatMessage) -> some View {
    Text(message.text)
      .font(.lnCallout)
      .foregroundStyle(Theme.textHighlighted)
      .textSelection(.enabled)
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge, style: .continuous))
      .frame(maxWidth: .infinity, alignment: .trailing)
      .padding(.leading, 40)
  }

  private func assistantReply(_ message: EmailChatMessage) -> some View {
    HStack(alignment: .top, spacing: 8) {
      avatar
      VStack(alignment: .leading, spacing: 8) {
        ForEach(Array(message.parts.enumerated()), id: \.offset) { _, part in
          switch part {
          case .text(let text):
            if !text.isEmpty { KnowledgeMarkdown(text: text) }
          case .tool(let tool):
            EmailChatChangeChip(change: describe(tool)) { select($0) }
          }
        }
        if chat.canUndoTurn(message.id) {
          Button { store.chat.undoTurn(message.id) } label: { Label("Undo these changes", systemImage: "arrow.uturn.backward") }
            .buttonStyle(.lnGhost)
            .padding(.leading, -10)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  /// A chip that names a block selects it on the canvas.
  private func select(_ id: String) {
    guard store.design.block(id) != nil else { return }
    store.selectedId = id
  }

  // MARK: Reading a turn

  /// EmailChat.vue blockName().
  private func blockName(_ id: String?) -> String {
    guard let id, let block = store.design.block(id) else { return "a block" }
    func clip(_ text: String) -> String {
      String(text.replacing(#/<[^>]+>/#, with: "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(32))
    }
    switch block.type {
    case "heading": return "heading “\(clip(block.text))”"
    case "text": return "text “\(clip(block.html))”"
    case "button": return "button “\(clip(block.label))”"
    case "component": return "component “\(clip(block.name))”"
    default: return block.type
    }
  }

  /// EmailChat.vue describe(): what one tool call did, in words.
  private func describe(_ tool: EmailChatMessage.Tool) -> EmailChatChange {
    let input = EmailRender.object(tool.input)
    let running = tool.isRunning
    let failed = tool.state == "output-error"
    func change(_ systemImage: String, _ text: String, blockId: String? = nil) -> EmailChatChange {
      EmailChatChange(systemImage: systemImage, text: text, blockId: blockId, running: running, failed: failed)
    }
    switch tool.name {
    case "set_document":
      return change("rectangle.3.group", running ? "Designing the email" : "Designed the email")
    case "update_settings":
      let keys = EmailRender.object(input["patch"]).keys
      let what = keys.contains("title") ? (keys.contains("preheader") ? "subject and preheader" : "subject") : keys.contains("preheader") ? "preheader" : "email settings"
      return change("gearshape", "Updated the \(what)")
    case "update_blocks":
      let updates = EmailRender.list(input["updates"])
      if updates.count == 1 {
        let id = EmailRender.string(EmailRender.object(updates[0])["id"])
        return change("pencil", "Edited \(blockName(id))", blockId: id)
      }
      return change("pencil", updates.isEmpty ? "Editing blocks" : "Edited \(updates.count) blocks")
    case "add_block":
      let output = EmailRender.string(tool.output) ?? ""
      let id = output.firstMatch(of: #/"(blk_[^"]+)"/#).map { String($0.output.1) }
      let type = EmailRender.string(input["type"]) ?? ""
      let parent = EmailRender.string(input["parentId"]).flatMap { $0.isEmpty ? nil : $0 }
      return change("plus", "Added a \(type.isEmpty ? "block" : type)" + (parent.map { " in \(blockName($0))" } ?? ""), blockId: id)
    case "replace_block":
      let count = EmailRender.list(input["blocks"]).count
      return change("square.grid.2x2", running ? "Rebuilding a block" : "Rebuilt a block as \(count == 0 ? "no" : String(count)) block\(count == 1 ? "" : "s")")
    case "save_component":
      let output = EmailRender.string(tool.output) ?? ""
      let id = output.firstMatch(of: #/as block "(blk_[^"]+)"|"(blk_[^"]+)"\./#).flatMap { ($0.output.1 ?? $0.output.2).map(String.init) }
      let name = EmailRender.string(input["name"]).flatMap { $0.isEmpty ? nil : $0 } ?? "a component"
      return change("puzzlepiece", running ? "Saving a component" : "Saved “\(name)” to the library", blockId: id)
    case "remove_block":
      return change("trash", "Removed a block")
    case "move_block":
      let id = EmailRender.string(input["id"])
      return change("arrow.up.arrow.down", "Moved \(blockName(id))", blockId: id)
    case "set_theme":
      let preset = EmailRender.string(input["preset"]) ?? ""
      return change("paintpalette", preset.isEmpty ? "Restyled the email" : "Applied the \(preset) theme")
    case "set_variables":
      let keys = EmailRender.list(input["variables"]).compactMap { EmailRender.string(EmailRender.object($0)["key"]) }
      let placeholders = keys.map { key in "{{" + key + "}}" }.joined(separator: ", ")
      return change("curlybraces", "Set " + (placeholders.isEmpty ? "variables" : placeholders))
    case "check_email":
      let output = EmailRender.string(tool.output) ?? ""
      let count = !output.isEmpty && !output.hasPrefix("All checks") ? output.components(separatedBy: "\n").count : 0
      return change("checkmark.shield", running ? "Checking the email" : count > 0 ? "Found \(count) issue\(count == 1 ? "" : "s")" : "All checks pass")
    default:
      return change("wand.and.stars", tool.name.replacingOccurrences(of: "_", with: " "))
    }
  }

  // MARK: Footer

  private var footer: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !chat.error.isEmpty { errorLine }
      if let selected = store.selected { selectionPill(selected) }
      if !chat.messages.isEmpty { quickActions }
      composer
    }
    .padding(12)
    .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 0.5) }
  }

  private var errorLine: some View {
    HStack(spacing: 8) {
      Image(systemName: "exclamationmark.circle").font(.system(size: 12, weight: .medium))
      Text(chat.error).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
      Button("Retry") { store.chat.retry() }
        .buttonStyle(GhostButtonStyle(tint: Theme.error))
        .disabled(chat.busy)
    }
    .font(.lnCaption)
    .foregroundStyle(Theme.error)
    .padding(.leading, 10)
    .padding(.vertical, 2)
    .background(Theme.error.opacity(0.08), in: RoundedRectangle(cornerRadius: Metrics.radius))
  }

  /// The block the next request is about; x points at the whole email again.
  private func selectionPill(_ block: EmailDesignBlock) -> some View {
    HStack(spacing: 6) {
      Image(systemName: block.kind?.systemImage ?? "square.dashed").font(.system(size: 11, weight: .semibold))
      Text(block.displayName).lineLimit(1)
      Button { store.selectedId = nil } label: {
        Image(systemName: "xmark")
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(Theme.textMuted)
          .frame(width: 20, height: 20)
          .contentShape(Circle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Clear selection")
    }
    .font(.lnCaptionMedium)
    .foregroundStyle(Theme.textToned)
    .padding(.leading, 10)
    .padding(.trailing, 3)
    .frame(height: 26)
    .background(Theme.elevated, in: Capsule())
    .overlay(Capsule().strokeBorder(Theme.border))
  }

  /// With a block selected, changes to it; otherwise whole-email passes. Failing
  /// checks come first as one "Fix N issues".
  private var quickActions: some View {
    let issues = store.issues
    let actions = store.selected.map(EmailChatPrompts.actions(for:)) ?? EmailChatPrompts.emailActions
    return ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        if !issues.isEmpty {
          EmailChatFixPill(label: "Fix \(issues.count) issue\(issues.count == 1 ? "" : "s")") { _ = store.chat.send(fixPrompt(issues)) }
            .disabled(chat.busy)
            .opacity(chat.busy ? 0.5 : 1)
        }
        ForEach(actions) { action in
          Pill(label: action.label) { _ = store.chat.send(action.prompt) }
            .disabled(chat.busy)
            .opacity(chat.busy ? 0.5 : 1)
        }
      }
      .padding(.vertical, 1)
    }
  }

  /// EmailChat.vue fixPrompt().
  private func fixPrompt(_ issues: [EmailIssue]) -> String {
    "Fix these problems found by the email checks (skip any that need information only I have, and tell me what I must do):\n" + issues.map { "- \($0.fix)" }.joined(separator: "\n")
  }

  // MARK: Composer

  private var placeholder: String {
    if let selected = store.selected { return "Ask for a change to the selected \(selected.type)…" }
    return "Describe an email, or ask for a change…"
  }

  private var canSend: Bool {
    !chat.busy && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  /// ⌘↩ sends; while a turn runs the button stops it.
  private var composer: some View {
    HStack(alignment: .bottom, spacing: 6) {
      TextField(placeholder, text: $draft, axis: .vertical)
        .font(.lnBody)
        .lineLimit(1...6)
        .focused($focused)
        .padding(.vertical, 6)
        .padding(.leading, 8)
      if chat.busy {
        Button { store.chat.stop() } label: {
          Image(systemName: "stop.circle.fill")
            .font(.system(size: 26))
            .foregroundStyle(Theme.textHighlighted)
            .frame(width: 32, height: 32)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Stop")
      } else {
        Button(action: submit) {
          Image(systemName: "arrow.up.circle.fill")
            .font(.system(size: 26))
            .foregroundStyle(canSend ? Theme.accent : Theme.textDimmed)
            .frame(width: 32, height: 32)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .keyboardShortcut(.return, modifiers: .command)
        .accessibilityLabel("Send")
      }
    }
    .padding(5)
    .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge, style: .continuous).strokeBorder(focused ? Theme.borderAccented : Theme.border))
  }

  private func submit() {
    guard store.chat.send(draft) else { return }
    draft = ""
  }
}

// MARK: - Pieces

/// What one tool call did, for its chip.
struct EmailChatChange: Equatable {
  let systemImage: String
  let text: String
  /// The block it touched, when it names one: tapping the chip selects it.
  let blockId: String?
  let running: Bool
  let failed: Bool
}

/// One tool call in a reply: a spinner while it runs, a warning when it failed.
/// When it names a block, tapping it selects that block.
private struct EmailChatChangeChip: View {
  let change: EmailChatChange
  let onSelect: (String) -> Void

  var body: some View {
    if let blockId = change.blockId {
      Button { onSelect(blockId) } label: { label }
        .buttonStyle(.plain)
        .accessibilityHint("Selects the block")
    } else {
      label
    }
  }

  private var label: some View {
    HStack(spacing: 8) {
      Group {
        if change.running {
          ProgressView().controlSize(.mini)
        } else {
          Image(systemName: change.failed ? "exclamationmark.triangle" : change.systemImage)
            .font(.system(size: 11, weight: .semibold))
        }
      }
      .frame(width: 14, height: 14)
      Text(change.text).lineLimit(1).truncationMode(.tail)
      Spacer(minLength: 0)
      if change.blockId != nil {
        Image(systemName: "cursorarrow.rays").font(.system(size: 10, weight: .medium)).opacity(0.5)
      }
    }
    .font(.lnCaption)
    .foregroundStyle(change.failed ? Theme.warning : Theme.textToned)
    .padding(.horizontal, 8)
    .padding(.vertical, 6)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(change.failed ? Theme.warning.opacity(0.06) : Theme.elevated.opacity(0.5), in: RoundedRectangle(cornerRadius: Metrics.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusSmall).strokeBorder(change.failed ? Theme.warning.opacity(0.4) : Theme.border))
    .contentShape(RoundedRectangle(cornerRadius: Metrics.radiusSmall))
  }
}

/// "Fix N issues": a Pill in the warning colour.
private struct EmailChatFixPill: View {
  let label: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Image(systemName: "exclamationmark.triangle").font(.system(size: 11, weight: .semibold))
        Text(label)
      }
      .font(.lnMetaMedium)
      .foregroundStyle(Theme.warning)
      .padding(.horizontal, 12)
      .frame(height: 30)
      .background(Theme.warning.opacity(0.08), in: Capsule())
      .overlay(Capsule().strokeBorder(Theme.warning.opacity(0.4)))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
  }
}

/// A starter or quick action: what the button says and the prompt it sends.
struct EmailChatSuggestion: Identifiable, Sendable {
  var systemImage = "sparkles"
  let label: String
  let prompt: String
  var id: String { label }
}

/// EmailChat.vue's starters and quick actions, word for word (a parity test checks).
enum EmailChatPrompts {
  /// A master is written once for every project.
  static let masterStarters = [
    EmailChatSuggestion(systemImage: "hand.wave", label: "Welcome email", prompt: "Design a warm welcome email for new users: the project logo at the top, a greeting with {{firstName}}, three quick getting-started steps and one button to {{project.url}}."),
    EmailChatSuggestion(systemImage: "key", label: "Password reset", prompt: "Design a short, plain password reset email with one button to {{resetUrl}}, a note that the link expires in {{expiresIn}}, and a line for people who did not ask for it."),
    EmailChatSuggestion(systemImage: "receipt", label: "Receipt", prompt: "Design a purchase receipt: order number {{orderId}}, an itemised summary, the total {{total}}, and a button to view the order at {{orderUrl}}."),
    EmailChatSuggestion(systemImage: "newspaper", label: "Product update", prompt: "Design a product update newsletter: a hero with a headline, three short feature highlights with images, a primary button and a footer with {{unsubscribeUrl}}.")
  ]

  static let projectStarters = [
    EmailChatSuggestion(systemImage: "hand.wave", label: "Welcome email", prompt: "Design a warm welcome email for new users of this project with a greeting using {{firstName}}, three getting-started steps and one clear button."),
    EmailChatSuggestion(systemImage: "arrowshape.turn.up.left", label: "Support reply", prompt: "Design a friendly support follow-up email that answers {{question}}, links to {{articleUrl}} and invites a reply."),
    EmailChatSuggestion(systemImage: "calendar", label: "Event invite", prompt: "Design an event invitation with the date {{eventDate}}, a short agenda and an RSVP button to {{rsvpUrl}}."),
    EmailChatSuggestion(systemImage: "sparkles", label: "Launch", prompt: "Design a launch announcement for a new feature: hero image placeholder, what it does in three bullets, and a button to try it.")
  ]

  /// Before the block actions when custom HTML is selected.
  static let convertToBlocks = EmailChatSuggestion(label: "Convert to blocks", prompt: "Rebuild the selected custom HTML as editable blocks, matching its design as closely as you can.")

  /// Before the block actions when custom HTML or a section is selected; also the
  /// component sheet's "Let the AI do it".
  static let makeReusable = EmailChatSuggestion(label: "Make reusable", prompt: "Save the selected block to the component library as a reusable component, with its copy as content fields and its colours and sizes as style fields, then use it here.")

  /// With a block selected: custom HTML can become blocks, and custom HTML or a
  /// section a library component, before the usual changes.
  static func actions(for block: EmailDesignBlock) -> [EmailChatSuggestion] {
    (block.type == "html" ? [convertToBlocks] : []) + (block.type == "html" || block.type == "section" ? [makeReusable] : []) + blockActions
  }

  /// With a block selected.
  static let blockActions = [
    EmailChatSuggestion(label: "Improve this", prompt: "Improve the selected block: sharper copy and better styling, same intent."),
    EmailChatSuggestion(label: "Shorter", prompt: "Make the selected block shorter and punchier without losing meaning."),
    EmailChatSuggestion(label: "Friendlier", prompt: "Rewrite the selected block in a warmer, more human tone."),
    EmailChatSuggestion(label: "Make it pop", prompt: "Make the selected block stand out more: stronger hierarchy and contrast, within the theme.")
  ]

  /// For the whole email.
  static let emailActions = [
    EmailChatSuggestion(label: "Improve copy", prompt: "Improve the copy across the whole email: clearer, more concrete, more persuasive. Keep the layout."),
    EmailChatSuggestion(label: "Polish design", prompt: "Polish the design: spacing rhythm, hierarchy and contrast. Keep the content."),
    EmailChatSuggestion(label: "Subject ideas", prompt: "Suggest three subject line and preheader pairs for this email with a one-line reason each, then apply the strongest."),
    EmailChatSuggestion(label: "Mobile check", prompt: "Make sure this email reads well on a 375px phone: avoid cramped columns, keep buttons easy to tap and text at least 14px.")
  ]
}
