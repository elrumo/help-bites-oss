import SwiftUI

/// Edits one style layer (components/style/StyleEditor.vue): the project's own, or a
/// feature's choices over it. What a field leaves empty shows the value that layer
/// would inherit from `under` (the layers below) and the Brand kit.
struct ProjectStyleEditor: View {
  @Binding var style: ProjectStyle
  let kit: StyleBase
  /// The layers this one sits on, lowest first: none for the project's style, its style for a feature's.
  var under: [ProjectStyle] = []
  /// What an empty scheme means here: "Follow the visitor" for the project, "Same as the project" for a feature.
  var emptyScheme = String(localized: "Follow the visitor")

  private var layered: Bool { !under.isEmpty }
  private var inherited: ResolvedStyle { .resolve(kit, under) }
  private var resolved: ResolvedStyle { .resolve(kit, under + [style]) }

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      LabeledField(label: "Colour scheme") {
        Picker("Colour scheme", selection: $style.scheme) {
          Text(verbatim: emptyScheme).tag("")
          ForEach(ProjectStyleOptions.schemes.filter { layered || $0.id != "auto" }, id: \.id) { Text(verbatim: $0.label).tag($0.id) }
        }
        .labelsHidden().pickerStyle(.menu)
      }
      LabeledField(label: "Shadow") {
        Picker("Shadow", selection: $style.shadow) {
          Text(verbatim: layered ? String(localized: "Same as the project (\(shadowLabel(inherited.shadow)))") : String(localized: "Default (\(shadowLabel(inherited.shadow)))")).tag("")
          ForEach(ProjectStyleOptions.shadows, id: \.id) { Text(verbatim: $0.label).tag($0.id) }
        }
        .labelsHidden().pickerStyle(.menu)
      }
      LabeledField(label: "Font") {
        Picker("Font", selection: $style.font) {
          Text(layered ? LocalizedStringKey("Same as the project") : LocalizedStringKey("The Brand kit's font")).tag("")
          ForEach(ProjectStyleOptions.fonts, id: \.id) { Text(verbatim: $0.label).tag($0.id) }
        }
        .labelsHidden().pickerStyle(.menu)
      }

      LabeledField(label: "Corner radius") {
        HStack(spacing: 10) {
          Slider(value: Binding(get: { Double(style.radius ?? inherited.radius) }, set: { style.radius = Int($0.rounded()) }), in: 0...Double(ProjectStyleOptions.radiusMax), step: 1)
          Text(verbatim: "\(style.radius ?? inherited.radius) px").font(.lnMono).foregroundStyle(style.radius == nil ? Theme.textMuted : Theme.text).frame(width: 52, alignment: .trailing)
          if style.radius != nil { IconButton(systemImage: "xmark", label: "Reset") { style.radius = nil } }
        }
      }

      palette("Light", "sun.max", \.light, inherited.light)
      palette("Dark", "moon", \.dark, inherited.dark)

      VStack(alignment: .leading, spacing: 14) {
        urlField("Logo", "Shown in the header. Empty uses the Brand kit's logo.", \.logoUrl, inherited.logoUrl)
        urlField("Logo for dark", "A logo drawn for dark backgrounds. Empty uses the logo.", \.logoDarkUrl, inherited.logoDarkUrl)
        urlField("App icon", "A square icon. Empty uses the Brand kit's.", \.iconUrl, inherited.iconUrl)
      }

      // The result in both schemes, so the dark side is never a surprise.
      ProjectStylePreview(style: resolved)
    }
  }

  private func shadowLabel(_ id: String) -> String { ProjectStyleOptions.shadows.first { $0.id == id }?.label ?? id }

  private func palette(_ title: LocalizedStringKey, _ symbol: String, _ path: WritableKeyPath<ProjectStyle, StylePalette>, _ fallback: StylePalette) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Label(title, systemImage: symbol).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
      ForEach(StylePaletteKey.allCases) { key in
        let value = style[keyPath: path][key]
        VStack(alignment: .leading, spacing: 4) {
          OptionalColorField(label: LocalizedStringKey(key.label), hex: Binding(get: { style[keyPath: path][key] }, set: { style[keyPath: path][key] = $0 }), fallback: Color(hexString: fallback[key]) ?? Theme.accent, empty: LocalizedStringKey(fallback[key]))
          if !value.isEmpty && !ProjectStyleOptions.isHex(value) { Text("Use a hex colour like #4f46e5").font(.lnCaption).foregroundStyle(Theme.error) }
        }
      }
    }
    .padding(12)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  private func urlField(_ label: LocalizedStringKey, _ hint: LocalizedStringKey, _ path: WritableKeyPath<ProjectStyle, String>, _ fallback: String) -> some View {
    LabeledField(label: label, hint: hint) {
      HStack(spacing: 10) {
        let shown = style[keyPath: path].isEmpty ? fallback : style[keyPath: path]
        AsyncImage(url: URL(string: shown)) { $0.resizable().scaledToFit() } placeholder: { Color.clear }
          .frame(width: 32, height: 32).background(Theme.elevated, in: RoundedRectangle(cornerRadius: 6))
        TextField(fallback.isEmpty ? "https://…" : fallback, text: Binding(get: { style[keyPath: path] }, set: { style[keyPath: path] = $0 }))
          .textFieldStyle(.linear).inputHints(.url, capitalization: .never).autocorrectionDisabled()
      }
    }
  }
}

/// A resolved style drawn once in light and once in dark (StylePreview.vue): a tag, a title and a line of text on a card.
struct ProjectStylePreview: View {
  let style: ResolvedStyle

  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 12) { frame(dark: false); frame(dark: true) }
      VStack(spacing: 12) { frame(dark: false); frame(dark: true) }
    }
    .accessibilityHidden(true)
  }

  private func frame(dark: Bool) -> some View {
    let palette = dark ? style.dark : style.light
    let color = { (hex: String) in Color(hexString: hex) ?? .clear }
    let radius = CGFloat(style.radius)
    let logo = dark ? style.logoDarkUrl : style.logoUrl
    return VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        if let url = URL(string: logo), !logo.isEmpty { AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { Color.clear }.frame(width: 24, height: 24) }
        Text("New").font(.system(size: 10, weight: .semibold)).padding(.horizontal, 6).padding(.vertical, 1)
          .background(color(palette.accent), in: Capsule()).foregroundStyle(OnboardingPreview.readable(on: palette.accent))
      }
      Text("What shipped this week").font(.system(size: 14, weight: .semibold))
      Text("A short line of what changed, set in your style.").font(.system(size: 12)).foregroundStyle(color(palette.muted))
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(color(palette.surface), in: RoundedRectangle(cornerRadius: radius))
    .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(color(palette.border)))
    .modifier(StyleShadow(layers: ProjectStyleOptions.shadowLayers[style.shadow] ?? []))
    .padding(14)
    .background(color(palette.background), in: RoundedRectangle(cornerRadius: radius))
    .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(color(palette.border)))
    .foregroundStyle(color(palette.text))
    .fontDesign(style.fontDesign)
    .environment(\.colorScheme, dark ? .dark : .light)
  }
}

private struct StyleShadow: ViewModifier {
  let layers: [(y: CGFloat, blur: CGFloat, opacity: Double)]
  func body(content: Content) -> some View {
    layers.reduce(AnyView(content)) { view, layer in AnyView(view.shadow(color: .black.opacity(layer.opacity), radius: layer.blur / 2, y: layer.y)) }
  }
}

#Preview("Style rules") {
  ResolvedStyle.selfCheck()
  return Text("ProjectStyle checks passed").padding()
}
