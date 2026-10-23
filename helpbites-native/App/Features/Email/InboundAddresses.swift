import SwiftUI

struct InboundMxRecord: Decodable, Equatable, Sendable { let type, host, value: String; let priority: Int }

struct InboundAddress: Decodable, Identifiable, Equatable, Sendable {
  let id, kind, address, publicAddress, fromName, state: String
  let mxRecords: [InboundMxRecord]
  var shown: String { kind == "forward" && !publicAddress.isEmpty ? publicAddress : address }
  var stateText: String {
    switch state { case "verified": return String(localized: "Receiving"); case "failed": return String(localized: "MX not found yet"); default: return String(localized: "Waiting for MX") }
  }
}

/// Email → Settings → Support email addresses (web: components/email/InboundAddresses.vue). Mail sent to
/// these becomes a conversation; a forwarding alias is a HelpBites address your own mailbox forwards to.
struct InboundAddressesSection: View {
  let projectId: String
  let projectName: String
  @Environment(SessionStore.self) private var session

  @State private var addresses: [InboundAddress] = []
  @State private var forwardingDomain = ""
  @State private var loaded = false
  @State private var adding: String?
  @State private var busy = ""
  @State private var error = ""
  @State private var confirmRemove: InboundAddress?

  var body: some View {
    Section {
      if loaded && addresses.isEmpty { Text("No addresses yet.").foregroundStyle(Theme.textMuted) }
      ForEach(addresses) { item in row(item) }
      Menu {
        Button { adding = "forward" } label: { Label("Forward my mailbox", systemImage: "arrowshape.turn.up.right") }.disabled(forwardingDomain.isEmpty)
        Button { adding = "domain" } label: { Label("Use my domain", systemImage: "at") }
      } label: { Label("Add an address", systemImage: "plus") }
      if !error.isEmpty { Text(error).font(.lnCaption).foregroundStyle(Theme.error) }
    } header: { Text("Support email addresses") } footer: {
      Text("Mail sent to these addresses becomes a conversation in your inbox, and your replies go back by email. Use an address on your own domain, or forward your existing mailbox to a HelpBites address.")
    }
    .sheet(item: Binding(get: { adding.map { AddKind(id: $0) } }, set: { adding = $0?.id })) { kind in
      InboundAddressSheet(projectId: projectId, projectName: projectName, kind: kind.id) { saved in addresses.append(saved) }
    }
    .confirmationDialog("Stop receiving mail here?", isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } }), titleVisibility: .visible) {
      Button("Remove", role: .destructive) { if let target = confirmRemove { Task { await remove(target) } } }
    } message: { Text(confirmRemove?.shown ?? "") }
    .task { await load() }
  }

  private struct AddKind: Identifiable { let id: String }

  private func row(_ item: InboundAddress) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        StatusDot(status: item.state == "verified" ? "active" : item.state == "failed" ? "failed" : "pending", label: item.stateText)
        Text(item.shown).font(.lnMono).lineLimit(1).truncationMode(.middle)
        Spacer(minLength: 0)
        Text(item.kind == "forward" ? "Forwarding" : "Your domain").font(.lnCaption).foregroundStyle(Theme.textMuted)
        if item.kind == "domain" {
          IconButton(systemImage: "arrow.triangle.2.circlepath", label: "Check DNS", bordered: false) { Task { await verify(item) } }
        }
        IconButton(systemImage: "trash", label: "Remove", bordered: false) { confirmRemove = item }
      }
      if busy == item.id { ProgressView().controlSize(.small) }
      if item.kind == "forward" {
        HStack(alignment: .top, spacing: 8) {
          Text(item.publicAddress.isEmpty ? "Forward your mailbox to" : "Forward mail for \(item.publicAddress) to").font(.lnCaption).foregroundStyle(Theme.textMuted)
          Text(item.address).font(.lnMono).textSelection(.enabled)
          Spacer(minLength: 0)
          IconButton(systemImage: "doc.on.doc", label: "Copy", bordered: false) { Clipboard.copy(item.address) }
        }
      } else if item.state != "verified" {
        VStack(alignment: .leading, spacing: 6) {
          Text("Add these MX records at your DNS provider").font(.lnMetaMedium)
          Text("They send all mail for this domain to the mail provider. Use a subdomain (mail.example.com) so your regular mailbox is not affected.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          ForEach(item.mxRecords, id: \.value) { record in
            HStack(spacing: 8) {
              Text(record.type).font(.lnMono).frame(width: 34, alignment: .leading)
              VStack(alignment: .leading, spacing: 2) {
                Text(record.host).font(.lnMono).foregroundStyle(Theme.textMuted)
                Text("\(record.value)  ·  priority \(record.priority)").font(.lnMono)
              }
              Spacer(minLength: 0)
              IconButton(systemImage: "doc.on.doc", label: "Copy", bordered: false) { Clipboard.copy(record.value) }
            }
          }
        }
      }
    }
    .padding(.vertical, 4)
  }

  private var base: String { "/v1/admin/projects/\(projectId)/inbound-addresses" }
  private struct Addresses: Decodable, Sendable { let addresses: [InboundAddress]; let forwardingDomain: String }
  private struct One: Decodable, Sendable { let address: InboundAddress }

  private func load() async {
    do { let result: Addresses = try await session.get(base); addresses = result.addresses; forwardingDomain = result.forwardingDomain; error = "" } catch let failure { error = failure.localizedDescription }
    loaded = true
  }

  private func verify(_ item: InboundAddress) async {
    busy = item.id; defer { busy = "" }
    do {
      let result: One = try await session.send(base + "/\(item.id)/verify")
      if let index = addresses.firstIndex(where: { $0.id == item.id }) { addresses[index] = result.address }
      error = ""
    } catch let failure { error = failure.localizedDescription }
  }

  private func remove(_ item: InboundAddress) async {
    do { try await session.delete(base + "/\(item.id)"); addresses.removeAll { $0.id == item.id }; error = "" } catch let failure { error = failure.localizedDescription }
  }
}

/// Add an address: a forwarding alias (optionally for the address customers know) or an address on your domain.
private struct InboundAddressSheet: View {
  let projectId: String
  let projectName: String
  let kind: String
  let onSaved: (InboundAddress) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss

  @State private var address = ""
  @State private var publicAddress = ""
  @State private var fromName = ""
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      Form {
        Section {
          if kind == "forward" {
            TextField("support@example.com", text: $publicAddress, prompt: Text("The address your customers write to")).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
          } else {
            TextField("support@mail.example.com", text: $address, prompt: Text("Address")).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          TextField("Name on replies", text: $fromName, prompt: Text(projectName))
        } footer: {
          Text(kind == "forward" ? "You get a HelpBites address to forward your mailbox to." : "An address on a domain whose MX records point at the mail provider. Add the MX records, then check DNS.")
        }
        if !error.isEmpty { Section { Text(error).foregroundStyle(Theme.error) } }
      }
      .navigationTitle(kind == "forward" ? "Forward my mailbox" : "Use my domain")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button { Task { await save() } } label: { if saving { ProgressView() } else { Text("Create") } }.disabled(saving || (kind == "domain" && address.trimmingCharacters(in: .whitespaces).isEmpty))
        }
      }
      .presentationDetents([.medium])
    }
  }

  private func save() async {
    struct Input: Encodable, Sendable { let kind, address, publicAddress, fromName: String }
    struct Output: Decodable, Sendable { let address: InboundAddress }
    saving = true; error = ""; defer { saving = false }
    do {
      let result: Output = try await session.send("/v1/admin/projects/\(projectId)/inbound-addresses", method: "POST", body: Input(kind: kind, address: address.trimmingCharacters(in: .whitespaces), publicAddress: publicAddress.trimmingCharacters(in: .whitespaces), fromName: fromName))
      onSaved(result.address)
      dismiss()
    } catch let failure { error = failure.localizedDescription }
  }
}
