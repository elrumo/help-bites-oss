import SwiftUI

/// One knowledge model (web: /knowledge/models/[id]): its FAQs with search,
/// filters, paging and bulk actions; the model's tools sit in the toolbar and ⋯.
struct KnowledgeModelScreen: View {
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var model: KnowledgeModel

  @State private var dashboard: KnowledgeDashboard?
  @State private var themes: [KnowledgeTheme] = []
  @State private var faqs: [KnowledgeFAQItem] = []
  @State private var total = 0
  @State private var loading = true
  @State private var error = ""

  @State private var search = ""
  @State private var query = FAQQuery()

  @State private var selecting = false
  @State private var selection: Set<String> = []
  @State private var confirmBulkDelete = false
  @State private var pendingDelete: KnowledgeFAQItem?
  @State private var tagging = false
  @State private var tagText = ""

  @State private var sheet: Sheet?
  @State private var reindexing = false
  @State private var deleted = false

  private let limit = 50

  init(model: KnowledgeModel) { _model = State(initialValue: model) }

  private struct FAQQuery: Equatable { var search = "", status = "", theme = "", skip = 0 }

  private enum Sheet: Identifiable {
    case faq(String), themes, documents, importer, settings, tester
    var id: String {
      switch self {
      case .faq(let id): "faq-\(id)"
      case .themes: "themes"
      case .documents: "documents"
      case .importer: "importer"
      case .settings: "settings"
      case .tester: "tester"
      }
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      filterBar
      Rectangle().fill(Theme.border).frame(height: 1)
      if loading && faqs.isEmpty {
        SkeletonRows(count: 6).frame(maxHeight: .infinity, alignment: .top)
      } else {
        list
      }
    }
    .safeAreaInset(edge: .bottom) {
      if !selection.isEmpty {
        ViewThatFits(in: .horizontal) { selectionBar(labelled: true); selectionBar(labelled: false) }
          .padding(.bottom, 12)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .animation(.snappy(duration: 0.2), value: selection.isEmpty)
    .panelScreen(model.name)
    .toolbar { toolbar }
    .task(id: query) { await loadFAQs() }
    .task { await loadDashboard() }
    .task { await loadThemes() }
    .task(id: search) {
      // Search as you type, a beat after the last keystroke.
      try? await Task.sleep(for: .milliseconds(350))
      let text = search.trimmingCharacters(in: .whitespaces)
      if !Task.isCancelled, text != query.search { query.search = text; query.skip = 0 }
    }
    .sheet(item: $sheet, onDismiss: { if deleted { dismiss() } else { refresh() } }) { sheet in
      switch sheet {
      case .faq(let id): KnowledgeFAQEditor(modelId: model.id, faqId: id, themes: themes)
      case .themes: KnowledgeThemesSheet(modelId: model.id) { id in query.theme = id; query.skip = 0 }
      case .documents: KnowledgeDocumentsSheet(modelId: model.id, themes: themes)
      case .importer: KnowledgeImportSheet(modelId: model.id, themes: themes)
      case .settings: KnowledgeSettingsSheet(model: model, onSaved: { model = $0 }, onDeleted: { deleted = true })
      case .tester: KnowledgeTesterSheet(projectId: model.projectId)
      }
    }
    .alert(selection.count == 1 ? "Add tags to 1 FAQ" : "Add tags to \(selection.count) FAQs", isPresented: $tagging) {
      TextField("Comma separated", text: $tagText)
      Button("Add") {
        let tags = tagText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if !tags.isEmpty { Task { await bulk("tag", tags: tags) } }
      }
      Button("Cancel", role: .cancel) {}
    }
    .confirmationDialog(selection.count == 1 ? "Delete 1 FAQ?" : "Delete \(selection.count) FAQs?", isPresented: $confirmBulkDelete, titleVisibility: .visible) {
      Button("Delete", role: .destructive) { Task { await bulk("delete") } }
    } message: { Text("This cannot be undone.") }
    .confirmationDialog("Delete FAQ?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible, presenting: pendingDelete) { faq in
      Button("Delete", role: .destructive) { Task { await delete(faq) } }
    } message: { faq in Text("Delete “\(faq.question)”? This cannot be undone.") }
  }

  // MARK: Chrome

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .principal) {
      HStack(spacing: 8) {
        Text(model.name).font(.lnHeading).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        StatusDot(status: model.status)
      }
    }
    ToolbarItemGroup(placement: .topBarTrailing) {
      if selecting {
        Button("Done") { selecting = false; selection = [] }
      } else {
        Button { sheet = .tester } label: { Label("Test", systemImage: "sparkles") }
        Button { sheet = .importer } label: { Label("Import", systemImage: "arrow.up.doc") }
        Button { sheet = .faq("") } label: { Label("New FAQ", systemImage: "plus") }.keyboardShortcut("n")
        Menu {
          Section {
            Button { sheet = .themes } label: { Label("Themes", systemImage: "folder") }
            Button { sheet = .documents } label: { Label("Source documents", systemImage: "doc.text") }
            Button { Task { await reindex() } } label: { Label("Reindex", systemImage: "arrow.clockwise") }
            Button { selecting = true } label: { Label("Select FAQs", systemImage: "checkmark.circle") }
            Button { Task { await duplicate() } } label: { Label("Duplicate model", systemImage: "plus.square.on.square") }
          }
          Button { sheet = .settings } label: { Label("Model settings", systemImage: "slider.horizontal.3") }
        } label: {
          if reindexing { ProgressView() } else { Label("More actions", systemImage: "ellipsis.circle") }
        }
        .disabled(reindexing)
      }
    }
  }

  private var filterBar: some View {
    VStack(alignment: .leading, spacing: 8) {
      SearchField(text: $search, prompt: "Search questions and answers") {
        query.search = search.trimmingCharacters(in: .whitespaces); query.skip = 0
      }
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          Menu {
            Button("All statuses") { query.status = ""; query.skip = 0 }
            Divider()
            statusChoices { query.status = $0; query.skip = 0 }
          } label: {
            KnowledgeMenuPill(label: query.status.isEmpty ? String(localized: "All statuses") : knowledgeStatusLabel(query.status), isActive: !query.status.isEmpty)
          }
          Menu {
            Button("All themes") { query.theme = ""; query.skip = 0 }
            Divider()
            ForEach(themes) { theme in Button(theme.pathCache) { query.theme = theme.id; query.skip = 0 } }
          } label: {
            KnowledgeMenuPill(label: themes.first { $0.id == query.theme }?.pathCache ?? String(localized: "All themes"), isActive: !query.theme.isEmpty)
          }
        }
      }
    }
    .padding(.horizontal, Metrics.gutter)
    .padding(.vertical, 10)
  }

  private var list: some View {
    List {
      if !model.description.isEmpty || dashboard != nil || !error.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          if !model.description.isEmpty { Text(model.description).font(.lnMeta).foregroundStyle(Theme.textMuted) }
          if let dashboard {
            FlowLayout(spacing: 14) {
              KnowledgeStat(n: dashboard.faqsTotal, label: "FAQs")
              KnowledgeStat(n: dashboard.faqsActive, label: "active")
              KnowledgeStat(n: dashboard.faqsDraft, label: "draft")
              KnowledgeStat(n: dashboard.faqsOutdated, label: "outdated", warn: dashboard.faqsOutdated > 0)
              KnowledgeStat(n: dashboard.nodes, label: "themes")
              KnowledgeStat(n: dashboard.documents, label: "documents")
              KnowledgeStat(n: dashboard.agents, label: "assistants")
              if let failed = dashboard.failedDocuments, failed > 0 { KnowledgeStat(n: failed, label: "failed documents", warn: true) }
              if let stale = dashboard.needsReindex, stale > 0 { KnowledgeStat(n: stale, label: "need reindex", warn: true) }
            }
          }
          ErrorText(message: error)
        }
        .padding(.vertical, 8)
        .linearRow()
      }

      if faqs.isEmpty {
        EmptyState(systemImage: "questionmark.bubble", title: "No FAQs here", message: "Write one, or import a support document and review the FAQs it produces. Touch and hold an FAQ to move it to another theme.") {
          Button { sheet = .importer } label: { Label("Import a document", systemImage: "arrow.up.doc") }.buttonStyle(.lnSecondary)
          Button { sheet = .faq("") } label: { Label("New FAQ", systemImage: "plus") }.buttonStyle(.lnPrimary)
        }
        .linearRow()
      }

      ForEach(faqs) { faq in
        row(faq)
          .linearRow(selected: selection.contains(faq.id))
          .contextMenu { menu(for: faq) }
          .swipeActions { Button("Delete", role: .destructive) { pendingDelete = faq } }
      }

      if total > limit { pager.linearRow() }
    }
    .linearList()
    .refreshable { await loadFAQs(); await loadDashboard() }
  }

  private func row(_ faq: KnowledgeFAQItem) -> some View {
    let selected = selection.contains(faq.id)
    return Button {
      if selecting { toggle(faq.id) } else { sheet = .faq(faq.id) }
    } label: {
      HStack(spacing: 10) {
        if selecting {
          Image(systemName: selected ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 17))
            .foregroundStyle(selected ? Theme.accent : Theme.textDimmed)
        }
        VStack(alignment: .leading, spacing: 3) {
          Text(faq.question).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          HStack(spacing: 6) {
            Text(faq.pathCache.isEmpty ? String(localized: "No theme") : faq.pathCache).lineLimit(1)
            Text("·")
            Text(faq.origin).foregroundStyle(Theme.textDimmed).fixedSize()
            Label("\(faq.agents?.count ?? 0)", systemImage: "sparkles")
              .labelStyle(KnowledgeCompactLabel())
              .foregroundStyle(Theme.textDimmed)
              .fixedSize()
              .accessibilityLabel("\(faq.agents?.count ?? 0) assistants")
          }
          .font(.lnCaption)
          .foregroundStyle(Theme.textMuted)
        }
        Spacer(minLength: 8)
        VStack(alignment: .trailing, spacing: 4) {
          StatusDot(status: faq.status)
          Text(DateText.short(faq.updatedAt)).font(.lnCaption).foregroundStyle(Theme.textDimmed)
        }
      }
      .padding(.vertical, 8)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  @ViewBuilder private func menu(for faq: KnowledgeFAQItem) -> some View {
    Button { sheet = .faq(faq.id) } label: { Label("Edit", systemImage: "square.and.pencil") }
    Menu {
      themeChoices { id in Task { await patch(faq.id, ["nodeId": id]) } }
    } label: { Label("Move to theme", systemImage: "arrow.right.circle") }
    Menu {
      statusChoices { status in Task { await patch(faq.id, ["status": status]) } }
    } label: { Label("Set status", systemImage: "flag") }
    Button { selecting = true; selection.insert(faq.id) } label: { Label("Select", systemImage: "checkmark.circle") }
    Divider()
    Button(role: .destructive) { pendingDelete = faq } label: { Label("Delete", systemImage: "trash") }
  }

  private var pager: some View {
    HStack(spacing: 6) {
      Text("\(query.skip + 1)–\(min(query.skip + limit, total)) of \(total)").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
      Spacer()
      IconButton(systemImage: "chevron.left", label: "Previous page", bordered: true) { query.skip = max(0, query.skip - limit) }
        .disabled(query.skip == 0).opacity(query.skip == 0 ? 0.4 : 1)
      IconButton(systemImage: "chevron.right", label: "Next page", bordered: true) { query.skip += limit }
        .disabled(query.skip + limit >= total).opacity(query.skip + limit >= total ? 0.4 : 1)
    }
    .padding(.vertical, 10)
  }

  /// Linear's selection bar, floating over the list while FAQs are selected.
  private func selectionBar(labelled: Bool) -> some View {
    HStack(spacing: 6) {
      Text("\(selection.count) selected").font(.lnMetaMedium).monospacedDigit().foregroundStyle(Theme.textHighlighted).padding(.horizontal, 6)
      Menu { statusChoices { status in Task { await bulk("status", status: status) } } } label: { barLabel("Set status", "flag", labelled) }
      Menu { themeChoices { id in Task { await bulk("move", nodeId: id) } } } label: { barLabel("Move to theme", "folder", labelled) }
      Button { tagText = ""; tagging = true } label: { barLabel("Add tags", "tag", labelled) }.buttonStyle(.plain)
      Button { confirmBulkDelete = true } label: { barLabel("Delete", "trash", false, tint: Theme.error) }.buttonStyle(.plain)
      Button { selection = []; selecting = false } label: { barLabel("Clear selection", "xmark", false) }.buttonStyle(.plain)
    }
    .padding(6)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    .shadow(color: .black.opacity(0.15), radius: 18, y: 8)
    .fixedSize()
  }

  private func barLabel(_ title: String, _ systemImage: String, _ labelled: Bool, tint: Color = Theme.text) -> some View {
    HStack(spacing: 6) {
      Image(systemName: systemImage).font(.system(size: 13, weight: .medium))
      if labelled { Text(LocalizedStringKey(title)) }
    }
    .font(.lnMetaMedium)
    .foregroundStyle(tint)
    .padding(.horizontal, labelled ? 12 : 0)
    .frame(minWidth: 32, minHeight: 32)
    .background(Theme.elevated, in: Capsule())
    .contentShape(Capsule())
    .accessibilityLabel(LocalizedStringKey(title))
  }

  @ViewBuilder private func statusChoices(_ pick: @escaping (String) -> Void) -> some View {
    ForEach(knowledgeFAQStatuses, id: \.self) { status in Button(knowledgeStatusLabel(status)) { pick(status) } }
  }

  @ViewBuilder private func themeChoices(_ pick: @escaping (String) -> Void) -> some View {
    Button("(root)") { pick("") }
    ForEach(themes) { theme in Button(theme.pathCache) { pick(theme.id) } }
  }

  private func toggle(_ id: String) {
    if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
  }

  // MARK: Data

  private func refresh() {
    Task { await loadFAQs() }
    Task { await loadDashboard() }
    Task { await loadThemes() }
  }

  private func loadFAQs() async {
    var items = ["modelId": model.id, "limit": "\(limit)", "skip": "\(query.skip)"]
    if !query.search.isEmpty { items["q"] = query.search }
    if !query.status.isEmpty { items["status"] = query.status }
    if !query.theme.isEmpty { items["nodeId"] = query.theme }
    do {
      let page: KnowledgeFAQPage = try await session.get("/v1/admin/knowledge/faqs", query: items)
      faqs = page.faqs
      total = page.total
      error = ""
    } catch {
      if Task.isCancelled { return }
      self.error = error.localizedDescription
    }
    loading = false
  }

  private func loadDashboard() async {
    struct Response: Decodable, Sendable { let dashboard: KnowledgeDashboard }
    if let response: Response = try? await session.get("/v1/admin/knowledge/models/\(model.id)/dashboard") { dashboard = response.dashboard }
  }

  private func loadThemes() async {
    if let response: KnowledgeThemeList = try? await session.get("/v1/admin/knowledge/nodes", query: ["modelId": model.id]) { themes = response.nodes }
  }

  private func patch(_ id: String, _ body: [String: String]) async {
    do {
      let _: JSONValue = try await session.send("/v1/admin/knowledge/faqs/\(id)", method: "PATCH", body: body)
      refresh()
    } catch { self.error = error.localizedDescription }
  }

  private func delete(_ faq: KnowledgeFAQItem) async {
    do {
      try await session.delete("/v1/admin/knowledge/faqs/\(faq.id)")
      selection.remove(faq.id)
      await loadFAQs(); await loadDashboard()
    } catch { self.error = error.localizedDescription }
  }

  private func bulk(_ action: String, status: String? = nil, nodeId: String? = nil, tags: [String]? = nil) async {
    struct Input: Encodable, Sendable { let ids: [String]; let action: String; let status, nodeId: String?; let tags: [String]? }
    do {
      let _: JSONValue = try await session.send("/v1/admin/knowledge/faqs/bulk", body: Input(ids: Array(selection), action: action, status: status, nodeId: nodeId, tags: tags))
      selection = []
      selecting = false
      refresh()
    } catch { self.error = error.localizedDescription }
  }

  /// The API copies the model (FAQs, themes, documents); the list shows the copy.
  private func duplicate() async {
    reindexing = true
    defer { reindexing = false }
    do {
      let _: JSONValue = try await session.send("/v1/admin/knowledge/models/\(model.id)/duplicate")
      dismiss()
    } catch { self.error = error.localizedDescription }
  }

  private func reindex() async {
    reindexing = true
    defer { reindexing = false }
    do {
      let _: JSONValue = try await session.send("/v1/admin/knowledge/models/\(model.id)/reindex")
      // Indexing runs in the background; the web reloads the counts after 1.5 s too.
      try? await Task.sleep(for: .milliseconds(1500))
      await loadDashboard()
    } catch { self.error = error.localizedDescription }
  }
}

/// Icon and count, tight, for the row's assistants count.
private struct KnowledgeCompactLabel: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 3) { configuration.icon.font(.system(size: 10)); configuration.title }
  }
}
