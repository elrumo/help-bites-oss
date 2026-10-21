import Foundation

// The shapes of /v1/admin/brand/** (shared/brand.ts, server/utils/brand.ts).

/// The lists and limits of shared/brand.ts, ported by hand (tests/brandNativeParity.test.ts).
enum BrandOptions {
  static let templates: [(id: String, label: String, description: String)] = [
    ("minimal", "Minimal", "Your logo on its colour, then everything else in a quiet grid."),
    ("editorial", "Editorial", "A centred, type-led page for kits with a lot to say."),
    ("split", "Split", "A panel in your colour beside the content, like a brand book.")
  ]
  static let themes: [(id: String, label: String)] = [("auto", "Auto"), ("light", "Light"), ("dark", "Dark")]
  static let radii: [(id: String, label: String)] = [("sharp", "Sharp"), ("soft", "Soft"), ("round", "Round")]
  /// `BRAND_SECTIONS` with `BRAND_SECTION_LABELS`, in the default order.
  static let sections: [(id: String, label: String)] = [
    ("colors", "Colours"), ("typography", "Typography"), ("logos", "Logos and icons"),
    ("screenshots", "Screenshots"), ("assets", "Other files"), ("guidelines", "Guidelines")
  ]
  /// `BRAND_ASSET_KINDS` with `BRAND_ASSET_KIND_LABELS`.
  static let assetKinds: [(id: String, label: String)] = [
    ("logo", "Logo"), ("icon", "App icon"), ("favicon", "Favicon"),
    ("screenshot", "Screenshot"), ("social", "Social image"), ("other", "Other")
  ]
  /// What a logo is drawn to sit on.
  static let backgrounds: [(id: String, label: String)] = [("light", "Light"), ("dark", "Dark"), ("any", "Any")]
  static let fontRoles: [(id: String, label: String)] = [("display", "Display"), ("body", "Body"), ("mono", "Mono"), ("other", "Other")]

  static func kindLabel(_ id: String) -> String { assetKinds.first { $0.id == id }?.label ?? id }
}

/// `BRAND_LIMITS` for the lists the editor grows.
enum BrandLimits {
  static let colors = 24
  static let fonts = 6
  static let guidelines = 20
}

struct BrandColor: Codable, Equatable, Sendable {
  var name = ""
  var hex = "#18181b"
  var usage = ""
}

struct BrandFont: Codable, Equatable, Sendable {
  var name = ""
  /// display, body, mono or other.
  var role = "body"
  /// A https://fonts.googleapis.com/css2 stylesheet, or ''.
  var cssUrl = ""
  var downloadUrl = ""
  var weights = ""
  var sample = ""
}

struct BrandGuideline: Codable, Identifiable, Equatable, Sendable {
  var id: String
  var title = ""
  /// Markdown.
  var body = ""

  /// A fresh guideline with an id the server keeps (`/^[\w-]{1,40}$/`).
  static func blank() -> BrandGuideline { BrandGuideline(id: "g_" + UUID().uuidString.prefix(13).lowercased()) }
}

struct BrandPage: Codable, Equatable, Sendable {
  /// Off: the page and GET /v1/brand/{pk} answer 404.
  var `public`: Bool
  var template: String
  var theme: String
  var radius: String
  /// '#rrggbb', or '' for the first colour, then the project's accent.
  var accent: String
  var headline: String
  var intro: String
  /// The sections shown, in order.
  var sections: [String]
}

struct BrandConfig: Codable, Equatable, Sendable {
  var tagline: String
  var about: String
  var colors: [BrandColor]
  var fonts: [BrandFont]
  var guidelines: [BrandGuideline]
  var page: BrandPage
}

struct BrandAsset: Codable, Identifiable, Equatable, Sendable {
  let id: String
  var kind: String
  var name: String
  var description: String
  let url: String
  /// Relative to the server: `/brand/<pk>/files/<id>`.
  let downloadUrl: String
  let mime: String
  let size: Int
  let width: Int?
  let height: Int?
  /// light, dark or any.
  var background: String
  var `public`: Bool
  var order: Int
  let createdAt: String?

  var isImage: Bool { mime.hasPrefix("image/") }
  /// "PDF", "SVG", "ICO", "PNG"…
  var typeLabel: String {
    switch mime {
    case "image/svg+xml": "SVG"
    case "image/x-icon": "ICO"
    case "application/pdf": "PDF"
    default: mime.split(separator: "/").last.map { $0.uppercased() } ?? "File"
    }
  }
  /// "240 KB · 512×512".
  var detail: String {
    let bytes = Int64(size).formatted(.byteCount(style: .file))
    guard let width, let height else { return bytes }
    return "\(bytes) · \(width)×\(height)"
  }
}

struct BrandAssetResponse: Decodable, Sendable { let asset: BrandAsset }
