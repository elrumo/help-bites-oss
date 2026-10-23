import SwiftUI

/// How the public changelog page and embed look (the Style slideover of the web page): the
/// project's style as it is, or the changelog's own choices laid over it.
struct ChangelogStyleSheet: View {
  let store: ChangelogStore
  @State private var source: String
  @State private var custom: ProjectStyle
  @State private var saving = false
  @State private var saved = false
  @State private var error = ""

  init(store: ChangelogStore) {
    self.store = store
    _source = State(initialValue: store.settings.style.source)
    _custom = State(initialValue: store.settings.style.custom)
  }

  private var kit: StyleBase { store.project?.look?.kit ?? StyleBase() }
  private var projectStyle: ProjectStyle { store.project?.style ?? ProjectStyle() }

  var body: some View {
    ChangelogSheetFrame(title: "Page style") {
      Text("Choose how the public changelog page and embed look.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      Picker("Style", selection: $source) {
        Text("Use the project style").tag("project")
        Text("Customise for the changelog").tag("custom")
      }
      .pickerStyle(.segmented).labelsHidden()
      if source == "project" {
        Text("The same logo, colours, corners and shadow as your other public pages.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        Text("The changelog wears the project style. Change it once and every styled feature follows.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        ProjectStylePreview(style: .resolve(kit, [projectStyle]))
      } else {
        Text("Start from the project style and change only what the changelog needs.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        ProjectStyleEditor(style: $custom, kit: kit, under: [projectStyle], emptyScheme: String(localized: "Same as the project"))
      }
      ProjectStyleActions(projectId: store.projectId, from: source == "custom" ? custom : nil) { Task { await store.reloadProject() } }
      ErrorText(message: error)
    } trailing: {
      Button { Task { await save() } } label: { Text(saving ? "Saving…" : saved ? "Saved" : "Save style") }.disabled(saving || !custom.isValid)
    }
  }

  private func save() async {
    saving = true
    saved = false
    error = ""
    defer { saving = false }
    do {
      try await store.saveSettings(["style": .object(["source": .string(source), "custom": custom.json])])
      saved = true
    } catch {
      self.error = error.localizedDescription
    }
  }
}
