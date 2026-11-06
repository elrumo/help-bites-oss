import Observation
import SwiftUI

/// The text size picked in Settings (and View › Make Text Bigger/Smaller on the Mac): one factor every
/// font in the app is multiplied by. Fonts read it through `Font.app(size:)` and the `ln*` styles, so a
/// view that sets a font redraws on its own when the size changes (Observation tracks the read).
@MainActor @Observable final class TextScale {
  static let shared = TextScale()

  /// The steps, as percentages of the design sizes in Theme.swift.
  static let steps: [Int] = [85, 92, 100, 110, 120, 135, 150]
  /// The Mac starts a step up: its windows sit further away than a phone, and the panel's 12–13pt
  /// metadata read small there. iPhone and iPad start at the design size.
  #if os(macOS)
  static let standard = 110
  #else
  static let standard = 100
  #endif
  private static let key = "hb-text-size"

  private(set) var percent: Int
  /// What a design size is multiplied by.
  private(set) var factor: CGFloat

  private init() {
    let saved = UserDefaults.standard.integer(forKey: Self.key)
    let value = Self.steps.contains(saved) ? saved : Self.standard
    percent = value
    factor = CGFloat(value) / 100
  }

  func set(_ value: Int) {
    guard Self.steps.contains(value), value != percent else { return }
    percent = value
    factor = CGFloat(value) / 100
    UserDefaults.standard.set(value, forKey: Self.key)
  }

  var canGrow: Bool { percent < Self.steps.last! }
  var canShrink: Bool { percent > Self.steps.first! }
  func grow() { if let next = Self.steps.first(where: { $0 > percent }) { set(next) } }
  func shrink() { if let previous = Self.steps.last(where: { $0 < percent }) { set(previous) } }
  func reset() { set(Self.standard) }

  /// A design size in points at the current text size. Nothing drops below 10pt before scaling:
  /// the 9pt glyphs some rows used were unreadable on a Mac.
  func points(_ size: CGFloat) -> CGFloat { (max(size, 10) * factor).rounded(.toNearestOrEven) }

#if os(macOS)
  /// The sidebar's own row size (icon and label), so it grows with the rest of the window.
  var sidebarRowSize: SidebarRowSize { percent < 100 ? .small : percent < 120 ? .medium : .large }
#endif
}

extension Font {
  /// The system font at a design size, scaled to the text size the user picked. Use it instead of
  /// `.system(size:)` everywhere in the app.
  /// Callable from styles SwiftUI declares nonisolated (TextFieldStyle); fonts are only built on the main thread.
  static func app(size: CGFloat, weight: Font.Weight? = nil, design: Font.Design? = nil) -> Font {
    .system(size: MainActor.assumeIsolated { TextScale.shared.points(size) }, weight: weight, design: design)
  }
}

/// View › text size on the Mac (and the iPad's ⌘ menu), as in Safari and Mail.
struct TextSizeCommands: Commands {
  var body: some Commands {
    CommandGroup(after: .toolbar) {
      Divider()
      Button("Make Text Bigger") { TextScale.shared.grow() }.keyboardShortcut("+")
      Button("Make Text Smaller") { TextScale.shared.shrink() }.keyboardShortcut("-")
      Button("Actual Size") { TextScale.shared.reset() }.keyboardShortcut("0", modifiers: [.command, .option])
    }
  }
}

/// The Settings control: smaller and larger steps either side of a sample line.
struct TextSizePicker: View {
  @State private var scale = TextScale.shared
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        Button { scale.shrink() } label: { Image(systemName: "textformat.size.smaller").frame(width: 28, height: 28) }
          .buttonStyle(.plain).foregroundStyle(Theme.textMuted).disabled(!scale.canShrink).accessibilityLabel("Make text smaller")
        Slider(value: Binding(
          get: { Double(TextScale.steps.firstIndex(of: scale.percent) ?? 0) },
          set: { scale.set(TextScale.steps[Int($0.rounded())]) }
        ), in: 0...Double(TextScale.steps.count - 1), step: 1)
        Button { scale.grow() } label: { Image(systemName: "textformat.size.larger").frame(width: 28, height: 28) }
          .buttonStyle(.plain).foregroundStyle(Theme.textMuted).disabled(!scale.canGrow).accessibilityLabel("Make text bigger")
      }
      HStack {
        Text("Conversations, cards and lists use this size.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        Spacer(minLength: 8)
        Text("\(scale.percent)%").font(.lnMetaMedium).monospacedDigit().foregroundStyle(Theme.textToned)
        if scale.percent != TextScale.standard { Button("Reset") { scale.reset() }.buttonStyle(.lnGhost) }
      }
    }
  }
}
