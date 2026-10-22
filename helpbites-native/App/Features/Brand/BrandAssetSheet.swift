import SwiftUI

/// A brand kit file's details: name, description, kind, the background it sits on,
/// and whether the public page shows it. Saves on its own (`PATCH /v1/admin/brand/assets/:id`).
struct BrandAssetSheet: View {
  let asset: BrandAsset
  let onSave: (BrandAsset) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var form: BrandAsset
  @State private var saving = false
  @State private var error = ""

  init(asset: BrandAsset, onSave: @escaping (BrandAsset) -> Void) {
    self.asset = asset
    self.onSave = onSave
    _form = State(initialValue: asset)
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          LabeledField(label: "Name", hint: "What people see, and the name a download is saved under") {
            TextField("", text: $form.name).textFieldStyle(.linear)
          }
          LabeledField(label: "Description") {
            LinearTextEditor(text: $form.description, placeholder: String(localized: "Where and how to use it"), minHeight: 72)
          }
          LabeledField(label: "Kind") {
            Picker("Kind", selection: $form.kind) {
              ForEach(BrandOptions.assetKinds, id: \.id) { Text($0.label).tag($0.id) }
            }
            .labelsHidden().fixedSize()
          }
          LabeledField(label: "Background", hint: "What it is drawn to sit on, so its tile matches") {
            Picker("Background", selection: $form.background) {
              ForEach(BrandOptions.backgrounds, id: \.id) { Text($0.label).tag($0.id) }
            }
            .pickerStyle(.segmented).labelsHidden()
          }
          Toggle(isOn: $form.public) {
            VStack(alignment: .leading, spacing: 2) {
              Text("Public").font(.lnRow).foregroundStyle(Theme.text)
              Text("Off keeps it in the kit but off the public page and API.").font(.lnCaption).foregroundStyle(Theme.textMuted)
            }
          }
          .toggleStyle(.switch).tint(Theme.accent)
          ErrorText(message: error)
        }
        .frame(maxWidth: 560, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("Edit file")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") { Task { await save() } }.disabled(saving || form == asset || form.name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
    }
    .presentationDetents([.large])
  }

  private func save() async {
    struct Input: Encodable, Sendable { let name, description, kind, background: String; let `public`: Bool }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let response: BrandAssetResponse = try await session.send("/v1/admin/brand/assets/\(asset.id)", method: "PATCH", body: Input(name: form.name, description: form.description, kind: form.kind, background: form.background, public: form.public))
      onSave(response.asset)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
