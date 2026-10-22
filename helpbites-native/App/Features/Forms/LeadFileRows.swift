import SwiftUI

/// Files people sent through a lead form's file fields (web: components/contacts/LeadFileList.vue):
/// one person's or one form's, newest first. They are private, so a download goes through the
/// API with the operator's session and opens in the share sheet. Rows only: it sits in a Form
/// section or a panel.
struct LeadFileRows: View {
  let projectId: String
  var contactId: String? = nil
  var formId: String? = nil
  /// The form's fields, to say which one a file came through.
  var fields: [LeadFormField] = []
  @Environment(SessionStore.self) private var session
  @State private var files: [LeadFile] = []
  @State private var loaded = false
  @State private var busyId = ""
  @State private var error = ""
  @State private var shared: PreviewItem?
  @State private var deleting: LeadFile?

  var body: some View {
    Group {
      if loaded && files.isEmpty {
        Text("No files yet.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      }
      ForEach(files) { file in
        HStack(spacing: 8) {
          Image(systemName: file.isImage ? "photo" : "doc").foregroundStyle(Theme.textMuted)
          VStack(alignment: .leading, spacing: 2) {
            Text(file.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
            Text("\(label(file.field)) · \(file.sizeText) · \(DateText.short(file.createdAt))").font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
          }
          Spacer(minLength: 8)
          if busyId == file.id { ProgressView().controlSize(.small) }
          Menu {
            Button { Task { await download(file) } } label: { Label("Download", systemImage: "arrow.down.circle") }
            Button(role: .destructive) { deleting = file } label: { Label("Delete", systemImage: "trash") }
          } label: { Image(systemName: "ellipsis.circle").foregroundStyle(Theme.textMuted) }
            .accessibilityLabel("File actions")
        }
        .contentShape(Rectangle())
        .onTapGesture { Task { await download(file) } }
      }
      if !error.isEmpty { ErrorText(message: error) }
    }
    .task { await load() }
    .sheet(item: $shared) { ShareSheet(url: $0.url).presentationDetents([.medium, .large]) }
    .confirmationDialog("Delete \(deleting?.name ?? String(localized: "this file")) for good?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
      Button("Delete file", role: .destructive) { if let file = deleting { Task { await delete(file) } } }
    }
  }

  private func label(_ key: String) -> String { fields.first { $0.key == key }.map { $0.label.isEmpty ? key : $0.label } ?? key }

  private func load() async {
    var query = ["project": projectId, "limit": "20"]
    if let contactId { query["contact"] = contactId }
    if let formId { query["form"] = formId }
    do {
      let response: LeadFilesResponse = try await session.get("/v1/admin/lead-files", query: query)
      files = response.files
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loaded = true
  }

  private func download(_ file: LeadFile) async {
    busyId = file.id
    error = ""
    defer { busyId = "" }
    do {
      let data = try await session.download("/v1/admin/lead-files/\(file.id)/download")
      let url = FileManager.default.temporaryDirectory.appending(path: file.name.replacingOccurrences(of: "/", with: "_"))
      try data.write(to: url, options: .atomic)
      shared = PreviewItem(url: url)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func delete(_ file: LeadFile) async {
    error = ""
    do {
      try await session.delete("/v1/admin/lead-files/\(file.id)")
      files.removeAll { $0.id == file.id }
    } catch {
      self.error = error.localizedDescription
    }
  }
}
