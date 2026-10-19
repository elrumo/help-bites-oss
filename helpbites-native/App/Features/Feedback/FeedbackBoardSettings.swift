import SwiftUI

// File scope: a generic type cannot hold static stored properties.
private let feedbackCategoryOptions = [("open", "Open"), ("planned", "Planned"), ("active", "Active"), ("done", "Done"), ("closed", "Closed")].map { FeedbackOption(value: $0.0, label: $0.1) }
private let feedbackColorOptions = ["neutral", "primary", "info", "success", "warning", "error"].map { FeedbackOption(value: $0, label: $0.capitalized, color: $0) }

/// Board settings (FeedbackBoardSettings.vue): the board's switch and copy, its options,
/// and the statuses, post types, platforms and tags posts are filed under. With
/// `boardOnly` it edits a project board's statuses and labels (the tag list,
/// renamed) under a `header` of the caller's own.
struct FeedbackBoardSettingsSheet<Header: View>: View {
  private let boardOnly: Bool
  private let intro: String
  private let saveAction: @MainActor (FeedbackBoardConfig) async throws -> FeedbackBoardConfig
  private let header: Header
  @State private var draft: FeedbackSettingsDraft
  @State private var saving = false
  @State private var error = ""
  @State private var justSaved = false
  @Environment(\.dismiss) private var dismiss

  /// `save` stores the config and answers with what the server kept.
  init(config: FeedbackBoardConfig, boardOnly: Bool, intro: String, save: @escaping @MainActor (FeedbackBoardConfig) async throws -> FeedbackBoardConfig, @ViewBuilder header: () -> Header) {
    self.boardOnly = boardOnly
    self.intro = intro
    self.saveAction = save
    self.header = header()
    _draft = State(initialValue: FeedbackSettingsDraft(config))
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 32) {
          Text(intro).font(.lnMeta).foregroundStyle(Theme.textMuted)
          header
          if !boardOnly {
            general
            options
          }
          statuses
          if !boardOnly {
            types
            platforms
          }
          tags
        }
        .frame(maxWidth: 640, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("Board settings")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(justSaved ? "Saved" : "Save") { Task { await save() } }.disabled(saving)
        }
      }
      .feedbackErrorAlert($error)
    }
    .presentationDetents([.large])
  }

  // MARK: Sections

  private var general: some View {
    VStack(alignment: .leading, spacing: 16) {
      Card {
        CardRow(divider: false) {
          FeedbackToggleRow(title: "Board is live", detail: "Visitors can read it with the project's public key; signed-in users can post, vote and comment.", isOn: $draft.board.enabled)
        }
      }
      LabeledField(label: "Title", hint: "Defaults to “{project} feedback”") {
        TextField("Feature requests & bug reports", text: $draft.board.title).textFieldStyle(.linear)
      }
      LabeledField(label: "Description") {
        LinearTextEditor(text: $draft.board.description, placeholder: "Ideas, bugs and requests — vote on what matters to you.", minHeight: 72)
      }
      LabeledField(label: "Post URL", hint: "Where a post lives on your site; {id}, {number} and {slug} are replaced. Used in emails and the RSS feed.") {
        TextField("https://app.example.com/feedback?feedback={id}", text: $draft.board.postUrlTemplate)
          .textFieldStyle(.linear)
          .keyboardType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      }
    }
  }

  private var options: some View {
    VStack(alignment: .leading, spacing: 10) {
      heading("Options")
      Card {
        CardRow { FeedbackToggleRow(title: "Comments", detail: "Users can comment on posts.", isOn: $draft.board.allowComments) }
        CardRow { FeedbackToggleRow(title: "Authors can edit", detail: "Title, text, type, platform and tags of their own posts, and their comments.", isOn: $draft.board.allowUserEdits) }
        CardRow { FeedbackToggleRow(title: "Show author names", detail: "Admins always see them.", isOn: $draft.board.showAuthorNames) }
        CardRow { FeedbackToggleRow(title: "Email notifications", detail: "Status changes and new comments to a post's followers, mentions to whoever is mentioned.", isOn: $draft.board.emailNotifications) }
        CardRow { FeedbackToggleRow(title: "Roadmap view", detail: "Planned, in-progress and done columns in the embed.", isOn: $draft.board.roadmap) }
        CardRow(divider: false) { FeedbackToggleRow(title: "Changelog", detail: "A Changelog tab in the board. Needs Public changelog on in Project → Changelog → Settings.", isOn: $draft.board.changelog) }
      }
    }
  }

  private var statuses: some View {
    VStack(alignment: .leading, spacing: 10) {
      heading("Statuses", boardOnly
        ? "The category is what a status means: public items in a planned, active or done status show on the roadmap; the rest stay private."
        : "The category is what a status means everywhere: open, planned and active show on the board by default; done feeds the changelog and closes voting.")
      ForEach($draft.statuses) { $row in
        let id = row.id
        rowCard {
          HStack(spacing: 8) {
            TextField("Label", text: $row.value.label).textFieldStyle(.linear).accessibilityLabel("Status label")
            keyField($row.value.key, label: row.value.label, name: "Status key")
            rowButton("arrow.up", "Move up", enabled: draft.statuses.first?.id != id) { moveUp(&draft.statuses, id) }
            rowButton("trash", "Remove status", enabled: draft.statuses.count > 1) { draft.statuses.removeAll { $0.id == id } }
          }
          HStack(spacing: 8) {
            FeedbackSelect(options: feedbackCategoryOptions, selection: $row.value.category, compact: true).accessibilityLabel("Category")
            FeedbackSelect(options: feedbackColorOptions, selection: $row.value.color, compact: true).accessibilityLabel("Colour")
            rowButton(row.value.isDefault == true ? "star.fill" : "star", boardOnly ? "Default for new items" : "Default for new posts", active: row.value.isDefault == true) { makeDefault(id) }
            if !boardOnly {
              rowButton(row.value.notify == true ? "bell.fill" : "bell.slash", "Email the post's followers when it moves here", active: row.value.notify == true) {
                row.value.notify = row.value.notify != true
              }
            }
          }
        }
      }
      addButton("Add status") {
        draft.statuses.append(FeedbackDraftRow(value: FeedbackStatusDefinition(key: "", label: "", category: "open", color: "neutral", isDefault: false, notify: false)))
      }
    }
  }

  private var types: some View {
    VStack(alignment: .leading, spacing: 10) {
      heading("Post types", "Icon: an Iconify name like lucide:bug, or an emoji.")
      ForEach($draft.types) { $row in
        let id = row.id
        rowCard {
          HStack(spacing: 8) {
            FeedbackTypeIcon(icon: row.value.icon, size: 15)
              .foregroundStyle(Theme.textToned)
              .frame(width: 36, height: 36)
              .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
            TextField("Label", text: $row.value.label).textFieldStyle(.linear).accessibilityLabel("Type label")
            keyField($row.value.key, label: row.value.label, name: "Type key")
            rowButton("arrow.up", "Move up", enabled: draft.types.first?.id != id) { moveUp(&draft.types, id) }
            rowButton("trash", "Remove type") { draft.types.removeAll { $0.id == id } }
          }
          TextField("lucide:bug", text: $row.value.icon)
            .textFieldStyle(.linear)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .accessibilityLabel("Icon")
        }
      }
      addButton("Add type") { draft.types.append(FeedbackDraftRow(value: FeedbackTypeDefinition(key: "", label: "", icon: ""))) }
    }
  }

  private var platforms: some View {
    VStack(alignment: .leading, spacing: 10) {
      heading("Platforms", "Optional. Leave empty to hide the platform picker.")
      ForEach($draft.platforms) { $row in
        let id = row.id
        rowCard {
          HStack(spacing: 8) {
            TextField("Label", text: $row.value.label).textFieldStyle(.linear).accessibilityLabel("Platform label")
            keyField($row.value.key, label: row.value.label, name: "Platform key")
            rowButton("trash", "Remove platform") { draft.platforms.removeAll { $0.id == id } }
          }
        }
      }
      addButton("Add platform") { draft.platforms.append(FeedbackDraftRow(value: FeedbackPlatformDefinition(key: "", label: ""))) }
    }
  }

  private var tags: some View {
    VStack(alignment: .leading, spacing: 10) {
      heading(boardOnly ? "Labels" : "Tags", boardOnly
        ? "Labels items can carry several of — areas, teams, anything. The roadmap shows them only if you turn that on."
        : "Optional labels a post can carry several of (up to 4) — areas, components, anything. Leave empty to hide the tag picker.")
      ForEach($draft.tags) { $row in
        let id = row.id
        rowCard {
          HStack(spacing: 8) {
            TextField("Label", text: $row.value.label).textFieldStyle(.linear).accessibilityLabel(boardOnly ? "Label name" : "Tag label")
            keyField($row.value.key, label: row.value.label, name: boardOnly ? "Label key" : "Tag key")
            rowButton("arrow.up", "Move up", enabled: draft.tags.first?.id != id) { moveUp(&draft.tags, id) }
            rowButton("trash", boardOnly ? "Remove label" : "Remove tag") { draft.tags.removeAll { $0.id == id } }
          }
          FeedbackSelect(options: feedbackColorOptions, selection: $row.value.color, compact: true).accessibilityLabel("Colour")
        }
      }
      addButton(boardOnly ? "Add label" : "Add tag") { draft.tags.append(FeedbackDraftRow(value: FeedbackTagDefinition(key: "", label: "", color: "neutral"))) }
    }
  }

  // MARK: Pieces

  private func heading(_ title: String, _ detail: String? = nil) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
      if let detail { Text(detail).font(.lnMeta).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true) }
    }
  }

  private func rowCard<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
    VStack(spacing: 8) { content() }
      .padding(8)
      .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  /// The key field; until one is typed it shows the key the label will get.
  private func keyField(_ key: Binding<String>, label: String, name: String) -> some View {
    let auto = FeedbackFormat.normalizeKey(label)
    return TextField(auto.isEmpty ? "key" : auto, text: key)
      .textFieldStyle(.linear)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .accessibilityLabel(name)
  }

  private func rowButton(_ systemImage: String, _ label: String, active: Bool = false, enabled: Bool = true, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: systemImage)
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(active ? Theme.accentText : Theme.textMuted)
        .frame(width: 30, height: 36)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.35)
    .accessibilityLabel(label)
  }

  private func addButton(_ title: String, action: @escaping () -> Void) -> some View {
    Button(action: action) { Label(title, systemImage: "plus") }.buttonStyle(.lnSecondaryCompact)
  }

  private func moveUp<Value>(_ list: inout [FeedbackDraftRow<Value>], _ id: UUID) {
    guard let index = list.firstIndex(where: { $0.id == id }), index > 0 else { return }
    list.swapAt(index, index - 1)
  }

  private func makeDefault(_ id: UUID) {
    for index in draft.statuses.indices { draft.statuses[index].value.isDefault = draft.statuses[index].id == id }
  }

  private func save() async {
    saving = true
    do {
      let saved = try await saveAction(draft.config)
      saving = false
      draft = FeedbackSettingsDraft(saved)
      justSaved = true
      try? await Task.sleep(for: .seconds(1.6))
      justSaved = false
    } catch {
      saving = false
      self.error = error.localizedDescription
    }
  }
}

extension FeedbackBoardSettingsSheet where Header == EmptyView {
  /// The feedback board's own settings, saved with the project through its store.
  init(store: FeedbackBoardStore, config: FeedbackBoardConfig) {
    self.init(config: config, boardOnly: false, intro: "Statuses, post types and platforms are yours to define.", save: { next in
      guard await store.saveConfig(next), let saved = store.config else {
        // The sheet shows the error; the screen behind it must not keep it.
        let message = store.saveError
        store.saveError = ""
        throw APIError.server(message.isEmpty ? "Could not save" : message)
      }
      return saved
    }) {
      EmptyView()
    }
  }
}

private struct FeedbackDraftRow<Value>: Identifiable {
  let id = UUID()
  var value: Value
}

/// The settings form's rows, each with an identity of its own while its key is edited.
private struct FeedbackSettingsDraft {
  var board: FeedbackBoardConfig
  var statuses: [FeedbackDraftRow<FeedbackStatusDefinition>]
  var types: [FeedbackDraftRow<FeedbackTypeDefinition>]
  var platforms: [FeedbackDraftRow<FeedbackPlatformDefinition>]
  var tags: [FeedbackDraftRow<FeedbackTagDefinition>]

  init(_ config: FeedbackBoardConfig) {
    board = config
    statuses = config.statuses.map { FeedbackDraftRow(value: $0) }
    types = config.types.map { FeedbackDraftRow(value: $0) }
    platforms = config.platforms.map { FeedbackDraftRow(value: $0) }
    tags = config.tags.map { FeedbackDraftRow(value: $0) }
  }

  /// What gets saved: a row without a key takes one from its label, as on the web.
  var config: FeedbackBoardConfig {
    func keyed(_ key: String, _ label: String) -> String {
      key.trimmingCharacters(in: .whitespaces).isEmpty ? FeedbackFormat.normalizeKey(label) : key
    }
    var config = board
    config.statuses = statuses.map { row in
      var status = row.value
      status.key = keyed(status.key, status.label)
      status.isDefault = status.isDefault == true
      status.notify = status.notify == true
      return status
    }
    config.types = types.map { row in
      var type = row.value
      type.key = keyed(type.key, type.label)
      return type
    }
    config.platforms = platforms.map { row in
      var platform = row.value
      platform.key = keyed(platform.key, platform.label)
      return platform
    }
    config.tags = tags.map { row in
      var tag = row.value
      tag.key = keyed(tag.key, tag.label)
      return tag
    }
    return config
  }
}
