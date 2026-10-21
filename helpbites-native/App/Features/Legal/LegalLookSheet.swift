import SwiftUI

/// Identity and look (components/legal/Look.vue): who operates the app, and how the
/// hosted legal pages look. Stored on the project (`legal`), used by every document.
struct LegalLookSheet: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var form = LegalConfig()
  @State private var loaded = false
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Used by every legal document of this project. Your name, address, email and data protection officer are the company profile (Project settings → Company), shared with campaigns; editing them here updates it.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Company or person", hint: "Named as the operator") { TextField("", text: $form.entity.name).textFieldStyle(.linear) }
          LabeledField(label: "Postal address") { TextField("", text: $form.entity.address).textFieldStyle(.linear) }
          LabeledField(label: "Legal contact email") {
            TextField("", text: $form.entity.email).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          LabeledField(label: "Data protection officer", hint: "Optional") { TextField("", text: $form.entity.dpo).textFieldStyle(.linear) }
          LabeledField(label: "Accent colour", hint: "Empty uses your Brand kit accent") {
            HStack(spacing: 10) {
              ColorPicker("Accent colour", selection: accentColor, supportsOpacity: false).labelsHidden()
              TextField("#4f46e5", text: $form.accent).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
              if !form.accent.isEmpty { Button("Clear") { form.accent = "" }.buttonStyle(GhostButtonStyle()) }
            }
          }
          LabeledField(label: "Font") {
            Picker("Font", selection: $form.font) {
              Text("Sans-serif").tag("system"); Text("Serif").tag("serif"); Text("Monospace").tag("mono")
            }
            .pickerStyle(.segmented).labelsHidden()
          }
          LabeledField(label: "Logo URL", hint: "Empty uses your Brand kit logo") {
            TextField("https://", text: $form.logoUrl).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          LabeledField(label: "Footer text") { TextField("", text: $form.footerText).textFieldStyle(.linear) }
          ErrorText(message: error)
        }
        .frame(maxWidth: 560, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("Identity and look")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(!loaded || saving) }
      }
      .task { await load() }
    }
    .presentationDetents([.large])
    #if os(macOS)
    .frame(minWidth: 520, minHeight: 560)
    #endif
  }

  /// A hex string as a colour and back; a half-typed or empty value shows the accent.
  private var accentColor: Binding<Color> {
    Binding(
      get: { Self.color(hex: form.accent) ?? Theme.accent },
      set: { form.accent = Self.hex($0) }
    )
  }

  static func color(hex: String) -> Color? {
    guard hex.count == 7, hex.hasPrefix("#"), let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    return Color(PlatformColor(hex: value))
  }

  static func hex(_ color: Color) -> String {
    let c = PlatformColor(color).rgba
    func byte(_ v: CGFloat) -> Int { Int((min(max(v, 0), 1) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", byte(c.red), byte(c.green), byte(c.blue))
  }

  private struct Row: Decodable, Sendable { let id: String; let legal: LegalConfig? }
  private struct Rows: Decodable, Sendable { let projects: [Row] }
  private struct Saved: Decodable, Sendable { let project: Row }

  /// There is no GET for one project; the panel reads the list and picks it.
  private func load() async {
    do {
      let rows: Rows = try await session.get("/v1/admin/projects")
      form = rows.projects.first { $0.id == projectId }?.legal ?? LegalConfig()
      loaded = true
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func save() async {
    struct Body: Encodable, Sendable { let legal: LegalConfig }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let _: Saved = try await session.send("/v1/admin/projects/\(projectId)", method: "PATCH", body: Body(legal: form))
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
