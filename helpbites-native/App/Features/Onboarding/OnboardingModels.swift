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

/// The words of a step a translation replaces (`OnboardingStepText`); an empty one falls back to the flow's own language.
struct OnboardingStepText: Codable, Equatable, Sendable {
  var title = ""
  var body = ""
  var imageAlt = ""
  var buttonLabel = ""

  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    title = (try c.decodeIfPresent(String.self, forKey: .title)) ?? ""
    body = (try c.decodeIfPresent(String.self, forKey: .body)) ?? ""
    imageAlt = (try c.decodeIfPresent(String.self, forKey: .imageAlt)) ?? ""
    buttonLabel = (try c.decodeIfPresent(String.self, forKey: .buttonLabel)) ?? ""
  }

  /// The step's field of that name, for the editor's loops.
  subscript(field: StepField) -> String {
    get { switch field { case .title: title; case .body: body; case .imageAlt: imageAlt; case .buttonLabel: buttonLabel } }
    set { switch field { case .title: title = newValue; case .body: body = newValue; case .imageAlt: imageAlt = newValue; case .buttonLabel: buttonLabel = newValue } }
  }

  var isEmpty: Bool { StepField.allCases.allSatisfy { self[$0].isEmpty } }
}

/// The translatable fields of a step, in `STEP_TEXT_LIMITS` order, with the limits of `OnboardingLimits`.
enum StepField: String, CaseIterable, Identifiable, Sendable {
  case title, body, imageAlt, buttonLabel
  var id: String { rawValue }
  var label: String { switch self { case .title: "Title"; case .body: "Body"; case .imageAlt: "Image description"; case .buttonLabel: "Button label" } }
  var limit: Int { switch self { case .title: OnboardingLimits.title; case .body: OnboardingLimits.body; case .imageAlt: OnboardingLimits.alt; case .buttonLabel: OnboardingLimits.label } }
  func original(_ step: OnboardingStep) -> String { switch self { case .title: step.title; case .body: step.body; case .imageAlt: step.imageAlt; case .buttonLabel: step.buttonLabel } }
}

/// One language of a flow: its name and, by step id, the words of each step.
struct OnboardingTranslation: Codable, Equatable, Sendable {
  var name = ""
  var steps: [String: OnboardingStepText] = [:]

  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    name = (try c.decodeIfPresent(String.self, forKey: .name)) ?? ""
    steps = (try c.decodeIfPresent([String: OnboardingStepText].self, forKey: .steps)) ?? [:]
  }

  /// `localizeOnboarding`: each translated word replaces the original, anything missing stays in the flow's own language.
  func localized(name original: String, steps originals: [OnboardingStep]) -> (name: String, steps: [OnboardingStep]) {
    (name.isEmpty ? original : name, originals.map { step in
      var out = step
      if let words = steps[step.id] {
        if !words.title.isEmpty { out.title = words.title }
        if !words.body.isEmpty { out.body = words.body }
        if !words.imageAlt.isEmpty { out.imageAlt = words.imageAlt }
        if !words.buttonLabel.isEmpty { out.buttonLabel = words.buttonLabel }
      }
      return out
    })
  }

  /// How many of the flow's strings (`onboardingTexts`: the non-empty name and step fields) this language has, and how many there are.
  func progress(name original: String, steps originals: [OnboardingStep]) -> (filled: Int, total: Int) {
    var filled = 0, total = 0
    if !original.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { total += 1; if !name.isEmpty { filled += 1 } }
    for step in originals {
      for field in StepField.allCases where !field.original(step).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        total += 1
        if !(steps[step.id]?[field] ?? "").isEmpty { filled += 1 }
      }
    }
    return (filled, total)
  }
}

/// What apps receive (`PublicOnboardingFlow`), and the offline copy's content.
struct OnboardingPublicFlow: Codable, Equatable, Sendable {
  struct Project: Codable, Equatable, Sendable { let name, logoUrl: String }
  let key, name: String
  /// The language of this copy, and every language the flow has (its own first).
  let locale: String?
  let locales: [String]?
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
  /// The language the steps are written in.
  var locale: String
  var translations: [String: OnboardingTranslation]
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
  var locale: String
  var translations: [String: OnboardingTranslation]
  /// The languages the saved flow has: one the draft dropped is sent as null, since a PATCH only replaces the languages it names.
  private let savedLanguages: [String]

  init(_ flow: OnboardingFlow) {
    name = flow.name
    key = flow.key
    steps = flow.steps
    style = flow.style
    options = flow.options
    locale = flow.locale
    translations = flow.translations
    savedLanguages = flow.translations.keys.sorted()
  }

  enum CodingKeys: String, CodingKey { case name, key, steps, style, options, locale, translations }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(name, forKey: .name)
    try c.encode(key, forKey: .key)
    try c.encode(steps, forKey: .steps)
    try c.encode(style, forKey: .style)
    try c.encode(options, forKey: .options)
    try c.encode(locale, forKey: .locale)
    // The flow's own language cannot also be a translation.
    var next: [String: OnboardingTranslation?] = translations.filter { !ContentLocale.same($0.key, locale) }
    for tag in savedLanguages where next[tag] == nil { next[tag] = .some(nil) }
    try c.encode(next, forKey: .translations)
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
