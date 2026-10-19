import SwiftUI

/// "New template" / "New master" (EmailTemplatePicker.vue): a starter, or a blank page.
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
          .frame(height: 24)
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
            Image(systemName: starter.systemImage).font(.system(size: 13, weight: .medium)).foregroundStyle(accent)
            Text(starter.name).font(.lnHeading).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          }
          Text(starter.description).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(2, reservesSpace: true)
          HStack(spacing: 6) {
            Tag(text: starter.type)
            Tag(text: starter.style)
            Spacer(minLength: 0)
            Image(systemName: "arrow.right").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.textDimmed)
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

/// "Add master" on a project: link one of the masters in.
struct EmailAddMasterSheet: View {
  let inUse: Set<String>
  /// Links the master; returns an error message, or nil once it's done.
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
        Text("The project uses the master's design with its own brand and values. Edits to the master reach it too.")
          .font(.lnMeta)
          .foregroundStyle(Theme.textMuted)
          .padding(.vertical, 8)
          .linearRow()
        if loading {
          SkeletonRows(count: 3).linearRow()
        } else if masters.isEmpty {
          EmptyState(systemImage: "envelope", title: "No masters yet", message: "Create one first.") {
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
      .panelScreen("Add a master")
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

/// Share settings for a template (the popover on pages/emails/[id].vue).
struct EmailShareSheet: View {
  let template: EmailTemplateItem
  /// The new mode (nil when off) and token, for the list.
  var onChange: (String?, String?) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var mode: String
  @State private var token: String?
  @State private var busy = false
  @State private var copied = false
  @State private var error = ""

  private static let modes: [(value: String, label: String, detail: String)] = [
    ("off", "Off", "Only operators can open it."),
    ("view", "Anyone with the link can view", "A rendered preview, no sign-in."),
    ("edit", "Anyone with the link can edit", "Changes sync live. Share with care.")
  ]

  init(template: EmailTemplateItem, onChange: @escaping (String?, String?) -> Void) {
    self.template = template
    self.onChange = onChange
    _mode = State(initialValue: template.shareMode ?? "off")
    _token = State(initialValue: template.shareToken)
  }

  private var link: String? {
    guard let token, mode != "off" else { return nil }
    return "\(session.endpoint)/share/emails/\(token)"
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text(template.title).font(.lnMeta).foregroundStyle(Theme.textMuted)
          Card {
            ForEach(Array(Self.modes.enumerated()), id: \.offset) { index, option in
              CardRow(divider: index < Self.modes.count - 1) {
                Button { Task { await set(option.value) } } label: {
                  HStack(alignment: .top, spacing: 10) {
                    Image(systemName: mode == option.value ? "largecircle.fill.circle" : "circle")
                      .font(.system(size: 16))
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
                .disabled(busy || (option.value == "edit" && template.isLinked))
                .accessibilityAddTraits(mode == option.value ? .isSelected : [])
              }
            }
          }
          if template.isLinked {
            Text("A linked master can only be shared view-only; edit the master instead.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
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
                  Image(systemName: "square.and.arrow.up").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).overlay(Circle().strokeBorder(Theme.border))
                }
                .accessibilityLabel("Share link")
              }
            }
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

  private func set(_ next: String) async {
    guard next != mode else { return }
    busy = true
    error = ""
    defer { busy = false }
    do {
      let response: EmailShareResponse = try await session.send("/v1/admin/emails/\(template.id)/share", body: ["mode": JSONValue.string(next)])
      mode = response.mode
      token = response.token
      copied = false
      onChange(response.mode == "off" ? nil : response.mode, response.token)
    } catch { self.error = error.localizedDescription }
  }
}
