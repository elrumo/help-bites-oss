import SwiftUI

/// One plan (web: components/pricing/PricingPlanEditor.vue): its words, its Stripe product and a
/// price per slot (Stripe's, or written by hand in the table's currency and any other), the App
/// Store product apps sell it as, a trial, and its button. Folds shut to its name.
struct PricingPlanCard: View {
  @Binding var plan: PricingPlan
  let index: Int
  let count: Int
  let catalog: StripeCatalog?
  /// The table's currency: written prices are in it.
  let currency: String
  @Binding var open: Bool
  let move: (Int) -> Void
  let remove: () -> Void
  let importFeatures: ([String]) -> Void
  /// A new plan's key follows its name until someone edits the key.
  @State private var keyEdited = true
  @State private var newCurrency = ""
  /// Currencies added here that have no amount yet.
  @State private var added: [String] = []

  private var product: StripeCatalog.Product? { catalog?.products.first { $0.id == plan.stripeProduct } }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        Button { withAnimation(.snappy) { open.toggle() } } label: {
          HStack(spacing: 8) {
            Image(systemName: open ? "chevron.down" : "chevron.right").font(.app(size: 11, weight: .semibold)).foregroundStyle(Theme.textMuted).frame(width: 12)
            Text(plan.name.isEmpty ? (product?.name ?? String(localized: "Plan \(index + 1)")) : plan.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
            Text(plan.key).font(.lnMono).foregroundStyle(Theme.textDimmed).lineLimit(1)
            if !plan.badge.isEmpty { Tag(text: plan.badge) }
            Spacer(minLength: 4)
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(open ? .isSelected : [])
        ReorderControls(index: index, count: count, move: move, remove: count > 1 ? remove : nil)
      }
      if open { fields }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(plan.highlighted ? Theme.accent.opacity(0.5) : Theme.border))
    .onAppear { keyEdited = !plan.key.isEmpty && plan.key != PricingLimits.keyFrom(plan.name, fallback: "plan-\(index + 1)") }
  }

  @ViewBuilder private var fields: some View {
    // Typing the name moves the key along; a suggestion applied to the form does not.
    OnboardingTextField(label: "Name", text: Binding(get: { plan.name }, set: { name in
      plan.name = name
      if !keyEdited { plan.key = PricingLimits.keyFrom(name, fallback: "plan-\(index + 1)") }
    }), limit: PricingLimits.name, placeholder: product?.name ?? "")
    if plan.name.isEmpty, let product { Text("Empty: Stripe's “\(product.name)”.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
    LabeledField(label: "Key", hint: PricingLimits.validKey(plan.key) ? "Your code refers to the plan by it." : PricingLimits.keyRule) {
      TextField("pro", text: Binding(get: { plan.key }, set: { plan.key = $0; keyEdited = true }))
        .textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
    }
    OnboardingTextField(label: "Description", text: $plan.description, limit: PricingLimits.description, placeholder: product?.description ?? "")
    OnboardingTextField(label: "Badge", text: $plan.badge, limit: PricingLimits.badge, placeholder: "Most popular")
    Toggle(isOn: $plan.highlighted) { Text("Highlight this plan").font(.lnRow).foregroundStyle(Theme.text) }
      .toggleStyle(.switch).tint(Theme.accent)

    prices

    OnboardingTextField(label: "Label without a price", text: $plan.customPrice, limit: PricingLimits.custom, placeholder: "Custom")
    Text("For a plan with no price, such as Enterprise.").font(.lnCaption).foregroundStyle(Theme.textMuted)
    OnboardingTextField(label: "Under the price", text: $plan.priceNote, limit: PricingLimits.note, placeholder: product.map { $0.unitLabel.isEmpty ? "per seat" : "per \($0.unitLabel)" } ?? "per seat")
    LabeledField(label: "Free trial (days)") {
      TextField("0", value: $plan.trialDays, format: .number).textFieldStyle(.linear).keyboardType(.numberPad).monospacedDigit().frame(maxWidth: 120)
        .onChange(of: plan.trialDays) { _, days in if days < 0 || days > PricingLimits.trialDays { plan.trialDays = min(max(days, 0), PricingLimits.trialDays) } }
    }
    button
  }

  // MARK: Prices

  @ViewBuilder private var prices: some View {
    VStack(alignment: .leading, spacing: 12) {
      LabeledField(label: "Stripe product", hint: catalog == nil ? "Connect Stripe to pick a product." : nil) {
        Picker("Stripe product", selection: $plan.stripeProduct) {
          Text("Not linked to Stripe").tag("")
          ForEach(catalog?.products ?? []) { Text($0.name.isEmpty ? $0.id : $0.name).tag($0.id) }
          if !plan.stripeProduct.isEmpty && product == nil { Text(plan.stripeProduct).tag(plan.stripeProduct) }
        }
        .pickerStyle(.menu).labelsHidden().disabled(catalog == nil)
        if let product, !product.features.isEmpty {
          Button { importFeatures(product.features) } label: { Label("Add Stripe's \(product.features.count) features", systemImage: "text.badge.plus") }
            .buttonStyle(.lnSecondaryCompact)
        }
      }
      ForEach(PricingLimits.intervals, id: \.id) { slot in slotRow(slot.id, slot.label) }
      if !writtenSlots.isEmpty { otherCurrencies }
    }
    .padding(12)
    .background(Theme.elevated.opacity(0.5), in: RoundedRectangle(cornerRadius: Metrics.radius))
  }

  private func slotRow(_ slot: String, _ label: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(label).font(.lnMetaMedium).foregroundStyle(Theme.textToned)
      if let catalog {
        Picker("Stripe price", selection: Binding(get: { plan.prices[slot].stripePrice }, set: { plan.prices[slot].stripePrice = $0 })) {
          Text(plan.stripeProduct.isEmpty ? "No Stripe price" : "The product's current price").tag("")
          ForEach(catalog.prices.filter { $0.slot == slot && (plan.stripeProduct.isEmpty || $0.product == plan.stripeProduct) }) { Text($0.label).tag($0.id) }
        }
        .pickerStyle(.menu).labelsHidden()
      }
      HStack(spacing: 8) {
        PricingAmountField(placeholder: String(localized: "Written price (\(currency.uppercased()))"), amount: Binding(get: { plan.prices[slot].amount }, set: { plan.prices[slot].amount = $0 }))
        TextField("App Store product", text: Binding(get: { plan.prices[slot].appStoreProduct }, set: { plan.prices[slot].appStoreProduct = $0.clipped(to: PricingLimits.product) }))
          .textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      if stripeHasPrice(slot), plan.prices[slot].amount != nil {
        Text("Stripe's price for it is shown; the written one is for when Stripe has none.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
    }
  }

  /// The slot has a Stripe price: one picked, or the linked product's active price for it.
  private func stripeHasPrice(_ slot: String) -> Bool {
    if !plan.prices[slot].stripePrice.isEmpty { return true }
    guard !plan.stripeProduct.isEmpty, let catalog else { return false }
    return catalog.prices.contains { $0.product == plan.stripeProduct && $0.slot == slot }
  }

  // MARK: Other currencies

  /// Only slots with a written price use written prices in other currencies.
  private var writtenSlots: [(id: String, label: String)] { PricingLimits.intervals.filter { plan.prices[$0.id].amount != nil } }
  private var currencies: [String] {
    let own = currency.lowercased()
    let saved = PricingLimits.intervals.flatMap { plan.prices[$0.id].amounts.keys }
    return Array(Set(saved + added)).filter { $0 != own }.sorted()
  }
  private var canAdd: Bool {
    let code = newCurrency.lowercased()
    return code.count == 3 && code.allSatisfy(\.isLetter) && code != currency.lowercased() && !currencies.contains(code)
  }

  private var otherCurrencies: some View {
    VStack(alignment: .leading, spacing: 10) {
      Rectangle().fill(Theme.border).frame(height: Hairline.width)
      HStack(spacing: 8) {
        Text("Written prices in other currencies").font(.lnMetaMedium).foregroundStyle(Theme.textToned)
        Spacer(minLength: 4)
        TextField("EUR", text: $newCurrency).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.characters).autocorrectionDisabled().frame(width: 80)
          .onSubmit(addCurrency)
          .accessibilityLabel("Currency code")
        Button("Add", action: addCurrency).buttonStyle(.lnSecondaryCompact).disabled(!canAdd)
      }
      ForEach(currencies, id: \.self) { code in
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            Text(code.uppercased()).font(.lnMono).foregroundStyle(Theme.textMuted)
            Spacer()
            IconButton(systemImage: "xmark", label: "Remove \(code.uppercased())") { removeCurrency(code) }
          }
          HStack(spacing: 8) {
            ForEach(writtenSlots, id: \.id) { slot in
              PricingAmountField(placeholder: slot.label, amount: Binding(
                get: { plan.prices[slot.id].amounts[code] },
                set: { plan.prices[slot.id].amounts[code] = $0 }
              ))
            }
          }
        }
      }
      Text("A visitor can switch to a currency once every plan has a price in it, written here or in the Stripe price's currencies.").font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  private func addCurrency() {
    guard canAdd else { return }
    added.append(newCurrency.lowercased())
    newCurrency = ""
  }

  private func removeCurrency(_ code: String) {
    for slot in PricingLimits.intervals { plan.prices[slot.id].amounts[code] = nil }
    added.removeAll { $0 == code }
  }

  // MARK: Button

  @ViewBuilder private var button: some View {
    LabeledField(label: "Button", hint: PricingLimits.actions.first { $0.id == plan.action.type }?.hint) {
      Picker("Button", selection: $plan.action.type) {
        ForEach(PricingLimits.actions, id: \.id) { Text($0.label).tag($0.id) }
      }
      .pickerStyle(.menu).labelsHidden()
    }
    if plan.action.type != "none" {
      OnboardingTextField(label: "Button label", text: $plan.action.label, limit: PricingLimits.label, placeholder: plan.trialDays > 0 ? "Start \(plan.trialDays)-day free trial" : "Get started")
    }
    if plan.action.type == "url" {
      LabeledField(label: "Link", hint: "{plan} and {interval} are filled in with the plan's key and week, month, year or once.") {
        TextField("https://", text: $plan.action.url).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
    }
  }
}

/// A price in the currency's units ("19.99"), empty for none. Keeps what is typed while it parses.
struct PricingAmountField: View {
  let placeholder: String
  @Binding var amount: Double?
  @State private var text = ""

  var body: some View {
    TextField(placeholder, text: $text)
      .textFieldStyle(.linear).keyboardType(.decimalPad).monospacedDigit()
      .onAppear { text = Self.format(amount) }
      .onChange(of: text) { _, value in
        let clean = value.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
        if clean.isEmpty { amount = nil }
        else if let n = Double(clean), n >= 0, n <= Double(PricingLimits.amount) { amount = (n * 100).rounded() / 100 }
      }
      .onChange(of: amount) { _, value in
        if Double(text.replacingOccurrences(of: ",", with: ".")) != value { text = Self.format(value) }
      }
      .accessibilityLabel(placeholder)
  }

  static func format(_ value: Double?) -> String {
    guard let value else { return "" }
    return value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(format: "%.2f", value)
  }
}

/// The feature list (web: components/pricing/PricingFeatures.vue): rows and headings, and what each
/// plan has of each row: included, not, or a value ("10", "Unlimited").
struct PricingFeaturesPanel: View {
  @Binding var draft: PricingDraft

  var body: some View {
    LegalPanel(title: "Features", trailing: {
      Text("\(draft.features.count) of \(PricingLimits.features)").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
    }, content: {
      Text("Tick what each plan includes. A value (10, Unlimited) shows beside the feature, and the comparison table shows it in its cell.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      if draft.features.isEmpty { Text("No features yet.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
      ForEach($draft.features) { $feature in
        let index = draft.features.firstIndex { $0.id == feature.id } ?? 0
        row($feature, index: index)
      }
      FlowLayout(spacing: 8) {
        Button { draft.features.append(.blank()) } label: { Label("Add feature", systemImage: "plus") }
          .buttonStyle(.lnSecondaryCompact).disabled(draft.features.count >= PricingLimits.features)
        Button { draft.features.append(.blank(heading: true)) } label: { Label("Add heading", systemImage: "textformat") }
          .buttonStyle(.lnSecondaryCompact).disabled(draft.features.count >= PricingLimits.features)
      }
    })
  }

  private func row(_ feature: Binding<PricingFeature>, index: Int) -> some View {
    let id = feature.wrappedValue.id
    return VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        TextField(feature.wrappedValue.isHeading ? "Heading" : "Feature", text: feature.text)
          .textFieldStyle(.linear).font(feature.wrappedValue.isHeading ? .lnRow : .lnBody)
          .onChange(of: feature.wrappedValue.text) { _, value in if value.utf16.count > PricingLimits.feature { feature.wrappedValue.text = value.clipped(to: PricingLimits.feature) } }
        ReorderControls(index: index, count: draft.features.count, move: { draft.features.move(index, by: $0) }, remove: { removeFeature(id) })
      }
      if !feature.wrappedValue.isHeading {
        TextField("Tooltip (optional)", text: feature.hint).textFieldStyle(.linear)
          .onChange(of: feature.wrappedValue.hint) { _, value in if value.utf16.count > PricingLimits.hint { feature.wrappedValue.hint = value.clipped(to: PricingLimits.hint) } }
        ForEach(draft.plans.indices, id: \.self) { planIndex in
          let plan = draft.plans[planIndex]
          HStack(spacing: 10) {
            Toggle(isOn: included(planIndex, id)) {
              Text(plan.name.isEmpty ? plan.key : plan.name).font(.lnMeta).foregroundStyle(Theme.text).lineLimit(1)
            }
            .toggleStyle(.switch).tint(Theme.accent).fixedSize()
            .accessibilityLabel("\(plan.name.isEmpty ? plan.key : plan.name) includes \(feature.wrappedValue.text)")
            Spacer(minLength: 4)
            TextField("Value", text: value(planIndex, id)).textFieldStyle(.linear).frame(maxWidth: 140)
              .accessibilityLabel("Value of \(feature.wrappedValue.text) in \(plan.name.isEmpty ? plan.key : plan.name)")
          }
        }
      }
    }
    .padding(.vertical, 6)
  }

  private func included(_ planIndex: Int, _ featureId: String) -> Binding<Bool> {
    Binding(
      get: { draft.plans.indices.contains(planIndex) && (draft.plans[planIndex].features[featureId]?.isIncluded ?? false) },
      set: { on in
        guard draft.plans.indices.contains(planIndex) else { return }
        if on { if !(draft.plans[planIndex].features[featureId]?.isIncluded ?? false) { draft.plans[planIndex].features[featureId] = .included(true) } }
        else { draft.plans[planIndex].features[featureId] = nil }
      }
    )
  }

  /// A value includes the feature; clearing it leaves the feature ticked.
  private func value(_ planIndex: Int, _ featureId: String) -> Binding<String> {
    Binding(
      get: { draft.plans.indices.contains(planIndex) ? (draft.plans[planIndex].features[featureId]?.text ?? "") : "" },
      set: { text in
        guard draft.plans.indices.contains(planIndex) else { return }
        let clean = text.clipped(to: PricingLimits.cell)
        if !clean.isEmpty { draft.plans[planIndex].features[featureId] = .value(clean) }
        else if case .value? = draft.plans[planIndex].features[featureId] { draft.plans[planIndex].features[featureId] = .included(true) }
      }
    )
  }

  /// A row that goes takes its values with it.
  private func removeFeature(_ id: String) {
    draft.features.removeAll { $0.id == id }
    for index in draft.plans.indices { draft.plans[index].features[id] = nil }
  }
}
