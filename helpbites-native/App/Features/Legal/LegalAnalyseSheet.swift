import SwiftUI
import UniformTypeIdentifiers

/// Analyse any legal text (components/legal/Analyse.vue): paste a policy or open a
/// file, pick the regions, and see per requirement whether it is covered.
struct LegalAnalyseSheet: View {
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var type = LegalType.privacy
  @State private var regions: Set<String> = []
  @State private var text = ""
  @State private var picking = false
  @State private var loading = false
  @State private var error = ""
  @State private var findings: [LegalFinding]?
  @State private var summaries: [String: String] = [:]
  @State private var task: Task<Void, Never>?

  private static let fileTypes: [UTType] = [.plainText, .html] + ["md", "markdown"].compactMap { UTType(filenameExtension: $0) }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Text("Paste a policy and see which requirements for your regions it covers. The model can only cite the listed requirements. It is not legal advice.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Document") {
            Picker("Document", selection: $type) { ForEach(LegalType.allCases) { Text($0.label).tag($0) } }.knowledgeField()
          }
          LabeledField(label: "Where are your users?") {
            FlowLayout(spacing: 8) {
              ForEach(legalRegions, id: \.value) { region in
                Pill(label: region.label, isActive: regions.contains(region.value)) {
                  if regions.contains(region.value) { regions.remove(region.value) } else { regions.insert(region.value) }
                }
              }
            }
          }
          LabeledField(label: "Text") {
            VStack(alignment: .leading, spacing: 8) {
              LinearTextEditor(text: $text, placeholder: "Paste the policy here", minHeight: 200)
              Button { picking = true } label: { Label("Import a file", systemImage: "doc") }
                .buttonStyle(SecondaryButtonStyle(compact: true))
            }
          }
          ErrorText(message: error)
          if let findings { results(findings) }
        }
        .frame(maxWidth: 720, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("Analyse a legal text")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { task?.cancel(); dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if loading {
            ProgressView().controlSize(.small)
          } else {
            Button("Analyse") { task = Task { await run() } }.disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }
      }
      .fileImporter(isPresented: $picking, allowedContentTypes: Self.fileTypes) { result in
        do { text = try Self.read(result.get()); error = "" } catch { self.error = error.localizedDescription }
      }
    }
    .presentationDetents([.large])
    #if os(macOS)
    .frame(minWidth: 560, minHeight: 640)
    #endif
  }

  @ViewBuilder private func results(_ findings: [LegalFinding]) -> some View {
    if findings.isEmpty {
      Text("No requirements apply to these regions.").font(.lnMeta).foregroundStyle(Theme.textMuted)
    } else {
      let sorted = LegalFindingRow.sorted(findings)
      VStack(alignment: .leading, spacing: 8) {
        Text(LegalFindingRow.tally(findings)).font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
        Card {
          ForEach(Array(sorted.enumerated()), id: \.element.id) { index, finding in
            CardRow(divider: index < sorted.count - 1) { LegalFindingRow(finding: finding, summary: summaries[finding.requirement]) }
          }
        }
      }
    }
  }

  private static func read(_ url: URL) throws -> String {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    let data = try Data(contentsOf: url)
    guard data.count <= 2_000_000 else { throw APIError.server("That file is too large to analyse (2 MB at most).") }
    return String(decoding: data, as: UTF8.self)
  }

  private func run() async {
    struct Body: Encodable, Sendable { let type: String; let text: String; let answers: [String: [String]] }
    loading = true
    error = ""
    findings = nil
    defer { loading = false }
    do {
      let kind = type.rawValue
      let ordered = legalRegions.map(\.value).filter(regions.contains)
      let packs: LegalRulepacks = try await session.get("/v1/admin/legal/rulepacks", query: ["type": kind])
      let result: LegalAnalysis = try await LegalAPI.slow(session, "/v1/admin/legal/analyse", Body(type: kind, text: text, answers: ["regions": ordered]))
      summaries = Dictionary(packs.rulepacks.flatMap(\.requirements).map { ($0.id, $0.summary) }, uniquingKeysWith: { first, _ in first })
      findings = result.findings
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
  }
}
