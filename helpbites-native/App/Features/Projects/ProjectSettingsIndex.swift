import Foundation

/// How a project's settings are grouped on their first page, as Apple's Settings groups its pages.
enum ProjectSettingsGroup: String, CaseIterable, Identifiable {
  case project, people, publishing, advanced
  var id: String { rawValue }
  /// A plain literal: the string catalog looks it up where it is shown.
  var title: String {
    switch self {
    case .project: "Project"
    case .people: "Chat and people"
    case .publishing: "Publishing and code"
    case .advanced: "Advanced"
    }
  }
}

/// The pages of a project's settings: a list of them, each opening its own screen. `keys` is the odd one out:
/// it has no screen here, it opens the project's Install & API section.
enum ProjectSettingsPage: String, CaseIterable, Identifiable, Hashable {
  case general, branding, company, sidebar, widget, notifications, collaborators, hub, domains, repos, data, keys
  var id: String { rawValue }

  /// Plain literals (the catalog looks them up where they are shown); `localizedTitle` is for text built in code.
  var title: String {
    switch self {
    case .general: "General"
    case .branding: "Branding"
    case .company: "Company"
    case .sidebar: "Sidebar"
    case .widget: "Chat widget"
    case .notifications: "Notifications"
    case .collaborators: "Collaborators"
    case .hub: "Public hub"
    case .domains: "Custom domains"
    case .repos: "GitHub repos"
    case .data: "Data"
    case .keys: "Keys and webhooks"
    }
  }

  var localizedTitle: String { String(localized: String.LocalizationValue(title)) }

  var systemImage: String {
    switch self {
    case .general: "slider.horizontal.3"
    case .branding: "paintpalette"
    case .company: "building.2"
    case .sidebar: "sidebar.left"
    case .widget: "bubble.left.and.bubble.right"
    case .notifications: "bell"
    case .collaborators: "person.2"
    case .hub: "globe"
    case .domains: "network"
    case .repos: "arrow.triangle.branch"
    case .data: "externaldrive"
    case .keys: "key"
    }
  }

  /// The colour of its icon tile.
  var tintHex: String {
    switch self {
    case .general: "#6b7280"
    case .branding: "#db2777"
    case .company: "#0369a1"
    case .sidebar: "#0f766e"
    case .widget: "#5e6ad2"
    case .notifications: "#dc2626"
    case .collaborators: "#0e7490"
    case .hub: "#7c3aed"
    case .domains: "#2563eb"
    case .repos: "#374151"
    case .data: "#b45309"
    case .keys: "#4d7c0f"
    }
  }

  var group: ProjectSettingsGroup {
    switch self {
    case .general, .branding, .company, .sidebar: .project
    case .widget, .notifications, .collaborators: .people
    case .hub, .domains, .repos: .publishing
    case .data, .keys: .advanced
    }
  }
}

/// One thing a person may look for in the settings. It opens `page`, scrolled to the setting `id` names.
struct ProjectSettingsEntry: Identifiable, Hashable {
  let id: String
  let page: ProjectSettingsPage
  /// What the setting is called on the screen, in the person's language.
  let title: String
  /// Other words for it, in English.
  let keywords: String
}

enum ProjectSettingsIndex {
  /// Every setting worth finding by name, in the order of the pages. Data is for admins only.
  static func entries(canManage: Bool) -> [ProjectSettingsEntry] {
    func entry(_ id: String, _ page: ProjectSettingsPage, _ title: String, _ keywords: String) -> ProjectSettingsEntry {
      ProjectSettingsEntry(id: id, page: page, title: title, keywords: keywords)
    }
    var list = [
      entry("general.name", .general, String(localized: "Name"), "project called rename"),
      entry("general.site", .general, String(localized: "Site URL"), "website domain link email address"),
      entry("general.inbox", .general, String(localized: "Inbox path"), "widget path lives where"),
      entry("branding.logo", .branding, String(localized: "Logo"), "icon image upload tile picture"),
      entry("branding.colour", .branding, String(localized: "Colour"), "color accent theme swatch hex brand"),
      entry("branding.images", .branding, String(localized: "Widget images"), "brand logo assistant avatar picture"),
      entry("branding.preview", .branding, String(localized: "Widget preview"), "chat look appearance"),
      entry("company", .company, String(localized: "Company"), "legal name address postal phone email website dpo data protection officer operator imprint"),
      entry("sidebar", .sidebar, String(localized: "Sidebar"), "hide show sections menu navigation " + ProjectSection.allCases.map(\.label).joined(separator: " ")),
      entry("widget.notice", .widget, String(localized: "Chat notice"), "banner message text top of chat"),
      entry("widget.attachments", .widget, String(localized: "Users can attach images"), "attachments images files uploads photos"),
      entry("widget.anonymous", .widget, String(localized: "Allow email-only users (no sign-in)"), "anonymous guest login account email address code"),
      entry("widget.guests", .widget, String(localized: "Guest access (no account, no email)"), "guests visitors chat feedback comments sign in"),
      entry("widget.types", .widget, String(localized: "Let users choose a request type when starting a chat"), "ticket types other option category"),
      entry("notifications.emails", .notifications, String(localized: "Notify when a user writes"), "email addresses alerts notify new chats messages"),
      entry("collaborators", .collaborators, String(localized: "Collaborators"), "team people members agents who answers"),
      entry("hub", .hub, String(localized: "Public hub"), "page home tab title tagline sections links public"),
      entry("domains", .domains, String(localized: "Custom domains"), "domain dns cname host feedback.example.com"),
      entry("repos", .repos, String(localized: "GitHub repos"), "github code repository repositories repo")
    ]
    if canManage { list.append(entry("data", .data, String(localized: "Data"), "export import download transfer move backup")) }
    list.append(entry("keys", .keys, String(localized: "Keys and webhooks"), "api key keys webhook webhooks install snippet mcp developer"))
    return list
  }

  /// The entries every word of `query` finds, in the page's title, the entry's title or its keywords.
  static func search(_ query: String, canManage: Bool) -> [ProjectSettingsEntry] {
    let words = query.split(whereSeparator: \.isWhitespace).map(String.init)
    guard !words.isEmpty else { return [] }
    return entries(canManage: canManage).filter { entry in
      let haystack = [entry.title, entry.page.localizedTitle, entry.keywords].joined(separator: " ")
      return words.allSatisfy { haystack.localizedStandardContains($0) }
    }
  }
}
