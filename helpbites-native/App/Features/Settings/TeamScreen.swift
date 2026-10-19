import SwiftUI

/// Teammates and AI agents in one list (pages/agents.vue).
struct TeamScreen: View {
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var people: [Agent] = []
  @State private var assistants: [SupportAgent] = []
  @State private var loading = true
  @State private var filter = Filter.all
  @State private var query = ""
  @State private var error = ""
  @State private var addingTeammate = false
  @State private var addingAssistant = false
  @State private var removing: Row?

  private enum Filter { case all, people, ai }

  private struct Row: Identifiable {
    let id: String
    let agentId: String
    let isAI: Bool
    let name, detail, project, status, projectId: String
    let isMe: Bool
  }

  private var rows: [Row] {
    let projectNames = Dictionary(workspace.projects.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
    let humans = people.map { agent in
      Row(id: "human-\(agent.id)", agentId: agent.id, isAI: false, name: agent.name.isEmpty ? agent.username : agent.name, detail: [agent.username, agent.email].filter { !$0.isEmpty }.joined(separator: " · "), project: "All projects", status: "active", projectId: "", isMe: agent.id == session.agent?.id)
    }
    let bots = assistants.map { agent in
      Row(id: "ai-\(agent.id)", agentId: agent.id, isAI: true, name: agent.name, detail: !agent.description.isEmpty ? agent.description : !agent.model.isEmpty ? agent.model : "No description", project: projectNames[agent.projectId] ?? "No project", status: agent.status, projectId: agent.projectId, isMe: false)
    }
    return humans + bots
  }

  private var visibleRows: [Row] {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    return rows.filter { row in
      (filter == .all || row.isAI == (filter == .ai)) && (needle.isEmpty || "\(row.name) \(row.detail) \(row.project)".lowercased().contains(needle))
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      VStack(spacing: 10) {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 6) {
            Pill(label: "All", count: people.count + assistants.count, isActive: filter == .all) { filter = .all }
            Pill(label: "People", count: people.count, isActive: filter == .people) { filter = .people }
            Pill(label: "AI", count: assistants.count, isActive: filter == .ai) { filter = .ai }
          }
        }
        SearchField(text: $query)
      }
      .padding(.horizontal, Metrics.gutter)
      .padding(.vertical, 10)
      .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 0.5) }

      if loading {
        SkeletonRows(count: 5)
        Spacer(minLength: 0)
      } else if visibleRows.isEmpty {
        EmptyState(systemImage: "person.2", title: "No matching agents", message: "Try a different filter, or add a teammate or AI agent.")
        Spacer(minLength: 0)
      } else {
        List(visibleRows) { row in
          if row.isAI && !row.projectId.isEmpty {
            Button { workspace.go(.project(row.projectId, .assistants)) } label: { rowContent(row).contentShape(Rectangle()) }
              .buttonStyle(.plain)
              .accessibilityHint("Opens the project's assistants")
              .linearRow()
          } else {
            rowContent(row).linearRow()
          }
        }
        .linearList()
        .refreshable { await load() }
      }
    }
    .panelScreen("Team")
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        IconButton(systemImage: "person.badge.plus", label: "Add teammate") { addingTeammate = true }
        Button { addingAssistant = true } label: { Label("New AI agent", systemImage: "plus") }
          .disabled(workspace.projects.isEmpty)
      }
    }
    .task {
      if workspace.projects.isEmpty { await workspace.loadProjects() }
      await load()
    }
    .alert(error, isPresented: Binding(get: { !error.isEmpty }, set: { if !$0 { error = "" } })) { Button("OK", role: .cancel) {} }
    .confirmationDialog("Remove \(removing?.name ?? "")? They will be signed out everywhere.", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { row in
      Button("Remove", role: .destructive) { Task { await remove(row) } }
    }
    .sheet(isPresented: $addingTeammate) { TeamAddTeammateSheet { await load() } }
    .sheet(isPresented: $addingAssistant) { TeamNewAssistantSheet() }
  }

  private func rowContent(_ row: Row) -> some View {
    HStack(spacing: 12) {
      if row.isAI {
        Image(systemName: "sparkles")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(Theme.accentText)
          .frame(width: 28, height: 28)
          .background(Theme.accent.opacity(0.12), in: Circle())
          .accessibilityHidden(true)
      } else {
        Avatar(name: row.name, size: 28)
      }
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(row.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Tag(text: row.isAI ? "AI agent" : "Teammate", tint: row.isAI ? Theme.accent : nil)
          if row.isMe { Text("You").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        }
        Text(row.detail).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
      }
      Spacer(minLength: 8)
      VStack(alignment: .trailing, spacing: 4) {
        if sizeClass == .regular { Text(row.project).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1) }
        StatusDot(status: row.status)
      }
      if row.isAI {
        if !row.projectId.isEmpty { Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.textDimmed) }
      } else if !row.isMe {
        IconButton(systemImage: "trash", label: "Remove teammate") { removing = row }
      }
    }
    .padding(.vertical, 8)
    .frame(minHeight: Metrics.rowHeight)
  }

  private func load() async {
    struct People: Decodable, Sendable { let agents: [Agent] }
    struct Assistants: Decodable, Sendable { let agents: [SupportAgent] }
    let session = session
    do {
      async let humans: People = session.get("/v1/admin/agents")
      async let bots: Assistants = session.get("/v1/admin/support-agents")
      let (fetchedPeople, fetchedBots) = try await (humans, bots)
      people = fetchedPeople.agents
      assistants = fetchedBots.agents
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
    loading = false
  }

  private func remove(_ row: Row) async {
    do {
      try await session.delete("/v1/admin/agents/\(row.agentId)")
      await load()
    } catch { self.error = error.localizedDescription }
  }
}

private struct TeamAddTeammateSheet: View {
  var onAdded: () async -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var email = ""
  @State private var username = ""
  @State private var password = ""
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Create a teammate account for someone who will work in the support inbox.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Name") { TextField("", text: $name).textFieldStyle(.linear) }
          LabeledField(label: "Email", hint: "Optional") {
            TextField("", text: $email).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          LabeledField(label: "Username") {
            TextField("", text: $username).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          LabeledField(label: "Password", hint: "At least 8 characters") { SecureField("", text: $password).textFieldStyle(.linear) }
          ErrorText(message: error)
        }
        .padding(20)
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .panelScreen("Add teammate")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if saving { ProgressView() } else {
            Button("Add teammate") { Task { await save() } }
              .disabled(username.trimmingCharacters(in: .whitespaces).isEmpty || password.count < 8)
          }
        }
      }
    }
  }

  private func save() async {
    struct Input: Encodable, Sendable { let name, email, username, password: String }
    struct Output: Decodable, Sendable { let agent: Agent }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let _: Output = try await session.send("/v1/admin/agents", body: Input(name: name, email: email, username: username, password: password))
      await onAdded()
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}

private struct TeamNewAssistantSheet: View {
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var projectId = ""
  @State private var name = ""
  @State private var description = ""
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Start with a focused project and configure its knowledge access afterwards.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Project") {
            Picker("Project", selection: $projectId) {
              ForEach(workspace.projects) { project in Text(project.name).tag(project.id) }
            }
            .pickerStyle(.menu)
            .tint(Theme.text)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .padding(.horizontal, 4)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
          }
          LabeledField(label: "Name") { TextField("", text: $name).textFieldStyle(.linear) }
          LabeledField(label: "Description", hint: "Optional") { LinearTextEditor(text: $description, minHeight: 80) }
          ErrorText(message: error)
        }
        .padding(20)
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .panelScreen("New AI agent")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if saving { ProgressView() } else {
            Button("Create AI agent") { Task { await save() } }
              .disabled(projectId.isEmpty || name.trimmingCharacters(in: .whitespaces).isEmpty)
          }
        }
      }
      .onAppear { if projectId.isEmpty { projectId = workspace.projects.first?.id ?? "" } }
    }
  }

  private func save() async {
    struct Input: Encodable, Sendable { let projectId, name, description: String }
    struct Output: Decodable, Sendable { let agent: SupportAgent }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let _: Output = try await session.send("/v1/admin/support-agents", body: Input(projectId: projectId, name: name, description: description))
      dismiss()
      workspace.go(.project(projectId, .assistants))
    } catch { self.error = error.localizedDescription }
  }
}
