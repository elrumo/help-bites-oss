import SwiftUI

/// Addresses a project no longer mails (EmailSuppressions.vue): hard bounces
/// and spam reports from Mailgun's webhook, unsubscribes, and addresses added
/// here or through the API. Removing one mails it again. Shown by `EmailLibraryScreen`: behind
/// the Log of a project's Email, as the Suppressed tab of the shared templates' page.
struct EmailSuppressionsScreen: View {
  let projectId: String?
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace

  @State private var rows: [EmailSuppression] = []
  @State private var nextBefore: String?
  @State private var loading = true
  @State private var loadingMore = false
  @State private var search = ""
  @State private var reason = ""
  @State private var error = ""
  @State private var notice = ""
  @State private var adding = false
  @State private var removing: EmailSuppression?

  private struct Filters: Equatable { var q = "", reason = "" }
  private var filters: Filters { Filters(q: search.trimmingCharacters(in: .whitespacesAndNewlines), reason: reason) }

  var body: some View {
    VStack(spacing: 0) {
      header
      List {
        if !notice.isEmpty {
          HStack(spacing: 8) {
            EmailNotice(systemImage: "checkmark.circle", title: notice, tone: .success)
            Button { notice = "" } label: { Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textMuted) }
              .buttonStyle(.plain)
              .accessibilityLabel("Dismiss")
          }
          .padding(.vertical, 8)
          .linearRow()
        }
        if !error.isEmpty { ErrorText(message: error).padding(.vertical, 8).linearRow() }
        if loading {
          SkeletonRows(count: 6).linearRow()
        } else if rows.isEmpty {
          EmptyState(
            systemImage: "envelope.badge",
            title: filters == Filters() ? "Every address gets mail" : "Nothing matches",
            message: filters == Filters() ? "Nobody has bounced, reported spam or unsubscribed yet." : "Try another filter."
          )
          .linearRow()
        } else {
          ForEach(rows) { row($0) }
          if nextBefore != nil {
            HStack {
              Spacer()
              if loadingMore { ProgressView() } else {
                Button("Load more") { Task { await loadMore() } }.buttonStyle(.lnSecondaryCompact)
              }
              Spacer()
            }
            .padding(.vertical, 12)
            .linearRow()
          }
        }
      }
      .linearList()
      .refreshable { await load() }
    }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button { adding = true } label: { Label("Add", systemImage: "plus") }
      }
    }
    .task {
      if projectId == nil && workspace.projects.isEmpty { await workspace.loadProjects() }
    }
    .task(id: filters) {
      if !loading { try? await Task.sleep(for: .milliseconds(300)) }
      guard !Task.isCancelled else { return }
      await load()
    }
    .confirmationDialog(
      removing.map { "Email \($0.email ?? "this address") again\(projectId == nil ? " from \(projectName($0.projectId))" : "")?" } ?? "",
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
      titleVisibility: .visible,
      presenting: removing
    ) { row in
      Button("Email it again") { Task { await remove(row) } }
    }
    .sheet(isPresented: $adding) {
      EmailSuppressionAddSheet(projectId: projectId) { result in
        let added = result.added?.count ?? 0
        let existing = result.existing ?? 0
        notice = "\(added) added" + (existing > 0 ? ", \(existing) already on the list" : "")
        Task { await load() }
      }
    }
  }

  // MARK: Layout

  private var header: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Sends skip these addresses. Hard bounces, spam reports and Mailgun unsubscribes are added on their own once the delivery webhook is set up.")
        .font(.lnMeta)
        .foregroundStyle(Theme.textMuted)
      HStack(spacing: 8) {
        SearchField(text: $search, prompt: "Address")
          .textInputAutocapitalization(.never)
          .keyboardType(.emailAddress)
        Menu {
          Picker("Reason", selection: $reason) {
            Text("Any reason").tag("")
            ForEach(EmailStatusText.suppressionReasons, id: \.key) { item in Text(item.label).tag(item.key) }
          }
        } label: {
          HStack(spacing: 4) {
            Text(reason.isEmpty ? "Reason" : EmailStatusText.reason(reason)).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
          }
          .font(.lnMetaMedium)
          .foregroundStyle(reason.isEmpty ? Theme.textMuted : Theme.textHighlighted)
          .padding(.horizontal, 10)
          .frame(height: 30)
          .background(reason.isEmpty ? Color.clear : Theme.elevated, in: Capsule())
          .overlay(Capsule().strokeBorder(reason.isEmpty ? Theme.border : Theme.borderAccented))
        }
      }
    }
    .padding(.horizontal, Metrics.gutter)
    .padding(.vertical, 10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 0.5) }
  }

  private func row(_ row: EmailSuppression) -> some View {
    HStack(spacing: 10) {
      EmailToneBadge(label: EmailStatusText.reason(row.reason), tone: EmailStatusText.reasonTone(row.reason)).frame(width: 104, alignment: .leading)
      VStack(alignment: .leading, spacing: 2) {
        Text(row.email ?? "").font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1).textSelection(.enabled)
        HStack(spacing: 4) {
          if let detail = row.detail, !detail.isEmpty {
            Text(detail).lineLimit(1)
            Text("·")
          }
          if projectId == nil {
            Text(projectName(row.projectId)).lineLimit(1)
            Text("·")
          }
          Text(sourceLabel(row.source))
        }
        .font(.lnCaption)
        .foregroundStyle(Theme.textMuted)
      }
      Spacer(minLength: 4)
      Text(EmailStatusText.logTime(row.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
      IconButton(systemImage: "arrow.uturn.backward", label: "Email \(row.email ?? "it") again") { removing = row }
    }
    .padding(.vertical, 6)
    .frame(minHeight: Metrics.rowHeight)
    .contextMenu {
      Button { removing = row } label: { Label("Email it again", systemImage: "arrow.uturn.backward") }
      Button { Clipboard.copy(row.email) } label: { Label("Copy address", systemImage: "doc.on.doc") }
    }
    .linearRow()
  }

  private func sourceLabel(_ source: String?) -> String {
    switch source {
    case "webhook": "Mailgun"
    case "api": "API"
    default: "Panel"
    }
  }

  private func projectName(_ id: String?) -> String {
    guard let id, !id.isEmpty else { return "Project" }
    return workspace.project(id)?.name ?? "Project"
  }

  // MARK: Data

  private func query(before: String? = nil) -> [String: String] {
    var query: [String: String] = [:]
    let current = filters
    if let projectId { query["project"] = projectId }
    if !current.q.isEmpty { query["q"] = current.q }
    if !current.reason.isEmpty { query["reason"] = current.reason }
    if let before { query["before"] = before }
    return query
  }

  private func load() async {
    do {
      let response: EmailSuppressionList = try await session.get("/v1/admin/email-suppressions", query: query())
      rows = response.suppressions
      nextBefore = response.nextBefore
      error = ""
    } catch {
      if Task.isCancelled { return }
      self.error = error.localizedDescription.isEmpty ? "Could not load the list" : error.localizedDescription
    }
    loading = false
  }

  private func loadMore() async {
    guard let before = nextBefore else { return }
    loadingMore = true
    defer { loadingMore = false }
    do {
      let response: EmailSuppressionList = try await session.get("/v1/admin/email-suppressions", query: query(before: before))
      let known = Set(rows.map(\.id))
      rows.append(contentsOf: response.suppressions.filter { !known.contains($0.id) })
      nextBefore = response.nextBefore
    } catch { self.error = error.localizedDescription }
  }

  private func remove(_ row: EmailSuppression) async {
    do {
      try await session.delete("/v1/admin/email-suppressions/\(row.id)")
      rows.removeAll { $0.id == row.id }
    } catch { self.error = error.localizedDescription.isEmpty ? "Could not remove it" : error.localizedDescription }
  }
}

/// "Stop emailing addresses": one or many, for this project (or a picked one on the global page).
struct EmailSuppressionAddSheet: View {
  let projectId: String?
  var onAdded: @MainActor (EmailSuppressionAddResult) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var project = ""
  @State private var emails = ""
  @State private var reason = "manual"
  @State private var detail = ""
  @State private var saving = false
  @State private var error = ""

  private var canAdd: Bool { !emails.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !(projectId ?? project).isEmpty }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Text("These addresses get no more email from the project until you remove them.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          if projectId == nil {
            LabeledField(label: "Project") {
              Picker("Project", selection: $project) {
                if project.isEmpty { Text("Choose a project").tag("") }
                ForEach(workspace.projects) { item in Text(item.name).tag(item.id) }
              }
              .pickerStyle(.menu)
              .tint(Theme.text)
            }
          }
          LabeledField(label: "Addresses", hint: "One per line, or separated by commas") {
            LinearTextEditor(text: $emails, placeholder: "someone@example.com", minHeight: 110, monospaced: true)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .keyboardType(.emailAddress)
          }
          LabeledField(label: "Reason") {
            Picker("Reason", selection: $reason) {
              ForEach(EmailStatusText.suppressionReasons, id: \.key) { item in Text(item.label).tag(item.key) }
            }
            .pickerStyle(.menu)
            .tint(Theme.text)
          }
          LabeledField(label: "Note") {
            TextField("Optional", text: $detail).textFieldStyle(.linear)
          }
          ErrorText(message: error)
        }
        .padding(20)
        .frame(maxWidth: 560, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .panelScreen("Stop emailing addresses")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if saving { ProgressView() } else { Button("Add") { Task { await add() } }.disabled(!canAdd) }
        }
      }
      .task {
        if workspace.projects.isEmpty && projectId == nil { await workspace.loadProjects() }
        if project.isEmpty { project = projectId ?? workspace.projects.first?.id ?? "" }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func add() async {
    let target = projectId ?? project
    let list = EmailExport.addresses(emails.lowercased())
    guard !target.isEmpty, !list.isEmpty else { return }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let result: EmailSuppressionAddResult = try await session.send("/v1/admin/email-suppressions", body: EmailSuppressionInput(project: target, emails: list, reason: reason, detail: detail.trimmingCharacters(in: .whitespacesAndNewlines)))
      onAdded(result)
      dismiss()
    } catch { self.error = error.localizedDescription.isEmpty ? "Could not add them" : error.localizedDescription }
  }
}
