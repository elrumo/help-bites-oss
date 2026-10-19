import SwiftUI

/// A project's legal documents (web: projects/[id]/legal/index.vue): the list,
/// the wizard that starts one, the analyse tool and the identity/look settings.
struct LegalScreen: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @Environment(\.openURL) private var openURL
  @State private var documents: [LegalDocument] = []
  @State private var loading = true
  @State private var error = ""
  @State private var sheet: Sheet?
  /// The document the wizard just made, pushed when its sheet closes.
  @State private var created: String?
  @State private var path: String?

  private enum Sheet: String, Identifiable { case wizard, analyse, look; var id: String { rawValue } }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Legal documents").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text("Host your privacy policy, terms and more without running a page. Publish a document and link to its public page from your app. These are drafts to review, not legal advice.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
        }
        ErrorText(message: error)
        if loading && documents.isEmpty {
          SkeletonRows(count: 3)
        } else if documents.isEmpty && error.isEmpty {
          EmptyState(systemImage: "scale.3d", title: "No documents yet", message: "Answer a few questions and get a privacy policy, terms, cookie or refund policy built from reviewed clauses.") {
            Button { sheet = .wizard } label: { Label("New document", systemImage: "plus") }.buttonStyle(.lnPrimaryCompact)
          }
          .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else if !documents.isEmpty {
          Card {
            ForEach(Array(documents.enumerated()), id: \.element.id) { index, doc in
              CardRow(divider: index < documents.count - 1) { row(doc) }
            }
          }
        }
      }
      .frame(maxWidth: 760, alignment: .leading)
      .padding(.horizontal, 20)
      .padding(.vertical, 28)
      .frame(maxWidth: .infinity)
    }
    .refreshable { await load() }
    .projectScreen(projectId, "Legal")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Menu {
          Button { sheet = .look } label: { Label("Identity and look", systemImage: "paintpalette") }
          Button { sheet = .analyse } label: { Label("Analyse text", systemImage: "doc.text.magnifyingglass") }
        } label: { Label("More", systemImage: "ellipsis.circle") }
      }
      ToolbarItem(placement: .primaryAction) {
        Button { sheet = .wizard } label: { Label("New document", systemImage: "plus") }
      }
    }
    .sheet(item: $sheet, onDismiss: {
      // Open the new draft once the wizard is gone, as the web does.
      if let created { path = created; self.created = nil }
    }) { sheet in
      switch sheet {
      case .wizard: LegalWizardSheet(projectId: projectId, document: nil) { created = $0.id }
      case .analyse: LegalAnalyseSheet()
      case .look: LegalLookSheet(projectId: projectId)
      }
    }
    .navigationDestination(item: $path) { id in LegalDocumentScreen(projectId: projectId, documentId: id) }
    .routes()
    .task { await load() }
  }

  private func row(_ doc: LegalDocument) -> some View {
    HStack(spacing: 10) {
      NavigationLink(value: AppRoute.legalDocument(projectId, doc.id)) {
        VStack(alignment: .leading, spacing: 2) {
          Text(doc.title.isEmpty ? doc.kind.label : doc.title).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Text("/legal/…/\(doc.slug)").font(.lnMono).foregroundStyle(Theme.textMuted).lineLimit(1)
          HStack(spacing: 6) {
            Tag(text: doc.kind.label)
            Tag(text: doc.isPublished ? "Published v\(doc.version)" : "Draft", tint: doc.isPublished ? Theme.success : Theme.textDimmed)
          }
          .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      if doc.isPublished, let url = LegalAPI.publicURL(session, doc.path) {
        Button { openURL(url) } label: { Image(systemName: "arrow.up.right.square").foregroundStyle(Theme.textMuted) }
          .buttonStyle(.plain).help("Open the public page").accessibilityLabel("Open the public page")
      }
      Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
    }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let documents: [LegalDocument] }
    do {
      let response: Response = try await session.get("/v1/admin/legal/documents", query: ["project": projectId])
      documents = response.documents
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
  }
}
