import SwiftUI

// Ports of shared/email/theme.ts, lint.ts and placeholders.ts' key extraction,
// plus how the native canvas draws a text block's inline HTML and a CSS font
// stack. ponytail: hand ports; keep them in step with shared/email (the parity
// test in tests/emailNativeParity.test.ts checks the constants).

// MARK: - theme.ts

/// blocks.ts EmailTheme: the design tokens a theme applies.
struct EmailDesignTheme: Equatable, Sendable {
  var brand, onBrand, background, surface, heading, text, muted, fontFamily: String
  var radius: Double

  /// A stored theme over the defaults (`{ ...DEFAULT_THEME, ...theme }`).
  init(json: JSONValue) {
    let fields = EmailRender.object(json)
    let base = EmailDesignTheme.standard
    let string = { (key: String, fallback: String) in EmailRender.string(fields[key]) ?? fallback }
    brand = string("brand", base.brand)
    onBrand = string("onBrand", base.onBrand)
    background = string("background", base.background)
    surface = string("surface", base.surface)
    heading = string("heading", base.heading)
    text = string("text", base.text)
    muted = string("muted", base.muted)
    fontFamily = string("fontFamily", base.fontFamily)
    radius = EmailRender.number(fields["radius"]) ?? base.radius
  }

  init(brand: String, onBrand: String, background: String, surface: String, heading: String, text: String, muted: String, fontFamily: String, radius: Double) {
    self.brand = brand; self.onBrand = onBrand; self.background = background; self.surface = surface
    self.heading = heading; self.text = text; self.muted = muted; self.fontFamily = fontFamily; self.radius = radius
  }

  var json: JSONValue {
    .object([
      "brand": .string(brand), "onBrand": .string(onBrand), "background": .string(background), "surface": .string(surface),
      "heading": .string(heading), "text": .string(text), "muted": .string(muted), "fontFamily": .string(fontFamily), "radius": .number(radius)
    ])
  }

  /// DEFAULT_THEME.
  static let standard = EmailDesignTheme(brand: "#2563eb", onBrand: "#ffffff", background: "#f4f4f5", surface: "#ffffff", heading: "#18181b", text: "#3f3f46", muted: "#e4e4e7", fontFamily: EmailFontStack.sans, radius: 6)
}

/// FONT_STACKS.
struct EmailFontStack: Identifiable, Sendable {
  let label, value: String
  var id: String { value }

  static let sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
  static let serif = "Georgia, 'Times New Roman', Times, serif"
  static let verdana = "Verdana, Geneva, Tahoma, sans-serif"
  static let trebuchet = "'Trebuchet MS', 'Lucida Grande', Tahoma, sans-serif"
  static let mono = "'Courier New', Courier, monospace"

  static let all = [
    EmailFontStack(label: "System sans", value: sans),
    EmailFontStack(label: "Georgia serif", value: serif),
    EmailFontStack(label: "Verdana humanist", value: verdana),
    EmailFontStack(label: "Trebuchet", value: trebuchet),
    EmailFontStack(label: "Courier mono", value: mono)
  ]

  /// Whether this device has the font family installed.
  static func hasFamily(_ family: String) -> Bool {
    #if os(macOS)
    NSFontManager.shared.availableFontFamilies.contains(family)
    #else
    !UIFont.fontNames(forFamilyName: family).isEmpty
    #endif
  }

  /// The closest system design for the canvas (the Preview shows the real font).
  static func design(_ stack: String) -> Font.Design {
    let lower = stack.lowercased()
    if lower.contains("courier") || lower.contains("monospace") { return .monospaced }
    if lower.hasPrefix("georgia") || lower.contains("times") || lower.hasSuffix("serif") && !lower.hasSuffix("sans-serif") { return .serif }
    return .default
  }
}

/// THEME_PRESETS.
struct EmailThemePreset: Identifiable, Sendable {
  let id, name: String
  let theme: EmailDesignTheme

  static let all: [EmailThemePreset] = [
    EmailThemePreset(id: "classic", name: "Classic", theme: .standard),
    EmailThemePreset(id: "midnight", name: "Midnight", theme: EmailDesignTheme(brand: "#8b5cf6", onBrand: "#ffffff", background: "#0b0b16", surface: "#171728", heading: "#ffffff", text: "#c7c7e1", muted: "#2e2e4a", fontFamily: EmailFontStack.sans, radius: 10)),
    EmailThemePreset(id: "forest", name: "Forest", theme: EmailDesignTheme(brand: "#16a34a", onBrand: "#ffffff", background: "#f0f4ef", surface: "#ffffff", heading: "#14291a", text: "#3c4a3d", muted: "#d8e3d5", fontFamily: EmailFontStack.verdana, radius: 8)),
    EmailThemePreset(id: "sunset", name: "Sunset", theme: EmailDesignTheme(brand: "#ea580c", onBrand: "#ffffff", background: "#fff7ed", surface: "#ffffff", heading: "#431407", text: "#57534e", muted: "#fed7aa", fontFamily: EmailFontStack.sans, radius: 999)),
    EmailThemePreset(id: "ocean", name: "Ocean", theme: EmailDesignTheme(brand: "#0891b2", onBrand: "#ffffff", background: "#ecfeff", surface: "#ffffff", heading: "#164e63", text: "#33475b", muted: "#bae6fd", fontFamily: EmailFontStack.trebuchet, radius: 6)),
    EmailThemePreset(id: "editorial", name: "Editorial", theme: EmailDesignTheme(brand: "#111111", onBrand: "#ffffff", background: "#fafafa", surface: "#ffffff", heading: "#111111", text: "#3d3d3d", muted: "#e5e5e5", fontFamily: EmailFontStack.serif, radius: 0)),
    EmailThemePreset(id: "candy", name: "Candy", theme: EmailDesignTheme(brand: "#db2777", onBrand: "#ffffff", background: "#fdf2f8", surface: "#ffffff", heading: "#831843", text: "#4b5563", muted: "#fbcfe8", fontFamily: EmailFontStack.sans, radius: 14))
  ]
}

extension EmailDesign {
  /// currentTheme(): the last applied theme, else one derived from the settings
  /// and the first button that isn't transparent (that one is a link).
  var currentTheme: EmailDesignTheme {
    if let theme = settings.theme { return theme }
    var button: EmailDesignBlock?
    for block in allBlocks where block.kind == .button {
      if let button, EmailRender.truthy(button.fields["backgroundColor"]) { break }
      if !Self.isTransparent(block) { button = block }
    }
    var theme = EmailDesignTheme.standard
    if let button {
      theme.brand = EmailRender.string(button.fields["backgroundColor"]) ?? theme.brand
      theme.onBrand = EmailRender.string(button.fields["color"]) ?? theme.onBrand
      theme.radius = button.radius ?? theme.radius
    }
    let defaults = EmailDesign(nil).settings
    theme.background = settings.backgroundColor.isEmpty ? defaults.backgroundColor : settings.backgroundColor
    theme.surface = settings.contentBackground.isEmpty ? defaults.contentBackground : settings.contentBackground
    theme.text = settings.textColor.isEmpty ? defaults.textColor : settings.textColor
    theme.heading = settings.textColor.isEmpty ? EmailDesignTheme.standard.heading : settings.textColor
    theme.fontFamily = settings.fontFamily.isEmpty ? EmailDesignTheme.standard.fontFamily : settings.fontFamily
    return theme
  }

  /// applyThemeToDocument(): only colours, font and radius change. Block
  /// backgrounds stay, and so do the blocks on them: whatever sits in a section
  /// or columns with its own background was coloured for that surface.
  /// Transparent buttons are links, not buttons, and stay as they are.
  mutating func applyTheme(_ change: (inout EmailDesignTheme) -> Void) {
    var theme = currentTheme
    change(&theme)
    settings.backgroundColor = theme.background
    settings.contentBackground = theme.surface
    settings.textColor = theme.text
    settings.fontFamily = theme.fontFamily
    settings.theme = theme
    blocks = Self.themed(blocks, theme)
  }

  private static func themed(_ blocks: [EmailDesignBlock], _ theme: EmailDesignTheme) -> [EmailDesignBlock] {
    blocks.map { original in
      var block = original
      switch block.kind {
      case .heading: block.fields["color"] = .string(theme.heading)
      case .text: block.fields["color"] = .string(theme.text)
      case .button where !isTransparent(block):
        block.backgroundColor = theme.brand
        block.fields["color"] = .string(theme.onBrand)
        block.radius = theme.radius
      case .divider: block.fields["color"] = .string(theme.muted)
      default: break
      }
      if block.background == nil, block.kind?.isContainer == true { block.children = block.children.map { themed($0, theme) } }
      return block
    }
  }

  /// A button whose fill is `transparent`: a link, which themes leave alone.
  static func isTransparent(_ button: EmailDesignBlock) -> Bool {
    button.fields["backgroundColor"].map(EmailRender.js)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "transparent"
  }
}

// MARK: - placeholders.ts

extension EmailDesign {
  /// extractTemplateVariables(): every `{{ key }}` / `{{{ key }}}` in the email, sorted.
  var placeholderKeys: [String] {
    var found = Set<String>()
    Self.collectKeys(json, into: &found)
    return found.sorted { $0.localizedCompare($1) == .orderedAscending }
  }

  private static func collectKeys(_ value: JSONValue, into found: inout Set<String>) {
    switch value {
    case .string(let text):
      for match in text.matches(of: EmailRender.placeholderPattern) {
        if let key = match.output.1 ?? match.output.2, !key.isEmpty { found.insert(String(key)) }
      }
    case .array(let items): for item in items { collectKeys(item, into: &found) }
    case .object(let fields): for item in fields.values { collectKeys(item, into: &found) }
    default: break
    }
  }
}

// MARK: - lint.ts

/// One thing that makes an email fail in an inbox. `fix` is phrased for the AI.
struct EmailIssue: Identifiable, Equatable, Sendable {
  enum Level: String, Sendable { case error, warning }
  let level: Level
  let message, fix: String
  var blockId: String?
  var id: String { "\(blockId ?? "email")|\(message)" }
}

enum EmailLint {
  nonisolated(unsafe) private static let placeholderURL = #/dummyimage\.com|placeholder\.com|placehold\.co|picsum\.photos|example\.(com|org)/#.ignoresCase()
  nonisolated(unsafe) private static let strippedTags = #/<\s*(script|form|iframe|object|embed|video)\b/#.ignoresCase()
  nonisolated(unsafe) private static let placeholderLink = #/href\s*=\s*["']?(#|https?:\/\/(www\.)?example\.)/#.ignoresCase()

  /// lintEmail().
  static func issues(_ design: EmailDesign, master: Bool) -> [EmailIssue] {
    var issues: [EmailIssue] = []
    let s = design.settings
    let title = s.title.trimmingCharacters(in: .whitespacesAndNewlines)
    if title.isEmpty || title == "Untitled email" {
      issues.append(EmailIssue(level: .error, message: "No subject line", fix: "Write a specific subject line (settings.title) under 50 characters."))
    } else if title.replacing(#/\{\{[^}]+\}\}/#, with: "xxxxxxxx").count > 70 {
      issues.append(EmailIssue(level: .warning, message: "Subject is long and will be cut off in most inboxes", fix: "Shorten the subject line to under 50 characters."))
    }
    if s.preheader.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      issues.append(EmailIssue(level: .warning, message: "No preheader", fix: "Add a preheader that complements the subject (40–90 characters)."))
    }
    if design.blocks.isEmpty { issues.append(EmailIssue(level: .error, message: "The email is empty", fix: "Design the email.")) }
    // Custom HTML sizes itself; the width only governs blocks HelpBites lays out.
    if s.contentWidth > 640, design.blocks.contains(where: { $0.type != "html" && $0.type != "component" }) {
      issues.append(EmailIssue(level: .warning, message: "Content is \(EmailRender.js(s.contentWidth))px wide; 600px suits every client", fix: "Set settings.contentWidth to 600."))
    }

    // Contrast is measured against what is really behind a block: its own
    // background, else the nearest section's or columns', else the card's.
    func visit(_ blocks: [EmailDesignBlock], behind: String) {
      for b in blocks {
        check(b, behind: behind, settings: s, into: &issues)
        for list in b.children { visit(list, behind: b.background ?? behind) }
      }
    }
    visit(design.blocks, behind: s.contentBackground)

    if master, !design.placeholderKeys.contains(where: { $0.hasPrefix("project.") }) {
      issues.append(EmailIssue(level: .warning, message: "This shared template does not use the project brand", fix: "Use {{project.name}} for the product name, {{project.logoUrl}} as the logo image src and {{project.url}} for links, instead of hardcoded values."))
    }
    return issues
  }

  private static func check(_ b: EmailDesignBlock, behind: String, settings s: EmailDesignSettings, into issues: inout [EmailIssue]) {
    let blockId = b.id
    let background = b.background ?? behind
    switch b.kind {
    case .image:
      if b.src.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        issues.append(EmailIssue(level: .error, message: "Image has no source", fix: "Give image \(blockId) a src or remove it.", blockId: blockId))
      } else if b.src.contains(placeholderURL) {
        issues.append(EmailIssue(level: .warning, message: "Placeholder image", fix: "Image \(blockId) still uses a placeholder URL; tell the user to replace it with their own image.", blockId: blockId))
      }
      if b.alt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        issues.append(EmailIssue(level: .warning, message: "Image has no alt text", fix: "Write descriptive alt text for image \(blockId).", blockId: blockId))
      }
    case .button:
      if b.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        issues.append(EmailIssue(level: .error, message: "Button has no label", fix: "Give button \(blockId) a clear action label.", blockId: blockId))
      }
      if b.href.isEmpty || b.href == "#" || b.href.contains(placeholderURL) {
        issues.append(EmailIssue(level: .warning, message: "\(label(b)) links nowhere real", fix: "Point button \(blockId) at a real URL or a {{variable}} such as {{actionUrl}}.", blockId: blockId))
      }
      if let ratio = contrastRatio(EmailRender.string(b.fields["color"]), b.backgroundColor), ratio < 3 {
        issues.append(EmailIssue(level: .warning, message: "\(label(b)) label is hard to read (\(String(format: "%.1f", ratio)):1)", fix: "Raise the contrast between the label and background of button \(blockId) to at least 4.5:1.", blockId: blockId))
      }
    case .heading, .text:
      let minimum = b.kind == .heading ? 3.0 : 4.5
      if let ratio = contrastRatio(b.color ?? s.textColor, background), ratio < minimum {
        issues.append(EmailIssue(level: .warning, message: "\(label(b)) is hard to read (\(String(format: "%.1f", ratio)):1)", fix: "Raise the contrast of \(blockId) against its background to at least \(EmailRender.js(minimum)):1.", blockId: blockId))
      }
      if b.kind == .text, b.html.contains(placeholderLink) {
        issues.append(EmailIssue(level: .warning, message: "\(label(b)) has a placeholder link", fix: "Replace the placeholder links in \(blockId) with real URLs or {{variables}}.", blockId: blockId))
      }
    case .html:
      if b.html.contains(strippedTags) {
        issues.append(EmailIssue(level: .error, message: "Custom HTML uses tags mail clients strip (script, form, iframe, video)", fix: "Rewrite html block \(blockId) with tables and inline styles only.", blockId: blockId))
      }
    case .section:
      if b.gradientTo != nil, b.background == nil {
        issues.append(EmailIssue(level: .warning, message: "Gradient section has no solid colour for Outlook", fix: "Give section \(blockId) a background colour close to its gradient; Outlook shows that instead.", blockId: blockId))
      }
    case .component:
      if EmailRender.fillComponent(b.fields["html"], fields: b.fields["fields"], values: b.fields["values"]).contains(strippedTags) {
        issues.append(EmailIssue(level: .error, message: "\(label(b)) uses tags mail clients strip (script, form, iframe, video)", fix: "Rebuild component \(blockId) with tables and inline styles only.", blockId: blockId))
      }
      let values = EmailRender.object(b.fields["values"])
      for field in b.componentFields where field.type == .url || field.type == .image {
        guard EmailRender.componentValue(EmailRender.object(field.json), values).contains(placeholderURL) else { continue }
        issues.append(EmailIssue(level: .warning, message: "\(label(b)): “\(field.label)” is a placeholder", fix: "Set the \(field.key) value of component \(blockId) to a real URL or a {{variable}}.", blockId: blockId))
      }
    default:
      break
    }
  }

  private static func label(_ b: EmailDesignBlock) -> String {
    switch b.kind {
    case .heading: "heading “\(b.text.prefix(30))”"
    case .text: "text “\(b.html.replacing(#/<[^>]+>/#, with: "").prefix(30))”"
    case .button: "button “\(b.label)”"
    case .component: "component “\(b.name)”"
    default: "\(b.type) block"
    }
  }

  /// WCAG contrast ratio, or nil when either colour is not a plain hex.
  static func contrastRatio(_ a: String?, _ b: String?) -> Double? {
    guard let ca = rgb(a), let cb = rgb(b) else { return nil }
    let luminance = { (c: [Double]) -> Double in
      let l = c.map { v -> Double in
        let s = v / 255
        return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]
    }
    let (la, lb) = (luminance(ca), luminance(cb))
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
  }

  private static func rgb(_ color: String?) -> [Double]? {
    let text = (color ?? "").trimmingCharacters(in: .whitespaces)
    guard let match = text.wholeMatch(of: #/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})/#) else { return nil }
    let hex = String(match.output.1)
    let full = hex.count == 3 ? hex.map { "\($0)\($0)" }.joined() : hex
    guard let n = Int(full, radix: 16) else { return nil }
    return [Double((n >> 16) & 255), Double((n >> 8) & 255), Double(n & 255)]
  }
}

// MARK: - Inline HTML on the canvas

/// A text block's inline HTML (b, strong, i, em, u, br, a, span; render.ts
/// sanitizeInline) as formatted text for the native canvas. Links read as
/// underlined text, in their own colour when they set one (spans too); the
/// Preview shows the real thing.
enum EmailInlineHTML {
  static func attributed(_ html: String, linkColor: Color? = nil) -> AttributedString {
    var result = AttributedString()
    var bold = 0, italic = 0, underline = 0, link = 0
    /// What each open link or span set as its colour (nil: none).
    var colors: [Color?] = []
    var rest = Substring(html)
    while !rest.isEmpty {
      let color = colors.compactMap { $0 }.last ?? (link > 0 ? linkColor : nil)
      guard let tag = rest.firstMatch(of: #/<(\/?)([a-zA-Z0-9]+)([^>]*)>/#) else {
        result.append(run(rest, bold, italic, underline, link, color))
        break
      }
      result.append(run(rest[rest.startIndex..<tag.range.lowerBound], bold, italic, underline, link, color))
      let closing = !tag.output.1.isEmpty
      let step = closing ? -1 : 1
      switch tag.output.2.lowercased() {
      case "b", "strong": bold = max(0, bold + step)
      case "i", "em": italic = max(0, italic + step)
      case "u": underline = max(0, underline + step)
      case "a", "span":
        if tag.output.2.lowercased() == "a" { link = max(0, link + step) }
        if closing { _ = colors.popLast() } else { colors.append(ownColor(tag.output.3)) }
      case "br": result.append(AttributedString("\n"))
      default: break
      }
      rest = rest[tag.range.upperBound...]
    }
    return result
  }

  /// The `color:` a tag's style keeps (render.ts inlineStyle), when it's one the canvas can draw.
  private static func ownColor(_ attributes: Substring) -> Color? {
    for declaration in EmailRender.inlineStyle(attributes).split(separator: ";") where declaration.hasPrefix("color:") {
      return Color(hexString: String(declaration.dropFirst(6)))
    }
    return nil
  }

  private static func run(_ raw: Substring, _ bold: Int, _ italic: Int, _ underline: Int, _ link: Int, _ color: Color?) -> AttributedString {
    // HTML collapses runs of whitespace (a newline in the source is a space).
    let collapsed = raw.replacing(#/\s+/#, with: " ")
    guard !collapsed.isEmpty else { return AttributedString() }
    var text = AttributedString(EmailHTMLImport.decodeEntities(String(collapsed)))
    var intent: InlinePresentationIntent = []
    if bold > 0 { intent.insert(.stronglyEmphasized) }
    if italic > 0 { intent.insert(.emphasized) }
    if !intent.isEmpty { text.inlinePresentationIntent = intent }
    if underline > 0 || link > 0 { text.underlineStyle = .single }
    if let color { text.foregroundColor = color }
    return text
  }

  /// The words only, for labels.
  static func plain(_ html: String) -> String {
    String(attributed(html).characters)
  }
}
