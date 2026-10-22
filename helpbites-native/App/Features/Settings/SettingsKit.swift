import SwiftUI

// Small pieces the settings screens share: roles (shared/roles.ts), a menu
// picker in the field frame, a quiet "saved" line.

/// What a member of a workspace may do (shared/roles.ts): agents answer the
/// inbox, admins run the workspace, owners also bill, delete and manage owners.
enum TeamRole: String, CaseIterable, Identifiable, Sendable {
  case owner, admin, agent
  var id: String { rawValue }
  var label: String {
    switch self {
    case .owner: String(localized: "Owner")
    case .admin: String(localized: "Admin")
    case .agent: String(localized: "Agent")
    }
  }
  var rank: Int { self == .owner ? 3 : self == .admin ? 2 : 1 }
  init(_ raw: String?) { self = TeamRole(rawValue: raw ?? "") ?? .agent }
  /// A member may hand out at most their own role, and only owners make owners.
  func canGrant(_ role: TeamRole) -> Bool { role == .owner ? self == .owner : rank >= role.rank && rank >= TeamRole.admin.rank }
}

extension SessionStore {
  var teamRole: TeamRole { TeamRole(role) }
  var isOwner: Bool { teamRole == .owner }
}

struct PickerOption<Value: Hashable>: Hashable {
  let value: Value
  let label: String
}

/// A menu picker in the same frame as `.linear` text fields.
struct MenuPicker<Value: Hashable>: View {
  @Binding var selection: Value
  let options: [PickerOption<Value>]
  var title = ""
  var body: some View {
    Picker(LocalizedStringKey(title), selection: $selection) {
      ForEach(options, id: \.self) { option in Text(LocalizedStringKey(option.label)).tag(option.value) }
    }
    .labelsHidden()
    .pickerStyle(.menu)
    .tint(Theme.text)
    .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
    .padding(.horizontal, 4)
    .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }
}

/// Green confirmation line ("Saved").
struct SuccessText: View {
  let message: String
  var body: some View {
    if !message.isEmpty { Label(message, systemImage: "checkmark.circle").font(.lnMeta).foregroundStyle(Theme.success) }
  }
}

/// A bordered block with a title and optional trailing control, for settings sections.
struct SettingsSection<Content: View, Trailing: View>: View {
  let title: LocalizedStringKey
  var systemImage: String? = nil
  @ViewBuilder var trailing: () -> Trailing
  @ViewBuilder var content: () -> Content
  init(title: LocalizedStringKey, systemImage: String? = nil, @ViewBuilder trailing: @escaping () -> Trailing, @ViewBuilder content: @escaping () -> Content) {
    self.title = title; self.systemImage = systemImage; self.trailing = trailing; self.content = content
  }
  @_disfavoredOverload init(title: String, systemImage: String? = nil, @ViewBuilder trailing: @escaping () -> Trailing, @ViewBuilder content: @escaping () -> Content) {
    self.init(title: LocalizedStringKey(title), systemImage: systemImage, trailing: trailing, content: content)
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        if let systemImage { Image(systemName: systemImage).font(.system(size: 13)).foregroundStyle(Theme.textMuted) }
        Text(title).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Spacer(minLength: 0)
        trailing()
      }
      content()
    }
  }
}

extension SettingsSection where Trailing == EmptyView {
  init(_ title: LocalizedStringKey, systemImage: String? = nil, @ViewBuilder content: @escaping () -> Content) {
    self.init(title: title, systemImage: systemImage, trailing: { EmptyView() }, content: content)
  }
  @_disfavoredOverload init(_ title: String, systemImage: String? = nil, @ViewBuilder content: @escaping () -> Content) {
    self.init(title: LocalizedStringKey(title), systemImage: systemImage, trailing: { EmptyView() }, content: content)
  }
}

/// The dashed-border empty state the web draws inside a settings tab.
struct DashedEmptyState<Actions: View>: View {
  let systemImage: String
  let title: LocalizedStringKey
  var message: LocalizedStringKey? = nil
  @ViewBuilder var actions: () -> Actions
  init(systemImage: String, title: LocalizedStringKey, message: LocalizedStringKey? = nil, @ViewBuilder actions: @escaping () -> Actions) {
    self.systemImage = systemImage; self.title = title; self.message = message; self.actions = actions
  }
  @_disfavoredOverload init(systemImage: String, title: String, message: String? = nil, @ViewBuilder actions: @escaping () -> Actions) {
    self.init(systemImage: systemImage, title: LocalizedStringKey(title), message: message.map { LocalizedStringKey($0) }, actions: actions)
  }
  var body: some View {
    EmptyState(systemImage: systemImage, title: title, message: message, actions: actions)
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
  }
}

extension DashedEmptyState where Actions == EmptyView {
  init(systemImage: String, title: LocalizedStringKey, message: LocalizedStringKey? = nil) {
    self.init(systemImage: systemImage, title: title, message: message) { EmptyView() }
  }
  @_disfavoredOverload init(systemImage: String, title: String, message: String? = nil) {
    self.init(systemImage: systemImage, title: LocalizedStringKey(title), message: message.map { LocalizedStringKey($0) }) { EmptyView() }
  }
}

extension View {
  /// The centred, width-limited column every settings screen scrolls in.
  func settingsColumn(_ width: CGFloat = 640) -> some View {
    self.frame(maxWidth: width, alignment: .leading).padding(24).frame(maxWidth: .infinity)
  }
}
