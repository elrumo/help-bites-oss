import SwiftUI

/// One legal document (web: projects/[id]/legal/[docId].vue): its sections to edit
/// or preview, the summary, details, rules check, versions and publish state.
struct LegalDocumentScreen: View {
  let projectId: String
  let documentId: String
  /// Set by the import wizard when the person asked to analyse what they imported.
  var analyseOnLoad = false
  @Environment(SessionStore.self) private var session
  @State private var store: LegalDocumentStore?

  var body: some View {
    Group {
      if let store {
        LegalDocumentContent(projectId: projectId, store: store, analyseOnLoad: analyseOnLoad)
      } else {
        Color.clear.projectScreen(projectId, "Document")
      }
    }
    .task { if store == nil { store = LegalDocumentStore(documentId: documentId, projectId: projectId, session: session) } }
  }
}

private struct LegalDocumentContent: View {
  let projectId: String
  @Bindable var store: LegalDocumentStore
  let analyseOnLoad: Bool
  @State private var analysed = false
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var previewing = false
  @State private var showWizard = false
  @State private var publishing = false
  @State private var note = ""
  @State private var confirm: Confirm?
  @State private var translating = false
  /// Another language of this text, pushed on top of this screen.
  @State private var opened: String?
  /// The draft just made, pushed once the translate sheet is gone.
  @State private var created: String?

  private enum Confirm: Identifiable {
    case unpublish, delete, replaceTldr
    case restore(Int)
    var id: String { switch self { case .unpublish: "unpublish"; case .delete: "delete"; case .replaceTldr: "tldr"; case .restore(let v): "restore\(v)" } }
  }

  private var document: LegalDocument? { store.document }
  private var publicURL: URL? { document.flatMap { LegalAPI.publicURL(session, $0.path) } }

  var body: some View {
    Group {
      if store.loading && document == nil {
        SkeletonRows(count: 4)
      } else if let document {
        editor(document)
      } else {
        VStack(spacing: 12) {
          ErrorText(message: store.error.isEmpty ? String(localized: "Document not found") : store.error)
          Button("Try again") { Task { await store.load() } }.buttonStyle(SecondaryButtonStyle(compact: true))
        }
        .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      }
    }
    .projectScreen(projectId, document.map { $0.title.isEmpty ? $0.kind.label : $0.title } ?? "Document")
    .toolbar { if let document { toolbar(document) } }
    .alert(document?.isPublished == true ? "Publish a new version" : "Publish this document", isPresented: $publishing) {
      TextField("What changed? (optional)", text: $note)
      Button("Publish") { Task { await store.publish(note: note.trimmingCharacters(in: .whitespacesAndNewlines)); note = "" } }
      Button("Cancel", role: .cancel) { note = "" }
    } message: {
      Text("It becomes public at its page, and this text is recorded as a version you can restore.")
    }
    .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { item in
      switch item {
      case .unpublish: Button("Unpublish") { Task { await store.unpublish() } }
      case .delete: Button("Delete document", role: .destructive) { Task { if await store.delete() { dismiss() } } }
      case .replaceTldr: Button("Replace with AI summary", role: .destructive) { Task { await store.generateTldr() } }
      case .restore(let version): Button("Restore version \(version)") { Task { await store.restore(version) } }
      }
    } message: { item in
      switch item {
      case .unpublish: Text("Its public page will answer 404. Versions are kept.")
      case .delete: Text("This deletes the document and its versions. Its public page will stop working.")
      case .replaceTldr: Text("Replace the summary you wrote with an AI-written one?")
      case .restore(let version): Text("Replace the working text with version \(version)? You can then review and publish it.")
      }
    }
    .sheet(isPresented: $translating, onDismiss: { if let id = created { created = nil; opened = id } }) {
      if let document {
        TranslateSheet(
          title: String(localized: "Translate with AI"), source: document.language, existing: ([document] + store.otherLanguages).map(\.language), limit: 1, overwriteHint: nil,
          note: String(localized: "Creates a new draft in that language, linked to this document. Nothing is published. It is a machine translation to review, not legal advice.")
        ) { tags, _ in
          if let tag = tags.first { created = try await store.translate(to: tag).id }
        }
      }
    }
    .navigationDestination(item: $opened) { LegalDocumentScreen(projectId: projectId, documentId: $0) }
    .sheet(isPresented: $showWizard) {
      if let document { LegalWizardSheet(projectId: projectId, document: document) { _, _ in Task { await store.load() } } }
    }
    .task {
      await store.load()
      if analyseOnLoad, !analysed, store.document != nil { analysed = true; await store.checkWithAI() }
    }
  }

  private var confirmTitle: String {
    switch confirm {
    case .unpublish: String(localized: "Take this document offline?")
    case .delete: String(localized: "Delete this document?")
    case .replaceTldr: String(localized: "Replace your summary?")
    case .restore(let version): String(localized: "Restore version \(version)?")
    case nil: ""
    }
  }

  // MARK: Toolbar

  @ToolbarContentBuilder private func toolbar(_ document: LegalDocument) -> some ToolbarContent {
    ToolbarItem(placement: .primaryAction) {
      Menu {
        if let publicURL {
          if document.isPublished {
            Button { openURL(publicURL) } label: { Label("View page", systemImage: "arrow.up.right.square") }
            Button { Clipboard.copy(publicURL.absoluteString) } label: { Label("Copy link", systemImage: "link") }
            ShareLink(item: publicURL) { Label("Share…", systemImage: "square.and.arrow.up") }
          }
        }
        if document.isPublished {
          Button { confirm = .unpublish } label: { Label("Unpublish", systemImage: "eye.slash") }.disabled(store.busy != "")
        }
        Button { showWizard = true } label: { Label("Answers and recompose", systemImage: "checklist") }.disabled(store.dirty)
        Divider()
        Button(role: .destructive) { confirm = .delete } label: { Label("Delete document", systemImage: "trash") }
      } label: { Label("More", systemImage: "ellipsis.circle") }
    }
    ToolbarItem(placement: .primaryAction) {
      if store.dirty {
        Button { Task { await store.save() } } label: { Text(store.busy == "save" ? "Saving…" : "Save") }
          .keyboardShortcut("s", modifiers: .command).disabled(store.busy == "save")
      } else {
        Button { publishing = true } label: { Text(document.isPublished ? "Publish new version" : "Publish") }
          .disabled(store.busy != "")
      }
    }
  }

  // MARK: Layout

  private func editor(_ document: LegalDocument) -> some View {
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .top, spacing: 0) {
        ScrollView { sectionsColumn(document).padding(20) }
        Rectangle().fill(Theme.border).frame(width: Hairline.width)
        ScrollView { sidebar(document).padding(20) }.frame(width: 360)
      }
      .frame(minWidth: 780, idealWidth: 780, maxWidth: .infinity)

      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          sectionsColumn(document)
          sidebar(document)
        }
        .padding(20)
      }
    }
    .scrollDismissesKeyboard(.interactively)
  }

  private func sectionsColumn(_ document: LegalDocument) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      statusLine(document)
      Picker("View", selection: $previewing) { Text("Edit").tag(false); Text("Preview").tag(true) }
        .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 220)
      ErrorText(message: store.error)
      if previewing {
        preview
      } else {
        ForEach($store.sections) { $section in
          LegalSectionCard(section: $section, index: store.sections.firstIndex { $0.id == section.id } ?? 0, count: store.sections.count, store: store) {
            store.remove(section.id)
          }
        }
        Button { store.addSection() } label: { Label("Add section", systemImage: "plus") }.buttonStyle(SecondaryButtonStyle(compact: true))
      }
    }
    .frame(maxWidth: 760, alignment: .leading)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func statusLine(_ document: LegalDocument) -> some View {
    HStack(spacing: 8) {
      Tag(text: document.kind.label)
      Tag(text: document.isPublished ? "Published v\(document.version)" : "Draft", tint: document.isPublished ? Theme.success : Theme.textDimmed)
      if document.isPublished, let published = document.publishedAt { Text(DateText.day(published)).font(.lnCaption).foregroundStyle(Theme.textMuted) }
      if store.dirty { Text("Unsaved changes").font(.lnCaption).foregroundStyle(Theme.warning) }
    }
  }

  /// The document as a reader sees it: summary, then each section's Markdown.
  private var preview: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text(store.title).font(.lnTitle).foregroundStyle(Theme.textHighlighted)
      if !store.tldr.isEmpty {
        VStack(alignment: .leading, spacing: 4) {
          Text("In short").font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
          Text(store.tldr).font(.lnCallout).foregroundStyle(Theme.text)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      }
      ForEach(store.sections) { section in
        VStack(alignment: .leading, spacing: 8) {
          Text(section.heading).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          KnowledgeMarkdown(text: section.body)
        }
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  // MARK: Sidebar

  private func sidebar(_ document: LegalDocument) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      if document.isPublished, let publicURL { publicPanel(publicURL) }
      summaryPanel
      detailsPanel
      languagesPanel
      rulesPanel
      if !store.versions.isEmpty { versionsPanel }
    }
  }

  private func publicPanel(_ url: URL) -> some View {
    LegalPanel("Public page") {
      Text(url.absoluteString).font(.lnMono).foregroundStyle(Theme.textToned).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
      HStack(spacing: 8) {
        Button { openURL(url) } label: { Label("Open", systemImage: "arrow.up.right.square") }.buttonStyle(SecondaryButtonStyle(compact: true))
        Button { Clipboard.copy(url.absoluteString) } label: { Label("Copy link", systemImage: "link") }.buttonStyle(SecondaryButtonStyle(compact: true))
      }
      if store.dirty { Text("Saved edits to a published document change the live page at once; publish again to record a version.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
    }
  }

  private var summaryPanel: some View {
    LegalPanel(title: "Summary (TL;DR)", trailing: {
      if !store.tldrSource.isEmpty { Tag(text: legalSourceLabel(store.tldrSource), tint: store.tldrSource == "human" ? Theme.accent : Theme.info) }
    }, content: {
      LinearTextEditor(text: Binding(get: { store.tldr }, set: { store.editTldr($0) }), placeholder: String(localized: "A short plain-language summary shown at the top of the page"), minHeight: 96)
      HStack(spacing: 8) {
        Button {
          if store.tldrSource == "human" { confirm = .replaceTldr } else { Task { await store.generateTldr() } }
        } label: {
          Label(store.busy == "tldr" ? "Writing…" : store.tldrSource == "human" ? "Replace with AI summary" : "Write with AI", systemImage: "sparkles")
        }
        .buttonStyle(SecondaryButtonStyle(compact: true)).disabled(store.dirty || store.busy != "")
        if store.busy == "tldr" { ProgressView().controlSize(.small) }
      }
    })
  }

  private var detailsPanel: some View {
    LegalPanel("Details") {
      LabeledField(label: "Title") { TextField("", text: $store.title).textFieldStyle(.linear) }
      LabeledField(label: "URL name") {
        TextField("", text: $store.slug).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      LabeledField(label: "Effective date") {
        HStack(spacing: 10) {
          Toggle("Set", isOn: Binding(get: { !store.effective.isEmpty }, set: { store.effective = $0 ? LegalDay.string(.now) : "" }))
            .toggleStyle(.switch).tint(Theme.accent).labelsHidden()
          if !store.effective.isEmpty {
            DatePicker("Effective date", selection: Binding(get: { LegalDay.date(store.effective) ?? .now }, set: { store.effective = LegalDay.string($0) }), displayedComponents: .date)
              .labelsHidden().environment(\.timeZone, LegalDay.utc)
          } else {
            Text("Set when you publish").font(.lnMeta).foregroundStyle(Theme.textMuted)
          }
        }
      }
      Button { showWizard = true } label: { Label("Answers and recompose", systemImage: "checklist") }
        .buttonStyle(SecondaryButtonStyle(compact: true)).disabled(store.dirty)
    }
  }

  /// This text's language and the same text in other languages (web: the Languages card of legal/[docId].vue).
  private var languagesPanel: some View {
    LegalPanel("Languages") {
      if let document {
        LabeledField(label: "Written in", hint: "Public pages link the languages of one document to each other.") {
          LanguageMenu(include: [document.language], onPick: { tag in Task { await store.setLocale(tag) } }) { Label(ContentLocale.label(document.language), systemImage: "globe") }
            .disabled(store.dirty || store.busy != "")
        }
        if store.otherLanguages.isEmpty {
          Text("No other languages yet.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        } else {
          VStack(spacing: 0) {
            ForEach(store.otherLanguages) { other in
              Button { opened = other.id } label: {
                HStack(spacing: 8) {
                  VStack(alignment: .leading, spacing: 2) {
                    Text(ContentLocale.label(other.language)).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                    Text(other.title.isEmpty ? other.kind.label : other.title).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
                  }
                  Spacer(minLength: 4)
                  Tag(text: other.isPublished ? "Published" : "Draft", tint: other.isPublished ? Theme.success : Theme.textDimmed)
                  Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
                }
                .padding(.vertical, 8)
                .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
            }
          }
        }
        HStack(spacing: 8) {
          Button { translating = true } label: { Label("Translate with AI", systemImage: "sparkles") }
            .buttonStyle(SecondaryButtonStyle(compact: true)).disabled(store.dirty || store.busy != "")
          if store.busy == "locale" { ProgressView().controlSize(.small) }
        }
        if store.dirty { Text("Save your edits first: translating and changing the language use the saved text.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        Text("Translations are drafts to review, not legal advice. Have a person who reads the language check them before you publish.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
    }
  }

  private var rulesPanel: some View {
    LegalPanel("Rules check") {
      if let coverage = store.coverage { LegalCoverageSummary(coverage: coverage) }
      HStack(spacing: 8) {
        Button { Task { await store.checkWithAI() } } label: { Label(store.busy == "check" ? "Checking…" : "Check the text with AI", systemImage: "doc.text.magnifyingglass") }
          .buttonStyle(SecondaryButtonStyle(compact: true)).disabled(store.dirty || store.busy != "")
        if store.busy == "check" { ProgressView().controlSize(.small) }
      }
      if let findings = store.findings { findingsList(findings) }
    }
  }

  @ViewBuilder private func findingsList(_ findings: [LegalFinding]) -> some View {
    let summaries = Dictionary((store.coverage?.covered ?? []).map { ($0.id, $0.summary) } + (store.coverage?.gaps ?? []).map { ($0.id, $0.summary) }, uniquingKeysWith: { first, _ in first })
    let flagged = LegalFindingRow.sorted(findings.filter { $0.status != "ok" })
    if flagged.isEmpty {
      Text("The model found nothing to flag.").font(.lnMeta).foregroundStyle(Theme.textMuted)
    } else {
      Text(LegalFindingRow.tally(findings)).font(.lnCaptionMedium).foregroundStyle(Theme.textMuted)
      ForEach(flagged) { LegalFindingRow(finding: $0, summary: summaries[$0.requirement]) }
    }
  }

  private var versionsPanel: some View {
    LegalPanel("Versions") {
      ForEach(store.versions) { version in
        HStack(spacing: 8) {
          Text("v\(version.version)").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
          Text(version.note.isEmpty ? DateText.day(version.publishedAt) : version.note).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(2)
          Spacer(minLength: 4)
          Button("Restore") { confirm = .restore(version.version) }.buttonStyle(GhostButtonStyle()).disabled(store.dirty || store.busy != "")
        }
      }
    }
  }
}
