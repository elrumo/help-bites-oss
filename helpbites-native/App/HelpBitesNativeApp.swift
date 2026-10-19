import SwiftUI

@main struct HelpBitesNativeApp: App {
  #if os(iOS)
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  #else
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  #endif
  @State private var session = SessionStore()
  var body: some Scene {
    WindowGroup { RootView(session: session).task { await session.bootstrap() } }
      .commands { AppCommands() }
      #if os(macOS)
      .defaultSize(width: 1200, height: 800)
      #endif
  }
}
