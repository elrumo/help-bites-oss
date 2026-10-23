import Foundation
import Observation

/// One legal document being edited (web: projects/[id]/legal/[docId].vue). The
/// working copy (`sections`, `title`, …) is edited freely; `dirty` says whether it
/// differs from what the server has. The AI actions work on the saved copy.
@MainActor @Observable final class LegalDocumentStore {
  let documentId: String
  let projectId: String
  @ObservationIgnored private let session: SessionStore

  private(set) var document: LegalDocument?
  private(set) var coverage: LegalCoverage?
  private(set) var versions: [LegalVersion] = []
  /// The project's other documents that are this text in another language (`translationOf`).
  private(set) var otherLanguages: [LegalDocument] = []
  private(set) var findings: [LegalFinding]?
  private(set) var loading = true
  private(set) var busy = ""
  var error = ""

  // The working copy.
  var sections: [LegalSection] = []
  var title = ""
  var slug = ""
  /// "yyyy-MM-dd" in UTC, or empty for none.
  var effective = ""
  private(set) var tldr = ""
  private(set) var tldrEdited = false

  func editTldr(_ text: String) { tldr = text; tldrEdited = true }

  // The AI rewrite of one section.
  var rewriting = ""
  var instruction = ""
  var proposal = ""

  init(documentId: String, projectId: String, session: SessionStore) {
    self.documentId = documentId
    self.projectId = projectId
    self.session = session
  }

  var tldrSource: String { tldrEdited ? "human" : document?.tldr?.source ?? "" }

  var dirty: Bool {
    guard let document else { return false }
    return sections != document.sections || title != document.title || slug != document.slug || effective != document.effectiveDay || tldrEdited
  }

  private var path: String { "/v1/admin/legal/documents/\(documentId)" }
  private struct Loaded: Decodable, Sendable { let document: LegalDocument; let coverage: LegalCoverage? }

  private func adopt(_ next: LegalDocument, _ nextCoverage: LegalCoverage? = nil) {
    document = next
    if let nextCoverage { coverage = nextCoverage }
    sections = next.sections
    title = next.title
    slug = next.slug
    effective = next.effectiveDay
    tldr = next.tldr?.text ?? ""
    tldrEdited = false
  }

  /// Runs one action, showing its progress in `busy` and its failure in `error`.
  private func run<T>(_ name: String, _ work: () async throws -> T) async -> T? {
    busy = name
    error = ""
    defer { busy = "" }
    do { return try await work() }
    catch {
      if case APIError.cancelled = error { return nil }
      self.error = error.localizedDescription
      return nil
    }
  }

  func load() async {
    if document == nil { loading = true }
    error = ""
    do {
      let result: Loaded = try await session.get(path)
      adopt(result.document, result.coverage)
      struct Versions: Decodable, Sendable { let versions: [LegalVersion] }
      let list: Versions = try await session.get(path + "/versions")
      versions = list.versions
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
    await loadOtherLanguages()
  }

  /// The languages of this text: documents of the project in the same group, found in the project's list.
  private func loadOtherLanguages() async {
    struct Documents: Decodable, Sendable { let documents: [LegalDocument] }
    guard let current = document, let list: Documents = try? await session.get("/v1/admin/legal/documents", query: ["project": projectId]) else { return }
    otherLanguages = list.documents.filter { $0.id != current.id && $0.group == current.group }
      .sorted { $0.language.localizedCompare($1.language) == .orderedAscending }
  }

  // MARK: Editing

  func move(_ id: String, by offset: Int) {
    guard let index = sections.firstIndex(where: { $0.id == id }), sections.indices.contains(index + offset) else { return }
    sections.swapAt(index, index + offset)
  }

  func remove(_ id: String) { sections.removeAll { $0.id == id } }

  func addSection() {
    sections.append(LegalSection(id: "new_\(Int(Date().timeIntervalSince1970 * 1000))", heading: "New section", body: "", source: "human", locked: false, satisfies: []))
  }

  // MARK: Actions

  private struct Edit: Encodable, Sendable { let id, heading, body: String; let locked: Bool }
  private struct SaveBody: Encodable, Sendable {
    let title, slug: String
    let effectiveDate: String?
    let sections: [Edit]
    /// Sent only when edited, since saving a text turns an AI summary into a human one.
    let tldr: String??
    enum CodingKeys: String, CodingKey { case title, slug, effectiveDate, sections, tldr }
    func encode(to encoder: Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(title, forKey: .title)
      try c.encode(slug, forKey: .slug)
      if let effectiveDate { try c.encode(effectiveDate, forKey: .effectiveDate) } else { try c.encodeNil(forKey: .effectiveDate) }
      try c.encode(sections, forKey: .sections)
      if let tldr { if let text = tldr { try c.encode(text, forKey: .tldr) } else { try c.encodeNil(forKey: .tldr) } }
    }
  }

  func save() async {
    let text = tldr.trimmingCharacters(in: .whitespacesAndNewlines)
    let body = SaveBody(
      title: title, slug: slug, effectiveDate: effective.isEmpty ? nil : effective,
      sections: sections.map { Edit(id: $0.id, heading: $0.heading, body: $0.body, locked: $0.locked) },
      tldr: tldrEdited ? .some(text.isEmpty ? nil : text) : nil
    )
    if let result: Loaded = await run("save", { try await session.send(path, method: "PATCH", body: body) }) {
      adopt(result.document, result.coverage)
    }
  }

  func publish(note: String) async {
    struct Body: Encodable, Sendable { let note: String }
    if let result: Loaded = await run("publish", { try await session.send(path + "/publish", body: Body(note: note)) }) {
      adopt(result.document)
      await reloadVersions()
    }
  }

  /// `POST …/change-note`: a suggested note for the next version (409 when nothing differs, 501 without an AI provider).
  func suggestChangeNote() async throws -> String {
    struct Empty: Encodable, Sendable {}
    struct Suggested: Decodable, Sendable { let note: String }
    let suggested: Suggested = try await LegalAPI.slow(session, path + "/change-note", Empty())
    return suggested.note
  }

  func unpublish() async {
    if let result: Loaded = await run("unpublish", { try await session.send(path + "/unpublish") }) { adopt(result.document) }
  }

  func restore(_ version: Int) async {
    if let result: Loaded = await run("restore", { try await session.send(path + "/versions/\(version)/restore") }) {
      adopt(result.document, result.coverage)
    }
  }

  /// The language of this document (`locale`). Takes the saved copy, so only without unsaved edits.
  func setLocale(_ tag: String) async {
    struct Body: Encodable, Sendable { let locale: String }
    if let result: Loaded = await run("locale", { try await session.send(path, method: "PATCH", body: Body(locale: tag)) }) {
      adopt(result.document, result.coverage)
      await loadOtherLanguages()
    }
  }

  /// `POST …/translate`: a new linked draft in `tag`. Throws the server's message (409 when that language exists, 501 without an AI provider).
  func translate(to tag: String) async throws -> LegalDocument {
    struct Body: Encodable, Sendable { let locale: String }
    struct Created: Decodable, Sendable { let document: LegalDocument }
    let created: Created = try await LegalAPI.slow(session, path + "/translate", Body(locale: tag))
    await loadOtherLanguages()
    return created.document
  }

  func generateTldr() async {
    struct Body: Encodable, Sendable { let force: Bool }
    let force = tldrSource == "human"
    if let result: Loaded = await run("tldr", { try await LegalAPI.slow(session, path + "/tldr/generate", Body(force: force)) }) { adopt(result.document) }
  }

  func checkWithAI() async {
    struct Body: Encodable, Sendable { let ai: Bool }
    struct Checked: Decodable, Sendable { let coverage: LegalCoverage; let findings: [LegalFinding]? }
    if let result: Checked = await run("check", { try await LegalAPI.slow(session, path + "/check", Body(ai: true)) }) {
      coverage = result.coverage
      findings = result.findings ?? []
    }
  }

  func propose(_ sectionId: String) async {
    struct Body: Encodable, Sendable { let instruction: String }
    struct Proposal: Decodable, Sendable { let proposal: String }
    if let result: Proposal = await run("rewrite", { try await LegalAPI.slow(session, path + "/sections/\(sectionId)/rewrite", Body(instruction: instruction)) }) {
      proposal = result.proposal
    }
  }

  func applyProposal(_ sectionId: String) async {
    struct Body: Encodable, Sendable { let instruction: String; let apply: Bool }
    if let result: Loaded = await run("apply", { try await LegalAPI.slow(session, path + "/sections/\(sectionId)/rewrite", Body(instruction: instruction, apply: true)) }) {
      adopt(result.document, result.coverage)
      rewriting = ""
      proposal = ""
      instruction = ""
    }
  }

  /// True when the document is gone.
  func delete() async -> Bool {
    await run("delete") { try await session.delete(path); return true } ?? false
  }

  private func reloadVersions() async {
    struct Versions: Decodable, Sendable { let versions: [LegalVersion] }
    if let list: Versions = try? await session.get(path + "/versions") { versions = list.versions }
  }
}
