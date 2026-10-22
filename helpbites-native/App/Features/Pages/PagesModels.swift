import Foundation

// The shapes of /v1/admin/cms/** (shared/cms/content.ts, server/utils/cms.ts) and
// the tree operations the entry editor runs on a page's content.

/// The kinds of value a component's field holds (`CMS_FIELD_TYPES`), ported by hand
/// (tests/cmsNativeParity.test.ts).
enum CmsFieldKind: String, CaseIterable, Sendable {
  case text, textarea, markdown, number, boolean, color, url, date, select, icon, asset, blocks
}

/// The lists and limits of shared/cms/content.ts and shared/cms/icons.ts, ported by hand.
enum CmsOptions {
  static let widths: [(id: String, label: String)] = [("narrow", "Narrow"), ("normal", "Normal"), ("wide", "Wide")]
  /// The page's colour scheme: `BRAND_THEMES`, worded for a visitor.
  static let modes: [(id: String, label: String)] = [("auto", "Follows the visitor"), ("light", "Light"), ("dark", "Dark")]
  /// Families the style picker suggests; any Google Fonts name or system font works.
  static let fonts = ["Inter", "Geist", "DM Sans", "Manrope", "Plus Jakarta Sans", "Space Grotesk", "Outfit", "Sora", "IBM Plex Sans", "Fraunces", "Playfair Display", "Instrument Serif", "JetBrains Mono"]
  /// `CMS_ICON_NAMES`: the Lucide icons an icon field offers.
  static let icons = [
    "activity", "app-window", "app-window-mac", "apple", "arrow-left-right", "arrow-right", "arrow-up-right", "bell",
    "blend", "book-open", "bot", "box", "brain", "briefcase", "calendar", "camera", "chart-line", "check", "chrome",
    "circle-check", "clock", "cloud", "cloud-upload", "code-xml", "coins", "cpu", "credit-card", "database",
    "download", "eraser", "file-input", "flame", "folder", "gauge", "gem", "gift", "github", "globe",
    "graduation-cap", "grid-3x3", "hammer", "hand", "heart", "history", "image", "images", "infinity", "key",
    "layers", "layers-2", "leaf", "library", "lightbulb", "link", "lock", "mail", "map-pin", "message-circle", "mic",
    "monitor", "moon", "mountain", "mouse-pointer-2", "music", "package", "palette", "pen-tool", "phone", "play",
    "puzzle", "quote", "rocket", "rotate-ccw", "scissors", "search", "server", "settings", "share-2", "shield-check",
    "shopping-cart", "smartphone", "sparkles", "spline", "squares-unite", "squircle", "star", "sticker", "store",
    "sun", "sun-moon", "tablet", "target", "terminal", "thumbs-up", "trophy", "truck", "type", "user-round-check",
    "users", "video", "wallet", "wand-sparkles", "wifi-off", "zap"
  ]
}

/// `CMS_LIMITS` for what the editor checks before it asks the server.
enum CmsLimits {
  static let entries = 1000
  static let name = 80
  static let slug = 200
  static let depth = 8
  static let blocksPerList = 100
  static let assets = 2000
  static let assetBytes = 20 * 1024 * 1024
  static let assetName = 120
  static let alt = 300

  /// `CMS_SLUG`: lowercase words and dashes, `/` between folders. `home` is the site's root.
  static let slugPattern = "^[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$"
  static let slugRule = String(localized: "Lowercase words and dashes, / between folders; home is the site's root")
  static func validSlug(_ slug: String) -> Bool {
    slug.utf16.count <= Self.slug && slug.range(of: slugPattern, options: .regularExpression) != nil
  }
}

/// What `normalizeBrief` keeps: text up to 2000 characters (tone and call to action 300), at most six key messages of 300.
enum CmsBriefLimits {
  static let text = 2000
  static let short = 300
  static let pillars = 6
}

/// `validPreviewUrl`: empty, or an http(s) URL once `{slug}` is filled in.
func cmsValidPreviewURL(_ value: String) -> Bool {
  if value.isEmpty { return true }
  guard value.utf16.count <= 500, let url = URL(string: value.replacingOccurrences(of: "{slug}", with: "home")), let scheme = url.scheme?.lowercased(), url.host() != nil else { return false }
  return scheme == "http" || scheme == "https"
}

// MARK: - Animation

/// A block's `_anim` (`CmsAnimation`). The server keeps every key, so a stored one decodes whole.
struct CmsAnimation: Codable, Equatable, Sendable {
  var effect = "fade-up"
  var trigger = "in-view"
  var duration = 600
  var delay = 0
  var easing = "ease-out"
  var stagger = 0
  var once = true
  var distance = 32

  /// `CMS_ANIM_EFFECTS` with the web editor's labels.
  static let effects: [(id: String, label: String)] = [
    ("fade", "Fade"), ("fade-up", "Fade up"), ("fade-down", "Fade down"), ("fade-left", "Slide in from the right"),
    ("fade-right", "Slide in from the left"), ("zoom-in", "Zoom in"), ("zoom-out", "Zoom out"), ("blur", "Unblur"), ("parallax", "Parallax")
  ]
  /// `CMS_ANIM_TRIGGERS`.
  static let triggers: [(id: String, label: String)] = [("in-view", "Scrolls into view"), ("load", "Page loads"), ("scroll", "Follows the scroll")]
  /// `CMS_ANIM_EASINGS`.
  static let easings: [(id: String, label: String)] = [("ease-out", "Ease out"), ("ease-in-out", "Ease in and out"), ("linear", "Linear"), ("spring", "Spring")]

  init() {}

  init?(_ value: JSONValue?) {
    guard case .object(let object)? = value, let data = try? JSONEncoder().encode(object) else { return nil }
    guard let animation = try? JSONDecoder().decode(CmsAnimation.self, from: data) else { return nil }
    self = animation
  }

  var json: JSONValue {
    guard let data = try? JSONEncoder().encode(self), let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .null }
    return value
  }
}

// MARK: - Entries

/// A page's look (`CmsStyle`); '' for the accent or a font means the project's accent or the system font.
struct CmsStyle: Codable, Equatable, Sendable {
  var accent = ""
  var mode = "light"
  var radius = "soft"
  var headingFont = ""
  var bodyFont = ""
  var width = "normal"
}

/// `serializeCmsEntry`. A list leaves out `content` and `style`; reading one has them.
struct CmsEntry: Decodable, Identifiable, Equatable, Sendable {
  let id: String
  var name: String
  var slug: String
  let type: String
  /// draft or published.
  let status: String
  let version: Int
  /// The working copy differs from what visitors get.
  let changed: Bool
  /// Where the page is hosted, relative to the server: `/p/<pk>/<slug>`.
  let path: String
  let publishedAt: String?
  let updatedAt: String?
  var content: CmsBlock?
  var style: CmsStyle?

  var isPublished: Bool { status == "published" }
  /// Draft, or the version visitors get.
  var statusLabel: String { isPublished ? String(localized: "Published v\(version)") : String(localized: "Draft") }
  /// `/` for the site's root, else `/slug`.
  var displayPath: String { slug == "home" ? "/" : "/\(slug)" }
}

struct CmsEntryResponse: Decodable, Sendable {
  let entry: CmsEntry
  var issues: [String] = []

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    entry = try c.decode(CmsEntry.self, forKey: .entry)
    issues = try c.decodeIfPresent([String].self, forKey: .issues) ?? []
  }
  private enum CodingKeys: String, CodingKey { case entry, issues }
}

/// A starting point for a new page (`GET /v1/admin/cms/templates`, without its content).
struct CmsTemplate: Decodable, Identifiable, Equatable, Sendable {
  let id, name, description: String
}

// MARK: - Components

/// One field of a component (`CmsField`).
struct CmsField: Decodable, Identifiable, Equatable, Sendable {
  let key: String
  let label: String
  let type: String
  let `default`: JSONValue?
  let required: Bool?
  /// `select`: the choices; `icon`: the icons offered (empty offers all).
  let options: [String]?
  /// `blocks`: the component keys allowed in it (empty allows every nestable one).
  let allow: [String]?
  let description: String?

  var id: String { key }
  var kind: CmsFieldKind { CmsFieldKind(rawValue: type) ?? .text }
}

/// A built-in or project component (`CmsComponentDef`), without its HTML and CSS.
struct CmsComponent: Decodable, Identifiable, Equatable, Sendable {
  let id, key, name, description: String
  /// An entry type: entries are made of it.
  let root: Bool
  /// Goes inside another component's `blocks` field.
  let nestable: Bool
  let fields: [CmsField]
  let builtin: Bool?
  /// Built-ins: the values (and child blocks) a new one starts with.
  let example: [String: JSONValue]?

  var isBuiltin: Bool { builtin == true }
  var blocksFields: [CmsField] { fields.filter { $0.kind == .blocks } }
}

struct CmsLibrary: Equatable, Sendable {
  let components: [CmsComponent]
  private let byKey: [String: CmsComponent]

  init(_ components: [CmsComponent] = []) {
    self.components = components
    byKey = Dictionary(components.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
  }

  subscript(key: String) -> CmsComponent? { byKey[key] }
  /// The entry types: what a new page can be.
  var roots: [CmsComponent] { components.filter(\.root) }
  /// What a blocks field takes (`allow`, else every nestable component).
  func choices(for field: CmsField) -> [CmsComponent] {
    components.filter { $0.nestable && (field.allow?.isEmpty != false || field.allow?.contains($0.key) == true) }
  }
}

// MARK: - Blocks

/// A node of a page's content tree: `{ _uid, component, ...values }` with `_anim` and,
/// in a `blocks` field, more blocks (shared/cms/content.ts `CmsBlock`).
struct CmsBlock: Codable, Equatable, Sendable, Identifiable {
  var values: [String: JSONValue]

  init(_ values: [String: JSONValue]) { self.values = values }
  init(from decoder: Decoder) throws { values = try decoder.singleValueContainer().decode([String: JSONValue].self) }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    try c.encode(values)
  }

  var id: String { uid }
  var uid: String { text("_uid") }
  var component: String { text("component") }
  var animation: CmsAnimation? { CmsAnimation(values["_anim"]) }

  func text(_ key: String) -> String {
    if case .string(let value)? = values[key] { return value }
    return ""
  }

  /// The blocks in a `blocks` field.
  func children(_ field: String) -> [CmsBlock] {
    guard case .array(let list)? = values[field] else { return [] }
    return list.compactMap { if case .object(let object) = $0 { CmsBlock(object) } else { nil } }
  }

  mutating func setChildren(_ field: String, _ list: [CmsBlock]) {
    values[field] = .array(list.map { .object($0.values) })
  }

  /// The blocks fields of this block: wherever children can be.
  func childFields(_ library: CmsLibrary) -> [CmsField] { library[component]?.blocksFields ?? [] }

  /// A line to tell blocks of one component apart in the outline (the web's layers use the same keys).
  var title: String {
    for key in ["headline", "title", "name", "label", "question", "value", "brand", "text", "code"] {
      let value = text(key).trimmingCharacters(in: .whitespacesAndNewlines)
      if !value.isEmpty { return String(value.filter { !"*_#`".contains($0) }.prefix(48)) }
    }
    return ""
  }

  static func newUID() -> String { String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(12)) }

  /// A new block of a component: its defaults and, for built-ins, their example values and children (`newBlock`).
  static func new(_ component: CmsComponent) -> CmsBlock {
    var values: [String: JSONValue] = [:]
    for field in component.fields {
      if field.kind == .blocks { values[field.key] = .array([]) } else if let value = field.default { values[field.key] = value }
    }
    for (key, value) in component.example ?? [:] { values[key] = value }
    values["_uid"] = .string(newUID())
    values["component"] = .string(component.key)
    return CmsBlock(values).reuid(keepingRoot: true)
  }

  /// Fresh `_uid`s through the whole subtree (a duplicate, an example); `keepingRoot` leaves this block's own.
  func reuid(keepingRoot: Bool = false) -> CmsBlock {
    var copy = CmsBlock(values.mapValues { Self.reuid($0) })
    if !keepingRoot { copy.values["_uid"] = .string(Self.newUID()) }
    return copy
  }

  private static func reuid(_ value: JSONValue) -> JSONValue {
    switch value {
    case .array(let list): return .array(list.map(reuid))
    case .object(let object):
      var out = object.mapValues(reuid)
      if case .string? = object["component"] { out["_uid"] = .string(newUID()) }
      return .object(out)
    default: return value
    }
  }

  // MARK: The tree

  /// The block with this `_uid`, anywhere under this one.
  func find(_ id: String, _ library: CmsLibrary) -> CmsBlock? {
    if uid == id { return self }
    for field in childFields(library) {
      for child in children(field.key) { if let found = child.find(id, library) { return found } }
    }
    return nil
  }

  /// Where a block sits: its parent's `_uid`, the blocks field and the index in it.
  struct Slot: Equatable, Sendable {
    let parent: String
    let field: String
    let index: Int
    let count: Int
  }

  func slot(of id: String, _ library: CmsLibrary) -> Slot? {
    for field in childFields(library) {
      let list = children(field.key)
      if let index = list.firstIndex(where: { $0.uid == id }) { return Slot(parent: uid, field: field.key, index: index, count: list.count) }
      for child in list { if let found = child.slot(of: id, library) { return found } }
    }
    return nil
  }

  /// Every block in the tree with its depth, parents before children.
  func outline(_ library: CmsLibrary, depth: Int = 0) -> [(block: CmsBlock, depth: Int)] {
    [(self, depth)] + childFields(library).flatMap { field in children(field.key).flatMap { $0.outline(library, depth: depth + 1) } }
  }

  /// Runs `change` on the block with this `_uid`, wherever it is. False when there is none.
  @discardableResult
  mutating func edit(_ id: String, _ library: CmsLibrary, _ change: (inout CmsBlock) -> Void) -> Bool {
    if uid == id {
      change(&self)
      return true
    }
    for field in childFields(library) {
      var list = children(field.key)
      for index in list.indices {
        if list[index].edit(id, library, change) {
          setChildren(field.key, list)
          return true
        }
      }
    }
    return false
  }

  /// Why `child` cannot go in `parent`'s `field`, or nil when it can (`placeable`).
  static func whyNotPlaceable(_ parent: CmsBlock, field: String, child: CmsComponent, _ library: CmsLibrary) -> String? {
    guard let parentDef = library[parent.component], let target = parentDef.fields.first(where: { $0.key == field && $0.kind == .blocks }) else {
      return String(localized: "That block has no blocks field “\(field)”")
    }
    if !child.nestable { return String(localized: "“\(child.name)” is an entry type and cannot go inside a block") }
    if let allow = target.allow, !allow.isEmpty, !allow.contains(child.key) { return String(localized: "\(parentDef.name) takes only \(allow.joined(separator: ", "))") }
    return nil
  }

  /// How deep a block sits (the root is 0).
  func depth(of id: String, _ library: CmsLibrary) -> Int? {
    outline(library).first { $0.block.uid == id }?.depth
  }

  /// Adds `block` to a parent's blocks field (at the end, or `index`), checking what the field takes.
  mutating func add(_ block: CmsBlock, to parentId: String, field: String, at index: Int? = nil, _ library: CmsLibrary) -> String? {
    guard let component = library[block.component] else { return String(localized: "There is no component “\(block.component)”") }
    guard let parent = find(parentId, library) else { return String(localized: "No block with _uid \(parentId)") }
    if let why = Self.whyNotPlaceable(parent, field: field, child: component, library) { return why }
    if parent.children(field).count >= CmsLimits.blocksPerList { return String(localized: "A list holds at most \(CmsLimits.blocksPerList) blocks") }
    if (depth(of: parentId, library) ?? 0) >= CmsLimits.depth { return String(localized: "Blocks nest at most \(CmsLimits.depth) levels deep") }
    edit(parentId, library) { parent in
      var list = parent.children(field)
      list.insert(block, at: min(max(index ?? list.count, 0), list.count))
      parent.setChildren(field, list)
    }
    return nil
  }

  /// Removes a block (never the root).
  mutating func remove(_ id: String, _ library: CmsLibrary) {
    guard let slot = slot(of: id, library) else { return }
    edit(slot.parent, library) { parent in
      var list = parent.children(slot.field)
      list.remove(at: slot.index)
      parent.setChildren(slot.field, list)
    }
  }

  /// Moves a block `offset` places within its own list.
  mutating func move(_ id: String, by offset: Int, _ library: CmsLibrary) {
    guard let slot = slot(of: id, library), (0..<slot.count).contains(slot.index + offset) else { return }
    edit(slot.parent, library) { parent in
      var list = parent.children(slot.field)
      list.swapAt(slot.index, slot.index + offset)
      parent.setChildren(slot.field, list)
    }
  }

  /// Moves a block to the end of another blocks list; why not, or nil when it moved.
  mutating func moveToList(_ id: String, parent parentId: String, field: String, _ library: CmsLibrary) -> String? {
    guard let block = find(id, library) else { return String(localized: "No block with _uid \(id)") }
    if block.find(parentId, library) != nil { return String(localized: "A block cannot go inside itself") }
    var moved = self
    moved.remove(id, library)
    if let why = moved.add(block, to: parentId, field: field, library) { return why }
    self = moved
    return nil
  }

  /// The lists a block could move to: every blocks field of another block that takes it.
  func moveTargets(for id: String, _ library: CmsLibrary) -> [(parent: CmsBlock, field: CmsField)] {
    guard let block = find(id, library), let component = library[block.component], let home = slot(of: id, library) else { return [] }
    let inside = Set(block.outline(library).map(\.block.uid))
    return outline(library).flatMap { entry -> [(parent: CmsBlock, field: CmsField)] in
      guard !inside.contains(entry.block.uid) else { return [] }
      return entry.block.childFields(library).filter { field in
        !(entry.block.uid == home.parent && field.key == home.field) && Self.whyNotPlaceable(entry.block, field: field.key, child: component, library) == nil
      }.map { (entry.block, $0) }
    }
  }

  /// Puts a copy of a block (and its children, with new `_uid`s) right after it. Returns the copy's `_uid`.
  mutating func duplicate(_ id: String, _ library: CmsLibrary) -> String? {
    guard let slot = slot(of: id, library), let original = find(id, library) else { return nil }
    let copy = original.reuid()
    return add(copy, to: slot.parent, field: slot.field, at: slot.index + 1, library) == nil ? copy.uid : nil
  }
}

// MARK: - Files

/// `serializeCmsAsset`.
struct CmsAsset: Codable, Identifiable, Equatable, Sendable {
  let id: String
  var name: String
  var alt: String
  let url: String
  let mime: String
  let size: Int
  let width: Int?
  let height: Int?
  let createdAt: String?

  var isImage: Bool { mime.hasPrefix("image/") }
  var isVideo: Bool { mime.hasPrefix("video/") }
  /// "PDF", "SVG", "MP4"…
  var typeLabel: String {
    switch mime {
    case "image/svg+xml": "SVG"
    case "image/x-icon": "ICO"
    case "application/pdf": "PDF"
    default: mime.split(separator: "/").last.map { $0.uppercased() } ?? String(localized: "File")
    }
  }
  /// "240 KB · 512×512".
  var detail: String {
    let bytes = Int64(size).formatted(.byteCount(style: .file))
    guard let width, let height else { return bytes }
    return "\(bytes) · \(width)×\(height)"
  }
  /// What an asset field stores: `{ id, url, alt, mime, width, height }`.
  var reference: JSONValue {
    var object: [String: JSONValue] = ["id": .string(id), "url": .string(url), "alt": .string(alt), "mime": .string(mime)]
    if let width, let height { object["width"] = .number(Double(width)); object["height"] = .number(Double(height)) }
    return .object(object)
  }
}

struct CmsAssetResponse: Decodable, Sendable { let asset: CmsAsset }

// MARK: - Settings

/// `CmsBrief`: who the pages are for and what they say.
struct CmsBrief: Codable, Equatable, Sendable {
  var audience = ""
  var problem = ""
  var valueProposition = ""
  /// The three to five messages every page should land.
  var pillars: [String] = []
  var proof = ""
  var tone = ""
  var callToAction = ""
}

/// `CmsSettings`.
struct CmsSettings: Codable, Equatable, Sendable {
  /// The developer's own site for the web editor's "Your site" preview; `{slug}` becomes the entry's slug.
  var previewUrl = ""
  var brief = CmsBrief()
}
