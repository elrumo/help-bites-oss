import SwiftUI

/// A pricing table as an app draws it: the layout of `HelpBitesPricingTableView` in
/// docs/PRICING.md, on the app's own models. The editor's preview, and the plans of
/// an onboarding step in the onboarding preview (`compact`).
struct PricingTableView: View {
  let table: PublicPricingTable
  var accent: Color?
  var cornerRadius: CGFloat?
  /// Narrow (an onboarding card): no title, and rows in place of the wide layouts.
  var compact = false
  /// A plan's button; nil draws it without doing anything (a preview).
  var onSelect: ((PublicPricingPlan, PublicPricingPrice?) -> Void)?
  @State private var interval: String?
  @State private var choice: Int?

  private var tint: Color { accent ?? Color(hexString: table.style.accent) ?? Theme.accent }
  private var onTint: Color { accent == nil && table.style.accent.count == 7 ? OnboardingPreview.readable(on: table.style.accent) : .white }
  private var radius: CGFloat { cornerRadius ?? CGFloat(table.style.radius) }
  private var gap: CGFloat { ["compact": 10, "spacious": 22][table.style.density] ?? 16 }
  private var template: String { compact && !["paywall", "rows"].contains(table.template) ? "rows" : table.template }
  private var slot: String {
    if let interval { return interval }
    if table.intervals.contains(table.options.defaultInterval) { return table.options.defaultInterval }
    return ["year", "month", "week", "once"].first { table.intervals.contains($0) } ?? "once"
  }
  /// Every slot a subscription bills in that some plan has; one alone needs no toggle.
  private var recurring: [String] { PricingLimits.recurring.filter { table.intervals.contains($0) } }
  private static let designs: [String: Font.Design] = ["rounded": .rounded, "serif": .serif, "mono": .monospaced]

  var body: some View {
    VStack(alignment: template == "paywall" ? .leading : .center, spacing: gap) {
      if !compact { header }
      if template == "paywall" {
        paywall
      } else {
        if recurring.count >= 2 { toggle }
        if template == "matrix" { matrix } else { cards }
      }
      if !table.content.footnote.isEmpty {
        Text(table.content.footnote).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(template == "paywall" ? .leading : .center)
      }
      links
    }
    .fontDesign(Self.designs[table.style.font] ?? .default)
    .foregroundStyle(Color(hexString: table.style.text).map { AnyShapeStyle($0) } ?? AnyShapeStyle(.primary))
    .tint(tint)
  }

  // MARK: Parts

  @ViewBuilder private var header: some View {
    VStack(alignment: template == "paywall" ? .leading : .center, spacing: 6) {
      if !table.content.title.isEmpty { Text(table.content.title).font(.title2.weight(.bold)).multilineTextAlignment(template == "paywall" ? .leading : .center) }
      if !table.content.subtitle.isEmpty { Text(table.content.subtitle).foregroundStyle(.secondary).multilineTextAlignment(template == "paywall" ? .leading : .center) }
    }
  }

  private var toggle: some View {
    Picker("Billing period", selection: Binding(get: { slot }, set: { interval = $0 })) {
      ForEach(recurring, id: \.self) { slot in
        Text(slot == "year" ? yearlyLabel : Self.slotName(slot, table.content)).tag(slot)
      }
    }
    .pickerStyle(.segmented)
    .frame(maxWidth: recurring.count > 2 ? 420 : 320)
  }

  private var yearlyLabel: String {
    let yearly = Self.slotName("year", table.content)
    guard table.savings > 0 else { return yearly }
    let save = (table.content.savingsLabel.isEmpty ? "Save {percent}%" : table.content.savingsLabel).replacingOccurrences(of: "{percent}", with: "\(table.savings)")
    return "\(yearly) · \(save)"
  }

  private var cards: some View {
    VStack(spacing: gap) {
      ForEach(table.plans) { plan in card(plan) }
    }
  }

  private func card(_ plan: PublicPricingPlan) -> some View {
    let price = Self.price(plan, slot)
    let filled = plan.highlighted && table.style.highlight == "fill"
    return VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        Text(plan.name).font(.headline)
        if !plan.badge.isEmpty { badge(plan.badge, inverted: filled) }
        Spacer(minLength: 0)
      }
      if !plan.description.isEmpty { Text(plan.description).font(.subheadline).foregroundStyle(filled ? AnyShapeStyle(onTint.opacity(0.8)) : AnyShapeStyle(.secondary)) }
      priceView(plan, price, inverted: filled)
      button(plan, price, primary: plan.highlighted || table.plans.count == 1, inverted: filled)
      if template != "rows" { lines(plan, inverted: filled) }
    }
    .padding(gap + 4)
    .frame(maxWidth: .infinity, alignment: .leading)
    .foregroundStyle(filled ? AnyShapeStyle(onTint) : AnyShapeStyle(.primary))
    .background(cardBackground(filled), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(plan.highlighted && !filled ? tint : (table.style.surface == "outline" ? Color.secondary.opacity(0.25) : .clear), lineWidth: plan.highlighted && !filled ? 2 : 1))
    .shadow(color: .black.opacity(table.style.surface == "shadow" || (plan.highlighted && table.style.highlight == "raise") ? 0.12 : 0), radius: 14, y: 6)
    .accessibilityElement(children: .contain)
  }

  private func cardBackground(_ filled: Bool) -> AnyShapeStyle {
    if filled { return AnyShapeStyle(tint) }
    if let background = Color(hexString: table.style.background) { return AnyShapeStyle(background) }
    return table.style.surface == "flat" ? AnyShapeStyle(Color.secondary.opacity(0.08)) : AnyShapeStyle(.background)
  }

  private func badge(_ text: String, inverted: Bool) -> some View {
    Text(text).font(.caption.weight(.bold)).padding(.horizontal, 8).padding(.vertical, 3)
      .background(inverted ? onTint : tint, in: Capsule()).foregroundStyle(inverted ? tint : onTint)
  }

  private func priceView(_ plan: PublicPricingPlan, _ price: PublicPricingPrice?, inverted: Bool) -> some View {
    let words = Self.describe(plan, price, table)
    return VStack(alignment: .leading, spacing: 2) {
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        if table.options.compare, let price, price.interval == "year", let month = plan.prices.month, month.amount > 0, month.currency == price.currency {
          Text(Self.money(table.options.yearlyAs == "monthly" ? month.amount : month.amount * 12, price.currency, table.locale)).strikethrough().foregroundStyle(.secondary)
        }
        Text(words.amount).font(.system(.largeTitle, design: .default, weight: .bold)).monospacedDigit()
        if !words.period.isEmpty { Text(words.period).foregroundStyle(inverted ? AnyShapeStyle(onTint.opacity(0.8)) : AnyShapeStyle(.secondary)) }
      }
      let note = [words.sub, plan.priceNote.isEmpty ? (plan.unitLabel.isEmpty ? "" : "per \(plan.unitLabel)") : plan.priceNote].filter { !$0.isEmpty }.joined(separator: " · ")
      if !note.isEmpty { Text(note).font(.footnote).foregroundStyle(inverted ? AnyShapeStyle(onTint.opacity(0.8)) : AnyShapeStyle(.secondary)) }
      if let price, price.trialDays > 0, price.interval != "once" { Text("\(price.trialDays)-day free trial").font(.footnote.weight(.semibold)).foregroundStyle(inverted ? onTint : tint) }
    }
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private func button(_ plan: PublicPricingPlan, _ price: PublicPricingPrice?, primary: Bool, inverted: Bool) -> some View {
    if plan.action.type != "none" {
      Button { onSelect?(plan, price) } label: {
        Text(Self.buttonWords(plan, price)).fontWeight(.semibold).frame(maxWidth: .infinity, minHeight: 44)
          .background(primary ? AnyShapeStyle(inverted ? onTint : tint) : AnyShapeStyle(Color.secondary.opacity(0.12)), in: RoundedRectangle(cornerRadius: max(6, radius * 0.6), style: .continuous))
          .foregroundStyle(primary ? (inverted ? tint : onTint) : Color.primary)
      }
      .buttonStyle(.plain)
      .accessibilityHint(plan.name)
    }
  }

  @ViewBuilder private func lines(_ plan: PublicPricingPlan, inverted: Bool) -> some View {
    if !plan.lines.isEmpty {
      VStack(alignment: .leading, spacing: 8) {
        if !plan.includes.isEmpty { Text("Everything in \(plan.includes), plus:").font(.footnote.weight(.semibold)) }
        ForEach(plan.lines) { line in
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: line.included ? "checkmark" : "xmark").font(.footnote.weight(.bold)).foregroundStyle(line.included ? (inverted ? onTint : tint) : .secondary)
              .accessibilityLabel(line.included ? "Included" : "Not included")
            Text(line.text).strikethrough(!line.included).foregroundStyle(line.included ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
            Spacer(minLength: 4)
            if !line.value.isEmpty { Text(line.value).fontWeight(.semibold) }
          }
          .font(.subheadline)
        }
      }
      .padding(.top, 4)
    }
  }

  @ViewBuilder private var links: some View {
    let terms = URL(string: table.content.termsUrl), privacy = URL(string: table.content.privacyUrl)
    if terms != nil || privacy != nil {
      HStack(spacing: 16) {
        if let terms, !table.content.termsUrl.isEmpty { Link("Terms", destination: terms) }
        if let privacy, !table.content.privacyUrl.isEmpty { Link("Privacy", destination: privacy) }
      }
      .font(.footnote).foregroundStyle(.secondary)
      .frame(maxWidth: .infinity)
    }
  }

  // MARK: Paywall: one choice per price, one button

  private var choices: [(plan: PublicPricingPlan, price: PublicPricingPrice?)] {
    table.plans.flatMap { plan -> [(plan: PublicPricingPlan, price: PublicPricingPrice?)] in
      let prices = plan.prices.all
      return prices.isEmpty ? [(plan, nil)] : prices.map { (plan, $0) }
    }
  }

  private var picked: Int {
    if let choice, choice < choices.count { return choice }
    return choices.firstIndex { $0.plan.highlighted && $0.price?.interval == slot } ?? choices.firstIndex { $0.price?.interval == slot } ?? 0
  }

  @ViewBuilder private var paywall: some View {
    let all = choices
    if !all.isEmpty {
      let selected = all[min(picked, all.count - 1)]
      lines(selected.plan, inverted: false)
      VStack(spacing: 10) {
        ForEach(Array(all.enumerated()), id: \.offset) { index, item in
          option(item.plan, item.price, selected: index == picked) { choice = index }
        }
      }
      button(selected.plan, selected.price, primary: true, inverted: false)
    }
  }

  private func option(_ plan: PublicPricingPlan, _ price: PublicPricingPrice?, selected: Bool, pick: @escaping () -> Void) -> some View {
    let words = Self.describe(plan, price, table)
    let name = price.map { Self.slotName($0.interval, table.content) } ?? plan.name
    return Button(action: pick) {
      HStack(spacing: 12) {
        Image(systemName: selected ? "largecircle.fill.circle" : "circle").font(.title3).foregroundStyle(selected ? tint : .secondary)
        VStack(alignment: .leading, spacing: 2) {
          Text(table.plans.count > 1 && price != nil ? "\(plan.name) · \(name)" : name).fontWeight(.semibold)
          if price?.interval == "year", !plan.badge.isEmpty { Text(plan.badge).font(.footnote).foregroundStyle(.secondary) }
          else if let price, price.trialDays > 0 { Text("\(price.trialDays)-day free trial").font(.footnote).foregroundStyle(.secondary) }
        }
        Spacer(minLength: 8)
        VStack(alignment: .trailing, spacing: 2) {
          Text(words.amount + words.period).fontWeight(.bold).monospacedDigit()
          if !words.sub.isEmpty { Text(words.sub).font(.caption).foregroundStyle(.secondary) }
        }
      }
      .padding(14)
      .frame(minHeight: 56)
      .background(selected ? tint.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: radius * 0.75, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: radius * 0.75, style: .continuous).strokeBorder(selected ? tint : Color.secondary.opacity(0.3), lineWidth: selected ? 2 : 1))
      .overlay(alignment: .topTrailing) {
        if price?.interval == "year", plan.savings > 0 {
          Text("Save \(plan.savings)%").font(.caption2.weight(.bold)).padding(.horizontal, 8).padding(.vertical, 3)
            .background(tint, in: Capsule()).foregroundStyle(onTint).offset(x: -12, y: -10)
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  // MARK: Comparison

  private var matrix: some View {
    ScrollView(.horizontal) {
      Grid(alignment: .center, horizontalSpacing: 0, verticalSpacing: 0) {
        GridRow {
          Text("Features").font(.footnote).foregroundStyle(.secondary).frame(width: 140, alignment: .leading)
          ForEach(table.plans) { plan in
            let price = Self.price(plan, slot)
            let words = Self.describe(plan, price, table)
            VStack(spacing: 4) {
              if !plan.badge.isEmpty { badge(plan.badge, inverted: false) }
              Text(plan.name).font(.subheadline.weight(.semibold))
              Text(words.amount + words.period).font(.headline).monospacedDigit()
              button(plan, price, primary: plan.highlighted, inverted: false).controlSize(.small)
            }
            .padding(10).frame(width: 130)
            .background(plan.highlighted ? tint.opacity(0.08) : Color.clear)
          }
        }
        Divider().gridCellUnsizedAxes(.horizontal)
        ForEach(table.features) { feature in
          if feature.isHeading {
            Text(feature.text.uppercased()).font(.caption.weight(.bold)).foregroundStyle(.secondary)
              .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 14).padding(.bottom, 6)
          } else {
            GridRow {
              Text(feature.text).font(.subheadline).frame(width: 140, alignment: .leading).padding(.vertical, 10)
              ForEach(table.plans) { plan in cell(plan.cells[feature.id]).frame(width: 130).padding(.vertical, 10).background(plan.highlighted ? tint.opacity(0.04) : Color.clear) }
            }
            Divider().gridCellUnsizedAxes(.horizontal)
          }
        }
      }
      .padding(.horizontal, 12)
    }
    .background(cardBackground(false), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
  }

  @ViewBuilder private func cell(_ value: PricingCell?) -> some View {
    switch value {
    case .value(let text)?: Text(text).font(.subheadline)
    case .included(true)?: Image(systemName: "checkmark").font(.footnote.weight(.bold)).foregroundStyle(tint).accessibilityLabel("Included")
    default: Text("—").foregroundStyle(.secondary).accessibilityLabel("Not included")
    }
  }

  // MARK: Words

  /// The price a plan shows for a slot: that one, else its one-time price, else whichever it has.
  static func price(_ plan: PublicPricingPlan, _ slot: String) -> PublicPricingPrice? {
    plan.prices[slot] ?? plan.prices.once ?? plan.prices.month ?? plan.prices.year
  }

  /// The big number, what follows it and the line under it (pricing.js `describe`).
  static func describe(_ plan: PublicPricingPlan, _ price: PublicPricingPrice?, _ table: PublicPricingTable) -> (amount: String, period: String, sub: String) {
    guard let price else { return (plan.customPrice.isEmpty ? "Custom" : plan.customPrice, "", "") }
    if price.amount == 0 { return ("Free", "", "") }
    let monthlyView = price.interval == "year" && table.options.yearlyAs == "monthly" && price.monthly != nil
    let count = price.intervalCount
    let period = price.interval == "once" ? "" : count > 1 ? " every \(count) \(price.interval)s" : (monthlyView || price.interval == "month") ? "/month" : price.interval == "week" ? "/week" : "/year"
    var sub = ""
    if price.interval == "once" { sub = "One-time payment" }
    else if price.interval == "year", count == 1 {
      sub = monthlyView ? "\(money(price.amount, price.currency, table.locale)) billed yearly" : price.monthly.map { "\(money($0, price.currency, table.locale)) a month" } ?? ""
    }
    return (money(monthlyView ? price.monthly ?? price.amount : price.amount, price.currency, table.locale), period, sub)
  }

  /// A slot's name in the paywall's rows: the toggle's words when the table has its own.
  static func slotName(_ slot: String, _ content: PricingContent) -> String {
    switch slot {
    case "week": content.weeklyLabel.isEmpty ? "Weekly" : content.weeklyLabel
    case "month": content.monthlyLabel.isEmpty ? "Monthly" : content.monthlyLabel
    case "year": content.yearlyLabel.isEmpty ? "Yearly" : content.yearlyLabel
    default: "One-time"
    }
  }

  static func buttonWords(_ plan: PublicPricingPlan, _ price: PublicPricingPrice?) -> String {
    if !plan.action.label.isEmpty { return plan.action.label }
    guard let price else { return "Contact us" }
    return price.trialDays > 0 ? "Start \(price.trialDays)-day free trial" : "Get started"
  }

  static func money(_ amount: Double, _ currency: String, _ locale: String) -> String {
    let whole = amount.truncatingRemainder(dividingBy: 1) == 0
    return amount.formatted(.currency(code: currency.uppercased()).locale(Locale(identifier: locale)).precision(.fractionLength(whole ? 0 : 2)))
  }
}

/// The editor's preview: the table inside a frame the size of a phone or of a page, light or dark.
struct PricingPreview: View {
  let table: PublicPricingTable?
  var loading = false
  @State private var dark = false
  @State private var wide = false

  var body: some View {
    VStack(spacing: 14) {
      HStack(spacing: 10) {
        Picker("Appearance", selection: $dark) {
          Label("Light", systemImage: "sun.max").tag(false)
          Label("Dark", systemImage: "moon").tag(true)
        }
        .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 160)
        Picker("Size", selection: $wide) {
          Label("Phone", systemImage: "iphone").tag(false)
          Label("Page", systemImage: "macwindow").tag(true)
        }
        .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 160)
      }
      Group {
        if let table {
          ScrollView { PricingTableView(table: table).padding(20) }
        } else {
          Text(loading ? "Loading the preview…" : "Save the table to see it here.").font(.lnMeta).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
      .frame(width: wide ? nil : 320, height: 600)
      .frame(maxWidth: wide ? .infinity : nil)
      .background(dark ? Color(white: 0.07) : Color(white: 0.95))
      .clipShape(RoundedRectangle(cornerRadius: wide ? 16 : 36, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: wide ? 16 : 36, style: .continuous).strokeBorder(Theme.borderAccented, lineWidth: wide ? 1 : 4))
      .environment(\.colorScheme, dark ? .dark : .light)
      .overlay(alignment: .topTrailing) { if loading && table != nil { ProgressView().padding(12) } }
      Text("Drawn with your unsaved changes and Stripe's current prices. Buttons do nothing here.").font(.lnCaption).foregroundStyle(Theme.textMuted).multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
  }
}
