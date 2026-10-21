import Foundation

// The shapes of /v1/admin/lead-forms and /v1/admin/lead-files (shared/leadForms.ts, server/utils/leadForms.ts).

/// `LEAD_FORM_LIMITS`, `LEAD_FORM_KEY`, `LEAD_FIELD_TYPES`, `LEAD_FILE_KINDS`, `LEAD_FORM_FONTS`, `LEAD_FORM_LAYOUTS`,
/// `LEAD_FORM_PRESETS` and `RESERVED_FIELD_KEYS` from shared/leadForms.ts, ported by hand
/// (tests/leadFormsNativeParity.test.ts).
enum LeadFormLimits {
  static let forms = 50
  static let fields = 12
  static let options = 20
  static let name = 80
  static let label = 80
  static let placeholder = 80
  static let option = 60
  static let title = 120
  static let description = 400
  static let button = 40
  static let message = 300
  static let tags = 10
  static let text = 200
  static let textarea = 500
  static let radius = 32
  /// File fields per form, and the largest file one may take (MB).
  static let files = 3
  static let fileMB = 20
  /// A form's key: lowercase letters, digits and dashes.
  static let key = "^[a-z0-9][a-z0-9-]{0,39}$"
  /// An attribute key (`ATTRIBUTE_KEY_RE` in shared/contacts.ts): where a field's answer is saved.
  static let fieldKeyPattern = "^[A-Za-z][A-Za-z0-9_]{0,39}$"
  static let reservedKeys = ["email", "name", "website", "pk", "form", "project", "externalId", "tags", "subscription"]
  static let fieldTypes: [(id: String, label: String, systemImage: String)] = [
    ("email", "Email", "at"), ("name", "Name", "person"), ("text", "Short text", "textformat"), ("textarea", "Long text", "text.alignleft"),
    ("number", "Number", "number"), ("url", "Website", "link"), ("phone", "Phone", "phone"), ("select", "Choice", "list.bullet"), ("checkbox", "Checkbox", "checkmark.square"),
    ("file", "File upload", "paperclip")
  ]
  /// What a file field takes; the server checks each file's bytes.
  static let fileKinds: [(id: String, label: String, hint: String)] = [
    ("images", "Pictures", "PNG, JPEG, GIF or WebP."),
    ("documents", "Documents", "PDF, Word, Excel, PowerPoint, OpenDocument, RTF, text, CSV or Markdown."),
    ("any", "Any of these", "Pictures, documents or a ZIP archive.")
  ]
  static let fonts: [(id: String, label: String)] = [("system", "System"), ("rounded", "Rounded"), ("serif", "Serif"), ("mono", "Mono")]
  static let layouts: [(id: String, label: String)] = [("stacked", "Stacked"), ("inline", "One row")]
  static let presets: [(id: String, label: String, hint: String)] = [
    ("email", "Email only", "One email box and a button, on one row."),
    ("waitlist", "Waitlist", "Email and name."),
    ("detailed", "Interest form", "Email, name, company, role and a question.")
  ]

  static func validKey(_ value: String) -> Bool { value.range(of: key, options: .regularExpression) != nil }
  static func validFieldKey(_ value: String) -> Bool { value.range(of: fieldKeyPattern, options: .regularExpression) != nil && !reservedKeys.contains(value) }
  static let keyRule = "The key is 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit."
  static func typeLabel(_ type: String) -> String { fieldTypes.first { $0.id == type }?.label ?? type }
  static func typeImage(_ type: String) -> String { fieldTypes.first { $0.id == type }?.systemImage ?? "textformat" }

  /// An attribute key from a label (`fieldKeyFrom`): "Company size" → "company_size".
  static func fieldKey(from label: String) -> String {
    let folded = label.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .init(identifier: "en")).lowercased()
    var key = folded.replacingOccurrences(of: "[^a-z0-9]+", with: "_", options: .regularExpression)
      .replacingOccurrences(of: "^_+|_+$", with: "", options: .regularExpression)
    if key.first.map({ !$0.isLetter }) ?? true { key = "f_" + key }
    key = String(key.prefix(40)).replacingOccurrences(of: "_+$", with: "", options: .regularExpression)
    return reservedKeys.contains(key) ? key + "_answer" : key
  }
}

struct LeadFormField: Codable, Identifiable, Equatable, Sendable {
  var id: String
  /// Where the answer goes: `email` and `name` are the contact's own; anything else is an attribute.
  var key: String
  var type: String
  var label: String
  var placeholder = ""
  var required = false
  /// `select` only.
  var options: [String] = []
  /// `file` only ('' and 0 otherwise): images, documents or any; the largest file in MB.
  var accept = ""
  var maxMB = 0

  /// A field a translation or a site has nothing to put in the placeholder of.
  var hasPlaceholder: Bool { !["checkbox", "select", "file"].contains(type) }

  /// A new field, its key made from its label (the server keeps ids that match `/^[\w-]{1,40}$/`).
  static func new(_ type: String, taken: [String]) -> LeadFormField {
    let label = LeadFormLimits.typeLabel(type)
    var key = type == "name" ? "name" : LeadFormLimits.fieldKey(from: label)
    var n = 2
    while taken.contains(key) { key = "\(LeadFormLimits.fieldKey(from: label).prefix(36))_\(n)"; n += 1 }
    return LeadFormField(id: "fd_" + UUID().uuidString.prefix(13).lowercased(), key: key, type: type, label: label, options: type == "select" ? ["Option A", "Option B"] : [], accept: type == "file" ? "any" : "", maxMB: type == "file" ? 10 : 0)
  }
}

struct LeadFormContent: Codable, Equatable, Sendable {
  var title, description, buttonLabel, successTitle, successMessage, confirmMessage, footnote: String

  /// The words a translation can replace, in the editor's order, with their limits.
  static let keys: [(name: String, label: String, limit: Int)] = [
    ("title", "Title", LeadFormLimits.title), ("description", "Description", LeadFormLimits.description),
    ("buttonLabel", "Button", LeadFormLimits.button), ("successTitle", "After signing up", LeadFormLimits.title),
    ("successMessage", "Thank-you message", LeadFormLimits.message), ("confirmMessage", "While they confirm", LeadFormLimits.message),
    ("footnote", "Small print", LeadFormLimits.message)
  ]

  /// One of `keys` by name.
  subscript(word name: String) -> String {
    get {
      switch name {
      case "title": title
      case "description": description
      case "buttonLabel": buttonLabel
      case "successTitle": successTitle
      case "successMessage": successMessage
      case "confirmMessage": confirmMessage
      case "footnote": footnote
      default: ""
      }
    }
    set {
      switch name {
      case "title": title = newValue
      case "description": description = newValue
      case "buttonLabel": buttonLabel = newValue
      case "successTitle": successTitle = newValue
      case "successMessage": successMessage = newValue
      case "confirmMessage": confirmMessage = newValue
      case "footnote": footnote = newValue
      default: break
      }
    }
  }
}

/// One language of a form (`LeadFormTranslation`): content words by name, and each field's by field id.
/// An empty word falls back to the form's own.
struct LeadFormTranslation: Codable, Equatable, Sendable {
  struct FieldText: Codable, Equatable, Sendable {
    var label = ""
    var placeholder = ""
    /// Line up with the field's options; '' keeps the original.
    var options: [String] = []

    /// `label` or `placeholder` by name.
    subscript(text name: String) -> String {
      get { name == "placeholder" ? placeholder : label }
      set { if name == "placeholder" { placeholder = newValue } else { label = newValue } }
    }

    init() {}
    init(from decoder: Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      label = (try c.decodeIfPresent(String.self, forKey: .label)) ?? ""
      placeholder = (try c.decodeIfPresent(String.self, forKey: .placeholder)) ?? ""
      options = (try c.decodeIfPresent([String].self, forKey: .options)) ?? []
    }
  }

  var content: [String: String] = [:]
  var fields: [String: FieldText] = [:]

  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    content = (try c.decodeIfPresent([String: String].self, forKey: .content)) ?? [:]
    fields = (try c.decodeIfPresent([String: FieldText].self, forKey: .fields)) ?? [:]
  }

  /// `leadFormTexts` against this language: how many of the form's words it has, of how many.
  func progress(content original: LeadFormContent, fields originals: [LeadFormField]) -> (filled: Int, total: Int) {
    var filled = 0, total = 0
    func count(_ original: String, _ word: String?) {
      guard !original.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
      total += 1
      if !(word ?? "").isEmpty { filled += 1 }
    }
    for item in LeadFormContent.keys { count(original[word: item.name], content[item.name]) }
    for field in originals {
      let words = fields[field.id]
      // A field without a label shows its default one, which needs a translation too.
      count(field.label.isEmpty ? LeadFormLimits.typeLabel(field.type) : field.label, words?.label)
      if field.hasPlaceholder { count(field.placeholder, words?.placeholder) }
      if field.type == "select" { for (i, option) in field.options.enumerated() { count(option, words?.options[safe: i]) } }
    }
    return (filled, total)
  }

  /// `localizeLeadForm`: the form's words in this language, each missing one in the original.
  func localized(content original: LeadFormContent, fields originals: [LeadFormField]) -> (content: LeadFormContent, fields: [LeadFormField]) {
    var out = original
    for item in LeadFormContent.keys { if let word = content[item.name], !word.isEmpty { out[word: item.name] = word } }
    return (out, originals.map { field in
      var f = field
      guard let words = fields[field.id] else { return f }
      if !words.label.isEmpty { f.label = words.label }
      if !words.placeholder.isEmpty { f.placeholder = words.placeholder }
      // The preview shows what options say; the values stay the originals on the server.
      f.options = field.options.enumerated().map { i, option in words.options[safe: i].flatMap { $0.isEmpty ? nil : $0 } ?? option }
      return f
    })
  }
}

struct LeadFormStyle: Codable, Equatable, Sendable {
  /// '#rrggbb', or '' for the project's accent.
  var accent: String
  /// '' sits on the host page (no card).
  var background: String
  /// '' follows light or dark.
  var text: String
  var radius: Int
  /// system, rounded, serif or mono.
  var font: String
  /// stacked, or inline: the inputs and the button on one row.
  var layout: String
}

struct LeadFormSettings: Codable, Equatable, Sendable {
  var doubleOptIn: Bool
  /// Template send keys (or ids); '' for HelpBites' own confirmation, or no welcome email.
  var confirmTemplate: String
  var welcomeTemplate: String
  /// A sequence id, or ''.
  var sequence: String
  var tags: [String]
  var redirectUrl: String
}

struct LeadFormStats: Codable, Equatable, Sendable { let leads, confirmed: Int }

struct LeadForm: Codable, Identifiable, Equatable, Sendable {
  let id, projectId, key, name: String
  let active: Bool
  let fields: [LeadFormField]
  let content: LeadFormContent
  let style: LeadFormStyle
  let settings: LeadFormSettings
  /// The language the form is written in, and its words in others.
  let locale: String
  let translations: [String: LeadFormTranslation]
  /// The segment made for this form's leads ('' once deleted).
  let segment: String
  let stats: LeadFormStats
  /// `/v1/forms/<pk>/<key>` and `/f/<pk>/<key>` on this server.
  let path, pagePath: String
  let createdAt, updatedAt: String?
}

/// What the editor changes and PATCH takes.
struct LeadFormDraft: Encodable, Equatable, Sendable {
  var name, key: String
  var active: Bool
  var fields: [LeadFormField]
  var content: LeadFormContent
  var style: LeadFormStyle
  var settings: LeadFormSettings
  var locale: String
  var translations: [String: LeadFormTranslation]
  /// The languages the saved form has: one the draft dropped is sent as null, since a PATCH only replaces the languages it names.
  private let savedLanguages: [String]

  init(_ form: LeadForm) {
    name = form.name; key = form.key; active = form.active; fields = form.fields
    content = form.content; style = form.style; settings = form.settings
    locale = form.locale; translations = form.translations; savedLanguages = form.translations.keys.sorted()
  }

  enum CodingKeys: String, CodingKey { case name, key, active, fields, content, style, settings, locale, translations }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(name, forKey: .name)
    try c.encode(key, forKey: .key)
    try c.encode(active, forKey: .active)
    try c.encode(fields, forKey: .fields)
    try c.encode(content, forKey: .content)
    try c.encode(style, forKey: .style)
    try c.encode(settings, forKey: .settings)
    try c.encode(locale, forKey: .locale)
    // The form's own language cannot also be a translation.
    var next: [String: LeadFormTranslation?] = translations.filter { !ContentLocale.same($0.key, locale) }
    for tag in savedLanguages where next[tag] == nil { next[tag] = .some(nil) }
    try c.encode(next, forKey: .translations)
  }
}

/// A file someone sent through a file field (`LeadFile`); downloaded from /v1/admin/lead-files/{id}/download.
struct LeadFile: Decodable, Identifiable, Equatable, Sendable {
  let id, formId, contactId, field, name, mime: String
  let size: Int
  let createdAt: String?

  var isImage: Bool { mime.hasPrefix("image/") }
  var sizeText: String { ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file) }
}

struct LeadFilesResponse: Decodable, Sendable { let files: [LeadFile] }

struct LeadFormResponse: Decodable, Sendable { let form: LeadForm }
struct LeadFormsResponse: Decodable, Sendable { let forms: [LeadForm] }

private extension Array {
  subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
