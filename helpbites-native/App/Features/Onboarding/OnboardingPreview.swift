import SwiftUI

/// The working copy as an app draws it: `HelpBitesOnboardingView` from
/// docs/ONBOARDING.md inside a phone-sized frame, with a pager, a light/dark switch and, once the flow has translations, a language picker.
struct OnboardingPreview: View {
  /// The steps in the flow's own language.
  let source: [OnboardingStep]
  /// The flow's own language, and its translations by language (a translated word replaces the original, a missing one stays).
  var locale = ContentLocale.defaultTag
  var translations: [String: OnboardingTranslation] = [:]
  let style: OnboardingStyle
  let options: OnboardingOptions
  /// The project's accent, for a flow that leaves `style.accent` empty.
  let projectAccent: String?
  /// The project's published pricing tables by key, for steps that show one.
  var pricing: [String: PublicPricingTable] = [:]
  @State private var index = 0
  @State private var dark = false
  /// A language of `translations`; nil shows the flow's own.
  @State private var language: String?

  private var steps: [OnboardingStep] {
    guard let language, let translation = translations[language] else { return source }
    return translation.localized(name: "", steps: source).steps
  }
  private var current: Int { min(index, max(steps.count - 1, 0)) }

  var body: some View {
    VStack(spacing: 14) {
      Picker("Appearance", selection: $dark) {
        Label("Light", systemImage: "sun.max").tag(false)
        Label("Dark", systemImage: "moon").tag(true)
      }
      .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 200)

      if !translations.isEmpty {
        Picker("Language", selection: $language) {
          Text(ContentLocale.name(locale)).tag(String?.none)
          ForEach(translations.keys.sorted(), id: \.self) { Text(ContentLocale.name($0)).tag(Optional($0)) }
        }
        .pickerStyle(.menu).labelsHidden()
      }

      Group {
        if steps.isEmpty {
          Text("Add a step to see it here.").font(.lnMeta).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          screen(steps[current], at: current)
        }
      }
      .frame(width: 300, height: 560)
      .background(Self.color(style.background) ?? (dark ? Color(white: 0.11) : .white))
      .clipShape(RoundedRectangle(cornerRadius: 36, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 36, style: .continuous).strokeBorder(Theme.borderAccented, lineWidth: 4))
      .environment(\.colorScheme, dark ? .dark : .light)

      HStack(spacing: 12) {
        IconButton(systemImage: "chevron.left", label: "Previous step", bordered: true) { index = max(current - 1, 0) }.disabled(current == 0)
        Text(steps.isEmpty ? "No steps" : "Step \(current + 1) of \(steps.count)").font(.lnMeta).foregroundStyle(Theme.textMuted).monospacedDigit()
        IconButton(systemImage: "chevron.right", label: "Next step", bordered: true) { index = min(current + 1, steps.count - 1) }.disabled(current >= steps.count - 1)
      }
    }
    .frame(maxWidth: .infinity)
    .onChange(of: translations.keys.sorted()) { _, tags in
      if let language, !tags.contains(language) { self.language = nil }
    }
  }

  private func screen(_ step: OnboardingStep, at index: Int) -> some View {
    let last = index == steps.count - 1
    let plans = step.pricingTable.isEmpty ? nil : pricing[step.pricingTable]
    let hex = style.accent.isEmpty ? (projectAccent ?? "") : style.accent
    let tint = Self.color(hex) ?? Theme.accent
    let onTint = Self.color(hex) == nil ? Color.white : Self.readable(on: hex)
    let radius = CGFloat(style.radius)
    return VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 5) {
        if options.progress != "none" && steps.count > 1 {
          ForEach(steps.indices, id: \.self) { i in
            let dots = options.progress == "dots"
            Capsule().fill(i == index || (!dots && i < index) ? tint : Color.secondary.opacity(0.2))
              .frame(width: dots ? (i == index ? 18 : 6) : nil, height: dots ? 6 : 3)
              .frame(maxWidth: dots ? nil : .infinity)
          }
        }
        Spacer(minLength: 12)
        if options.skippable && !last { Button("Skip") { self.index = 0 }.buttonStyle(.plain).foregroundStyle(.secondary) }
      }
      .frame(minHeight: Metrics.scaled(28))
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if let url = URL(string: step.imageUrl), !step.imageUrl.isEmpty {
            CachedAsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { Color.clear }
              .frame(maxWidth: .infinity).aspectRatio(4 / 3, contentMode: .fit)
              .background(tint.opacity(0.1), in: .rect(cornerRadius: max(0, radius - 8)))
              .accessibilityLabel(step.imageAlt)
          }
          Text(step.title).font(.title2.weight(.semibold))
          Text(step.body).foregroundStyle(.secondary)
          // A step with a pricing table shows its plans (as onboarding.js does, narrow), drawn with the flow's accent.
          if let table = plans { PricingTableView(table: table, accent: hex.isEmpty ? nil : tint, compact: true) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .scrollIndicators(.hidden)
      HStack(spacing: 10) {
        if index > 0 { Button("Back") { withAnimation { self.index = index - 1 } }.buttonStyle(.bordered).controlSize(.large) }
        Button {
          withAnimation { self.index = last ? 0 : index + 1 }
        } label: {
          Text(step.buttonLabel.isEmpty ? (last ? "Get started" : "Continue") : step.buttonLabel).fontWeight(.semibold)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(plans == nil ? AnyShapeStyle(tint) : AnyShapeStyle(Color.secondary.opacity(0.12)), in: .rect(cornerRadius: max(6, radius * 0.6)))
            .foregroundStyle(plans == nil ? onTint : Color.primary)
        }
        .buttonStyle(.plain)
      }
    }
    .padding(24)
    .padding(.top, 12)
    .fontDesign(Self.designs[style.font] ?? .default)
    .foregroundStyle(Self.color(style.text).map { AnyShapeStyle($0) } ?? AnyShapeStyle(.primary))
    .tint(tint)
  }

  private static let designs: [String: Font.Design] = ["rounded": .rounded, "serif": .serif, "mono": .monospaced]

  /// Only `#rrggbb`, as the server stores it.
  static func color(_ hex: String) -> Color? { hex.count == 7 ? Color(hexString: hex) : nil }

  /// Black or white, whichever reads better on `hex` (the snippet's and shared/brand.ts's `readableOn`).
  static func readable(on hex: String) -> Color {
    let v = Int(hex.dropFirst(), radix: 16) ?? 0
    let lin = { (c: Int) -> Double in let s = Double(c) / 255; return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4) }
    return 0.2126 * lin(v >> 16 & 255) + 0.7152 * lin(v >> 8 & 255) + 0.0722 * lin(v & 255) > 0.179 ? .black : .white
  }
}
