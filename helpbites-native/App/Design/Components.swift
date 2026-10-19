import SwiftUI

// The panel's building blocks, shared by every screen. Shapes follow Linear:
// pill buttons and chips, 8pt fields, 12pt cards, 44pt rows, hairline borders.

// MARK: - Buttons

/// Indigo pill with white text in both themes: the one primary action on a screen.
struct PrimaryButtonStyle: ButtonStyle {
  var compact = false
  @Environment(\.isEnabled) private var isEnabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(compact ? .lnMetaMedium : .system(size: 15, weight: .medium))
      .foregroundStyle(.white)
      .padding(.horizontal, compact ? 12 : 16)
      .frame(minHeight: compact ? 30 : 40)
      .background(Theme.accent.opacity(configuration.isPressed ? 0.85 : 1), in: Capsule())
      .opacity(isEnabled ? 1 : 0.5)
      .contentShape(Capsule())
  }
}

/// Bordered pill for secondary actions ("New project", "Open in inbox").
struct SecondaryButtonStyle: ButtonStyle {
  var compact = false
  @Environment(\.isEnabled) private var isEnabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(compact ? .lnMetaMedium : .system(size: 15, weight: .medium))
      .foregroundStyle(Theme.text)
      .padding(.horizontal, compact ? 12 : 16)
      .frame(minHeight: compact ? 30 : 40)
      .background(configuration.isPressed ? Theme.elevated : Color.clear, in: Capsule())
      .overlay(Capsule().strokeBorder(Theme.border))
      .opacity(isEnabled ? 1 : 0.5)
      .contentShape(Capsule())
  }
}

/// Text-only action that tints on press ("Cancel", "Forgot password?").
struct GhostButtonStyle: ButtonStyle {
  var tint: Color = Theme.textMuted
  @Environment(\.isEnabled) private var isEnabled
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.lnMetaMedium)
      .foregroundStyle(tint)
      .padding(.horizontal, 10)
      .frame(minHeight: 30)
      .background(configuration.isPressed ? Theme.elevated : Color.clear, in: Capsule())
      .opacity(isEnabled ? 1 : 0.5)
      .contentShape(Capsule())
  }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
  static var lnPrimary: PrimaryButtonStyle { PrimaryButtonStyle() }
  static var lnPrimaryCompact: PrimaryButtonStyle { PrimaryButtonStyle(compact: true) }
}
extension ButtonStyle where Self == SecondaryButtonStyle {
  static var lnSecondary: SecondaryButtonStyle { SecondaryButtonStyle() }
  static var lnSecondaryCompact: SecondaryButtonStyle { SecondaryButtonStyle(compact: true) }
}
extension ButtonStyle where Self == GhostButtonStyle {
  static var lnGhost: GhostButtonStyle { GhostButtonStyle() }
}

/// Round icon button with a hairline ring, like Linear's toolbar icons.
struct IconButton: View {
  let systemImage: String
  let label: String
  var bordered = false
  let action: () -> Void
  var body: some View {
    Button(action: action) {
      Image(systemName: systemImage)
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(Theme.textMuted)
        .frame(width: 32, height: 32)
        .overlay { if bordered { Circle().strokeBorder(Theme.border) } }
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(Text(label))
  }
}

// MARK: - Chips

/// Linear's view pill: "Active · Backlog · All issues", with an optional count.
struct Pill: View {
  let label: String
  var count: Int? = nil
  var systemImage: String? = nil
  var isActive = false
  let action: () -> Void
  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if let systemImage { Image(systemName: systemImage).font(.system(size: 11, weight: .semibold)) }
        Text(label)
        if let count { Text("\(count)").monospacedDigit().foregroundStyle(Theme.textDimmed) }
      }
      .font(.lnMetaMedium)
      .foregroundStyle(isActive ? Theme.textHighlighted : Theme.textMuted)
      .padding(.horizontal, 12)
      .frame(height: 30)
      .background(isActive ? Theme.elevated : Color.clear, in: Capsule())
      .overlay(Capsule().strokeBorder(isActive ? Theme.borderAccented : Theme.border))
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(isActive ? .isSelected : [])
  }
}

/// A non-interactive label chip ("billing", "Master").
struct Tag: View {
  let text: String
  var tint: Color? = nil
  var body: some View {
    HStack(spacing: 5) {
      if let tint { Circle().fill(tint).frame(width: 6, height: 6) }
      Text(text).lineLimit(1)
    }
    .font(.lnCaptionMedium)
    .foregroundStyle(Theme.textToned)
    .padding(.horizontal, 8)
    .frame(height: 22)
    .overlay(Capsule().strokeBorder(Theme.border))
  }
}

// MARK: - Fields

/// 8pt bordered field on a slightly lifted fill.
struct LinearFieldStyle: TextFieldStyle {
  func _body(configuration: TextField<Self._Label>) -> some View {
    configuration
      .font(.lnBody)
      .padding(.horizontal, 12)
      .frame(minHeight: 40)
      .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }
}

extension TextFieldStyle where Self == LinearFieldStyle {
  static var linear: LinearFieldStyle { LinearFieldStyle() }
}

/// A labelled form row: a quiet label, the control, then an optional hint.
struct LabeledField<Content: View>: View {
  let label: String
  var hint: String? = nil
  @ViewBuilder let content: () -> Content
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label).font(.lnMetaMedium).foregroundStyle(Theme.textToned)
      content()
      if let hint { Text(hint).font(.lnCaption).foregroundStyle(Theme.textMuted) }
    }
  }
}

/// Multi-line field with the same frame as `.linear`.
struct LinearTextEditor: View {
  @Binding var text: String
  var placeholder = ""
  var minHeight: CGFloat = 96
  var monospaced = false
  var body: some View {
    ZStack(alignment: .topLeading) {
      if text.isEmpty {
        Text(placeholder).font(monospaced ? .lnMono : .lnBody).foregroundStyle(Theme.textDimmed).padding(.horizontal, 12).padding(.vertical, 10)
      }
      TextEditor(text: $text)
        .font(monospaced ? .lnMono : .lnBody)
        .scrollContentBackground(.hidden)
        .padding(.horizontal, 7).padding(.vertical, 2)
    }
    .frame(minHeight: minHeight)
    .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }
}

/// The search field above a list.
struct SearchField: View {
  @Binding var text: String
  var prompt = "Search"
  var onSubmit: () -> Void = {}
  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.textDimmed)
      TextField(prompt, text: $text).font(.lnCallout).submitLabel(.search).onSubmit(onSubmit).autocorrectionDisabled()
      if !text.isEmpty {
        Button { text = ""; onSubmit() } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textDimmed) }.buttonStyle(.plain).accessibilityLabel("Clear search")
      }
    }
    .padding(.horizontal, 10)
    .frame(height: 34)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
  }
}

// MARK: - Structure

/// Small grey caption above a block: Linear's sentence-case section labels.
struct SectionLabel: View {
  let text: String
  init(_ text: String) { self.text = text }
  var body: some View {
    Text(text).font(.lnCaptionMedium).foregroundStyle(Theme.textMuted).frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// A settings block: rounded, hairline-bordered, rows separated by dividers.
struct Card<Content: View>: View {
  @ViewBuilder let content: () -> Content
  var body: some View {
    VStack(spacing: 0) { content() }
      .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }
}

/// One row inside a `Card`, with the divider Linear draws between rows.
struct CardRow<Content: View>: View {
  var divider = true
  @ViewBuilder let content: () -> Content
  var body: some View {
    VStack(spacing: 0) {
      content().padding(.horizontal, 14).padding(.vertical, 11).frame(maxWidth: .infinity, alignment: .leading)
      if divider { Rectangle().fill(Theme.border).frame(height: 1 / UIScreen.main.scale).padding(.leading, 14) }
    }
  }
}

/// A list group header ("Open 4"): grey band with the status glyph and count.
struct GroupHeader: View {
  let title: String
  var count: Int? = nil
  var leading: AnyView? = nil
  var body: some View {
    HStack(spacing: 8) {
      if let leading { leading }
      Text(title).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
      if let count { Text("\(count)").font(.lnMeta).monospacedDigit().foregroundStyle(Theme.textMuted) }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 12)
    .frame(height: 34)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
  }
}

/// Linear's empty view: a quiet glyph in a bordered tile, what goes here, and the action that fills it.
struct EmptyState<Actions: View>: View {
  let systemImage: String
  let title: String
  var message: String? = nil
  @ViewBuilder var actions: () -> Actions
  var body: some View {
    VStack(spacing: 0) {
      Image(systemName: systemImage)
        .font(.system(size: 18, weight: .regular))
        .foregroundStyle(Theme.textMuted)
        .frame(width: 48, height: 48)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
        .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
      Text(title).font(.lnRow).foregroundStyle(Theme.textHighlighted).padding(.top, 16)
      if let message { Text(message).font(.lnMeta).foregroundStyle(Theme.textMuted).multilineTextAlignment(.center).padding(.top, 4).frame(maxWidth: 320) }
      HStack(spacing: 8) { actions() }.padding(.top, 20)
    }
    .padding(.horizontal, 24).padding(.vertical, 48)
    .frame(maxWidth: .infinity)
  }
}

extension EmptyState where Actions == EmptyView {
  init(systemImage: String, title: String, message: String? = nil) {
    self.init(systemImage: systemImage, title: title, message: message) { EmptyView() }
  }
}

/// Inline error line in the panel's voice.
struct ErrorText: View {
  let message: String
  var body: some View {
    if !message.isEmpty {
      Label(message, systemImage: "exclamationmark.circle").font(.lnMeta).foregroundStyle(Theme.error)
    }
  }
}

/// Placeholder rows while a list loads.
struct SkeletonRows: View {
  var count = 5
  var body: some View {
    VStack(spacing: 8) {
      ForEach(0..<count, id: \.self) { _ in
        RoundedRectangle(cornerRadius: Metrics.radius).fill(Theme.elevated).frame(height: 36)
      }
    }
    .padding(Metrics.gutter)
    .redacted(reason: .placeholder)
  }
}

/// A scrollable monospaced snippet, like the web panel's code blocks.
struct CodeBlock: View {
  let code: String
  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      Text(code).font(.lnMono).foregroundStyle(Theme.text).textSelection(.enabled).padding(12)
    }
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(alignment: .topTrailing) {
      Button { UIPasteboard.general.string = code } label: { Image(systemName: "doc.on.doc").font(.system(size: 12)).foregroundStyle(Theme.textMuted).padding(8) }
        .buttonStyle(.plain).accessibilityLabel("Copy code")
    }
  }
}

// MARK: - Screen chrome

extension View {
  /// The raised panel every screen sits on, with a quiet inline navigation bar.
  func panelScreen(_ title: String) -> some View {
    self
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbarBackground(Theme.panel, for: .navigationBar)
      .toolbarBackground(.visible, for: .navigationBar)
      .background(Theme.panel)
  }

  /// A List styled as Linear's flat rows on the panel.
  func linearList() -> some View {
    self
      .listStyle(.plain)
      .scrollContentBackground(.hidden)
      .background(Theme.panel)
  }

  /// One flat row inside `linearList()`.
  func linearRow(selected: Bool = false) -> some View {
    self
      .listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
      .listRowSeparator(.hidden)
      .listRowBackground(
        RoundedRectangle(cornerRadius: Metrics.radius)
          .fill(selected ? Theme.accented : Color.clear)
          .padding(.horizontal, 6)
      )
  }
}

// MARK: - Layout & formatting

/// Left-to-right wrapping layout (flex-wrap) for a row of pills.
struct FlowLayout: Layout {
  var spacing: CGFloat = 8
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
    let maxWidth = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x + size.width > maxWidth, x > 0 { x = 0; y += rowHeight + spacing; rowHeight = 0 }
      x += size.width + spacing
      rowHeight = max(rowHeight, size.height)
    }
    return CGSize(width: maxWidth.isFinite ? maxWidth : x, height: y + rowHeight)
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
    var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x + size.width > bounds.width, x > 0 { x = 0; y += rowHeight + spacing; rowHeight = 0 }
      view.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      rowHeight = max(rowHeight, size.height)
    }
  }
}

/// Dates as the server sends them (ISO 8601 strings, or epoch milliseconds for
/// email templates), formatted the way the panel shows them.
@MainActor enum DateText {
  static let iso: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
  static let isoPlain: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()

  static func date(_ raw: String?) -> Date? {
    guard let raw, !raw.isEmpty else { return nil }
    return iso.date(from: raw) ?? isoPlain.date(from: raw)
  }

  /// "now", "5m", "3h", "2d", then "Sep 12".
  static func short(_ raw: String?) -> String {
    guard let date = date(raw) else { return "" }
    return short(date)
  }

  static func short(_ date: Date) -> String {
    let seconds = Date().timeIntervalSince(date)
    if seconds < 45 { return "now" }
    if seconds < 3600 { return "\(max(1, Int(seconds / 60)))m" }
    if seconds < 86400 { return "\(Int(seconds / 3600))h" }
    if seconds < 604800 { return "\(Int(seconds / 86400))d" }
    return date.formatted(.dateTime.month(.abbreviated).day())
  }

  /// "Sep 12, 2026".
  static func day(_ raw: String?) -> String {
    guard let date = date(raw) else { return "" }
    return date.formatted(.dateTime.month(.abbreviated).day().year())
  }

  static func day(epochMilliseconds: Double) -> String {
    Date(timeIntervalSince1970: epochMilliseconds / 1000).formatted(.dateTime.month(.abbreviated).day().year())
  }
}

/// Full-screen image preview with pinch-to-zoom and double-tap to reset.
struct ImagePreview: View {
  let url: URL
  @Environment(\.dismiss) private var dismiss
  @State private var steady: CGFloat = 1
  @GestureState private var pinch: CGFloat = 1
  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      AsyncImage(url: url) { image in
        image.resizable().scaledToFit()
          .scaleEffect(steady * pinch)
          .gesture(MagnifyGesture().updating($pinch) { value, state, _ in state = value.magnification }.onEnded { value in steady = min(max(steady * value.magnification, 1), 5) })
          .onTapGesture(count: 2) { withAnimation { steady = 1 } }
      } placeholder: { ProgressView().tint(.white) }
    }
    .overlay(alignment: .topTrailing) {
      Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.title).foregroundStyle(.white, .white.opacity(0.25)) }.padding().accessibilityLabel("Close")
    }
    .statusBarHidden()
  }
}

struct PreviewItem: Identifiable { let id = UUID(); let url: URL }
