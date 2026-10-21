import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// The frame every blog sheet shares: a scrolling column with Close.
private struct BlogSheetFrame<Content: View, Trailing: View>: View {
  let title: String
  @ViewBuilder let content: () -> Content
  @ViewBuilder let trailing: () -> Trailing
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18, content: content)
          .frame(maxWidth: 560, alignment: .leading)
          .padding(20)
          .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen(title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { trailing() }
      }
    }
    .presentationDetents([.large])
    .changelogSheetSize()
  }
}

private func hint(_ text: String) -> some View {
  Text(text).font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
}

/// A boxed line above a sheet: who may change it, or what a send waits for.
private func notice(_ text: String) -> some View {
  Text(text)
    .font(.lnMeta).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
    .padding(.horizontal, 12).padding(.vertical, 8)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(Theme.border))
}

// MARK: - Settings

/// The blog's settings (web: the Settings slide-over on the blog page). Switches
/// save as they change; the text fields with their own button. Admins only
/// (`projects.manage`): anyone else sees them greyed out.
struct BlogSettingsSheet: View {
  let store: BlogStore
  @State private var settings: BlogSettings
  @State private var notify: String
  @State private var saving = false
  @State private var saved = false
  @State private var error = ""

  init(store: BlogStore) {
    self.store = store
    _settings = State(initialValue: store.settings)
    _notify = State(initialValue: store.settings.commentNotify.joined(separator: ", "))
  }

  var body: some View {
    BlogSheetFrame(title: "Blog settings") {
      hint("Where readers find your posts and what they can do there.")
      if !store.canManage { notice("Only admins change these settings.") }
      Group { fields }.disabled(!store.canManage)

      SectionLabel("On your site")
      hint("Paste this where the blog should appear. Hand it your user's identity token to let them react and comment (see the Blog guide).")
      CodeBlock(code: snippet)
      if let sitemap = store.sitemapURL {
        LabeledField(label: "Sitemap", hint: "Give it to Google Search Console or Bing Webmaster Tools so they find every post.") {
          CodeBlock(code: sitemap.absoluteString)
        }
      }
    } trailing: {}
  }

  @ViewBuilder private var fields: some View {
    Card {
      CardRow { toggle("Public blog", "The hosted blog, the embed, the API and the RSS feed show your published posts.", \.enabled, key: "enabled") }
      CardRow { toggle("Reactions", "Signed-in readers react to posts with an emoji.", \.reactions, key: "reactions") }
      CardRow { toggle("Comments", "Signed-in readers comment on posts. You can still close one post's thread.", \.comments, key: "comments") }
      CardRow(divider: false) { toggle("Sign-up form under posts", "Readers of the hosted blog can subscribe to the newsletter; they join your contacts like any sign-up.", \.subscribeForm, key: "subscribeForm") }
    }
    HStack {
      if saving { ProgressView().controlSize(.small) }
      Text(saving ? "Saving…" : saved ? "Saved" : "Switches save as you change them").font(.lnCaption).foregroundStyle(Theme.textMuted)
    }

    SectionLabel("Name and addresses")
    LabeledField(label: "Name", hint: "Shown at the top of the blog and in the feed; the project's name followed by \"blog\" when empty") {
      TextField("", text: $settings.title).textFieldStyle(.linear)
    }
    LabeledField(label: "Description") {
      TextField("", text: $settings.description, axis: .vertical).textFieldStyle(.linear).lineLimit(2...4)
    }
    LabeledField(label: "Tell these addresses about new comments", hint: "Comma-separated, up to 10") {
      TextField("you@example.com", text: $notify).textFieldStyle(.linear).inputHints(.emailAddress, capitalization: .never).autocorrectionDisabled()
    }
    LabeledField(label: "Post address on your site", hint: "If posts also live on your own site, where: {siteUrl} and {slug} are filled in. Empty: the hosted page.") {
      TextField("{siteUrl}/blog/{slug}", text: $settings.postUrl).textFieldStyle(.linear).inputHints(.url, capitalization: .never).autocorrectionDisabled()
    }
    LabeledField(label: "Newsletter topic", hint: "Who a newsletter goes to unless you pick otherwise") {
      FeedbackSelect(options: [FeedbackOption(value: "", label: "Every subscriber")] + (store.project?.marketing?.topics ?? []).map { FeedbackOption(value: $0.key, label: $0.name.isEmpty ? $0.key : $0.name) }, selection: $settings.newsletterTopic)
    }
    Button { Task { await saveText() } } label: { Text("Save") }.buttonStyle(.lnSecondary).disabled(saving)
    ErrorText(message: error)
  }

  private var snippet: String {
    let origin = store.workspace.session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return "<div id=\"blog\"></div>\n<script src=\"\(origin)/blog.js\" data-project=\"\(store.project?.publicKey ?? "pk_…")\" data-target=\"#blog\" defer></script>"
  }

  private func toggle(_ title: String, _ detail: String, _ keyPath: WritableKeyPath<BlogSettings, Bool>, key: String) -> some View {
    FeedbackToggleRow(title: title, detail: detail, isOn: Binding(
      get: { settings[keyPath: keyPath] },
      set: { on in
        settings[keyPath: keyPath] = on
        Task { await save([key: .bool(on)]) }
      }
    ))
  }

  private func saveText() async {
    let emails = notify.split(whereSeparator: { $0 == "," || $0 == " " || $0 == "\n" }).map { JSONValue.string(String($0)) }
    await save([
      "title": .string(settings.title),
      "description": .string(settings.description),
      "commentNotify": .array(emails),
      "postUrl": .string(settings.postUrl),
      "newsletterTopic": .string(settings.newsletterTopic)
    ])
  }

  private func save(_ patch: [String: JSONValue]) async {
    saving = true
    saved = false
    error = ""
    defer { saving = false }
    do {
      try await store.saveSettings(patch)
      settings = store.settings
      saved = true
    } catch {
      self.error = error.localizedDescription
    }
  }
}

// MARK: - Design

/// How the hosted blog looks (web: BlogDesignSettings.vue): the front page's
/// layout, type, colours, the logo and a cover, the links in its header, social
/// profiles and a footer line. Choices save as they change, the addresses and
/// text with their own button, each as a partial `{ blog: { design } }` patch.
/// Admins only, like the settings.
struct BlogDesignSheet: View {
  let store: BlogStore
  /// The choices (layout, typeface, colour scheme, accent), saved as they change.
  @State private var design: BlogDesign
  @State private var logoUrl: String
  @State private var coverImageUrl: String
  @State private var footer: String
  @State private var nav: [NavRow]
  @State private var social: [String: String]
  @State private var saving = false
  @State private var saved = false
  @State private var error = ""
  @State private var uploading = ""
  @State private var logoPhoto: PhotosPickerItem?
  @State private var coverPhoto: PhotosPickerItem?
  @State private var accentSave: Task<Void, Never>?

  /// One header link while it is edited; rows with no label or address yet are kept here, not sent.
  private struct NavRow: Identifiable {
    let id = UUID()
    var label: String
    var url: String
  }

  private static let layoutLabels = ["list": "List", "grid": "Grid", "magazine": "Magazine"]
  private static let fontLabels = ["sans": "Sans serif", "serif": "Serif"]
  private static let schemeLabels = ["auto": "Follow the reader", "light": "Light", "dark": "Dark"]
  private static let socialLabels = ["x": "X", "bluesky": "Bluesky", "mastodon": "Mastodon", "github": "GitHub", "linkedin": "LinkedIn", "instagram": "Instagram", "youtube": "YouTube", "website": "Website"]

  init(store: BlogStore) {
    self.store = store
    let design = store.settings.design
    _design = State(initialValue: design)
    _logoUrl = State(initialValue: design.logoUrl)
    _coverImageUrl = State(initialValue: design.coverImageUrl)
    _footer = State(initialValue: design.footer)
    _nav = State(initialValue: design.navigation.map { NavRow(label: $0.label, url: $0.url) })
    _social = State(initialValue: design.social)
  }

  /// The design as last saved.
  private var current: BlogDesign { store.settings.design }
  private var projectAccent: String {
    let accent = store.projectAccent ?? ""
    return accent.isEmpty ? "#4f46e5" : accent
  }

  var body: some View {
    BlogSheetFrame(title: "Design") {
      hint("How the hosted blog looks. The embed takes your page's look, and the layout.")
      if !store.canManage { notice("Only admins change these settings.") }
      Group {
        choices
        HStack {
          if saving { ProgressView().controlSize(.small) }
          Text(saving ? "Saving…" : saved ? "Saved" : "Choices save as you change them").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
        images
        navigation
        socialLinks
        LabeledField(label: "Footer", hint: "A line at the bottom of every page, such as a copyright.") {
          TextField("", text: $footer).textFieldStyle(.linear)
            .onChange(of: footer) { _, value in if value.count > BlogLimits.footer { footer = String(value.prefix(BlogLimits.footer)) } }
        }
        Button { Task { await saveText() } } label: { Text("Save") }.buttonStyle(.lnSecondary).disabled(saving || textPatch.isEmpty)
      }
      .disabled(!store.canManage)
      ErrorText(message: error)
    } trailing: {}
    .onChange(of: logoPhoto) { _, item in Task { await upload(item, key: "logoUrl") } }
    .onChange(of: coverPhoto) { _, item in Task { await upload(item, key: "coverImageUrl") } }
  }

  // MARK: Choices

  @ViewBuilder private var choices: some View {
    LabeledField(label: "Layout") {
      Picker("Layout", selection: choice(\.layout, key: "layout")) {
        ForEach(BlogLimits.layouts, id: \.self) { Text(Self.layoutLabels[$0] ?? $0).tag($0) }
      }
      .pickerStyle(.segmented).labelsHidden()
    }
    HStack(alignment: .top, spacing: 12) {
      LabeledField(label: "Typeface") {
        FeedbackSelect(options: BlogLimits.fonts.map { FeedbackOption(value: $0, label: Self.fontLabels[$0] ?? $0) }, selection: choice(\.font, key: "font"))
      }
      LabeledField(label: "Colour scheme") {
        FeedbackSelect(options: BlogLimits.colorSchemes.map { FeedbackOption(value: $0, label: Self.schemeLabels[$0] ?? $0) }, selection: choice(\.colorScheme, key: "colorScheme"))
      }
    }
    LabeledField(label: "Accent colour", hint: "Links, buttons and tags. The project's accent unless you pick one.") {
      HStack(spacing: 10) {
        ColorPicker("Accent colour", selection: accentBinding, supportsOpacity: false).labelsHidden()
        Text(design.accent.isEmpty ? projectAccent : design.accent).font(.lnMono).foregroundStyle(Theme.textMuted)
        Spacer(minLength: 0)
        if !design.accent.isEmpty { Button("Use the project's") { setAccent("") }.buttonStyle(.lnGhost) }
      }
    }
  }

  /// A choice that saves as soon as it changes; the choices go back to what was saved if that fails.
  private func choice(_ keyPath: WritableKeyPath<BlogDesign, String>, key: String) -> Binding<String> {
    Binding(
      get: { design[keyPath: keyPath] },
      set: { value in
        guard value != design[keyPath: keyPath] else { return }
        design[keyPath: keyPath] = value
        Task { await saveChoice([key: .string(value)]) }
      }
    )
  }

  private func saveChoice(_ patch: [String: JSONValue]) async {
    if !(await save(patch)) { design = current }
  }

  private var accentBinding: Binding<Color> {
    Binding(get: { Color(hexString: design.accent.isEmpty ? projectAccent : design.accent) ?? Theme.accent }, set: { setAccent($0.hexString) })
  }

  /// The picker reports every step of a drag: the colour saves once it rests.
  private func setAccent(_ hex: String) {
    guard hex != design.accent else { return }
    design.accent = hex
    accentSave?.cancel()
    accentSave = Task {
      if !hex.isEmpty { try? await Task.sleep(for: .milliseconds(600)) }
      guard !Task.isCancelled else { return }
      await saveChoice(["accent": .string(hex)])
    }
  }

  // MARK: Addresses and text

  @ViewBuilder private var images: some View {
    imageField("Logo", hint: "Beside the blog's name. The project's logo when empty.", text: $logoUrl, photo: $logoPhoto, key: "logoUrl", wide: false)
    imageField("Cover image", hint: "A wide image across the top of the front page.", text: $coverImageUrl, photo: $coverPhoto, key: "coverImageUrl", wide: true)
  }

  private func imageField(_ label: String, hint: String, text: Binding<String>, photo: Binding<PhotosPickerItem?>, key: String, wide: Bool) -> some View {
    LabeledField(label: label, hint: hint) {
      VStack(alignment: .leading, spacing: 8) {
        if let url = URL(string: text.wrappedValue), text.wrappedValue.lowercased().hasPrefix("http") {
          CachedAsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Theme.elevated }
            .frame(width: wide ? nil : CGFloat(48), height: wide ? CGFloat(120) : CGFloat(48))
            .frame(maxWidth: wide ? CGFloat.infinity : nil, alignment: .leading)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.radius))
            .accessibilityHidden(true)
        }
        HStack(spacing: 8) {
          TextField("https://…", text: text).textFieldStyle(.linear).inputHints(.url, capitalization: .never).autocorrectionDisabled()
          PhotosPicker(selection: photo, matching: .images, preferredItemEncoding: .compatible) {
            if uploading == key { ProgressView().controlSize(.small) } else { Label("Upload", systemImage: "square.and.arrow.up") }
          }
          .buttonStyle(.lnSecondaryCompact)
          .disabled(!uploading.isEmpty)
        }
      }
    }
  }

  @ViewBuilder private var navigation: some View {
    SectionLabel("Navigation")
    hint("Links in the blog's header: a page of the blog (/about), the blog itself (/) or any address.")
    VStack(alignment: .leading, spacing: 8) {
      ForEach(nav) { row in
        HStack(spacing: 8) {
          TextField("Label", text: navBinding(row.id, \.label, limit: BlogLimits.navigationLabel)).textFieldStyle(.linear).frame(maxWidth: 140)
          TextField("/about", text: navBinding(row.id, \.url)).textFieldStyle(.linear).font(.lnMono).inputHints(.url, capitalization: .never).autocorrectionDisabled()
          IconButton(systemImage: "xmark", label: "Remove link") { nav.removeAll { $0.id == row.id } }
        }
      }
      if nav.count < BlogLimits.navigation {
        Button { nav.append(NavRow(label: "", url: "")) } label: { Label("Add a link", systemImage: "plus") }.buttonStyle(.lnSecondaryCompact)
      }
    }
  }

  /// One field of a link row, found by id so removing a row never leaves a field pointing past the end.
  private func navBinding(_ id: UUID, _ keyPath: WritableKeyPath<NavRow, String>, limit: Int = .max) -> Binding<String> {
    Binding(
      get: { nav.first { $0.id == id }?[keyPath: keyPath] ?? "" },
      set: { value in
        guard let index = nav.firstIndex(where: { $0.id == id }) else { return }
        nav[index][keyPath: keyPath] = String(value.prefix(limit))
      }
    )
  }

  @ViewBuilder private var socialLinks: some View {
    SectionLabel("Social links")
    ForEach(BlogLimits.socialNetworks, id: \.self) { network in
      LabeledField(label: Self.socialLabels[network] ?? network) {
        TextField("https://…", text: Binding(get: { social[network] ?? "" }, set: { social[network] = $0 }))
          .textFieldStyle(.linear).inputHints(.url, capitalization: .never).autocorrectionDisabled()
      }
    }
  }

  /// The logo, cover, footer, links and profiles that differ from the saved design.
  /// Links still being typed (no label or address yet) wait; a cleared profile is sent as "" to remove it.
  private var textPatch: [String: JSONValue] {
    var patch: [String: JSONValue] = [:]
    for (key, value, old) in [("logoUrl", logoUrl, current.logoUrl), ("coverImageUrl", coverImageUrl, current.coverImageUrl), ("footer", footer, current.footer)] {
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed != old { patch[key] = .string(trimmed) }
    }
    let links = nav.map { BlogNavLink(label: $0.label.trimmingCharacters(in: .whitespaces), url: $0.url.trimmingCharacters(in: .whitespaces)) }.filter { !$0.label.isEmpty && !$0.url.isEmpty }
    if links != current.navigation { patch["navigation"] = .array(links.map { .object(["label": .string($0.label), "url": .string($0.url)]) }) }
    var profiles: [String: JSONValue] = [:]
    for network in BlogLimits.socialNetworks {
      let value = (social[network] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      if value != (current.social[network] ?? "") { profiles[network] = .string(value) }
    }
    if !profiles.isEmpty { patch["social"] = .object(profiles) }
    return patch
  }

  // MARK: Saving

  private func saveText() async {
    let patch = textPatch
    guard !patch.isEmpty, await save(patch) else { return }
    // What the server settled on (a path lowercased, a profile removed); half-typed links stay.
    let fresh = current
    logoUrl = fresh.logoUrl
    coverImageUrl = fresh.coverImageUrl
    footer = fresh.footer
    nav = fresh.navigation.map { NavRow(label: $0.label, url: $0.url) } + nav.filter { $0.label.trimmingCharacters(in: .whitespaces).isEmpty || $0.url.trimmingCharacters(in: .whitespaces).isEmpty }
    social = fresh.social
  }

  @discardableResult private func save(_ patch: [String: JSONValue]) async -> Bool {
    saving = true
    saved = false
    error = ""
    defer { saving = false }
    do {
      try await store.saveDesign(patch)
      saved = true
      return true
    } catch {
      self.error = error.localizedDescription
      return false
    }
  }

  /// A photo goes to the project's storage and in as the logo or the cover, saved straight away.
  private func upload(_ item: PhotosPickerItem?, key: String) async {
    guard let item else { return }
    uploading = key
    defer {
      uploading = ""
      logoPhoto = nil
      coverPhoto = nil
    }
    do {
      guard let data = try await item.loadTransferable(type: Data.self) else { throw APIError.server("Could not read that photo.") }
      let url = try await store.uploadImage(data)
      if key == "logoUrl" { logoUrl = url } else { coverImageUrl = url }
      await save([key: .string(url)])
    } catch {
      self.error = error.localizedDescription
    }
  }
}

// MARK: - Import

/// Bring a Ghost blog over (web: BlogImportModal.vue): its JSON export, read here
/// to say what is in it and sent as it is. The server maps it and says what came
/// in; importing the same file again skips what came in before, or overwrites it.
struct BlogImportSheet: View {
  let store: BlogStore
  @State private var picking = false
  @State private var file: PickedFile?
  @State private var siteUrl = ""
  @State private var update = false
  @State private var busy = false
  @State private var error = ""
  @State private var result: BlogImportResult?

  private struct PickedFile {
    let name: String
    let data: Data
    let count: Int
  }

  var body: some View {
    BlogSheetFrame(title: "Import from Ghost") {
      hint("Bring your posts and pages over from a Ghost blog.")
      if let result {
        VStack(alignment: .leading, spacing: 6) {
          Label("\(result.created) added, \(result.updated) updated, \(result.skipped) skipped.", systemImage: result.warnings.isEmpty ? "checkmark.circle" : "exclamationmark.triangle")
            .font(.lnMetaMedium).foregroundStyle(result.warnings.isEmpty ? Theme.success : Theme.warning)
          ForEach(Array(result.warnings.enumerated()), id: \.offset) { _, warning in
            Text("• \(warning)").font(.lnCaption).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
          }
        }
      } else {
        LabeledField(label: "Ghost export", hint: "In Ghost: Settings → Advanced → Import/Export → Export content. A .json file.") {
          HStack(spacing: 8) {
            Button { picking = true } label: { Label(file?.name ?? "Choose the file", systemImage: "doc") }.buttonStyle(.lnSecondaryCompact)
            if let file {
              Text(file.count == 1 ? "1 post or page" : "\(file.count) posts and pages").font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
            }
          }
        }
        LabeledField(label: "Your Ghost site's address", hint: "The export writes links and images without it. They keep pointing at that site, so keep it up until you move the images.") {
          TextField("https://blog.example.com", text: $siteUrl).textFieldStyle(.linear).inputHints(.url, capitalization: .never).autocorrectionDisabled()
        }
        Card {
          CardRow(divider: false) {
            FeedbackToggleRow(title: "Overwrite posts imported before", detail: "Off: posts that came in from this blog before are left as they are now.", isOn: $update)
          }
        }
        hint("Members are a separate CSV (Members → Export in Ghost). Import it under Contacts: email, name, labels and newsletter consent are picked up.")
        Button { Task { await run() } } label: {
          if busy { HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Importing…") } } else { Label("Import", systemImage: "square.and.arrow.down") }
        }
        .buttonStyle(.lnPrimary)
        .disabled(file == nil || busy)
      }
      ErrorText(message: error)
    } trailing: {}
    .fileImporter(isPresented: $picking, allowedContentTypes: [.json]) { picked in
      switch picked {
      case .success(let url): Task { await read(url) }
      case .failure(let failure): error = failure.localizedDescription
      }
    }
    .interactiveDismissDisabled(busy)
  }

  /// Reads the file and checks it is a Ghost export before anything is sent.
  private func read(_ url: URL) async {
    error = ""
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    do {
      let (data, count) = try await Task.detached { () throws -> (Data, Int) in
        let data = try Data(contentsOf: url)
        return (data, try BlogGhostExport.read(data).count)
      }.value
      file = PickedFile(name: url.lastPathComponent, data: data, count: count)
    } catch {
      file = nil
      self.error = error.localizedDescription
    }
  }

  private func run() async {
    guard let file else { return }
    busy = true
    error = ""
    defer { busy = false }
    do {
      result = try await store.importGhost(data: file.data, siteUrl: siteUrl, update: update)
    } catch {
      self.error = error.localizedDescription
    }
  }
}

// MARK: - Newsletter

/// Email a published post to subscribers. It becomes a campaign (test sends,
/// pause, numbers under Email → Campaigns); "Save as a draft" stops there. A scheduled
/// post's newsletter waits for it: "Send" then means when it goes live.
struct BlogNewsletterSheet: View {
  let store: BlogStore
  let post: BlogPost
  @State private var subject: String
  @State private var topic: String
  @State private var later = false
  @State private var at = Date().addingTimeInterval(3600)
  @State private var busy = ""
  @State private var error = ""
  @Environment(\.dismiss) private var dismiss

  /// Published but not live yet: the email goes out when the post does.
  private var waits: Bool { post.status == "published" && !post.live }

  init(store: BlogStore, post: BlogPost) {
    self.store = store
    self.post = post
    _subject = State(initialValue: post.title)
    _topic = State(initialValue: store.settings.newsletterTopic)
  }

  var body: some View {
    BlogSheetFrame(title: "Send as newsletter") {
      hint("The post goes to your subscribers as a campaign: its title, cover and text, a button to read it on the blog, and the unsubscribe footer. A post goes out once.")
      LabeledField(label: "Subject") {
        TextField(post.title, text: $subject).textFieldStyle(.linear)
      }
      LabeledField(label: "Topic", hint: "Leaves out whoever opted out of it") {
        FeedbackSelect(options: [FeedbackOption(value: "", label: "Every subscriber")] + (store.project?.marketing?.topics ?? []).map { FeedbackOption(value: $0.key, label: $0.name.isEmpty ? $0.key : $0.name) }, selection: $topic)
      }
      Toggle("Send later", isOn: $later).font(.lnBody)
      if later {
        DatePicker("Send at", selection: $at, in: Date()..., displayedComponents: [.date, .hourAndMinute]).font(.lnBody)
      }
      if waits, let date = DateText.date(post.publishedAt) {
        notice("The post goes live \(date.formatted(date: .abbreviated, time: .shortened)). The newsletter goes out then, not before.")
      }
      if (store.project?.marketing?.postalAddress ?? "").isEmpty {
        hint("Campaigns must carry your postal address. Add it under Email → Settings first.")
      }
      if store.campaignsLocked {
        PlanLockNotice(feature: "campaigns")
      } else {
        HStack(spacing: 8) {
          Button { Task { await send("draft") } } label: { busyLabel("Save as a draft", "draft") }.buttonStyle(.lnSecondary)
          Spacer(minLength: 0)
          Button { Task { await send(later ? "schedule" : "now") } } label: { busyLabel(later ? "Schedule" : waits ? "Send when published" : "Send now", later ? "schedule" : "now") }.buttonStyle(.lnPrimary)
        }
        .disabled(!busy.isEmpty)
      }
      ErrorText(message: error)
    } trailing: {}
  }

  @ViewBuilder private func busyLabel(_ title: String, _ key: String) -> some View {
    if busy == key { ProgressView().controlSize(.small) } else { Text(title) }
  }

  private func send(_ mode: String) async {
    busy = mode
    error = ""
    defer { busy = "" }
    do {
      _ = try await store.sendNewsletter(post.id, subject: subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? post.title : subject, topic: topic, send: mode, scheduledAt: mode == "schedule" ? at : nil)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
