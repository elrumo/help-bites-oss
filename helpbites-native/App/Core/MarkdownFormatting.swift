import Foundation

/// The Markdown edits behind the description's format bar and selection menu. Pure string work, so the app and the
/// share extension compile it as it is: an edit is a range to replace, the text that goes there, and the selection after.
/// Compiled into the app and the share extension.
enum MarkdownFormat: CaseIterable, Sendable {
  case bold, italic, strikethrough, code, link, heading, bullet, numbered, task, quote

  struct Edit: Equatable {
    var range: NSRange
    var text: String
    var selection: NSRange
  }

  /// What the edit does to `text` with `selection` (a caret when its length is 0).
  func edit(in text: String, selection: NSRange) -> Edit {
    switch self {
    case .bold: Self.wrap(text, selection, "**")
    case .italic: Self.wrap(text, selection, "*")
    case .strikethrough: Self.wrap(text, selection, "~~")
    case .code: Self.wrap(text, selection, "`")
    case .link: Self.link(text, selection)
    case .heading: Self.prefix(text, selection, "## ")
    case .bullet: Self.prefix(text, selection, "- ")
    case .numbered: Self.prefix(text, selection, "1. ")
    case .task: Self.prefix(text, selection, "- [ ] ")
    case .quote: Self.prefix(text, selection, "> ")
    }
  }

  /// `**text**` around the selection; the same call on text already wrapped takes the marks off again. With a caret it
  /// puts the marks down and leaves the caret between them.
  private static func wrap(_ text: String, _ selection: NSRange, _ mark: String) -> Edit {
    let string = text as NSString
    let width = (mark as NSString).length
    let before = NSRange(location: selection.location - width, length: width)
    let after = NSRange(location: selection.location + selection.length, length: width)
    if before.location >= 0, after.location + width <= string.length, string.substring(with: before) == mark, string.substring(with: after) == mark,
       // `*` inside `**`: the italic mark of bold text is not a pair of its own.
       mark != "*" || !isDoubled(string, before, after) {
      let range = NSRange(location: before.location, length: selection.length + 2 * width)
      return Edit(range: range, text: string.substring(with: selection), selection: NSRange(location: before.location, length: selection.length))
    }
    let inner = string.substring(with: selection)
    return Edit(range: selection, text: mark + inner + mark, selection: NSRange(location: selection.location + width, length: selection.length))
  }

  private static func isDoubled(_ string: NSString, _ before: NSRange, _ after: NSRange) -> Bool {
    (before.location > 0 && string.substring(with: NSRange(location: before.location - 1, length: 1)) == "*")
      || (after.location + after.length < string.length && string.substring(with: NSRange(location: after.location + after.length, length: 1)) == "*")
  }

  /// `[selection](url)` with `url` selected, ready to be typed over.
  private static func link(_ text: String, _ selection: NSRange) -> Edit {
    let inner = (text as NSString).substring(with: selection)
    let label = inner.isEmpty ? "text" : inner
    let url = "url"
    let result = "[\(label)](\(url))"
    let start = selection.location + (label as NSString).length + 3
    return Edit(range: selection, text: result, selection: NSRange(location: start, length: (url as NSString).length))
  }

  /// A mark at the start of every line the selection touches. When they all carry it already it comes off; a heading mark
  /// or list mark of another kind is swapped for this one. 
  private static func prefix(_ text: String, _ selection: NSRange, _ mark: String) -> Edit {
    let string = text as NSString
    let lines = string.lineRange(for: selection)
    var body = string.substring(with: lines)
    let trailing = body.hasSuffix("\n")
    if trailing { body.removeLast() }
    let rows = body.components(separatedBy: "\n")
    let numbered = mark == "1. "
    let others = ["## ", "# ", "### ", "- [ ] ", "- [x] ", "- ", "* ", "> "]
    func stripped(_ row: String) -> String {
      if let range = row.range(of: #"^\d+\. "#, options: .regularExpression) { return String(row[range.upperBound...]) }
      for other in others where row.hasPrefix(other) { return String(row.dropFirst(other.count)) }
      return row
    }
    let allMarked = rows.contains { !$0.isEmpty } && rows.allSatisfy { $0.isEmpty || (numbered ? $0.range(of: #"^\d+\. "#, options: .regularExpression) != nil : $0.hasPrefix(mark)) }
    var number = 0
    let next = rows.map { row -> String in
      if allMarked { return stripped(row) }
      if row.isEmpty && rows.count > 1 { return row }
      number += 1
      return (numbered ? "\(number). " : mark) + stripped(row)
    }
    let text = next.joined(separator: "\n") + (trailing ? "\n" : "")
    let length = (text as NSString).length - (trailing ? 1 : 0)
    // A caret stays a caret, at the end of its line; a selection covers the lines changed.
    return Edit(range: lines, text: text, selection: selection.length == 0 ? NSRange(location: lines.location + length, length: 0) : NSRange(location: lines.location, length: max(length, 0)))
  }
}
