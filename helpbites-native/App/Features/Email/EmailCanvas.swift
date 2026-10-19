import SwiftUI

// The editor's canvas: the email drawn natively, block by block, close to how
// it renders (render.ts), with sample values and the project brand filled in.
// Tap a block to select it, long-press for its actions or to drag it, use the
// + handles to insert around the selection. Preview shows the exact HTML.
// While the AI writes a big edit its draft shows here, read-only.

struct EmailCanvas: View {
  @Bindable var store: EmailEditorStore
  /// "Ask AI about this": select the block and open the AI designer.
  var onAskAI: (String) -> Void = { _ in }

  var body: some View {
    let shown = store.resolvedDraft ?? store.resolved
    let settings = shown.settings
    ScrollViewReader { proxy in
      ScrollView {
        card(shown)
          .allowsHitTesting(store.draft == nil)
          .padding(.horizontal, 12)
          .padding(.vertical, 24)
          .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .background(
        // Tapping the page (not a block) shows the email's own settings.
        (Color(hexString: settings.backgroundColor) ?? Theme.elevated)
          .contentShape(Rectangle())
          .onTapGesture { if store.draft == nil { store.selectedId = nil } }
      )
      .onChange(of: store.selectedId) { _, id in
        guard let id else { return }
        withAnimation(.snappy) { proxy.scrollTo(id) }
      }
    }
  }

  private func card(_ design: EmailDesign) -> some View {
    let settings = design.settings
    let blocks = design.blocks
    let width = store.device == .phone ? min(366, settings.contentWidth) : settings.contentWidth
    return VStack(spacing: 0) {
      if blocks.isEmpty {
        VStack(spacing: 12) {
          Text("No blocks yet").font(.lnRow).foregroundStyle(Theme.textMuted)
          EmailAddBlockMenu(store: store, placement: .top(0)) { Label("Add a block", systemImage: "plus") }
            .buttonStyle(.lnSecondaryCompact)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
      }
      ForEach(Array(blocks.enumerated()), id: \.element.id) { index, block in
        EmailCanvasBlock(store: store, block: block, settings: settings, index: index, onAskAI: onAskAI)
          .dropDestination(for: String.self) { ids, _ in
            guard let id = ids.first, store.design.location(of: id) != nil else { return false }
            withAnimation(.snappy) { store.move(id, to: index) }
            return true
          }
      }
      if !blocks.isEmpty {
        EmailAddBlockMenu(store: store, placement: .top(blocks.count)) {
          Label("Add block", systemImage: "plus").font(.lnMetaMedium).foregroundStyle(Theme.textMuted)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .dropDestination(for: String.self) { ids, _ in
          guard let id = ids.first, store.design.location(of: id) != nil else { return false }
          withAnimation(.snappy) { store.move(id, to: blocks.count) }
          return true
        }
      }
    }
    .frame(maxWidth: CGFloat(width))
    .background(Color(hexString: settings.contentBackground) ?? .white, in: RoundedRectangle(cornerRadius: 8))
    .foregroundStyle(Color(hexString: settings.textColor) ?? .black)
    .fontDesign(EmailFontStack.design(settings.fontFamily))
    .environment(\.colorScheme, .light)
  }
}

/// The Add menu (EmailEditor.vue addItems): the block types that can go there,
/// then the component library and "New component…". Inside a section or column
/// it offers the built-in types only, and no containers in a column.
struct EmailAddBlockMenu<MenuLabel: View>: View {
  let store: EmailEditorStore
  var placement = EmailEditorStore.Placement.afterSelection
  var inColumns = false
  @ViewBuilder let label: () -> MenuLabel

  var body: some View {
    Menu {
      ForEach(store.addableKinds(inColumns: inColumns)) { kind in
        Button { store.add(kind, placement) } label: { Label(kind.label, systemImage: kind.systemImage) }
      }
      if store.supportsComponents, !isInside {
        Section("Components") {
          ForEach(store.library) { component in
            Button { store.add(component, placement) } label: {
              Label {
                Text(component.name)
                if !component.description.isEmpty { Text(component.description) }
              } icon: {
                Image(systemName: "puzzlepiece")
              }
            }
          }
          Button { store.componentRequest = EmailComponentRequest() } label: { Label("New component…", systemImage: "plus") }
        }
      }
    } label: {
      label()
    }
  }

  private var isInside: Bool {
    if case .inside = placement { return true }
    return false
  }
}

/// One block on the canvas, with its selection outline, actions and (at the top level) insert handles.
private struct EmailCanvasBlock: View {
  @Bindable var store: EmailEditorStore
  let block: EmailDesignBlock
  let settings: EmailDesignSettings
  /// Its index among the top-level blocks; nil inside a section or column.
  let index: Int?
  let onAskAI: (String) -> Void

  private var selected: Bool { store.selectedId == block.id }

  var body: some View {
    content
      .padding(insets)
      .frame(maxWidth: .infinity, alignment: frameAlignment)
      .background { surface }
      .contentShape(Rectangle())
      .onTapGesture { store.selectedId = block.id }
      .overlay { if selected { selection } }
      .overlay(alignment: .top) { if selected, let index { handle(at: index).offset(y: -14) } }
      .overlay(alignment: .bottom) { if selected, let index { handle(at: index + 1).offset(y: 14) } }
      .zIndex(selected ? 1 : 0)
      .contextMenu { actions }
      .modifier(EmailDraggable(id: block.id, enabled: index != nil))
      .id(block.id)
      // A container's blocks stay reachable on their own.
      .accessibilityElement(children: block.kind?.isContainer == true ? .contain : .combine)
      .accessibilityLabel("\(block.kind?.label ?? "Block"): \(block.displayName)")
      .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
  }

  // MARK: Drawing (render.ts)

  @ViewBuilder private var content: some View {
    switch block.kind {
    case .heading:
      Text(block.text)
        .font(headingFont)
        .tracking(CGFloat(block.letterSpacing ?? 0))
        .lineSpacing(2)
        .foregroundStyle(color(block.color) ?? textColor)
        .multilineTextAlignment(textAlignment)
    case .text:
      let size = CGFloat(block.fontSize ?? 15)
      Text(EmailInlineHTML.attributed(block.html))
        .font(.system(size: size))
        .lineSpacing(size * 0.45)
        .foregroundStyle(color(block.color) ?? textColor)
        .multilineTextAlignment(textAlignment)
    case .button:
      // The padding scales with the label, as render.ts does: 15px keeps 12px 24px.
      let size = CGFloat((block.fontSize ?? 0) > 0 ? block.fontSize! : 15)
      Text(block.label.isEmpty ? " " : block.label)
        .font(.system(size: size, weight: .semibold))
        .foregroundStyle(color(EmailRender.string(block.fields["color"])) ?? .white)
        .padding(.horizontal, (size * 1.6).rounded())
        .padding(.vertical, (size * 0.8).rounded())
        .background(color(block.backgroundColor) ?? Theme.accent, in: RoundedRectangle(cornerRadius: CGFloat(block.radius ?? 6)))
        .modifier(EmailSoftShadow(enabled: block.shadow != nil))
    case .image:
      image
    case .divider:
      Rectangle()
        .fill(color(block.color) ?? Color(hexString: "#e4e4e7")!)
        .frame(height: CGFloat(max(block.thickness ?? 1, 1)))
    case .spacer:
      Color.clear.frame(height: CGFloat(max(block.height, 4)))
    case .section:
      section
    case .columns:
      columns
    case .html:
      rendered("Custom HTML", systemImage: "chevron.left.forwardslash.chevron.right")
    case .component:
      rendered(block.name.isEmpty ? "Component" : block.name, systemImage: "puzzlepiece")
    case nil:
      Label("This block type isn't editable here", systemImage: "questionmark.square.dashed")
        .font(.lnMeta).foregroundStyle(Theme.textMuted)
        .frame(maxWidth: .infinity, minHeight: 44)
    }
  }

  /// The heading's own font when this device has its first family, else the system
  /// design closest to the stack (the Preview shows the real font).
  private var headingFont: Font {
    let size = CGFloat((block.fontSize ?? 0) > 0 ? block.fontSize! : [28, 22, 18][block.level - 1])
    guard let stack = block.fontFamily else { return .system(size: size, weight: .bold) }
    let family = stack.split(separator: ",").first.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " '\"")) } ?? ""
    if !family.isEmpty, EmailFontStack.hasFamily(family) { return .custom(family, size: size).weight(.bold) }
    return .system(size: size, weight: .bold, design: EmailFontStack.design(stack))
  }

  private var image: some View {
    let width = (block.width ?? 0) > 0 ? CGFloat(block.width!) : nil
    // Sized by height (a badge) when it has no width: the width follows the picture.
    let height = width == nil && (block.imageHeight ?? 0) > 0 ? CGFloat(block.imageHeight!) : nil
    return AsyncImage(url: URL(string: block.src)) { phase in
      if let image = phase.image {
        image.resizable().scaledToFit()
      } else {
        VStack(spacing: 6) {
          Image(systemName: phase.error == nil && !block.src.isEmpty ? "photo" : "photo.badge.exclamationmark").font(.system(size: 22))
          if !block.alt.isEmpty, height == nil { Text(block.alt).font(.lnCaption).lineLimit(2) }
        }
        .foregroundStyle(Color.black.opacity(0.35))
        .frame(maxWidth: height.map { $0 * 2 } ?? .infinity, minHeight: height == nil ? 120 : nil)
        .background(Color.black.opacity(0.05))
      }
    }
    .frame(maxWidth: width ?? (height == nil ? .infinity : nil))
    .frame(height: height)
    .clipShape(RoundedRectangle(cornerRadius: 4))
  }

  /// A section's blocks on its surface (drawn by `surface`), clipped to its corners.
  private var section: some View {
    let children = block.blocks
    let edges = block.padding.edges
    let clip = max(0, sectionRadius - min(edges.top, edges.right, edges.bottom, edges.left))
    return VStack(spacing: 0) {
      ForEach(children) { child in
        EmailCanvasBlock(store: store, block: child, settings: settings, index: nil, onAskAI: onAskAI)
      }
      if children.isEmpty || selected {
        addInside(column: 0)
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: CGFloat(clip)))
  }

  private var columns: some View {
    let children = block.columns
    return HStack(alignment: .top, spacing: CGFloat(block.gap ?? 16)) {
      ForEach(children.indices, id: \.self) { column in
        VStack(spacing: 0) {
          ForEach(children[column]) { child in
            EmailCanvasBlock(store: store, block: child, settings: settings, index: nil, onAskAI: onAskAI)
          }
          if children[column].isEmpty || selected {
            addInside(column: column)
          }
        }
        .frame(maxWidth: .infinity, alignment: .top)
      }
    }
  }

  /// The dashed Add at the end of a section's or a column's blocks.
  private func addInside(column: Int) -> some View {
    EmailAddBlockMenu(store: store, placement: .inside(parent: block.id, column: column), inColumns: block.kind == .columns) {
      Label("Add", systemImage: "plus").font(.lnCaption)
        .foregroundStyle(Color.black.opacity(0.45))
        .frame(maxWidth: .infinity, minHeight: 44)
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.black.opacity(0.2), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        .contentShape(Rectangle())
    }
  }

  /// Custom HTML and components can't be drawn natively: a non-interactive rendering of just this block.
  private func rendered(_ title: String, systemImage: String) -> some View {
    let doc = JSONValue.object(["settings": .object(settings.fields), "blocks": .array([block.json])])
    return SandboxedWebView(html: EmailRender.html(doc), interactive: false)
      .frame(height: 220)
      .allowsHitTesting(false)
      .overlay(alignment: .topTrailing) {
        Label(title, systemImage: systemImage)
          .font(.lnCaption).lineLimit(1).padding(.horizontal, 8).padding(.vertical, 4)
          .background(.ultraThinMaterial, in: Capsule())
          .padding(8)
      }
  }

  /// What the block sits on: its background, or a section's surface (render.ts
  /// renderSection: the colour, a gradient from it, rounded corners, a shadow).
  @ViewBuilder private var surface: some View {
    if block.kind == .section {
      let shape = RoundedRectangle(cornerRadius: CGFloat(sectionRadius))
      Group {
        if let end = color(block.gradientTo) {
          let points = gradientPoints
          shape.fill(LinearGradient(colors: [color(block.background) ?? end, end], startPoint: points.start, endPoint: points.end))
        } else {
          shape.fill(color(block.background) ?? .clear)
        }
      }
      .modifier(EmailSoftShadow(enabled: block.shadow != nil))
    } else {
      color(block.background) ?? .clear
    }
  }

  private var sectionRadius: Double { max(block.radius ?? 0, 0) }

  /// The CSS angle as unit points (180° runs top to bottom, 90° left to right),
  /// long enough that the corners get the end colours, as CSS does.
  private var gradientPoints: (start: UnitPoint, end: UnitPoint) {
    let radians = (block.gradientAngle ?? 180) * .pi / 180
    let dx = sin(radians), dy = -cos(radians)
    let half = (abs(dx) + abs(dy)) / 2
    return (UnitPoint(x: 0.5 - dx * half, y: 0.5 - dy * half), UnitPoint(x: 0.5 + dx * half, y: 0.5 + dy * half))
  }

  // MARK: Selection

  private var selection: some View {
    RoundedRectangle(cornerRadius: 2)
      .strokeBorder(Theme.accent, lineWidth: 2)
      .overlay(alignment: .topLeading) {
        Text(block.kind == .spacer ? "Spacer \(EmailRender.js(block.height))px" : block.kind?.label ?? block.type)
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(.white)
          .padding(.horizontal, 6).padding(.vertical, 2)
          .background(Theme.accent, in: RoundedRectangle(cornerRadius: 3))
          .offset(x: 4, y: 4)
      }
      .allowsHitTesting(false)
  }

  /// A + that inserts a block at a top-level position.
  private func handle(at position: Int) -> some View {
    EmailAddBlockMenu(store: store, placement: .top(position)) {
      Image(systemName: "plus")
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(.white)
        .frame(width: 28, height: 28)
        .background(Theme.accent, in: Circle())
        .overlay(Circle().strokeBorder(.white, lineWidth: 2))
        .frame(width: 44, height: 44)
        .contentShape(Circle())
    }
    .accessibilityLabel(position > (index ?? 0) ? "Add a block below" : "Add a block above")
  }

  @ViewBuilder private var actions: some View {
    Button { store.shift(block.id, by: -1) } label: { Label("Move up", systemImage: "arrow.up") }
    Button { store.shift(block.id, by: 1) } label: { Label("Move down", systemImage: "arrow.down") }
    Button { store.duplicate(block.id) } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
    Button { onAskAI(block.id) } label: { Label("Ask AI about this", systemImage: "sparkles") }
    if let parent = store.parent(of: block.id), let kind = store.design.block(parent)?.kind {
      Button { store.selectedId = parent } label: { Label("Select \(kind.label.lowercased())", systemImage: kind.systemImage) }
    }
    Divider()
    Button(role: .destructive) { store.remove(block.id) } label: { Label("Delete", systemImage: "trash") }
  }

  // MARK: Styling

  private var textColor: Color { Color(hexString: settings.textColor) ?? .black }

  private func color(_ hex: String?) -> Color? { Color(hexString: hex) }

  private var insets: EdgeInsets {
    guard block.kind != .spacer else { return EdgeInsets() }
    let e = block.padding.edges
    return EdgeInsets(top: e.top, leading: e.left, bottom: e.bottom, trailing: e.right)
  }

  private var frameAlignment: Alignment {
    guard block.kind?.aligns == true else { return .leading }
    switch block.align {
    case "center": return .center
    case "right": return .trailing
    default: return .leading
    }
  }

  private var textAlignment: TextAlignment {
    switch block.align {
    case "center": .center
    case "right": .trailing
    default: .leading
    }
  }
}

/// The one soft shadow the canvas draws for a CSS box-shadow (the Preview shows the exact one).
private struct EmailSoftShadow: ViewModifier {
  let enabled: Bool
  func body(content: Content) -> some View {
    content.shadow(color: enabled ? .black.opacity(0.14) : .clear, radius: enabled ? 10 : 0, y: enabled ? 4 : 0)
  }
}

/// Top-level blocks drag by their id onto another block's place.
private struct EmailDraggable: ViewModifier {
  let id: String
  let enabled: Bool
  func body(content: Content) -> some View {
    if enabled { content.draggable(id) } else { content }
  }
}

/// The exact email at a phone's or a desktop's width, scaled down to fit when
/// the screen is narrower than the frame.
struct EmailPreviewPane: View {
  let html: String
  let device: EmailEditorStore.Device

  var body: some View {
    GeometryReader { geometry in
      let scale = min(1, geometry.size.width / device.width)
      SandboxedWebView(html: html)
        .frame(width: device.width, height: geometry.size.height / max(scale, 0.3))
        .scaleEffect(scale, anchor: .top)
        .frame(width: geometry.size.width, height: geometry.size.height, alignment: .top)
    }
    .background(Theme.elevated)
  }
}
