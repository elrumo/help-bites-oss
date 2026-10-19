import SwiftUI

/// Pulls the invitation token out of what someone pastes or opens (web: pages/invite/[token].vue).
enum InviteLink {
  /// `https://host/invite/<token>`, `helpbites://invite/<token>` or a bare token; nil when it isn't one.
  static func token(from raw: String) -> String? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    if text.contains("/") || text.contains(":") {
      guard let components = URLComponents(string: text) else { return nil }
      // helpbites://invite/<token> puts "invite" in the host; https links have it in the path.
      var parts = components.path.split(separator: "/").map(String.init)
      if components.host == "invite" { parts.insert("invite", at: 0) }
      guard let index = parts.firstIndex(of: "invite"), index + 1 < parts.count else { return nil }
      return parts[index + 1]
    }
    return text.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" } ? text : nil
  }

  /// Whether an opened URL is an invitation link, for the shell's `onOpenURL`.
  static func isInvite(_ url: URL) -> Bool { token(from: url.absoluteString) != nil && (url.host == "invite" || url.path.contains("/invite/")) }
}

/// Join a workspace you were invited to. Paste the link (or open it: the shell passes `token`);
/// signed in, it joins as you; signed out, it makes the account for the invited address.
struct AcceptInvitationSheet: View {
  var token = ""
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var pasted = ""
  @State private var invite: Preview?
  @State private var looking = false
  @State private var joining = false
  @State private var name = ""
  @State private var password = ""
  @State private var error = ""

  @State private var current = ""

  private struct Preview: Decodable, Sendable {
    struct Workspace: Decodable, Sendable { let name: String }
    let workspace: Workspace
    let email: String
    let role, invitedBy: String?
    let hasAccount: Bool
  }

  private var signedIn: Bool { session.phase == .signedIn }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if let invite {
            VStack(alignment: .leading, spacing: 4) {
              Text("Join \(invite.workspace.name)").font(.lnTitle).foregroundStyle(Theme.textHighlighted)
              Text("\(invite.invitedBy?.isEmpty == false ? invite.invitedBy! : "A teammate") invited \(invite.email) as \(TeamRole(invite.role).label).").font(.lnMeta).foregroundStyle(Theme.textMuted)
            }
            if signedIn {
              Text("You'll join as \(session.agent?.email.isEmpty == false ? session.agent!.email : "yourself"). The invitation is for \(invite.email); sign in with that account if they differ.").font(.lnCaption).foregroundStyle(Theme.textMuted)
            } else if invite.hasAccount {
              Text("\(invite.email) already has an account. Sign in with it, then open this invitation again to join.").font(.lnMeta).foregroundStyle(Theme.textMuted)
            } else {
              LabeledField(label: "Name") { TextField("", text: $name).textFieldStyle(.linear) }
              LabeledField(label: "Password", hint: "At least 8 characters") { SecureField("", text: $password).textFieldStyle(.linear) }
            }
          } else {
            Text("Paste the invitation link you were sent.").font(.lnMeta).foregroundStyle(Theme.textMuted)
            LabeledField(label: "Invitation link") {
              TextField("https://…/invite/…", text: $pasted).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().onSubmit { Task { await look(pasted) } }
            }
          }
          ErrorText(message: error)
        }
        .padding(20)
        .frame(maxWidth: 520, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .panelScreen("Join a workspace")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if looking || joining { ProgressView() }
          else if let invite {
            Button(signedIn ? "Join workspace" : "Create account and join") { Task { await join(invite) } }
              .disabled(!signedIn && (invite.hasAccount || password.count < 8))
          } else {
            Button("Continue") { Task { await look(pasted) } }.disabled(InviteLink.token(from: pasted) == nil)
          }
        }
      }
    }
    .presentationDetents([.medium, .large])
    .task { if !token.isEmpty { await look(token) } }
  }

  private func look(_ raw: String) async {
    guard let value = InviteLink.token(from: raw) else { error = "That doesn't look like an invitation link."; return }
    looking = true; error = ""
    defer { looking = false }
    do {
      invite = try await session.get("/v1/invitations/\(value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value)")
      current = value
    } catch { self.error = error.localizedDescription }
  }

  private func join(_ invite: Preview) async {
    struct Input: Encodable, Sendable { let name, password: String }
    struct Output: Decodable, Sendable { let workspace: WorkspaceSummary }
    joining = true; error = ""
    defer { joining = false }
    let path = "/v1/invitations/\(current.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? current)/accept"
    do {
      if signedIn {
        let output: Output = try await session.send(path, body: Input(name: "", password: ""))
        await session.switchWorkspace(output.workspace.id)
      } else {
        // The account is made for the invited address (its username), then signed in with the same password.
        let _: Output = try await session.api.send(path, method: "POST", token: nil, body: Input(name: name, password: password))
        await session.login(username: invite.email, password: password)
      }
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
