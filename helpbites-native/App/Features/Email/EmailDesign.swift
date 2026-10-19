import Foundation

// The email being designed (shared/email/blocks.ts EmailDocument), kept as the
// JSON it is stored as, with typed accessors over it. Keys the editor doesn't
// know ride along untouched, so a save never drops what the AI or the web
// panel wrote; clearing an optional field removes its key, as the web's
// `undefined` does. `json` goes straight into EmailRender and the PATCH body.

struct EmailDesign: Equatable, Sendable {
  var settings: EmailDesignSettings
  var blocks: [EmailDesignBlock]
  /// Top-level keys other than settings and blocks.
  var extra: [String: JSONValue]

  /// A stored document; anything that isn't `{ settings, blocks }` opens as the blank starter.
  init(_ json: JSONValue?) {
    let root = EmailRender.object(json)
    let source = root["settings"] != nil && root["blocks"] != nil ? root : EmailRender.object(EmailRender.emptyDocument)
    var settings = EmailRender.object(EmailRender.defaultSettings(title: "Untitled email"))
    settings.merge(EmailRender.object(source["settings"])) { $1 }
    self.settings = EmailDesignSettings(fields: settings)
    blocks = EmailRender.list(source["blocks"]).compactMap(EmailDesignBlock.init(json:))
    extra = source.filter { $0.key != "settings" && $0.key != "blocks" }
    ensureUniqueIds()
  }

  var json: JSONValue {
    var root = extra
    root["settings"] = .object(settings.fields)
    root["blocks"] = .array(blocks.map(\.json))
    return .object(root)
  }

  // MARK: Finding blocks

  /// Where a block sits: among the top-level rows, or in one list of a container
  /// (blocks.ts childLists: a column of a columns block, or a section's blocks as
  /// column 0), at any depth.
  enum Location: Equatable, Sendable {
    case top(Int)
    case column(parent: String, column: Int, index: Int)
  }

  func block(_ id: String) -> EmailDesignBlock? { Self.find(id, in: blocks) }

  /// blocks.ts locateBlock, in reading order.
  func location(of id: String) -> Location? { Self.locate(id, in: blocks, parent: nil, column: 0) }

  private static func locate(_ id: String, in list: [EmailDesignBlock], parent: String?, column: Int) -> Location? {
    for (index, block) in list.enumerated() {
      if block.id == id { return parent.map { .column(parent: $0, column: column, index: index) } ?? .top(index) }
      for (inner, children) in block.children.enumerated() {
        if let found = locate(id, in: children, parent: block.id, column: inner) { return found }
      }
    }
    return nil
  }

  /// Every block, nested ones included, in reading order (walkBlocks).
  var allBlocks: [EmailDesignBlock] { Self.flatten(blocks) }

  private static func find(_ id: String, in blocks: [EmailDesignBlock]) -> EmailDesignBlock? {
    for block in blocks {
      if block.id == id { return block }
      for list in block.children { if let found = find(id, in: list) { return found } }
    }
    return nil
  }

  private static func flatten(_ blocks: [EmailDesignBlock]) -> [EmailDesignBlock] {
    blocks.flatMap { block in [block] + block.children.flatMap(flatten) }
  }

  // MARK: ops.ts

  /// updateBlock: change one block anywhere in the tree. False when the id is gone.
  @discardableResult
  mutating func update(_ id: String, _ change: (inout EmailDesignBlock) -> Void) -> Bool {
    Self.update(id, in: &blocks, change)
  }

  private static func update(_ id: String, in blocks: inout [EmailDesignBlock], _ change: (inout EmailDesignBlock) -> Void) -> Bool {
    for index in blocks.indices {
      if blocks[index].id == id {
        change(&blocks[index])
        return true
      }
      var lists = blocks[index].children
      for list in lists.indices {
        if update(id, in: &lists[list], change) {
          blocks[index].children = lists
          return true
        }
      }
    }
    return false
  }

  /// removeBlock: anywhere in the tree (its children go with it).
  @discardableResult
  mutating func remove(_ id: String) -> Bool { Self.remove(id, from: &blocks) }

  private static func remove(_ id: String, from blocks: inout [EmailDesignBlock]) -> Bool {
    if let index = blocks.firstIndex(where: { $0.id == id }) {
      blocks.remove(at: index)
      return true
    }
    for index in blocks.indices {
      var lists = blocks[index].children
      for list in lists.indices {
        if remove(id, from: &lists[list]) {
          blocks[index].children = lists
          return true
        }
      }
    }
    return false
  }

  /// addBlock: among the top-level rows; `at` is clamped, nil appends.
  mutating func insert(_ block: EmailDesignBlock, at index: Int? = nil) {
    let at = min(max(index ?? blocks.count, 0), blocks.count)
    blocks.insert(block, at: at)
  }

  /// Into one list of a container: a column of a columns block, or a section's
  /// blocks (column 0). Nil index appends. False when there's no such list.
  @discardableResult
  mutating func insert(_ block: EmailDesignBlock, inColumnsOf parentId: String, column: Int, at index: Int? = nil) -> Bool {
    var inserted = false
    update(parentId) { parent in
      var lists = parent.children
      guard lists.indices.contains(column) else { return }
      let at = min(max(index ?? lists[column].count, 0), lists[column].count)
      lists[column].insert(block, at: at)
      parent.children = lists
      inserted = true
    }
    return inserted
  }

  /// ops.ts replaceBlockWith: one block swapped for others in its place (none
  /// removes it). They get ids no other block has; returns them, nil when the id is gone.
  @discardableResult
  mutating func replace(_ id: String, with replacements: [EmailDesignBlock]) -> [String]? {
    guard let location = location(of: id) else { return nil }
    var seen = Set(allBlocks.map(\.id).filter { $0 != id })
    let added = Self.uniqued(replacements, &seen)
    switch location {
    case .top(let index):
      blocks.replaceSubrange(index...index, with: added)
    case .column(let parent, let column, let index):
      update(parent) { block in
        var lists = block.children
        lists[column].replaceSubrange(index...index, with: added)
        block.children = lists
      }
    }
    return added.map(\.id)
  }

  /// moveBlock: a top-level block to a new index (clamped after taking it out).
  mutating func move(_ id: String, to index: Int) {
    guard let from = blocks.firstIndex(where: { $0.id == id }) else { return }
    let block = blocks.remove(at: from)
    blocks.insert(block, at: min(max(index, 0), blocks.count))
  }

  /// Up or down one place within its own list (the email's, a section's or a column's).
  mutating func shift(_ id: String, by offset: Int) {
    switch location(of: id) {
    case .top(let index)?:
      move(id, to: index + offset)
    case .column(let parent, let column, let index)?:
      update(parent) { block in
        var lists = block.children
        let target = index + offset
        guard lists.indices.contains(column), lists[column].indices.contains(target) else { return }
        lists[column].swapAt(index, target)
        block.children = lists
      }
    case nil:
      break
    }
  }

  /// A copy of a block placed right after it; it and its children get fresh ids.
  @discardableResult
  mutating func duplicate(_ id: String) -> String? {
    guard let original = block(id), let location = location(of: id) else { return nil }
    var used = Set(allBlocks.map(\.id))
    let copy = original.withFreshIds(&used)
    switch location {
    case .top(let index): insert(copy, at: index + 1)
    case .column(let parent, let column, let index): insert(copy, inColumnsOf: parent, column: column, at: index + 1)
    }
    return copy.id
  }

  /// normalizeBlock's id rule: every block gets an id no other block has.
  mutating func ensureUniqueIds() {
    var seen = Set<String>()
    blocks = Self.uniqued(blocks, &seen)
  }

  private static func uniqued(_ blocks: [EmailDesignBlock], _ seen: inout Set<String>) -> [EmailDesignBlock] {
    blocks.map { original in
      var block = original
      if block.id.isEmpty || seen.contains(block.id) { block.id = EmailDesignBlock.newId(avoiding: seen) }
      seen.insert(block.id)
      let lists = block.children
      if !lists.isEmpty {
        // Only rewritten when an id changed, so a design reads back as it was stored.
        let next = lists.map { uniqued($0, &seen) }
        if next != lists { block.children = next }
      }
      return block
    }
  }
}

// MARK: - Settings

/// blocks.ts EmailSettings. `title` is the subject line.
struct EmailDesignSettings: Equatable, Sendable {
  var fields: [String: JSONValue]

  var backgroundColor: String { get { string("backgroundColor") } set { fields["backgroundColor"] = .string(newValue) } }
  var contentBackground: String { get { string("contentBackground") } set { fields["contentBackground"] = .string(newValue) } }
  var textColor: String { get { string("textColor") } set { fields["textColor"] = .string(newValue) } }
  var fontFamily: String { get { string("fontFamily") } set { fields["fontFamily"] = .string(newValue) } }
  var title: String { get { string("title") } set { fields["title"] = .string(newValue) } }
  var preheader: String { get { string("preheader") } set { fields["preheader"] = .string(newValue) } }
  /// The plain-text part; empty means it is made from the HTML.
  var text: String {
    get { string("text") }
    set { fields["text"] = newValue.isEmpty ? nil : .string(newValue) }
  }
  var contentWidth: Double {
    get { EmailRender.number(fields["contentWidth"]) ?? 600 }
    set { fields["contentWidth"] = .number(newValue) }
  }
  /// The theme tokens last applied, if any.
  var theme: EmailDesignTheme? {
    get { fields["theme"].flatMap { EmailRender.truthy($0) ? EmailDesignTheme(json: $0) : nil } }
    set { fields["theme"] = newValue?.json }
  }

  private func string(_ key: String) -> String { EmailRender.string(fields[key]) ?? "" }
}

// MARK: - Blocks

enum EmailBlockKind: String, CaseIterable, Identifiable, Sendable {
  case heading, text, button, image, divider, spacer, section, columns, html, component
  var id: String { rawValue }

  /// app/utils/emailBlocks.ts EMAIL_BLOCK_META.
  var label: String {
    switch self {
    case .heading: "Heading"
    case .text: "Text"
    case .button: "Button"
    case .image: "Image"
    case .divider: "Divider"
    case .spacer: "Spacer"
    case .section: "Section"
    case .columns: "Columns"
    case .html: "Custom HTML"
    case .component: "Component"
    }
  }

  var systemImage: String {
    switch self {
    case .heading: "textformat.size"
    case .text: "text.alignleft"
    case .button: "cursorarrow.click"
    case .image: "photo"
    case .divider: "minus"
    case .spacer: "arrow.up.and.down"
    case .section: "square.dashed"
    case .columns: "rectangle.split.2x1"
    case .html: "chevron.left.forwardslash.chevron.right"
    case .component: "puzzlepiece"
    }
  }

  /// Whether the block has an `align` the inspector edits.
  var aligns: Bool { [.heading, .text, .button, .image].contains(self) }

  /// Sections and columns hold blocks (blocks.ts childLists).
  var isContainer: Bool { self == .section || self == .columns }

  /// blocks.ts defaultBlock(): a freshly inserted block of this type.
  func make(id: String) -> EmailDesignBlock {
    let fields: [String: JSONValue] = switch self {
    case .heading: ["text": .string("Heading"), "level": .number(2), "align": .string("left"), "padding": .number(16)]
    case .text: ["html": .string("Some text."), "align": .string("left"), "padding": .number(16)]
    case .button: ["label": .string("Click me"), "href": .string("https://example.com"), "align": .string("center"), "backgroundColor": .string("#2563eb"), "color": .string("#ffffff"), "radius": .number(6), "padding": .number(16)]
    case .image: ["src": .string("https://via.placeholder.com/600x200"), "alt": .string(""), "align": .string("center"), "padding": .number(16)]
    case .divider: ["color": .string("#e4e4e7"), "thickness": .number(1), "padding": .number(8)]
    case .spacer: ["height": .number(24)]
    // A bare group: whatever the AI leaves out stays unset (no colour or padding of its own).
    case .section: ["blocks": .array([])]
    case .columns: ["columns": .array([.array([]), .array([])]), "gap": .number(16), "padding": .number(8)]
    case .html: ["html": .string("<!-- custom html -->")]
    case .component: ["componentId": .string(""), "name": .string("Component"), "html": .string(""), "fields": .array([]), "values": .object([:])]
    }
    var block = EmailDesignBlock(fields: fields.merging(["type": .string(rawValue)]) { $1 })
    block.id = id
    return block
  }

  /// emailBlocks.ts EMAIL_BLOCK_START: what a block added from the editor starts
  /// with over its defaults (a section you can see).
  var start: [String: JSONValue] {
    self == .section ? ["background": .string("#f4f4f5"), "radius": .number(8), "padding": .number(24)] : [:]
  }
}

/// A block's padding: none set, one value for every side, or each side.
enum EmailPadding: Equatable, Sendable {
  case none
  case uniform(Double)
  case sides(top: Double, right: Double, bottom: Double, left: Double)

  /// blocks.ts getPaddingSides: top, right, bottom, left.
  var edges: (top: Double, right: Double, bottom: Double, left: Double) {
    switch self {
    case .none: (0, 0, 0, 0)
    case .uniform(let value): (value, value, value, value)
    case .sides(let top, let right, let bottom, let left): (top, right, bottom, left)
    }
  }

  /// The one value when every side matches (getUniformPaddingValue), else nil.
  var uniformValue: Double? {
    let e = edges
    return e.top == e.right && e.top == e.bottom && e.top == e.left ? e.top : nil
  }

  init(json: JSONValue?) {
    let fields = EmailRender.object(json)
    if ["top", "right", "bottom", "left"].contains(where: { fields[$0] != nil }) {
      let side = { (key: String) in EmailRender.number(fields[key]) ?? 0 }
      self = .sides(top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left"))
    } else if let json, json != .null, !(json == .string("")) {
      self = .uniform(EmailRender.number(json) ?? 0)
    } else {
      self = .none
    }
  }

  var json: JSONValue? {
    switch self {
    case .none: nil
    case .uniform(let value): .number(value)
    case .sides(let top, let right, let bottom, let left): .object(["top": .number(top), "right": .number(right), "bottom": .number(bottom), "left": .number(left)])
    }
  }
}

/// One block of the email. Typed fields read leniently, the way the renderer
/// does; setting an optional one to nil removes its key.
struct EmailDesignBlock: Identifiable, Equatable, Sendable {
  var fields: [String: JSONValue]

  init(fields: [String: JSONValue]) { self.fields = fields }

  /// Any JSON object with a type; other values aren't blocks.
  init?(json: JSONValue) {
    guard case .object(let fields) = json, EmailRender.string(fields["type"]) != nil else { return nil }
    self.fields = fields
  }

  var json: JSONValue { .object(fields) }

  var id: String {
    get { EmailRender.string(fields["id"]) ?? "" }
    set { fields["id"] = .string(newValue) }
  }
  var type: String { EmailRender.string(fields["type"]) ?? "" }
  /// nil for a type this app doesn't know (it still renders, and is kept as is).
  var kind: EmailBlockKind? { EmailBlockKind(rawValue: type) }

  // Copy and links.
  var text: String { get { string("text") } set { fields["text"] = .string(newValue) } }
  var html: String { get { string("html") } set { fields["html"] = .string(newValue) } }
  var label: String { get { string("label") } set { fields["label"] = .string(newValue) } }
  var href: String { get { string("href") } set { fields["href"] = .string(newValue) } }
  var src: String { get { string("src") } set { fields["src"] = .string(newValue) } }
  var alt: String { get { string("alt") } set { fields["alt"] = .string(newValue) } }

  // Colours (nil = not set, so the email's own colour shows through).
  var color: String? { get { optionalString("color") } set { setString("color", newValue) } }
  var background: String? { get { optionalString("background") } set { setString("background", newValue) } }
  var backgroundColor: String { get { string("backgroundColor") } set { fields["backgroundColor"] = .string(newValue) } }

  var align: String { get { optionalString("align") ?? "left" } set { fields["align"] = .string(newValue) } }
  var level: Int {
    get { min(3, max(1, Int((EmailRender.number(fields["level"]) ?? 2).rounded()))) }
    set { fields["level"] = .number(Double(min(3, max(1, newValue)))) }
  }

  // Sizes (nil = the renderer's default).
  var fontSize: Double? { get { number("fontSize") } set { setNumber("fontSize", newValue) } }
  var radius: Double? { get { number("radius") } set { setNumber("radius", newValue) } }
  var width: Double? { get { number("width") } set { setNumber("width", newValue) } }
  var thickness: Double? { get { number("thickness") } set { setNumber("thickness", newValue) } }
  var gap: Double? { get { number("gap") } set { setNumber("gap", newValue) } }
  /// A spacer's height.
  var height: Double { get { number("height") ?? 0 } set { fields["height"] = .number(newValue) } }
  /// An image sized by height (a badge; ignored when it has a width). Nil removes it.
  var imageHeight: Double? { get { number("height") } set { setNumber("height", newValue) } }

  // A heading's type (nil = the level's size, the email's font, no tracking).
  var fontFamily: String? { get { optionalString("fontFamily") } set { setString("fontFamily", newValue) } }
  /// Tracking in px; negative tightens a large title.
  var letterSpacing: Double? { get { number("letterSpacing") } set { setNumber("letterSpacing", newValue) } }
  /// A CSS box-shadow, on buttons and sections.
  var shadow: String? { get { optionalString("shadow") } set { setString("shadow", newValue) } }

  // A section's surface: `background` is the solid colour and the gradient's start.
  var gradientTo: String? { get { optionalString("gradientTo") } set { setString("gradientTo", newValue) } }
  /// CSS degrees: 180 (the default) runs top to bottom.
  var gradientAngle: Double? { get { number("gradientAngle") } set { setNumber("gradientAngle", newValue) } }

  var padding: EmailPadding {
    get { EmailPadding(json: fields["padding"]) }
    set { fields["padding"] = newValue.json }
  }

  /// A columns block's columns, each a list of blocks.
  var columns: [[EmailDesignBlock]] {
    get { EmailRender.list(fields["columns"]).map { EmailRender.list($0).compactMap(EmailDesignBlock.init(json:)) } }
    set { fields["columns"] = .array(newValue.map { .array($0.map(\.json)) }) }
  }

  /// A section's blocks.
  var blocks: [EmailDesignBlock] {
    get { EmailRender.list(fields["blocks"]).compactMap(EmailDesignBlock.init(json:)) }
    set { fields["blocks"] = .array(newValue.map(\.json)) }
  }

  /// blocks.ts childLists: one list per column, the section's own, or none.
  var children: [[EmailDesignBlock]] {
    get {
      switch kind {
      case .columns: columns
      case .section: [blocks]
      default: []
      }
    }
    set {
      switch kind {
      case .columns: columns = newValue
      case .section: blocks = newValue.first ?? []
      default: break
      }
    }
  }

  // A library component's copy: its HTML and fields, and this email's values.
  var componentId: String { get { string("componentId") } set { fields["componentId"] = .string(newValue) } }
  var name: String { get { string("name") } set { fields["name"] = .string(newValue) } }
  /// The component's fields (`fields` is the block's own JSON).
  var componentFields: [EmailComponentField] {
    get { EmailRender.list(fields["fields"]).compactMap(EmailComponentField.init(json:)) }
    set { fields["fields"] = .array(newValue.map(\.json)) }
  }
  /// This instance's own values; a field without one shows its default.
  var values: [String: String] {
    get { EmailRender.object(fields["values"]).compactMapValues { $0 == .null ? nil : EmailRender.js($0) } }
    set { fields["values"] = .object(newValue.mapValues { .string($0) }) }
  }

  /// ops.ts updateBlock's merge of a component's values: one changes, nil goes
  /// back to the field's default, and only declared fields keep a value.
  mutating func setComponentValue(_ key: String, _ value: String?) {
    var raw = EmailRender.object(fields["values"])
    raw[key] = value.map { .string($0) } ?? .null
    values = EmailComponentField.values(for: componentFields, from: raw)
  }

  /// emailBlockLabel(): the block's copy when it has some, else its type.
  var displayName: String {
    let copy: String = switch kind {
    case .heading: text
    case .text: html.replacing(#/<[^>]+>/#, with: " ").replacing(#/\s+/#, with: " ")
    case .button: label
    case .image: alt
    case .component: name
    default: ""
    }
    let trimmed = String(copy.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
    return trimmed.isEmpty ? (kind?.label ?? type.capitalized) : trimmed
  }

  /// A copy with new ids for it and everything inside it.
  func withFreshIds(_ used: inout Set<String>) -> EmailDesignBlock {
    var copy = self
    copy.id = Self.newId(avoiding: used)
    used.insert(copy.id)
    let lists = children
    if !lists.isEmpty { copy.children = lists.map { $0.map { $0.withFreshIds(&used) } } }
    return copy
  }

  /// ops.ts newBlockId(): `blk_` and a short base-36 tail.
  static func newId(avoiding used: Set<String>) -> String {
    while true {
      let id = "blk_" + String(UInt64.random(in: 0..<(1 << 40)), radix: 36)
      if !used.contains(id) { return id }
    }
  }

  private func string(_ key: String) -> String {
    guard let value = fields[key], value != .null else { return "" }
    return EmailRender.js(value)
  }
  private func optionalString(_ key: String) -> String? {
    guard let value = fields[key], EmailRender.truthy(value) else { return nil }
    return EmailRender.js(value)
  }
  private mutating func setString(_ key: String, _ value: String?) {
    fields[key] = value.flatMap { $0.isEmpty ? nil : .string($0) }
  }
  private func number(_ key: String) -> Double? { EmailRender.number(fields[key]) }
  private mutating func setNumber(_ key: String, _ value: Double?) {
    fields[key] = value.map { .number($0) }
  }
}

// MARK: - Components (blocks.ts EmailComponentField, components.ts)

/// One editable part of a library component, written `{{@key}}` in its HTML:
/// copy, links and images are content; colours and sizes are style. Read
/// leniently; the JSON's `default` is `defaultValue` here.
struct EmailComponentField: Identifiable, Equatable, Sendable {
  /// COMPONENT_FIELD_TYPES, in order.
  enum Kind: String, CaseIterable, Identifiable, Sendable {
    case text = "text", richtext = "richtext", url = "url", image = "image", color = "color", number = "number"
    var id: String { rawValue }

    /// EmailComponentDialog.vue's names for them.
    var label: String {
      switch self {
      case .text: "Text"
      case .richtext: "Rich text"
      case .url: "Link"
      case .image: "Image"
      case .color: "Colour"
      case .number: "Number"
      }
    }

    /// defaultGroup(): a colour or a number is style, the rest is content.
    var group: Group { self == .color || self == .number ? .style : .content }
  }

  enum Group: String, CaseIterable, Identifiable, Sendable {
    case content = "content", style = "style"
    var id: String { rawValue }
    var label: String { self == .content ? "Content" : "Style" }
  }

  var key: String
  var label: String
  var type: Kind
  var group: Group
  var defaultValue: String

  var id: String { key }

  init(key: String, label: String, type: Kind, group: Group, defaultValue: String) {
    self.key = key
    self.label = label
    self.type = type
    self.group = group
    self.defaultValue = defaultValue
  }

  /// Any JSON object; other values aren't fields.
  init?(json: JSONValue) {
    guard case .object(let fields) = json else { return nil }
    key = EmailRender.string(fields["key"]) ?? ""
    label = EmailRender.string(fields["label"]) ?? ""
    type = Kind(rawValue: EmailRender.string(fields["type"]) ?? "") ?? .text
    group = Group(rawValue: EmailRender.string(fields["group"]) ?? "") ?? type.group
    defaultValue = Self.text(fields["default"]) ?? ""
  }

  var json: JSONValue {
    .object(["key": .string(key), "label": .string(label), "type": .string(type.rawValue), "group": .string(group.rawValue), "default": .string(defaultValue)])
  }

  /// COMPONENT_LIMITS.
  static let maxFields = 40, maxLabel = 80, maxValue = 2000

  /// KEY_RE: a plain identifier, so `values` objects store safely.
  static func isKey(_ key: String) -> Bool { key.wholeMatch(of: #/[A-Za-z][A-Za-z0-9_]{0,39}/#) != nil }

  /// slotKeys(): the field keys an HTML uses, in order of first appearance.
  static func slotKeys(_ html: String) -> [String] {
    var keys: [String] = []
    for match in html.matches(of: EmailRender.slotPattern) {
      let key = String(match.output.1)
      if isKey(key), !keys.contains(key) { keys.append(key) }
    }
    return keys
  }

  /// fieldLabel(): `buttonLabel` / `button_label` → "Button label".
  static func label(forKey key: String) -> String {
    let words = key.replacingOccurrences(of: "_", with: " ")
      .replacing(#/([a-z0-9])([A-Z])/#) { "\($0.output.1) \($0.output.2)" }
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
    return words.prefix(1).uppercased() + words.dropFirst()
  }

  /// guessFieldType(): what a slot is from where it sits. An href is a link, a
  /// src an image, after `color:` a colour, before `px` a number.
  static func guessType(_ html: String, key: String) -> Kind {
    guard isKey(key), let pattern = try? Regex("\\{\\{\\s*@\(key)\\s*\\}\\}"), let slot = html.firstRange(of: pattern) else { return .text }
    let units = html.utf16
    let start = units.index(slot.lowerBound, offsetBy: -48, limitedBy: units.startIndex) ?? units.startIndex
    let end = units.index(slot.upperBound, offsetBy: 4, limitedBy: units.endIndex) ?? units.endIndex
    let before = html[start..<slot.lowerBound]
    let after = html[slot.upperBound..<end].lowercased()
    if before.contains(#/\b(href|action)\s*=\s*["']?$/#.ignoresCase()) { return .url }
    if before.contains(#/\bsrc\s*=\s*["']?$/#.ignoresCase()) { return .image }
    if before.contains(#/(color|background|bgcolor|fill|stroke)\s*[:=]\s*["']?$/#.ignoresCase()) { return .color }
    if ["px", "em", "rem", "%", "deg"].contains(where: { after.hasPrefix($0) }) { return .number }
    return .text
  }

  /// normalizeComponentFields(): one field per `{{@key}}` in the HTML, in order.
  /// Described fields keep their label, type, group and default; a slot nobody
  /// described gets a guessed type, and a field the HTML no longer uses goes.
  static func normalized(_ html: String, declared raw: [JSONValue]) -> [EmailComponentField] {
    var declared: [String: EmailComponentField] = [:]
    for item in raw {
      let f = EmailRender.object(item)
      let key = (text(f["key"]) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      guard isKey(key), declared[key] == nil else { continue }
      let type = Kind(rawValue: f["type"].map(EmailRender.js) ?? "") ?? guessType(html, key: key)
      let label = EmailRender.jsSlice((text(f["label"]) ?? "").trimmingCharacters(in: .whitespacesAndNewlines), maxLabel)
      declared[key] = EmailComponentField(
        key: key,
        label: label.isEmpty ? Self.label(forKey: key) : label,
        type: type,
        group: Group(rawValue: EmailRender.string(f["group"]) ?? "") ?? type.group,
        defaultValue: EmailRender.jsSlice(text(f["default"]) ?? text(f["defaultValue"]) ?? "", maxValue)
      )
    }
    return slotKeys(html).prefix(maxFields).map { key in
      if let known = declared[key] { return known }
      let type = guessType(html, key: key)
      return EmailComponentField(key: key, label: label(forKey: key), type: type, group: type.group, defaultValue: "")
    }
  }

  /// componentValues(): an instance's values for its declared fields only, as strings.
  static func values(for fields: [EmailComponentField], from raw: [String: JSONValue]) -> [String: String] {
    var out: [String: String] = [:]
    for field in fields {
      if let value = text(raw[field.key]) { out[field.key] = EmailRender.jsSlice(value, maxValue) }
    }
    return out
  }

  /// `String(value)` for a value that isn't null or missing (JS `value ?? fallback`).
  private static func text(_ value: JSONValue?) -> String? {
    guard let value, value != .null else { return nil }
    return EmailRender.js(value)
  }
}

extension EmailDesignBlock {
  /// componentInstance(): a copy of a library component's HTML and fields, with
  /// values for its declared fields only. Self-contained: it renders without the library.
  static func component(id: String, componentId: String, name: String, html: String, fields: [EmailComponentField], values: [String: String] = [:]) -> EmailDesignBlock {
    var block = EmailBlockKind.component.make(id: id)
    block.componentId = componentId
    block.name = name
    block.html = html
    block.componentFields = fields
    block.values = EmailComponentField.values(for: fields, from: values.mapValues { .string($0) })
    return block
  }

  /// detachComponent(): the instance as custom HTML, its values filled in
  /// (`{{variables}}` stay), keeping its padding and background.
  var detached: EmailDesignBlock {
    var block = EmailDesignBlock(fields: ["type": .string("html"), "html": .string(EmailRender.fillComponent(fields["html"], fields: fields["fields"], values: fields["values"]))])
    block.id = id
    block.padding = padding
    block.background = background
    return block
  }
}
