import Network
import Observation

/// Whether the server can be reached: the device has a network, and the last request got an answer. The API client
/// reports every request; the network coming back is the cue to send what waited in the outbox.
@MainActor @Observable final class Connectivity {
  static let shared = Connectivity()

  private(set) var networkUp = true
  private(set) var answered = true
  var offline: Bool { !networkUp || !answered }

  private let monitor = NWPathMonitor()

  private init() {
    monitor.pathUpdateHandler = { path in
      let up = path.status == .satisfied
      Task { @MainActor in Connectivity.shared.setNetwork(up) }
    }
    monitor.start(queue: DispatchQueue(label: "com.helpbites.connectivity"))
  }

  private func setNetwork(_ up: Bool) {
    guard up != networkUp else { return }
    networkUp = up
    // Back on a network: assume the server answers again until a request says otherwise.
    if up { answered = true }
  }

  /// From the API client: true when a request got any HTTP answer, false when it got none.
  nonisolated static func report(answered: Bool) {
    Task { @MainActor in if shared.answered != answered { shared.answered = answered } }
  }
}
