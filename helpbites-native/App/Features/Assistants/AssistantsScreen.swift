import SwiftUI

/// A project's AI assistants (web: pages/projects/[id]/assistants.vue). A row, or a
/// newly created assistant, pushes its settings.
struct AssistantsScreen: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var assistants: [SupportAgent] = []
  @State private var loading = true
  @State private var error = ""
  @State private var creating = false
  @State private var created: String?
  @State private var opened: String?

  var body: some View {
    content
      .projectScreen(projectId, "Assistants")
      .toolbar {
        ToolbarItem(placement: .primaryAction) {
          Button { creating = true } label: { Label("New assistant", systemImage: "plus") }
        }
      }
      .sheet(isPresented: $creating, onDismiss: {
        // Push once the sheet is gone, as the web navigates to the new assistant.
        if let created { opened = created; self.created = nil }
      }) {
        AssistantCreateSheet(projectId: projectId) { created = $0.id }
      }
      .navigationDestination(item: $opened) { AssistantDetailScreen(assistantId: $0) }
      // Runs again when a pushed assistant pops, so renames, copies and deletes show.
      .task { await load() }
      // .task may not rerun on a pop (macOS); reload explicitly.
      .onChange(of: opened) { if opened == nil { Task { await load() } } }
  }

  @ViewBuilder private var content: some View {
    if loading && assistants.isEmpty {
      SkeletonRows(count: 3).frame(maxHeight: .infinity, alignment: .top)
    } else if assistants.isEmpty && error.isEmpty {
      EmptyState(systemImage: "sparkles", title: "No assistants yet", message: "An assistant answers this project's users from the knowledge you give it, and hands the rest to your team.") {
        Button { creating = true } label: { Label("New assistant", systemImage: "plus") }.buttonStyle(.lnPrimaryCompact)
      }
      .frame(maxHeight: .infinity, alignment: .top)
    } else {
      List {
        if !error.isEmpty { ErrorText(message: error).padding(.vertical, 8).linearRow() }
        ForEach(assistants) { assistant in
          Button { opened = assistant.id } label: { AssistantRow(assistant: assistant) }
            .buttonStyle(.plain)
            .linearRow(selected: opened == assistant.id)
        }
      }
      .linearList()
      .refreshable { await load() }
    }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let agents: [SupportAgent] }
    do {
      let response: Response = try await session.get("/v1/admin/support-agents", query: ["projectId": projectId])
      assistants = response.agents
      error = ""
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
    loading = false
  }
}

private struct AssistantRow: View {
  let assistant: SupportAgent
  @Environment(\.horizontalSizeClass) private var sizeClass

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: "sparkles")
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(Theme.accentText)
        .frame(width: 20, height: 20)
        .background(Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: Metrics.radiusSmall))
        .accessibilityHidden(true)
      Text(assistant.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1).layoutPriority(1)
      Text(assistant.description.isEmpty ? assistant.model : assistant.description)
        .font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
      if assistant.autoReply {
        // The web drops the word on narrow screens and keeps the glyph.
        if sizeClass == .compact {
          Image(systemName: "bolt").font(.system(size: 12)).foregroundStyle(Theme.textMuted).accessibilityLabel("Auto-reply")
        } else {
          Label("Auto-reply", systemImage: "bolt").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
      }
      StatusDot(status: assistant.status)
    }
    .frame(minHeight: Metrics.rowHeight)
    .contentShape(Rectangle())
  }
}

/// "New assistant" on a project's list. Without a `projectId` it adds the project picker of
/// the Team page's "New AI agent" (web: pages/agents.vue). `onCreated` gets the new assistant.
struct AssistantCreateSheet: View {
  var projectId: String? = nil
  var onCreated: (SupportAgent) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var pickedProject = ""
  @State private var name = ""
  @State private var description = ""
  @State private var saving = false
  @State private var error = ""
  @FocusState private var nameFocused: Bool

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text(projectId == nil ? "Start with a focused project and configure its knowledge access afterwards." : "Name it after the audience it serves, like “Billing”.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
          if projectId == nil {
            LabeledField(label: "Project") {
              AssistantSelectField(selection: $pickedProject, options: workspace.projects.map { AssistantOption(value: $0.id, label: $0.name) }, placeholder: "Choose a project")
            }
          }
          LabeledField(label: "Name") { TextField("", text: $name).textFieldStyle(.linear).focused($nameFocused) }
          LabeledField(label: "Description", hint: "Optional") { LinearTextEditor(text: $description, minHeight: 64) }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen(projectId == nil ? "New AI agent" : "New assistant")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Create") { Task { await create() } }
            .disabled(saving || target.isEmpty || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
      .onAppear {
        if projectId == nil, pickedProject.isEmpty { pickedProject = workspace.projects.first?.id ?? "" }
        nameFocused = true
      }
    }
    .presentationDetents([.medium, .large])
  }

  private var target: String { projectId ?? pickedProject }

  private func create() async {
    struct Input: Encodable, Sendable { let projectId, name, description: String }
    struct Output: Decodable, Sendable { let agent: SupportAgent }
    saving = true; error = ""
    defer { saving = false }
    do {
      let output: Output = try await session.send("/v1/admin/support-agents", body: Input(projectId: target, name: name, description: description))
      onCreated(output.agent)
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
