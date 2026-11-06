import SwiftUI

// MARK: - Email settings

/// The email's own settings and its theme: what EmailInspector.vue shows with
/// nothing selected. Theme changes restyle every block through the store, as
/// the web's applyThemeToDocument does.
struct EmailSettingsPanel: View {
  @Bindable var store: EmailEditorStore

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        LabeledField(label: "Subject / title") {
          TextField("", text: store.binding(\.title)).textFieldStyle(.linear)
        }
        LabeledField(label: "Preheader", hint: "Hidden inbox preview text.") {
          TextField("", text: store.binding(\.preheader)).textFieldStyle(.linear)
        }
        LabeledField(label: "Plain-text version", hint: "Sent alongside the HTML for clients that show text. Leave blank to generate it from the design.") {
          LinearTextEditor(text: store.binding(\.text), placeholder: String(localized: "Generated from the design"), minHeight: 96, monospaced: true)
        }
        LabeledField(label: "Content width (px)") {
          EmailNumberField(label: String(localized: "Content width"), value: store.binding(\.contentWidth), placeholder: "600", range: 320...900, step: 10)
        }
        PanelRule()
        themeSection
        Label("Tap any block in the email to edit it here.", systemImage: "hand.tap")
          .font(.lnCaption)
          .foregroundStyle(Theme.textMuted)
          .padding(12)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      }
      .padding(16)
    }
    .scrollDismissesKeyboard(.interactively)
  }

  // MARK: Theme

  private var themeSection: some View {
    let current = store.design.currentTheme
    return VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Label("Theme", systemImage: "paintpalette")
          .font(.lnHeading)
          .foregroundStyle(Theme.textHighlighted)
        Text("Restyles colours, font and corners across the whole email — the layout stays put. You can also just ask the AI (“make it feel like autumn”).")
          .font(.lnCaption)
          .foregroundStyle(Theme.textMuted)
          .fixedSize(horizontal: false, vertical: true)
      }
      presets
      LazyVGrid(columns: twoColumns(spacing: 12), alignment: .leading, spacing: 14) {
        token(String(localized: "Brand"), \.brand)
        token(String(localized: "On brand"), \.onBrand)
        token(String(localized: "Page"), \.background)
        token(String(localized: "Card"), \.surface)
        token(String(localized: "Headings"), \.heading)
        token(String(localized: "Text"), \.text)
        token(String(localized: "Muted"), \.muted)
      }
      LabeledField(label: "Font") {
        fontMenu(current.fontFamily)
      }
      LabeledField(label: "Button corner radius (px)") {
        EmailNumberField(
          label: String(localized: "Button corner radius"),
          value: Binding<Double>(
            get: { store.design.currentTheme.radius },
            set: { value in store.applyTheme { $0.radius = value } }
          ),
          placeholder: "6",
          range: 0...999
        )
      }
    }
  }

  /// THEME_PRESETS as cards; a preset replaces every token, as the web's applyPreset does.
  private var presets: some View {
    let applied = store.design.settings.theme
    return LazyVGrid(columns: twoColumns(spacing: 8), spacing: 8) {
      ForEach(EmailThemePreset.all) { preset in
        presetCard(preset, active: applied == preset.theme)
      }
    }
  }

  private func presetCard(_ preset: EmailThemePreset, active: Bool) -> some View {
    Button { store.applyTheme { $0 = preset.theme } } label: {
      VStack(alignment: .leading, spacing: 8) {
        // The web's swatches: brand, page, headings.
        HStack(spacing: 4) {
          swatch(preset.theme.brand)
          swatch(preset.theme.background)
          swatch(preset.theme.heading)
        }
        Text(preset.name)
          .font(.lnMetaMedium)
          .foregroundStyle(Theme.text)
          .lineLimit(1)
      }
      .padding(10)
      .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
      .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(active ? Theme.accent : Theme.border, lineWidth: active ? 1.5 : 1))
      .contentShape(RoundedRectangle(cornerRadius: Metrics.radius))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(Text("\(preset.name) theme"))
    .accessibilityAddTraits(active ? .isSelected : [])
  }

  private func swatch(_ hex: String) -> some View {
    Circle()
      .fill(Color(hexString: hex) ?? Color.clear)
      .frame(width: 16, height: 16)
      .overlay(Circle().strokeBorder(Color.black.opacity(0.12)))
  }

  /// One theme token; a change restyles the blocks that use it.
  private func token(_ label: String, _ key: WritableKeyPath<EmailDesignTheme, String>) -> some View {
    LabeledField(label: label) {
      EmailColorField(
        label: label,
        color: Binding<String>(
          get: { store.design.currentTheme[keyPath: key] },
          set: { value in store.applyTheme { $0[keyPath: key] = value } }
        )
      )
    }
  }

  private func fontMenu(_ font: String) -> some View {
    let name = EmailFontStack.all.first { $0.value == font }?.label ?? String(localized: "Custom")
    return Menu {
      Picker("Font", selection: Binding<String>(
        get: { store.design.currentTheme.fontFamily },
        set: { value in store.applyTheme { $0.fontFamily = value } }
      )) {
        ForEach(EmailFontStack.all) { stack in
          Text(stack.label).tag(stack.value)
        }
      }
      .pickerStyle(.inline)
    } label: {
      InboxFieldBox {
        Text(name).fontDesign(EmailFontStack.design(font))
      }
    }
  }

  private func twoColumns(spacing: CGFloat) -> [GridItem] {
    [GridItem(.flexible(), spacing: spacing, alignment: .top), GridItem(.flexible(), spacing: spacing, alignment: .top)]
  }
}

// MARK: - Variables

/// The email's `{{ placeholders }}` (EmailVariables.vue): a friendly label and a
/// sample value for each, used for previews and as the send API's fallback.
struct EmailVariablesPanel: View {
  @Bindable var store: EmailEditorStore

  var body: some View {
    let rows = store.detectedVariables
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        intro
          .font(.lnMeta)
          .foregroundStyle(Theme.textMuted)
          .fixedSize(horizontal: false, vertical: true)
        if rows.isEmpty {
          emptyState
        } else {
          ForEach(rows, id: \.key) { variable in
            EmailVariableRow(store: store, variable: variable)
          }
        }
      }
      .padding(16)
    }
    .scrollDismissesKeyboard(.interactively)
  }

  private var intro: Text {
    let example: Text = Text(verbatim: "{{ firstName }}").font(.lnMono).foregroundStyle(Theme.text)
    return Text("Type \(example) anywhere in your text, headings or buttons. Set a sample value to preview, then pass real values via the API at send time.")
  }

  private var emptyMessage: Text {
    let example: Text = Text(verbatim: "{{ placeholder }}").font(.lnMono)
    return Text("No variables yet. Add a \(example) to your copy.")
  }

  private var emptyState: some View {
    VStack(spacing: 8) {
      Image(systemName: "curlybraces")
        .font(.app(size: 20))
        .foregroundStyle(Theme.textDimmed)
      emptyMessage
        .font(.lnMeta)
        .foregroundStyle(Theme.textMuted)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(24)
    .frame(maxWidth: .infinity)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
  }
}

/// One placeholder: its label and sample value, kept locally while typing and
/// saved on every change (the store merges keystrokes into one undo step).
private struct EmailVariableRow: View {
  let store: EmailEditorStore
  let variable: EmailVariable
  @State private var label: String
  @State private var sample: String

  init(store: EmailEditorStore, variable: EmailVariable) {
    self.store = store
    self.variable = variable
    _label = State(initialValue: variable.label ?? "")
    _sample = State(initialValue: variable.defaultValue ?? "")
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(verbatim: "{{ \(variable.key) }}")
          .font(.app(size: 13, weight: .medium, design: .monospaced))
          .foregroundStyle(Theme.accentText)
          .textSelection(.enabled)
        if variable.key.hasPrefix("project.") {
          Text(brandNote).font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
      }
      LabeledField(label: "Label") {
        TextField("First name", text: $label).textFieldStyle(.linear)
      }
      LabeledField(label: "Sample value") {
        TextField("Ada", text: $sample).textFieldStyle(.linear)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    .onChange(of: label) { _, value in
      if value != (variable.label ?? "") { store.setVariable(variable.key, label: value) }
    }
    .onChange(of: sample) { _, value in
      if value != (variable.defaultValue ?? "") { store.setVariable(variable.key, sample: value) }
    }
    // An undo or another editor's save changed it.
    .onChange(of: variable) { _, latest in
      if (latest.label ?? "") != label { label = latest.label ?? "" }
      if (latest.defaultValue ?? "") != sample { sample = latest.defaultValue ?? "" }
    }
  }

  private var brandNote: String {
    store.isMaster ? String(localized: "Each project fills this in from its brand.") : String(localized: "Filled in from the project's brand.")
  }
}

/// The hairline between the email's settings and its theme.
private struct PanelRule: View {
  var body: some View {
    Rectangle().fill(Theme.border).frame(height: 1)
  }
}
