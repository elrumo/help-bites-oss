import SwiftUI

/// Settings › Tab bar: which shortcuts sit along the bottom of the app and in what order. The choice stays on
/// this device. Settings is always on the bar, so this screen can always be found again.
struct TabBarScreen: View {
  @Environment(Workspace.self) private var workspace

  private var bar: [TabShortcut] { workspace.shortcuts }
  private var others: [TabShortcut] { TabShortcut.allCases.filter { !bar.contains($0) } }
  private var full: Bool { bar.count >= TabShortcut.limit }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Text("Choose the shortcuts for the tab bar and put them in the order you like. It holds five, and Settings always stays so you can come back here.")
          .font(.lnMeta).foregroundStyle(Theme.textMuted)

        VStack(alignment: .leading, spacing: 8) {
          SectionLabel("In the tab bar")
          Card {
            ForEach(Array(bar.enumerated()), id: \.element) { index, item in
              CardRow(divider: index < bar.count - 1) {
                HStack(spacing: 10) {
                  icon(item)
                  Text(item.localizedLabel).font(.lnRow).foregroundStyle(Theme.text)
                  Spacer(minLength: 8)
                  IconButton(systemImage: "arrow.up", label: "Move up") { move(item, by: -1) }.disabled(index == 0).opacity(index == 0 ? 0.35 : 1)
                  IconButton(systemImage: "arrow.down", label: "Move down") { move(item, by: 1) }.disabled(index >= bar.count - 1).opacity(index >= bar.count - 1 ? 0.35 : 1)
                  if item.isRequired {
                    Image(systemName: "lock").font(.system(size: 13)).foregroundStyle(Theme.textDimmed).frame(width: 32, height: 32).accessibilityLabel("Always on the bar")
                  } else {
                    IconButton(systemImage: "minus.circle", label: "Remove \(item.localizedLabel)") { remove(item) }
                  }
                }
              }
            }
          }
        }

        if !others.isEmpty {
          VStack(alignment: .leading, spacing: 8) {
            SectionLabel("More shortcuts")
            Card {
              ForEach(Array(others.enumerated()), id: \.element) { index, item in
                CardRow(divider: index < others.count - 1) {
                  HStack(spacing: 10) {
                    icon(item)
                    Text(item.localizedLabel).font(.lnRow).foregroundStyle(Theme.text)
                    Spacer(minLength: 8)
                    IconButton(systemImage: "plus.circle", label: "Add \(item.localizedLabel)") { add(item) }.disabled(full).opacity(full ? 0.35 : 1)
                  }
                }
              }
            }
            if full { Text("The bar is full. Take one off to add another.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
          }
        }

        Button("Reset to default") { withAnimation { workspace.resetShortcuts() } }
          .buttonStyle(.lnSecondary)
          .disabled(bar == TabShortcut.defaults)
      }
      .frame(maxWidth: 560, alignment: .leading)
      .padding(24)
      .frame(maxWidth: .infinity)
    }
    .panelScreen("Tab bar")
  }

  private func icon(_ item: TabShortcut) -> some View {
    Image(systemName: item.systemImage).font(.system(size: 14)).foregroundStyle(Theme.textMuted).frame(width: 20)
  }

  private func move(_ item: TabShortcut, by offset: Int) {
    var list = bar
    guard let index = list.firstIndex(of: item) else { return }
    list.move(index, by: offset)
    withAnimation { workspace.setShortcuts(list) }
  }

  private func remove(_ item: TabShortcut) {
    withAnimation { workspace.setShortcuts(bar.filter { $0 != item }) }
  }

  private func add(_ item: TabShortcut) {
    guard !full else { return }
    withAnimation { workspace.setShortcuts(bar + [item]) }
  }
}
