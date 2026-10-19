import SwiftUI

/// Every block in order (EmailLayers.vue): tap to select, Edit to drag rows
/// into a new order or delete them. Sections and columns list their blocks
/// inside their row, to any depth; those are selectable here and move with the
/// inspector's arrows.
struct EmailLayersPanel: View {
  @Bindable var store: EmailEditorStore
  @State private var editing = false

  var body: some View {
    let blocks = store.design.blocks
    VStack(spacing: 0) {
      HStack {
        Text("Layers · \(blocks.count)").font(.lnMetaMedium).foregroundStyle(Theme.textMuted)
        Spacer()
        if !blocks.isEmpty {
          Button(editing ? "Done" : "Edit") {
            withAnimation { editing.toggle() }
          }
          .buttonStyle(.lnGhost)
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      if blocks.isEmpty {
        Text("No blocks yet. Use Add in the toolbar.")
          .font(.lnMeta).foregroundStyle(Theme.textMuted)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        List {
          ForEach(blocks) { block in
            row(block)
              .listRowBackground(store.selectedId == block.id ? Theme.accent.opacity(0.12) : Color.clear)
          }
          .onMove { from, to in
            guard let first = from.first else { return }
            // List reports the gap it was dropped in; moveBlock wants the final index.
            store.move(blocks[first].id, to: to > first ? to - 1 : to)
          }
          .onDelete { offsets in
            for id in offsets.map({ blocks[$0].id }) { store.remove(id) }
          }
        }
        .listStyle(.plain)
        #if os(iOS)
        .environment(\.editMode, .constant(editing ? .active : .inactive))
        #endif
      }
    }
  }

  private func row(_ block: EmailDesignBlock) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      EmailLayerRow(store: store, block: block, indent: 0)
      EmailLayerChildren(store: store, block: block, indent: 28)
    }
  }
}

/// A section's or a columns block's blocks, indented under it (EmailLayerChildren.vue), to any depth.
private struct EmailLayerChildren: View {
  let store: EmailEditorStore
  let block: EmailDesignBlock
  let indent: CGFloat

  var body: some View {
    let lists = block.children
    ForEach(Array(lists.enumerated()), id: \.offset) { column, children in
      if block.kind == .columns {
        Text("Column \(column + 1)").font(.lnCaption).foregroundStyle(Theme.textDimmed).padding(.leading, indent).padding(.top, 2)
      } else if children.isEmpty {
        Text("Empty").font(.lnCaption).foregroundStyle(Theme.textDimmed).padding(.leading, indent).padding(.vertical, 2)
      }
      ForEach(children) { child in
        EmailLayerRow(store: store, block: child, indent: indent)
        EmailLayerChildren(store: store, block: child, indent: indent + 20)
      }
    }
  }
}

/// One block's row: tap to select it.
private struct EmailLayerRow: View {
  let store: EmailEditorStore
  let block: EmailDesignBlock
  let indent: CGFloat

  var body: some View {
    Button { store.selectedId = block.id } label: {
      HStack(spacing: 10) {
        Image(systemName: block.kind?.systemImage ?? "questionmark.square.dashed")
          .font(.system(size: 13)).foregroundStyle(Theme.textMuted).frame(width: 18)
        Text(block.displayName).font(.lnCallout).foregroundStyle(Theme.text).lineLimit(1)
        Spacer(minLength: 0)
        if store.selectedId == block.id {
          Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.accentText)
        }
      }
      .padding(.leading, indent)
      .frame(minHeight: 36)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(store.selectedId == block.id ? .isSelected : [])
  }
}
