import Foundation

/// Swift port of shared/email/render.ts, resolve.ts and placeholders.ts. No
/// admin route returns rendered HTML (the panel renders on the client), so the
/// linked-master preview renders here. Documents stay `JSONValue`; numbers and
/// strings are read as leniently as the TypeScript reads them.
/// ponytail: a hand port; keep it in step with shared/email when those change.
enum EmailRender {
  typealias Object = [String: JSONValue]

  static let defaultFont = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

  /// blocks.ts DEFAULT_SETTINGS with a title.
  static func defaultSettings(title: String) -> JSONValue {
    .object([
      "backgroundColor": .string("#f4f4f5"), "contentBackground": .string("#ffffff"), "contentWidth": .number(600),
      "fontFamily": .string(defaultFont), "textColor": .string("#18181b"), "title": .string(title), "preheader": .string("")
    ])
  }

  /// blocks.ts emptyDocument(): what a template without a design renders.
  static var emptyDocument: JSONValue {
    .object(["settings": defaultSettings(title: "Untitled email"), "blocks": .array([
      .object(["id": .string("blk_welcome"), "type": .string("heading"), "text": .string("Your headline here"), "level": .number(1), "align": .string("center"), "padding": .number(24)]),
      .object(["id": .string("blk_intro"), "type": .string("text"), "html": .string("Start by describing the email you want in the chat — or click a block to edit it directly."), "align": .string("center"), "padding": .number(16)])
    ])])
  }

  /// The colours a list row's swatch shows: page, card and first button.
  static func swatch(_ doc: JSONValue?) -> (background: String?, surface: String?, button: String?) {
    let settings = object(object(doc)["settings"])
    var button: String?
    _ = mapBlocks(list(object(doc)["blocks"])) { block in
      if button == nil, string(block["type"]) == "button" { button = string(block["backgroundColor"]) }
    }
    return (string(settings["backgroundColor"]), string(settings["contentBackground"]), button)
  }

  // MARK: resolve.ts

  /// resolveTemplate(): defaults < project brand < the row's values; a linked
  /// row renders its master's design with the project accent on brand buttons.
  static func resolve(document: JSONValue?, variables: [EmailVariable], values: [String: String], linked: Bool, brand: EmailBrand?) -> JSONValue {
    var vars: [String: String] = [:]
    for variable in variables { if let value = variable.defaultValue { vars[variable.key] = value } }
    if let brand {
      vars["project.name"] = brand.name
      vars["project.logoUrl"] = brand.brandLogoUrl ?? ""
      vars["project.url"] = brand.siteUrl ?? ""
      vars["project.address"] = brand.marketing?.postalAddress ?? ""
    }
    vars.merge(values) { $1 }
    var doc = document ?? emptyDocument
    if linked, let brand { doc = applyProjectAccent(doc, accent: brand.theme?.accent) }
    return substitute(doc, vars)
  }

  /// The master's brand colour becomes the project accent, on buttons and in
  /// components' colour fields. Anything in another colour was picked on purpose.
  static func applyProjectAccent(_ doc: JSONValue, accent: String?) -> JSONValue {
    guard let accent, accent.wholeMatch(of: #/#[0-9a-fA-F]{6}/#) != nil, case .object(var root) = doc else { return doc }
    let brand = themeBrand(doc).lowercased()
    let on = onColor(accent)
    root["blocks"] = .array(mapBlocks(list(root["blocks"])) { block in
      if string(block["type"]) == "button", (truthy(block["backgroundColor"]) ? raw(block["backgroundColor"]) : "").lowercased() == brand {
        block["backgroundColor"] = .string(accent)
        block["color"] = .string(on)
      }
      guard string(block["type"]) == "component" else { return }
      var values = object(block["values"])
      var swapped = false
      for item in list(block["fields"]) {
        let field = object(item)
        guard field["type"] == .string("color"), componentValue(field, values).trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == brand else { continue }
        values[raw(field["key"])] = .string(accent)
        swapped = true
      }
      if swapped { block["values"] = .object(values) }
    })
    return .object(root)
  }

  /// theme.ts currentTheme(doc).brand: the stored theme's, else the first
  /// button's colour that isn't transparent (a transparent button is a link).
  static func themeBrand(_ doc: JSONValue) -> String {
    let theme = object(object(doc)["settings"])["theme"]
    if truthy(theme) { return string(object(theme)["brand"]) ?? "#2563eb" }
    var brand: JSONValue?
    _ = mapBlocks(list(object(doc)["blocks"])) { block in
      guard string(block["type"]) == "button", !truthy(brand) else { return }
      if raw(block["backgroundColor"]).trimmingCharacters(in: .whitespacesAndNewlines).lowercased() != "transparent" { brand = block["backgroundColor"] }
    }
    guard let brand, brand != .null else { return "#2563eb" }
    return js(brand)
  }

  /// YIQ brightness: dark text on light accents, white on the rest.
  static func onColor(_ hex: String) -> String {
    let n = Int(hex.dropFirst(), radix: 16) ?? 0
    let brightness = Double(((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000
    return brightness > 150 ? "#111111" : "#ffffff"
  }

  /// placeholders.ts applyTemplateVariables: `{{ key }}` and `{{{ key }}}` in every
  /// string, left as typed when the key is unknown. Only custom HTML (an html
  /// block's, a component's markup) is emitted verbatim, so only there a
  /// `{{ key }}` value is escaped; a component's values fill raw (the renderer escapes them).
  static func substitute(_ value: JSONValue, _ vars: [String: String], html: Bool = false) -> JSONValue {
    switch value {
    case .string(let text):
      return .string(fill(text, vars, html: html))
    case .array(let items): return .array(items.map { substitute($0, vars) })
    case .object(let fields):
      let rawHtml = string(fields["type"]) == "html" || string(fields["type"]) == "component"
      return .object(Dictionary(uniqueKeysWithValues: fields.map { key, inner in (key, substitute(inner, vars, html: rawHtml && key == "html")) }))
    default: return value
    }
  }

  /// placeholders.ts fillPlaceholders.
  static func fill(_ text: String, _ vars: [String: String], html: Bool) -> String {
    text.replacing(placeholderPattern) { match in
      let rawKey = match.output.1.map(String.init)
      let name = rawKey ?? match.output.2.map(String.init) ?? ""
      guard let filled = vars[name] else { return String(match.output.0) }
      return html && rawKey == nil ? escapeValue(filled) : filled
    }
  }

  /// `{{{ key }}}` (raw) or `{{ key }}`.
  nonisolated(unsafe) static let placeholderPattern = #/\{\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}\}|\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/#

  /// render.ts SLOT_RE: `{{@key}}`, a component field. The `@` keeps it apart
  /// from `{{variables}}`, which fill in first.
  nonisolated(unsafe) static let slotPattern = #/\{\{\s*@([A-Za-z][A-Za-z0-9_]*)\s*\}\}/#

  /// placeholders.ts escapeHtmlValue.
  static func escapeValue(_ value: String) -> String {
    value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
      .replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&#39;")
  }

  /// blocks.ts walkBlocks, as a map: every block, those inside sections and columns too.
  static func mapBlocks(_ blocks: [JSONValue], _ transform: (inout Object) -> Void) -> [JSONValue] {
    blocks.map { block in
      guard case .object(var fields) = block else { return block }
      transform(&fields)
      if string(fields["type"]) == "columns", case .array(let columns)? = fields["columns"] {
        fields["columns"] = .array(columns.map { .array(mapBlocks(list($0), transform)) })
      }
      if string(fields["type"]) == "section", case .array(let children)? = fields["blocks"] {
        fields["blocks"] = .array(mapBlocks(children, transform))
      }
      return .object(fields)
    }
  }

  // MARK: render.ts

  /// renderEmailHtml(): the standalone, email-safe document.
  static func html(_ doc: JSONValue) -> String {
    let settings = object(object(doc)["settings"])
    let preheader = truthy(settings["preheader"]) ? "<div style=\"display:none;max-height:0;overflow:hidden;mso-hide:all;\">\(esc(settings["preheader"]))</div>" : ""
    let font = js(settings["fontFamily"] ?? .string("")).replacingOccurrences(of: "\"", with: "'")
    return """
    <!doctype html>
    <html lang="en">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>\(esc(settings["title"]))</title>
    </head>
    <body style="margin:0;padding:0;background-color:\(esc(settings["backgroundColor"]));">
    \(preheader)
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:\(esc(settings["backgroundColor"]));font-family:\(font);color:\(esc(settings["textColor"]));">
    <tr>
    <td align="center" style="padding:24px 12px;">
    <!--[if mso]><table role="presentation" width="\(js(number(settings["contentWidth"]) ?? 600))" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    \(renderBlocks(doc))
    <!--[if mso]></td></tr></table><![endif]-->
    </td>
    </tr>
    </table>
    </body>
    </html>
    """
  }

  /// renderBlocks(): the card. A card the colour of the page is no card: the
  /// design draws its own (a section, imported HTML), and rounding and clipping
  /// here would cut its shadow.
  static func renderBlocks(_ doc: JSONValue) -> String {
    let settings = object(object(doc)["settings"])
    let width = number(settings["contentWidth"]) ?? 600
    let rows = list(object(doc)["blocks"]).map { "<tr>\(block($0, width))</tr>" }.joined()
    let melted = colorKey(settings["contentBackground"]) == colorKey(settings["backgroundColor"])
    // Fluid up to the content width: a fixed-width table doesn't shrink on a phone.
    return "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:100%;max-width:\(js(width))px;background-color:\(esc(settings["contentBackground"]));\(melted ? "" : "border-radius:8px;overflow:hidden;")\">\(rows)</table>"
  }

  /// `String(value || '').trim().toLowerCase()`.
  private static func colorKey(_ value: JSONValue?) -> String {
    (truthy(value) ? raw(value) : "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  /// renderBlockTable(): one block as a standalone table, what "Save as component" starts from.
  static func blockTable(_ value: JSONValue, _ contentWidth: Double) -> String {
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>\(block(value, contentWidth))</tr></table>"
  }

  static func block(_ value: JSONValue, _ contentWidth: Double) -> String {
    let b = object(value)
    switch string(b["type"]) {
    case "heading":
      let level = raw(b["level"])
      let size = positive(b["fontSize"]) ? raw(b["fontSize"]) : String(["1": 28, "2": 22, "3": 18][level] ?? 22)
      let color = truthy(b["color"]) ? "color:\(esc(b["color"]));" : ""
      let font = truthy(b["fontFamily"]) ? "font-family:\(cssValue(raw(b["fontFamily"]).replacingOccurrences(of: "\"", with: "'")));" : ""
      let tracking = truthy(b["letterSpacing"]) ? "letter-spacing:\(raw(b["letterSpacing"]))px;" : ""
      return "\(cell(b, b["align"]))<h\(level) style=\"margin:0;font-size:\(size)px;line-height:1.25;font-weight:700;\(color)\(font)\(tracking)\">\(esc(b["text"]))</h\(level)></td>"
    case "text":
      let color = truthy(b["color"]) ? "color:\(esc(b["color"]));" : ""
      let size = truthy(b["fontSize"]) ? "font-size:\(raw(b["fontSize"]))px;" : "font-size:15px;"
      return "\(cell(b, b["align"]))<div style=\"margin:0;line-height:1.6;\(size)\(color)\">\(sanitizeInline(b["html"]))</div></td>"
    case "button":
      let href = isSafeLink(b["href"]) ? raw(b["href"]) : "#"
      let radius = isNumber(b["radius"]) ? raw(b["radius"]) : "6"
      // The padding scales with the label: 15px (the default) keeps 12px 24px.
      let sized = positive(b["fontSize"])
      let fs = sized ? toNumber(b["fontSize"]) : 15
      let shadow = truthy(b["shadow"]) ? "box-shadow:\(cssValue(raw(b["shadow"])));" : ""
      return "\(cell(b, b["align"]))<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"display:inline-table;\"><tr><td style=\"background-color:\(esc(b["backgroundColor"]));border-radius:\(radius)px;\(shadow)\"><a href=\"\(esc(.string(href)))\" target=\"_blank\" rel=\"noopener noreferrer\" style=\"display:inline-block;padding:\(js(jsRound(fs * 0.8)))px \(js(jsRound(fs * 1.6)))px;font-size:\(sized ? raw(b["fontSize"]) : "15")px;font-weight:600;color:\(esc(b["color"]));text-decoration:none;border-radius:\(radius)px;\">\(esc(b["label"]))</a></td></tr></table></td>"
    case "image":
      let available = max(contentWidth - horizontalPadding(b["padding"]), 0)
      let sizedByWidth = positive(b["width"])
      let w = sizedByWidth ? min(toNumber(b["width"]), contentWidth) : available
      // A block image ignores text-align, so centre and right come from its margins.
      let margin = raw(b["align"]) == "center" ? "margin:0 auto;" : raw(b["align"]) == "right" ? "margin:0 0 0 auto;" : ""
      // Sized by height (a badge): the width follows the picture's own shape.
      let size = !sizedByWidth && positive(b["height"])
        ? "height=\"\(raw(b["height"]))\" style=\"display:block;\(margin)height:\(raw(b["height"]))px;width:auto;max-width:100%;"
        : "width=\"\(js(w))\" style=\"display:block;\(margin)width:\(js(w))px;max-width:100%;height:auto;"
      let img = "<img src=\"\(esc(b["src"]))\" alt=\"\(esc(b["alt"]))\" \(size)border:0;outline:none;text-decoration:none;border-radius:4px;\" />"
      let inner = truthy(b["href"]) && isSafeLink(b["href"]) ? "<a href=\"\(esc(b["href"]))\" target=\"_blank\" rel=\"noopener noreferrer\">\(img)</a>" : img
      return "\(cell(b, b["align"]))<div align=\"\(raw(b["align"]))\" style=\"text-align:\(raw(b["align"]));\">\(inner)</div></td>"
    case "divider":
      let color = b["color"] == nil || b["color"] == .null ? "#e4e4e7" : esc(b["color"])
      let thickness = isNumber(b["thickness"]) ? raw(b["thickness"]) : "1"
      return "\(cell(b, nil))<div style=\"border-top:\(thickness)px solid \(color);font-size:0;line-height:0;\">&nbsp;</div></td>"
    case "spacer":
      return "<td style=\"font-size:0;line-height:0;height:\(raw(b["height"]))px;\">&nbsp;</td>"
    case "columns":
      let columns = list(b["columns"])
      let count = Double(max(columns.count, 1))
      let gap = isNumber(b["gap"]) ? number(b["gap"]) ?? 16 : 16
      let inner = max(contentWidth - horizontalPadding(b["padding"]), 0)
      let columnWidth = max(0, ((inner - gap * (count - 1)) / count).rounded(.down))
      let cells = columns.enumerated().map { index, column in
        let children = list(column)
        let body = children.isEmpty ? "&nbsp;" : "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">\(children.map { "<tr>\(block($0, columnWidth))</tr>" }.joined())</table>"
        return "<td width=\"\(js(columnWidth))\" valign=\"top\" style=\"\(index > 0 ? "padding-left:\(js(gap))px;" : "")\">\(body)</td>"
      }.joined()
      return "\(cell(b, nil))<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>\(cells)</tr></table></td>"
    case "html":
      return "\(cell(b, nil))\(b["html"] == nil || b["html"] == .null ? "" : raw(b["html"]))</td>"
    case "section":
      let pad = sides(b["padding"])
      let inner = max(contentWidth - pad[3] - pad[1], 0)
      let radius = isNumber(b["radius"]) && toNumber(b["radius"]) > 0 ? toNumber(b["radius"]) : 0
      let angle = isNumber(b["gradientAngle"]) ? raw(b["gradientAngle"]) : "180"
      let background = truthy(b["background"]) ? "background-color:\(esc(b["background"]));" : ""
      // Outlook ignores the gradient and shows the solid colour.
      let gradient = truthy(b["gradientTo"]) ? "background-image:linear-gradient(\(angle)deg, \(esc(truthy(b["background"]) ? b["background"] : b["gradientTo"])), \(esc(b["gradientTo"])));" : ""
      let round = radius > 0 ? "border-radius:\(js(radius))px;" : ""
      let shadow = truthy(b["shadow"]) ? "box-shadow:\(cssValue(raw(b["shadow"])));" : ""
      // The children's table clips to the corners, so a band at the top of a rounded card stays inside it.
      // ponytail: one radius for every corner, as render.ts; per-corner radii if a client shows a band's square corners.
      let clip = max(0, radius - (pad.min() ?? 0))
      let rows = list(b["blocks"]).map { "<tr>\(block($0, inner))</tr>" }.joined()
      return "<td style=\"padding:\(paddingCSS(b["padding"]));\(background)\(gradient)\(round)\(shadow)\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:100%;\(clip > 0 ? "border-radius:\(js(clip))px;overflow:hidden;" : "")\">\(rows.isEmpty ? "<tr><td>&nbsp;</td></tr>" : rows)</table></td>"
    case "component":
      // Same trust model as an html block; only the field values are escaped.
      return "\(cell(b, nil))\(fillComponent(b["html"], fields: b["fields"], values: b["values"]))</td>"
    default:
      return ""
    }
  }

  // MARK: Components (render.ts fillComponent)

  /// componentValue(): a field's value in one instance, its own, else the field's default.
  static func componentValue(_ field: Object, _ values: Object) -> String {
    let key = raw(field["key"])
    guard let value = values[key] != nil ? values[key] : field["default"], value != .null else { return "" }
    return js(value)
  }

  /// fillComponent(): a component's HTML with each `{{@key}}` filled in, escaped
  /// or checked by the field's type. An unknown key fills in nothing.
  static func fillComponent(_ html: JSONValue?, fields: JSONValue?, values: JSONValue?) -> String {
    var byKey: [String: Object] = [:]
    for item in list(fields) {
      let field = object(item)
      if let key = string(field["key"]) { byKey[key] = field }
    }
    let own = object(values)
    let source = html.map { $0 == .null ? "" : js($0) } ?? ""
    return source.replacing(slotPattern) { match -> String in
      guard let field = byKey[String(match.output.1)] else { return "" }
      let value = componentValue(field, own).trimmingCharacters(in: .whitespacesAndNewlines)
      switch string(field["type"]) {
      case "richtext": return sanitizeInline(value)
      case "url", "image": return value.isEmpty ? "" : esc(.string(isSafeURL(value) ? value : "#"))
      case "color": return value.wholeMatch(of: safeColor) != nil ? value : ""
      case "number":
        guard let parsed = number(.string(value)), parsed.isFinite else { return "" }
        return js(parsed)
      default: return esc(.string(value))
      }
    }
  }

  /// SAFE_URL: links, mail, phone, inline images, anchors and `{{variables}}`.
  private static func isSafeURL(_ value: String) -> Bool {
    let lower = value.lowercased()
    return ["http:", "https:", "mailto:", "tel:", "cid:", "#", "{{"].contains { lower.hasPrefix($0) }
  }

  /// SAFE_COLOR: hex, rgb()/hsl(), a colour name or a `{{variable}}`.
  nonisolated(unsafe) private static let safeColor = #/#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%\/+\-]+\)|[a-z]+|\{\{\s*[\w.\-]+\s*\}\}/#
    .ignoresCase()
    .asciiOnlyDigits()
    .asciiOnlyWordCharacters()

  /// cssValue(): a free-form CSS value (a shadow, a font stack) that can't break
  /// out of its declaration or attribute.
  static func cssValue(_ text: String) -> String {
    let cleaned = text.replacing(#/url\s*\(|expression\s*\(/#.ignoresCase(), with: "")
      .replacing(#/[;{}<>"\\]/#, with: "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return jsSlice(cleaned, 200)
  }

  private static func cell(_ b: Object, _ align: JSONValue?) -> String {
    let background = truthy(b["background"]) ? "background-color:\(esc(b["background"]));" : ""
    let textAlign = truthy(align) ? "text-align:\(raw(align));" : ""
    return "<td style=\"padding:\(paddingCSS(b["padding"]));\(background)\(textAlign)\">"
  }

  /// blocks.ts getPaddingSides: a number, or a per-side object; top right bottom left.
  private static func sides(_ padding: JSONValue?) -> [Double] {
    let fields = object(padding)
    if ["top", "right", "bottom", "left"].contains(where: { fields[$0] != nil }) {
      return ["top", "right", "bottom", "left"].map { number(fields[$0]) ?? 0 }
    }
    let uniform = number(padding) ?? 0
    return [uniform, uniform, uniform, uniform]
  }

  private static func paddingCSS(_ padding: JSONValue?) -> String { sides(padding).map { "\(js($0))px" }.joined(separator: " ") }
  private static func horizontalPadding(_ padding: JSONValue?) -> Double { let s = sides(padding); return s[1] + s[3] }

  /// render.ts safeHref's test: http(s) or mailto, or a `{{placeholder}}` not
  /// filled in yet (sends fill them before rendering; an unknown one stays as
  /// written, so a test shows it). Button links, image links and inline links.
  private static func isSafeLink(_ value: JSONValue?) -> Bool {
    let link = raw(value)
    let lower = link.lowercased()
    return lower.hasPrefix("http:") || lower.hasPrefix("https:") || lower.hasPrefix("mailto:") || link.prefixMatch(of: placeholderLink) != nil
  }

  nonisolated(unsafe) private static let placeholderLink = #/\{\{\{?\s*[\w.\-]+\s*\}?\}\}/#.asciiOnlyWordCharacters()

  /// render.ts INLINE_STYLE_PROPS: the text styles a link or a span keeps (a
  /// link's colour and weight, a highlight).
  static let inlineStyleProps = ["color", "background-color", "font-weight", "font-style", "text-decoration", "font-size"]

  /// render.ts inlineStyle(): the allowed declarations of a tag's style attribute, as `prop:value;`.
  static func inlineStyle(_ attributes: Substring) -> String {
    guard let found = attributes.firstMatch(of: #/style\s*=\s*("([^"]*)"|'([^']*)')/#.ignoresCase()) else { return "" }
    let declarations = String(found.output.2 ?? found.output.3 ?? "")
    return declarations.components(separatedBy: ";").map { declaration -> String in
      guard let colon = declaration.firstIndex(of: ":") else { return "" }
      let prop = declaration[..<colon].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      let value = declaration[declaration.index(after: colon)...]
        .replacing(#/!important/#.ignoresCase(), with: "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
      guard inlineStyleProps.contains(prop), value.wholeMatch(of: #/[#A-Za-z0-9_\s.,%()+\-]+/#) != nil, !value.contains(#/url|expression/#.ignoresCase()) else { return "" }
      return "\(prop):\(value);"
    }.joined()
  }

  /// The inline subset a text block keeps (b, strong, i, em, u, br, a, span); other
  /// tags drop, their text stays. `href` is http(s)/mailto only; links and spans keep a few text styles.
  static func sanitizeInline(_ value: JSONValue?) -> String {
    guard truthy(value) else { return "" }
    return sanitizeInline(raw(value))
  }

  static func sanitizeInline(_ html: String) -> String {
    guard !html.isEmpty else { return "" }
    let allowed: Set<String> = ["b", "strong", "i", "em", "u", "br", "a", "span"]
    return html.replacing(#/<\/?([a-zA-Z0-9]+)([^>]*)>/#) { match -> String in
      let name = match.output.1.lowercased()
      guard allowed.contains(name) else { return "" }
      if match.output.0.hasPrefix("</") { return "</\(name)>" }
      if name == "br" { return "<br>" }
      let style = inlineStyle(match.output.2)
      if name == "a" {
        let found = match.output.2.firstMatch(of: #/href\s*=\s*("([^"]*)"|'([^']*)')/#.ignoresCase())
        let href = found.map { String($0.output.2 ?? $0.output.3 ?? "") } ?? ""
        let safe = isSafeLink(.string(href)) ? href : "#"
        // Links take the text colour unless they bring their own.
        let linkStyle = style.contains(#/(^|;)color:/#) ? style : "color:inherit;\(style)"
        return "<a href=\"\(esc(.string(safe)))\" target=\"_blank\" rel=\"noopener noreferrer\" style=\"\(linkStyle)\">"
      }
      if name == "span", !style.isEmpty { return "<span style=\"\(style)\">" }
      return "<\(name)>"
    }
  }

  // MARK: JavaScript semantics

  /// Escape for an HTML text node or attribute: `String(s ?? '')`, then & < > ".
  static func esc(_ value: JSONValue?) -> String {
    guard let value, value != .null else { return "" }
    return js(value).replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
  }

  /// What a template literal prints for a value (`undefined` when it is missing).
  private static func raw(_ value: JSONValue?) -> String { value.map(js) ?? "undefined" }

  static func js(_ value: JSONValue) -> String {
    switch value {
    case .string(let text): text
    case .number(let number): js(number)
    case .bool(let flag): flag ? "true" : "false"
    case .null: "null"
    case .array(let items): items.map { $0 == .null ? "" : js($0) }.joined(separator: ",")
    case .object: "[object Object]"
    }
  }

  static func js(_ number: Double) -> String {
    number.rounded() == number && abs(number) < 1e15 ? String(Int(number)) : String(number)
  }

  /// `value && value > 0`.
  private static func positive(_ value: JSONValue?) -> Bool { truthy(value) && toNumber(value) > 0 }

  /// JavaScript's ToNumber, as `>` and `*` apply it: NaN when it isn't a number.
  /// ponytail: no hex or Infinity spellings; documents hold plain numbers.
  private static func toNumber(_ value: JSONValue?) -> Double {
    switch value {
    case .number(let number)?: return number
    case .string(let text)?:
      let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? 0 : Double(trimmed).flatMap { $0.isFinite ? $0 : nil } ?? .nan
    case .bool(let flag)?: return flag ? 1 : 0
    case .null?: return 0
    default: return .nan
    }
  }

  /// Math.round: halves go up.
  private static func jsRound(_ number: Double) -> Double { (number + 0.5).rounded(.down) }

  /// `text.slice(0, count)`: the first `count` UTF-16 units.
  static func jsSlice(_ text: String, _ count: Int) -> String {
    text.utf16.count <= count ? text : String(decoding: Array(text.utf16.prefix(count)), as: UTF16.self)
  }

  static func truthy(_ value: JSONValue?) -> Bool {
    switch value {
    case .none, .null?: false
    case .string(let text)?: !text.isEmpty
    case .number(let number)?: number != 0 && !number.isNaN
    case .bool(let flag)?: flag
    case .array?, .object?: true
    }
  }

  // Readers over JSON values, kept here rather than as JSONValue extensions so
  // they can't collide with another feature's helpers on the shared type.
  static func object(_ value: JSONValue?) -> Object { if case .object(let fields)? = value { return fields }; return [:] }
  static func list(_ value: JSONValue?) -> [JSONValue] { if case .array(let items)? = value { return items }; return [] }
  static func string(_ value: JSONValue?) -> String? { if case .string(let text)? = value { return text }; return nil }
  private static func isNumber(_ value: JSONValue?) -> Bool { if case .number? = value { return true }; return false }

  /// blocks.ts readNumberish: a finite number, or what parseFloat makes of a string.
  static func number(_ value: JSONValue?) -> Double? {
    switch value {
    case .number(let number)?: return number.isFinite ? number : nil
    case .string(let text)?:
      guard let match = text.firstMatch(of: #/^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/#) else { return nil }
      return Double(match.output.trimmingCharacters(in: .whitespacesAndNewlines))
    case .object(let fields)?: return number(fields["value"])
    default: return nil
    }
  }
}

/// Swift port of shared/email/import.ts htmlToEmailDocument(): an HTML email
/// becomes one custom-HTML block, with the <title> as the subject, the hidden
/// preheader lifted into the settings (and out of the markup), and the page
/// background and an imported content width carried over.
enum EmailHTMLImport {
  static let importedContentWidth: Double = 672

  /// The document and the title it found ("Untitled email" when there was none).
  static func document(from html: String) -> (document: JSONValue, title: String) {
    let title = titleOf(html).trimmingCharacters(in: .whitespacesAndNewlines)
    let subject = title.isEmpty ? "Untitled email" : title
    let background = backgroundOf(html)
    let extracted = extractPreheader(stripDocumentShell(html))
    guard case .object(var settings) = EmailRender.defaultSettings(title: subject) else { return (.null, subject) }
    settings["preheader"] = .string(extracted.preheader)
    if let background {
      settings["backgroundColor"] = .string(background)
      settings["contentBackground"] = .string(background)
    }
    settings["contentWidth"] = .number(importedContentWidth)
    let block: JSONValue = .object([
      "id": .string("blk_imported"),
      "type": .string("html"),
      "html": .string(extracted.html.trimmingCharacters(in: .whitespacesAndNewlines)),
      "padding": .number(0)
    ])
    return (.object(["settings": .object(settings), "blocks": .array([block])]), subject)
  }

  /// Sets the subject (settings.title) of a document made by `document(from:)`.
  static func retitle(_ document: JSONValue, _ title: String) -> JSONValue {
    guard case .object(var root) = document, case .object(var settings)? = root["settings"] else { return document }
    settings["title"] = .string(title)
    root["settings"] = .object(settings)
    return .object(root)
  }

  static func titleOf(_ html: String) -> String {
    guard let match = html.firstMatch(of: #/<title[^>]*>([^<]*)<\/title>/#.ignoresCase()) else { return "" }
    let collapsed = String(match.output.1).replacing(#/\s+/#, with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    return decodeEntities(collapsed)
  }

  /// The body's markup (with the head's <style> blocks), or the whole thing minus the doctype.
  static func stripDocumentShell(_ html: String) -> String {
    guard let body = html.firstMatch(of: #/<body\b[^>]*>([\s\S]*)<\/body>/#.ignoresCase()) else {
      return html.replacing(#/<!doctype[^>]*>/#.ignoresCase(), with: "", maxReplacements: 1).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    var styles: [String] = []
    if let head = html.firstMatch(of: #/<head\b[^>]*>([\s\S]*?)<\/head>/#.ignoresCase()) {
      styles = head.output.1.matches(of: #/<style\b[^>]*>[\s\S]*?<\/style>/#.ignoresCase()).map { String($0.output) }
    }
    return (styles + [String(body.output.1).trimmingCharacters(in: .whitespacesAndNewlines)]).joined(separator: "\n")
  }

  /// The page colour: the body's, else the outermost wrapper's (the first one near the top).
  static func backgroundOf(_ html: String) -> String? {
    let bodyAttributes = html.firstMatch(of: #/<body\b([^>]*)>/#.ignoresCase()).map { String($0.output.1) } ?? ""
    if let color = colorIn(bodyAttributes) { return color }
    return colorIn(String(stripDocumentShell(html).prefix(1500)))
  }

  private static func colorIn(_ text: String) -> String? {
    text.firstMatch(of: #/(?:background(?:-color)?\s*:\s*|bgcolor\s*=\s*["']?)(#[0-9a-f]{6}|#[0-9a-f]{3})\b/#.ignoresCase()).map { String($0.output.1) }
  }

  private static func hiddenText(_ attributes: Substring, _ inner: Substring) -> String {
    guard attributes.firstMatch(of: #/display\s*:\s*none|max-height\s*:\s*0|visibility\s*:\s*hidden/#.ignoresCase()) != nil else { return "" }
    return decodeEntities(String(inner).replacing(#/\s+/#, with: " ").trimmingCharacters(in: .whitespacesAndNewlines))
  }

  /// The preview text emails hide before their first table; every copy of it is removed.
  static func extractPreheader(_ html: String) -> (preheader: String, html: String) {
    let leaf = #/<(span|div)\b([^>]*)>([^<]*)<\/(span|div)>/#.ignoresCase()
    let split = html.firstRange(of: #/<table\b/#.ignoresCase())?.lowerBound ?? html.endIndex
    let head = String(html[..<split])
    let rest = String(html[split...])
    var preheader = ""
    for match in head.matches(of: leaf) where match.output.1.lowercased() == match.output.4.lowercased() {
      preheader = hiddenText(match.output.2, match.output.3)
      if !preheader.isEmpty { break }
    }
    guard !preheader.isEmpty else { return ("", html) }
    let found = preheader
    let removed = head.replacing(leaf) { match -> String in
      let same = match.output.1.lowercased() == match.output.4.lowercased()
      return same && hiddenText(match.output.2, match.output.3) == found ? "" : String(match.output.0)
    }
    // Drop the lines that held only the preheader (blank lines; the last line stays as it is).
    var lines = removed.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    let last = lines.removeLast()
    lines = lines.filter { line in !line.allSatisfy { $0 == " " || $0 == "\t" } }
    let cleaned = (lines.map { $0 + "\n" }.joined()) + last
    return (preheader, cleaned + rest)
  }

  private static let namedEntities: [String: String] = [
    "nbsp": "\u{00a0}", "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "mdash": "—", "ndash": "–", "hellip": "…",
    "rsquo": "’", "lsquo": "‘", "rdquo": "”", "ldquo": "“", "copy": "©", "reg": "®", "trade": "™", "middot": "·", "bull": "•",
    "laquo": "«", "raquo": "»", "euro": "€", "pound": "£"
  ]

  /// decodeHtmlEntities(): character references decoded once.
  static func decodeEntities(_ value: String) -> String {
    value.replacing(#/&(#x[0-9a-f]+|#\d+|[a-z]+);/#.ignoresCase()) { match -> String in
      let code = String(match.output.1)
      if code.hasPrefix("#") {
        let isHex = code.dropFirst().first.map { $0 == "x" || $0 == "X" } ?? false
        let number = isHex ? Int(code.dropFirst(2), radix: 16) : Int(code.dropFirst())
        if let number, number > 0, number <= 0x10FFFF, let scalar = Unicode.Scalar(UInt32(number)) { return String(Character(scalar)) }
        return String(match.output.0)
      }
      return namedEntities[code.lowercased()] ?? String(match.output.0)
    }
  }
}
