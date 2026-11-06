import SwiftUI

/// What the entry editor changes and saves together.
struct PageDraft: Equatable {
  var name: String
  var slug: String
  var style: CmsStyle
  var content: CmsBlock

  init?(_ entry: CmsEntry) {
    guard let content = entry.content else { return nil }
    name = entry.name
    slug = entry.slug
    style = entry.style ?? CmsStyle()
    self.content = content
  }
}

/// The editor's form (web: CmsInspector.vue). With a block selected: its fields and animation.
/// With the page selected: its name and slug, the root component's own fields, and the page style.
struct PageInspector: View {
  @Binding var draft: PageDraft
  /// The selected block's `_uid`; nil (or the root's) is the page itself.
  let selection: String?
  let library: CmsLibrary
  let projectId: String
  let projectAccent: String?
  /// The page's public address, shown under the slug.
  let address: String

  private var block: CmsBlock? {
    guard let selection, selection != draft.content.uid else { return nil }
    return draft.content.find(selection, library)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      if let block { blockForm(block) } else { pageForm }
    }
    // Number fields keep what is being typed; a new selection starts them over.
    .id(block?.uid ?? draft.content.uid)
  }

  private func setValue(_ id: String, _ key: String, _ value: JSONValue?) {
    draft.content.edit(id, library) { block in
      if let value { block.values[key] = value } else { block.values.removeValue(forKey: key) }
    }
  }

  // MARK: Block

  @ViewBuilder private func blockForm(_ block: CmsBlock) -> some View {
    let def = library[block.component]
    VStack(alignment: .leading, spacing: 2) {
      Text(def?.name ?? String(localized: "Missing component")).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
      Text("\(block.component) · \(block.uid)").font(.lnMono).foregroundStyle(Theme.textDimmed)
      if let description = def?.description, !description.isEmpty { Text(description).font(.lnCaption).foregroundStyle(Theme.textMuted).padding(.top, 2) }
    }
    VStack(alignment: .leading, spacing: 2) {
      Toggle("Hide from the page", isOn: Binding(get: { block.isHidden }, set: { setValue(block.uid, "_hidden", $0 ? .bool(true) : nil) })).toggleStyle(.switch).tint(Theme.accent).font(.lnRow)
      if block.isHidden { Text("Kept here, left off the page and the delivery API.").font(.lnCaption).foregroundStyle(Theme.warning) }
    }
    if let def {
      ForEach(def.fields.filter { $0.kind != .blocks }) { field in
        PageFieldInput(field: field, value: block.values[field.key], projectId: projectId) { setValue(block.uid, field.key, $0) }
      }
      ForEach(def.blocksFields) { field in
        let count = block.children(field.key).count
        Label("\(field.label): \(count) \(count == 1 ? String(localized: "block") : String(localized: "blocks")), edited in the outline", systemImage: "square.3.layers.3d").font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
    } else {
      Text("This block's component no longer exists. Its data is kept, and it shows as nothing on the page.").font(.lnMeta).foregroundStyle(Theme.warning)
    }
    animation(block)
  }

  private func animation(_ block: CmsBlock) -> some View {
    let current = block.animation
    func change(_ edit: (inout CmsAnimation) -> Void) {
      var next = current ?? CmsAnimation()
      edit(&next)
      // Parallax only makes sense tied to the scroll.
      if next.effect == "parallax" { next.trigger = "scroll" }
      setValue(block.uid, "_anim", next.json)
    }
    return LegalPanel("Animation") {
      LabeledField(label: "Effect") {
        Picker("Effect", selection: Binding(
          get: { current?.effect ?? "none" },
          set: { effect in if effect == "none" { setValue(block.uid, "_anim", nil) } else { change { $0.effect = effect } } }
        )) {
          Text("None").tag("none")
          ForEach(CmsAnimation.effects, id: \.id) { Text(LocalizedStringKey($0.label)).tag($0.id) }
        }
        .labelsHidden().fixedSize()
      }
      if let current {
        LabeledField(label: "When") {
          Picker("When", selection: Binding(get: { current.trigger }, set: { trigger in change { $0.trigger = trigger } })) {
            ForEach(CmsAnimation.triggers, id: \.id) { Text(LocalizedStringKey($0.label)).tag($0.id) }
          }
          .labelsHidden().fixedSize().disabled(current.effect == "parallax")
        }
        LabeledField(label: "Easing") {
          Picker("Easing", selection: Binding(get: { current.easing }, set: { easing in change { $0.easing = easing } })) {
            ForEach(CmsAnimation.easings, id: \.id) { Text(LocalizedStringKey($0.label)).tag($0.id) }
          }
          .labelsHidden().fixedSize()
        }
        Stepper("Duration: \(current.duration) ms", value: Binding(get: { current.duration }, set: { value in change { $0.duration = value } }), in: 100...4000, step: 50).font(.lnRow)
        Stepper("Delay: \(current.delay) ms", value: Binding(get: { current.delay }, set: { value in change { $0.delay = value } }), in: 0...4000, step: 50).font(.lnRow)
        Stepper("Distance: \(current.distance) px", value: Binding(get: { current.distance }, set: { value in change { $0.distance = value } }), in: 0...400, step: 4).font(.lnRow)
        VStack(alignment: .leading, spacing: 2) {
          Stepper("Stagger: \(current.stagger) ms", value: Binding(get: { current.stagger }, set: { value in change { $0.stagger = value } }), in: 0...1000, step: 20).font(.lnRow)
          Text("Animates the children one after another.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
        if current.trigger == "in-view" {
          Toggle("Only the first time", isOn: Binding(get: { current.once }, set: { value in change { $0.once = value } })).toggleStyle(.switch).tint(Theme.accent).font(.lnRow)
        }
      }
    }
  }

  // MARK: Page

  @ViewBuilder private var pageForm: some View {
    let root = library[draft.content.component]
    VStack(alignment: .leading, spacing: 2) {
      Text(root?.name ?? String(localized: "Page")).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
      Text("The page's own settings. Choose a block in the outline to edit it.").font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
    LabeledField(label: "Name") {
      TextField("", text: $draft.name).textFieldStyle(.linear)
        .onChange(of: draft.name) { _, value in draft.name = value.clipped(to: CmsLimits.name) }
    }
    LabeledField(label: "Slug", hint: slugOK ? address : nil) {
      TextField("home", text: $draft.slug).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
    }
    if !slugOK { Label(CmsLimits.slugRule, systemImage: "exclamationmark.circle").font(.lnCaption).foregroundStyle(Theme.error) }
    if let root {
      ForEach(root.fields.filter { $0.kind != .blocks }) { field in
        PageFieldInput(field: field, value: draft.content.values[field.key], projectId: projectId) { setValue(draft.content.uid, field.key, $0) }
      }
    }
    style
  }

  private var slugOK: Bool { CmsLimits.validSlug(draft.slug.trimmingCharacters(in: .whitespaces).lowercased()) }

  private var style: some View {
    LegalPanel("Style") {
      OptionalColorField(label: "Accent", hex: $draft.style.accent, fallback: Color(hexString: projectAccent) ?? Theme.accent, empty: "The project's accent")
      LabeledField(label: "Colour scheme") {
        Picker("Colour scheme", selection: $draft.style.mode) { ForEach(CmsOptions.modes, id: \.id) { Text(LocalizedStringKey($0.label)).tag($0.id) } }.labelsHidden().fixedSize()
      }
      LabeledField(label: "Corners") {
        Picker("Corners", selection: $draft.style.radius) { ForEach(BrandOptions.radii, id: \.id) { Text(LocalizedStringKey($0.label)).tag($0.id) } }.pickerStyle(.segmented).labelsHidden()
      }
      LabeledField(label: "Width") {
        Picker("Width", selection: $draft.style.width) { ForEach(CmsOptions.widths, id: \.id) { Text(LocalizedStringKey($0.label)).tag($0.id) } }.pickerStyle(.segmented).labelsHidden()
      }
      fontField("Heading font", $draft.style.headingFont, hint: "Any Google Fonts family, or a font Apple and Windows devices have (Avenir, Helvetica).")
      fontField("Body font", $draft.style.bodyFont, hint: nil)
    }
  }

  private func fontField(_ label: String, _ font: Binding<String>, hint: String?) -> some View {
    LabeledField(label: label, hint: hint) {
      HStack(spacing: 8) {
        TextField("System font", text: font).textFieldStyle(.linear).textInputAutocapitalization(.never).autocorrectionDisabled()
        Menu {
          Button("System font") { font.wrappedValue = "" }
          Divider()
          ForEach(CmsOptions.fonts, id: \.self) { name in Button(name) { font.wrappedValue = name } }
        } label: {
          Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 32, height: 32).contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .accessibilityLabel("Suggested fonts")
      }
    }
  }
}
