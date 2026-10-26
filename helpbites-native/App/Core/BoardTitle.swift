import Foundation

/// The AI-written title of a planning item (shared/boardTitle.ts). The AI itself is
/// `POST /v1/admin/board-items/suggest-title`; this is what both clients need around it.
/// Compiled into the app and the share extension.
enum BoardTitle {
  static let maxLength = 200
  /// How long the description rests before a title is written for it, in seconds.
  static let debounce = 1.0

  private static let marks = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ">#*-+.)")).union(.decimalDigits)

  /// The description's first line (markdown marks off), cut at a word: the title when no AI is there to write one.
  static func fallback(_ description: String) -> String {
    for raw in description.split(whereSeparator: \.isNewline) {
      let line = String(raw.drop { $0.unicodeScalars.allSatisfy(marks.contains) }).trimmingCharacters(in: .whitespaces)
      if line.isEmpty { continue }
      if line.count <= 80 { return line }
      let cut = String(line.prefix(80))
      let space = cut.lastIndex(of: " ").map { cut.distance(from: cut.startIndex, to: $0) } ?? 0
      return String(cut.prefix(max(space, 40))).trimmingCharacters(in: .whitespaces) + "…"
    }
    return ""
  }
}
