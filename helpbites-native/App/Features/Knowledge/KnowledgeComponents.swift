import SwiftUI

/// "12 FAQs": the number, then the word (components/knowledge/Stat.vue).
struct KnowledgeStat: View {
  let n: Int
  let label: String
  var warn = false
  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
      Text("\(n)").font(.lnMetaMedium).monospacedDigit().foregroundStyle(warn ? Theme.warning : Theme.textHighlighted)
      Text(label).font(.lnMeta).foregroundStyle(Theme.textMuted)
    }
  }
}

/// A filter pill that opens a menu: Pill's look plus a chevron.
struct KnowledgeMenuPill: View {
  let label: String
  var isActive = false
  var body: some View {
    HStack(spacing: 6) {
      Text(label).lineLimit(1)
      Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
    }
    .font(.lnMetaMedium)
    .foregroundStyle(isActive ? Theme.textHighlighted : Theme.textMuted)
    .padding(.horizontal, 12)
    .frame(height: 30)
    .background(isActive ? Theme.elevated : Color.clear, in: Capsule())
    .overlay(Capsule().strokeBorder(isActive ? Theme.borderAccented : Theme.border))
    .contentShape(Capsule())
  }
}

extension View {
  /// A menu Picker framed like a `.linear` text field.
  func knowledgeField() -> some View {
    self
      .pickerStyle(.menu)
      .tint(Theme.text)
      .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
      .padding(.horizontal, 4)
      .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }
}

/// FAQ answers are Markdown (the web renders them with `marked`, line breaks on).
/// Text drops the block structure of a fully parsed AttributedString, so this
/// splits headings, list items, quotes and code fences itself and parses each
/// line's inline Markdown. Raw HTML stays literal text, so nothing is injected.
struct KnowledgeMarkdown: View {
  let text: String

  enum Block: Equatable { case heading(String), item(String, String), quote(String), code(String), paragraph(String) }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(Array(Self.blocks(text).enumerated()), id: \.offset) { _, block in
        switch block {
        case .heading(let line):
          Text(Self.inline(line)).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        case .item(let marker, let line):
          HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(marker).foregroundStyle(Theme.textMuted).monospacedDigit()
            Text(Self.inline(line))
          }
        case .quote(let line):
          Text(Self.inline(line)).foregroundStyle(Theme.textMuted).padding(.leading, 10)
            .overlay(alignment: .leading) { Rectangle().fill(Theme.borderAccented).frame(width: 2) }
        case .code(let code):
          Text(code).font(.lnMono).padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
        case .paragraph(let line):
          Text(Self.inline(line))
        }
      }
    }
    .font(.lnCallout)
    .foregroundStyle(Theme.text)
    .tint(Theme.accentText)
    .textSelection(.enabled)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  static func inline(_ line: String) -> AttributedString {
    (try? AttributedString(markdown: line, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(line)
  }

  static func blocks(_ text: String) -> [Block] {
    var blocks: [Block] = [], paragraph: [String] = [], code: [String]?
    func flush() { if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))); paragraph = [] } }
    for raw in text.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false) {
      let line = raw.trimmingCharacters(in: .whitespaces)
      if line.hasPrefix("```") || line.hasPrefix("~~~") {
        if let lines = code { blocks.append(.code(lines.joined(separator: "\n"))); code = nil } else { flush(); code = [] }
      } else if code != nil {
        code?.append(String(raw))
      } else if line.isEmpty {
        flush()
      } else if let match = line.firstMatch(of: #/^#{1,6}\s+(.+?)\s*#*$/#) {
        flush(); blocks.append(.heading(String(match.1)))
      } else if let match = line.firstMatch(of: #/^[-*+]\s+(.*)$/#) {
        flush(); blocks.append(.item("•", String(match.1)))
      } else if let match = line.firstMatch(of: #/^(\d+)[.)]\s+(.*)$/#) {
        flush(); blocks.append(.item("\(match.1).", String(match.2)))
      } else if let match = line.firstMatch(of: #/^>\s?(.*)$/#) {
        flush(); blocks.append(.quote(String(match.1)))
      } else {
        paragraph.append(line)
      }
    }
    if let code { blocks.append(.code(code.joined(separator: "\n"))) }
    flush()
    return blocks
  }
}

#Preview("Markdown answer") {
  KnowledgeMarkdown(text: "## Resetting\nOpen **Settings** → *Account*.\nThen tap [Reset](https://example.com).\n\n- One\n- Two `code`\n1. First\n> Note\n```\nlet x = 1\n```")
    .padding()
    .onAppear {
      // The block splitter's contract, checked whenever the preview runs.
      assert(KnowledgeMarkdown.blocks("# A\ntext\nmore\n\n- b\n2. c\n> d\n```\n# not a heading\n```") == [
        .heading("A"), .paragraph("text\nmore"), .item("•", "b"), .item("2.", "c"), .quote("d"), .code("# not a heading")
      ])
    }
}
