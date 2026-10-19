import SwiftUI

/// Your account (web: Settings → Account): name, email, and the password the
/// server asks for when the email changes. `PATCH /v1/admin/me`.
struct ProfileScreen: View {
  @Environment(SessionStore.self) private var session
  @State private var name = ""
  @State private var email = ""
  @State private var password = ""
  @State private var saving = false
  @State private var saved = false
  @State private var error = ""

  private var agent: Agent? { session.agent }
  private var emailChanging: Bool { email.trimmingCharacters(in: .whitespaces) != (agent?.email ?? "") }
  private var dirty: Bool { name != (agent?.name ?? "") || emailChanging }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        HStack(spacing: 14) {
          Avatar(name: agent?.name ?? "", size: 48)
          VStack(alignment: .leading, spacing: 2) {
            Text(agent?.name.isEmpty == false ? agent!.name : agent?.username ?? "").font(.lnHeading).foregroundStyle(Theme.textHighlighted).lineLimit(1)
            Text("Signed in as \(agent?.username ?? "")").font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
          }
        }

        LabeledField(label: "Name", hint: "Shown to teammates") {
          TextField("", text: $name).textFieldStyle(.linear)
            .onChange(of: name) { _, value in if value.count > 120 { name = String(value.prefix(120)) } }
        }
        LabeledField(label: "Email", hint: "For password resets") {
          TextField("", text: $email).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        if emailChanging {
          LabeledField(label: "Current password", hint: "Needed to change your email") {
            SecureField("", text: $password).textFieldStyle(.linear)
          }
        }
        LabeledField(label: "Username") {
          Text(agent?.username ?? "").font(.lnBody).foregroundStyle(Theme.textMuted)
            .padding(.horizontal, 12).frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
        }

        ErrorText(message: error)
        HStack(spacing: 12) {
          Button { Task { await save() } } label: { if saving { ProgressView() } else { Text("Save profile") } }
            .buttonStyle(.lnPrimary)
            .disabled(!dirty || saving || (emailChanging && password.isEmpty))
            .keyboardShortcut("s", modifiers: .command)
          if saved && !dirty { SuccessText(message: "Saved") }
        }
      }
      .settingsColumn()
    }
    .scrollDismissesKeyboard(.interactively)
    .panelScreen("Profile")
    .onAppear { reset() }
  }

  private func reset() {
    name = agent?.name ?? ""
    email = agent?.email ?? ""
    password = ""
  }

  private func save() async {
    struct Input: Encodable, Sendable { let name, email: String; let currentPassword: String? }
    struct Output: Decodable, Sendable { let agent: Agent }
    saving = true; error = ""; saved = false
    defer { saving = false }
    do {
      let _: Output = try await session.send("/v1/admin/me", method: "PATCH", body: Input(name: name, email: email.trimmingCharacters(in: .whitespaces), currentPassword: emailChanging ? password : nil))
      await session.refreshContext()
      reset()
      saved = true
    } catch { self.error = error.localizedDescription }
  }
}
