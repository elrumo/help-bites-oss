import SwiftUI

/// The model's source documents (the web's Documents modal): download,
/// reprocess, replace with a new version, delete; import another.
struct KnowledgeDocumentsSheet: View {
  let modelId: String
  let themes: [KnowledgeTheme]
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss

  @State private var documents: [KnowledgeDocumentItem] = []
  @State private var loading = true
  @State private var busyId = ""
  @State private var error = ""
  @State private var replaceTarget: KnowledgeDocumentItem?
  @State private var pickingReplacement = false
  @State private var importing: ImportRequest?
  @State private var shared: PreviewItem?
  @State private var pendingDelete: PendingDelete?

  private struct Impact: Decodable, Sendable { let faqs: Int; let note: String }
  private struct PendingDelete { let document: KnowledgeDocumentItem; let impact: Impact }
  private struct ImportRequest: Identifiable { let id = UUID(); var preview: KnowledgeImportPreview? }

  var body: some View {
    NavigationStack {
      Group {
        if loading && documents.isEmpty {
          SkeletonRows(count: 3).frame(maxHeight: .infinity, alignment: .top)
        } else if documents.isEmpty {
          VStack(spacing: 0) {
            ErrorText(message: error)
            EmptyState(systemImage: "doc.text", title: "No documents yet", message: "Import a SUPPORT_FAQ.md to get started.") {
              Button { importing = ImportRequest() } label: { Label("Import", systemImage: "arrow.up.doc") }.buttonStyle(.lnPrimary)
            }
          }
          .frame(maxHeight: .infinity)
        } else {
          List {
            Text("Reprocess to re-import without duplicating; replace to upload a new version.").font(.lnMeta).foregroundStyle(Theme.textMuted).linearRow()
            if !error.isEmpty { ErrorText(message: error).linearRow() }
            ForEach(documents) { document in row(document).linearRow().contextMenu { actions(for: document) } }
          }
          .linearList()
          .refreshable { await load() }
        }
      }
      .panelScreen("Source documents")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
        ToolbarItem(placement: .primaryAction) {
          Button { importing = ImportRequest() } label: { Label("Import", systemImage: "arrow.up.doc") }
        }
      }
      .task { await load() }
      .fileImporter(isPresented: $pickingReplacement, allowedContentTypes: KnowledgePickedFile.types) { result in
        guard let document = replaceTarget else { return }
        Task { await replace(document, with: result) }
      }
      .sheet(item: $importing, onDismiss: { Task { await load() } }) { request in
        KnowledgeImportSheet(modelId: modelId, themes: themes, initialPreview: request.preview)
      }
      .sheet(item: $shared) { KnowledgeShareSheet(url: $0.url).presentationDetents([.medium, .large]) }
      .confirmationDialog("Delete document?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible, presenting: pendingDelete) { pending in
        Button("Delete", role: .destructive) { Task { await delete(pending.document, confirmed: true) } }
      } message: { pending in
        Text("Delete “\(pending.document.originalFilename)”? \(pending.impact.note) (\(pending.impact.faqs) FAQs)")
      }
    }
    .presentationDetents([.large])
  }

  private func row(_ document: KnowledgeDocumentItem) -> some View {
    HStack(spacing: 12) {
      Image(systemName: "doc.text").font(.system(size: 16)).foregroundStyle(Theme.textDimmed)
      VStack(alignment: .leading, spacing: 2) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(document.originalFilename).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Text("v\(document.version)").font(.lnCaption).foregroundStyle(Theme.textDimmed)
        }
        Text("\(document.faqCount ?? 0) FAQs · \(DateText.day(document.createdAt))").font(.lnCaption).foregroundStyle(Theme.textMuted)
        if document.status == "failed", !document.processingError.isEmpty {
          Text(document.processingError).font(.lnCaption).foregroundStyle(Theme.error).lineLimit(2)
        }
      }
      Spacer(minLength: 8)
      StatusDot(status: document.status)
      if busyId == document.id {
        ProgressView().frame(width: 32, height: 32)
      } else {
        Menu { actions(for: document) } label: {
          Image(systemName: "ellipsis").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).contentShape(Rectangle())
        }
        .accessibilityLabel("Actions for \(document.originalFilename)")
      }
    }
    .padding(.vertical, 8)
  }

  @ViewBuilder private func actions(for document: KnowledgeDocumentItem) -> some View {
    Button { Task { await download(document) } } label: { Label("Download", systemImage: "arrow.down.circle") }
    Button { Task { await reprocess(document) } } label: { Label("Reprocess", systemImage: "arrow.clockwise") }
    Button { replaceTarget = document; pickingReplacement = true } label: { Label("Replace", systemImage: "arrow.up.doc") }
    Divider()
    Button(role: .destructive) { Task { await delete(document, confirmed: false) } } label: { Label("Delete", systemImage: "trash") }
  }

  // MARK: Data

  private func load() async {
    struct Response: Decodable, Sendable { let documents: [KnowledgeDocumentItem] }
    do {
      let response: Response = try await session.get("/v1/admin/knowledge/documents", query: ["modelId": modelId])
      documents = response.documents
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }

  private func download(_ document: KnowledgeDocumentItem) async {
    busyId = document.id; error = ""
    defer { busyId = "" }
    do {
      let data = try await session.download("/v1/admin/knowledge/documents/\(document.id)/download")
      let name = document.originalFilename.isEmpty ? "document.md" : document.originalFilename.replacingOccurrences(of: "/", with: "_")
      let url = FileManager.default.temporaryDirectory.appending(path: name)
      try data.write(to: url, options: .atomic)
      shared = PreviewItem(url: url)
    } catch { self.error = error.localizedDescription }
  }

  private func reprocess(_ document: KnowledgeDocumentItem) async {
    busyId = document.id; error = ""
    defer { busyId = "" }
    do {
      let _: JSONValue = try await session.send("/v1/admin/knowledge/documents/\(document.id)/reprocess")
      await load()
    } catch { self.error = error.localizedDescription }
  }

  /// A new version of the document: upload it, then review it like an import.
  private func replace(_ document: KnowledgeDocumentItem, with result: Result<URL, Error>) async {
    busyId = document.id; error = ""
    defer { busyId = "" }
    do {
      let file = try KnowledgePickedFile.read(result.get())
      let response: KnowledgePreviewResponse = try await session.upload("/v1/admin/knowledge/documents/\(document.id)/replace", file: file.data, filename: file.name, mimeType: file.mimeType)
      importing = ImportRequest(preview: response.preview)
    } catch { self.error = error.localizedDescription }
  }

  private func delete(_ document: KnowledgeDocumentItem, confirmed: Bool) async {
    error = ""
    do {
      if confirmed {
        let _: KnowledgeDeleteCheck<Impact> = try await KnowledgeAPI.request(session, "DELETE", "/v1/admin/knowledge/documents/\(document.id)", query: ["confirm": "true"])
      } else {
        let check: KnowledgeDeleteCheck<Impact> = try await session.send("/v1/admin/knowledge/documents/\(document.id)", method: "DELETE")
        if let impact = check.impact, !check.deleted { pendingDelete = PendingDelete(document: document, impact: impact); return }
      }
      await load()
    } catch { self.error = error.localizedDescription }
  }
}

/// Upload a .md/.txt document, review the FAQs it produces, then import them
/// (components/knowledge/ImportModal.vue). With `initialPreview` (a replaced
/// document) it opens on the review step.
struct KnowledgeImportSheet: View {
  let modelId: String
  let themes: [KnowledgeTheme]
  var initialPreview: KnowledgeImportPreview? = nil
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss

  private enum Step { case upload, review, processing }
  private struct Entry: Identifiable {
    let id: String
    var include: Bool
    var question: String
    let path: [String]
    let pathCache, answer, duplicate: String
  }

  @State private var step = Step.upload
  @State private var nodeId = ""
  @State private var file: KnowledgePickedFile?
  @State private var picking = false
  @State private var busy = false
  @State private var error = ""
  @State private var preview: KnowledgeImportPreview?
  @State private var entries: [Entry] = []
  @State private var stats: KnowledgeCommitStats?
  @State private var documentStatus = ""

  private var includedCount: Int { entries.filter(\.include).count }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          switch step {
          case .upload: uploadStep
          case .review: reviewStep
          case .processing: processingStep
          }
          ErrorText(message: error)
        }
        .frame(maxWidth: 720, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .panelScreen("Import a document")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          if step == .review { Button("Back") { reset() } } else if step == .upload { Button("Cancel") { dismiss() } }
        }
        ToolbarItem(placement: .confirmationAction) {
          switch step {
          case .upload: Button("Parse") { Task { await upload() } }.disabled(file == nil || busy)
          case .review: Button("Import \(includedCount)") { Task { await commit() } }.disabled(includedCount == 0 || busy)
          case .processing: Button("Done") { dismiss() }
          }
        }
      }
      .fileImporter(isPresented: $picking, allowedContentTypes: KnowledgePickedFile.types) { result in
        do { file = try KnowledgePickedFile.read(result.get()); error = "" } catch { self.error = error.localizedDescription }
      }
      .task(id: step) { if step == .processing { await poll() } }
      .onAppear { if let initialPreview, preview == nil { review(initialPreview) } }
    }
    .presentationDetents([.large])
    .interactiveDismissDisabled(busy)
  }

  // MARK: Steps

  private var uploadStep: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Upload a Markdown or text FAQ document. You will review what was detected before anything is imported.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      if !themes.isEmpty {
        LabeledField(label: "Destination path", hint: "Optional — detected paths nest under this") {
          Picker("Destination path", selection: $nodeId) {
            Text("(model root)").tag("")
            ForEach(themes) { Text($0.pathCache).tag($0.id) }
          }
          .knowledgeField()
        }
      }
      VStack(spacing: 10) {
        Image(systemName: "arrow.up.doc").font(.system(size: 26)).foregroundStyle(Theme.textDimmed)
        Text("A .md or .txt file, up to 4 MB").font(.lnMeta).foregroundStyle(Theme.textMuted)
        Button("Choose a file") { picking = true }.buttonStyle(.lnSecondaryCompact)
        if let file {
          HStack(spacing: 4) {
            Text(file.name).lineLimit(1)
            Text("(\(Int((Double(file.data.count) / 1024).rounded(.up))) KB)").foregroundStyle(Theme.textDimmed)
          }
        }
        if busy { ProgressView() }
      }
      .font(.lnCallout)
      .foregroundStyle(Theme.text)
      .padding(28)
      .frame(maxWidth: .infinity)
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.borderAccented, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
    }
  }

  @ViewBuilder private var reviewStep: some View {
    if let preview {
      FlowLayout(spacing: 14) {
        KnowledgeStat(n: preview.counts.faqs, label: "FAQs")
        KnowledgeStat(n: preview.counts.nodes, label: "paths")
        KnowledgeStat(n: preview.counts.duplicates, label: "duplicates", warn: preview.counts.duplicates > 0)
        KnowledgeStat(n: preview.counts.existing, label: "already imported", warn: preview.counts.existing > 0)
        KnowledgeStat(n: includedCount, label: "selected")
      }

      let warnings = preview.warnings + preview.invalid.map { "\($0.section) — \($0.reason)" }
      if !warnings.isEmpty {
        DisclosureGroup("\(warnings.count) warning\(warnings.count == 1 ? "" : "s")") {
          VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(warnings.enumerated()), id: \.offset) { Label($0.element, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.textMuted) }
          }
          .padding(.top, 6)
        }
        .font(.lnCaption)
        .tint(Theme.textMuted)
      }

      HStack(spacing: 4) {
        Button("Select all") { setAll(true) }.buttonStyle(.lnGhost)
        Button("None") { setAll(false) }.buttonStyle(.lnGhost)
        Text("Edited questions and deselections apply on import.").font(.lnCaption).foregroundStyle(Theme.textDimmed)
      }

      Card {
        ForEach($entries) { $entry in
          CardRow(divider: entry.id != entries.last?.id) {
            HStack(alignment: .top, spacing: 10) {
              Button { entry.include.toggle() } label: {
                Image(systemName: entry.include ? "checkmark.square.fill" : "square").font(.system(size: 17))
                  .foregroundStyle(entry.include ? Theme.accent : Theme.textDimmed)
              }
              .buttonStyle(.plain)
              .accessibilityLabel(entry.include ? "Included" : "Excluded")
              VStack(alignment: .leading, spacing: 4) {
                TextField("Question", text: $entry.question, axis: .vertical).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                HStack(spacing: 6) {
                  Text(entry.pathCache.isEmpty ? "(root)" : entry.pathCache).font(.lnCaption).foregroundStyle(Theme.textDimmed).lineLimit(1)
                  if !entry.duplicate.isEmpty { Tag(text: duplicateLabel(entry.duplicate), tint: duplicateTint(entry.duplicate)) }
                }
              }
            }
            .opacity(entry.include ? 1 : 0.55)
          }
        }
      }
    }
  }

  private var processingStep: some View {
    VStack(spacing: 12) {
      Group {
        if documentStatus == "processed" {
          Image(systemName: "checkmark.circle").foregroundStyle(Theme.accent)
        } else if documentStatus == "failed" {
          Image(systemName: "exclamationmark.triangle").foregroundStyle(Theme.error)
        } else {
          ProgressView().controlSize(.large)
        }
      }
      .font(.system(size: 30))
      .frame(height: 40)
      Text(documentStatus == "failed" ? "Import failed while indexing. The FAQs were saved; you can reindex from the model page." : documentStatus == "processed" ? "Imported and indexed." : "Importing and indexing…")
        .font(.lnCallout).foregroundStyle(Theme.text).multilineTextAlignment(.center)
      if let stats {
        Text("\(stats.created) created · \(stats.updated) updated · \(stats.skippedDetached) kept (edited) · \(stats.outdated) outdated")
          .font(.lnCaption).foregroundStyle(Theme.textMuted).multilineTextAlignment(.center)
      }
    }
    .padding(.vertical, 32)
    .frame(maxWidth: .infinity)
  }

  private var finished: Bool { documentStatus == "processed" || documentStatus == "failed" }

  private func duplicateLabel(_ duplicate: String) -> String {
    duplicate == "in-document" ? "duplicate in file" : duplicate == "existing-detached" ? "edited — will keep yours" : "updates existing"
  }

  private func duplicateTint(_ duplicate: String) -> Color {
    duplicate == "existing-detached" ? Theme.warning : duplicate == "in-document" ? Theme.textDimmed : Theme.info
  }

  // MARK: Data

  private func reset() {
    step = .upload; file = nil; nodeId = ""; error = ""; preview = nil; entries = []; stats = nil; documentStatus = ""
  }

  private func setAll(_ include: Bool) {
    for index in entries.indices { entries[index].include = include }
  }

  private func review(_ preview: KnowledgeImportPreview) {
    self.preview = preview
    // Keep everything except FAQs someone edited since the last import, as the web does.
    entries = preview.entries.map { Entry(id: $0.key, include: $0.duplicate != "existing-detached", question: $0.question, path: $0.path, pathCache: $0.pathCache, answer: $0.answer, duplicate: $0.duplicate) }
    step = .review
  }

  private func upload() async {
    guard let file else { return }
    busy = true; error = ""
    defer { busy = false }
    var query = ["modelId": modelId]
    if !nodeId.isEmpty { query["nodeId"] = nodeId }
    do {
      let response: KnowledgePreviewResponse = try await KnowledgeAPI.request(session, "POST", "/v1/admin/knowledge/imports/upload", query: query, file: file)
      review(response.preview)
    } catch { self.error = error.localizedDescription }
  }

  private func commit() async {
    struct Input: Encodable, Sendable {
      struct Entry: Encodable, Sendable { let path: [String]; let question, answer: String }
      let entries: [Entry]
    }
    struct Output: Decodable, Sendable { let stats: KnowledgeCommitStats }
    guard let preview else { return }
    busy = true; error = ""
    defer { busy = false }
    do {
      let input = Input(entries: entries.filter(\.include).map { .init(path: $0.path, question: $0.question, answer: $0.answer) })
      let output: Output = try await session.send("/v1/admin/knowledge/imports/\(preview.documentId)/commit", body: input)
      stats = output.stats
      step = .processing
    } catch { self.error = error.localizedDescription }
  }

  /// Indexing runs in the background; check every 1.2 s, up to 60 times, as the web does.
  private func poll() async {
    struct Status: Decodable, Sendable { struct Document: Decodable, Sendable { let status: String }; let document: Document }
    guard let id = preview?.documentId else { return }
    for _ in 0..<60 {
      try? await Task.sleep(for: .milliseconds(1200))
      if Task.isCancelled { return }
      if let status: Status = try? await session.get("/v1/admin/knowledge/imports/\(id)") {
        documentStatus = status.document.status
        if finished { return }
      }
    }
  }
}
