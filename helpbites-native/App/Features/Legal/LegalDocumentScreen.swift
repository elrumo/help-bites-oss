import SwiftUI

/// Placeholder until the screen is built from app/pages/projects/[id]/legal/[docId].vue.
struct LegalDocumentScreen: View {
  let projectId: String
  let documentId: String
  var body: some View {
    ScrollView { EmptyState(systemImage: "scale.3d", title: "Document", message: "Coming soon.") }
      .projectScreen(projectId, "Legal")
  }
}
