import SwiftUI

/// The workspace (web: Settings → Workspace): rename, export and import (TransferSection), delete.
struct WorkspaceScreen: View {
  @Environment(SessionStore.self) private var session
  @State private var name = ""
  @State private var saving = false
  @State private var saved = false
  @State private var error = ""
  @State private var deleting = false

  private var workspaceName: String { session.workspace?.name ?? "" }
  private var dirty: Bool { name.trimmingCharacters(in: .whitespaces) != workspaceName }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 32) {
        VStack(alignment: .leading, spacing: 12) {
          LabeledField(label: "Workspace name", hint: "Shown in the workspace menu and in invitations") {
            TextField("", text: $name).textFieldStyle(.linear).disabled(!session.canManage)
              .onChange(of: name) { _, value in if value.count > 80 { name = String(value.prefix(80)) } }
              .onSubmit { Task { await save() } }
          }
          ErrorText(message: error)
          if session.canManage {
            HStack(spacing: 12) {
              Button { Task { await save() } } label: { if saving { ProgressView() } else { Text("Save") } }
                .buttonStyle(.lnPrimary).disabled(!dirty || saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
              if saved && !dirty { SuccessText(message: String(localized: "Saved")) }
            }
          } else {
            Text("Only admins and owners can change the workspace's settings.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          }
        }

        if session.canManage { TransferSection() }
        SendingDomainsSection()

        if session.isOwner {
          VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Danger zone")
            HStack(spacing: 12) {
              VStack(alignment: .leading, spacing: 3) {
                Text("Delete workspace").font(.lnRow).foregroundStyle(Theme.textHighlighted)
                Text("Its projects, conversations, contacts, knowledge and files go for good. Everyone's account stays.").font(.lnCaption).foregroundStyle(Theme.textMuted)
              }
              Spacer(minLength: 8)
              Button("Delete…", role: .destructive) { deleting = true }.buttonStyle(.lnSecondaryCompact).tint(Theme.error)
            }
            .padding(14)
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.error.opacity(0.35)))
          }
        }
      }
      .settingsColumn()
    }
    .scrollDismissesKeyboard(.interactively)
    .panelScreen("Workspace")
    .task(id: session.workspace?.id) {
      name = workspaceName
    }
    .sheet(isPresented: $deleting) { DeleteWorkspaceSheet() }
  }

  private func save() async {
    struct Input: Encodable, Sendable { let name: String }
    struct Output: Decodable, Sendable { let workspace: WorkspaceSummary }
    guard dirty, session.canManage else { return }
    saving = true; error = ""; saved = false
    defer { saving = false }
    do {
      let _: Output = try await session.send("/v1/admin/workspace", method: "PATCH", body: Input(name: name))
      await session.refreshContext()
      name = workspaceName
      saved = true
    } catch { self.error = error.localizedDescription }
  }
}

/// `DELETE /v1/admin/workspace`: closes the workspace at once and deletes everything in the background.
/// The name has to be typed back, as on the web.
private struct DeleteWorkspaceSheet: View {
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var confirmName = ""
  @State private var working = false
  @State private var error = ""
  @State private var createOpen = false

  private var workspaceName: String { session.workspace?.name ?? "" }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Everything in \(workspaceName) is deleted: its projects, conversations, contacts, knowledge, emails and files. The widget and the API stop answering at once. This can't be undone, so export the data first if you want a copy.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Type \(workspaceName) to confirm") {
            TextField("", text: $confirmName).textFieldStyle(.linear).autocorrectionDisabled().textInputAutocapitalization(.never)
          }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("Delete this workspace?")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .destructiveAction) {
          if working { ProgressView() } else {
            Button("Delete workspace", role: .destructive) { Task { await remove() } }.disabled(confirmName != workspaceName)
          }
        }
      }
    }
    .presentationDetents([.medium])
    .sheet(isPresented: $createOpen, onDismiss: { dismiss() }) { NewWorkspaceSheet() }
  }

  private func remove() async {
    struct Input: Encodable, Sendable { let confirm: String }
    struct Output: Decodable, Sendable { let deleting: Bool }
    let id = session.workspace?.id ?? ""
    working = true; error = ""
    defer { working = false }
    do {
      let _: Output = try await session.send("/v1/admin/workspace", method: "DELETE", body: Input(confirm: confirmName))
    } catch { self.error = error.localizedDescription; return }
    // Nothing on screen belongs anywhere now: start over in another workspace, or make one.
    if let next = session.workspaces.first(where: { $0.id != id && ($0.status ?? "active") == "active" }) {
      await session.switchWorkspace(next.id)
      dismiss()
    } else {
      await session.refreshContext()
      createOpen = true
    }
  }
}
