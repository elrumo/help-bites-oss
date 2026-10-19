import SwiftUI

/// A member of the workspace, with their role (`GET /v1/admin/agents`).
struct TeamMember: Decodable, Identifiable, Equatable, Sendable {
  let id, username, email, name: String
  let role: String?
}

/// An invitation still waiting for an answer (`GET /v1/admin/invitations`).
struct TeamInvitation: Decodable, Identifiable, Equatable, Sendable {
  let id, email, role: String
  var invitedBy = ""

  private enum CodingKeys: String, CodingKey { case id, email, role, invitedBy }
  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    email = try container.decode(String.self, forKey: .email)
    role = try container.decodeIfPresent(String.self, forKey: .role) ?? "agent"
    invitedBy = try container.decodeIfPresent(String.self, forKey: .invitedBy) ?? ""
  }
}

/// Invite by email (`POST /v1/admin/invitations`): works everywhere, and is the only
/// way on the hosted edition. The link is returned either way, so it can be sent by hand.
struct TeamInviteSheet: View {
  var onInvited: () async -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var email = ""
  @State private var role = TeamRole.agent
  @State private var saving = false
  @State private var error = ""
  @State private var sent: Sent?

  private struct Sent { let url: String; let emailed: Bool }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if let sent {
            Label(sent.emailed ? "Invitation sent." : "Send this link to them:", systemImage: "checkmark.circle").font(.lnRow).foregroundStyle(Theme.textHighlighted)
            Text(sent.url).font(.lnMono).foregroundStyle(Theme.textHighlighted).textSelection(.enabled)
              .padding(12).frame(maxWidth: .infinity, alignment: .leading)
              .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
              .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
            HStack(spacing: 8) {
              Button { Clipboard.copy(sent.url) } label: { Label("Copy link", systemImage: "doc.on.doc") }.buttonStyle(.lnPrimaryCompact)
              if let url = URL(string: sent.url) { ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }.buttonStyle(.lnSecondaryCompact) }
            }
          } else {
            Text("They get a link that works for 7 days. Without email sending set up, copy the link and send it yourself.").font(.lnMeta).foregroundStyle(Theme.textMuted)
            LabeledField(label: "Email") {
              TextField("", text: $email).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            LabeledField(label: "Role") { MenuPicker(selection: $role, options: TeamRole.allCases.filter { session.teamRole.canGrant($0) }.map { PickerOption(value: $0, label: $0.label) }, title: "Role") }
            ErrorText(message: error)
          }
        }
        .padding(20)
      }
      .panelScreen(sent == nil ? "Invite a teammate" : "Invitation")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(sent == nil ? "Cancel" : "Done") { dismiss() } }
        if sent == nil {
          ToolbarItem(placement: .confirmationAction) {
            if saving { ProgressView() } else {
              Button("Send invitation") { Task { await invite() } }.disabled(!email.contains("@") || email.trimmingCharacters(in: .whitespaces).count < 3)
            }
          }
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func invite() async {
    struct Input: Encodable, Sendable { let email, role: String }
    struct Output: Decodable, Sendable { let url: String; let emailed: Bool }
    saving = true; error = ""
    defer { saving = false }
    do {
      let output: Output = try await session.send("/v1/admin/invitations", body: Input(email: email.trimmingCharacters(in: .whitespaces), role: role.rawValue))
      sent = Sent(url: output.url, emailed: output.emailed)
      await onInvited()
    } catch { self.error = error.localizedDescription }
  }
}
