import SwiftUI

/// The hosted edition's custom sending domains (web: Settings → Sending domains, `/v1/admin/mail-domains`):
/// add a domain, copy the DNS records the mail provider asks for, verify, remove. Community servers
/// have no such route, so a failed load hides the section.
struct SendingDomainsSection: View {
  @Environment(SessionStore.self) private var session
  @State private var domains: [SendingDomain] = []
  @State private var allowed = false
  @State private var available = false
  @State private var newDomain = ""
  @State private var busy = ""
  @State private var error = ""
  @State private var opened: Set<String> = []
  @State private var removing: SendingDomain?

  var body: some View {
    Group {
      if available {
        VStack(alignment: .leading, spacing: 12) {
          SectionLabel("Sending domains")
          Text("Until a domain is verified, mail goes out from a shared HelpBites address, with replies to your own. Once a domain is verified, projects whose sender address is on it send as themselves.")
            .font(.lnCaption).foregroundStyle(Theme.textMuted)
          if !allowed {
            Label(domains.isEmpty ? String(localized: "Sending domains are part of Pro. Upgrade to send from your own domain.") : String(localized: "Sending domains are part of Pro. Your domains are kept, but projects send from the shared address until you upgrade."), systemImage: "lock")
              .font(.lnMeta).foregroundStyle(Theme.textMuted)
          } else {
            HStack(spacing: 8) {
              TextField("mail.example.com", text: $newDomain).textFieldStyle(.linear).font(.lnMono)
                .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                .onSubmit { Task { await add() } }
              Button { Task { await add() } } label: { Label("Add domain", systemImage: "plus") }
                .buttonStyle(.lnPrimaryCompact).disabled(!busy.isEmpty || newDomain.trimmingCharacters(in: .whitespaces).isEmpty)
            }
          }
          ErrorText(message: error)
          if domains.isEmpty {
            Text("No sending domains yet. Add the domain your projects send from, then the DNS records we show you at your DNS host.")
              .font(.lnMeta).foregroundStyle(Theme.textMuted)
          }
          ForEach(domains) { item in domainCard(item) }
        }
      }
    }
    .confirmationDialog("Remove \(removing?.domain ?? "")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { item in
      Button("Remove domain", role: .destructive) { Task { await remove(item) } }
    } message: { _ in
      Text("Projects sending from it go back to the shared address.")
    }
    .task { await load() }
  }

  private func isOpen(_ item: SendingDomain) -> Bool { item.state != "verified" || opened.contains(item.id) }

  private func domainCard(_ item: SendingDomain) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        VStack(alignment: .leading, spacing: 2) {
          Text(item.domain).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Text(item.summary).font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
        Spacer(minLength: 8)
        Tag(text: item.stateLabel, tint: item.state == "verified" ? Theme.success : item.state == "failed" ? Theme.warning : Theme.textDimmed)
        if item.state != "verified" {
          Button { Task { await verify(item) } } label: { Text(busy == "verify:\(item.id)" ? String(localized: "Verifying…") : String(localized: "Verify")) }.buttonStyle(.lnGhost).disabled(!busy.isEmpty)
        } else {
          Button {
            if !opened.insert(item.id).inserted { opened.remove(item.id) }
          } label: { Image(systemName: isOpen(item) ? "chevron.up" : "chevron.down") }
            .buttonStyle(.lnGhost).accessibilityLabel(isOpen(item) ? String(localized: "Hide DNS records") : String(localized: "Show DNS records"))
        }
        Button { removing = item } label: { Image(systemName: "trash") }.buttonStyle(.lnGhost).disabled(!busy.isEmpty).accessibilityLabel("Remove")
      }
      if isOpen(item) {
        ForEach(["sending", "receiving"], id: \.self) { purpose in
          let records = item.dnsRecords.filter { $0.purpose == purpose }
          if !records.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
              Text(purpose == "sending" ? String(localized: "Required") : String(localized: "Optional: receiving")).font(.lnMetaMedium).foregroundStyle(Theme.textToned)
              if purpose == "receiving" {
                Text("These send mail addressed to the domain to the mail provider. Only add them to a domain that has no mailboxes: on one that does, they would take its mail away.")
                  .font(.lnCaption).foregroundStyle(Theme.textMuted)
              }
              ForEach(Array(records.enumerated()), id: \.offset) { _, record in recordRow(record) }
            }
          }
        }
        if item.dnsRecords.isEmpty {
          Text("The mail provider sent no records for this domain. Remove it and add it again.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
      }
    }
    .padding(14)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  private func recordRow(_ record: SendingDomain.Record) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Tag(text: record.type, tint: Theme.textDimmed)
        if !record.priority.isEmpty { Text("Priority \(record.priority)").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        Spacer(minLength: 0)
        Text(record.valid == "valid" ? String(localized: "Found") : record.valid == "invalid" ? String(localized: "Not found") : String(localized: "Not checked"))
          .font(.lnCaption).foregroundStyle(record.valid == "valid" ? Theme.accentText : record.valid == "invalid" ? Theme.warning : Theme.textMuted)
      }
      copyLine(String(localized: "Host"), record.host)
      copyLine(String(localized: "Value"), record.value)
    }
    .padding(10)
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
  }

  private func copyLine(_ label: String, _ value: String) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Text(label).font(.lnCaption).foregroundStyle(Theme.textMuted).frame(width: 40, alignment: .leading)
      Text(value).font(.lnMono).foregroundStyle(Theme.textHighlighted).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
      Button { Clipboard.copy(value) } label: { Image(systemName: "doc.on.doc") }.buttonStyle(.lnGhost).accessibilityLabel("Copy \(label.lowercased())")
    }
  }

  private struct List: Decodable, Sendable { let domains: [SendingDomain]; let allowed: Bool }
  private struct One: Decodable, Sendable { let domain: SendingDomain }

  private func load() async {
    guard session.canManage, let list: List = try? await session.get("/v1/admin/mail-domains") else { return }
    domains = list.domains
    allowed = list.allowed
    available = true
  }

  private func add() async {
    struct Input: Encodable, Sendable { let domain: String }
    busy = "add"
    error = ""
    defer { busy = "" }
    do {
      let one: One = try await session.send("/v1/admin/mail-domains", body: Input(domain: newDomain.trimmingCharacters(in: .whitespaces)))
      domains.append(one.domain)
      newDomain = ""
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func verify(_ item: SendingDomain) async {
    busy = "verify:\(item.id)"
    error = ""
    defer { busy = "" }
    do {
      let one: One = try await session.send("/v1/admin/mail-domains/\(item.id)/verify")
      if let index = domains.firstIndex(where: { $0.id == item.id }) { domains[index] = one.domain }
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func remove(_ item: SendingDomain) async {
    error = ""
    do {
      try await session.delete("/v1/admin/mail-domains/\(item.id)")
      domains.removeAll { $0.id == item.id }
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// One domain of `GET /v1/admin/mail-domains` (ee/server/utils/cloudDomains.ts `CloudSendingDomain`).
struct SendingDomain: Decodable, Identifiable, Equatable, Sendable {
  struct Record: Decodable, Equatable, Sendable {
    let purpose, type, host, value, valid: String
    let priority: String
  }
  let id, domain, state: String
  let dnsRecords: [Record]
  let verifiedAt: String?

  var stateLabel: String { state == "verified" ? String(localized: "Verified") : state == "failed" ? String(localized: "Not verified") : String(localized: "Pending") }
  @MainActor var summary: String {
    if state == "verified" { return verifiedAt.map { String(localized: "Verified on \(DateText.day($0))") } ?? String(localized: "Verified") }
    if state == "failed" { return String(localized: "Some records were not found yet; DNS changes can take a few hours to show up") }
    return String(localized: "Add these records at your DNS host, then verify.")
  }
}
