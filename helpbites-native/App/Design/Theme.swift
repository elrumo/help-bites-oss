import SwiftUI
import UIKit

// Linear's look, the same tokens as the web panel (main.css `:root.admin`):
// cool greys, one indigo accent, 13pt metadata. Every colour flips with the
// system appearance, or with the theme picked in Account.

extension UIColor {
  convenience init(hex: UInt32, alpha: CGFloat = 1) {
    self.init(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
  }
}

extension Color {
  init(light: UInt32, dark: UInt32) {
    self = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
  }

  /// A colour as stored on the server: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`
  /// (a project's accent, an email's colours) or `transparent`; nil when unparsable.
  init?(hexString: String?) {
    guard var raw = hexString?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
    if raw.lowercased() == "transparent" { self = .clear; return }
    if raw.hasPrefix("#") { raw.removeFirst() }
    if raw.count == 3 || raw.count == 4 { raw = raw.map { "\($0)\($0)" }.joined() }
    guard raw.count == 6 || raw.count == 8, raw.allSatisfy(\.isHexDigit), let value = UInt32(raw, radix: 16) else { return nil }
    self = raw.count == 8 ? Color(UIColor(hex: value >> 8, alpha: CGFloat(value & 0xff) / 255)) : Color(UIColor(hex: value))
  }

  /// The colour as `#rrggbb`, for fields stored as hex.
  var hexString: String {
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    UIColor(self).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    let byte = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", byte(red), byte(green), byte(blue))
  }
}

enum Theme {
  // Surfaces: the canvas the sidebar sits on, the raised panel, hover and selection.
  static let canvas = Color(light: 0xf4f4f5, dark: 0x08090a)
  static let panel = Color(light: 0xfcfcfc, dark: 0x0f1011)
  static let elevated = Color(light: 0xf3f3f5, dark: 0x17181a)
  static let accented = Color(light: 0xebebee, dark: 0x202124)
  static let field = Color(light: 0xffffff, dark: 0x131416)

  static let border = Color(light: 0xe6e6e9, dark: 0x222327)
  static let borderMuted = Color(light: 0xeeeef0, dark: 0x1a1b1e)
  static let borderAccented = Color(light: 0xd6d7dc, dark: 0x2e2f34)

  static let textHighlighted = Color(light: 0x161719, dark: 0xf7f8f8)
  static let text = Color(light: 0x2b2d31, dark: 0xdcdfe4)
  static let textToned = Color(light: 0x50545c, dark: 0xb8bdc6)
  static let textMuted = Color(light: 0x6b6f78, dark: 0x8a8f98)
  static let textDimmed = Color(light: 0x9a9ea6, dark: 0x62666d)

  static let accent = Color(UIColor(hex: 0x5e6ad2))
  static let accentText = Color(light: 0x5e6ad2, dark: 0x8690e0)
  static let success = Color(light: 0x16a34a, dark: 0x4ade80)
  static let warning = Color(light: 0xd97706, dark: 0xfbbf24)
  static let error = Color(light: 0xdc2626, dark: 0xf87171)
  static let info = Color(light: 0x2563eb, dark: 0x60a5fa)
  static let pending = Color(UIColor(hex: 0xe6a91a))
  static let urgent = Color(UIColor(hex: 0xf2753a))

  /// The stable colour a project without an accent gets, as on the web.
  static func projectColor(id: String, accent: String?) -> Color {
    if let color = Color(hexString: accent) { return color }
    let palette: [UInt32] = [0xc2410c, 0x7c3aed, 0x0369a1, 0xb45309, 0xbe123c, 0x4d7c0f, 0x6d28d9, 0x0e7490]
    var hash: UInt32 = 0
    for scalar in id.unicodeScalars { hash = hash &* 31 &+ scalar.value }
    return Color(UIColor(hex: palette[Int(hash % UInt32(palette.count))]))
  }
}

// Type scale: Linear sets UI at 13pt with 12pt metadata; iOS reads better a
// step up, so body copy is 15pt and lists use 14pt titles.
extension Font {
  static let lnTitle = Font.system(size: 20, weight: .semibold)
  static let lnHeading = Font.system(size: 15, weight: .semibold)
  static let lnBody = Font.system(size: 15)
  static let lnRow = Font.system(size: 14, weight: .medium)
  static let lnCallout = Font.system(size: 14)
  static let lnMeta = Font.system(size: 13)
  static let lnMetaMedium = Font.system(size: 13, weight: .medium)
  static let lnCaption = Font.system(size: 12)
  static let lnCaptionMedium = Font.system(size: 12, weight: .medium)
  static let lnMono = Font.system(size: 12, design: .monospaced)
}

enum Metrics {
  static let radiusSmall: CGFloat = 6
  static let radius: CGFloat = 8
  static let radiusLarge: CGFloat = 12
  static let radiusXL: CGFloat = 16
  static let rowHeight: CGFloat = 44
  static let gutter: CGFloat = 16
}

/// The theme picked in Account: follow the system, or pin light or dark.
enum ThemePreference: String, CaseIterable, Identifiable {
  case system, light, dark
  var id: String { rawValue }
  var label: String { rawValue.capitalized }
  var scheme: ColorScheme? { self == .light ? .light : self == .dark ? .dark : nil }
  var systemImage: String { self == .system ? "circle.lefthalf.filled" : self == .light ? "sun.max" : "moon" }
}
