import SwiftUI

/// `POST /v1/admin/workspaces`: a new, empty workspace you own; the app switches to it.
struct NewWorkspaceSheet: View {
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("A workspace is its own set of projects, team and settings.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Name") { TextField("", text: $name).textFieldStyle(.linear) }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("New workspace")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Create") { Task { await create() } }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || saving)
        }
      }
    }
    .presentationDetents([.medium])
  }

  private func create() async {
    struct Input: Encodable, Sendable { let name: String }
    struct Output: Decodable, Sendable { let workspace: WorkspaceSummary }
    saving = true; error = ""
    defer { saving = false }
    do {
      let output: Output = try await session.send("/v1/admin/workspaces", body: Input(name: name.trimmingCharacters(in: .whitespaces)))
      await session.switchWorkspace(output.workspace.id)
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
