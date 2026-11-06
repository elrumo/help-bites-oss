import SwiftUI

/// Teammates and AI agents in one list (pages/agents.vue).
struct TeamScreen: View {
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var people: [TeamMember] = []
  @State private var invitations: [TeamInvitation] = []
  @State private var assistants: [SupportAgent] = []
  @State private var loading = true
  @State private var filter = Filter.all
  @State private var query = ""
  @State private var error = ""
  @State private var addingTeammate = false
  @State private var inviting = false
  @State private var addingAssistant = false
  @State private var removing: Row?
  @State private var revoking: Row?

  private enum Filter { case all, people, ai }

  private struct Row: Identifiable {
    let id: String
    let agentId: String
    let isAI: Bool
    let name, detail, project, status, projectId: String
    let isMe: Bool
    var role: TeamRole? = nil
    var invitationId: String? = nil
    var isInvite: Bool { invitationId != nil }
  }

  private var rows: [Row] {
    let projectNames = Dictionary(workspace.projects.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
    let humans = people.map { agent in
      Row(id: "human-\(agent.id)", agentId: agent.id, isAI: false, name: agent.name.isEmpty ? agent.username : agent.name, detail: [agent.username, agent.email].filter { !$0.isEmpty }.joined(separator: " · "), project: String(localized: "All projects"), status: "active", projectId: "", isMe: agent.id == session.agent?.id, role: TeamRole(agent.role))
    }
    let invited = invitations.map { invite in
      Row(id: "invite-\(invite.id)", agentId: invite.id, isAI: false, name: invite.email, detail: invite.invitedBy.isEmpty ? String(localized: "Invited") : String(localized: "Invited by \(invite.invitedBy)"), project: String(localized: "All projects"), status: "pending", projectId: "", isMe: false, role: TeamRole(invite.role), invitationId: invite.id)
    }
    let bots = assistants.map { agent in
      Row(id: "ai-\(agent.id)", agentId: agent.id, isAI: true, name: agent.name, detail: !agent.description.isEmpty ? agent.description : !agent.model.isEmpty ? agent.model : String(localized: "No description"), project: projectNames[agent.projectId] ?? String(localized: "No project"), status: agent.status, projectId: agent.projectId, isMe: false)
    }
    return humans + invited + bots
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
            Pill(label: "All", count: people.count + invitations.count + assistants.count, isActive: filter == .all) { filter = .all }
            Pill(label: "People", count: people.count + invitations.count, isActive: filter == .people) { filter = .people }
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
        if session.canManage {
          IconButton(systemImage: "envelope.badge.person.crop", label: "Invite by email") { inviting = true }
          if session.hasFeature("teammatePasswords") { IconButton(systemImage: "person.badge.plus", label: "Add teammate with a password") { addingTeammate = true } }
          Button { addingAssistant = true } label: { Label("New AI agent", systemImage: "plus") }
            .disabled(workspace.projects.isEmpty)
        }
      }
    }
    .task {
      if workspace.projects.isEmpty { await workspace.loadProjects() }
      await load()
    }
    .alert(error, isPresented: Binding(get: { !error.isEmpty }, set: { if !$0 { error = "" } })) { Button("OK", role: .cancel) {} }
    .confirmationDialog("Remove \(removing?.name ?? "") from this workspace? They lose access to it at once.", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { row in
      Button("Remove", role: .destructive) { Task { await remove(row) } }
    }
    .confirmationDialog("Revoke the invitation to \(revoking?.name ?? "")?", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), titleVisibility: .visible, presenting: revoking) { row in
      Button("Revoke", role: .destructive) { Task { await revoke(row) } }
    }
    .sheet(isPresented: $inviting) { TeamInviteSheet { await load() } }
    .sheet(isPresented: $addingTeammate) { TeamAddTeammateSheet { await load() } }
    .sheet(isPresented: $addingAssistant) { TeamNewAssistantSheet() }
  }

  private func rowContent(_ row: Row) -> some View {
    HStack(spacing: 12) {
      if row.isAI {
        Image(systemName: "sparkles")
          .font(.app(size: 12, weight: .semibold))
          .foregroundStyle(Theme.accentText)
          .frame(width: 28, height: 28)
          .background(Theme.accent.opacity(0.12), in: Circle())
          .accessibilityHidden(true)
      } else {
        if row.isInvite {
          Image(systemName: "envelope").font(.app(size: 12, weight: .semibold)).foregroundStyle(Theme.textMuted)
            .frame(width: 28, height: 28).background(Theme.elevated, in: Circle()).accessibilityHidden(true)
        } else {
          Avatar(name: row.name, size: 28)
        }
      }
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(row.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Tag(text: row.isAI ? "AI agent" : row.isInvite ? "Invited" : "Teammate", tint: row.isAI ? Theme.accent : nil)
          if row.isMe { Text("You").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        }
        Text(row.detail).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
      }
      Spacer(minLength: 8)
      if let role = row.role { roleControl(row, role) }
      else {
        VStack(alignment: .trailing, spacing: 4) {
          if sizeClass == .regular { Text(row.project).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1) }
          StatusDot(status: row.status)
        }
      }
      if row.isAI {
        if !row.projectId.isEmpty { Image(systemName: "arrow.up.right").font(.app(size: 12, weight: .medium)).foregroundStyle(Theme.textDimmed) }
      } else if row.isInvite {
        if session.canManage { IconButton(systemImage: "xmark", label: "Revoke the invitation to \(row.name)") { revoking = row } }
      } else if session.canManage && !row.isMe && canChange(row) {
        IconButton(systemImage: "trash", label: "Remove \(row.name)") { removing = row }
      }
    }
    .padding(.vertical, 8)
    .frame(minHeight: Metrics.rowHeight)
  }

  /// The role as a menu when you may change it, else a quiet label. Only owners touch owners.
  @ViewBuilder private func roleControl(_ row: Row, _ role: TeamRole) -> some View {
    if session.canManage && !row.isMe && !row.isInvite && canChange(row) {
      Menu {
        ForEach(TeamRole.allCases.filter { session.teamRole.canGrant($0) }) { option in
          Button { Task { await setRole(row, option) } } label: { if option == role { Label(option.label, systemImage: "checkmark") } else { Text(option.label) } }
        }
      } label: {
        HStack(spacing: 4) { Text(role.label); Image(systemName: "chevron.up.chevron.down").font(.app(size: 9, weight: .semibold)) }
          .font(.lnCaptionMedium).foregroundStyle(Theme.textToned)
      }
      .menuIndicator(.hidden).fixedSize()
      .accessibilityLabel("Role of \(row.name)")
    } else {
      Text(role.label).font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  private func canChange(_ row: Row) -> Bool { row.role != .owner || session.isOwner }

  private func load() async {
    struct People: Decodable, Sendable { let agents: [TeamMember] }
    struct Assistants: Decodable, Sendable { let agents: [SupportAgent] }
    struct Invites: Decodable, Sendable { let invitations: [TeamInvitation] }
    let session = session
    do {
      async let humans: People = session.get("/v1/admin/agents")
      async let bots: Assistants = session.get("/v1/admin/support-agents")
      let (fetchedPeople, fetchedBots) = try await (humans, bots)
      people = fetchedPeople.agents
      assistants = fetchedBots.agents
      if session.canManage { invitations = (try await session.get("/v1/admin/invitations") as Invites).invitations } else { invitations = [] }
    } catch {
      if !Task.isCancelled { self.error = error.localizedDescription }
    }
    loading = false
  }

  private func setRole(_ row: Row, _ role: TeamRole) async {
    struct Input: Encodable, Sendable { let role: String }
    struct Output: Decodable, Sendable { let agent: TeamMember }
    do {
      let output: Output = try await session.send("/v1/admin/agents/\(row.agentId)", method: "PATCH", body: Input(role: role.rawValue))
      people = people.map { $0.id == output.agent.id ? output.agent : $0 }
    } catch { self.error = error.localizedDescription }
  }

  private func revoke(_ row: Row) async {
    do {
      try await session.delete("/v1/admin/invitations/\(row.agentId)")
      invitations.removeAll { $0.id == row.agentId }
    } catch { self.error = error.localizedDescription }
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
  @State private var role = TeamRole.admin
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Create a teammate account for someone who will work in the support inbox. Share the username and password with them yourself; nothing is emailed.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Name") { TextField("", text: $name).textFieldStyle(.linear) }
          LabeledField(label: "Email", hint: "Optional") {
            TextField("", text: $email).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          LabeledField(label: "Username") {
            TextField("", text: $username).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          LabeledField(label: "Password", hint: "At least 8 characters") { SecureField("", text: $password).textFieldStyle(.linear) }
          LabeledField(label: "Role") { MenuPicker(selection: $role, options: TeamRole.allCases.filter { session.teamRole.canGrant($0) }.map { PickerOption(value: $0, label: $0.label) }, title: "Role") }
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
    struct Input: Encodable, Sendable { let name, email, username, password, role: String }
    struct Output: Decodable, Sendable { let agent: TeamMember }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let _: Output = try await session.send("/v1/admin/agents", body: Input(name: name, email: email, username: username, password: password, role: role.rawValue))
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
