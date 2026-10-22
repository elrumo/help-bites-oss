import SwiftUI

/// The model's themes (components/knowledge/Tree.vue plus the web's Themes
/// modal): add, rename, move and delete paths; select one to see its FAQs.
struct KnowledgeThemesSheet: View {
  let modelId: String
  /// "Show in list": filter the model's FAQ list by this theme.
  var onShowInList: (String) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @Environment(\.horizontalSizeClass) private var sizeClass

  @State private var themes: [KnowledgeTheme] = []
  @State private var loading = true
  @State private var newName = ""
  @State private var adding = false
  @State private var selectedId = ""
  @State private var themeFAQs: [KnowledgeFAQItem] = []
  @State private var renaming: KnowledgeTheme?
  @State private var renameText = ""
  @State private var pendingDelete: PendingDelete?
  @State private var editing: FAQTarget?
  @State private var error = ""

  private struct Impact: Decodable, Sendable { let children, faqs: Int }
  private struct PendingDelete { let theme: KnowledgeTheme; let impact: Impact }
  private struct FAQTarget: Identifiable { let id: String }

  private var selected: KnowledgeTheme? { themes.first { $0.id == selectedId } }

  var body: some View {
    NavigationStack {
      ScrollView {
        Group {
          if sizeClass == .regular {
            HStack(alignment: .top, spacing: 24) { tree; themePanel }
          } else {
            VStack(alignment: .leading, spacing: 24) { tree; themePanel }
          }
        }
        .padding(20)
      }
      .panelScreen("Themes")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
      .task { await load() }
      .alert("Rename theme", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }), presenting: renaming) { theme in
        TextField("Name", text: $renameText)
        Button("Save") { Task { await rename(theme) } }
        Button("Cancel", role: .cancel) {}
      }
      .confirmationDialog("Delete theme?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible, presenting: pendingDelete) { pending in
        Button("Delete", role: .destructive) { Task { await delete(pending.theme, confirmed: true) } }
      } message: { pending in
        Text("Delete “\(pending.theme.name)”? Its \(pending.impact.children) sub-path(s) and \(pending.impact.faqs) FAQ(s) move up to the parent — nothing is deleted.")
      }
      .sheet(item: $editing, onDismiss: { Task { await loadThemeFAQs() } }) { target in
        KnowledgeFAQEditor(modelId: modelId, faqId: target.id, themes: themes)
      }
    }
    .presentationDetents([.large])
  }

  // MARK: Tree

  private var tree: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Organise FAQs into themes; select one to see its FAQs.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      HStack(spacing: 8) {
        TextField(selected.map { String(localized: "New sub-path under “\($0.name)”") } ?? String(localized: "New top-level path"), text: $newName)
          .textFieldStyle(.linear)
          .onSubmit { Task { await add() } }
        Button { Task { await add() } } label: { Label("Add", systemImage: "plus") }
          .buttonStyle(.lnSecondaryCompact)
          .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty || adding)
        if selected != nil { Button("Clear") { select("") }.buttonStyle(.lnGhost) }
      }

      if loading && themes.isEmpty {
        SkeletonRows(count: 3)
      } else if themes.isEmpty {
        Text("No paths yet. Add one above, or upload a document — its headings become paths automatically.")
          .font(.lnMeta).foregroundStyle(Theme.textMuted).multilineTextAlignment(.center)
          .padding(24).frame(maxWidth: .infinity)
          .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.borderAccented, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
      } else {
        VStack(spacing: 1) { ForEach(themes) { row($0) } }
      }
      ErrorText(message: error)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func row(_ theme: KnowledgeTheme) -> some View {
    HStack(spacing: 8) {
      Image(systemName: "folder").font(.system(size: 13)).foregroundStyle(Theme.textDimmed)
      Text(theme.name).font(.lnCallout).foregroundStyle(Theme.textHighlighted).lineLimit(1)
      Spacer(minLength: 4)
      Menu { actions(for: theme) } label: {
        Image(systemName: "ellipsis").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).contentShape(Rectangle())
      }
      .accessibilityLabel("Actions for \(theme.name)")
    }
    .padding(.leading, 8 + CGFloat(theme.depth) * 18)
    .frame(minHeight: 36)
    .background(selectedId == theme.id ? Theme.accented : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .contentShape(Rectangle())
    .onTapGesture { select(theme.id) }
    .contextMenu { actions(for: theme) }
    .accessibilityAddTraits(selectedId == theme.id ? [.isButton, .isSelected] : .isButton)
  }

  @ViewBuilder private func actions(for theme: KnowledgeTheme) -> some View {
    Button { renameText = theme.name; renaming = theme } label: { Label("Rename", systemImage: "square.and.pencil") }
    Menu {
      Button("(top level)") { Task { await move(theme, under: "") } }
      // A theme can't move under itself or anything beneath it.
      ForEach(themes.filter { $0.id != theme.id && !$0.pathCache.hasPrefix(theme.pathCache + "/") }) { target in
        Button(target.pathCache) { Task { await move(theme, under: target.id) } }
      }
    } label: { Label("Move under", systemImage: "arrow.turn.down.right") }
    Divider()
    Button(role: .destructive) { Task { await delete(theme, confirmed: false) } } label: { Label("Delete", systemImage: "trash") }
  }

  // MARK: Selected theme

  private var themePanel: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let selected {
        HStack(spacing: 8) {
          Text(selected.pathCache).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(2)
          Spacer(minLength: 8)
          Button("Show in list") { onShowInList(selected.id); dismiss() }.buttonStyle(.lnSecondaryCompact)
        }
        if themeFAQs.isEmpty {
          Text("No FAQs in this theme yet.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        } else {
          Card {
            ForEach(themeFAQs) { faq in
              CardRow(divider: faq.id != themeFAQs.last?.id) {
                Button { editing = FAQTarget(id: faq.id) } label: {
                  HStack(spacing: 8) {
                    Text(faq.question).font(.lnCallout).foregroundStyle(Theme.text).lineLimit(2).multilineTextAlignment(.leading)
                    Spacer(minLength: 4)
                    StatusDot(status: faq.status)
                  }
                  .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
              }
            }
          }
        }
      } else {
        Text("Select a theme to see and open its FAQs.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  // MARK: Data

  private func select(_ id: String) {
    selectedId = selectedId == id ? "" : id
    themeFAQs = []
    Task { await loadThemeFAQs() }
  }

  private func load() async {
    do {
      let list: KnowledgeThemeList = try await session.get("/v1/admin/knowledge/nodes", query: ["modelId": modelId])
      themes = list.nodes
      if selected == nil { selectedId = "" }
    } catch { self.error = error.localizedDescription }
    loading = false
  }

  private func loadThemeFAQs() async {
    guard !selectedId.isEmpty else { return }
    let id = selectedId
    if let page: KnowledgeFAQPage = try? await session.get("/v1/admin/knowledge/faqs", query: ["modelId": modelId, "nodeId": id, "limit": "100"]), id == selectedId {
      themeFAQs = page.faqs
    }
  }

  private func add() async {
    struct Input: Encodable, Sendable { let modelId, name: String; let parentId: String? }
    let name = newName.trimmingCharacters(in: .whitespaces)
    guard !name.isEmpty, !adding else { return }
    adding = true; error = ""
    defer { adding = false }
    do {
      let _: JSONValue = try await session.send("/v1/admin/knowledge/nodes", body: Input(modelId: modelId, name: name, parentId: selectedId.isEmpty ? nil : selectedId))
      newName = ""
      await load()
    } catch { self.error = error.localizedDescription }
  }

  private func rename(_ theme: KnowledgeTheme) async {
    let name = renameText.trimmingCharacters(in: .whitespaces)
    guard !name.isEmpty, name != theme.name else { return }
    await update(theme, ["name": name])
  }

  private func move(_ theme: KnowledgeTheme, under parentId: String) async {
    guard parentId != theme.parentId else { return }
    await update(theme, ["parentId": parentId])
  }

  private func update(_ theme: KnowledgeTheme, _ body: [String: String]) async {
    error = ""
    do {
      let _: JSONValue = try await session.send("/v1/admin/knowledge/nodes/\(theme.id)", method: "PATCH", body: body)
      await load()
    } catch { self.error = error.localizedDescription }
  }

  /// The web's delete-with-impact: ask what moves up, confirm, then delete.
  private func delete(_ theme: KnowledgeTheme, confirmed: Bool) async {
    error = ""
    do {
      if confirmed {
        let _: KnowledgeDeleteCheck<Impact> = try await KnowledgeAPI.request(session, "DELETE", "/v1/admin/knowledge/nodes/\(theme.id)", query: ["confirm": "true"])
      } else {
        let check: KnowledgeDeleteCheck<Impact> = try await session.send("/v1/admin/knowledge/nodes/\(theme.id)", method: "DELETE")
        if let impact = check.impact, !check.deleted { pendingDelete = PendingDelete(theme: theme, impact: impact); return }
      }
      if selectedId == theme.id { selectedId = ""; themeFAQs = [] }
      await load()
    } catch { self.error = error.localizedDescription }
  }
}
