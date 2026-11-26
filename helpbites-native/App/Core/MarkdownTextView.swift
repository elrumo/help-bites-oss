#if canImport(UIKit)
import SwiftUI
import UIKit

/// A text view for Markdown: Undo and Redo and the format buttons sit above the keyboard, and selecting text adds a
/// Format submenu (bold, italic, code, link, heading, lists, quote) to the edit menu. Edits go through the text input
/// system, so the platform's own undo stack (shake to undo, ⌘Z on a keyboard) holds them too.
/// Compiled into the app and the share extension.
class MarkdownUITextView: UITextView {
  /// Off for a plain field: no bar above the keyboard and no Format menu.
  var markdown = true {
    didSet { inputAccessoryView = markdown ? bar : nil; reloadInputViews() }
  }
  private lazy var bar = makeBar()
  private var undoButton: UIButton?
  private var redoButton: UIButton?

  override init(frame: CGRect, textContainer: NSTextContainer?) {
    super.init(frame: frame, textContainer: textContainer)
    allowsEditingTextAttributes = false
    inputAccessoryView = bar
    // The undo stack moves on typing, shaking and ⌘Z too, not only on this bar's buttons.
    for name in [NSNotification.Name.NSUndoManagerDidUndoChange, .NSUndoManagerDidRedoChange, .NSUndoManagerDidCloseUndoGroup] {
      NotificationCenter.default.addObserver(self, selector: #selector(refreshUndo), name: name, object: nil)
    }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  /// Edits the text view makes itself (a format button) do not reach the delegate, so the caller's binding is told here.
  func apply(_ format: MarkdownFormat) {
    let edit = format.edit(in: text, selection: selectedRange)
    guard let start = position(from: beginningOfDocument, offset: edit.range.location),
          let end = position(from: start, offset: edit.range.length),
          let range = textRange(from: start, to: end) else { return }
    replace(range, withText: edit.text)
    selectedRange = edit.selection
    delegate?.textViewDidChange?(self)
    refreshUndo()
  }

  func undoTapped() { undoManager?.undo(); delegate?.textViewDidChange?(self); refreshUndo() }
  func redoTapped() { undoManager?.redo(); delegate?.textViewDidChange?(self); refreshUndo() }

  @objc func refreshUndo() {
    undoButton?.isEnabled = undoManager?.canUndo ?? false
    redoButton?.isEnabled = undoManager?.canRedo ?? false
  }

  /// The edit menu of a selection: what the system suggests, then Format.
  func editMenu(for range: NSRange, suggested: [UIMenuElement]) -> UIMenu? {
    guard markdown, range.length > 0 else { return nil }
    func action(_ format: MarkdownFormat) -> UIAction {
      UIAction(title: format.title, image: UIImage(systemName: format.symbol)) { [weak self] _ in self?.apply(format) }
    }
    let inline = UIMenu(options: .displayInline, children: [MarkdownFormat.bold, .italic, .strikethrough, .code, .link].map(action))
    let blocks = UIMenu(options: .displayInline, children: [MarkdownFormat.heading, .bullet, .numbered, .task, .quote].map(action))
    return UIMenu(children: suggested + [UIMenu(title: String(localized: "Format"), image: UIImage(systemName: "textformat"), children: [inline, blocks])])
  }

  // MARK: Bar

  private func makeBar() -> UIView {
    let container = UIInputView(frame: CGRect(x: 0, y: 0, width: 0, height: 44), inputViewStyle: .keyboard)
    container.allowsSelfSizing = true
    let scroll = UIScrollView()
    scroll.showsHorizontalScrollIndicator = false
    scroll.translatesAutoresizingMaskIntoConstraints = false
    let stack = UIStackView()
    stack.axis = .horizontal
    stack.alignment = .center
    stack.spacing = 2
    stack.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(scroll)
    scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      container.heightAnchor.constraint(equalToConstant: 44),
      scroll.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      scroll.topAnchor.constraint(equalTo: container.topAnchor),
      scroll.bottomAnchor.constraint(equalTo: container.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 8),
      stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -8),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
      stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor)
    ])
    func button(_ symbol: String, _ label: String, _ handler: @escaping () -> Void) -> UIButton {
      var configuration = UIButton.Configuration.plain()
      configuration.image = UIImage(systemName: symbol)
      configuration.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 11, bottom: 8, trailing: 11)
      let button = UIButton(configuration: configuration, primaryAction: UIAction { _ in handler() })
      button.accessibilityLabel = label
      stack.addArrangedSubview(button)
      return button
    }
    undoButton = button("arrow.uturn.backward", String(localized: "Undo")) { [weak self] in self?.undoTapped() }
    redoButton = button("arrow.uturn.forward", String(localized: "Redo")) { [weak self] in self?.redoTapped() }
    let rule = UIView()
    rule.backgroundColor = .separator
    rule.widthAnchor.constraint(equalToConstant: 1).isActive = true
    rule.heightAnchor.constraint(equalToConstant: 22).isActive = true
    stack.addArrangedSubview(rule)
    for format in MarkdownFormat.allCases { _ = button(format.symbol, format.title) { [weak self] in self?.apply(format) } }
    let spacer = UIView()
    spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
    stack.addArrangedSubview(spacer)
    _ = button("keyboard.chevron.compact.down", String(localized: "Hide the keyboard")) { [weak self] in self?.resignFirstResponder() }
    refreshUndo()
    return container
  }
}

extension MarkdownFormat {
  var title: String {
    switch self {
    case .bold: String(localized: "Bold")
    case .italic: String(localized: "Italic")
    case .strikethrough: String(localized: "Strikethrough")
    case .code: String(localized: "Code")
    case .link: String(localized: "Link")
    case .heading: String(localized: "Heading")
    case .bullet: String(localized: "Bulleted list")
    case .numbered: String(localized: "Numbered list")
    case .task: String(localized: "Checklist")
    case .quote: String(localized: "Quote")
    }
  }

  var symbol: String {
    switch self {
    case .bold: "bold"
    case .italic: "italic"
    case .strikethrough: "strikethrough"
    case .code: "chevron.left.forwardslash.chevron.right"
    case .link: "link"
    case .heading: "textformat.size"
    case .bullet: "list.bullet"
    case .numbered: "list.number"
    case .task: "checklist"
    case .quote: "text.quote"
    }
  }
}

/// The text view in SwiftUI, for places that have no styling of their own (the share sheet). The app's description
/// fields use `PasteTextView`, which is the same view with image paste and the app's fonts and colours.
struct MarkdownEditorView: UIViewRepresentable {
  @Binding var text: String
  var font = UIFont.preferredFont(forTextStyle: .body)

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> MarkdownUITextView {
    let view = MarkdownUITextView()
    view.delegate = context.coordinator
    view.backgroundColor = .clear
    view.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
    view.text = text
    return view
  }

  func updateUIView(_ view: MarkdownUITextView, context: Context) {
    context.coordinator.parent = self
    view.font = font
    if view.text != text { view.text = text }
  }

  @MainActor final class Coordinator: NSObject, UITextViewDelegate {
    var parent: MarkdownEditorView
    init(_ parent: MarkdownEditorView) { self.parent = parent }
    func textViewDidChange(_ view: UITextView) { parent.text = view.text }
    func textView(_ view: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
      (view as? MarkdownUITextView)?.editMenu(for: range, suggested: suggestedActions)
    }
  }
}
#endif
