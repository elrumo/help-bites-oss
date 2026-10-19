import SwiftUI

struct RootView: View {
  @Bindable var session: SessionStore
  @AppStorage("hb-theme") private var theme: ThemePreference = .system
  @State private var pendingInvite: InviteToken?

  var body: some View {
    Group {
      switch session.phase {
      case .loading:
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.panel)
      case .signedOut:
        AuthView()
      case .signedIn:
        AppShell(session: session).id(session.generation)
      }
    }
    .environment(session)
    .tint(Theme.accent)
    .preferredColorScheme(theme.scheme)
    .alert("HelpBites", isPresented: .init(get: { !session.error.isEmpty }, set: { if !$0 { session.error = "" } })) {
      Button("OK", role: .cancel) {}
    } message: { Text(session.error) }
    .sheet(item: $pendingInvite) { AcceptInvitationSheet(token: $0.value).environment(session) }
    .onChange(of: PushRegistration.shared.token) { _, _ in Task { await session.registerPushDevice() } }
    // An emailed reset link (…/login?reset=…) handed to the app; the sign-in screen opens it.
    .onOpenURL { url in
      if InviteLink.isInvite(url), let token = InviteLink.token(from: url.absoluteString) { pendingInvite = InviteToken(value: token); return }
      guard URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "reset" }) == true else { return }
      session.pendingResetLink = url.absoluteString
    }
  }
}

/// An invitation token opened from a link, to present its sheet.
struct InviteToken: Identifiable { let value: String; var id: String { value } }
