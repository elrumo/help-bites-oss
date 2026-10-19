import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// The native email editor's inspector controls (web: EmailColorField.vue and
// the field patterns in EmailInspector.vue). Each takes a binding straight
// from EmailEditorStore; text someone is still typing stays local until it is
// a value the email can use. `label` names a control for VoiceOver; the
// inspector puts the visible label above it with LabeledField.

// MARK: - Colour

/// A swatch that opens the system colour picker, beside the hex it stands for.
/// Typed text applies once it is a full hex colour (`#rgb`, `#rrggbb`, either
/// with alpha) or `transparent`, and is kept as typed: only picking a new colour
/// writes a plain `#rrggbb`. `clearable` adds a reset back to the email's own
/// colour (nil), as does emptying the text.
struct EmailColorField: View {
  let label: String
  @Binding var color: String?
  let clearable: Bool
  let placeholder: String
  @State private var text: String
  @FocusState private var focused: Bool

  init(label: String, color: Binding<String?>, clearable: Bool = false, placeholder: String = "Default") {
    self.label = label
    _color = color
    self.clearable = clearable
    self.placeholder = placeholder
    _text = State(initialValue: color.wrappedValue ?? "")
  }

  /// A colour that is always set (a theme token, a button's fill): emptying the text leaves it as it was.
  init(label: String, color: Binding<String>, placeholder: String = "Default") {
    self.init(
      label: label,
      color: Binding<String?>(
        get: { color.wrappedValue.isEmpty ? nil : color.wrappedValue },
        set: { value in if let value { color.wrappedValue = value } }
      ),
      clearable: false,
      placeholder: placeholder
    )
  }

  var body: some View {
    HStack(spacing: 8) {
      ColorPicker(label, selection: swatch, supportsOpacity: false)
        .labelsHidden()
        .frame(width: 36, height: 40)
      TextField(placeholder, text: $text)
        .textFieldStyle(.linear)
        .monospaced()
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .focused($focused)
        .accessibilityLabel(Text("\(label) hex"))
      if clearable, color != nil {
        Button { color = nil } label: {
          Image(systemName: "xmark.circle.fill")
            .font(.system(size: 16))
            .foregroundStyle(Theme.textDimmed)
            .frame(width: 36, height: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Reset \(label.lowercased())"))
      }
    }
    .onChange(of: text) { _, typed in commit(typed) }
    .onChange(of: color) { _, latest in
      if Self.normalized(text) != Self.normalized(latest ?? "") { text = latest ?? "" }
    }
    // Half-typed hex goes back to the colour in use once the field is left.
    .onChange(of: focused) { _, isFocused in
      if !isFocused { text = color ?? "" }
    }
  }

  private func commit(_ typed: String) {
    let value = typed.trimmingCharacters(in: .whitespaces)
    if value.isEmpty {
      if clearable, color != nil { color = nil }
    } else if Self.isHex(value), value != color {
      color = value
    }
  }

  private var swatch: Binding<Color> {
    Binding<Color>(
      get: { Color(hexString: color) ?? Color.clear },
      set: { picked in
        let hex = picked.hexString
        color = hex
        text = hex
      }
    )
  }

  /// EmailColorField.vue's COLOR: `#rgb`, `#rrggbb`, either with alpha, or `transparent`.
  nonisolated static func isHex(_ value: String) -> Bool {
    value.wholeMatch(of: #/#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent/#.ignoresCase()) != nil
  }

  nonisolated private static func normalized(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespaces).lowercased()
  }
}

// MARK: - Shadow

/// A CSS box-shadow, typed or picked from the presets (emailBlocks.ts
/// EMAIL_SHADOWS). Text stays as typed while editing; it's stored trimmed, and
/// empty removes the shadow.
struct EmailShadowField: View {
  @Binding var shadow: String?
  @State private var text: String

  /// EMAIL_SHADOWS.
  static let presets: [(label: String, value: String)] = [
    ("Subtle", "0 2px 4px rgba(0, 0, 0, 0.1)"),
    ("Soft", "0 10px 30px rgba(20, 35, 60, 0.08)"),
    ("Lifted", "0 4px 10px rgba(0, 0, 0, 0.2)")
  ]

  init(shadow: Binding<String?>) {
    _shadow = shadow
    _text = State(initialValue: shadow.wrappedValue ?? "")
  }

  var body: some View {
    HStack(spacing: 8) {
      TextField("None", text: $text)
        .textFieldStyle(.linear)
        .monospaced()
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .accessibilityLabel(Text("Shadow"))
      Menu {
        Button("None") { pick(nil) }
        ForEach(Self.presets, id: \.value) { preset in
          Button { pick(preset.value) } label: {
            Text(preset.label)
            Text(preset.value)
          }
        }
      } label: {
        Image(systemName: "chevron.down")
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(Theme.textToned)
          .frame(width: 40, height: 40)
          .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
          .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
          .contentShape(Rectangle())
      }
      .accessibilityLabel(Text("Shadow presets"))
    }
    .onChange(of: text) { _, typed in
      let value = typed.trimmingCharacters(in: .whitespacesAndNewlines)
      let next: String? = value.isEmpty ? nil : value
      if next != shadow { shadow = next }
    }
    // A preset, an undo or another editor changed it.
    .onChange(of: shadow) { _, latest in
      if text.trimmingCharacters(in: .whitespacesAndNewlines) != (latest ?? "") { text = latest ?? "" }
    }
  }

  private func pick(_ value: String?) {
    shadow = value
    text = value ?? ""
  }
}

// MARK: - Numbers

/// A number typed on the decimal pad, with a stepper beside it. Typed values
/// apply as soon as they are inside `range`; leaving the field clamps what's
/// there. Empty text is nil (the renderer's default) for the optional field,
/// and the placeholder is where the stepper starts from when nothing is set.
struct EmailNumberField: View {
  let label: String
  @Binding var value: Double?
  let placeholder: String
  let range: ClosedRange<Double>
  let step: Double
  let showsStepper: Bool
  @State private var text: String
  @FocusState private var focused: Bool

  init(label: String, value: Binding<Double?>, placeholder: String = "", range: ClosedRange<Double> = 0...9999, step: Double = 1, showsStepper: Bool = true) {
    self.label = label
    _value = value
    self.placeholder = placeholder
    self.range = range
    self.step = step
    self.showsStepper = showsStepper
    _text = State(initialValue: value.wrappedValue.map { Self.format($0) } ?? "")
  }

  /// A number that is always set: emptying the text leaves it as it was.
  init(label: String, value: Binding<Double>, placeholder: String = "", range: ClosedRange<Double> = 0...9999, step: Double = 1, showsStepper: Bool = true) {
    self.init(
      label: label,
      value: Binding<Double?>(
        get: { value.wrappedValue },
        set: { new in if let new { value.wrappedValue = new } }
      ),
      placeholder: placeholder,
      range: range,
      step: step,
      showsStepper: showsStepper
    )
  }

  var body: some View {
    HStack(spacing: 8) {
      TextField(placeholder, text: $text)
        .textFieldStyle(.linear)
        .keyboardType(.decimalPad)
        .monospacedDigit()
        .focused($focused)
        .onSubmit { finish() }
        .accessibilityLabel(Text(label))
      if showsStepper {
        Stepper(label, value: stepperValue, in: range, step: step)
          .labelsHidden()
          .fixedSize()
      }
    }
    .onChange(of: text) { _, typed in apply(typed) }
    .onChange(of: focused) { _, isFocused in
      if !isFocused { finish() }
    }
    // The stepper, an undo or another editor changed it: show the new value
    // (while typing, only when it isn't what the text already says).
    .onChange(of: value) { _, latest in
      if !focused || Self.parse(text) != latest { text = latest.map { Self.format($0) } ?? "" }
    }
  }

  private func apply(_ typed: String) {
    let trimmed = typed.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty {
      if value != nil { value = nil }
    } else if let number = Self.parse(trimmed), range.contains(number), number != value {
      value = number
    }
  }

  private func finish() {
    if let number = Self.parse(text) {
      let clamped = clamp(number)
      if clamped != value { value = clamped }
    }
    text = value.map { Self.format($0) } ?? ""
  }

  private var stepperValue: Binding<Double> {
    Binding<Double>(
      get: { clamp(value ?? Double(placeholder) ?? range.lowerBound) },
      set: { new in value = clamp(new) }
    )
  }

  private func clamp(_ number: Double) -> Double {
    min(max(number, range.lowerBound), range.upperBound)
  }

  /// A typed number; a decimal comma counts as a point.
  nonisolated static func parse(_ text: String) -> Double? {
    let cleaned = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
    guard let number = Double(cleaned), number.isFinite else { return nil }
    return number
  }

  /// "16", or "1.5": what the web shows.
  nonisolated static func format(_ number: Double) -> String {
    EmailRender.js(number)
  }
}

// MARK: - Choices

/// Equal-width choices in one row: a segmented control with comfortable targets.
struct EmailSegmentedPicker<Value: Hashable>: View {
  @Binding var selection: Value
  let options: [Value]
  let title: (Value) -> String
  let systemImage: ((Value) -> String)?

  init(selection: Binding<Value>, options: [Value], title: @escaping (Value) -> String, systemImage: ((Value) -> String)? = nil) {
    _selection = selection
    self.options = options
    self.title = title
    self.systemImage = systemImage
  }

  var body: some View {
    HStack(spacing: 2) {
      ForEach(options, id: \.self) { option in
        segment(option)
      }
    }
    .padding(2)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  private func segment(_ option: Value) -> some View {
    let active = option == selection
    return Button { selection = option } label: {
      Group {
        if let systemImage {
          Image(systemName: systemImage(option)).font(.system(size: 15, weight: .medium))
        } else {
          Text(title(option)).font(.lnMetaMedium)
        }
      }
      .foregroundStyle(active ? Theme.textHighlighted : Theme.textMuted)
      .frame(maxWidth: .infinity, minHeight: 40)
      .background(active ? Theme.field : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radiusSmall))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(Text(title(option)))
    .accessibilityAddTraits(active ? .isSelected : [])
  }
}

/// Left, center or right (the web's three alignment buttons).
struct EmailAlignPicker: View {
  @Binding var align: String

  init(align: Binding<String>) {
    _align = align
  }

  var body: some View {
    EmailSegmentedPicker(
      selection: $align,
      options: ["left", "center", "right"],
      title: { $0.capitalized },
      systemImage: { "text.align\($0)" }
    )
  }
}

// MARK: - Padding

/// One value for every side, or each side on its own (the web's padding
/// popover). Editing a side makes the padding per-side; typing a single value
/// makes every side that value again.
struct EmailPaddingField: View {
  @Binding var padding: EmailPadding
  @State private var showsSides: Bool

  init(padding: Binding<EmailPadding>) {
    _padding = padding
    _showsSides = State(initialValue: padding.wrappedValue.uniformValue == nil)
  }

  private enum Side: CaseIterable {
    case top, right, bottom, left

    var label: String {
      switch self {
      case .top: "Top"
      case .right: "Right"
      case .bottom: "Bottom"
      case .left: "Left"
      }
    }
  }

  var body: some View {
    let mixed = padding.uniformValue == nil
    VStack(alignment: .leading, spacing: 8) {
      EmailNumberField(label: "Padding", value: uniform, placeholder: mixed ? "Mixed" : "0", range: 0...400)
      Button {
        withAnimation(.easeInOut(duration: 0.2)) { showsSides.toggle() }
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "chevron.right")
            .font(.system(size: 11, weight: .semibold))
            .rotationEffect(.degrees(showsSides ? 90 : 0))
          Text("Sides")
          Spacer(minLength: 0)
        }
        .font(.lnMetaMedium)
        .foregroundStyle(Theme.textToned)
        .frame(minHeight: 36)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(Text(showsSides ? "Hide each side" : "Edit each side"))
      if showsSides {
        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
          GridRow {
            sideField(.top)
            sideField(.right)
          }
          GridRow {
            sideField(.bottom)
            sideField(.left)
          }
        }
      }
      if mixed {
        Text(summary).font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
    }
  }

  private var uniform: Binding<Double?> {
    Binding<Double?>(
      get: { padding.uniformValue },
      set: { value in if let value { padding = .uniform(value) } }
    )
  }

  private func sideField(_ side: Side) -> some View {
    LabeledField(label: side.label) {
      EmailNumberField(label: "\(side.label) padding", value: sideValue(side), placeholder: "0", range: 0...400, showsStepper: false)
    }
  }

  private func sideValue(_ side: Side) -> Binding<Double> {
    Binding<Double>(
      get: { Self.edge(side, of: padding) },
      set: { value in padding = Self.setting(side, to: value, in: padding) }
    )
  }

  /// The web's summary under a mixed padding.
  private var summary: String {
    let e = padding.edges
    return "Top \(EmailRender.js(e.top))px, right \(EmailRender.js(e.right))px, bottom \(EmailRender.js(e.bottom))px, left \(EmailRender.js(e.left))px"
  }

  private static func edge(_ side: Side, of current: EmailPadding) -> Double {
    let e = current.edges
    switch side {
    case .top: return e.top
    case .right: return e.right
    case .bottom: return e.bottom
    case .left: return e.left
    }
  }

  private static func setting(_ side: Side, to value: Double, in current: EmailPadding) -> EmailPadding {
    var e = current.edges
    switch side {
    case .top: e.top = value
    case .right: e.right = value
    case .bottom: e.bottom = value
    case .left: e.left = value
    }
    return .sides(top: e.top, right: e.right, bottom: e.bottom, left: e.left)
  }
}

// MARK: - Rich text

/// A text block's inline HTML, edited as source under a formatting bar: bold,
/// italic, underline, link, line break, a variable and clear formatting. The
/// bar works on the selection (or where the cursor last was; the end when it
/// has never been in the field), and the line underneath shows the result.
struct EmailRichTextField: View {
  @Binding var html: String
  let variables: [String]
  @State private var selection: TextSelection? = nil
  /// The last selection, as offsets: a menu or the link alert can take focus away.
  @State private var lastRange: Range<Int>? = nil
  @State private var askingLink = false
  @State private var linkURL = "https://"
  @State private var linkRange: Range<Int>? = nil

  init(html: Binding<String>, variables: [String]) {
    _html = html
    self.variables = variables
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      VStack(spacing: 0) {
        toolbar
        Rectangle().fill(Theme.border).frame(height: 1)
        TextEditor(text: $html, selection: $selection)
          .font(.system(size: 14, design: .monospaced))
          .scrollContentBackground(.hidden)
          .autocorrectionDisabled()
          .padding(.horizontal, 7)
          .padding(.vertical, 4)
          .frame(minHeight: 140)
      }
      .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
      if !html.isEmpty {
        Text(EmailInlineHTML.attributed(html))
          .font(.lnCaption)
          .foregroundStyle(Theme.textMuted)
          .lineLimit(4)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .onChange(of: selection) { _, latest in
      if let range = Self.offsets(of: latest, in: html) { lastRange = range }
    }
    .alert("Add a link", isPresented: $askingLink) {
      TextField("https://", text: $linkURL)
        .keyboardType(.URL)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
      Button("Add link") { addLink() }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("The selected text becomes the link.")
    }
  }

  // MARK: Formatting bar

  private var toolbar: some View {
    HStack(spacing: 0) {
      tool("bold", "Bold") { wrap("<b>", "</b>") }
      tool("italic", "Italic") { wrap("<i>", "</i>") }
      tool("underline", "Underline") { wrap("<u>", "</u>") }
      tool("link", "Link") {
        linkRange = currentRange
        linkURL = "https://"
        askingLink = true
      }
      tool("return", "Line break") { insert("<br>") }
      variableMenu
      tool("eraser", "Clear formatting") { clearFormatting() }
    }
    .padding(.horizontal, 4)
  }

  private func tool(_ systemImage: String, _ label: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: systemImage)
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(Theme.textToned)
        .frame(maxWidth: .infinity, minHeight: 40)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(Text(label))
    .help(label)
  }

  private var variableMenu: some View {
    Menu {
      ForEach(variables, id: \.self) { key in
        Button { insert("{{ \(key) }}") } label: { Text(verbatim: "{{ \(key) }}") }
      }
      if !variables.isEmpty { Divider() }
      Button("New variable") {
        replace(currentRange, open: "{{ ", close: " }}") { _ in "name" }
      }
    } label: {
      Text(verbatim: "{{ }}")
        .font(.system(size: 13, weight: .semibold, design: .monospaced))
        .foregroundStyle(Theme.textToned)
        .frame(maxWidth: .infinity, minHeight: 40)
        .contentShape(Rectangle())
    }
    .accessibilityLabel(Text("Insert a variable"))
    .help("Insert a variable")
  }

  // MARK: Edits

  private var currentRange: Range<Int>? { Self.offsets(of: selection, in: html) ?? lastRange }

  private func wrap(_ open: String, _ close: String) {
    replace(currentRange, open: open, close: close) { $0 }
  }

  /// Typed-in content: replaces the selection, and the cursor lands after it.
  private func insert(_ snippet: String) {
    replace(currentRange, caretAfter: true) { _ in snippet }
  }

  private func addLink() {
    let url = linkURL.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\"", with: "%22")
    guard !url.isEmpty else { return }
    replace(linkRange, open: "<a href=\"\(url)\">", close: "</a>") { $0.isEmpty ? url : $0 }
  }

  /// The selection's tags, or every tag when nothing is selected. Line breaks stay.
  private func clearFormatting() {
    if let range = currentRange, !range.isEmpty {
      replace(range) { Self.stripTags($0) }
    } else {
      replace(0..<html.count, caretAfter: true) { Self.stripTags($0) }
    }
  }

  /// Puts `open + transform(the range's text) + close` where the range was
  /// (nil: at the end), then selects the new inner text, or puts the cursor
  /// after everything inserted.
  private func replace(_ range: Range<Int>?, open: String = "", close: String = "", caretAfter: Bool = false, _ transform: (String) -> String) {
    let text = html
    let count = text.count
    let lower = min(max(range?.lowerBound ?? count, 0), count)
    let upper = min(max(range?.upperBound ?? count, lower), count)
    let start = text.index(text.startIndex, offsetBy: lower)
    let end = text.index(text.startIndex, offsetBy: upper)
    let inner = transform(String(text[start..<end]))
    let next = String(text[..<start]) + open + inner + close + String(text[end...])
    guard next != text else { return }
    html = next
    let innerStart = lower + open.count
    let innerEnd = innerStart + inner.count
    let caret = innerEnd + close.count
    selection = Self.textSelection(caretAfter ? caret..<caret : innerStart..<innerEnd, in: next)
  }

  /// Formatting tags (render.ts sanitizeInline's set, plus font); `<br>` is kept.
  nonisolated static func stripTags(_ html: String) -> String {
    html.replacing(#/<\/?(?:b|strong|i|em|u|a|span|font)\b[^>]*>/#.ignoresCase(), with: "")
  }

  // MARK: Selection (iOS 18 TextEditor)

  /// The selection as Character offsets into `text`, clamped to it. SwiftUI's
  /// indices can belong to an older string (an undo, another editor's save),
  /// so they are only ever compared, never used to index `text`: a stale one
  /// can't trap. A multi-range selection counts as none.
  static func offsets(of current: TextSelection?, in text: String) -> Range<Int>? {
    guard let current, case .selection(let range) = current.indices else { return nil }
    let lower = characterOffset(range.lowerBound, in: text)
    let upper = characterOffset(range.upperBound, in: text)
    return min(lower, upper)..<max(lower, upper)
  }

  private static func characterOffset(_ index: String.Index, in text: String) -> Int {
    var offset = 0
    var cursor = text.startIndex
    while cursor < text.endIndex, cursor < index {
      text.formIndex(after: &cursor)
      offset += 1
    }
    return offset
  }

  /// A selection over Character offsets of `text` (clamped); an empty range is a cursor.
  private static func textSelection(_ range: Range<Int>, in text: String) -> TextSelection {
    let count = text.count
    let lower = min(max(range.lowerBound, 0), count)
    let upper = min(max(range.upperBound, lower), count)
    let start = text.index(text.startIndex, offsetBy: lower)
    if lower == upper { return TextSelection(insertionPoint: start) }
    return TextSelection(range: start..<text.index(start, offsetBy: upper - lower))
  }
}

// MARK: - Image source

/// An image block's source, or a component's image field (`field`): a hosted
/// URL, or a photo or file uploaded to the server. `store.uploadImage` puts the
/// stored URL in the block it was picked for, even if the selection has moved
/// on by the time it lands.
struct EmailImageSourceField: View {
  let store: EmailEditorStore
  let blockId: String
  @Binding var src: String
  let field: String?
  @State private var photo: PhotosPickerItem? = nil
  @State private var importing = false
  @State private var uploading = false

  init(store: EmailEditorStore, blockId: String, src: Binding<String>, field: String? = nil) {
    self.store = store
    self.blockId = blockId
    _src = src
    self.field = field
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        if let url = thumbnailURL {
          CachedAsyncImage(url: url) { image in
            image.resizable().scaledToFill()
          } placeholder: {
            Image(systemName: "photo").font(.system(size: 16)).foregroundStyle(Theme.textDimmed)
          }
          .frame(width: 40, height: 40)
          .background(Theme.elevated)
          .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusSmall))
          .accessibilityHidden(true)
        }
        TextField("https://", text: $src)
          .textFieldStyle(.linear)
          .keyboardType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .accessibilityLabel(Text("Image URL"))
      }
      HStack(spacing: 8) {
        PhotosPicker(selection: $photo, matching: .images, preferredItemEncoding: .compatible) {
          Text("Choose photo").lineLimit(1).frame(maxWidth: .infinity)
        }
        .buttonStyle(.lnSecondary)
        Button { importing = true } label: {
          Text("Choose file").lineLimit(1).frame(maxWidth: .infinity)
        }
        .buttonStyle(.lnSecondary)
        if uploading {
          ProgressView().frame(width: 28)
        }
      }
      .disabled(uploading)
    }
    .onChange(of: photo) { _, item in
      guard let item else { return }
      Task { await upload(item) }
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
      switch result {
      case .success(let url):
        if let data = Self.read(url) {
          Task { await send(data) }
        } else {
          store.notice = "Couldn't read that file."
        }
      case .failure(let error):
        store.notice = error.localizedDescription
      }
    }
  }

  /// Only a real web address gets a thumbnail (not `{{ project.logoUrl }}`).
  private var thumbnailURL: URL? {
    let trimmed = src.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.lowercased().hasPrefix("http"), let url = URL(string: trimmed) else { return nil }
    return url
  }

  private func upload(_ item: PhotosPickerItem) async {
    uploading = true
    let data = try? await item.loadTransferable(type: Data.self)
    photo = nil
    guard let data else {
      uploading = false
      store.notice = "Couldn't read that photo."
      return
    }
    await send(data)
  }

  private func send(_ data: Data) async {
    let target = blockId
    uploading = true
    await store.uploadImage(data, into: target, field: field)
    uploading = false
  }

  private static func read(_ url: URL) -> Data? {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    return try? Data(contentsOf: url)
  }
}
