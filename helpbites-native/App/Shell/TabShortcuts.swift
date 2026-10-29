import Foundation

/// A shortcut for the tab bar (iPhone, and the top of the iPad sidebar). Which ones show, and in what order,
/// is the user's choice (Settings › Tab bar) and stays on this device.
enum TabShortcut: String, CaseIterable, Identifiable, Sendable {
  case overview, inbox, projects, planning, knowledge, templates, settings

  var id: String { rawValue }

  /// What a fresh install shows.
  static let defaults: [TabShortcut] = [.overview, .inbox, .projects, .templates, .settings]
  /// What the bar holds: five fit an iPhone's tab bar without a More tab.
  static let limit = 5

  var label: String {
    switch self {
    case .overview: "Overview"
    case .inbox: "Inbox"
    case .projects: "Projects"
    case .planning: "Planning"
    case .knowledge: "Knowledge"
    case .templates: "Templates"
    case .settings: "Settings"
    }
  }

  /// Its label looked up in the string catalog.
  var localizedLabel: String { String(localized: String.LocalizationValue(label)) }

  var systemImage: String {
    switch self {
    case .overview: "house"
    case .inbox: "tray"
    case .projects: "square.stack"
    case .planning: "rectangle.split.3x1"
    case .knowledge: "book"
    case .templates: "envelope"
    case .settings: "gearshape"
    }
  }

  var tab: AppTab {
    switch self {
    case .overview: .overview
    case .inbox: .inbox
    case .projects: .projects
    case .planning: .planning
    case .knowledge: .knowledge
    case .templates: .templates
    case .settings: .settings
    }
  }

  /// Settings stays on the bar: it is where the bar is edited.
  var isRequired: Bool { self == .settings }

  private static let key = "helpbites.tabs"

  /// The saved bar, or the default one. A name this build does not know (from a newer one) is dropped.
  static func saved() -> [TabShortcut] {
    guard let names = UserDefaults.standard.stringArray(forKey: key) else { return defaults }
    return normalized(names.compactMap(TabShortcut.init(rawValue:)))
  }

  static func save(_ list: [TabShortcut]) { UserDefaults.standard.set(list.map(\.rawValue), forKey: key) }

  static func forget() { UserDefaults.standard.removeObject(forKey: key) }

  /// No repeats, no more than `limit`, and Settings always there (in the last place when it was missing).
  static func normalized(_ list: [TabShortcut]) -> [TabShortcut] {
    var seen = Set<TabShortcut>()
    var result = list.filter { seen.insert($0).inserted }
    if !result.contains(.settings) { result = Array(result.prefix(limit - 1)) + [.settings] }
    while result.count > limit, let index = result.lastIndex(where: { !$0.isRequired }) { result.remove(at: index) }
    return result
  }
}
