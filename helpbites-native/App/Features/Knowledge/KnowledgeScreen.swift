import SwiftUI

/// A project's knowledge models (web: /projects/[id]/knowledge), or with no
/// project every project's, filterable by project (web: /knowledge). A row opens
/// the model; a new model opens as soon as it's created.
struct KnowledgeScreen: View {
  let projectId: String?
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  /// The global page's project filter; nil is every project.
  @State private var filter: String?
  @State private var models: [KnowledgeModel] = []
  @State private var loading = true
  @State private var error = ""
  @State private var creating = false
  @State private var created: KnowledgeModel?
  @State private var opened: KnowledgeModel?

  var body: some View {
    Group {
      if loading && models.isEmpty {
        SkeletonRows(count: 3).frame(maxHeight: .infinity, alignment: .top)
      } else if models.isEmpty {
        VStack(spacing: 0) {
          ErrorText(message: error).padding(.top, Metrics.gutter)
          EmptyState(systemImage: "book", title: "No knowledge models yet", message: projectId == nil ? "Create a knowledge model, then import a markdown or text document to review the FAQs it produces. Pick a project first." : "A model holds the FAQs and source documents this project's assistants answer from.") {
            Button { creating = true } label: { Label("New model", systemImage: "plus") }.buttonStyle(.lnPrimary).disabled(createProjectId == nil)
          }
        }
        .frame(maxHeight: .infinity)
      } else {
        List {
          if !error.isEmpty { ErrorText(message: error).linearRow() }
          ForEach(models) { model in
            NavigationLink { KnowledgeModelScreen(model: model) } label: { row(model) }.linearRow()
          }
        }
        .linearList()
        .refreshable { await load() }
      }
    }
    .modifier(KnowledgeChrome(projectId: projectId))
    .toolbar {
      if projectId == nil {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Picker("Project", selection: $filter) {
              Text("All projects").tag(String?.none)
              ForEach(workspace.projects) { project in Text(project.name).tag(Optional(project.id)) }
            }
          } label: {
            Label(filter.flatMap { workspace.project($0)?.name } ?? String(localized: "All projects"), systemImage: "line.3.horizontal.decrease.circle")
          }
        }
      }
      ToolbarItem(placement: .primaryAction) {
        Button { creating = true } label: { Label("New model", systemImage: "plus") }.disabled(createProjectId == nil)
      }
    }
    // Runs on every appearance, so returning from a renamed or deleted model refreshes the list.
    .task(id: filter) { await load() }
    .sheet(isPresented: $creating, onDismiss: { opened = created; created = nil }) {
      if let createProjectId { KnowledgeNewModelSheet(projectId: createProjectId) { created = $0 } }
    }
    .navigationDestination(isPresented: Binding(get: { opened != nil }, set: { if !$0 { opened = nil } })) {
      if let opened { KnowledgeModelScreen(model: opened) }
    }
  }

  private func row(_ model: KnowledgeModel) -> some View {
    HStack(spacing: 12) {
      Image(systemName: "book.closed").font(.system(size: 14)).foregroundStyle(Theme.textMuted).frame(width: 18)
      Text(model.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1).layoutPriority(1)
      Text(model.description).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
      Spacer(minLength: 8)
      if projectId == nil {
        let project = workspace.project(model.projectId)
        HStack(spacing: 6) {
          ProjectDot(id: model.projectId, accent: project?.theme.accent, icon: project?.iconUrl)
          Text(project?.name ?? String(localized: "Unknown project")).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
        }
      }
      StatusDot(status: model.status)
    }
    .frame(minHeight: Metrics.rowHeight)
  }

  private func load() async {
    struct Response: Decodable, Sendable { let models: [KnowledgeModel] }
    do {
      let scope = projectId ?? filter
      let response: Response = try await session.get("/v1/admin/knowledge/models", query: scope.map { ["projectId": $0] } ?? [:])
      models = response.models
      error = ""
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
    loading = false
  }
}

extension KnowledgeScreen {
  /// New models belong to a project: this one, or the one the global page is filtered to.
  private var createProjectId: String? { projectId ?? filter }
}

/// A project's breadcrumb, or the global page's plain title.
private struct KnowledgeChrome: ViewModifier {
  let projectId: String?
  func body(content: Content) -> some View {
    if let projectId { content.projectScreen(projectId, "Knowledge base") } else { content.panelScreen("Knowledge") }
  }
}

private struct KnowledgeNewModelSheet: View {
  let projectId: String
  var onCreated: (KnowledgeModel) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var description = ""
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Name it after a product or support area within this project.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Name") { TextField("", text: $name).textFieldStyle(.linear).onSubmit { Task { await create() } } }
          LabeledField(label: "Description", hint: "Optional") { LinearTextEditor(text: $description, minHeight: 80) }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("New knowledge model")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Create") { Task { await create() } }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || saving)
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func create() async {
    struct Input: Encodable, Sendable { let projectId, name, description: String }
    struct Output: Decodable, Sendable { let model: KnowledgeModel }
    guard !name.trimmingCharacters(in: .whitespaces).isEmpty, !saving else { return }
    saving = true; error = ""
    defer { saving = false }
    do {
      let output: Output = try await session.send("/v1/admin/knowledge/models", body: Input(projectId: projectId, name: name, description: description))
      onCreated(output.model)
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
