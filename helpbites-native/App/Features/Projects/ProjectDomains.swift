import SwiftUI

/// What a custom host opens on. Mirrors DOMAIN_TARGETS in shared/domains.ts
/// (tests/domainsNativeParity.test.ts keeps the two in step).
enum DomainTargets {
  static let all: [(key: String, label: String)] = [
    ("hub", "Public hub"), ("feedback", "Feedback board"), ("roadmap", "Roadmap"), ("changelog", "Changelog"), ("blog", "Blog")
  ]
  static func label(_ key: String) -> String { all.first { $0.key == key }?.label ?? key }
}

struct DomainDnsRecord: Decodable, Equatable, Sendable {
  let purpose, type, host, value, valid: String
}

struct ProjectDomain: Decodable, Identifiable, Equatable, Sendable {
  let id, host, target, state: String
  let dnsRecords: [DomainDnsRecord]
  var stateText: String {
    switch state { case "verified": return String(localized: "Live"); case "failed": return String(localized: "DNS not found yet"); default: return String(localized: "Waiting for DNS") }
  }
}

/// Project settings → Custom domains (web: components/settings/ProjectDomains.vue).
struct ProjectDomainsSection: View {
  let projectId: String
  @Environment(SessionStore.self) private var session

  @State private var domains: [ProjectDomain] = []
  @State private var loading = true
  @State private var host = ""
  @State private var target = "hub"
  @State private var adding = false
  @State private var busy = ""
  @State private var error = ""
  @State private var confirmRemove: ProjectDomain?

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        TextField("feedback.example.com", text: $host)
          .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          .padding(.horizontal, 10).padding(.vertical, 8)
          .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
        Picker("Opens on", selection: $target) {
          ForEach(DomainTargets.all, id: \.key) { Text(LocalizedStringKey($0.label)).tag($0.key) }
        }
        .labelsHidden()
        Button { Task { await add() } } label: { if adding { ProgressView() } else { Label("Add domain", systemImage: "plus") } }
          .buttonStyle(.lnGhost).disabled(adding || host.trimmingCharacters(in: .whitespaces).isEmpty)
      }
      ErrorText(message: error)
      if loading {
        SkeletonRows(count: 2)
      } else if domains.isEmpty {
        Text("No domains yet.").font(.lnCallout).foregroundStyle(Theme.textMuted)
      } else {
        Card {
          ForEach(Array(domains.enumerated()), id: \.element.id) { index, domain in
            CardRow(divider: index < domains.count - 1) { row(domain) }
          }
        }
      }
    }
    .confirmationDialog("Remove this domain?", isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } }), titleVisibility: .visible) {
      Button("Remove", role: .destructive) { if let target = confirmRemove { Task { await remove(target) } } }
    } message: {
      Text(confirmRemove?.host ?? "")
    }
    .task { await load() }
  }

  private func row(_ domain: ProjectDomain) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        StatusDot(status: domain.state == "verified" ? "active" : domain.state == "failed" ? "failed" : "pending", label: domain.stateText)
        Text(domain.host).font(.lnMono).foregroundStyle(Theme.textHighlighted).lineLimit(1).truncationMode(.middle)
        Spacer(minLength: 0)
        Menu {
          Picker("Opens on", selection: Binding(get: { domain.target }, set: { value in Task { await setTarget(domain, value) } })) {
            ForEach(DomainTargets.all, id: \.key) { Text(LocalizedStringKey($0.label)).tag($0.key) }
          }
        } label: { Text(LocalizedStringKey(DomainTargets.label(domain.target))).font(.lnMeta) }
        IconButton(systemImage: "arrow.triangle.2.circlepath", label: "Check DNS", bordered: false) { Task { await verify(domain) } }
        IconButton(systemImage: "trash", label: "Remove", bordered: false) { confirmRemove = domain }
      }
      if busy == domain.id { ProgressView().controlSize(.small) }
      if domain.state != "verified" {
        VStack(alignment: .leading, spacing: 6) {
          Text("Add these records at your DNS provider").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
          Text("Changes can take a few minutes to spread. Then check again.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          ForEach(domain.dnsRecords, id: \.purpose) { record in
            HStack(alignment: .top, spacing: 8) {
              Text(record.type).font(.lnMono).foregroundStyle(Theme.text).frame(width: 52, alignment: .leading)
              VStack(alignment: .leading, spacing: 2) {
                Text(record.host).font(.lnMono).foregroundStyle(Theme.textMuted).textSelection(.enabled)
                Text(record.value).font(.lnMono).foregroundStyle(Theme.text).textSelection(.enabled)
              }
              Spacer(minLength: 0)
              if record.valid != "unknown" {
                Image(systemName: record.valid == "valid" ? "checkmark" : "xmark").foregroundStyle(record.valid == "valid" ? Theme.success : Theme.error)
              }
              IconButton(systemImage: "doc.on.doc", label: "Copy", bordered: false) { Clipboard.copy(record.value) }
            }
          }
        }
        .padding(10)
        .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      }
    }
  }

  private var base: String { "/v1/admin/projects/\(projectId)/domains" }
  private struct Domains: Decodable, Sendable { let domains: [ProjectDomain] }
  private struct One: Decodable, Sendable { let domain: ProjectDomain }

  private func load() async {
    do { let list: Domains = try await session.get(base); domains = list.domains; error = "" } catch let failure { error = failure.localizedDescription }
    loading = false
  }

  private func add() async {
    struct Input: Encodable, Sendable { let host, target: String }
    adding = true; defer { adding = false }
    do {
      let result: One = try await session.send(base, method: "POST", body: Input(host: host.trimmingCharacters(in: .whitespaces), target: target))
      domains.append(result.domain); host = ""; error = ""
    } catch let failure { error = failure.localizedDescription }
  }

  private func replace(_ domain: ProjectDomain, with result: ProjectDomain) {
    if let index = domains.firstIndex(where: { $0.id == domain.id }) { domains[index] = result }
  }

  private func verify(_ domain: ProjectDomain) async {
    busy = domain.id; defer { busy = "" }
    do { let result: One = try await session.send(base + "/\(domain.id)/verify"); replace(domain, with: result.domain); error = "" } catch let failure { error = failure.localizedDescription }
  }

  private func setTarget(_ domain: ProjectDomain, _ value: String) async {
    struct Input: Encodable, Sendable { let target: String }
    do { let result: One = try await session.send(base + "/\(domain.id)", method: "PATCH", body: Input(target: value)); replace(domain, with: result.domain); error = "" } catch let failure { error = failure.localizedDescription }
  }

  private func remove(_ domain: ProjectDomain) async {
    do { try await session.delete(base + "/\(domain.id)"); domains.removeAll { $0.id == domain.id }; error = "" } catch let failure { error = failure.localizedDescription }
  }
}
