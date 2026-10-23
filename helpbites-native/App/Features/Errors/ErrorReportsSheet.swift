import SwiftUI

/// Every saved AI report on a project's errors, newest first: read, copy or delete
/// (web: ErrorReportsModal.vue).
struct ErrorReportsSheet: View {
  let projectId: String
  /// Called with the newest report left (nil when none) after a delete, so the screen's overview card follows.
  var onChanged: (ErrorOverview?) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var reports: [ErrorOverview] = []
  @State private var loading = true
  @State private var error = ""
  @State private var copied = ""
  @State private var deleting: ErrorOverview?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          Text("Every AI analysis of this project's errors, newest first. The latest 100 are kept.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
          if loading {
            SkeletonRows(count: 3).padding(-Metrics.gutter)
          } else if reports.isEmpty && error.isEmpty {
            Text("No reports yet. Run “Analyze with AI” or set a schedule.").font(.lnMeta).foregroundStyle(Theme.textMuted)
              .frame(maxWidth: .infinity).padding(.vertical, 24)
          }
          ForEach(reports) { report in card(report) }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("AI reports")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
      .confirmationDialog("Delete this report?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { report in
        Button("Delete report", role: .destructive) { Task { await remove(report) } }
      }
    }
    #if os(macOS)
    .frame(minWidth: 520, minHeight: 560)
    #endif
    .task { await load() }
  }

  private func card(_ report: ErrorOverview) -> some View {
    DisclosureGroup {
      VStack(alignment: .leading, spacing: 8) {
        ErrorMarkdown(text: report.text)
        if !report.files.isEmpty {
          Text("Read code from: \(report.files.joined(separator: ", "))").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
      }
      .padding(.top, 8)
    } label: {
      HStack(spacing: 8) {
        VStack(alignment: .leading, spacing: 2) {
          Text(DateText.date(report.at)?.formatted(date: .abbreviated, time: .shortened) ?? "").font(.lnBody)
          Text("\(report.source == "scheduled" ? String(localized: "Scheduled") : String(localized: "Manual")) · \(report.count == 1 ? "1 error" : "\(report.count) errors")")
            .font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
        Spacer()
        IconButton(systemImage: copied == report.id ? "checkmark" : "doc.on.doc", label: "Copy report") {
          Clipboard.copy(report.text)
          copied = report.id
          Task { try? await Task.sleep(for: .seconds(1.5)); if copied == report.id { copied = "" } }
        }
        IconButton(systemImage: "trash", label: "Delete report") { deleting = report }
      }
    }
    .padding(12)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  private func load() async {
    struct Loaded: Decodable, Sendable { let reports: [ErrorOverview] }
    defer { loading = false }
    do {
      let loaded: Loaded = try await session.get("/v1/admin/errors/reports", query: ["project": projectId])
      reports = loaded.reports
    } catch { self.error = error.localizedDescription }
  }

  private func remove(_ report: ErrorOverview) async {
    error = ""
    do {
      try await session.delete("/v1/admin/errors/reports/\(report.id)?project=\(projectId)")
      reports.removeAll { $0.id == report.id }
      onChanged(reports.first)
    } catch { self.error = error.localizedDescription }
  }
}
