import SwiftUI

@main struct HelpBitesNativeApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @State private var session = SessionStore()
  var body: some Scene {
    WindowGroup { RootView(session: session).task { await session.bootstrap() } }
      .commands { AppCommands() }
  }
}
