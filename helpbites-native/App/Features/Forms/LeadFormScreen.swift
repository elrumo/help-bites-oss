import SwiftUI

/// One lead form (web: projects/[id]/forms/[formId].vue): its fields, words and
/// look with a live preview beside it (in a sheet on iPhone), what happens after
/// someone signs up, how to put it on a site or in an app, and the latest leads.
/// Edits save together and take effect at once.
struct LeadFormScreen: View {
  let projectId: String
  let formId: String
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var form: LeadForm?
  @State private var draft: LeadFormDraft?
  @State private var templates: [MarketingTemplate] = []
  @State private var sequences: [EmailSequence] = []
  @State private var leads: [Contact] = []
  @State private var loading = true
  @State private var error = ""
  /// save or delete while that request runs.
  @State private var busy = ""
  @State private var previewing = false
  @State private var deleting = false
  @State private var install = "script"

  private var wide: Bool { sizeClass != .compact }
  private var dirty: Bool { form.map { draft != LeadFormDraft($0) } ?? false }
  private var projectAccent: String? { workspace.project(projectId)?.theme.accent }

  var body: some View {
    Group {
      if let form, let draft = Binding($draft) {
        editor(form, draft)
      } else if loading {
        SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
      } else {
        VStack(spacing: 12) {
          ErrorText(message: error.isEmpty ? String(localized: "Form not found") : error)
          Button("Try again") { Task { await load() } }.buttonStyle(.lnSecondaryCompact)
        }
        .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      }
    }
    .projectScreen(projectId, form?.name ?? "Form")
    .toolbar { if let form { toolbar(form) } }
    .confirmationDialog("Delete this form?", isPresented: $deleting, titleVisibility: .visible) {
      Button("Delete form", role: .destructive) { Task { await delete() } }
    } message: { Text("Sites and apps that load it show nothing. Its leads and its segment stay.") }
    .sheet(isPresented: $previewing) {
      NavigationStack {
        ScrollView { if let draft { LeadFormPreview(draft: draft, projectAccent: projectAccent).padding(20) } }
          .panelScreen("Preview")
          .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { previewing = false } } }
      }
      .presentationDetents([.medium, .large])
    }
    .task { if form == nil { await load() } }
  }

  // MARK: Toolbar

  @ToolbarContentBuilder private func toolbar(_ form: LeadForm) -> some ToolbarContent {
    ToolbarItem(placement: .primaryAction) {
      Menu {
        Button { Clipboard.copy(snippet("script")) } label: { Label("Copy script tag", systemImage: "chevron.left.forwardslash.chevron.right") }
        Button { Clipboard.copy(base + form.pagePath) } label: { Label("Copy hosted page link", systemImage: "link") }
        Divider()
        Button(role: .destructive) { deleting = true } label: { Label("Delete form", systemImage: "trash") }.disabled(busy != "")
      } label: { Label("More", systemImage: "ellipsis.circle") }
    }
    if !wide {
      ToolbarItem(placement: .primaryAction) {
        Button { previewing = true } label: { Label("Preview", systemImage: "eye") }
      }
    }
    ToolbarItem(placement: .primaryAction) {
      Button { Task { await save() } } label: { Text(busy == "save" ? "Saving…" : "Save") }
        .keyboardShortcut("s", modifiers: .command).disabled(!dirty || busy != "")
    }
  }

  // MARK: Layout

  @ViewBuilder private func editor(_ form: LeadForm, _ draft: Binding<LeadFormDraft>) -> some View {
    let fields = ScrollView {
      content(form, draft).frame(maxWidth: 680, alignment: .leading).padding(20).frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    if wide {
      HStack(spacing: 0) {
        fields
        Rectangle().fill(Theme.border).frame(width: Hairline.width)
        ScrollView { LeadFormPreview(draft: draft.wrappedValue, projectAccent: projectAccent).padding(20) }.frame(width: 360).background(Theme.canvas)
      }
    } else {
      fields
    }
  }

  private func content(_ form: LeadForm, _ draft: Binding<LeadFormDraft>) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 8) {
        Tag(text: form.active ? "Live" : "Closed", tint: form.active ? Theme.success : Theme.textDimmed)
        Text("\(form.stats.leads) \(form.stats.leads == 1 ? String(localized: "lead") : String(localized: "leads")) · \(form.stats.confirmed) on the list").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
        if dirty { Text("Unsaved changes").font(.lnCaption).foregroundStyle(Theme.warning) }
      }
      ErrorText(message: error)

      LegalPanel("Details") {
        OnboardingTextField(label: "Name", text: draft.name, limit: LeadFormLimits.name)
        LabeledField(label: "Key", hint: LeadFormLimits.validKey(draft.wrappedValue.key) ? "Your site and app ask for the form by its key. Changing it moves its URL." : LeadFormLimits.keyRule) {
          TextField("waitlist", text: draft.key).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        toggle("Taking sign-ups", "Off closes the form: sites and apps that load it show nothing.", isOn: draft.active)
      }

      LeadFormLanguagesPanel(draft: draft, canTranslate: !dirty && busy == "") { locales, overwrite in try await translate(locales, overwrite) }

      HStack {
        SectionLabel("Fields")
        Text("\(draft.wrappedValue.fields.count) of \(LeadFormLimits.fields)").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
      }
      ForEach(draft.fields) { $field in
        let index = draft.wrappedValue.fields.firstIndex { $0.id == field.id } ?? 0
        LeadFieldCard(
          field: $field, index: index, count: draft.wrappedValue.fields.count,
          move: { draft.wrappedValue.fields.move(index, by: $0) },
          remove: field.type == "email" ? nil : { draft.wrappedValue.fields.removeAll { $0.id == field.id } }
        )
      }
      Menu {
        ForEach(LeadFormLimits.fieldTypes.filter { $0.id != "email" && ($0.id != "name" || !draft.wrappedValue.fields.contains { $0.type == "name" }) }, id: \.id) { type in
          Button { draft.wrappedValue.fields.append(.new(type.id, taken: draft.wrappedValue.fields.map(\.key))) } label: { Label(LocalizedStringKey(type.label), systemImage: type.systemImage) }
            .disabled(type.id == "file" && draft.wrappedValue.fields.filter { $0.type == "file" }.count >= LeadFormLimits.files)
        }
      } label: { Label("Add field", systemImage: "plus") }
        .menuStyle(.button).buttonStyle(.lnSecondaryCompact).fixedSize()
        .disabled(draft.wrappedValue.fields.count >= LeadFormLimits.fields)

      LegalPanel("Words") {
        OnboardingTextField(label: "Title", text: draft.content.title, limit: LeadFormLimits.title)
        OnboardingTextField(label: "Description", text: draft.content.description, limit: LeadFormLimits.description, multiline: true)
        OnboardingTextField(label: "Button", text: draft.content.buttonLabel, limit: LeadFormLimits.button)
        OnboardingTextField(label: "After signing up", text: draft.content.successTitle, limit: LeadFormLimits.title)
        OnboardingTextField(label: "Thank-you message", text: draft.content.successMessage, limit: LeadFormLimits.message)
        if draft.wrappedValue.settings.doubleOptIn {
          OnboardingTextField(label: "While they confirm", text: draft.content.confirmMessage, limit: LeadFormLimits.message)
        }
        OnboardingTextField(label: "Small print", text: draft.content.footnote, limit: LeadFormLimits.message, placeholder: String(localized: "Optional: a privacy line"))
      }

      LegalPanel("Look") {
        OptionalColorField(label: "Accent", hex: draft.style.accent, fallback: Color(hexString: projectAccent) ?? Theme.accent, empty: "Project accent")
        OptionalColorField(label: "Background", hex: draft.style.background, fallback: .white, empty: "None: sits on your page")
        OptionalColorField(label: "Text", hex: draft.style.text, fallback: .black, empty: "Follows light or dark")
        LabeledField(label: "Layout") {
          Picker("Layout", selection: draft.style.layout) {
            ForEach(LeadFormLimits.layouts, id: \.id) { Text($0.label).tag($0.id) }
          }
          .pickerStyle(.segmented).labelsHidden()
        }
        LabeledField(label: "Corner radius") {
          HStack(spacing: 12) {
            Slider(value: Binding(get: { Double(draft.wrappedValue.style.radius) }, set: { draft.wrappedValue.style.radius = Int($0.rounded()) }), in: 0...Double(LeadFormLimits.radius), step: 1)
              .tint(Theme.accent)
            Text("\(draft.wrappedValue.style.radius) pt").font(.lnMeta).foregroundStyle(Theme.textMuted).monospacedDigit().frame(width: 44, alignment: .trailing)
          }
        }
        LabeledField(label: "Font") {
          Picker("Font", selection: draft.style.font) {
            ForEach(LeadFormLimits.fonts, id: \.id) { Text($0.label).tag($0.id) }
          }
          .pickerStyle(.segmented).labelsHidden()
        }
      }

      LegalPanel("After someone signs up") {
        Text("They become a contact, get the tags below and join this form's segment.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        toggle("Ask them to confirm their email", "They get an email with a link and are pending until they click it. The welcome email and the sequence wait for that.", isOn: draft.settings.doubleOptIn)
        if draft.wrappedValue.settings.doubleOptIn {
          picker("Confirmation email", "A template with a {{confirmUrl}} button.", none: "HelpBites' own", selection: draft.settings.confirmTemplate, items: templates.map { (id: $0.ref, title: $0.title) })
        }
        picker("Welcome email", "Sent once, when they are on the list.", none: "None", selection: draft.settings.welcomeTemplate, items: templates.map { (id: $0.ref, title: $0.title) })
        picker("Start a sequence", "A draft or paused sequence holds them at the first step until you activate it.", none: "None", selection: draft.settings.sequence, items: sequences.map { (id: $0.id, title: $0.status == "active" ? $0.name : "\($0.name) (\($0.status))") })
        LabeledField(label: "Tags", hint: "Comma-separated. Added to everyone who signs up.") {
          TextField("waitlist", text: Binding(
            get: { draft.wrappedValue.settings.tags.joined(separator: ", ") },
            set: { draft.wrappedValue.settings.tags = Array($0.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.prefix(LeadFormLimits.tags)) }
          ))
          .textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        LabeledField(label: "Then send them to", hint: "For a plain HTML form, the hosted page and the confirmation link. Empty shows a thank-you page.") {
          TextField("https://", text: draft.settings.redirectUrl).textFieldStyle(.linear).font(.lnMono).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
      }

      LegalPanel("Put it on your site or in your app") {
        Picker("Install", selection: $install) {
          Text("Script").tag("script"); Text("HTML").tag("html"); Text("Link").tag("link"); Text("Swift").tag("swift"); Text("API").tag("api")
        }
        .pickerStyle(.segmented).labelsHidden()
        Text(Self.installHints[install] ?? "").font(.lnCaption).foregroundStyle(Theme.textMuted)
        if dirty { Text("Save your changes first: the snippet uses the saved form.").font(.lnCaption).foregroundStyle(Theme.warning) }
        CodeBlock(code: snippet(install))
      }

      LegalPanel("Latest leads") {
        if leads.isEmpty { Text("Nobody has signed up yet.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
        ForEach(leads) { contact in
          let status = SubscriptionStatus.of(contact.subscription)
          HStack(spacing: 8) {
            Text(contact.displayName).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
            Spacer(minLength: 8)
            Tag(text: status.label, tint: status.tint)
            Text(DateText.short(contact.createdAt)).font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
        }
        Text("They are contacts like everyone else: filter People by this form's segment to see them all.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      }

      if form.fields.contains(where: { $0.type == "file" }) {
        LegalPanel("Files sent") {
          LeadFileRows(projectId: projectId, formId: formId, fields: form.fields)
          Text("Kept privately: only your team can download them. Erasing a person deletes their files.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
      }
    }
  }

  private func toggle(_ title: LocalizedStringKey, _ hint: LocalizedStringKey, isOn: Binding<Bool>) -> some View {
    Toggle(isOn: isOn) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.lnRow).foregroundStyle(Theme.text)
        Text(hint).font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
    }
    .toggleStyle(.switch).tint(Theme.accent)
  }

  private func picker(_ label: LocalizedStringKey, _ hint: LocalizedStringKey, none: LocalizedStringKey, selection: Binding<String>, items: [(id: String, title: String)]) -> some View {
    LabeledField(label: label, hint: hint) {
      Picker(label, selection: selection) {
        Text(none).tag("")
        ForEach(items, id: \.id) { Text($0.title).tag($0.id) }
        // A choice the lists no longer have (deleted, or not loaded yet) still shows.
        if !selection.wrappedValue.isEmpty, !items.contains(where: { $0.id == selection.wrappedValue }) { Text(selection.wrappedValue).tag(selection.wrappedValue) }
      }
      .labelsHidden().fixedSize()
    }
  }

  // MARK: Install

  private static let installHints = [
    "script": String(localized: "One script tag draws the form where you put it, in your colours. It needs nothing else."),
    "html": String(localized: "A plain form, styled by your own CSS. It posts straight to HelpBites and comes back to the thank-you page."),
    "link": String(localized: "A hosted page to link to, or to frame in your site."),
    "swift": String(localized: "Paste HelpBitesLeadForm.swift from the guide (/docs/forms) into your app, then show the view anywhere."),
    "api": String(localized: "Post answers from your own UI or server. Each field's answer goes under its key.")
  ]

  private var base: String { session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
  /// A file input's `accept` for each kind (`LEAD_FILE_EXTENSIONS`).
  private static let accept = [
    "images": ".png,.jpg,.jpeg,.gif,.webp",
    "documents": ".pdf,.docx,.xlsx,.pptx,.odt,.ods,.doc,.xls,.rtf,.txt,.csv,.md",
    "any": ".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.pptx,.odt,.ods,.doc,.xls,.rtf,.txt,.csv,.md,.zip"
  ]

  private func snippet(_ kind: String) -> String {
    let pk = workspace.project(projectId)?.publicKey ?? "pk_…"
    let key = form?.key ?? "waitlist"
    let saved = form.map { LeadFormDraft($0) }
    let post = "\(base)/v1/forms/\(pk)/\(key)"
    switch kind {
    case "html":
      let inputs = (saved?.fields ?? []).map { f -> String in
        let required = f.required ? " required" : ""
        let hint = f.placeholder.isEmpty ? f.label : f.placeholder
        switch f.type {
        case "file": return "  <input type=\"file\" name=\"\(f.key)\" accept=\"\(Self.accept[f.accept] ?? Self.accept["any"]!)\"\(required)>"
        case "checkbox": return "  <label><input type=\"checkbox\" name=\"\(f.key)\"\(required)> \(f.label)</label>"
        case "textarea": return "  <textarea name=\"\(f.key)\" placeholder=\"\(hint)\"\(required)></textarea>"
        case "select": return "  <select name=\"\(f.key)\"\(required)>\n    <option value=\"\">\(f.label)</option>\n" + f.options.map { "    <option>\($0)</option>" }.joined(separator: "\n") + "\n  </select>"
        default: return "  <input type=\"\(["email": "email", "number": "number", "url": "url", "phone": "tel"][f.type] ?? "text")\" name=\"\(f.key)\" placeholder=\"\(hint)\"\(required)>"
        }
      }
      let multipart = (saved?.fields ?? []).contains { $0.type == "file" } ? " enctype=\"multipart/form-data\"" : ""
      return "<form action=\"\(post)\" method=\"post\"\(multipart)>\n\(inputs.joined(separator: "\n"))\n  <input type=\"text\" name=\"website\" tabindex=\"-1\" autocomplete=\"off\" aria-hidden=\"true\" style=\"position:absolute;left:-10000px\">\n  <button type=\"submit\">\(saved?.content.buttonLabel ?? "Notify me")</button>\n</form>"
    case "link":
      return "\(base)/f/\(pk)/\(key)\n\n<iframe src=\"\(base)/f/\(pk)/\(key)\" style=\"width:100%;max-width:480px;height:520px;border:0\"></iframe>"
    case "swift":
      return "// Add HelpBitesLeadForm.swift from the guide, then:\nHelpBitesLeadForm(host: URL(string: \"\(base)\")!, projectKey: \"\(pk)\", form: \"\(key)\")"
    case "api":
      let fields = saved?.fields ?? []
      // A file goes as multipart: one -F per answer, the file with @.
      if fields.contains(where: { $0.type == "file" }) {
        let parts = fields.map { f -> String in
          switch f.type {
          case "file": "-F '\(f.key)=@\(f.accept == "images" ? "photo.png" : "file.pdf")'"
          case "email": "-F 'email=ada@example.com'"
          case "name": "-F 'name=Ada Lovelace'"
          case "checkbox": "-F '\(f.key)=true'"
          case "select": "-F '\(f.key)=\(f.options.first ?? "")'"
          default: "-F '\(f.key)=…'"
          }
        }
        return "curl -s \(post) \\\n  " + parts.joined(separator: " \\\n  ")
      }
      let sample = fields.filter { $0.type != "file" }.map { f -> String in
        let value: String = switch f.type {
        case "email": "\"ada@example.com\""
        case "name": "\"Ada Lovelace\""
        case "checkbox": "true"
        case "number": "3"
        case "select": "\"\(f.options.first ?? "")\""
        default: "\"…\""
        }
        return "\"\(f.key)\":\(value)"
      }
      return "curl -s \(post) \\\n  -H 'content-type: application/json' \\\n  -d '{\(sample.joined(separator: ","))}'"
    default:
      return "<script src=\"\(base)/forms.js\" data-project=\"\(pk)\" data-form=\"\(key)\" defer></script>"
    }
  }

  // MARK: Actions

  private func apply(_ form: LeadForm) {
    self.form = form
    draft = LeadFormDraft(form)
  }

  private func load() async {
    loading = true
    do {
      let response: LeadFormResponse = try await session.get("/v1/admin/lead-forms/\(formId)")
      apply(response.form)
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
    templates = await MarketingTemplate.load(projectId, session: session)
    struct Sequences: Decodable, Sendable { let sequences: [EmailSequence] }
    if let list: Sequences = try? await session.get("/v1/sequences", query: ["project": projectId]) { sequences = list.sequences }
    if let page: ContactPage = try? await session.get("/v1/contacts", query: ["project": projectId, "leadForm": formId, "limit": "10"]) { leads = page.contacts }
  }

  private func save() async {
    guard var body = draft else { return }
    body.name = body.name.trimmingCharacters(in: .whitespacesAndNewlines)
    body.key = body.key.trimmingCharacters(in: .whitespaces).lowercased()
    if body.name.isEmpty { error = String(localized: "Give the form a name."); return }
    if !LeadFormLimits.validKey(body.key) { error = LeadFormLimits.keyRule; return }
    if let bad = body.fields.first(where: { !["email", "name"].contains($0.type) && !LeadFormLimits.validFieldKey($0.key) }) {
      error = String(localized: "“\(bad.label)” is saved as “\(bad.key)”: use letters, digits and _, starting with a letter, and not a reserved name.")
      return
    }
    busy = "save"
    error = ""
    defer { busy = "" }
    do {
      let response: LeadFormResponse = try await session.send("/v1/admin/lead-forms/\(formId)", method: "PATCH", body: body)
      apply(response.form)
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// The server translates the saved form; the panel only offers it when nothing waits to be saved.
  private func translate(_ locales: [String], _ overwrite: Bool) async throws {
    struct Body: Encodable, Sendable { let locales: [String]; let overwrite: Bool }
    let response: LeadFormResponse = try await session.send("/v1/admin/lead-forms/\(formId)/translate", body: Body(locales: locales, overwrite: overwrite))
    apply(response.form)
  }

  private func delete() async {
    busy = "delete"
    defer { busy = "" }
    do {
      try await session.delete("/v1/admin/lead-forms/\(formId)")
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// One field: what it asks, where the answer is saved, and whether it must be filled in.
private struct LeadFieldCard: View {
  @Binding var field: LeadFormField
  let index: Int
  let count: Int
  let move: (Int) -> Void
  let remove: (() -> Void)?

  var body: some View {
    LegalPanel(title: LeadFormLimits.typeLabel(field.type), trailing: {
      ReorderControls(index: index, count: count, move: move, remove: remove)
    }, content: {
      OnboardingTextField(label: "Label", text: $field.label, limit: LeadFormLimits.label)
      if field.hasPlaceholder {
        OnboardingTextField(label: "Placeholder", text: $field.placeholder, limit: LeadFormLimits.placeholder)
      }
      if field.type != "email" && field.type != "name" {
        LabeledField(label: "Saved as", hint: !LeadFormLimits.validFieldKey(field.key) ? "Letters, digits and _, starting with a letter; not a reserved name." : field.type == "file" ? "The name the file is sent under. Files are kept privately for your team, not as an attribute." : "The contact attribute the answer goes in.") {
          TextField("company", text: $field.key).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
      }
      if field.type == "select" {
        LabeledField(label: "Options", hint: "Comma-separated, up to \(LeadFormLimits.options).") {
          TextField("Founder, Developer, Other", text: Binding(
            get: { field.options.joined(separator: ", ") },
            set: { field.options = Array($0.split(separator: ",").map { String($0.trimmingCharacters(in: .whitespaces).prefix(LeadFormLimits.option)) }.filter { !$0.isEmpty }.prefix(LeadFormLimits.options)) }
          ))
          .textFieldStyle(.linear)
        }
      }
      if field.type == "file" {
        LabeledField(label: "Takes", hint: LeadFormLimits.fileKinds.first { $0.id == field.accept }?.hint) {
          Picker("Takes", selection: $field.accept) {
            ForEach(LeadFormLimits.fileKinds, id: \.id) { Text($0.label).tag($0.id) }
          }
          .pickerStyle(.segmented).labelsHidden()
        }
        Stepper(value: $field.maxMB, in: 1...LeadFormLimits.fileMB) {
          Text("Largest file: \(field.maxMB) MB").font(.lnRow).foregroundStyle(Theme.text).monospacedDigit()
        }
      }
      if field.type != "email" {
        Toggle(field.type == "checkbox" ? "Must be ticked" : "Required", isOn: $field.required).toggleStyle(.switch).tint(Theme.accent).font(.lnRow)
      }
    })
  }
}

/// The form as forms.js and the Swift snippet draw it, in the working copy's words and look.
struct LeadFormPreview: View {
  let draft: LeadFormDraft
  let projectAccent: String?
  @State private var done = false
  /// '' shows the original; a tag shows that translation, word by word like visitors see it.
  @State private var language = ""

  var body: some View {
    let words = draft.translations[language].map { $0.localized(content: draft.content, fields: draft.fields) } ?? (content: draft.content, fields: draft.fields)
    let accent = draft.style.accent.isEmpty ? (projectAccent ?? "") : draft.style.accent
    let tint = Color(hexString: accent) ?? Theme.accent
    let radius = CGFloat(draft.style.radius)
    let design = Self.designs[draft.style.font] ?? .default
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        SectionLabel("Preview")
        if !draft.translations.isEmpty {
          Picker("Language", selection: $language) {
            Text(ContentLocale.name(draft.locale)).tag("")
            ForEach(draft.translations.keys.sorted(), id: \.self) { Text(ContentLocale.name($0)).tag($0) }
          }
          .labelsHidden().fixedSize()
        }
        Picker("State", selection: $done) { Text("Form").tag(false); Text("Done").tag(true) }.pickerStyle(.segmented).labelsHidden().fixedSize()
      }
      VStack(alignment: .leading, spacing: 12) {
        if done {
          Label(words.content.successTitle, systemImage: "checkmark.circle.fill").font(.headline).foregroundStyle(Theme.textHighlighted)
          Text(draft.settings.doubleOptIn ? words.content.confirmMessage : words.content.successMessage).foregroundStyle(Theme.textMuted)
        } else {
          if !words.content.title.isEmpty { Text(words.content.title).font(.title3.weight(.semibold)).foregroundStyle(Theme.textHighlighted) }
          if !words.content.description.isEmpty { Text(words.content.description).font(.callout).foregroundStyle(Theme.textMuted) }
          let button = Text(words.content.buttonLabel).fontWeight(.semibold).padding(.horizontal, 16).frame(minHeight: 42)
            .background(tint, in: RoundedRectangle(cornerRadius: radius * 0.75)).foregroundStyle(accent.count == 7 ? OnboardingPreview.readable(on: accent) : .white)
          if draft.style.layout == "inline" && words.fields.count == 1, let only = words.fields.first {
            HStack(spacing: 8) { input(only, radius); button }
          } else {
            ForEach(words.fields) { field in
              if field.type == "checkbox" {
                Label(field.label, systemImage: "square").font(.callout).foregroundStyle(Theme.text)
              } else {
                VStack(alignment: .leading, spacing: 4) {
                  if draft.style.layout != "inline" { Text(field.label + (field.required ? "" : String(localized: " (optional)"))).font(.caption.weight(.medium)).foregroundStyle(Theme.textToned) }
                  input(field, radius)
                }
              }
            }
            button.frame(maxWidth: .infinity)
          }
          if !words.content.footnote.isEmpty { Text(words.content.footnote).font(.caption).foregroundStyle(Theme.textMuted) }
        }
      }
      .fontDesign(design)
      .padding(draft.style.background.isEmpty ? 0 : 20)
      .background(Color(hexString: draft.style.background) ?? .clear, in: RoundedRectangle(cornerRadius: radius))
      Text("Your unsaved changes. forms.js and the Swift snippet draw the same form.").font(.lnCaption).foregroundStyle(Theme.textDimmed)
    }
  }

  private static let designs: [String: Font.Design] = ["rounded": .rounded, "serif": .serif, "mono": .monospaced]

  private func input(_ field: LeadFormField, _ radius: CGFloat) -> some View {
    Text(field.type == "select" ? (field.options.first ?? "—") : field.type == "file" ? String(localized: "Choose a file · up to \(field.maxMB) MB") : field.placeholder.isEmpty ? field.label : field.placeholder)
      .font(.callout).foregroundStyle(Theme.textDimmed).lineLimit(1)
      .frame(maxWidth: .infinity, minHeight: field.type == "textarea" ? 72 : 42, alignment: field.type == "textarea" ? .topLeading : .leading)
      .padding(.horizontal, 12).padding(.vertical, field.type == "textarea" ? 10 : 0)
      .background(Theme.field, in: RoundedRectangle(cornerRadius: radius * 0.75))
      .overlay(RoundedRectangle(cornerRadius: radius * 0.75).strokeBorder(Theme.border))
  }
}
