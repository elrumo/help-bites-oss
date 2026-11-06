import SwiftUI

/// A project's pricing tables (web: projects/[id]/pricing/index.vue): the list, and
/// the sheet that starts one from a template and opens it in the editor.
struct PricingScreen: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var tables: [PricingTable] = []
  @State private var stripeConnected = true
  @State private var loading = true
  @State private var error = ""
  @State private var creating = false
  /// The table the sheet just made, pushed once the sheet is gone.
  @State private var created: String?
  @State private var path: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Pricing tables").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text("Your plans on your site and in your app: cards, rows, a paywall or a comparison table. Prices can come from Stripe, so a change there shows everywhere; the words, features and buttons are yours.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
        }
        if !loading && !stripeConnected {
          HStack(spacing: 10) {
            Image(systemName: "dollarsign.circle").foregroundStyle(Theme.textMuted)
            Text("Connect Stripe under Revenue to take prices and checkout from it. Without it, write the prices here.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          }
          .padding(12).frame(maxWidth: .infinity, alignment: .leading)
          .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
        }
        ErrorText(message: error)
        if loading && tables.isEmpty {
          SkeletonRows(count: 3)
        } else if tables.isEmpty && error.isEmpty {
          EmptyState(systemImage: "tag", title: "No pricing tables yet", message: "Make one, link its plans to Stripe or write the prices, and add one line to your site or app.") {
            Button { creating = true } label: { Label("New pricing table", systemImage: "plus") }.buttonStyle(.lnPrimaryCompact)
          }
          .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else if !tables.isEmpty {
          Card {
            ForEach(Array(tables.enumerated()), id: \.element.id) { index, table in
              CardRow(divider: index < tables.count - 1) { row(table) }
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
    .projectScreen(projectId, "Pricing")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button { creating = true } label: { Label("New pricing table", systemImage: "plus") }.disabled(tables.count >= PricingLimits.tables)
      }
    }
    .sheet(isPresented: $creating, onDismiss: {
      if let created { path = created; self.created = nil }
    }) {
      NewPricingTableSheet(projectId: projectId, first: tables.isEmpty) { table in
        tables.append(table)
        created = table.id
      }
    }
    .navigationDestination(item: $path) { id in PricingTableScreen(projectId: projectId, tableId: id) }
    .task { await load() }
  }

  private func row(_ table: PricingTable) -> some View {
    NavigationLink(value: AppRoute.pricingTable(projectId, table.id)) {
      HStack(spacing: 10) {
        VStack(alignment: .leading, spacing: 2) {
          Text(table.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Text(table.key).font(.lnMono).foregroundStyle(Theme.textMuted).lineLimit(1)
          HStack(spacing: 6) {
            Tag(text: table.statusLabel, tint: table.isPublished ? Theme.success : Theme.textDimmed)
            if table.changed { Tag(text: "Unpublished changes", tint: Theme.warning) }
            if !table.warnings.isEmpty { Tag(text: "\(table.warnings.count) to check", tint: Theme.warning) }
            Text("\(PricingLimits.templateLabel(table.template)) · \(table.plans.count) \(table.plans.count == 1 ? String(localized: "plan") : String(localized: "plans"))").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
          .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        Image(systemName: "chevron.right").font(.app(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func load() async {
    struct Stripe: Decodable, Sendable { let connected: Bool }
    struct Response: Decodable, Sendable { let tables: [PricingTable]; let stripe: Stripe }
    do {
      let response: Response = try await session.get("/v1/admin/pricing-tables", query: ["project": projectId])
      tables = response.tables
      stripeConnected = response.stripe.connected
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
  }
}

/// Name a new table and pick its template; it starts with example plans that fit the template.
private struct NewPricingTableSheet: View {
  let projectId: String
  let first: Bool
  let onCreate: (PricingTable) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var key = ""
  @State private var template = "tiers"
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("It starts with example plans you can rewrite or link to Stripe. Nothing shows on your site or in your app until you publish.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          PricingTemplatePicker(template: $template)
          LabeledField(label: "Name") {
            TextField(first ? "Pricing" : "Team plans", text: $name).textFieldStyle(.linear)
              .onChange(of: name) { _, value in name = value.clipped(to: PricingLimits.name) }
          }
          LabeledField(label: "Key", hint: "Optional. Your site or app asks for the table by it; empty makes one from the name.") {
            TextField("pricing", text: $key).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("New pricing table")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Create") { Task { await create() } }.disabled(saving)
        }
      }
    }
    .presentationDetents([.large])
  }

  private func create() async {
    struct Input: Encodable, Sendable { let project, name, template: String; let key: String? }
    let key = key.trimmingCharacters(in: .whitespaces).lowercased()
    if !key.isEmpty, !PricingLimits.validKey(key) { error = PricingLimits.keyRule; return }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
      let response: PricingTableResponse = try await session.send("/v1/admin/pricing-tables", body: Input(project: projectId, name: name.isEmpty ? "Pricing" : name, template: template, key: key.isEmpty ? nil : key))
      onCreate(response.table)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// The five templates as choices, each with what it suits.
struct PricingTemplatePicker: View {
  @Binding var template: String

  var body: some View {
    LabeledField(label: "Template") {
      VStack(spacing: 8) {
        ForEach(PricingLimits.templates, id: \.id) { item in
          Button { template = item.id } label: {
            HStack(spacing: 12) {
              Image(systemName: item.systemImage).font(.app(size: 18)).frame(width: 28).foregroundStyle(template == item.id ? Theme.accentText : Theme.textMuted)
              VStack(alignment: .leading, spacing: 2) {
                Text(item.label).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                Text(item.hint).font(.lnCaption).foregroundStyle(Theme.textMuted).multilineTextAlignment(.leading)
              }
              Spacer(minLength: 8)
              if template == item.id { Image(systemName: "checkmark").font(.app(size: 13, weight: .semibold)).foregroundStyle(Theme.accentText) }
            }
            .padding(12)
            .background(template == item.id ? Theme.accent.opacity(0.08) : Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radius))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(template == item.id ? Theme.accent.opacity(0.6) : Theme.border))
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(template == item.id ? .isSelected : [])
        }
      }
    }
  }
}
