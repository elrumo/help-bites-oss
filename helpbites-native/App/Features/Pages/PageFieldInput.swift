import SwiftUI

/// One field of a block, by its type (web: components/cms/CmsFieldInput.vue). `blocks`
/// fields are edited in the outline, so they show nothing here. `set(nil)` removes the value.
struct PageFieldInput: View {
  let field: CmsField
  let value: JSONValue?
  let projectId: String
  let set: (JSONValue?) -> Void
  @State private var picking = false

  /// What the field shows: its value, else its default.
  private var effective: JSONValue? { value ?? field.default }
  private var text: String {
    switch effective {
    case .string(let string)?: string
    case .number(let number)?: Self.format(number)
    default: ""
    }
  }
  private var stringBinding: Binding<String> { Binding(get: { text }, set: { set(.string($0)) }) }

  var body: some View {
    switch field.kind {
    case .blocks:
      EmptyView()
    case .boolean:
      Toggle(isOn: Binding(get: { effective == .bool(true) }, set: { set(.bool($0)) })) {
        VStack(alignment: .leading, spacing: 2) {
          Text(field.label).font(.lnRow).foregroundStyle(Theme.text)
          if let description = field.description, !description.isEmpty { Text(description).font(.lnCaption).foregroundStyle(Theme.textMuted) }
        }
      }
      .toggleStyle(.switch).tint(Theme.accent)
    default:
      LabeledField(label: field.required == true ? String(localized: "\(field.label) · required") : field.label, hint: hint) { control }
    }
  }

  private var hint: String? {
    let description = field.description ?? ""
    if field.kind == .markdown { return description.isEmpty ? String(localized: "Markdown: **bold**, *italic*, [links](https://…), lists with “- ”.") : description }
    return description.isEmpty ? nil : description
  }

  @ViewBuilder private var control: some View {
    switch field.kind {
    case .text:
      TextField("", text: stringBinding).textFieldStyle(.linear)
    case .textarea:
      LinearTextEditor(text: stringBinding, minHeight: 72)
    case .markdown:
      LinearTextEditor(text: stringBinding, minHeight: 120, monospaced: true)
    case .number:
      PageNumberField(value: { if case .number(let number)? = effective { number } else { nil } }()) { set($0.map { .number($0) }) }
    case .color:
      HStack(spacing: 10) {
        ColorPicker(field.label, selection: Binding(get: { Color(hexString: text) ?? Theme.accent }, set: { set(.string($0.hexString)) }), supportsOpacity: false).labelsHidden()
        TextField("#rrggbb", text: stringBinding).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
        if !text.isEmpty { Button("Clear") { set(nil) }.buttonStyle(.lnGhost) }
      }
    case .url:
      TextField("https://", text: stringBinding).textFieldStyle(.linear).font(.lnMono)
        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
    case .date:
      HStack(spacing: 10) {
        if text.isEmpty {
          Button { set(.string(LegalDay.string(.now))) } label: { Label("Set a date", systemImage: "calendar") }.buttonStyle(.lnSecondaryCompact)
        } else {
          DatePicker(field.label, selection: Binding(get: { LegalDay.date(String(text.prefix(10))) ?? .now }, set: { set(.string(LegalDay.string($0))) }), displayedComponents: .date)
            .labelsHidden().environment(\.timeZone, LegalDay.utc)
          Button("Clear") { set(nil) }.buttonStyle(.lnGhost)
        }
        Spacer(minLength: 0)
      }
    case .select:
      choice(field.options ?? [], none: String(localized: "Not set"))
    case .icon:
      choice(field.options?.isEmpty == false ? field.options ?? [] : CmsOptions.icons, none: String(localized: "No icon"))
    case .asset:
      assetControl
    case .boolean, .blocks:
      EmptyView()
    }
  }

  /// A menu of the field's options; one no longer offered (an icon renamed since) stays listed while it is the value.
  private func choice(_ options: [String], none: String) -> some View {
    Picker(field.label, selection: Binding(get: { text }, set: { set($0.isEmpty ? nil : .string($0)) })) {
      Text(none).tag("")
      ForEach(text.isEmpty || options.contains(text) ? options : [text] + options, id: \.self) { Text($0).tag($0) }
    }
    .labelsHidden().fixedSize()
  }

  // MARK: Asset

  private struct Reference {
    var url = ""
    var alt = ""
    var mime = ""
  }

  private var reference: Reference? {
    guard case .object(let object)? = value, case .string(let url)? = object["url"], url.hasPrefix("http") else { return nil }
    var out = Reference(url: url)
    if case .string(let alt)? = object["alt"] { out.alt = alt }
    if case .string(let mime)? = object["mime"] { out.mime = mime }
    return out
  }

  private var assetControl: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        Button { picking = true } label: { thumbnail }.buttonStyle(.plain).accessibilityLabel("Choose a file")
        VStack(alignment: .leading, spacing: 6) {
          Button(reference == nil ? "Choose a file" : "Replace") { picking = true }.buttonStyle(.lnSecondaryCompact)
          if reference != nil { Button("Remove") { set(nil) }.buttonStyle(.lnGhost) }
        }
        Spacer(minLength: 0)
      }
      if let reference {
        TextField("Alt text: what the picture shows", text: Binding(
          get: { reference.alt },
          set: { alt in
            guard case .object(var object)? = value else { return }
            object["alt"] = .string(alt.clipped(to: CmsLimits.alt))
            set(.object(object))
          }
        ))
        .textFieldStyle(.linear)
      }
    }
    .sheet(isPresented: $picking) {
      PageAssetPicker(projectId: projectId) { asset in
        set(asset.reference)
        picking = false
      }
    }
  }

  private var thumbnail: some View {
    ZStack {
      Theme.elevated
      if let reference {
        if reference.mime.hasPrefix("image/") || reference.mime.isEmpty {
          CachedAsyncImage(url: URL(string: reference.url)) { phase in
            switch phase {
            case .success(let image): image.resizable().scaledToFit().padding(4)
            case .failure: Image(systemName: "doc").foregroundStyle(Theme.textDimmed)
            default: ProgressView().controlSize(.small)
            }
          }
        } else {
          Image(systemName: reference.mime.hasPrefix("video/") ? "film" : "doc").foregroundStyle(Theme.textDimmed)
        }
      } else {
        Image(systemName: "photo.badge.plus").foregroundStyle(Theme.textDimmed)
      }
    }
    .frame(width: 64, height: 64)
    .clipShape(RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  static func format(_ number: Double) -> String {
    number == number.rounded() && abs(number) < 1e15 ? String(Int(number)) : String(number)
  }
}

/// A number typed as text, so "1." survives while it is being typed; empty or unreadable clears the value.
private struct PageNumberField: View {
  let value: Double?
  let set: (Double?) -> Void
  @State private var text = ""

  var body: some View {
    TextField("", text: $text).textFieldStyle(.linear).keyboardType(.decimalPad).font(.lnMono)
      .onAppear { text = value.map(PageFieldInput.format) ?? "" }
      .onChange(of: text) { _, new in
        let number = Double(new.trimmingCharacters(in: .whitespaces))
        if number != value { set(number) }
      }
  }
}

/// The project's files, to pick one for an asset field (web: CmsAssetPicker.vue).
struct PageAssetPicker: View {
  let projectId: String
  let onPick: (CmsAsset) -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      PagesFilesView(projectId: projectId, onPick: onPick)
        .panelScreen("Choose a file")
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
    }
    .presentationDetents([.large])
  }
}
