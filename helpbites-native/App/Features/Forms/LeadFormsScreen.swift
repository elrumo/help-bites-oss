import SwiftUI

/// A project's lead forms (web: projects/[id]/forms/index.vue): the list with how
/// many people each brought in, and the sheet that starts one from a preset and
/// opens it in the editor.
struct LeadFormsScreen: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var forms: [LeadForm] = []
  @State private var loading = true
  @State private var error = ""
  @State private var creating = false
  /// The form the sheet just made, pushed once the sheet is gone.
  @State private var created: String?
  @State private var path: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Lead forms").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text("Collect people before you launch: a waitlist, a \"notify me\" box or an interest form. Everyone who signs up becomes a contact, lands in the form's own segment and can get a welcome email and a sequence.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
        }
        ErrorText(message: error)
        if loading && forms.isEmpty {
          SkeletonRows(count: 3)
        } else if forms.isEmpty && error.isEmpty {
          EmptyState(systemImage: "list.bullet.clipboard", title: "No forms yet", message: "Make a form, add one line to your site, and watch the leads come in under Contacts.") {
            Button { creating = true } label: { Label("New form", systemImage: "plus") }.buttonStyle(.lnPrimaryCompact)
          }
          .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else if !forms.isEmpty {
          Card {
            ForEach(Array(forms.enumerated()), id: \.element.id) { index, form in
              CardRow(divider: index < forms.count - 1) { row(form) }
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
    .projectScreen(projectId, "Forms")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button { creating = true } label: { Label("New form", systemImage: "plus") }.disabled(forms.count >= LeadFormLimits.forms)
      }
    }
    .sheet(isPresented: $creating, onDismiss: {
      if let created { path = created; self.created = nil }
    }) {
      NewLeadFormSheet(projectId: projectId, first: forms.isEmpty) { form in
        forms.append(form)
        created = form.id
      }
    }
    .navigationDestination(item: $path) { id in LeadFormScreen(projectId: projectId, formId: id) }
    .task { await load() }
  }

  private func row(_ form: LeadForm) -> some View {
    NavigationLink(value: AppRoute.leadForm(projectId, form.id)) {
      HStack(spacing: 10) {
        VStack(alignment: .leading, spacing: 2) {
          Text(form.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Text(form.key).font(.lnMono).foregroundStyle(Theme.textMuted).lineLimit(1)
          HStack(spacing: 6) {
            Tag(text: form.active ? "Live" : "Closed", tint: form.active ? Theme.success : Theme.textDimmed)
            Text("\(form.stats.leads) \(form.stats.leads == 1 ? String(localized: "lead") : String(localized: "leads"))").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
            if form.settings.doubleOptIn { Text("\(form.stats.confirmed) on the list").font(.lnCaption).foregroundStyle(Theme.textDimmed).monospacedDigit() }
          }
          .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func load() async {
    do {
      let response: LeadFormsResponse = try await session.get("/v1/admin/lead-forms", query: ["project": projectId])
      forms = response.forms
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
  }
}

/// Pick a starting point, name the form (and optionally its key); it is live at once.
private struct NewLeadFormSheet: View {
  let projectId: String
  let first: Bool
  let onCreate: (LeadForm) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var preset = "email"
  @State private var name = ""
  @State private var key = ""
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Start from a single email box, a waitlist or a longer form. You can change every field later.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          VStack(spacing: 8) {
            ForEach(LeadFormLimits.presets, id: \.id) { option in
              Button { preset = option.id } label: {
                HStack(spacing: 10) {
                  Image(systemName: preset == option.id ? "largecircle.fill.circle" : "circle").foregroundStyle(preset == option.id ? Theme.accent : Theme.textDimmed)
                  VStack(alignment: .leading, spacing: 2) {
                    Text(option.label).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                    Text(option.hint).font(.lnCaption).foregroundStyle(Theme.textMuted)
                  }
                  Spacer(minLength: 0)
                }
                .padding(12)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radius))
                .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(preset == option.id ? Theme.borderAccented : Theme.border))
                .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              .accessibilityAddTraits(preset == option.id ? .isSelected : [])
            }
          }
          LabeledField(label: "Name") {
            TextField(first ? "Waitlist" : "Launch waitlist", text: $name).textFieldStyle(.linear)
              .onChange(of: name) { _, value in name = value.clipped(to: LeadFormLimits.name) }
          }
          LabeledField(label: "Key", hint: "Optional. Your site and app ask for the form by it; empty makes one from the name.") {
            TextField("waitlist", text: $key).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("New form")
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
    struct Input: Encodable, Sendable { let project, name, preset: String; let key: String? }
    let key = key.trimmingCharacters(in: .whitespaces).lowercased()
    if !key.isEmpty, !LeadFormLimits.validKey(key) { error = LeadFormLimits.keyRule; return }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
      let response: LeadFormResponse = try await session.send("/v1/admin/lead-forms", body: Input(project: projectId, name: name.isEmpty ? "Waitlist" : name, preset: preset, key: key.isEmpty ? nil : key))
      onCreate(response.form)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
