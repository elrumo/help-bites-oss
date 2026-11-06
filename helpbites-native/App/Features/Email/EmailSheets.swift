import SwiftUI

/// "New template" / "New shared template" (EmailTemplatePicker.vue): a starter, or a blank page.
struct EmailStarterPicker: View {
  let title: String
  var onPick: (EmailStarter) -> Void
  var onBlank: () -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var type = "All"
  @State private var style = "All"

  private var filtered: [EmailStarter] {
    EmailStarter.all.filter { (type == "All" || $0.type == type) && (style == "All" || $0.style == style) }
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Start from a ready-made structure, then make it yours.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          FlowLayout(spacing: 6) {
            ForEach(choices(\.type), id: \.self) { option in Pill(label: option, isActive: type == option) { type = option } }
          }
          FlowLayout(spacing: 6) {
            ForEach(choices(\.style), id: \.self) { option in Pill(label: option, isActive: style == option) { style = option } }
          }
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12)], spacing: 12) {
            ForEach(filtered) { card($0) }
          }
        }
        .padding(20)
      }
      .panelScreen(title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .bottomBar) {
          Button { onBlank() } label: { Label("Start blank", systemImage: "doc") }.labelStyle(.titleAndIcon)
        }
      }
    }
  }

  /// "All", then each value in catalog order.
  private func choices(_ field: KeyPath<EmailStarter, String>) -> [String] {
    var seen = Set<String>()
    return ["All"] + EmailStarter.all.map { $0[keyPath: field] }.filter { seen.insert($0).inserted }
  }

  private func card(_ starter: EmailStarter) -> some View {
    let accent = Color(hexString: starter.accent) ?? Theme.accent
    let line = Color(white: 0.55, opacity: 0.3)
    return Button { onPick(starter) } label: {
      VStack(alignment: .leading, spacing: 0) {
        // The web's sketch of the layout: the page colour, the card, an accent bar, copy and two columns.
        VStack(alignment: .leading, spacing: 0) {
          Capsule().fill(accent).frame(width: 40, height: 6).padding(.bottom, 8)
          RoundedRectangle(cornerRadius: 3).fill(Color(white: 0.55, opacity: 0.45)).frame(width: 72, height: 9).padding(.bottom, 4)
          RoundedRectangle(cornerRadius: 3).fill(line).frame(width: 96, height: 9).padding(.bottom, 10)
          HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 3).fill(line)
            RoundedRectangle(cornerRadius: 3).fill(line)
          }
          .frame(height: Metrics.scaled(24))
        }
        .padding(10)
        .frame(maxWidth: 180, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(hexString: starter.surface) ?? Theme.field, in: RoundedRectangle(cornerRadius: 6))
        .clipped()
        .padding(12)
        .frame(maxWidth: .infinity)
        .frame(height: 112)
        .background(Color(hexString: starter.background) ?? Theme.elevated)

        VStack(alignment: .leading, spacing: 10) {
          HStack(spacing: 8) {
            Image(systemName: starter.systemImage).font(.app(size: 13, weight: .medium)).foregroundStyle(accent)
            Text(starter.name).font(.lnHeading).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          }
          Text(starter.description).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(2, reservesSpace: true)
          HStack(spacing: 6) {
            Tag(text: starter.type)
            Tag(text: starter.style)
            Spacer(minLength: 0)
            Image(systemName: "arrow.right").font(.app(size: 12, weight: .medium)).foregroundStyle(Theme.textDimmed)
          }
        }
        .padding(14)
      }
      .background(Theme.panel)
      .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusLarge))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
      .contentShape(RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(starter.name). \(starter.description)")
  }
}

/// "Add shared template" on a project: link one of the shared templates in.
struct EmailAddMasterSheet: View {
  let inUse: Set<String>
  /// Links the shared template; returns an error message, or nil once it's done.
  var onAdd: (String) async -> String?
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var masters: [EmailTemplateItem] = []
  @State private var loading = true
  @State private var adding: String?
  @State private var error = ""

  var body: some View {
    NavigationStack {
      List {
        Text("The project uses the shared template's design with its own brand and values. Edits to the shared template reach it too.")
          .font(.lnMeta)
          .foregroundStyle(Theme.textMuted)
          .padding(.vertical, 8)
          .linearRow()
        if loading {
          SkeletonRows(count: 3).linearRow()
        } else if masters.isEmpty {
          EmptyState(systemImage: "envelope", title: "No shared templates yet", message: "Create one first.") {
            Button("Create one") { dismiss(); workspace.go(.emailTemplates) }.buttonStyle(.lnSecondaryCompact)
          }
          .linearRow()
        } else {
          ForEach(masters) { master in
            HStack(spacing: 10) {
              Text(master.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
              Spacer(minLength: 8)
              if inUse.contains(master.id) { Tag(text: "In use") }
              Button {
                Task {
                  adding = master.id
                  error = await onAdd(master.id) ?? ""
                  adding = nil
                }
              } label: {
                if adding == master.id { ProgressView() } else { Text("Add") }
              }
              .buttonStyle(.lnSecondaryCompact)
              .disabled(adding != nil)
            }
            .frame(minHeight: Metrics.rowHeight)
            .linearRow()
          }
        }
        if !error.isEmpty { ErrorText(message: error).linearRow() }
      }
      .linearList()
      .panelScreen("Add a shared template")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
      .task {
        do {
          let response: EmailTemplateList = try await session.get("/v1/admin/emails")
          masters = response.templates
        } catch { self.error = error.localizedDescription }
        loading = false
      }
    }
    .presentationDetents([.medium, .large])
  }
}

/// Share settings for a template (the popover on pages/emails/[id].vue): who
/// can open the link, how long it lasts, and the last edit made through it.
struct EmailShareSheet: View {
  let template: EmailTemplateItem
  /// The new mode (nil when off), token and expiry (epoch ms), for the list.
  var onChange: (String?, String?, Double?) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var mode: String
  @State private var token: String?
  @State private var expiresAt: Double?
  @State private var days: Int?
  @State private var busy = false
  @State private var copied = false
  @State private var error = ""

  private static let modes: [(value: String, label: String, detail: String)] = [
    ("off", String(localized: "Off"), String(localized: "Only operators can open it.")),
    ("view", String(localized: "Anyone with the link can view"), String(localized: "A rendered preview, no sign-in.")),
    ("edit", String(localized: "Anyone with the link can edit"), String(localized: "Changes sync live. Share with care."))
  ]
  private static let dayOptions = [1, 7, 30, 90]
  /// Mail the server sends itself (shareEditRefusal in server/utils/emails.ts).
  private static let systemKeys: Set<String> = ["confirm-subscription", "changelog-confirm", "changelog"]

  init(template: EmailTemplateItem, onChange: @escaping (String?, String?, Double?) -> Void) {
    self.template = template
    self.onChange = onChange
    _mode = State(initialValue: template.shareMode ?? "off")
    _token = State(initialValue: template.shareToken)
    _expiresAt = State(initialValue: template.shareExpiresAt)
  }

  /// Why this template can only be shared view-only (shareEditRefusal).
  private var editRefusal: String? {
    if template.isLinked { return String(localized: "A linked shared template can only be shared view-only; edit the shared template instead.") }
    if template.projectId == nil { return String(localized: "A shared template can only be shared view-only: an edit would change it for every project that uses it.") }
    if Self.systemKeys.contains(template.key) { return String(localized: "“\(template.key)” is mail the server sends itself, so it can only be shared view-only.") }
    return nil
  }

  private var link: String? {
    guard let token, mode != "off" else { return nil }
    return "\(session.endpoint)/share/emails/\(token)"
  }

  /// A link shared before links expired has no date; the server treats it as expired.
  private var expired: Bool { expiresAt.map { $0 <= Date().timeIntervalSince1970 * 1000 } ?? true }

  private var expiryText: String {
    guard let expiresAt else { return String(localized: "Expired: renew to use it again") }
    let date = Date(timeIntervalSince1970: expiresAt / 1000).formatted(date: .abbreviated, time: .shortened)
    return expired ? String(localized: "Expired \(date)") : String(localized: "Expires \(date)")
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text(template.title).font(.lnMeta).foregroundStyle(Theme.textMuted)
          Card {
            ForEach(Array(Self.modes.enumerated()), id: \.offset) { index, option in
              CardRow(divider: index < Self.modes.count - 1) {
                Button { Task { await apply(option.value, days: nil) } } label: {
                  HStack(alignment: .top, spacing: 10) {
                    Image(systemName: mode == option.value ? "largecircle.fill.circle" : "circle")
                      .font(.app(size: 16))
                      .foregroundStyle(mode == option.value ? Theme.accent : Theme.textDimmed)
                    VStack(alignment: .leading, spacing: 2) {
                      Text(option.label).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                      Text(option.detail).font(.lnMeta).foregroundStyle(Theme.textMuted)
                    }
                    Spacer(minLength: 0)
                  }
                  .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(busy || (option.value == "edit" && editRefusal != nil))
                .accessibilityAddTraits(mode == option.value ? .isSelected : [])
              }
            }
          }
          if let editRefusal { Text(editRefusal).font(.lnCaption).foregroundStyle(Theme.textMuted) }
          if let link {
            HStack(spacing: 8) {
              Text(link)
                .font(.lnMono)
                .foregroundStyle(Theme.text)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
                .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
              IconButton(systemImage: copied ? "checkmark" : "doc.on.doc", label: "Copy link", bordered: true) {
                Clipboard.copy(link)
                copied = true
              }
              if let url = URL(string: link) {
                ShareLink(item: url) {
                  Image(systemName: "square.and.arrow.up").font(.app(size: 14, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).overlay(Circle().strokeBorder(Theme.border))
                }
                .accessibilityLabel("Share link")
              }
            }
            HStack(spacing: 8) {
              Text(expiryText).font(.lnCaption).foregroundStyle(expired ? Theme.error : Theme.textMuted)
              Spacer(minLength: 0)
              if expired { Button("Renew") { Task { await apply(mode, days: days) } }.buttonStyle(.lnSecondaryCompact).disabled(busy) }
              Menu {
                ForEach(Self.dayOptions, id: \.self) { option in
                  Button(option == 1 ? "1 day" : "\(option) days") { Task { await apply(mode, days: option) } }
                }
              } label: {
                Label(days.map { $0 == 1 ? String(localized: "1 day") : String(localized: "\($0) days") } ?? String(localized: "Set expiry"), systemImage: "clock")
                  .font(.lnMetaMedium)
                  .foregroundStyle(Theme.textMuted)
              }
              .disabled(busy)
              .accessibilityLabel("Link lifetime")
            }
          }
          if let edit = template.lastSharedEdit, let at = edit.at {
            Text("Last edited through a link \(EmailStatusText.fullDate(at)) from \(edit.ip?.isEmpty == false ? edit.ip! : String(localized: "an unknown address"))")
              .font(.lnCaption)
              .foregroundStyle(Theme.textMuted)
          }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("Share link")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .presentationDetents([.medium, .large])
  }

  /// POST …/share: every view or edit call restarts the link's expiry (the server's default unless `days`).
  private func apply(_ next: String, days chosen: Int?) async {
    guard next != mode || chosen != nil || (next != "off" && expired) else { return }
    struct Input: Encodable, Sendable { let mode: String; let expiresInDays: Int? }
    busy = true
    error = ""
    defer { busy = false }
    do {
      let response: EmailShareResponse = try await session.send("/v1/admin/emails/\(template.id)/share", body: Input(mode: next, expiresInDays: chosen))
      mode = response.mode
      token = response.token
      expiresAt = response.expiresAt
      days = chosen
      copied = false
      onChange(response.mode == "off" ? nil : response.mode, response.token, response.expiresAt)
    } catch { self.error = error.localizedDescription }
  }
}
