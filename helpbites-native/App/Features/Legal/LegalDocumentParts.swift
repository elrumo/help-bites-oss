import SwiftUI

/// A bordered block of the document's sidebar.
struct LegalPanel<Content: View, Trailing: View>: View {
  let title: String
  @ViewBuilder var trailing: () -> Trailing
  @ViewBuilder var content: () -> Content
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(title).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
        Spacer(minLength: 8)
        trailing()
      }
      content()
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }
}

extension LegalPanel where Trailing == EmptyView {
  init(_ title: String, @ViewBuilder content: @escaping () -> Content) {
    self.init(title: title, trailing: { EmptyView() }, content: content)
  }
}

/// A finding of an AI check: its status, the requirement it is about, and what the model noted.
struct LegalFindingRow: View {
  let finding: LegalFinding
  let summary: String?

  static func tint(_ status: String) -> Color {
    switch status {
    case "ok": Theme.success
    case "unclear": Theme.warning
    default: Theme.error
    }
  }

  private static let order = ["conflict": 0, "missing": 1, "unclear": 2, "ok": 3]
  static func sorted(_ findings: [LegalFinding]) -> [LegalFinding] {
    findings.enumerated().sorted { (order[$0.element.status] ?? 4, $0.offset) < (order[$1.element.status] ?? 4, $1.offset) }.map(\.element)
  }

  /// "2 missing · 1 unclear · 5 ok"
  static func tally(_ findings: [LegalFinding]) -> String {
    ["conflict", "missing", "unclear", "ok"].compactMap { status in
      let n = findings.filter { $0.status == status }.count
      return n == 0 ? nil : "\(n) \(status)"
    }.joined(separator: " · ")
  }

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Tag(text: finding.status, tint: Self.tint(finding.status)).padding(.top, 1)
      VStack(alignment: .leading, spacing: 2) {
        Text(summary ?? finding.requirement).font(.lnMeta).foregroundStyle(Theme.textHighlighted).fixedSize(horizontal: false, vertical: true)
        if !finding.note.isEmpty { Text(finding.note).font(.lnMeta).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true) }
      }
      Spacer(minLength: 0)
    }
    .textSelection(.enabled)
  }
}

/// What the rulepacks say about a set of sections: how many requirements are answered, and which are not.
struct LegalCoverageSummary: View {
  let coverage: LegalCoverage
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if coverage.isMapped {
        Text("\(coverage.covered.count) of \(coverage.total) applicable requirements covered").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
      }
      if !coverage.unreviewedPacks.isEmpty {
        Label("The rulepacks used here have not been reviewed by a person yet. Have a lawyer check this document.", systemImage: "exclamationmark.triangle")
          .font(.lnCaption).foregroundStyle(Theme.warning)
      }
      if !coverage.isMapped {
        Text("This text is not tied to the requirements yet. Run the AI check to see what it covers.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      } else if coverage.gaps.isEmpty {
        Text("Every applicable requirement is answered by a section.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      } else {
        ForEach(coverage.gaps) { gap in
          VStack(alignment: .leading, spacing: 1) {
            Text(gap.summary).font(.lnMeta).foregroundStyle(Theme.textHighlighted).fixedSize(horizontal: false, vertical: true)
            Text("\(gap.citation) · \(gap.severity)").font(.lnCaption).foregroundStyle(Theme.textDimmed)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// One section of the document: heading, markdown text, lock, order, and the AI rewrite.
struct LegalSectionCard: View {
  @Binding var section: LegalSection
  let index: Int
  let count: Int
  @Bindable var store: LegalDocumentStore
  var onRemove: () -> Void

  private var rewriteOpen: Bool { store.rewriting == section.id }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        TextField("Heading", text: $section.heading)
          .font(.lnRow).textFieldStyle(.plain)
          .padding(.horizontal, 10).frame(minHeight: 36)
          .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
          .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
          .accessibilityLabel("Heading of section \(index + 1)")
        Tag(text: section.source, tint: section.source == "human" ? Theme.accent : section.source == "ai" ? Theme.info : nil)
        Button { section.locked.toggle() } label: {
          Image(systemName: section.locked ? "lock.fill" : "lock.open").foregroundStyle(section.locked ? Theme.accentText : Theme.textMuted).frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .help(section.locked ? "Unlock section" : "Lock section: a recompose or AI rewrite will not touch it")
        .accessibilityLabel(section.locked ? "Unlock section" : "Lock section")
        Menu {
          Button { store.move(section.id, by: -1) } label: { Label("Move up", systemImage: "arrow.up") }.disabled(index == 0)
          Button { store.move(section.id, by: 1) } label: { Label("Move down", systemImage: "arrow.down") }.disabled(index == count - 1)
          Divider()
          Button(role: .destructive, action: onRemove) { Label("Remove section", systemImage: "trash") }
        } label: {
          Image(systemName: "ellipsis").foregroundStyle(Theme.textMuted).frame(width: 28, height: 28).contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .accessibilityLabel("Section actions")
      }

      TextField("Markdown text", text: $section.body, axis: .vertical)
        .font(.lnMono).textFieldStyle(.plain).lineLimit(3...40)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: Metrics.radius))
        .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
        .accessibilityLabel("Text of section \(index + 1)")

      HStack(spacing: 10) {
        if !store.dirty {
          Button { toggleRewrite() } label: { Label("Rewrite with AI", systemImage: "sparkles") }
            .buttonStyle(SecondaryButtonStyle(compact: true)).disabled(section.locked)
        } else {
          Text("Save to use AI on this section").font(.lnCaption).foregroundStyle(Theme.textDimmed)
        }
        if !section.satisfies.isEmpty {
          Text("Answers \(section.satisfies.count) requirement\(section.satisfies.count == 1 ? "" : "s")").font(.lnCaption).foregroundStyle(Theme.textDimmed)
        }
      }

      if rewriteOpen && !store.dirty { rewriteForm }
    }
    .padding(14)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  private func toggleRewrite() {
    store.rewriting = rewriteOpen ? "" : section.id
    store.proposal = ""
    store.instruction = ""
  }

  private var rewriteForm: some View {
    VStack(alignment: .leading, spacing: 10) {
      TextField("What should change? e.g. mention we keep logs for 30 days", text: $store.instruction, axis: .vertical)
        .textFieldStyle(.linear).lineLimit(1...4)
        .onSubmit { Task { await store.propose(section.id) } }
      if !store.proposal.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          Text("Proposal").font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
          Text(store.proposal).font(.lnMono).foregroundStyle(Theme.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
          HStack(spacing: 8) {
            Button { Task { await store.applyProposal(section.id) } } label: { Text(store.busy == "apply" ? "Saving…" : "Use this") }
              .buttonStyle(.lnPrimaryCompact).disabled(store.busy == "apply")
            Button("Discard") { store.proposal = "" }.buttonStyle(GhostButtonStyle())
          }
        }
        .padding(12)
        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      } else {
        HStack(spacing: 8) {
          Button { Task { await store.propose(section.id) } } label: { Text(store.busy == "rewrite" ? "Writing…" : "Propose a rewrite") }
            .buttonStyle(.lnPrimaryCompact)
            .disabled(store.instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.busy == "rewrite")
          if store.busy == "rewrite" { ProgressView().controlSize(.small) }
        }
      }
    }
  }
}

#Preview("Findings") {
  let findings = [
    LegalFinding(requirement: "a", status: "ok", note: "Covered in section 2."),
    LegalFinding(requirement: "b", status: "missing", note: "No mention of retention."),
    LegalFinding(requirement: "c", status: "unclear", note: "Vague about transfers.")
  ]
  return VStack(alignment: .leading, spacing: 10) {
    Text(LegalFindingRow.tally(findings))
    ForEach(LegalFindingRow.sorted(findings)) { LegalFindingRow(finding: $0, summary: "Say how long data is kept") }
  }
  .padding()
}
