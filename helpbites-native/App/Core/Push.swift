import Foundation
import Observation
@preconcurrency import UserNotifications
import UIKit

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
