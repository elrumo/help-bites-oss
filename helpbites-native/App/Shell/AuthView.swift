import SwiftUI

/// Sign in, sign-up (HelpBites Cloud), first-run setup and password reset, in Linear's onboarding shape:
/// a mark, a short title, quiet labels and a pill on the right.
struct AuthView: View {
  @Environment(SessionStore.self) private var session
  @Environment(\.openURL) private var openURL
  private enum Mode { case signIn, signUp, forgot, reset }
  @State private var mode = Mode.signIn
  @State private var username = ""
  @State private var password = ""
  @State private var name = ""
  @State private var email = ""
  @State private var endpoint = ""
  @State private var showServer = false
  @State private var working = false
  @State private var notice = ""
  @State private var error = ""
  /// The emailed reset link (or just its token), pasted or opened into the app.
  @State private var resetLink = ""

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        Image(systemName: "bubble.left.and.text.bubble.right.fill")
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(.white)
          .frame(width: 34, height: 34)
          .background(Theme.accent, in: RoundedRectangle(cornerRadius: 9))
          .padding(.bottom, 36)

        Text(title).font(.lnTitle).foregroundStyle(Theme.textHighlighted)
        Text(subtitle).font(.lnBody).foregroundStyle(Theme.textMuted).padding(.top, 4).padding(.bottom, 28)

        VStack(alignment: .leading, spacing: 16) { fields }

        if !notice.isEmpty { Label(notice, systemImage: "checkmark.circle").font(.lnMeta).foregroundStyle(Theme.success).padding(.top, 16) }
        ErrorText(message: error.isEmpty ? session.error : error).padding(.top, 16)
        // The cloud may ask for a human check the app can't show: the web sign-up page can.
        if mode == .signUp && !(error.isEmpty && session.error.isEmpty), let url = URL(string: session.endpoint + "/signup") {
          Button("Sign up on the web") { openURL(url) }.buttonStyle(.lnGhost).padding(.top, 8)
        }

        HStack(spacing: 8) {
          Spacer(minLength: 0)
          if !session.needsSetup {
            if mode == .forgot {
              Button("I have a link") { mode = .reset; notice = ""; error = "" }.buttonStyle(.lnGhost)
            }
            if mode == .signIn {
              if session.signupOpen {
                Button("Create account") { mode = .signUp; notice = ""; error = ""; session.error = "" }.buttonStyle(.lnGhost)
              }
              Button("Forgot password?") { mode = .forgot; notice = ""; error = "" }.buttonStyle(.lnGhost)
            } else {
              Button("Back to sign in") { mode = .signIn; notice = ""; error = ""; session.error = "" }.buttonStyle(.lnGhost)
            }
          }
          Button(action: submit) {
            HStack(spacing: 6) {
              if working { ProgressView().tint(.white).controlSize(.small) }
              Text(primaryLabel)
            }
          }
          .buttonStyle(.lnPrimary)
          .disabled(!canSubmit || working)
        }
        .padding(.top, 24)

        serverSection.padding(.top, 48)
      }
      .frame(maxWidth: 380, alignment: .leading)
      .padding(.horizontal, 28)
      .padding(.vertical, 64)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .background(Theme.panel.ignoresSafeArea())
    .onAppear { endpoint = session.endpoint; takeResetLink() }
    .onChange(of: session.pendingResetLink) { _, _ in takeResetLink() }
    // Another server may not take sign-ups.
    .onChange(of: session.signupOpen) { _, open in if !open && mode == .signUp { mode = .signIn } }
  }

  /// A reset link opened into the app (web: /login?reset=…) lands on the reset form.
  private func takeResetLink() {
    guard !session.pendingResetLink.isEmpty else { return }
    resetLink = session.pendingResetLink
    session.pendingResetLink = ""
    mode = .reset; notice = ""; error = ""
  }

  /// The token from a pasted link's `?reset=`, or the pasted text itself.
  private var resetToken: String {
    let text = resetLink.trimmingCharacters(in: .whitespacesAndNewlines)
    return URLComponents(string: text)?.queryItems?.first { $0.name == "reset" }?.value ?? text
  }

  @ViewBuilder private var fields: some View {
    if session.needsSetup {
      LabeledField(label: "Name") { TextField("", text: $name).textFieldStyle(.linear).textContentType(.name) }
      LabeledField(label: "Email", hint: "For notifications") { TextField("", text: $email).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).textContentType(.emailAddress) }
      LabeledField(label: "Username") { TextField("", text: $username).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.username) }
      LabeledField(label: "Password", hint: "At least 8 characters") { SecureField("", text: $password).textFieldStyle(.linear).textContentType(.newPassword) }
    } else if mode == .signUp {
      LabeledField(label: "Name") { TextField("", text: $name).textFieldStyle(.linear).textContentType(.name) }
      LabeledField(label: "Email") { TextField("", text: $email).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.username) }
      LabeledField(label: "Password", hint: "At least 10 characters") { SecureField("", text: $password).textFieldStyle(.linear).textContentType(.newPassword).onSubmit(submit) }
    } else if mode == .forgot {
      LabeledField(label: "Email") { TextField("", text: $email).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).textContentType(.emailAddress) }
    } else if mode == .reset {
      LabeledField(label: "Reset link", hint: "Paste the link from the email") { TextField("", text: $resetLink).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled() }
      LabeledField(label: "New password", hint: "At least 8 characters") { SecureField("", text: $password).textFieldStyle(.linear).textContentType(.newPassword).onSubmit(submit) }
    } else {
      LabeledField(label: "Username") { TextField("", text: $username).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.username) }
      LabeledField(label: "Password") { SecureField("", text: $password).textFieldStyle(.linear).textContentType(.password).onSubmit(submit) }
    }
  }

  private var serverSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      Button {
        withAnimation(.snappy) { showServer.toggle() }
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "server.rack").font(.system(size: 11))
          Text(session.endpoint).lineLimit(1)
          Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).rotationEffect(.degrees(showServer ? 0 : -90))
        }
        .font(.lnCaption)
        .foregroundStyle(Theme.textMuted)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Server: \(session.endpoint)")

      if showServer {
        HStack(spacing: 8) {
          TextField("https://support.example.com", text: $endpoint).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          Button("Use") { Task { await session.setEndpoint(endpoint) } }
            .buttonStyle(.lnSecondaryCompact)
            .disabled(endpoint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || endpoint == session.endpoint)
        }
        .transition(.opacity)
      }
    }
  }

  private var title: String {
    session.needsSetup || mode == .signUp ? String(localized: "Create your account") : mode == .forgot ? String(localized: "Reset your password") : mode == .reset ? String(localized: "Choose a new password") : String(localized: "Sign in to HelpBites")
  }
  private var subtitle: String {
    session.needsSetup ? String(localized: "This is a fresh install. The first account becomes the operator; you can add teammates later.")
      : mode == .signUp ? String(localized: "Your own workspace for support, feedback and planning. We'll email you a link to confirm your address.")
      : mode == .forgot ? String(localized: "Enter your account email and we'll send you a reset link.")
      : mode == .reset ? String(localized: "The link in the email works for 30 minutes.")
      : String(localized: "Your support inbox and every app you've connected.")
  }
  private var primaryLabel: String { session.needsSetup || mode == .signUp ? String(localized: "Create account") : mode == .forgot ? String(localized: "Send reset link") : mode == .reset ? String(localized: "Set password") : String(localized: "Sign in") }
  private var canSubmit: Bool {
    if mode == .signUp && !session.needsSetup { return !name.trimmingCharacters(in: .whitespaces).isEmpty && email.contains("@") && password.count >= 10 }
    if mode == .forgot && !session.needsSetup { return email.contains("@") }
    if mode == .reset && !session.needsSetup { return !resetToken.isEmpty && password.count >= 8 }
    return !username.trimmingCharacters(in: .whitespaces).isEmpty && password.count >= (session.needsSetup ? 8 : 1)
  }

  private func submit() {
    guard canSubmit, !working else { return }
    working = true; error = ""; notice = ""
    Task {
      defer { working = false }
      if session.needsSetup {
        await session.setup(username: username.trimmingCharacters(in: .whitespaces), password: password, name: name, email: email)
      } else if mode == .signUp {
        await session.signUp(name: name.trimmingCharacters(in: .whitespaces), email: email.trimmingCharacters(in: .whitespaces), password: password)
      } else if mode == .forgot {
        struct Input: Encodable, Sendable { let email: String }
        struct Output: Decodable, Sendable {}
        do {
          let _: Output = try await session.api.send("/v1/admin/forgot-password", method: "POST", body: Input(email: email.trimmingCharacters(in: .whitespaces)))
          notice = String(localized: "If that email has an account, a reset link is on its way.")
        } catch { self.error = error.localizedDescription }
      } else if mode == .reset {
        struct Input: Encodable, Sendable { let token, password: String }
        struct Output: Decodable, Sendable {}
        do {
          let _: Output = try await session.api.send("/v1/admin/reset-password", method: "POST", body: Input(token: resetToken, password: password))
          password = ""; resetLink = ""
          mode = .signIn
          notice = String(localized: "Password updated. Sign in with your new password.")
        } catch { self.error = error.localizedDescription }
      } else {
        await session.login(username: username.trimmingCharacters(in: .whitespaces), password: password)
      }
    }
  }
}
