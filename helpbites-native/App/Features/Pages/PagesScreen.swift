import SwiftUI

/// A project's pages and content (web: projects/[id]/pages/index.vue): its entries, files and
/// settings. Components are written in the web panel; here an entry uses the ones that exist.
struct PagesScreen: View {
  let projectId: String
  @State private var tab: PagesTab = .pages

  private enum PagesTab: String, CaseIterable, Identifiable {
    case pages, files, settings
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
  }

  var body: some View {
    VStack(spacing: 0) {
      Picker("Section", selection: $tab) {
        ForEach(PagesTab.allCases) { Text($0.label).tag($0) }
      }
      .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 440)
      .padding(.horizontal, 20).padding(.vertical, 12)
      .frame(maxWidth: .infinity, alignment: .leading)
      switch tab {
      case .pages: PagesEntriesView(projectId: projectId)
      case .files: PagesFilesView(projectId: projectId)
      case .settings: PagesSettingsView(projectId: projectId)
      }
    }
    .projectScreen(projectId, "Pages")
  }
}

/// The entries, newest edit first, with search, a type filter, and publish, unpublish and delete.
struct PagesEntriesView: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @Environment(\.openURL) private var openURL
  @State private var entries: [CmsEntry] = []
  @State private var loading = true
  @State private var error = ""
  @State private var query = ""
  @State private var type = ""
  @State private var creating = false
  /// The entry the sheet just made, pushed once the sheet is gone.
  @State private var created: String?
  @State private var path: String?
  @State private var busy = ""
  @State private var deleting: CmsEntry?

  private var types: [String] { Array(Set(entries.map(\.type))).sorted() }
  private var shown: [CmsEntry] {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    return entries.filter { (type.isEmpty || $0.type == type) && (needle.isEmpty || $0.name.lowercased().contains(needle) || $0.slug.contains(needle)) }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Text("Landing pages you design here and HelpBites hosts, and content your own app reads over the API: pages, blog posts or any type you define.")
          .font(.lnMeta).foregroundStyle(Theme.textMuted)
        ErrorText(message: error)
        if loading && entries.isEmpty {
          SkeletonRows(count: 3)
        } else if entries.isEmpty && error.isEmpty {
          EmptyState(systemImage: "doc.richtext", title: "No pages yet", message: "Start from a template. Nothing is public until you publish it.") {
            Button { creating = true } label: { Label("New page", systemImage: "plus") }.buttonStyle(.lnPrimaryCompact)
          }
          .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else if !entries.isEmpty {
          SearchField(text: $query, prompt: "Search pages")
          if types.count > 1 {
            ScrollView(.horizontal, showsIndicators: false) {
              HStack(spacing: 8) {
                Pill(label: "All types", isActive: type.isEmpty) { type = "" }
                ForEach(types, id: \.self) { name in Pill(label: name, isActive: type == name) { type = name } }
              }
            }
          }
          if shown.isEmpty {
            Text("No page matches.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          } else {
            Card {
              ForEach(Array(shown.enumerated()), id: \.element.id) { index, entry in
                CardRow(divider: index < shown.count - 1) { row(entry) }
              }
            }
          }
        }
      }
      .frame(maxWidth: 760, alignment: .leading)
      .padding(.horizontal, 20)
      .padding(.bottom, 28)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .refreshable { await load() }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button { creating = true } label: { Label("New page", systemImage: "plus") }.disabled(entries.count >= CmsLimits.entries)
      }
    }
    .sheet(isPresented: $creating, onDismiss: {
      if let created { path = created; self.created = nil }
    }) {
      PagesNewSheet(projectId: projectId) { entry in
        entries.insert(entry, at: 0)
        created = entry.id
      }
    }
    .navigationDestination(item: $path) { id in PageEntryScreen(projectId: projectId, entryId: id) }
    .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { entry in
      Button("Delete page", role: .destructive) { Task { await delete(entry) } }
    } message: { _ in
      Text("Its page stops working at once. This cannot be undone.")
    }
    .task { await load() }
  }

  private func row(_ entry: CmsEntry) -> some View {
    HStack(spacing: 4) {
      NavigationLink(value: AppRoute.pageEntry(projectId, entry.id)) {
        HStack(spacing: 10) {
          VStack(alignment: .leading, spacing: 2) {
            Text(entry.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
            HStack(spacing: 6) {
              Text(entry.displayPath).font(.lnMono).foregroundStyle(Theme.textMuted).lineLimit(1)
              if entry.type != "page" { Text(entry.type).font(.lnMono).foregroundStyle(Theme.textDimmed) }
            }
            HStack(spacing: 6) {
              Tag(text: entry.statusLabel, tint: entry.isPublished ? Theme.success : Theme.textDimmed)
              if entry.changed { Tag(text: "Unpublished changes", tint: Theme.warning) }
              if let updatedAt = entry.updatedAt { Text(DateText.day(updatedAt)).font(.lnCaption).foregroundStyle(Theme.textMuted) }
            }
            .padding(.top, 4)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      Menu { actions(entry) } label: {
        Image(systemName: "ellipsis").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).contentShape(Rectangle())
      }
      .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
      .disabled(busy == entry.id)
      .accessibilityLabel("Actions for \(entry.name)")
    }
  }

  @ViewBuilder private func actions(_ entry: CmsEntry) -> some View {
    if entry.isPublished, let url = LegalAPI.publicURL(session, entry.path) {
      Button { openURL(url) } label: { Label("Open page", systemImage: "arrow.up.right.square") }
      Button { Clipboard.copy(url.absoluteString) } label: { Label("Copy link", systemImage: "link") }
    }
    if entry.isPublished {
      Button { Task { await run(entry, "unpublish") } } label: { Label("Unpublish", systemImage: "eye.slash") }
    } else {
      Button { Task { await run(entry, "publish") } } label: { Label("Publish", systemImage: "paperplane") }
    }
    Divider()
    Button(role: .destructive) { deleting = entry } label: { Label("Delete", systemImage: "trash") }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let entries: [CmsEntry] }
    do {
      let response: Response = try await session.get("/v1/admin/cms/entries", query: ["project": projectId])
      entries = response.entries
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
  }

  /// `POST /v1/admin/cms/entries/:id/publish` or `unpublish`; the list keeps the entry without its content.
  private func run(_ entry: CmsEntry, _ action: String) async {
    busy = entry.id
    error = ""
    defer { busy = "" }
    do {
      let response: CmsEntryResponse = try await session.send("/v1/admin/cms/entries/\(entry.id)/\(action)")
      if let index = entries.firstIndex(where: { $0.id == entry.id }) { entries[index] = response.entry }
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func delete(_ entry: CmsEntry) async {
    do {
      try await session.delete("/v1/admin/cms/entries/\(entry.id)")
      entries.removeAll { $0.id == entry.id }
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// A new entry: a page from a template, or an entry of one of the project's own types
/// (web: CmsNewPage.vue, without the assistant's wizard).
private struct PagesNewSheet: View {
  let projectId: String
  let onCreate: (CmsEntry) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var types: [CmsComponent] = []
  @State private var templates: [CmsTemplate] = []
  @State private var type = "page"
  @State private var template = "saas"
  @State private var name = ""
  @State private var loading = true
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if types.count > 1 {
            LabeledField(label: "Type") {
              Picker("Type", selection: $type) {
                ForEach(types) { Text($0.name).tag($0.key) }
              }
              .labelsHidden().fixedSize()
            }
          }
          LabeledField(label: "Name", hint: "Empty takes the template's title") {
            TextField("Launch page", text: $name).textFieldStyle(.linear)
              .onChange(of: name) { _, value in name = value.clipped(to: CmsLimits.name) }
          }
          if type == "page" {
            LegalPanel("Start from") {
              if loading && templates.isEmpty { SkeletonRows(count: 3) }
              ForEach(templates) { item in
                let selected = template == item.id
                Button { template = item.id } label: {
                  HStack(alignment: .top, spacing: 10) {
                    Image(systemName: selected ? "largecircle.fill.circle" : "circle").foregroundStyle(selected ? Theme.accent : Theme.textDimmed)
                    VStack(alignment: .leading, spacing: 2) {
                      Text(item.name).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                      Text(item.description).font(.lnCaption).foregroundStyle(Theme.textMuted).multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                  }
                  .padding(10)
                  .background(selected ? Theme.elevated : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radius))
                  .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(selected ? Theme.borderAccented : Theme.border))
                  .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
              }
            }
          }
          ErrorText(message: error)
        }
        .frame(maxWidth: 560, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("New page")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Create") { Task { await create() } }.disabled(saving || loading)
        }
      }
    }
    .presentationDetents([.large])
    .task { await load() }
  }

  private func load() async {
    struct Components: Decodable, Sendable { let components: [CmsComponent] }
    struct Templates: Decodable, Sendable { let templates: [CmsTemplate] }
    do {
      let components: Components = try await session.get("/v1/admin/cms/components", query: ["project": projectId])
      types = components.components.filter(\.root)
      let list: Templates = try await session.get("/v1/admin/cms/templates")
      templates = list.templates
      if !templates.contains(where: { $0.id == template }), let first = templates.first { template = first.id }
    } catch {
      self.error = error.localizedDescription
    }
    loading = false
  }

  private func create() async {
    struct Input: Encodable, Sendable { let project, type: String; let name, template: String? }
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    saving = true
    error = ""
    defer { saving = false }
    do {
      let response: CmsEntryResponse = try await session.send("/v1/admin/cms/entries", body: Input(
        project: projectId, type: type, name: name.isEmpty ? nil : name, template: type == "page" && template != "blank" ? template : nil
      ))
      onCreate(response.entry)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
