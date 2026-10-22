import SwiftUI

// The company profile and the public hub, edited in the project's Settings
// (web: components/settings/ProjectCompany.vue and ProjectHub.vue). The server
// owns the rules (shared/company.ts, shared/hub.ts); these are the shapes and
// the two forms.

/// `Project.company`: who is behind the product. Legal documents and campaign
/// footers read it. Limits: name and legal name 120, address 300, email 200,
/// phone 40, website 300, DPO 200.
struct CompanyProfile: Codable, Equatable, Sendable {
  var name = "", legalName = "", address = "", email = "", phone = "", website = "", dpo = ""

  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    name = (try? c.decode(String.self, forKey: .name)) ?? ""
    legalName = (try? c.decode(String.self, forKey: .legalName)) ?? ""
    address = (try? c.decode(String.self, forKey: .address)) ?? ""
    email = (try? c.decode(String.self, forKey: .email)) ?? ""
    phone = (try? c.decode(String.self, forKey: .phone)) ?? ""
    website = (try? c.decode(String.self, forKey: .website)) ?? ""
    dpo = (try? c.decode(String.self, forKey: .dpo)) ?? ""
  }
}

struct HubLink: Codable, Equatable, Sendable {
  var label = "", url = ""
}

/// `Project.hub`: the public page at /hub/<publicKey> and the chat widget's Home tab.
struct HubConfig: Codable, Equatable, Sendable {
  /// HUB_SECTIONS in shared/hub.ts, in the order the page lists them by default.
  static let sectionKeys = ["about", "changelog", "roadmap", "feedback", "blog", "legal", "brand", "contact"]
  /// HUB_HOME_SECTIONS.
  static let homeSectionKeys = ["changelog", "feedback", "onboarding"]
  /// HUB_LIMITS.links.
  static let maxLinks = 8

  struct WidgetHome: Codable, Equatable, Sendable {
    var enabled = false
    var sections: [String] = HubConfig.homeSectionKeys
    init() {}
    init(from decoder: Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? false
      sections = (try? c.decode([String].self, forKey: .sections)) ?? HubConfig.homeSectionKeys
    }
  }

  var enabled = false
  var title = ""
  var tagline = ""
  var sections: [String] = HubConfig.sectionKeys
  var links: [HubLink] = []
  var widgetHome = WidgetHome()

  /// A link row left blank is dropped rather than rejected by the server.
  var droppingBlankLinks: HubConfig {
    var copy = self
    copy.links = links.filter { !$0.label.trimmingCharacters(in: .whitespaces).isEmpty || !$0.url.trimmingCharacters(in: .whitespaces).isEmpty }
    return copy
  }

  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? false
    title = (try? c.decode(String.self, forKey: .title)) ?? ""
    tagline = (try? c.decode(String.self, forKey: .tagline)) ?? ""
    sections = (try? c.decode([String].self, forKey: .sections)) ?? HubConfig.sectionKeys
    links = (try? c.decode([HubLink].self, forKey: .links)) ?? []
    widgetHome = (try? c.decode(WidgetHome.self, forKey: .widgetHome)) ?? WidgetHome()
  }

  static func title(of section: String) -> String {
    switch section {
    case "about": String(localized: "About")
    case "changelog": String(localized: "What is new (changelog)")
    case "roadmap": String(localized: "Roadmap")
    case "feedback": String(localized: "Feedback")
    case "blog": String(localized: "Blog")
    case "legal": String(localized: "Legal documents")
    case "brand": String(localized: "Brand kit")
    case "contact": String(localized: "Contact us (opens the chat)")
    default: section
    }
  }

  static func homeTitle(of section: String) -> String {
    switch section {
    case "changelog": String(localized: "What is new")
    case "feedback": String(localized: "Feedback")
    case "onboarding": String(localized: "Onboarding flows to start")
    default: section
    }
  }
}

// MARK: - Company

struct CompanyFields: View {
  @Binding var company: CompanyProfile
  @Environment(\.horizontalSizeClass) private var sizeClass

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Legal documents name you as the operator, campaigns print your address in every footer, and email templates can fill in your company name, address, email and legal page links.")
        .font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
      pair {
        LabeledField(label: "Company name", hint: "The name people know") { TextField("", text: $company.name).textFieldStyle(.linear) }
      } _: {
        LabeledField(label: "Legal name", hint: "As registered; used in contracts and notices") { TextField("", text: $company.legalName).textFieldStyle(.linear) }
      }
      LabeledField(label: "Postal address", hint: "Marketing email must carry it") {
        LinearTextEditor(text: $company.address, placeholder: "Acme Inc, 1 Main Street, Lisbon, Portugal", minHeight: 56)
      }
      pair {
        LabeledField(label: "Contact email") {
          TextField("", text: $company.email).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
      } _: {
        LabeledField(label: "Phone") { TextField("", text: $company.phone).textFieldStyle(.linear).keyboardType(.phonePad) }
      }
      pair {
        LabeledField(label: "Website") {
          TextField("https://", text: $company.website).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
      } _: {
        LabeledField(label: "Data protection officer", hint: "Optional") { TextField("", text: $company.dpo).textFieldStyle(.linear) }
      }
    }
  }

  private func pair<First: View, Second: View>(@ViewBuilder _ first: () -> First, @ViewBuilder _ second: () -> Second) -> some View {
    let layout = sizeClass == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
    return layout {
      first().frame(maxWidth: .infinity, alignment: .leading)
      second().frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

// MARK: - Public hub

struct HubFields: View {
  @Binding var hub: HubConfig
  let publicKey: String
  let projectName: String
  @Environment(SessionStore.self) private var session
  @Environment(\.openURL) private var openURL
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var copied = false

  private struct SectionRow: Identifiable {
    let key: String
    let on: Bool
    var id: String { key }
  }

  /// Listed sections first, in their order, then the ones left out.
  private var rows: [SectionRow] {
    hub.sections.map { SectionRow(key: $0, on: true) } + HubConfig.sectionKeys.filter { !hub.sections.contains($0) }.map { SectionRow(key: $0, on: false) }
  }

  private var hubURL: URL? { LegalAPI.publicURL(session, "/hub/\(publicKey)") }

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      toggle("Public page", detail: "A page at /hub/your-key with your changelog, roadmap, feedback, blog, legal documents and brand kit. A section shows only when it has something public.", isOn: $hub.enabled)
      if hub.enabled {
        if let hubURL {
          VStack(alignment: .leading, spacing: 8) {
            Text(hubURL.absoluteString).font(.lnMono).foregroundStyle(Theme.textToned).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
              Button { openURL(hubURL) } label: { Label("Open", systemImage: "arrow.up.right.square") }.buttonStyle(.lnSecondaryCompact)
              Button { Clipboard.copy(hubURL.absoluteString); copied = true } label: { Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "link") }.buttonStyle(.lnSecondaryCompact)
            }
            Text("Save your changes to publish the page.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
        }
        pair {
          LabeledField(label: "Title", hint: "Defaults to the project name") { TextField(projectName, text: $hub.title).textFieldStyle(.linear) }
        } _: {
          LabeledField(label: "Tagline", hint: "Defaults to your Brand kit tagline") { TextField("", text: $hub.tagline).textFieldStyle(.linear) }
        }
        sectionsList
        linksList
      }
      Rectangle().fill(Theme.border).frame(height: Hairline.width)
      toggle("Home tab in the chat widget", detail: "The chat opens on Home with what is new, top feedback and onboarding flows, next to Messages. Works without the public page.", isOn: $hub.widgetHome.enabled)
      if hub.widgetHome.enabled {
        VStack(alignment: .leading, spacing: 10) {
          ForEach(HubConfig.homeSectionKeys, id: \.self) { key in
            Toggle(isOn: homeBinding(key)) { Text(HubConfig.homeTitle(of: key)).font(.lnCallout).foregroundStyle(Theme.text) }.tint(Theme.accent)
          }
        }
        .padding(.leading, 4)
      }
    }
  }

  private var sectionsList: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Sections").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
      Text("Tick what to list and put it in order. One with nothing public stays out of the page.").font(.lnCaption).foregroundStyle(Theme.textMuted)
      VStack(spacing: 0) {
        ForEach(rows) { row in
          HStack(spacing: 6) {
            Toggle(isOn: sectionBinding(row.key)) { Text(HubConfig.title(of: row.key)).font(.lnCallout).foregroundStyle(Theme.text) }.tint(Theme.accent)
            Button { move(row.key, by: -1) } label: { Image(systemName: "arrow.up") }
              .buttonStyle(.lnGhost).disabled(!row.on || hub.sections.first == row.key).accessibilityLabel("Move \(HubConfig.title(of: row.key)) up")
            Button { move(row.key, by: 1) } label: { Image(systemName: "arrow.down") }
              .buttonStyle(.lnGhost).disabled(!row.on || hub.sections.last == row.key).accessibilityLabel("Move \(HubConfig.title(of: row.key)) down")
          }
          .padding(.horizontal, 12).padding(.vertical, 4)
          .frame(minHeight: Metrics.rowHeight)
          if row.id != rows.last?.id { Rectangle().fill(Theme.border).frame(height: Hairline.width) }
        }
      }
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    }
  }

  private var linksList: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Your own links").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
      ForEach(hub.links.indices, id: \.self) { index in
        HStack(spacing: 8) {
          TextField("Label", text: $hub.links[index].label).textFieldStyle(.linear).frame(maxWidth: 150)
          TextField("https://", text: $hub.links[index].url).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          Button { hub.links.remove(at: index) } label: { Image(systemName: "xmark") }.buttonStyle(.lnGhost).accessibilityLabel("Remove link")
        }
      }
      if hub.links.count < HubConfig.maxLinks {
        Button { hub.links.append(HubLink()) } label: { Label("Add a link", systemImage: "plus") }.buttonStyle(.lnSecondaryCompact)
      }
    }
  }

  private func sectionBinding(_ key: String) -> Binding<Bool> {
    Binding(
      get: { hub.sections.contains(key) },
      set: { on in
        hub.sections.removeAll { $0 == key }
        if on { hub.sections.append(key) }
      }
    )
  }

  private func homeBinding(_ key: String) -> Binding<Bool> {
    Binding(
      get: { hub.widgetHome.sections.contains(key) },
      set: { on in
        // Keep the canonical order whatever order they were ticked in.
        hub.widgetHome.sections = HubConfig.homeSectionKeys.filter { $0 == key ? on : hub.widgetHome.sections.contains($0) }
      }
    )
  }

  private func move(_ key: String, by step: Int) {
    guard let from = hub.sections.firstIndex(of: key) else { return }
    let to = from + step
    guard hub.sections.indices.contains(to) else { return }
    hub.sections.swapAt(from, to)
  }

  private func toggle(_ label: LocalizedStringKey, detail: LocalizedStringKey, isOn: Binding<Bool>) -> some View {
    Toggle(isOn: isOn) {
      VStack(alignment: .leading, spacing: 2) {
        Text(label).font(.lnCallout).foregroundStyle(Theme.text)
        Text(detail).font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
      }
    }
    .tint(Theme.accent)
  }

  private func pair<First: View, Second: View>(@ViewBuilder _ first: () -> First, @ViewBuilder _ second: () -> Second) -> some View {
    let layout = sizeClass == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
    return layout {
      first().frame(maxWidth: .infinity, alignment: .leading)
      second().frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}
