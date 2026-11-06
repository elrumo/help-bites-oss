import SwiftUI

/// A project's feature flags (web: projects/[id]/flags.vue). Flipping a saved
/// flag's state applies at once, as on the web; other edits save together.
struct FlagsScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @State private var draft: [FlagsDraft] = []
  /// The flags as the server last returned them; a quick state flip is applied to these.
  @State private var savedFlags: [ProjectsFlag] = []
  @State private var loading = true
  @State private var ready = false
  @State private var saving = false
  @State private var saved = false
  @State private var error = ""
  @State private var deleting: FlagsDraft?
  @State private var added: UUID?

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
              Text("Feature flags").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
              Spacer()
              if saved { Label("Saved", systemImage: "checkmark").font(.lnCaption).foregroundStyle(Theme.textMuted) }
            }
            Text(flagsMarkdown(String(localized: "Switch features of your app on, off, or on for admins only. Your app reads them from `GET /v1/flags`; the Dev section shows how.")))
              .font(.lnMeta).foregroundStyle(Theme.textMuted)
          }

          if loading {
            SkeletonRows(count: 3)
          } else if draft.isEmpty && ready {
            EmptyState(systemImage: "switch.2", title: "No flags yet", message: "Add a flag, name it after the feature it gates, and your app can read it on its next poll.") {
              Button { add() } label: { Label("Add flag", systemImage: "plus") }.buttonStyle(.lnPrimaryCompact)
            }
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
          } else {
            ForEach($draft) { $flag in
              FlagsCard(draft: $flag, onDelete: { remove(flag) }, onState: { state in
                if !flag.isNew { Task { await setState(flag.flag.key, state) } }
              })
              .id(flag.id)
            }
          }
          ErrorText(message: error)
        }
        .frame(maxWidth: 760, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .onChange(of: added) { _, id in
        if let id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } }
      }
      .toolbar {
        ToolbarItem(placement: .primaryAction) {
          Button { add() } label: { Label("Add flag", systemImage: "plus") }.disabled(!ready)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save flags") { Task { await save() } }.disabled(!ready || saving)
        }
      }
    }
    .projectScreen(projectId, "Flags")
    .confirmationDialog(
      "Delete “\(deleting?.flag.key ?? "")”?",
      isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
      titleVisibility: .visible,
      presenting: deleting
    ) { flag in
      Button("Delete flag", role: .destructive) { draft.removeAll { $0.id == flag.id } }
    } message: { _ in
      Text("Apps reading it will treat it as off.")
    }
    .task { await load() }
  }

  private func add() {
    let flag = FlagsDraft(isNew: true, flag: ProjectsFlag(key: "", description: "", state: "off", fallback: "off", targets: [], allow: []))
    draft.append(flag)
    saved = false
    added = flag.id
  }

  /// A flag that was never saved goes straight away; a live one asks first. Either way it's gone on "Save flags".
  private func remove(_ flag: FlagsDraft) {
    if flag.isNew { draft.removeAll { $0.id == flag.id } } else { deleting = flag }
  }

  private func load() async {
    do {
      let project = try await ProjectsAdminProject.load(projectId, session: session)
      draft = (project.flags ?? []).map { FlagsDraft(flag: $0) }
      savedFlags = project.flags ?? []
      ready = true
    } catch {
      // Saving replaces every flag, so a list that never loaded must not be saveable.
      self.error = error.localizedDescription
    }
    loading = false
  }

  private func save() async {
    struct Input: Encodable, Sendable { let flags: [ProjectsFlag] }
    saving = true
    saved = false
    error = ""
    defer { saving = false }
    let flags = draft.map { row -> ProjectsFlag in
      var flag = row.flag
      flag.key = flag.key.trimmingCharacters(in: .whitespacesAndNewlines)
      return flag
    }
    do {
      let project = try await ProjectsAdminProject.save(projectId, Input(flags: flags), workspace: workspace)
      draft = (project.flags ?? []).map { FlagsDraft(flag: $0) }
      savedFlags = project.flags ?? []
      saved = true
    } catch {
      self.error = error.localizedDescription
    }
  }
}

extension FlagsScreen {
  /// The web's one-click state switch: save the last-saved list with just this
  /// flag's state changed, leaving any other unsaved edits in the draft.
  private func setState(_ key: String, _ state: String) async {
    struct Input: Encodable, Sendable { let flags: [ProjectsFlag] }
    guard ready, savedFlags.contains(where: { $0.key == key }) else { return }
    let flags = savedFlags.map { flag -> ProjectsFlag in
      var flag = flag
      if flag.key == key { flag.state = state }
      return flag
    }
    error = ""
    do {
      let project = try await ProjectsAdminProject.save(projectId, Input(flags: flags), workspace: workspace)
      savedFlags = project.flags ?? []
    } catch {
      self.error = error.localizedDescription
      if let previous = savedFlags.first(where: { $0.key == key }), let index = draft.firstIndex(where: { $0.flag.key == key }) {
        draft[index].flag.state = previous.state
      }
    }
  }
}

private struct FlagsDraft: Identifiable {
  let id = UUID()
  var isNew = false
  var flag: ProjectsFlag
}

/// off | admins | on, with the web's dot colours.
private enum FlagsState {
  static let all: [(value: String, label: String, tint: Color)] = [
    ("off", String(localized: "Off"), Theme.error),
    ("admins", String(localized: "Admins only"), Theme.warning),
    ("on", String(localized: "On"), Theme.success)
  ]
  static func label(_ value: String) -> String { all.first { $0.value == value }?.label ?? value }
  static func tint(_ value: String) -> Color { all.first { $0.value == value }?.tint ?? Theme.textDimmed }
}

private func flagsMarkdown(_ source: String) -> AttributedString {
  (try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(source)
}

/// One flag: key and description, state, fallback, targets, and the admins allow-list.
private struct FlagsCard: View {
  @Binding var draft: FlagsDraft
  let onDelete: () -> Void
  let onState: (String) -> Void
  @Environment(\.horizontalSizeClass) private var sizeClass

  var body: some View {
    Card {
      VStack(alignment: .leading, spacing: 16) {
        HStack(alignment: .top, spacing: 8) {
          stack(spacing: 8) {
            TextField("flag_key", text: $draft.flag.key)
              .font(.app(size: 14, design: .monospaced))
              .foregroundStyle(draft.isNew ? Theme.textHighlighted : Theme.textMuted)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
              .padding(.horizontal, 12).frame(minHeight: Metrics.scaled(40))
              .background(draft.isNew ? Theme.field : Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
              .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
              .frame(maxWidth: wide ? 224 : .infinity)
              .disabled(!draft.isNew)
              .accessibilityLabel("Flag key")
            TextField("What it gates", text: $draft.flag.description).textFieldStyle(.linear).accessibilityLabel("Description")
          }
          IconButton(systemImage: "trash", label: "Delete flag", action: onDelete).padding(.top, 4)
        }

        stack(spacing: wide ? 20 : 16) {
          LabeledField(label: "State") { FlagsStatePicker(state: $draft.flag.state, onPick: onState) }
          LabeledField(label: "If unreachable", hint: "When HelpBites can't be reached") { fallbackMenu }
          LabeledField(label: "Targets") { FlagsTagsField(tags: $draft.flag.targets, placeholder: "frontend, backend…") }
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        if draft.flag.state == "admins" || draft.flag.fallback == "admins" {
          LabeledField(label: "Also on for", hint: "User ids or emails treated as admins for this flag") {
            FlagsTagsField(tags: $draft.flag.allow, placeholder: "user id or email")
          }
        }
      }
      .padding(16)
    }
  }

  private var wide: Bool { sizeClass == .regular }

  /// A row on iPad, a column on iPhone (the web's flex-wrap).
  private func stack<Content: View>(spacing: CGFloat, @ViewBuilder _ content: () -> Content) -> some View {
    let layout = wide ? AnyLayout(HStackLayout(alignment: .top, spacing: spacing)) : AnyLayout(VStackLayout(alignment: .leading, spacing: spacing))
    return layout(content)
  }

  private var fallbackMenu: some View {
    Menu {
      Picker("If unreachable", selection: $draft.flag.fallback) {
        ForEach(FlagsState.all, id: \.value) { Text($0.label).tag($0.value) }
      }
    } label: {
      HStack(spacing: 6) {
        Circle().fill(FlagsState.tint(draft.flag.fallback)).frame(width: 6, height: 6)
        Text(FlagsState.label(draft.flag.fallback)).font(.lnMeta).foregroundStyle(Theme.text)
        Spacer(minLength: 8)
        Image(systemName: "chevron.up.chevron.down").font(.app(size: 10, weight: .semibold)).foregroundStyle(Theme.textMuted)
      }
      .padding(.horizontal, 10)
      .frame(width: 150, height: 32)
      .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
    }
    .accessibilityLabel("If unreachable")
    .accessibilityValue(FlagsState.label(draft.flag.fallback))
  }
}

/// The web's state radio group: a segmented control whose options carry coloured dots.
private struct FlagsStatePicker: View {
  @Binding var state: String
  var onPick: (String) -> Void = { _ in }

  var body: some View {
    HStack(spacing: 2) {
      ForEach(FlagsState.all, id: \.value) { option in
        let selected = state == option.value
        Button {
          guard !selected else { return }
          state = option.value
          onPick(option.value)
        } label: {
          HStack(spacing: 6) {
            Circle().fill(option.tint).frame(width: 6, height: 6)
            Text(option.label).lineLimit(1)
          }
          .font(.lnCaptionMedium)
          .foregroundStyle(selected ? Theme.textHighlighted : Theme.textMuted)
          .padding(.horizontal, 10)
          .frame(height: Metrics.scaled(28))
          .background(selected ? Theme.panel : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radiusSmall))
          .shadow(color: .black.opacity(selected ? 0.08 : 0), radius: 1, y: 1)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
    }
    .padding(2)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("State")
  }
}

/// Tags input (the web's UInputTags): return, a comma or leaving the field adds, the cross removes.
private struct FlagsTagsField: View {
  @Binding var tags: [String]
  let placeholder: LocalizedStringKey
  @State private var text = ""
  @FocusState private var focused: Bool

  var body: some View {
    FlowLayout(spacing: 6) {
      ForEach(tags, id: \.self) { tag in
        HStack(spacing: 5) {
          Text(tag).lineLimit(1)
          Button { tags.removeAll { $0 == tag } } label: {
            Image(systemName: "xmark").font(.app(size: 8, weight: .bold))
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Remove \(tag)")
        }
        .font(.lnCaptionMedium)
        .foregroundStyle(Theme.textToned)
        .padding(.horizontal, 8)
        .frame(height: Metrics.scaled(24))
        .background(Theme.elevated, in: Capsule())
      }
      TextField(tags.isEmpty ? placeholder : "", text: $text)
        .font(.lnMeta)
        .textInputAutocapitalization(.never).autocorrectionDisabled()
        .submitLabel(.done)
        .frame(minWidth: 140, minHeight: 24)
        .focused($focused)
        .onSubmit(commit)
        .onChange(of: text) { _, value in if value.contains(",") { commit() } }
        .onChange(of: focused) { _, isFocused in if !isFocused { commit() } }
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 7)
    .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
    .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
    .contentShape(Rectangle())
    .onTapGesture { focused = true }
  }

  private func commit() {
    for part in text.split(separator: ",") {
      let tag = part.trimmingCharacters(in: .whitespaces)
      if !tag.isEmpty && !tags.contains(tag) { tags.append(tag) }
    }
    text = ""
  }
}
