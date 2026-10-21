import Foundation

// The shapes of /v1/admin/lead-forms (shared/leadForms.ts, server/utils/leadForms.ts).

/// `LEAD_FORM_LIMITS`, `LEAD_FORM_KEY`, `LEAD_FIELD_TYPES`, `LEAD_FORM_FONTS`, `LEAD_FORM_LAYOUTS`,
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
  /// A form's key: lowercase letters, digits and dashes.
  static let key = "^[a-z0-9][a-z0-9-]{0,39}$"
  /// An attribute key (`ATTRIBUTE_KEY_RE` in shared/contacts.ts): where a field's answer is saved.
  static let fieldKeyPattern = "^[A-Za-z][A-Za-z0-9_]{0,39}$"
  static let reservedKeys = ["email", "name", "website", "pk", "form", "project", "externalId", "tags", "subscription"]
  static let fieldTypes: [(id: String, label: String, systemImage: String)] = [
    ("email", "Email", "at"), ("name", "Name", "person"), ("text", "Short text", "textformat"), ("textarea", "Long text", "text.alignleft"),
    ("number", "Number", "number"), ("url", "Website", "link"), ("phone", "Phone", "phone"), ("select", "Choice", "list.bullet"), ("checkbox", "Checkbox", "checkmark.square")
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

  /// A new field, its key made from its label (the server keeps ids that match `/^[\w-]{1,40}$/`).
  static func new(_ type: String, taken: [String]) -> LeadFormField {
    let label = LeadFormLimits.typeLabel(type)
    var key = type == "name" ? "name" : LeadFormLimits.fieldKey(from: label)
    var n = 2
    while taken.contains(key) { key = "\(LeadFormLimits.fieldKey(from: label).prefix(36))_\(n)"; n += 1 }
    return LeadFormField(id: "fd_" + UUID().uuidString.prefix(13).lowercased(), key: key, type: type, label: label, options: type == "select" ? ["Option A", "Option B"] : [])
  }
}

struct LeadFormContent: Codable, Equatable, Sendable {
  var title, description, buttonLabel, successTitle, successMessage, confirmMessage, footnote: String
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
  /// The segment made for this form's leads ('' once deleted).
  let segment: String
  let stats: LeadFormStats
  /// `/v1/forms/<pk>/<key>` and `/f/<pk>/<key>` on this server.
  let path, pagePath: String
  let createdAt, updatedAt: String?
}

/// What the editor changes and PATCH takes.
struct LeadFormDraft: Codable, Equatable, Sendable {
  var name, key: String
  var active: Bool
  var fields: [LeadFormField]
  var content: LeadFormContent
  var style: LeadFormStyle
  var settings: LeadFormSettings

  init(_ form: LeadForm) {
    name = form.name; key = form.key; active = form.active; fields = form.fields
    content = form.content; style = form.style; settings = form.settings
  }
}

struct LeadFormResponse: Decodable, Sendable { let form: LeadForm }
struct LeadFormsResponse: Decodable, Sendable { let forms: [LeadForm] }
