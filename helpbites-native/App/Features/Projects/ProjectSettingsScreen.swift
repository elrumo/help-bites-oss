import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// A project's name, branding, chat widget, notifications and sidebar, its
/// collaborators and GitHub repos (web: projects/[id]/settings.vue). The email
/// sender is on Email; keys, snippets and webhooks are on Developer & MCP.
struct ProjectSettingsScreen: View {
  let projectId: String
  @Environment(Workspace.self) private var workspace
  @Environment(SessionStore.self) private var session
  @Environment(\.horizontalSizeClass) private var sizeClass

  @State private var project: ProjectsAdminProject?
  @State private var form = SettingsForm()
  @State private var snapshot = SettingsForm()
  @State private var loadError = ""
  @State private var saving = false
  @State private var saved = false
  @State private var saveError = ""
  @State private var uploading: SettingsImage?
  @State private var people: [Agent] = []

  /// Linear's indigo, then the colours projects without one are given (settings.vue `swatches`).
  private static let swatches = ["#5e6ad2", "#0f766e", "#0369a1", "#0e7490", "#4d7c0f", "#b45309", "#c2410c", "#be123c", "#7c3aed"]

  private var dirty: Bool { form != snapshot }
  private var nameOrThis: String { form.name.isEmpty ? String(localized: "this project") : form.name }
  private var validAccent: Bool { form.accent.isEmpty || form.accent.trimmingCharacters(in: .whitespaces).wholeMatch(of: /#[0-9a-fA-F]{6}/) != nil }

  var body: some View {
    ScrollView {
      Group {
        if let project {
          VStack(alignment: .leading, spacing: 40) {
            general
            branding(project)
            companyCard
            widget
            hubCard(project)
            notifications
            sidebar
            collaborators
            section("GitHub repos", "The code behind \(nameOrThis). AI error notes and legal documents read these; HelpBites never writes to them.") {
              ProjectReposSection(projectId: projectId)
            }
            if session.canManage {
              section("Data", "Take this project to another HelpBites.") { TransferSection(projectId: projectId) }
            }
            devLink
          }
        } else if !loadError.isEmpty {
          ErrorText(message: loadError)
        } else {
          SkeletonRows(count: 5)
        }
      }
      .frame(maxWidth: 680, alignment: .leading)
      .padding(.horizontal, 20)
      .padding(.top, 28)
      .padding(.bottom, 90)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .projectScreen(projectId, "Settings")
    .safeAreaInset(edge: .bottom) { if dirty || !saveError.isEmpty { saveBar } }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        // ⌘S, as on the web.
        Button { Task { await save() } } label: { Label("Save changes", systemImage: "checkmark") }
          .keyboardShortcut("s", modifiers: .command)
          .disabled(!dirty || saving || !validAccent)
      }
    }
    .task { await load() }
  }

  // MARK: Sections

  private var general: some View {
    section("General", "What the project is called and where it lives.") {
      LabeledField(label: "Name") { TextField("", text: $form.name).textFieldStyle(.linear) }
      pair {
        LabeledField(label: "Site URL", hint: "Used in email links") { urlField("https://app.example.com", text: $form.siteUrl) }
      } _: {
        LabeledField(label: "Inbox path", hint: "Where the widget lives on that site") { urlField("/app", text: $form.inboxPath) }
      }
    }
  }

  private func branding(_ project: ProjectsAdminProject) -> some View {
    section("Branding", "How the project looks in this panel and in the widget your users see.") {
      row("Logo", "Shown in the sidebar, page headers and lists instead of the coloured initial. Square, at least 64×64.") {
        HStack(spacing: 12) {
          ProjectTile(id: projectId, name: form.name, accent: form.accent, icon: form.iconUrl, size: 48)
          VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
              imageButtons(.icon)
              if !form.iconUrl.isEmpty { Button("Remove") { form.iconUrl = "" }.buttonStyle(.lnGhost) }
            }
            HStack(spacing: 6) {
              ProjectTile(id: projectId, name: form.name, accent: form.accent, icon: form.iconUrl, size: 16)
              Text("\(form.name.isEmpty ? String(localized: "Project") : form.name) in the sidebar").font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1)
            }
          }
        }
      }
      divider
      row("Colour", "The sidebar tile, the widget's send button and your chat bubbles.") {
        VStack(alignment: .leading, spacing: 10) {
          Text("This is the accent of your Brand kit: widgets, boards, forms, legal, blog and hub pages and campaign mail all follow it.")
            .font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
          Button { workspace.go(.project(projectId, .brand)) } label: { Label("Open the Brand kit", systemImage: "paintpalette") }.buttonStyle(.lnSecondaryCompact)
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 30, maximum: 30), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(Self.swatches, id: \.self) { swatch in
              Button { form.accent = swatch } label: {
                Circle().fill(Color(hexString: swatch) ?? Theme.accent).frame(width: 26, height: 26)
                  .overlay { if form.accent.lowercased() == swatch { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white) } }
                  .padding(2)
                  .overlay { if form.accent.lowercased() == swatch { Circle().strokeBorder(Theme.textHighlighted, lineWidth: 2) } }
              }
              .buttonStyle(.plain)
              .accessibilityLabel(swatch)
              .accessibilityAddTraits(form.accent.lowercased() == swatch ? .isSelected : [])
            }
          }
          HStack(spacing: 10) {
            ColorPicker("Custom colour", selection: accentBinding, supportsOpacity: false).labelsHidden()
            TextField(Theme.projectColor(id: projectId, accent: nil).hexString, text: $form.accent).textFieldStyle(.linear).font(.lnMono)
              .frame(maxWidth: 130).textInputAutocapitalization(.never).autocorrectionDisabled()
            if !form.accent.isEmpty && !validAccent { Text("Use a hex colour like #4f46e5").font(.lnCaption).foregroundStyle(Theme.error) }
          }
        }
      }
      divider
      row("Widget images", "The brand logo heads the chat; the assistant avatar sits beside AI replies.") {
        FlowLayout(spacing: 20) {
          ForEach([SettingsImage.brand, .assistant], id: \.self) { image in
            HStack(spacing: 12) {
              widgetImage(image)
              VStack(alignment: .leading, spacing: 6) {
                Text(image.label).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
                HStack(spacing: 6) {
                  imageButtons(image)
                  if !url(of: image).isEmpty { Button("Remove") { set(image, "") }.buttonStyle(.lnGhost) }
                }
              }
            }
          }
        }
      }
      divider
      widgetPreview
    }
  }

  private var companyCard: some View {
    section("Company", "Who is behind the product, written once.") {
      cardBody { CompanyFields(company: $form.company) }
    }
  }

  private func hubCard(_ project: ProjectsAdminProject) -> some View {
    section("Public hub", "One page that gathers what you publish, and a Home tab for the chat widget.") {
      cardBody { HubFields(hub: $form.hub, publicKey: project.publicKey, projectName: form.name) }
    }
  }

  private var widget: some View {
    section("Chat widget", "What users can do when they start a chat.") {
      cardBody {
        LabeledField(label: "Chat notice", hint: "Shown centered at the top of every new chat. Leave blank to hide.") {
          LinearTextEditor(text: $form.chatNotice, placeholder: String(localized: "A human will always read this chat, but an AI might answer your questions first."), minHeight: 64)
        }
        toggle("Users can attach images", isOn: $form.allowAttachments)
        toggle("Allow email-only users (no sign-in)", detail: "Apps without a backend can chat and post feedback with just an email address. After a few actions, the person must confirm the address with a code we email them.", isOn: $form.allowAnonymousUsers)
        VStack(alignment: .leading, spacing: 10) {
          Text("Guest access (no account, no email)").font(.lnCallout).foregroundStyle(Theme.text)
          Text("Let visitors use these without signing in or giving an address. Guests are rate limited, cannot upload files, get no reply emails, and their session expires after 30 days unused. Turn every box off to end all guest access.").font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
          toggle("Chat", detail: "Guests can start conversations and message you.", isOn: guest("chat")).padding(.leading, 24)
          toggle("Feedback", detail: "Guests can post, vote and comment on the feedback board.", isOn: guest("feedback")).padding(.leading, 24)
          toggle("Comments", detail: "Guests can comment on blog posts and changelog entries.", isOn: guest("comments")).padding(.leading, 24)
        }
        VStack(alignment: .leading, spacing: 10) {
          toggle("Let users choose a request type when starting a chat", detail: "Only takes effect once the project has more than one ticket type.", isOn: $form.letUsersChooseType)
          toggle("Offer an “Other” option", detail: "Creates a plain support ticket.", isOn: $form.allowOtherType).disabled(!form.letUsersChooseType).padding(.leading, 24)
        }
      }
    }
  }

  private var notifications: some View {
    section("Notifications", "Who hears about new chats.") {
      cardBody {
        LabeledField(label: "Notify when a user writes", hint: "Comma separated, up to 5") {
          TextField("you@example.com", text: $form.notifyEmails).textFieldStyle(.linear).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        VStack(alignment: .leading, spacing: 8) {
          Text("The sender and the rest of the project's email settings are in").font(.lnCaption).foregroundStyle(Theme.textMuted)
          Button { workspace.go(.project(projectId, .email)) } label: { Label("Email → Settings", systemImage: "envelope") }.buttonStyle(.lnSecondaryCompact)
        }
      }
    }
  }

  /// Per group, a switch per section: on is shown. What is hidden leaves the sidebar, the project's
  /// section list and ⌘K; its pages still open from a link.
  private var sidebar: some View {
    section("Sidebar", "Untick what this project does not use to take it out of the sidebar and the ⌘K list. Nothing is deleted, and its pages still open from a link. Overview and Settings are always there.") {
      Card {
        ForEach(SectionGroup.allCases, id: \.self) { group in
          CardRow(divider: group != SectionGroup.allCases.last) {
            VStack(alignment: .leading, spacing: 12) {
              Text(group.label).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
              ForEach(ProjectSection.allCases.filter { $0.group == group }) { item in
                toggle(LocalizedStringKey(item.label), isOn: shown(item))
              }
            }
          }
        }
      }
    }
  }

  private var collaborators: some View {
    section("Collaborators", "The people who answer \(nameOrThis)'s chats.") {
      cardBody {
        Text("Everyone on your team can open this project and every other one.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        if !people.isEmpty {
          VStack(spacing: 0) {
            ForEach(people) { person in
              HStack(spacing: 10) {
                Avatar(name: person.name.isEmpty ? person.username : person.name)
                VStack(alignment: .leading, spacing: 1) {
                  Text(person.name.isEmpty ? person.username : person.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
                  if !person.email.isEmpty { Text(person.email).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1) }
                }
                Spacer(minLength: 0)
              }
              .frame(minHeight: Metrics.rowHeight)
            }
          }
        }
        Button { workspace.go(.team) } label: { Label("Manage the team", systemImage: "person.2") }.buttonStyle(.lnSecondaryCompact)
      }
    }
  }

  private var devLink: some View {
    Button { workspace.go(.project(projectId, .dev)) } label: {
      Label("Keys and webhooks", systemImage: "chevron.left.forwardslash.chevron.right").foregroundStyle(Theme.textMuted)
    }
    .buttonStyle(.lnGhost)
  }

  private var saveBar: some View {
    HStack(spacing: 10) {
      Text(saveError.isEmpty ? String(localized: "Unsaved changes") : saveError).font(.lnMeta).foregroundStyle(saveError.isEmpty ? Theme.textMuted : Theme.error).lineLimit(2)
      Button("Discard") { discard() }.buttonStyle(.lnGhost).disabled(saving)
      Button { Task { await save() } } label: {
        if saving { ProgressView().tint(.white) } else { Text("Save changes") }
      }
      .buttonStyle(.lnPrimaryCompact)
      .disabled(saving || uploading != nil || !validAccent || !dirty)
    }
    .padding(.leading, 16).padding(.trailing, 6).padding(.vertical, 6)
    .background(.regularMaterial, in: Capsule())
    .overlay(Capsule().strokeBorder(Theme.border))
    .shadow(color: .black.opacity(0.12), radius: 10, y: 3)
    .padding(.horizontal, 16).padding(.bottom, 8)
    .accessibilityElement(children: .contain)
  }

  // MARK: Widget preview

  /// What a user sees, from the fields above: header, a reply, their own message.
  private var widgetPreview: some View {
    let accent = (validAccent ? Color(hexString: form.accent) : nil) ?? Theme.accent
    return VStack(alignment: .leading, spacing: 8) {
      SectionLabel("Widget preview")
      VStack(spacing: 0) {
        HStack(spacing: 8) {
          if let url = ProjectIcon.url(form.brandLogoUrl) {
            CachedAsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.elevated }
              .frame(width: 24, height: 24).clipShape(RoundedRectangle(cornerRadius: 6))
          } else {
            Text(String((form.name.isEmpty ? "?" : form.name).prefix(1)).uppercased()).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
              .frame(width: 24, height: 24).background(accent, in: RoundedRectangle(cornerRadius: 6))
          }
          Text(form.name.isEmpty ? String(localized: "Your project") : form.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).frame(height: 44)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 0.5) }
        VStack(alignment: .leading, spacing: 10) {
          if !form.chatNotice.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Text(form.chatNotice).font(.lnCaption).foregroundStyle(Theme.textMuted).multilineTextAlignment(.center).frame(maxWidth: .infinity)
          }
          HStack(alignment: .bottom, spacing: 8) {
            if let url = ProjectIcon.url(form.assistantLogoUrl) {
              CachedAsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.elevated }
                .frame(width: 24, height: 24).clipShape(Circle())
            } else {
              Image(systemName: "sparkles").font(.system(size: 12)).foregroundStyle(Theme.textMuted).frame(width: 24, height: 24).background(Theme.elevated, in: Circle())
            }
            Text("Hi! How can we help?").font(.system(size: 13)).foregroundStyle(Theme.text)
              .padding(.horizontal, 12).padding(.vertical, 7).background(Theme.elevated, in: RoundedRectangle(cornerRadius: 16))
            Spacer(minLength: 0)
          }
          Text("My export is stuck").font(.system(size: 13)).foregroundStyle(.white)
            .padding(.horizontal, 12).padding(.vertical, 7).background(accent, in: RoundedRectangle(cornerRadius: 16))
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(12)
      }
      .background(Theme.panel, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
      .frame(maxWidth: 360)
      .frame(maxWidth: .infinity)
    }
    .padding(16)
    .background(Theme.elevated.opacity(0.6))
  }

  // MARK: Small pieces

  /// A titled block: heading, one-line hint, then the content.
  private func section<Content: View>(_ title: LocalizedStringKey, _ hint: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.lnHeading).foregroundStyle(Theme.textHighlighted)
        Text(hint).font(.lnMeta).foregroundStyle(Theme.textMuted)
      }
      content()
    }
  }

  private func cardBody<Content: View>(@ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 16) { content() }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
  }

  /// A row of the branding card: label and hint beside (iPad, Mac) or above (iPhone) the control.
  private func row<Content: View>(_ title: LocalizedStringKey, _ hint: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
    let layout = sizeClass == .regular ? AnyLayout(HStackLayout(alignment: .center, spacing: 16)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
    return layout {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
        Text(hint).font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      .frame(width: sizeClass == .regular ? 170 : nil, alignment: .leading)
      content().frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var divider: some View { Rectangle().fill(Theme.border).frame(height: Hairline.width) }

  private func widgetImage(_ image: SettingsImage) -> some View {
    Group {
      if let url = ProjectIcon.url(url(of: image)) {
        CachedAsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
      } else {
        Image(systemName: image.placeholder).font(.system(size: 18)).foregroundStyle(Theme.textDimmed)
      }
    }
    .frame(width: 48, height: 48)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: 12))
    .accessibilityLabel(Text(image.label))
  }

  private func imageButtons(_ image: SettingsImage) -> some View {
    ImageSourceButtons(busy: uploading == image, disabled: uploading != nil) { data in
      Task { await upload(image, data) }
    } onError: { saveError = $0 }
  }

  private func toggle(_ label: LocalizedStringKey, detail: LocalizedStringKey? = nil, isOn: Binding<Bool>) -> some View {
    Toggle(isOn: isOn) {
      VStack(alignment: .leading, spacing: 2) {
        Text(label).font(.lnCallout).foregroundStyle(Theme.text)
        if let detail { Text(detail).font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true) }
      }
    }
    .tint(Theme.accent)
  }

  /// A guest surface's switch (`GUEST_SURFACES` in shared/guest.ts): on while it is in the set.
  private func guest(_ surface: String) -> Binding<Bool> {
    Binding(
      get: { form.guestSurfaces.contains(surface) },
      set: { on in if on { form.guestSurfaces.insert(surface) } else { form.guestSurfaces.remove(surface) } }
    )
  }

  /// A section's switch: on while it is not in the hidden set.
  private func shown(_ section: ProjectSection) -> Binding<Bool> {
    Binding(
      get: { !form.hidden.contains(section.path) },
      set: { if $0 { form.hidden.remove(section.path) } else { form.hidden.insert(section.path) } }
    )
  }

  private func urlField(_ prompt: String, text: Binding<String>) -> some View {
    TextField(prompt, text: text).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
  }

  /// Two fields side by side on iPad and Mac, stacked on iPhone (the web's `sm:grid-cols-2`).
  private func pair<First: View, Second: View>(@ViewBuilder _ first: () -> First, @ViewBuilder _ second: () -> Second) -> some View {
    let layout = sizeClass == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
    return layout {
      first().frame(maxWidth: .infinity, alignment: .leading)
      second().frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var accentBinding: Binding<Color> {
    Binding(get: { Color(hexString: form.accent) ?? Theme.projectColor(id: projectId, accent: nil) }, set: { form.accent = $0.hexString })
  }

  private func url(of image: SettingsImage) -> String {
    switch image {
    case .icon: form.iconUrl
    case .brand: form.brandLogoUrl
    case .assistant: form.assistantLogoUrl
    }
  }

  private func set(_ image: SettingsImage, _ value: String) {
    switch image {
    case .icon: form.iconUrl = value
    case .brand: form.brandLogoUrl = value
    case .assistant: form.assistantLogoUrl = value
    }
  }

  private func discard() {
    saveError = ""
    form = snapshot
  }

  // MARK: Requests

  private func load() async {
    do {
      let loaded = try await ProjectsAdminProject.load(projectId, session: session)
      fill(loaded)
    } catch { loadError = error.localizedDescription }
    struct People: Decodable, Sendable { let agents: [Agent] }
    if let response: People = try? await session.get("/v1/admin/agents") { people = response.agents }
  }

  private func fill(_ loaded: ProjectsAdminProject) {
    project = loaded
    form = SettingsForm(loaded)
    snapshot = form
  }

  /// `POST /projects/:id/logo` returns the stored image; its URL lands on the project when you save.
  private func upload(_ image: SettingsImage, _ data: Data) async {
    uploading = image
    saveError = ""
    defer { uploading = nil }
    do {
      // The server sniffs PNG, JPEG, GIF or WebP; anything else (HEIC) goes up as JPEG.
      let magic: [[UInt8]] = [[0x89, 0x50, 0x4E, 0x47], [0xFF, 0xD8, 0xFF], [0x47, 0x49, 0x46], [0x52, 0x49, 0x46, 0x46]]
      let accepted = magic.contains { data.starts(with: $0) }
      guard let file = accepted ? data : PlatformImage(data: data)?.jpegBytes(quality: 0.9) else {
        throw APIError.server(String(localized: "Only PNG, JPEG, GIF and WebP images are accepted"))
      }
      let stored: Attachment = try await session.upload("/v1/admin/projects/\(projectId)/logo", file: file, filename: "logo", mimeType: accepted ? "application/octet-stream" : "image/jpeg")
      set(image, stored.url)
    } catch { saveError = error.localizedDescription }
  }

  private func save() async {
    guard dirty, !saving, validAccent else { return }
    saving = true
    saved = false
    saveError = ""
    defer { saving = false }
    let accent = form.accent.trimmingCharacters(in: .whitespaces)
    let body = SettingsInput(
      name: form.name, siteUrl: form.siteUrl, inboxPath: form.inboxPath,
      iconUrl: form.iconUrl, brandLogoUrl: form.brandLogoUrl, assistantLogoUrl: form.assistantLogoUrl,
      chatNotice: form.chatNotice, allowAttachments: form.allowAttachments, allowAnonymousUsers: form.allowAnonymousUsers,
      guestSurfaces: GuestSurfaces.all.filter { form.guestSurfaces.contains($0) },
      letUsersChooseType: form.letUsersChooseType, allowOtherType: form.allowOtherType,
      notifyEmails: form.notifyEmails,
      company: form.company, hub: form.hub.droppingBlankLinks,
      // The whole set goes back, so a section only the web has (Pages) stays hidden.
      hiddenSections: form.hidden.sorted(),
      // The accent is the Brand kit's: send it only when it changed here, so saving something else never pins it.
      // `theme` is replaced whole on the server: send `dark` back so saving here keeps it.
      theme: accent == (project?.theme.accent ?? "") ? nil : ProjectTheme(accent: accent.isEmpty ? nil : accent, dark: project?.theme.dark)
    )
    do {
      fill(try await ProjectsAdminProject.save(projectId, body, workspace: workspace))
      saved = true
    } catch { saveError = error.localizedDescription }
  }
}

// MARK: - Image picking

/// Where a project image goes; `label` is what the web calls it.
private enum SettingsImage: Hashable {
  case icon, brand, assistant
  var label: String {
    switch self {
    case .icon: String(localized: "Logo")
    case .brand: String(localized: "Brand logo")
    case .assistant: String(localized: "Assistant avatar")
    }
  }
  var placeholder: String { self == .brand ? "photo" : "sparkles" }
}

/// Upload from the photo library or from a file (web: the hidden file input).
/// Hands the raw bytes to the parent, which checks the format and uploads.
private struct ImageSourceButtons: View {
  let busy: Bool
  let disabled: Bool
  let onData: (Data) -> Void
  let onError: (String) -> Void
  @State private var pick: PhotosPickerItem?
  @State private var importing = false

  var body: some View {
    HStack(spacing: 4) {
      PhotosPicker(selection: $pick, matching: .images, preferredItemEncoding: .compatible) {
        if busy { ProgressView().controlSize(.small) } else { Label("Upload", systemImage: "square.and.arrow.up") }
      }
      .buttonStyle(.lnSecondaryCompact)
      .disabled(disabled)
      Button("Files…") { importing = true }.buttonStyle(.lnGhost).disabled(disabled)
    }
    .onChange(of: pick) { _, item in
      guard let item else { return }
      Task {
        defer { pick = nil }
        do {
          if let data = try await item.loadTransferable(type: Data.self) { onData(data) } else { onError(String(localized: "Could not read that image")) }
        } catch { onError(error.localizedDescription) }
      }
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: [.png, .jpeg, .gif, .webP, .heic]) { result in
      switch result {
      case .failure(let error): onError(error.localizedDescription)
      case .success(let url):
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        if let data = try? Data(contentsOf: url) { onData(data) } else { onError(String(localized: "Could not read that file")) }
      }
    }
  }
}

// MARK: - Form

/// What an admin can open to guests, in the server's order (`GUEST_SURFACES` in shared/guest.ts; tests/guestNativeParity.test.ts keeps them equal).
private enum GuestSurfaces {
  static let all = ["chat", "feedback", "comments"]
}

/// The settings form, filled from the project like the web's `fill()`. Equatable: dirty means it differs from the saved copy.
private struct SettingsForm: Equatable {
  var name = "", siteUrl = "", inboxPath = "", iconUrl = "", brandLogoUrl = "", assistantLogoUrl = "", accent = "", chatNotice = ""
  var notifyEmails = ""
  var allowAttachments = true, allowAnonymousUsers = false, letUsersChooseType = false, allowOtherType = false
  /// Which surfaces guests may use. A set, so ticking and unticking back reads as unchanged.
  var guestSurfaces: Set<String> = []
  var company = CompanyProfile()
  var hub = HubConfig()
  /// Web paths of the sections left out of the sidebar. A set, so ticking and unticking back reads as unchanged.
  var hidden: Set<String> = []

  init() {}
  init(_ project: ProjectsAdminProject) {
    name = project.name
    siteUrl = project.siteUrl
    inboxPath = project.inboxPath
    iconUrl = project.iconUrl ?? ""
    brandLogoUrl = project.brandLogoUrl ?? ""
    assistantLogoUrl = project.assistantLogoUrl ?? ""
    accent = project.theme.accent ?? ""
    chatNotice = project.chatNotice ?? ""
    allowAttachments = project.allowAttachments
    allowAnonymousUsers = project.allowAnonymousUsers ?? false
    guestSurfaces = Set(project.guestSurfaces ?? [])
    letUsersChooseType = project.letUsersChooseType ?? false
    allowOtherType = project.allowOtherType ?? false
    notifyEmails = project.notifyEmails.joined(separator: ", ")
    company = project.company ?? CompanyProfile()
    hub = project.hub ?? HubConfig()
    hidden = Set(project.hiddenSections ?? [])
  }
}

/// The PATCH body the web's Settings page sends.
private struct SettingsInput: Encodable, Sendable {
  let name, siteUrl, inboxPath, iconUrl, brandLogoUrl, assistantLogoUrl, chatNotice: String
  let allowAttachments, allowAnonymousUsers, letUsersChooseType, allowOtherType: Bool
  let guestSurfaces: [String]
  let notifyEmails: String
  let company: CompanyProfile
  let hub: HubConfig
  let hiddenSections: [String]
  /// Sent only when the accent changed (it is the Brand kit's).
  let theme: ProjectTheme?
}
