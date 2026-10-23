import SwiftUI

// shared/projectStyle.ts as the admin API carries it (`style` on the project,
// `changelog.style`, `look.kit`), plus the pure rules the editor applies:
// validation of a colour, `overlay` (overlayStyle) and `resolve` (resolveStyle).
// Hand-ported; tests/projectStyleNativeParity.test.ts keeps the lists in step.

/// The lists and defaults of shared/projectStyle.ts.
enum ProjectStyleOptions {
  static let schemes: [(id: String, label: String)] = [("auto", String(localized: "Follow the visitor")), ("light", String(localized: "Always light")), ("dark", String(localized: "Always dark"))]
  static let shadows: [(id: String, label: String)] = [("none", String(localized: "None")), ("soft", String(localized: "Soft")), ("medium", String(localized: "Medium")), ("strong", String(localized: "Strong"))]
  static let fonts: [(id: String, label: String)] = [("system", String(localized: "System")), ("serif", String(localized: "Serif")), ("mono", String(localized: "Monospace"))]
  static let radiusMax = 32

  /// DEFAULT_PALETTES: what a colour falls back to when no layer sets it (the accent falls back to the project's).
  static let defaultLight = StylePalette(accent: "", background: "#ffffff", surface: "#fafaf9", text: "#1c1917", muted: "#78716c", border: "#e7e5e4")
  static let defaultDark = StylePalette(accent: "", background: "#0c0a09", surface: "#1c1917", text: "#f5f5f4", muted: "#a8a29e", border: "#292524")

  /// STYLE_SHADOW_CSS as SwiftUI shadows: offset, blur and black opacity per layer (CSS blur is twice SwiftUI's radius).
  static let shadowLayers: [String: [(y: CGFloat, blur: CGFloat, opacity: Double)]] = [
    "none": [],
    "soft": [(1, 2, 0.06), (1, 3, 0.08)],
    "medium": [(4, 12, 0.1)],
    "strong": [(12, 32, 0.18)]
  ]

  /// `#rrggbb` only, as the server accepts it.
  static func isHex(_ value: String) -> Bool { value.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil }
}

enum StylePaletteKey: String, CaseIterable, Identifiable, Sendable {
  case accent, background, surface, text, muted, border
  var id: String { rawValue }
  var label: String {
    switch self {
    case .accent: String(localized: "Accent")
    case .background: String(localized: "Background")
    case .surface: String(localized: "Card")
    case .text: String(localized: "Text")
    case .muted: String(localized: "Secondary text")
    case .border: String(localized: "Border")
    }
  }
}

/// One scheme's colours, each `#rrggbb` or "" for "inherit".
struct StylePalette: Codable, Equatable, Sendable {
  var accent = "", background = "", surface = "", text = "", muted = "", border = ""

  init(accent: String = "", background: String = "", surface: String = "", text: String = "", muted: String = "", border: String = "") {
    self.accent = accent; self.background = background; self.surface = surface; self.text = text; self.muted = muted; self.border = border
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    accent = try c.decodeIfPresent(String.self, forKey: .accent) ?? ""
    background = try c.decodeIfPresent(String.self, forKey: .background) ?? ""
    surface = try c.decodeIfPresent(String.self, forKey: .surface) ?? ""
    text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
    muted = try c.decodeIfPresent(String.self, forKey: .muted) ?? ""
    border = try c.decodeIfPresent(String.self, forKey: .border) ?? ""
  }

  subscript(key: StylePaletteKey) -> String {
    get {
      switch key {
      case .accent: accent
      case .background: background
      case .surface: surface
      case .text: text
      case .muted: muted
      case .border: border
      }
    }
    set {
      switch key {
      case .accent: accent = newValue
      case .background: background = newValue
      case .surface: surface = newValue
      case .text: text = newValue
      case .muted: muted = newValue
      case .border: border = newValue
      }
    }
  }
}

/// `ProjectStyle`: every field optional; "" (nil for the radius) means "take it from the layer below".
struct ProjectStyle: Codable, Equatable, Sendable {
  /// auto | light | dark, or "" to follow the visitor.
  var scheme = ""
  var light = StylePalette(), dark = StylePalette()
  /// CSS pixels, 0 to 32; nil inherits.
  var radius: Int?
  /// none | soft | medium | strong, or "".
  var shadow = ""
  /// system | serif | mono, or "" for the Brand kit's body font.
  var font = ""
  var logoUrl = "", logoDarkUrl = "", iconUrl = ""

  init() {}

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    scheme = try c.decodeIfPresent(String.self, forKey: .scheme) ?? ""
    light = try c.decodeIfPresent(StylePalette.self, forKey: .light) ?? StylePalette()
    dark = try c.decodeIfPresent(StylePalette.self, forKey: .dark) ?? StylePalette()
    radius = try c.decodeIfPresent(Int.self, forKey: .radius)
    shadow = try c.decodeIfPresent(String.self, forKey: .shadow) ?? ""
    font = try c.decodeIfPresent(String.self, forKey: .font) ?? ""
    logoUrl = try c.decodeIfPresent(String.self, forKey: .logoUrl) ?? ""
    logoDarkUrl = try c.decodeIfPresent(String.self, forKey: .logoDarkUrl) ?? ""
    iconUrl = try c.decodeIfPresent(String.self, forKey: .iconUrl) ?? ""
  }

  /// A cleared radius must travel as null, which the default encoder would leave out.
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(scheme, forKey: .scheme)
    try c.encode(light, forKey: .light)
    try c.encode(dark, forKey: .dark)
    try c.encode(radius, forKey: .radius)
    try c.encode(shadow, forKey: .shadow)
    try c.encode(font, forKey: .font)
    try c.encode(logoUrl, forKey: .logoUrl)
    try c.encode(logoDarkUrl, forKey: .logoDarkUrl)
    try c.encode(iconUrl, forKey: .iconUrl)
  }

  private enum CodingKeys: String, CodingKey { case scheme, light, dark, radius, shadow, font, logoUrl, logoDarkUrl, iconUrl }

  /// The style as a request value, for the nested `changelog.style.custom`.
  var json: JSONValue {
    guard let data = try? JSONEncoder().encode(self), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .null }
    return value
  }

  /// Every colour that is set is a valid `#rrggbb`.
  var isValid: Bool {
    StylePaletteKey.allCases.allSatisfy { key in [light[key], dark[key]].allSatisfy { $0.isEmpty || ProjectStyleOptions.isHex($0) } }
  }

  /// `over` on top of `self`: what `over` leaves empty comes from `self` (overlayStyle).
  func overlaid(by over: ProjectStyle) -> ProjectStyle {
    func palette(_ a: StylePalette, _ b: StylePalette) -> StylePalette {
      var merged = a
      for key in StylePaletteKey.allCases where !b[key].isEmpty { merged[key] = b[key] }
      return merged
    }
    var style = self
    if !over.scheme.isEmpty { style.scheme = over.scheme }
    style.light = palette(light, over.light)
    style.dark = palette(dark, over.dark)
    style.radius = over.radius ?? radius
    if !over.shadow.isEmpty { style.shadow = over.shadow }
    if !over.font.isEmpty { style.font = over.font }
    if !over.logoUrl.isEmpty { style.logoUrl = over.logoUrl }
    if !over.logoDarkUrl.isEmpty { style.logoDarkUrl = over.logoDarkUrl }
    if !over.iconUrl.isEmpty { style.iconUrl = over.iconUrl }
    return style
  }
}

/// `changelog.style`: use the project's style, or lay `custom` over it.
struct ChangelogStyle: Equatable, Sendable {
  var source = "project"
  var custom = ProjectStyle()
}

/// `look.kit` (StyleBase): what the Brand kit alone gives, the bottom layer.
struct StyleBase: Decodable, Equatable, Sendable {
  var accent = "#4f46e5", fontFamily = "", logoUrl = "", logoDarkUrl = "", iconUrl = ""
  var radiusPx = 8

  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    accent = try c.decodeIfPresent(String.self, forKey: .accent) ?? accent
    radiusPx = try c.decodeIfPresent(Int.self, forKey: .radiusPx) ?? radiusPx
    fontFamily = try c.decodeIfPresent(String.self, forKey: .fontFamily) ?? ""
    logoUrl = try c.decodeIfPresent(String.self, forKey: .logoUrl) ?? ""
    logoDarkUrl = try c.decodeIfPresent(String.self, forKey: .logoDarkUrl) ?? ""
    iconUrl = try c.decodeIfPresent(String.self, forKey: .iconUrl) ?? ""
  }
  private enum CodingKeys: String, CodingKey { case accent, radiusPx, fontFamily, logoUrl, logoDarkUrl, iconUrl }
}

/// The part of a project's `look` the style editor needs.
struct StyleLook: Decodable, Sendable { let kit: StyleBase }

/// A style with every gap filled (resolveStyle).
struct ResolvedStyle: Equatable, Sendable {
  var scheme = "auto"
  var radius = 8
  var shadow = "soft"
  var fontDesign = Font.Design.default
  var light = StylePalette(), dark = StylePalette()
  var logoUrl = "", logoDarkUrl = "", iconUrl = ""

  /// Layers laid over the base, first layer lowest (the project's style, then a feature's own).
  static func resolve(_ base: StyleBase, _ layers: [ProjectStyle]) -> ResolvedStyle {
    let style = layers.reduce(ProjectStyle()) { $0.overlaid(by: $1) }
    func full(_ own: StylePalette, _ defaults: StylePalette) -> StylePalette {
      var palette = own
      for key in StylePaletteKey.allCases where own[key].isEmpty { palette[key] = defaults[key] }
      if own.accent.isEmpty { palette.accent = style.light.accent.isEmpty ? base.accent : style.light.accent }
      return palette
    }
    var resolved = ResolvedStyle()
    resolved.scheme = style.scheme.isEmpty ? "auto" : style.scheme
    resolved.radius = style.radius ?? base.radiusPx
    resolved.shadow = style.shadow.isEmpty ? "soft" : style.shadow
    resolved.light = full(style.light, ProjectStyleOptions.defaultLight)
    resolved.dark = full(style.dark, ProjectStyleOptions.defaultDark)
    switch style.font {
    case "serif": resolved.fontDesign = .serif
    case "mono": resolved.fontDesign = .monospaced
    case "system": resolved.fontDesign = .default
    default: resolved.fontDesign = base.fontFamily.hasPrefix("ui-monospace") ? .monospaced : base.fontFamily.hasPrefix("ui-serif") ? .serif : .default
    }
    resolved.logoUrl = style.logoUrl.isEmpty ? base.logoUrl : style.logoUrl
    resolved.logoDarkUrl = !style.logoDarkUrl.isEmpty ? style.logoDarkUrl : !style.logoUrl.isEmpty ? style.logoUrl : base.logoDarkUrl
    resolved.iconUrl = !style.iconUrl.isEmpty ? style.iconUrl : !base.iconUrl.isEmpty ? base.iconUrl : resolved.logoUrl
    return resolved
  }

  /// The checks of this port, run from the preview.
  static func selfCheck() {
    var project = ProjectStyle()
    project.light.accent = "#e11d48"
    var own = ProjectStyle()
    own.dark.background = "#1e1b4b"
    own.shadow = "none"
    let resolved = resolve(StyleBase(), [project, own])
    assert(resolved.dark.accent == "#e11d48")
    assert(resolved.dark.background == "#1e1b4b" && resolved.light.background == "#ffffff")
    assert(resolved.shadow == "none" && resolved.radius == 8)
    assert(project.overlaid(by: own).light.accent == "#e11d48")
  }
}
