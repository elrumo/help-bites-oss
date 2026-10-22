import SwiftUI

/// Alert rules for a project's errors: email the team when an error crosses a
/// line (web: ErrorAlertsModal.vue).
struct ErrorAlertsSheet: View {
  let projectId: String
  let links: [ProjectsAdminProject.ErrorLink]
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var rules: [ErrorAlertRule] = []
  @State private var emails = ""
  @State private var notifyEmails: [String] = []
  @State private var recent: [FiredErrorAlert] = []
  @State private var loading = true
  @State private var saving = false
  @State private var error = ""
  @State private var deleting: ErrorAlertRule?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Email the team (and post to Telegram, when connected in Settings → Connections) when an error crosses a line. Checked every minute, and as soon as the tracker's alert webhook calls.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
          if loading {
            SkeletonRows(count: 2).padding(-Metrics.gutter)
          } else {
            LabeledField(label: "Send to", hint: notifyEmails.isEmpty ? "Comma-separated addresses. The project has no notify emails, so add at least one." : "Left blank, alerts go to the project's notify emails (\(notifyEmails.joined(separator: ", "))).") {
              TextField("oncall@example.com, dev@example.com", text: $emails).textFieldStyle(.linear)
                .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            if rules.isEmpty {
              Text("No rules yet. Add one to get an email when an error spikes.").font(.lnMeta).foregroundStyle(Theme.textMuted)
            }
            ForEach($rules) { $rule in ruleCard($rule) }
            Button { rules.append(.blank()) } label: { Label("Add rule", systemImage: "plus") }
              .buttonStyle(.lnSecondaryCompact).disabled(rules.count >= 20)
            if !recent.isEmpty { recentAlerts }
          }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("Error alerts")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button { Task { await save() } } label: { if saving { ProgressView() } else { Text("Save") } }.disabled(loading || saving)
        }
      }
      .confirmationDialog("Delete this rule?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { rule in
        Button("Delete rule", role: .destructive) { rules.removeAll { $0.id == rule.id } }
      } message: { rule in
        Text(rule.name.isEmpty ? "It stops alerting once you save." : "\(rule.name) stops alerting once you save.")
      }
    }
    #if os(macOS)
    .frame(minWidth: 520, minHeight: 560)
    #endif
    .task { await load() }
  }

  private func ruleCard(_ rule: Binding<ErrorAlertRule>) -> some View {
    let value = rule.wrappedValue
    return VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 10) {
        TextField(value.summary, text: rule.name).textFieldStyle(.linear)
        Toggle("Enabled", isOn: rule.enabled).labelsHidden().tint(Theme.accent)
        IconButton(systemImage: "trash", label: "Delete rule") { deleting = value }
      }
      FlowLayout(spacing: 8) {
        caption("When")
        Picker("Kind", selection: rule.kind) { ForEach(ErrorAlertRule.kinds, id: \.0) { Text($0.1).tag($0.0) } }
          .labelsHidden().tint(Theme.text)
          .onChange(of: value.kind) { old, new in
            // Switching kind keeps the cooldown people would expect for it unless they changed it.
            if rule.wrappedValue.cooldownMinutes == ErrorAlertRule.defaultCooldown[old] { rule.wrappedValue.cooldownMinutes = ErrorAlertRule.defaultCooldown[new] ?? 60 }
          }
        if value.kind != "new" {
          number(rule.threshold, label: "Number of events")
          caption("events")
        }
        if value.kind == "rate" {
          caption("within")
          number(rule.windowMinutes, label: "Window in minutes")
          caption("min")
        }
      }
      FlowLayout(spacing: 8) {
        caption("Then wait")
        number(rule.cooldownMinutes, label: "Minutes before the same error can alert again")
        caption("min before the same error alerts again")
      }
      if links.count > 1 {
        HStack(spacing: 8) {
          caption("For")
          Picker("For", selection: rule.link) {
            Text("All tracker projects").tag("")
            ForEach(links) { Text($0.label).tag($0.id) }
          }
          .labelsHidden().tint(Theme.text)
        }
      }
    }
    .padding(12)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    .opacity(value.enabled ? 1 : 0.6)
  }

  private func caption(_ text: LocalizedStringKey) -> some View { Text(text).font(.lnMeta).foregroundStyle(Theme.textMuted) }

  private func number(_ value: Binding<Int>, label: LocalizedStringKey) -> some View {
    TextField("", value: value, format: .number.grouping(.never)).textFieldStyle(.linear)
      .keyboardType(.numberPad).frame(width: 84).monospacedDigit().accessibilityLabel(label)
  }

  private var recentAlerts: some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionLabel("Recent alerts")
      ForEach(recent.prefix(20)) { alert in
        VStack(alignment: .leading, spacing: 1) {
          Text(alert.title).font(.lnMeta).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Text("\(Date(timeIntervalSince1970: alert.at / 1000).formatted(date: .abbreviated, time: .shortened)) · \(alert.rule) · \(alert.count) events")
            .font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
        }
      }
    }
  }

  private struct Loaded: Decodable, Sendable { let rules: [ErrorAlertRule]; let emails, notifyEmails: [String]; let recent: [FiredErrorAlert] }

  private func load() async {
    defer { loading = false }
    do {
      let loaded: Loaded = try await session.get("/v1/admin/errors/alerts", query: ["project": projectId])
      rules = loaded.rules
      emails = loaded.emails.joined(separator: ", ")
      notifyEmails = loaded.notifyEmails
      recent = loaded.recent
    } catch { self.error = error.localizedDescription }
  }

  private func save() async {
    struct Input: Encodable, Sendable { let project: String; let rules: [ErrorAlertRule]; let emails: [String] }
    struct Output: Decodable, Sendable {}
    saving = true; error = ""
    defer { saving = false }
    do {
      let list = emails.split(whereSeparator: { $0 == "," || $0.isWhitespace }).map(String.init)
      let _: Output = try await session.send("/v1/admin/errors/alerts", method: "PUT", body: Input(project: projectId, rules: rules, emails: list))
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
