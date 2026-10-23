import SwiftUI

/// One pricing table (web: projects/[id]/pricing/[tableId].vue): its plans with their Stripe or
/// written prices, the feature list, the words, look, behaviour and checkout, its languages, how
/// to add it, and its numbers and A/B test, with a live preview beside it (in a sheet on iPhone).
/// Edits save together; publishing freezes them into the next version.
struct PricingTableScreen: View {
  let projectId: String
  let tableId: String
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var table: PricingTable?
  @State private var draft: PricingDraft?
  /// The project's Stripe products and prices; nil while loading, and for roles that cannot read Stripe.
  @State private var stripe: StripeCatalogResponse?
  @State private var loading = true
  @State private var error = ""
  /// save, publish, unpublish, delete or stripe while that request runs.
  @State private var busy = ""
  @State private var previewing = false
  @State private var suggesting = false
  @State private var confirm: Confirm?
  @State private var sharedFile: EmailSharedFile?
  /// What `POST …/preview` drew for the draft, in `previewLanguage`.
  @State private var preview: PublicPricingTable?
  @State private var previewLoading = false
  @State private var previewError = ""
  /// A language of the draft's translations; nil previews the table's own.
  @State private var previewLanguage: String?
  @State private var installTab = "web"
  /// Plans whose editor is open: the first, and the ones just added.
  @State private var opened: Set<String> = []

  private enum Confirm: String, Identifiable { case unpublish, delete; var id: String { rawValue } }
  private struct PreviewKey: Equatable { let draft: PricingDraft?; let language: String? }

  /// The preview sits beside the form on iPad and the Mac.
  private var wide: Bool { sizeClass != .compact }
  private var dirty: Bool { table.map { draft != PricingDraft($0) } ?? false }
  private var projectAccent: String? { workspace.project(projectId)?.theme.accent }
  private var catalog: StripeCatalog? { stripe?.connected == true ? stripe?.catalog : nil }

  var body: some View {
    Group {
      if let table, let draft = Binding($draft) {
        editor(table, draft)
      } else if loading {
        SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
      } else {
        VStack(spacing: 12) {
          ErrorText(message: error.isEmpty ? String(localized: "This pricing table does not exist.") : error)
          Button("Try again") { Task { await load() } }.buttonStyle(.lnSecondaryCompact)
        }
        .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      }
    }
    .projectScreen(projectId, table?.name ?? "Pricing table")
    .toolbar { if let table { toolbar(table) } }
    .confirmationDialog(confirm == .delete ? "Delete this pricing table?" : "Unpublish this pricing table?", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { item in
      switch item {
      case .unpublish: Button("Unpublish") { Task { await run("unpublish") } }
      case .delete: Button("Delete table", role: .destructive) { Task { await delete() } }
      }
    } message: { item in
      switch item {
      case .unpublish: Text("Sites and apps stop showing it, and its checkout links stop working. The published copy is kept until you publish again.")
      case .delete: Text("Sites and apps that show it will show nothing, and its checkout links stop working. This cannot be undone.")
      }
    }
    .sheet(item: $sharedFile) { ShareSheet(url: $0.url).presentationDetents([.medium, .large]) }
    .sheet(isPresented: $previewing) {
      NavigationStack {
        ScrollView { previewColumn.padding(20) }
          .panelScreen("Preview")
          .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { previewing = false } } }
      }
      .presentationDetents([.large])
    }
    .sheet(isPresented: $suggesting) {
      PricingSuggestSheet(projectId: projectId, tableId: tableId, beforeSuggest: saveIfDirty, apply: applySuggestion)
    }
    .task { if table == nil { await load() } }
    .task(id: PreviewKey(draft: draft, language: previewLanguage)) { await drawPreview() }
  }

  // MARK: Toolbar

  @ToolbarContentBuilder private func toolbar(_ table: PricingTable) -> some ToolbarContent {
    ToolbarItem(placement: .primaryAction) {
      Menu {
        if session.canManage {
          Button { suggesting = true } label: { Label("Suggest with AI", systemImage: "sparkles") }
        }
        Button { download(table) } label: { Label("Download offline copy", systemImage: "arrow.down.doc") }.disabled(table.published == nil)
        Button { Clipboard.copy(snippet("web")) } label: { Label("Copy install snippet", systemImage: "chevron.left.forwardslash.chevron.right") }
        Button { if let url = URL(string: base + table.pagePath) { openURL(url) } } label: { Label("Open the hosted page", systemImage: "safari") }.disabled(!table.isPublished)
        if table.isPublished {
          Button { Task { await run("publish", force: true) } } label: { Label("Push live now", systemImage: "bolt") }.disabled(busy != "")
          Button { confirm = .unpublish } label: { Label("Unpublish", systemImage: "eye.slash") }.disabled(busy != "")
        }
        Divider()
        Button(role: .destructive) { confirm = .delete } label: { Label("Delete table", systemImage: "trash") }.disabled(busy != "")
      } label: { Label("More", systemImage: "ellipsis.circle") }
    }
    if !wide {
      ToolbarItem(placement: .primaryAction) {
        Button { previewing = true } label: { Label("Preview", systemImage: "eye") }
      }
    }
    ToolbarItem(placement: .primaryAction) {
      if dirty {
        Button { Task { await save() } } label: { Text(busy == "save" ? "Saving…" : "Save") }
          .keyboardShortcut("s", modifiers: .command).disabled(busy != "")
      } else if !table.isPublished || table.changed {
        Button { Task { await run("publish") } } label: { Text(busy == "publish" ? "Publishing…" : table.isPublished ? "Publish changes" : "Publish") }
          .disabled(busy != "")
      }
    }
  }

  // MARK: Layout

  @ViewBuilder private func editor(_ table: PricingTable, _ draft: Binding<PricingDraft>) -> some View {
    let fields = ScrollView {
      form(table, draft).frame(maxWidth: 680, alignment: .leading).padding(20).frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    if wide {
      HStack(spacing: 0) {
        fields
        Rectangle().fill(Theme.border).frame(width: Hairline.width)
        ScrollView { previewColumn.padding(20) }.frame(width: 400).background(Theme.canvas)
      }
    } else {
      fields
    }
  }

  private var previewColumn: some View {
    VStack(spacing: 12) {
      if let draft, !draft.translations.isEmpty {
        Picker("Language", selection: $previewLanguage) {
          Text(ContentLocale.name(draft.locale)).tag(String?.none)
          ForEach(draft.translations.keys.sorted(), id: \.self) { Text(ContentLocale.name($0)).tag(Optional($0)) }
        }
        .pickerStyle(.menu).labelsHidden()
      }
      PricingPreview(table: preview, loading: previewLoading)
      ErrorText(message: previewError)
    }
  }

  private func form(_ table: PricingTable, _ draft: Binding<PricingDraft>) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 8) {
        Tag(text: table.statusLabel, tint: table.isPublished ? Theme.success : Theme.textDimmed)
        if let published = table.publishedAt, table.isPublished { Text(DateText.day(published)).font(.lnCaption).foregroundStyle(Theme.textMuted) }
        if dirty { Text("Unsaved changes").font(.lnCaption).foregroundStyle(Theme.warning) }
      }
      if table.changed {
        Label("These changes are not live yet. Sites and apps keep showing version \(table.version) until you publish.", systemImage: "info.circle")
          .font(.lnMeta).foregroundStyle(Theme.warning)
      }
      ErrorText(message: error)

      LegalPanel("Details") {
        OnboardingTextField(label: "Name", text: draft.name, limit: PricingLimits.name)
        LabeledField(label: "Key", hint: PricingLimits.validKey(draft.wrappedValue.key) ? "Your site or app asks for the table by this name." : PricingLimits.keyRule) {
          TextField("pricing", text: draft.key).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        PricingTemplatePicker(template: draft.template)
      }

      stripePanel(table)

      HStack {
        SectionLabel("Plans")
        Text("\(draft.wrappedValue.plans.count) of \(PricingLimits.plans)").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
      }
      ForEach(draft.plans) { $plan in
        let index = draft.wrappedValue.plans.firstIndex { $0.id == plan.id } ?? 0
        PricingPlanCard(
          plan: $plan, index: index, count: draft.wrappedValue.plans.count, catalog: catalog, currency: draft.wrappedValue.options.currency,
          open: Binding(get: { opened.contains(plan.id) }, set: { if $0 { opened.insert(plan.id) } else { opened.remove(plan.id) } }),
          move: { draft.wrappedValue.plans.move(index, by: $0) },
          remove: { draft.wrappedValue.plans.removeAll { $0.id == plan.id } },
          importFeatures: { importFeatures($0, into: plan.id, draft) }
        )
      }
      FlowLayout(spacing: 8) {
        Button {
          let plan = PricingPlan.blank(index: draft.wrappedValue.plans.count)
          opened.insert(plan.id)
          draft.wrappedValue.plans.append(plan)
        } label: { Label("Add plan", systemImage: "plus") }
          .buttonStyle(.lnSecondaryCompact).disabled(draft.wrappedValue.plans.count >= PricingLimits.plans)
        if session.canManage {
          Button { suggesting = true } label: { Label("Suggest with AI", systemImage: "sparkles") }.buttonStyle(.lnSecondaryCompact)
        }
      }

      PricingFeaturesPanel(draft: draft)

      wordsPanel(draft)

      PricingLanguagesPanel(draft: draft, canTranslate: !dirty && busy == "", translate: translate)

      lookPanel(draft)
      behaviourPanel(draft)
      checkoutPanel(draft)
      installPanel(draft.wrappedValue)

      if session.canManage {
        PricingResultsPanel(
          projectId: projectId, table: table, stripeConnected: stripe?.connected == true, dirty: dirty,
          onUpdate: { self.table = $0 }, onAdopt: apply
        )
      }
    }
  }

  // MARK: Sections

  private func stripePanel(_ table: PricingTable) -> some View {
    LegalPanel(title: "Stripe", trailing: {
      if stripe?.connected == true {
        Button { Task { await loadStripe(refresh: true) } } label: { Label(busy == "stripe" ? "Reading…" : "Read Stripe again", systemImage: "arrow.clockwise") }
          .buttonStyle(.lnGhost).disabled(busy != "")
      } else if session.canManage {
        NavigationLink(value: AppRoute.project(projectId, .revenue)) { Text("Connect Stripe") }.buttonStyle(.lnSecondaryCompact)
      }
    }, content: {
      Text(stripeStatus).font(.lnMeta).foregroundStyle(Theme.textMuted)
      if let stripe, stripe.connected, stripe.catalog != nil, !stripe.paymentLinks {
        Text("This Stripe key cannot read Payment Links: give it read access to use them as buttons.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      if let message = stripe?.error, !message.isEmpty { ErrorText(message: message) }
      if !table.warnings.isEmpty || table.checkoutError != nil {
        VStack(alignment: .leading, spacing: 6) {
          Text("Check before publishing").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
          if let failure = table.checkoutError { Text("The last checkout failed: \(failure.message)").font(.lnCaption).foregroundStyle(Theme.text) }
          ForEach(Array(table.warnings.enumerated()), id: \.offset) { _, warning in Text(warning).font(.lnCaption).foregroundStyle(Theme.text) }
          if dirty { Text("These are from the last save; save again to check your changes.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: Metrics.radius))
      }
    })
  }

  private var stripeStatus: String {
    if !session.canManage { return String(localized: "Only admins can see the Stripe products and prices. You can still edit the words.") }
    guard let stripe else { return String(localized: "Reading Stripe…") }
    guard stripe.connected else { return String(localized: "Connect Stripe under Revenue to take prices and checkout from it. Without it, write the prices here.") }
    return String(localized: "Linked plans take their prices from Stripe, read live: \(stripe.catalog?.products.count ?? 0) active products, \(stripe.catalog?.prices.count ?? 0) prices.")
  }

  private func wordsPanel(_ draft: Binding<PricingDraft>) -> some View {
    LegalPanel("Words") {
      OnboardingTextField(label: "Title", text: draft.content.title, limit: PricingLimits.title)
      OnboardingTextField(label: "Subtitle", text: draft.content.subtitle, limit: PricingLimits.subtitle, multiline: true)
      OnboardingTextField(label: "Small print", text: draft.content.footnote, limit: PricingLimits.footnote, placeholder: "Prices in USD. Cancel any time.", multiline: true)
      OnboardingTextField(label: "Weekly toggle", text: draft.content.weeklyLabel, limit: PricingLimits.label, placeholder: "Weekly")
      OnboardingTextField(label: "Monthly toggle", text: draft.content.monthlyLabel, limit: PricingLimits.label, placeholder: "Monthly")
      OnboardingTextField(label: "Yearly toggle", text: draft.content.yearlyLabel, limit: PricingLimits.label, placeholder: "Yearly")
      OnboardingTextField(label: "Savings badge", text: draft.content.savingsLabel, limit: PricingLimits.label, placeholder: "Save {percent}%")
      Text("Empty: the built-in words in the visitor's language. In the badge, {percent} is the best saving.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      LabeledField(label: "Terms link") {
        TextField("https://", text: draft.content.termsUrl).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      LabeledField(label: "Privacy link", hint: "A paywall shows both under its button; the App Store asks for them.") {
        TextField("https://", text: draft.content.privacyUrl).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
    }
  }

  private func lookPanel(_ draft: Binding<PricingDraft>) -> some View {
    LegalPanel("Look") {
      OptionalColorField(label: "Accent", hex: draft.style.accent, fallback: Color(hexString: projectAccent) ?? Theme.accent, empty: "The project's accent")
      OptionalColorField(label: "Background", hex: draft.style.background, fallback: .white, empty: "Follows light or dark")
      OptionalColorField(label: "Text", hex: draft.style.text, fallback: .black, empty: "Follows light or dark")
      LabeledField(label: "Corner radius") {
        HStack(spacing: 12) {
          Slider(value: Binding(get: { Double(draft.wrappedValue.style.radius) }, set: { draft.wrappedValue.style.radius = Int($0.rounded()) }), in: 0...Double(PricingLimits.radius), step: 1)
            .tint(Theme.accent)
          Text("\(draft.wrappedValue.style.radius) pt").font(.lnMeta).foregroundStyle(Theme.textMuted).monospacedDigit().frame(width: 44, alignment: .trailing)
        }
      }
      choice("Font", draft.style.font, PricingLimits.fonts)
      choice("Spacing", draft.style.density, PricingLimits.densities)
      choice("Cards", draft.style.surface, PricingLimits.surfaces)
      choice("Highlighted plan", draft.style.highlight, PricingLimits.highlights)
    }
  }

  private func behaviourPanel(_ draft: Binding<PricingDraft>) -> some View {
    LegalPanel("Behaviour") {
      choice("Toggle starts on", draft.options.defaultInterval, PricingLimits.intervals.filter { PricingLimits.recurring.contains($0.id) })
      choice("Yearly prices show", draft.options.yearlyAs, PricingLimits.yearlyAs, hint: "In an iPhone app, show the total: the App Store wants the amount billed to stand out.")
      LabeledField(label: "Currency", hint: "Of written prices; a Stripe price sold in it too shows in it.") {
        TextField("usd", text: Binding(get: { draft.wrappedValue.options.currency.uppercased() }, set: { draft.wrappedValue.options.currency = String($0.lowercased().filter(\.isLetter).prefix(3)) }))
          .textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.characters).autocorrectionDisabled().frame(maxWidth: 120)
      }
      switchRow("Each plan builds on the one before", "“Everything in Starter, plus”, then only what it adds.", draft.options.cumulative)
      switchRow("List what a plan leaves out", nil, draft.options.showExcluded).disabled(draft.wrappedValue.options.cumulative)
      switchRow("Strike through the monthly price on yearly", nil, draft.options.compare)
    }
  }

  private func checkoutPanel(_ draft: Binding<PricingDraft>) -> some View {
    LegalPanel("Checkout") {
      Text("For plans set to Stripe Checkout. Give the project's Stripe key “Checkout Sessions: Write”; without it, a Payment Link for the same price is used.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      LabeledField(label: "After paying", hint: "Empty: back to the page they came from.") {
        TextField("https://", text: draft.checkout.successUrl).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      LabeledField(label: "When they go back", hint: "Empty: back to the page they came from.") {
        TextField("https://", text: draft.checkout.cancelUrl).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      switchRow("Accept promotion codes", nil, draft.checkout.allowPromotionCodes)
    }
  }

  private func installPanel(_ draft: PricingDraft) -> some View {
    LegalPanel("Add it") {
      Picker("Where", selection: $installTab) {
        Text("Web").tag("web")
        Text("Link").tag("link")
        Text("Swift").tag("swift")
        Text("API").tag("api")
      }
      .pickerStyle(.segmented).labelsHidden()
      Text(installHint).font(.lnMeta).foregroundStyle(Theme.textMuted)
      CodeBlock(code: snippet(installTab, key: draft.key))
      if let guide = URL(string: base + (installTab == "swift" ? "/docs/pricing#plug-and-play-swift" : "/docs/pricing")) {
        Link(destination: guide) { Label("Read the guide", systemImage: "book") }.font(.lnMeta).foregroundStyle(Theme.accentText)
      }
    }
  }

  private var installHint: String {
    switch installTab {
    case "link": String(localized: "A hosted page with the table: link to it from an email or open it in an app.")
    case "swift": String(localized: "Paste HelpBitesPricing.swift from the guide into your app, then show this view.")
    case "api": String(localized: "The published table as JSON, open to any origin, for your own UI.")
    default: String(localized: "One script tag. It draws the table where you put it, in your page's light or dark.")
    }
  }

  private func choice(_ label: String, _ value: Binding<String>, _ items: [(id: String, label: String)], hint: String? = nil) -> some View {
    LabeledField(label: label, hint: hint) {
      Picker(LocalizedStringKey(label), selection: value) {
        ForEach(items, id: \.id) { Text($0.label).tag($0.id) }
      }
      .pickerStyle(.segmented).labelsHidden()
    }
  }

  private func switchRow(_ title: String, _ hint: String?, _ value: Binding<Bool>) -> some View {
    Toggle(isOn: value) {
      VStack(alignment: .leading, spacing: 2) {
        Text(LocalizedStringKey(title)).font(.lnRow).foregroundStyle(Theme.text)
        if let hint { Text(LocalizedStringKey(hint)).font(.lnCaption).foregroundStyle(Theme.textMuted) }
      }
    }
    .toggleStyle(.switch).tint(Theme.accent)
  }

  // MARK: Actions

  private var base: String { session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }

  private func snippet(_ kind: String, key: String? = nil) -> String {
    let pk = workspace.project(projectId)?.publicKey ?? "pk_…"
    let key = key ?? draft?.key ?? table?.key ?? "pricing"
    switch kind {
    case "swift": return "// Add HelpBitesPricing.swift from the guide, then:\nHelpBitesPricingView(host: URL(string: \"\(base)\")!, projectKey: \"\(pk)\", table: \"\(key)\")"
    case "api": return "curl -s \(base)/v1/pricing/\(pk)/\(key)"
    case "link": return "\(base)/pricing/\(pk)/\(key)"
    default: return "<script src=\"\(base)/pricing.js\" data-project=\"\(pk)\" data-table=\"\(key)\" defer></script>"
    }
  }

  private func apply(_ table: PricingTable) {
    self.table = table
    draft = PricingDraft(table)
    if let language = previewLanguage, table.translations[language] == nil { previewLanguage = nil }
    if opened.isEmpty, let first = table.plans.first { opened.insert(first.id) }
  }

  private func load() async {
    loading = true
    do {
      let response: PricingTableResponse = try await session.get("/v1/admin/pricing-tables/\(tableId)")
      apply(response.table)
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
    await loadStripe(refresh: false)
  }

  /// The pickers' products and prices. Agents may edit the words but not read Stripe, so it stays off for them.
  private func loadStripe(refresh: Bool) async {
    guard session.canManage else { return }
    if refresh { busy = "stripe" }
    defer { if refresh { busy = "" } }
    do {
      let response: StripeCatalogResponse = try await session.get("/v1/admin/stripe/catalog", query: ["project": projectId].merging(refresh ? ["refresh": "1"] : [:]) { a, _ in a })
      stripe = response
      // The warnings are worked out against Stripe: read the table again for fresh ones.
      if refresh, let response: PricingTableResponse = try? await session.get("/v1/admin/pricing-tables/\(tableId)") {
        if dirty { table = response.table } else { apply(response.table) }
      }
    } catch {
      if case APIError.cancelled = error { return }
      stripe = StripeCatalogResponse(connected: false, catalog: nil, paymentLinks: false, error: error.localizedDescription)
    }
  }

  /// `POST …/preview`: the draft as apps would get it, with Stripe's prices; a moment after the last edit.
  private func drawPreview() async {
    guard var body = draft else { return }
    if preview != nil { try? await Task.sleep(for: .milliseconds(450)) }
    if Task.isCancelled { return }
    body.previewLocale = previewLanguage
    previewLoading = true
    defer { previewLoading = false }
    do {
      let response: PricingPreviewResponse = try await session.send("/v1/admin/pricing-tables/\(tableId)/preview", body: body)
      preview = response.preview
      previewError = ""
    } catch {
      if case APIError.cancelled = error { return }
      previewError = error.localizedDescription
    }
  }

  @discardableResult private func save() async -> Bool {
    guard var body = draft else { return false }
    body.name = body.name.trimmingCharacters(in: .whitespacesAndNewlines)
    body.key = body.key.trimmingCharacters(in: .whitespaces).lowercased()
    if body.name.isEmpty { error = String(localized: "Give the table a name."); return false }
    if !PricingLimits.validKey(body.key) { error = PricingLimits.keyRule; return false }
    if let plan = body.plans.first(where: { !PricingLimits.validKey($0.key) }) { error = "\(plan.name.isEmpty ? String(localized: "A plan") : plan.name): \(PricingLimits.keyRule)"; return false }
    busy = "save"
    error = ""
    defer { busy = "" }
    do {
      let response: PricingTableResponse = try await session.send("/v1/admin/pricing-tables/\(tableId)", method: "PATCH", body: body)
      apply(response.table)
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
  }

  /// What "Suggest with AI" runs first: the server reads the saved working copy.
  private func saveIfDirty() async -> Bool {
    if !dirty { return true }
    return await save()
  }

  /// `POST …/translate`: the AI fills the saved working copy's translations; the table comes back with them.
  private func translate(_ locales: [String], overwrite: Bool) async throws {
    struct Body: Encodable, Sendable { let locales: [String]; let overwrite: Bool }
    let response: PricingTableResponse = try await LegalAPI.slow(session, "/v1/admin/pricing-tables/\(tableId)/translate", Body(locales: locales, overwrite: overwrite))
    apply(response.table)
  }

  /// publish or unpublish. `force` publishes again with Stripe read fresh, even with nothing new.
  private func run(_ action: String, force: Bool = false) async {
    busy = action
    error = ""
    defer { busy = "" }
    do {
      struct Force: Encodable, Sendable { let force: Bool }
      let path = "/v1/admin/pricing-tables/\(tableId)/\(action)"
      let response: PricingTableResponse = force ? try await session.send(path, body: Force(force: true)) : try await session.send(path)
      apply(response.table)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func delete() async {
    busy = "delete"
    defer { busy = "" }
    do {
      try await session.delete("/v1/admin/pricing-tables/\(tableId)")
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// Stripe's marketing features as rows the plan includes; a row with the same words is reused.
  private func importFeatures(_ names: [String], into planId: String, _ draft: Binding<PricingDraft>) {
    guard let planIndex = draft.wrappedValue.plans.firstIndex(where: { $0.id == planId }) else { return }
    for name in names {
      let words = name.trimmingCharacters(in: .whitespacesAndNewlines)
      var row = draft.wrappedValue.features.first { !$0.isHeading && $0.text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == words.lowercased() }
      if row == nil, draft.wrappedValue.features.count < PricingLimits.features {
        var feature = PricingFeature.blank()
        feature.text = words.clipped(to: PricingLimits.feature)
        draft.wrappedValue.features.append(feature)
        row = feature
      }
      if let row, draft.wrappedValue.plans[planIndex].features[row.id] == nil { draft.wrappedValue.plans[planIndex].features[row.id] = .included(true) }
    }
  }

  /// An AI suggestion lands in the form, to look over and save like any edit.
  private func applySuggestion(_ suggestion: PricingSuggestion.Draft) {
    guard draft != nil else { return }
    draft?.content = suggestion.content
    draft?.features = suggestion.features
    draft?.plans = suggestion.plans
    opened.formUnion(suggestion.plans.map(\.id))
  }

  /// `pricing-<key>.json`: the same `{ table }` the public API answers, for apps to bundle.
  private func download(_ table: PricingTable) {
    struct Envelope: Encodable { let table: PublicPricingTable }
    guard let published = table.published else { return }
    do { sharedFile = EmailSharedFile(url: try EmailFiles.write(try EmailFiles.prettyJSON(Envelope(table: published)), named: "pricing-\(table.key).json")) }
    catch { self.error = error.localizedDescription }
  }
}
