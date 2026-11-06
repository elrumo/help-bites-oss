import SwiftUI

/// The first page of a project's settings, laid out like Apple's Settings: who the project is, then groups of
/// pages that each open their own screen. While something is typed in the search field, its results take the
/// groups' place and open the page scrolled to the setting.
struct ProjectSettingsHub<Destination: View>: View {
  let projectId: String
  let name: String
  let siteUrl: String
  let accent: String
  let iconUrl: String
  let query: String
  let canManage: Bool
  /// What `keys` does: it opens the project's Install & API section instead of a page of its own.
  let openKeys: () -> Void
  /// The screen a page opens (and, from a search result, the setting it scrolls to).
  @ViewBuilder let destination: (ProjectSettingsPage, String?) -> Destination

  private var searching: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  private var host: String { URL(string: siteUrl)?.host ?? siteUrl }

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      if searching {
        results
      } else {
        identity
        ForEach(ProjectSettingsGroup.allCases) { group in groupCard(group) }
      }
    }
  }

  // MARK: Pages

  private var identity: some View {
    HStack(spacing: 14) {
      ProjectTile(id: projectId, name: name, accent: accent, icon: iconUrl, size: 48)
      VStack(alignment: .leading, spacing: 2) {
        Text(name).font(.lnHeading).foregroundStyle(Theme.textHighlighted).lineLimit(1)
        Text(host.isEmpty ? String(localized: "No site URL") : host).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private func groupCard(_ group: ProjectSettingsGroup) -> some View {
    let pages = ProjectSettingsPage.allCases.filter { $0.group == group && ($0 != .data || canManage) }
    if !pages.isEmpty {
      VStack(alignment: .leading, spacing: 8) {
        SectionLabel(LocalizedStringKey(group.title))
        Card {
          ForEach(Array(pages.enumerated()), id: \.element) { index, page in
            link(page, title: page.localizedTitle, divider: index < pages.count - 1)
          }
        }
      }
    }
  }

  // MARK: Search

  @ViewBuilder private var results: some View {
    let found = ProjectSettingsIndex.search(query, canManage: canManage)
    if found.isEmpty {
      EmptyState(systemImage: "magnifyingglass", title: "Nothing matches")
    } else {
      Card {
        ForEach(Array(found.enumerated()), id: \.element.id) { index, entry in
          link(entry.page, focus: entry.id, title: entry.title, caption: entry.title == entry.page.localizedTitle ? nil : entry.page.localizedTitle, divider: index < found.count - 1)
        }
      }
    }
  }

  // MARK: Rows

  /// One row: a page, or the Install & API section for `keys`.
  @ViewBuilder private func link(_ page: ProjectSettingsPage, focus: String? = nil, title: String, caption: String? = nil, divider: Bool) -> some View {
    let label = row(page, title: title, caption: caption, divider: divider)
    if page == .keys {
      Button(action: openKeys) { label }.buttonStyle(.plain)
    } else {
      NavigationLink { destination(page, focus) } label: { label }.buttonStyle(.plain)
    }
  }

  private func row(_ page: ProjectSettingsPage, title: String, caption: String?, divider: Bool) -> some View {
    CardRow(divider: divider) {
      HStack(spacing: 12) {
        Image(systemName: page.systemImage).font(.app(size: 14, weight: .semibold)).foregroundStyle(.white)
          .frame(width: 28, height: 28)
          .background(Color(hexString: page.tintHex) ?? Theme.accent, in: RoundedRectangle(cornerRadius: 7))
        VStack(alignment: .leading, spacing: 1) {
          Text(title).font(.lnRow).foregroundStyle(Theme.text).lineLimit(1)
          if let caption { Text(caption).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1) }
        }
        Spacer(minLength: 8)
        accessory(page)
        Image(systemName: page == .keys ? "arrow.up.right" : "chevron.right").font(.app(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
      }
    }
    .contentShape(Rectangle())
  }

  /// A glance at the page's current state, as Apple's Settings shows a value beside a row.
  @ViewBuilder private func accessory(_ page: ProjectSettingsPage) -> some View {
    switch page {
    case .general:
      if !host.isEmpty { Text(host).font(.lnMeta).foregroundStyle(Theme.textMuted).lineLimit(1) }
    case .branding:
      Circle().fill(Theme.projectColor(id: projectId, accent: accent)).frame(width: 14, height: 14)
        .overlay(Circle().strokeBorder(Theme.border)).accessibilityHidden(true)
    default:
      EmptyView()
    }
  }
}
