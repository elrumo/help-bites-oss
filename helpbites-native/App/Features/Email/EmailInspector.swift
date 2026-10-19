import SwiftUI

/// The selected block's settings (EmailInspector.vue's block branch): what it
/// says, how it looks and where it sits. Every control writes straight to the
/// store, which records undo steps and autosaves.
struct EmailBlockInspector: View {
  @Bindable var store: EmailEditorStore
  let blockId: String

  var body: some View {
    ScrollView {
      Group {
        if let block = store.design.block(blockId) {
          VStack(alignment: .leading, spacing: 20) {
            header(block)
            actions
            // Custom HTML and sections can become a library component (operators: the library answered).
            if store.supportsComponents, block.kind == .html || block.kind == .section {
              Button { store.saveAsComponent(blockId) } label: {
                Label("Save as component", systemImage: "puzzlepiece").frame(maxWidth: .infinity)
              }
              .buttonStyle(.lnSecondary)
            }
            if let kind = block.kind {
              fields(kind, block)
              if kind != .spacer { InspectorRule() }
              shared(kind)
            } else {
              Text("This block type isn't editable here.")
                .font(.lnMeta)
                .foregroundStyle(Theme.textMuted)
            }
          }
          // A different block starts with fresh fields (half-typed text, the padding sides, uploads).
          .id(blockId)
        } else {
          Text("This block is no longer in the email.")
            .font(.lnMeta)
            .foregroundStyle(Theme.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      .padding(16)
    }
    .scrollDismissesKeyboard(.interactively)
  }

  // MARK: Header and actions

  private func header(_ block: EmailDesignBlock) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 10) {
        Image(systemName: block.kind?.systemImage ?? "square.dashed")
          .font(.system(size: 14, weight: .semibold))
          .foregroundStyle(Theme.accentText)
          .frame(width: 30, height: 30)
          .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radiusSmall))
        Text(block.kind == .component ? block.displayName : block.kind?.label ?? block.type.capitalized)
          .font(.lnHeading)
          .foregroundStyle(Theme.textHighlighted)
          .lineLimit(1)
        Spacer(minLength: 0)
      }
      if case .column(let parentId, let column, _)? = store.design.location(of: blockId), let parent = store.design.block(parentId) {
        Button { store.selectedId = parentId } label: {
          HStack(spacing: 6) {
            Image(systemName: parent.kind?.systemImage ?? "square.dashed").font(.system(size: 11, weight: .semibold))
            Text(parent.kind == .columns ? "In column \(column + 1)" : "In \(parent.displayName.lowercased())")
            Text("·")
            Text("Select parent").foregroundStyle(Theme.accentText)
          }
          .font(.lnMetaMedium)
          .foregroundStyle(Theme.textMuted)
          .frame(minHeight: 36)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
      }
    }
  }

  private var actions: some View {
    HStack(spacing: 8) {
      actionButton("Move up", systemImage: "arrow.up", enabled: canShift(-1)) { store.shift(blockId, by: -1) }
      actionButton("Move down", systemImage: "arrow.down", enabled: canShift(1)) { store.shift(blockId, by: 1) }
      actionButton("Duplicate", systemImage: "plus.square.on.square") { store.duplicate(blockId) }
      // No confirmation: Undo brings it back.
      actionButton("Delete", systemImage: "trash", tint: Theme.error) { store.remove(blockId) }
    }
  }

  private func actionButton(_ title: String, systemImage: String, tint: Color = Theme.textToned, enabled: Bool = true, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      VStack(spacing: 4) {
        Image(systemName: systemImage).font(.system(size: 15, weight: .medium))
        Text(title).font(.lnCaptionMedium).lineLimit(1).minimumScaleFactor(0.75)
      }
      .foregroundStyle(tint)
      .frame(maxWidth: .infinity, minHeight: 52)
      .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
      .contentShape(RoundedRectangle(cornerRadius: Metrics.radius))
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .opacity(enabled ? 1 : 0.4)
  }

  /// Whether the block can move one place that way within its own list (the email's, a section's or a column's).
  private func canShift(_ offset: Int) -> Bool {
    switch store.design.location(of: blockId) {
    case .top(let index)?:
      return store.design.blocks.indices.contains(index + offset)
    case .column(let parent, let column, let index)?:
      guard let lists = store.design.block(parent)?.children, lists.indices.contains(column) else { return false }
      return lists[column].indices.contains(index + offset)
    case nil:
      return false
    }
  }

  // MARK: Per type

  @ViewBuilder
  private func fields(_ kind: EmailBlockKind, _ block: EmailDesignBlock) -> some View {
    switch kind {
    case .heading: headingFields(block)
    case .text: textFields
    case .button: buttonFields
    case .image: imageFields
    case .divider: dividerFields
    case .spacer: spacerFields
    case .columns: columnsFields(block)
    case .html: htmlFields
    case .section: sectionFields(block)
    case .component: componentFields(block)
    }
  }

  private func headingFields(_ block: EmailDesignBlock) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      LabeledField(label: "Text") {
        LinearTextEditor(text: bind(\.text, ""), minHeight: 64)
      }
      LabeledField(label: "Level") {
        EmailSegmentedPicker(selection: bind(\.level, 2), options: [1, 2, 3], title: { "H\($0)" })
      }
      LabeledField(label: "Colour") {
        EmailColorField(label: "Colour", color: bind(\.color, nil), clearable: true)
      }
      LabeledField(label: "Font size (px)") {
        EmailNumberField(label: "Font size", value: bind(\.fontSize, nil), placeholder: EmailRender.js(Double([28, 22, 18][block.level - 1])), range: 8...200)
      }
      LabeledField(label: "Letter spacing (px)") {
        EmailNumberField(label: "Letter spacing", value: zeroIsUnset(\.letterSpacing), placeholder: "0", range: -20...50, step: 0.1)
      }
      LabeledField(label: "Font") {
        headingFontMenu(block.fontFamily)
      }
    }
  }

  /// The email's font, a stack from the theme designer's list, or the heading's
  /// own (a converted email's, say SF Pro Display), which stays on the list.
  private func headingFontMenu(_ current: String?) -> some View {
    let own = current.flatMap { value in EmailFontStack.all.contains { $0.value == value } ? nil : value }
    let familyName = { (stack: String) in
      (stack.split(separator: ",").first.map(String.init) ?? stack).replacingOccurrences(of: "'", with: "").replacingOccurrences(of: "\"", with: "").trimmingCharacters(in: .whitespaces)
    }
    let name = current.map { value in EmailFontStack.all.first { $0.value == value }?.label ?? familyName(value) } ?? "Email font"
    return Menu {
      Picker("Font", selection: Binding<String>(
        get: { store.design.block(blockId)?.fontFamily ?? "" },
        set: { value in store.editBlock(blockId) { $0.fontFamily = value.isEmpty ? nil : value } }
      )) {
        Text("Email font").tag("")
        ForEach(EmailFontStack.all) { stack in Text(stack.label).tag(stack.value) }
        if let own { Text(familyName(own)).tag(own) }
      }
      .pickerStyle(.inline)
    } label: {
      InboxFieldBox {
        Text(name).fontDesign(EmailFontStack.design(current ?? store.design.settings.fontFamily))
      }
    }
  }

  private var textFields: some View {
    VStack(alignment: .leading, spacing: 16) {
      LabeledField(label: "Content", hint: "Inline HTML: b, i, u, br, a and span; links and spans keep a colour, weight and decoration in style=\"\".") {
        EmailRichTextField(html: bind(\.html, ""), variables: store.detectedVariables.map(\.key))
      }
      LabeledField(label: "Font size (px)") {
        EmailNumberField(label: "Font size", value: bind(\.fontSize, nil), placeholder: "15", range: 8...200)
      }
      LabeledField(label: "Colour") {
        EmailColorField(label: "Colour", color: bind(\.color, nil), clearable: true)
      }
    }
  }

  private var buttonFields: some View {
    VStack(alignment: .leading, spacing: 16) {
      LabeledField(label: "Label") {
        TextField("Click me", text: bind(\.label, "")).textFieldStyle(.linear)
      }
      LabeledField(label: "Link") {
        urlField(bind(\.href, ""))
      }
      LabeledField(label: "Fill colour") {
        EmailColorField(label: "Fill colour", color: bind(\.backgroundColor, ""))
      }
      LabeledField(label: "Label colour") {
        EmailColorField(label: "Label colour", color: bind(\.color, nil))
      }
      LabeledField(label: "Corner radius (px)") {
        EmailNumberField(label: "Corner radius", value: bind(\.radius, nil), placeholder: "6", range: 0...999)
      }
      LabeledField(label: "Font size (px)", hint: "The padding scales with it.") {
        EmailNumberField(label: "Font size", value: bind(\.fontSize, nil), placeholder: "15", range: 8...100)
      }
      LabeledField(label: "Shadow", hint: "CSS box-shadow; Outlook leaves it out.") {
        EmailShadowField(shadow: bind(\.shadow, nil))
      }
    }
  }

  private var imageFields: some View {
    VStack(alignment: .leading, spacing: 16) {
      LabeledField(label: "Image URL", hint: "Paste a hosted image URL, or upload one.") {
        EmailImageSourceField(store: store, blockId: blockId, src: bind(\.src, ""))
      }
      LabeledField(label: "Alt text", hint: "Read aloud by screen readers and shown when images are off.") {
        TextField("", text: bind(\.alt, "")).textFieldStyle(.linear)
      }
      LabeledField(label: "Link (optional)") {
        urlField(bind(\.href, ""))
      }
      LabeledField(label: "Width (px)", hint: "0 fills the width.") {
        EmailNumberField(label: "Width", value: bind(\.width, nil), placeholder: "0", range: 0...2000)
      }
      LabeledField(label: "Height (px)", hint: "With no width: a badge.") {
        EmailNumberField(label: "Height", value: zeroIsUnset(\.imageHeight), placeholder: "0", range: 0...2000)
      }
    }
  }

  private var dividerFields: some View {
    let color: Binding<String?> = bind(\.color, nil)
    // The web shows the divider's default grey when none is set.
    let shown = Binding<String?>(get: { color.wrappedValue ?? "#e4e4e7" }, set: { color.wrappedValue = $0 })
    return VStack(alignment: .leading, spacing: 16) {
      LabeledField(label: "Colour") {
        EmailColorField(label: "Colour", color: shown)
      }
      LabeledField(label: "Thickness (px)") {
        EmailNumberField(label: "Thickness", value: bind(\.thickness, nil), placeholder: "1", range: 1...100)
      }
    }
  }

  private var spacerFields: some View {
    LabeledField(label: "Height (px)") {
      EmailNumberField(label: "Height", value: bind(\.height, 0), placeholder: "0", range: 0...1000)
    }
  }

  private func columnsFields(_ block: EmailDesignBlock) -> some View {
    let columns = block.columns
    let countLabel: String = columns.count == 1 ? "1 column" : "\(columns.count) columns"
    let count = Binding<Int>(
      get: { max(1, store.design.block(blockId)?.columns.count ?? 1) },
      set: { store.setColumnCount(blockId, $0) }
    )
    return VStack(alignment: .leading, spacing: 16) {
      LabeledField(label: "Columns") {
        Stepper(value: count, in: 1...4) {
          Text(countLabel)
            .font(.lnBody)
            .foregroundStyle(Theme.text)
        }
        .frame(minHeight: 44)
      }
      LabeledField(label: "Gap (px)") {
        EmailNumberField(label: "Gap", value: bind(\.gap, nil), placeholder: "16", range: 0...200)
      }
      ForEach(0..<columns.count, id: \.self) { column in
        childList("Column \(column + 1)", column: column, children: columns[column])
      }
    }
  }

  private func sectionFields(_ block: EmailDesignBlock) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Blocks on one surface: a card, a coloured band, a callout. Its background is set below; padding sits inside it.")
        .font(.lnCaption)
        .foregroundStyle(Theme.textMuted)
        .fixedSize(horizontal: false, vertical: true)
      LabeledField(label: "Gradient to") {
        EmailColorField(label: "Gradient to", color: bind(\.gradientTo, nil), clearable: true, placeholder: "None")
      }
      LabeledField(label: "Angle (°)") {
        EmailNumberField(label: "Gradient angle", value: bind(\.gradientAngle, nil), placeholder: "180", range: 0...360)
          .disabled(block.gradientTo == nil)
          .opacity(block.gradientTo == nil ? 0.5 : 1)
      }
      LabeledField(label: "Corner radius (px)") {
        EmailNumberField(label: "Corner radius", value: zeroIsUnset(\.radius), placeholder: "0", range: 0...999)
      }
      LabeledField(label: "Shadow", hint: "CSS box-shadow; Outlook leaves it out.") {
        EmailShadowField(shadow: bind(\.shadow, nil))
      }
      childList("Blocks", column: 0, children: block.blocks)
    }
  }

  /// A section's or a column's blocks: tap one to select it, Add puts a built-in
  /// type at the end (no sections or columns inside a column).
  private func childList(_ title: String, column: Int, children: [EmailDesignBlock]) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionLabel(title)
      Card {
        if children.isEmpty {
          CardRow(divider: false) {
            Text("Empty").font(.lnMeta).foregroundStyle(Theme.textDimmed).frame(minHeight: 22)
          }
        } else {
          ForEach(children) { child in
            CardRow(divider: child.id != children.last?.id) {
              childRow(child)
            }
          }
        }
      }
      EmailAddBlockMenu(store: store, placement: .inside(parent: blockId, column: column), inColumns: store.design.block(blockId)?.kind == .columns) {
        Label(title == "Blocks" ? "Add" : "Add to \(title.lowercased())", systemImage: "plus")
          .font(.lnMetaMedium)
          .foregroundStyle(Theme.text)
          .padding(.horizontal, 14)
          .frame(minHeight: 40)
          .overlay(Capsule().strokeBorder(Theme.border))
          .contentShape(Capsule())
      }
    }
  }

  private func childRow(_ child: EmailDesignBlock) -> some View {
    Button { store.selectedId = child.id } label: {
      HStack(spacing: 10) {
        Image(systemName: child.kind?.systemImage ?? "square.dashed")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(Theme.textMuted)
          .frame(width: 18)
        Text(child.displayName)
          .font(.lnRow)
          .foregroundStyle(Theme.text)
          .lineLimit(1)
        Spacer(minLength: 0)
        Image(systemName: "chevron.right")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(Theme.textDimmed)
      }
      .frame(minHeight: 22)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  // MARK: Components

  /// A library component's copy: its fields as Content and Style, and what can be
  /// done with it (update from the library, edit the library's, reset, detach).
  private func componentFields(_ block: EmailDesignBlock) -> some View {
    let fields = block.componentFields
    let newer = store.library.first { $0.id == block.componentId }.flatMap { $0.isNewer(than: block) ? $0 : nil }
    return VStack(alignment: .leading, spacing: 16) {
      Text("A copy of “\(block.name)” from the component library. What you change here stays in this email.")
        .font(.lnCaption)
        .foregroundStyle(Theme.textMuted)
        .fixedSize(horizontal: false, vertical: true)
      if let newer {
        HStack(spacing: 10) {
          Label("The library has a newer version", systemImage: "arrow.triangle.2.circlepath")
            .font(.lnMetaMedium)
            .foregroundStyle(Theme.accentText)
          Spacer(minLength: 0)
          Button("Update") { store.editBlock(blockId) { newer.refresh(&$0) } }
            .buttonStyle(.lnPrimaryCompact)
        }
        .padding(12)
        .background(Theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: Metrics.radius))
      }
      if fields.isEmpty {
        Text("It has no fields. Edit the component to add some, or detach it to edit its HTML here.")
          .font(.lnCaption)
          .foregroundStyle(Theme.textMuted)
          .fixedSize(horizontal: false, vertical: true)
      }
      ForEach(EmailComponentField.Group.allCases) { group in
        let members = fields.filter { $0.group == group }
        if !members.isEmpty {
          VStack(alignment: .leading, spacing: 14) {
            SectionLabel(group.label)
            ForEach(members) { field in
              LabeledField(label: field.label) { componentField(field) }
            }
          }
        }
      }
      FlowLayout(spacing: 8) {
        if store.supportsComponents {
          Button { store.editComponent(blockId) } label: { Label("Edit component", systemImage: "pencil") }
            .buttonStyle(.lnSecondaryCompact)
        }
        Button { store.editBlock(blockId) { $0.values = [:] } } label: { Label("Reset", systemImage: "arrow.counterclockwise") }
          .buttonStyle(.lnSecondaryCompact)
        Button { store.replace(blockId, with: [block.detached]) } label: { Label("Detach to HTML", systemImage: "chevron.left.forwardslash.chevron.right") }
          .buttonStyle(.lnSecondaryCompact)
      }
    }
  }

  /// One field's control, by its type. Typing sets this email's value; clearing a
  /// colour or a number goes back to the field's default.
  @ViewBuilder
  private func componentField(_ field: EmailComponentField) -> some View {
    let value = componentValue(field)
    let text = Binding<String>(get: { value.wrappedValue ?? "" }, set: { value.wrappedValue = $0 })
    switch field.type {
    case .color:
      EmailColorField(
        label: field.label,
        color: Binding<String?>(get: { (value.wrappedValue ?? "").isEmpty ? nil : value.wrappedValue }, set: { value.wrappedValue = $0 }),
        clearable: true,
        placeholder: field.defaultValue.isEmpty ? "None" : field.defaultValue
      )
    case .number:
      EmailNumberField(
        label: field.label,
        value: Binding<Double?>(
          get: { EmailNumberField.parse(value.wrappedValue ?? "") },
          set: { value.wrappedValue = $0.map { EmailRender.js($0) } }
        ),
        placeholder: "0",
        range: -9999...9999
      )
    case .richtext:
      LinearTextEditor(text: text, minHeight: 72)
    case .url:
      urlField(text)
    case .image:
      EmailImageSourceField(store: store, blockId: blockId, src: text, field: field.key)
    case .text:
      TextField(field.defaultValue, text: text).textFieldStyle(.linear)
    }
  }

  /// A field's value in this instance (its own, else the default); setting merges
  /// it into the instance's values, and nil goes back to the default.
  private func componentValue(_ field: EmailComponentField) -> Binding<String?> {
    Binding(
      get: { [store, blockId] in
        store.design.block(blockId).map { EmailRender.componentValue(EmailRender.object(field.json), EmailRender.object($0.fields["values"])) }
      },
      set: { [store, blockId] value in store.editBlock(blockId) { $0.setComponentValue(field.key, value) } }
    )
  }

  private var htmlFields: some View {
    LabeledField(label: "Raw HTML", hint: "Keep it email-safe (tables + inline styles).") {
      LinearTextEditor(text: bind(\.html, ""), minHeight: 220, monospaced: true)
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
    }
  }

  // MARK: Shared

  /// Alignment where the block has one; padding and background for all but spacers.
  @ViewBuilder
  private func shared(_ kind: EmailBlockKind) -> some View {
    if kind.aligns {
      LabeledField(label: "Alignment") {
        EmailAlignPicker(align: bind(\.align, "left"))
      }
    }
    if kind != .spacer {
      LabeledField(label: "Padding (px)") {
        EmailPaddingField(padding: bind(\.padding, EmailPadding.none))
      }
      LabeledField(label: "Background") {
        EmailColorField(label: "Background", color: bind(\.background, nil), clearable: true, placeholder: "None")
      }
    }
  }

  // MARK: Helpers

  private func bind<Value>(_ field: WritableKeyPath<EmailDesignBlock, Value>, _ fallback: Value) -> Binding<Value> {
    store.binding(blockId, field, default: fallback)
  }

  /// A number where 0 means unset (the web's `value || undefined`): 0 removes it.
  private func zeroIsUnset(_ field: WritableKeyPath<EmailDesignBlock, Double?>) -> Binding<Double?> {
    let value = bind(field, nil)
    return Binding(get: { value.wrappedValue }, set: { value.wrappedValue = $0 == 0 ? nil : $0 })
  }

  private func urlField(_ text: Binding<String>) -> some View {
    TextField("https://", text: text)
      .textFieldStyle(.linear)
      .keyboardType(.URL)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
  }
}

/// The hairline between a block's own fields and the shared ones.
private struct InspectorRule: View {
  var body: some View {
    Rectangle().fill(Theme.border).frame(height: 1)
  }
}
