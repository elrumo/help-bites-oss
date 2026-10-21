import Foundation

// The shapes of /v1/admin/onboarding/** (shared/onboarding.ts, server/utils/onboarding.ts).

/// `ONBOARDING_LIMITS`, `ONBOARDING_KEY`, `ONBOARDING_FONTS` and `ONBOARDING_PROGRESS`
/// from shared/onboarding.ts, ported by hand (tests/onboardingNativeParity.test.ts).
enum OnboardingLimits {
  static let flows = 50
  static let steps = 12
  static let name = 80
  static let title = 120
  static let body = 600
  static let label = 40
  static let alt = 200
  static let radius = 32
  /// A flow's key: lowercase letters, digits and dashes.
  static let key = "^[a-z0-9][a-z0-9-]{0,39}$"
  static let fonts: [(id: String, label: String)] = [("system", "System"), ("rounded", "Rounded"), ("serif", "Serif"), ("mono", "Mono")]
  static let progress: [(id: String, label: String)] = [("bar", "Bar"), ("dots", "Dots"), ("none", "None")]

  static func validKey(_ value: String) -> Bool { value.range(of: key, options: .regularExpression) != nil }
  static let keyRule = "The key is 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit."
}

struct OnboardingStep: Codable, Identifiable, Equatable, Sendable {
  var id: String
  var title = ""
  var body = ""
  /// '' for a step without a picture.
  var imageUrl = ""
  var imageAlt = ""
  /// '' uses the client's own: Continue, and Get started on the last step.
  var buttonLabel = ""

  /// A fresh step with an id the server keeps (`/^[\w-]{1,40}$/`).
  static func blank() -> OnboardingStep {
    OnboardingStep(id: "st_" + UUID().uuidString.prefix(13).lowercased())
  }
}

struct OnboardingStyle: Codable, Equatable, Sendable {
  /// '#rrggbb', or '' for the project's accent.
  var accent: String
  /// '' follows the client's light or dark theme.
  var background: String
  var text: String
  var radius: Int
  /// system, rounded, serif or mono.
  var font: String
}

struct OnboardingOptions: Codable, Equatable, Sendable {
  var skippable: Bool
  /// bar, dots or none.
  var progress: String
}

/// What apps receive (`PublicOnboardingFlow`), and the offline copy's content.
struct OnboardingPublicFlow: Codable, Equatable, Sendable {
  struct Project: Codable, Equatable, Sendable { let name, logoUrl: String }
  let key, name: String
  let version: Int
  let publishedAt: String?
  let project: Project
  let style: OnboardingStyle
  let options: OnboardingOptions
  let steps: [OnboardingStep]
}

struct OnboardingFlow: Codable, Identifiable, Equatable, Sendable {
  let id: String
  var key: String
  var name: String
  /// draft or published.
  var status: String
  var version: Int
  var steps: [OnboardingStep]
  var style: OnboardingStyle
  var options: OnboardingOptions
  /// The working copy differs from what apps get.
  var changed: Bool
  var published: OnboardingPublicFlow?
  var publishedAt: String?
  /// `/v1/onboarding/<pk>/<key>`.
  var path: String
  var updatedAt: String?

  var isPublished: Bool { status == "published" }
}

/// The parts of a flow the editor changes; equal to the saved copy means nothing to save.
struct OnboardingDraft: Equatable, Encodable, Sendable {
  var name: String
  var key: String
  var steps: [OnboardingStep]
  var style: OnboardingStyle
  var options: OnboardingOptions

  init(_ flow: OnboardingFlow) {
    name = flow.name
    key = flow.key
    steps = flow.steps
    style = flow.style
    options = flow.options
  }
}

struct OnboardingFlowResponse: Decodable, Sendable { let flow: OnboardingFlow }

extension OnboardingFlow {
  /// The flow's state in a list or a header: Draft, or the version apps get.
  var statusLabel: String { isPublished ? "Published v\(version)" : "Draft" }
}

extension String {
  /// At most `limit` UTF-16 units (JavaScript's `length`, which the server counts), cut on a character boundary.
  func clipped(to limit: Int) -> String {
    var out = self
    while out.utf16.count > limit { out.removeLast() }
    return out
  }
}
