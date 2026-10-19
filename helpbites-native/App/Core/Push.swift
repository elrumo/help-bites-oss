import Foundation
import Observation
@preconcurrency import UserNotifications
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

// Push: APNs registration and the tap that opens a conversation. The server
// side lives in server/plugins/apns.ts and /v1/admin/devices.

@MainActor @Observable final class PushRegistration {
  static let shared = PushRegistration()
  var token = ""
  var pendingConversationID = ""
  var environment: String {
    #if DEBUG
    "sandbox"
    #else
    "production"
    #endif
  }
}

#if os(iOS)
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
      if granted { DispatchQueue.main.async { application.registerForRemoteNotifications() } }
    }
    return true
  }
  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    Task { @MainActor in PushRegistration.shared.token = deviceToken.map { String(format: "%02x", $0) }.joined() }
  }
  nonisolated func userNotificationCenter(_: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    if let id = response.notification.request.content.userInfo["conversationId"] as? String { await MainActor.run { PushRegistration.shared.pendingConversationID = id } }
  }
}
#else
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    UNUserNotificationCenter.current().delegate = self
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
      if granted { DispatchQueue.main.async { NSApplication.shared.registerForRemoteNotifications() } }
    }
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
  func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    Task { @MainActor in PushRegistration.shared.token = deviceToken.map { String(format: "%02x", $0) }.joined() }
  }
  func application(_ application: NSApplication, didReceiveRemoteNotification userInfo: [String: Any]) {
    if let id = userInfo["conversationId"] as? String { Task { @MainActor in PushRegistration.shared.pendingConversationID = id } }
  }
  nonisolated func userNotificationCenter(_: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    if let id = response.notification.request.content.userInfo["conversationId"] as? String { await MainActor.run { PushRegistration.shared.pendingConversationID = id } }
  }
}
#endif
