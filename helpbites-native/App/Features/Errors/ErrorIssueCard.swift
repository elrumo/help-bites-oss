import SwiftUI

/// One error as a row that opens into its latest event: stack trace, details,
/// breadcrumbs, tags and the AI fix (web: ErrorIssueCard.vue).
struct ErrorIssueCard: View {
  let issue: ErrorIssue
  let projectId: String
  let showLink: Bool
  let onStatus: (String) -> Void

  @Environment(SessionStore.self) private var session
  @Environment(\.openURL) private var openURL
  @State private var open = false
  @State private var loading = false
  @State private var loadError = ""
  @State private var detail: ErrorDetail?
  @State private var tab = Tab.stack
  @State private var showAll = false
  @State private var analysis: ErrorAnalysis?
  @State private var analyzing = false
  @State private var copying = false
  @State private var copied = false
  @State private var aiError = ""

  private enum Tab: String, CaseIterable, Identifiable {
    case stack = "Stacktrace", details = "Details", crumbs = "Breadcrumbs", tags = "Tags"
    var id: String { rawValue }
  }

  private var path: String { "/v1/admin/errors/\(issue.issueId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? issue.issueId)" }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      if open { expanded.padding(.top, 4).padding(.bottom, 12) }
    }
    .animation(nil, value: open)
  }

  // MARK: Header

  private var header: some View {
    HStack(spacing: 8) {
      Button { toggle() } label: {
        HStack(spacing: 10) {
          Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textMuted)
            .rotationEffect(.degrees(open ? 90 : 0)).frame(width: 12)
          Image(systemName: "ladybug").font(.system(size: 13)).foregroundStyle(issue.isSevere ? Theme.error : Theme.warning)
          VStack(alignment: .leading, spacing: 2) {
            Text(issue.title).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(open ? 3 : 1)
            Text(subtitle).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
          }
          Spacer(minLength: 0)
        }
        .frame(minHeight: Metrics.rowHeight)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(issue.title)
      .accessibilityValue(open ? "Expanded" : "Collapsed")
      if showLink && !issue.linkLabel.isEmpty { Tag(text: issue.linkLabel) }
      Menu {
        if let raw = issue.url, let url = URL(string: raw) {
          Button { openURL(url) } label: { Label("Open in \(issue.providerName.isEmpty ? "tracker" : issue.providerName)", systemImage: "arrow.up.right") }
          Divider()
        }
        Button("Open") { onStatus("open") }
        Button("Resolve") { onStatus("resolved") }
        Button("Ignore") { onStatus("closed") }
      } label: {
        Image(systemName: "ellipsis").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).contentShape(Rectangle())
      }
      .buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
      .accessibilityLabel("Change status")
    }
  }

  private var subtitle: String {
    var parts = [issue.culprit.isEmpty ? "Unknown location" : issue.culprit, "\(max(issue.count, 1)) events"]
    if let last = DateText.date(issue.lastSeen) { parts.append("last seen \(last.formatted(date: .abbreviated, time: .shortened))") }
    return parts.joined(separator: " · ")
  }

  // MARK: Expanded

  private var expanded: some View {
    VStack(alignment: .leading, spacing: 14) {
      if loading {
        SkeletonRows(count: 2).padding(-Metrics.gutter)
      } else if !loadError.isEmpty {
        ErrorText(message: loadError)
      } else if let detail {
        eventView(detail)
      }
      aiSection
    }
    .padding(12)
    .background(Theme.elevated.opacity(0.5), in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  private func eventView(_ detail: ErrorDetail) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .topLeading)], alignment: .leading, spacing: 8) {
        ForEach(keyInfo(detail), id: \.0) { label, value in
          VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.lnCaption).foregroundStyle(Theme.textMuted)
            Text(value).font(.lnMeta).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          }
        }
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(detail.exception.type).font(.lnRow).foregroundStyle(Theme.textHighlighted)
        if !detail.exception.value.isEmpty { Text(detail.exception.value).font(.lnMeta).foregroundStyle(Theme.textMuted).textSelection(.enabled) }
      }
      Picker("Event", selection: $tab) { ForEach(Tab.allCases) { Text($0.rawValue).tag($0) } }
        .pickerStyle(.segmented).labelsHidden()
      switch tab {
      case .stack: stack(detail)
      case .details: pairs(detail.details, empty: "No extra details on this event.", labelWidth: 96)
      case .crumbs: crumbs(detail)
      case .tags: pairs(detail.tags, empty: "No tags on this event.", labelWidth: 110)
      }
      Text("Showing the latest event\(DateText.date(detail.at).map { ", \($0.formatted(date: .abbreviated, time: .shortened))" } ?? ""). Older events are in \(issue.providerName.isEmpty ? "the tracker" : issue.providerName).")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  private func keyInfo(_ detail: ErrorDetail) -> [(String, String)] {
    func when(_ raw: String) -> String { DateText.date(raw).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "—" }
    let info = detail.issue
    return [
      ("Issue", info.shortId.isEmpty ? (issue.shortId.isEmpty ? issue.issueId : issue.shortId) : info.shortId),
      ("State", info.status),
      ("Events", String(info.count > 0 ? info.count : max(issue.count, 1))),
      ("First seen", when(info.firstSeen)),
      ("Last seen", when(info.lastSeen.isEmpty ? issue.lastSeen : info.lastSeen))
    ]
  }

  private func stack(_ detail: ErrorDetail) -> some View {
    let hasInApp = detail.frames.contains { $0.inApp }
    let shown = detail.frames.filter { showAll || $0.inApp || !hasInApp }
    return VStack(alignment: .leading, spacing: 6) {
      if detail.frames.isEmpty { Text("This event has no stack trace.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
      ForEach(Array(shown.enumerated()), id: \.element.id) { index, frame in
        ErrorFrameRow(frame: frame, startsOpen: index == 0)
      }
      if hasInApp && detail.frames.contains(where: { !$0.inApp }) {
        Button(showAll ? "Show only your code" : "Show library frames too") { showAll.toggle() }.buttonStyle(.lnGhost)
      }
    }
  }

  private func crumbs(_ detail: ErrorDetail) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      if detail.breadcrumbs.isEmpty { Text("No breadcrumbs recorded.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
      ForEach(Array(detail.breadcrumbs.enumerated()), id: \.offset) { _, crumb in
        HStack(alignment: .top, spacing: 10) {
          Text(crumb.category.isEmpty ? crumb.level : crumb.category).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1).frame(width: 84, alignment: .leading)
          Text(crumb.message).font(.lnMeta).foregroundStyle(Theme.text).textSelection(.enabled)
          Spacer(minLength: 0)
        }
      }
    }
  }

  private func pairs(_ rows: [[String]], empty: String, labelWidth: CGFloat) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      if rows.isEmpty { Text(empty).font(.lnMeta).foregroundStyle(Theme.textMuted) }
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        if row.count > 1 {
          HStack(alignment: .top, spacing: 10) {
            Text(row[0]).font(.lnMeta).foregroundStyle(Theme.textMuted).frame(width: labelWidth, alignment: .leading)
            Text(row[1]).font(.lnMeta).foregroundStyle(Theme.text).textSelection(.enabled)
            Spacer(minLength: 0)
          }
        }
      }
    }
  }

  // MARK: Fix with AI

  private var aiSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        Image(systemName: "sparkles").foregroundStyle(Theme.accent)
        Text("Fix with AI").font(.lnRow).foregroundStyle(Theme.textHighlighted)
        Spacer(minLength: 0)
      }
      FlowLayout(spacing: 8) {
        Button { Task { await analyze(refresh: analysis != nil) } } label: {
          if analyzing { ProgressView().controlSize(.small) } else { Label(analysis == nil ? "Analyze and suggest a fix" : "Analyze again", systemImage: "wand.and.stars") }
        }
        .buttonStyle(.lnSecondaryCompact).disabled(analyzing)
        Button { Task { await copyPrompt() } } label: {
          if copying { ProgressView().controlSize(.small) } else { Label(copied ? "Copied" : "Copy prompt for a coding agent", systemImage: copied ? "checkmark" : "doc.on.clipboard") }
        }
        .buttonStyle(.lnSecondaryCompact).disabled(copying)
      }
      ErrorText(message: aiError)
      if let analysis {
        ErrorMarkdown(text: analysis.text)
        Text((analysis.files.isEmpty ? "No source files from GitHub were found for this stack trace, so this is based on the event alone." : "Read \(analysis.files.joined(separator: ", ")) from your GitHub repos (default branch).") + (analysis.cached ? " Saved from an earlier run." : ""))
          .font(.lnCaption).foregroundStyle(Theme.textMuted)
      } else if !analyzing {
        Text("Reads the stack trace and, when GitHub repos are connected to the project, the source files it passes through.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
    }
    .padding(12)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  // MARK: Requests

  private func toggle() {
    open.toggle()
    guard open, detail == nil, !loading else { return }
    Task { await loadDetail() }
  }

  private func loadDetail() async {
    loading = true; loadError = ""
    defer { loading = false }
    do {
      detail = try await session.get(path, query: ["project": projectId, "link": issue.linkId])
    } catch { loadError = error.localizedDescription }
  }

  private struct AnalyzeInput: Encodable, Sendable {
    let project, link: String
    var refresh, prompt: Bool?
  }

  private func analyze(refresh: Bool) async {
    analyzing = true; aiError = ""
    defer { analyzing = false }
    do {
      analysis = try await session.send("\(path)/analyze", body: AnalyzeInput(project: projectId, link: issue.linkId, refresh: refresh))
    } catch { aiError = error.localizedDescription }
  }

  private func copyPrompt() async {
    struct Output: Decodable, Sendable { let prompt: String }
    copying = true; aiError = ""
    defer { copying = false }
    do {
      let output: Output = try await session.send("\(path)/analyze", body: AnalyzeInput(project: projectId, link: issue.linkId, prompt: true))
      Clipboard.copy("Fix this production error. Find the cause in the code and make the smallest safe change.\n\n\(output.prompt)")
      copied = true
      try? await Task.sleep(for: .seconds(2))
      copied = false
    } catch { aiError = error.localizedDescription }
  }
}

/// One stack frame: file:line in function, opening to the source lines around it.
private struct ErrorFrameRow: View {
  let frame: ErrorDetail.Frame
  @State private var expanded: Bool

  init(frame: ErrorDetail.Frame, startsOpen: Bool) {
    self.frame = frame
    _expanded = State(initialValue: startsOpen)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Button { expanded.toggle() } label: {
        HStack(alignment: .top, spacing: 8) {
          Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textMuted)
            .rotationEffect(.degrees(expanded ? 90 : 0)).padding(.top, 3).opacity(frame.context.isEmpty ? 0.3 : 1)
          (Text(frame.file).foregroundStyle(frame.inApp ? Theme.textHighlighted : Theme.textMuted)
            + Text(frame.line > 0 ? ":\(frame.line)" : "").foregroundStyle(Theme.textMuted)
            + Text(" in ").foregroundStyle(Theme.textMuted)
            + Text(frame.function).foregroundStyle(Theme.text))
            .font(.lnMono).multilineTextAlignment(.leading)
          Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      if expanded && !frame.context.isEmpty {
        Rectangle().fill(Theme.border).frame(height: 0.5)
        ScrollView(.horizontal, showsIndicators: false) {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(frame.before.enumerated()), id: \.offset) { _, line in Text(line).foregroundStyle(Theme.textMuted) }
            Text(frame.context).fontWeight(.semibold).foregroundStyle(Theme.error)
            ForEach(Array(frame.after.enumerated()), id: \.offset) { _, line in Text(line).foregroundStyle(Theme.textMuted) }
          }
          .font(.lnMono).textSelection(.enabled).padding(10)
        }
      }
    }
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }
}
