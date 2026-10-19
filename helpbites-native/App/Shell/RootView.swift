import SwiftUI

struct RootView: View {
  @Bindable var session: SessionStore
  @AppStorage("hb-theme") private var theme: ThemePreference = .system

  var body: some View {
    Group {
      switch session.phase {
      case .loading:
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.panel)
      case .signedOut:
        AuthView()
      case .signedIn:
        AppShell(session: session)
      }
    }
    .environment(session)
    .tint(Theme.accent)
    .preferredColorScheme(theme.scheme)
    .alert("HelpBites", isPresented: .init(get: { !session.error.isEmpty }, set: { if !$0 { session.error = "" } })) {
      Button("OK", role: .cancel) {}
    } message: { Text(session.error) }
    .onChange(of: PushRegistration.shared.token) { _, _ in Task { await session.registerPushDevice() } }
    // An emailed reset link (…/login?reset=…) handed to the app; the sign-in screen opens it.
    .onOpenURL { url in
      guard URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "reset" }) == true else { return }
      session.pendingResetLink = url.absoluteString
    }
  }
}
