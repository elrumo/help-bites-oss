import Foundation

/// Languages for the content HelpBites serves to end users (onboarding, legal pages,
/// emails): shared/locales.ts and the limits of shared/translate.ts, shared/onboarding.ts
/// and server/utils/emails.ts, ported by hand (tests/translateNativeParity.test.ts).
/// Not the panel's own languages.
enum ContentLocale {
  /// `COMMON_LOCALES`: offered by the pickers; any well-formed tag is accepted.
  static let common = ["en", "es", "ca", "fr", "de", "it", "pt", "pt-BR", "nl", "pl", "sv", "tr", "ru", "ar", "hi", "ja", "ko", "zh", "zh-TW"]
  static let defaultTag = "en"
  /// `TRANSLATE_LIMITS.locales`: languages one translate request may ask for.
  static let translateRequest = 8
  /// `ONBOARDING_MAX_LOCALES`: translations one flow keeps.
  static let onboardingTranslations = 20
  /// `EMAIL_MAX_TRANSLATIONS`: translations one email template keeps.
  static let emailTranslations = 20

  /// "pt_br" → "pt-BR", "ZH-hant" → "zh-Hant"; nil when it is not a language tag.
  static func normalize(_ value: String) -> String? {
    let raw = value.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "_", with: "-")
    guard !raw.isEmpty, raw.utf16.count <= 20, raw.wholeMatch(of: #/[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}/#.ignoresCase()) != nil else { return nil }
    let parts = raw.split(separator: "-", omittingEmptySubsequences: false).map(String.init)
    let rest = parts.dropFirst().map { part -> String in
      switch part.count {
      case 2: part.uppercased()
      case 4: part.prefix(1).uppercased() + part.dropFirst().lowercased()
      default: part.lowercased()
      }
    }
    return ([parts[0].lowercased()] + rest).joined(separator: "-")
  }

  /// The language's name in the app's language ("Spanish"); the tag when Foundation does not know it.
  static func name(_ tag: String) -> String {
    guard let name = Locale.current.localizedString(forIdentifier: tag), !name.isEmpty, name != tag else { return tag }
    return name.prefix(1).uppercased() + name.dropFirst()
  }

  /// "Spanish (es)": what pickers and rows show.
  static func label(_ tag: String) -> String {
    let name = name(tag)
    return name == tag ? tag : "\(name) (\(tag))"
  }

  static func same(_ a: String, _ b: String) -> Bool { a.caseInsensitiveCompare(b) == .orderedSame }

  /// The tags worth offering: the common ones, then any others in `extra`, without `excluded`.
  static func choices(excluding excluded: [String] = [], including extra: [String] = []) -> [String] {
    var out: [String] = []
    for tag in common + extra where !out.contains(where: { same($0, tag) }) && !excluded.contains(where: { same($0, tag) }) { out.append(tag) }
    return out
  }
}
