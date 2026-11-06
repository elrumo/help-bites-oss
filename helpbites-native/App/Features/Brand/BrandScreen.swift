import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// A project's brand kit (web: projects/[id]/brand.vue): its files, colours and
/// type, guidelines, and the public page. Files save as soon as they change; the
/// rest is one draft saved together.
struct BrandScreen: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.openURL) private var openURL
  @State private var tab: BrandTab = .files
  /// The kit as the server last returned it, and the draft being edited.
  @State private var saved: BrandConfig?
  @State private var config: BrandConfig?
  @State private var assets: [BrandAsset] = []
  /// `/brand/<pk>`.
  @State private var pagePath = ""
  @State private var loading = true
  @State private var saving = false
  @State private var error = ""
  @State private var notice = ""
  @State private var photos: [PhotosPickerItem] = []
  @State private var importing = false
  @State private var uploading = 0
  @State private var editing: BrandAsset?
  @State private var deleting: BrandAsset?
  @State private var previewPage: BrandPreviewPage?
  @State private var previewLoading = false

  private enum BrandTab: String, CaseIterable, Identifiable {
    case files, style, guidelines, page
    var id: String { rawValue }
    var label: String {
      switch self {
      case .files: String(localized: "Files")
      case .style: String(localized: "Style")
      case .guidelines: String(localized: "Guidelines")
      case .page: String(localized: "Page")
      }
    }
  }

  private var dirty: Bool { config != nil && config != saved }
  private var publicURL: URL? { pagePath.isEmpty ? nil : LegalAPI.publicURL(session, pagePath) }
  private static let fileTypes: [UTType] = [.png, .jpeg, .gif, .webP, .svg, .ico, .pdf]

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Brand kit").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text("Keep your logos, icons, screenshots, colours, fonts and guidelines in one place, and share them on a public page, an embed or the API.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
        }
        Picker("Section", selection: $tab) {
          ForEach(BrandTab.allCases) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 440)
        ErrorText(message: error)
        if !notice.isEmpty { Label(notice, systemImage: "checkmark").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        if loading && config == nil {
          SkeletonRows(count: 4)
        } else if let config = Binding($config) {
          switch tab {
          case .files: files
          case .style: style(config)
          case .guidelines: guidelines(config)
          case .page: page(config)
          }
        }
      }
      .frame(maxWidth: tab == .files ? 1000 : 760, alignment: .leading)
      .padding(.horizontal, 20)
      .padding(.vertical, 28)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .refreshable { await load() }
    .projectScreen(projectId, "Brand")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        if dirty {
          Button { Task { await save() } } label: { Text(saving ? "Saving…" : "Save") }
            .keyboardShortcut("s", modifiers: .command).disabled(saving)
        }
      }
    }
    .sheet(item: $editing) { asset in
      BrandAssetSheet(asset: asset) { updated in
        if let index = assets.firstIndex(where: { $0.id == updated.id }) { assets[index] = updated }
      }
    }
    .sheet(item: $previewPage) { page in
      NavigationStack {
        SandboxedWebView(html: page.html)
          .panelScreen("Preview")
          .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { previewPage = nil } } }
      }
      .presentationDetents([.large])
    }
    .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { asset in
      Button("Delete file", role: .destructive) { Task { await delete(asset) } }
    } message: { _ in
      Text("It leaves the kit and the public page, and links to it stop working.")
    }
    .onChange(of: photos) { _, items in
      guard !items.isEmpty else { return }
      photos = []
      Task {
        for item in items {
          guard let data = try? await item.loadTransferable(type: Data.self) else { error = String(localized: "Could not read that photo."); continue }
          await upload(data, filename: "Photo.\(item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg")")
        }
      }
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: Self.fileTypes, allowsMultipleSelection: true) { result in
      switch result {
      case .failure(let failure): error = failure.localizedDescription
      case .success(let urls):
        let files: [(Data, String)] = urls.compactMap { url in
          let scoped = url.startAccessingSecurityScopedResource()
          defer { if scoped { url.stopAccessingSecurityScopedResource() } }
          return (try? Data(contentsOf: url)).map { ($0, url.lastPathComponent) }
        }
        if files.count < urls.count { error = String(localized: "Some files could not be read.") }
        Task { for (data, name) in files { await upload(data, filename: name) } }
      }
    }
    .task { if config == nil { await load() } }
  }

  // MARK: Files

  private var files: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 8) {
        Button { importing = true } label: { Label("Upload files", systemImage: "square.and.arrow.up") }.buttonStyle(.lnPrimaryCompact)
        #if os(iOS)
        PhotosPicker(selection: $photos, maxSelectionCount: 20, matching: .images, preferredItemEncoding: .compatible) {
          Label("Photos", systemImage: "photo.on.rectangle")
        }
        .buttonStyle(.lnSecondaryCompact)
        #endif
        if uploading > 0 {
          ProgressView().controlSize(.small)
          Text("Uploading…").font(.lnCaption).foregroundStyle(Theme.textMuted)
        }
        Spacer(minLength: 0)
      }
      .disabled(uploading > 0)
      Text("PNG, JPEG, GIF, WebP, SVG, ICO and PDF, up to 20 MB each. Changes to files save straight away.")
        .font(.lnCaption).foregroundStyle(Theme.textMuted)
      if assets.isEmpty {
        EmptyState(systemImage: "photo.stack", title: "No files yet", message: "Upload your logos, app icon, favicon, screenshots and press images.")
          .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
      } else {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
          ForEach(assets) { tile($0) }
        }
      }
    }
  }

  private func tile(_ asset: BrandAsset) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      BrandThumbnail(asset: asset).frame(height: 120).frame(maxWidth: .infinity)
      Rectangle().fill(Theme.border).frame(height: Hairline.width)
      HStack(alignment: .top, spacing: 4) {
        VStack(alignment: .leading, spacing: 2) {
          Text(asset.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Text(BrandOptions.kindLabel(asset.kind)).font(.lnCaption).foregroundStyle(Theme.textMuted)
          Text(asset.detail).font(.lnCaption).foregroundStyle(Theme.textDimmed).lineLimit(1)
        }
        Spacer(minLength: 0)
        Menu { actions(asset) } label: {
          Image(systemName: "ellipsis").font(.app(size: 14, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 28, height: 28).contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .accessibilityLabel("Actions for \(asset.name)")
      }
      .padding(10)
    }
    .background(Theme.panel)
    .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    .overlay(alignment: .topLeading) {
      if !asset.public { Tag(text: "Private").background(Theme.panel, in: Capsule()).padding(8) }
    }
    .contextMenu { actions(asset) }
  }

  @ViewBuilder private func actions(_ asset: BrandAsset) -> some View {
    Button { editing = asset } label: { Label("Edit", systemImage: "pencil") }
    Button { Clipboard.copy(asset.url); flash(String(localized: "Copied the file's URL.")) } label: { Label("Copy URL", systemImage: "link") }
    if let url = LegalAPI.publicURL(session, asset.downloadUrl) {
      // The download is public: it answers only while the page and the file are.
      Button { openURL(url) } label: { Label("Open download", systemImage: "arrow.down.circle") }
        .disabled(!(saved?.page.public ?? false) || !asset.public)
    }
    if asset.isImage {
      Divider()
      Button { Task { await useForProject(asset, field: "brandLogoUrl") } } label: { Label("Use as project logo", systemImage: "photo") }
      Button { Task { await useForProject(asset, field: "iconUrl") } } label: { Label("Use as project icon", systemImage: "app") }
    }
    Divider()
    Button(role: .destructive) { deleting = asset } label: { Label("Delete", systemImage: "trash") }
  }

  // MARK: Style

  private func style(_ config: Binding<BrandConfig>) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      ProjectStyleActions(projectId: projectId)
      LegalPanel("Words") {
        LabeledField(label: "Tagline") { TextField("One line about the app", text: config.tagline).textFieldStyle(.linear) }
        LabeledField(label: "About", hint: "Blank lines start a new paragraph") {
          LinearTextEditor(text: config.about, placeholder: String(localized: "What the app is and who it is for, for press and partners"), minHeight: 120)
        }
      }

      LegalPanel(title: "Colours", trailing: { count(config.wrappedValue.colors.count, of: BrandLimits.colors) }, content: {
        let colors = config.wrappedValue.colors
        ForEach(colors.indices, id: \.self) { index in
          colorRow(element(config.colors, index, BrandColor()), index: index, count: colors.count, list: config.colors)
          if index < colors.count - 1 { Rectangle().fill(Theme.border).frame(height: Hairline.width) }
        }
        Button { config.wrappedValue.colors.append(BrandColor()) } label: { Label("Add colour", systemImage: "plus") }
          .buttonStyle(.lnSecondaryCompact).disabled(colors.count >= BrandLimits.colors)
      })

      LegalPanel(title: "Fonts", trailing: { count(config.wrappedValue.fonts.count, of: BrandLimits.fonts) }, content: {
        let fonts = config.wrappedValue.fonts
        ForEach(fonts.indices, id: \.self) { index in
          fontRow(element(config.fonts, index, BrandFont()), index: index, count: fonts.count, list: config.fonts)
          if index < fonts.count - 1 { Rectangle().fill(Theme.border).frame(height: Hairline.width) }
        }
        Button { config.wrappedValue.fonts.append(BrandFont()) } label: { Label("Add font", systemImage: "plus") }
          .buttonStyle(.lnSecondaryCompact).disabled(fonts.count >= BrandLimits.fonts)
      })
    }
  }

  private func colorRow(_ color: Binding<BrandColor>, index: Int, count: Int, list: Binding<[BrandColor]>) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        ColorPicker("Colour", selection: Binding(get: { Color(hexString: color.wrappedValue.hex) ?? .black }, set: { color.wrappedValue.hex = $0.hexString }), supportsOpacity: false)
          .labelsHidden()
        TextField("Name", text: color.name).textFieldStyle(.linear)
        ReorderControls(index: index, count: count, move: { list.wrappedValue.move(index, by: $0) }, remove: { list.wrappedValue.remove(at: index) })
      }
      HStack(spacing: 8) {
        TextField("#rrggbb", text: color.hex).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled().frame(width: 110)
        TextField("Usage, e.g. buttons and links", text: color.usage).textFieldStyle(.linear)
      }
    }
  }

  private func fontRow(_ font: Binding<BrandFont>, index: Int, count: Int, list: Binding<[BrandFont]>) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        TextField("Font name", text: font.name).textFieldStyle(.linear)
        Picker("Role", selection: font.role) {
          ForEach(BrandOptions.fontRoles, id: \.id) { Text($0.label).tag($0.id) }
        }
        .labelsHidden().fixedSize()
        ReorderControls(index: index, count: count, move: { list.wrappedValue.move(index, by: $0) }, remove: { list.wrappedValue.remove(at: index) })
      }
      LabeledField(label: "Google Fonts CSS URL", hint: "A https://fonts.googleapis.com/css2 link sets the public page in this font") {
        TextField("https://fonts.googleapis.com/css2?family=…", text: font.cssUrl).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      LabeledField(label: "Download URL") {
        TextField("https://", text: font.downloadUrl).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      HStack(spacing: 8) {
        TextField("Weights, e.g. 400, 600", text: font.weights).textFieldStyle(.linear).frame(maxWidth: 200)
        TextField("Sample sentence", text: font.sample).textFieldStyle(.linear)
      }
    }
  }

  // MARK: Guidelines

  private func guidelines(_ config: Binding<BrandConfig>) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Text("Clear space, minimum sizes, what not to do, tone of voice. Bodies are Markdown.").font(.lnMeta).foregroundStyle(Theme.textMuted)
        Spacer(minLength: 8)
        count(config.wrappedValue.guidelines.count, of: BrandLimits.guidelines)
      }
      ForEach(config.guidelines) { $guideline in
        let list = config.wrappedValue.guidelines
        let index = list.firstIndex { $0.id == guideline.id } ?? 0
        LegalPanel(title: guideline.title.isEmpty ? String(localized: "Guideline \(index + 1)") : guideline.title, trailing: {
          ReorderControls(index: index, count: list.count, move: { config.wrappedValue.guidelines.move(index, by: $0) }, remove: {
            config.wrappedValue.guidelines.removeAll { $0.id == guideline.id }
          })
        }, content: {
          TextField("Title", text: $guideline.title).textFieldStyle(.linear)
          LinearTextEditor(text: $guideline.body, placeholder: String(localized: "Markdown: **bold**, lists, links"), minHeight: 140, monospaced: true)
        })
      }
      Button { config.wrappedValue.guidelines.append(.blank()) } label: { Label("Add guideline", systemImage: "plus") }
        .buttonStyle(.lnSecondaryCompact).disabled(config.wrappedValue.guidelines.count >= BrandLimits.guidelines)
    }
  }

  // MARK: Page

  private func page(_ config: Binding<BrandConfig>) -> some View {
    let page = config.page
    return VStack(alignment: .leading, spacing: 16) {
      LegalPanel("Public page") {
        Toggle(isOn: page.public) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Public page").font(.lnRow).foregroundStyle(Theme.text)
            Text("Anyone with the link sees the kit and downloads its public files. Off, the page and the API answer 404.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
        }
        .toggleStyle(.switch).tint(Theme.accent)
        if let publicURL {
          Text(publicURL.absoluteString).font(.lnMono).foregroundStyle(Theme.textToned).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
          HStack(spacing: 8) {
            Button { openURL(publicURL) } label: { Label("Open", systemImage: "arrow.up.right.square") }.buttonStyle(.lnSecondaryCompact)
              .disabled(!(saved?.page.public ?? false))
            Button { Clipboard.copy(publicURL.absoluteString); flash(String(localized: "Copied the link.")) } label: { Label("Copy link", systemImage: "link") }.buttonStyle(.lnSecondaryCompact)
          }
        }
        if page.wrappedValue.public != saved?.page.public { Text("Save to apply.").font(.lnCaption).foregroundStyle(Theme.warning) }
      }

      LegalPanel("Template") {
        ForEach(BrandOptions.templates, id: \.id) { template in
          let selected = page.wrappedValue.template == template.id
          Button { page.wrappedValue.template = template.id } label: {
            HStack(alignment: .top, spacing: 10) {
              Image(systemName: selected ? "largecircle.fill.circle" : "circle").foregroundStyle(selected ? Theme.accent : Theme.textDimmed)
              VStack(alignment: .leading, spacing: 2) {
                Text(template.label).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                Text(template.description).font(.lnCaption).foregroundStyle(Theme.textMuted)
              }
              Spacer(minLength: 0)
            }
            .padding(10)
            .background(selected ? Theme.elevated : Color.clear, in: RoundedRectangle(cornerRadius: Metrics.radius))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(selected ? Theme.borderAccented : Theme.border))
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(selected ? .isSelected : [])
        }
      }

      LegalPanel("Look") {
        LabeledField(label: "Theme") {
          Picker("Theme", selection: page.theme) { ForEach(BrandOptions.themes, id: \.id) { Text($0.label).tag($0.id) } }.pickerStyle(.segmented).labelsHidden()
        }
        LabeledField(label: "Corners") {
          Picker("Corners", selection: page.radius) { ForEach(BrandOptions.radii, id: \.id) { Text(LocalizedStringKey($0.label)).tag($0.id) } }.pickerStyle(.segmented).labelsHidden()
        }
        OptionalColorField(label: "Accent", hex: page.accent, fallback: Color(hexString: config.wrappedValue.colors.first?.hex) ?? Theme.accent, empty: "First colour")
        LabeledField(label: "Headline", hint: "Empty shows the project's name") {
          TextField(workspace.project(projectId)?.name ?? "", text: page.headline).textFieldStyle(.linear)
        }
        LabeledField(label: "Intro", hint: "Empty shows the tagline") {
          LinearTextEditor(text: page.intro, placeholder: config.wrappedValue.tagline, minHeight: 72)
        }
      }

      LegalPanel("Sections") {
        Text("Which sections show, in order. A section with nothing in it is left out.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        let shown = page.wrappedValue.sections
        ForEach(shown + BrandOptions.sections.map(\.id).filter { !shown.contains($0) }, id: \.self) { id in
          let index = shown.firstIndex(of: id)
          HStack(spacing: 8) {
            Toggle(BrandOptions.sections.first { $0.id == id }?.label ?? id, isOn: Binding(
              get: { index != nil },
              set: { on in if on { page.wrappedValue.sections.append(id) } else { page.wrappedValue.sections.removeAll { $0 == id } } }
            ))
            .toggleStyle(.switch).tint(Theme.accent).font(.lnRow)
            if let index {
              ReorderControls(index: index, count: shown.count, move: { page.wrappedValue.sections.move(index, by: $0) })
            } else {
              Color.clear.frame(width: 64, height: 32)
            }
          }
        }
      }

      LegalPanel("Embed") {
        Text("Put the page on your own site. Turn the public page on first.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        CodeBlock(code: embedSnippet)
      }

      Button { Task { await preview() } } label: {
        HStack(spacing: 6) {
          if previewLoading { ProgressView().controlSize(.small) } else { Image(systemName: "eye") }
          Text("Preview the page")
        }
      }
      .buttonStyle(.lnSecondaryCompact).disabled(previewLoading)
    }
  }

  private var embedSnippet: String {
    let base = session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let key = workspace.project(projectId)?.publicKey ?? "pk_…"
    return "<div id=\"brand\"></div>\n<script src=\"\(base)/brand.js\" data-project=\"\(key)\" data-target=\"#brand\" defer></script>"
  }

  // MARK: Helpers

  private func count(_ value: Int, of limit: Int) -> some View {
    Text("\(value) of \(limit)").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
  }

  /// One item of a list by position, safe while a removal re-renders the list.
  private func element<Item>(_ list: Binding<[Item]>, _ index: Int, _ fallback: Item) -> Binding<Item> {
    Binding(
      get: { list.wrappedValue.indices.contains(index) ? list.wrappedValue[index] : fallback },
      set: { if list.wrappedValue.indices.contains(index) { list.wrappedValue[index] = $0 } }
    )
  }

  private func flash(_ text: String) {
    notice = text
    Task {
      try? await Task.sleep(for: .seconds(3))
      if notice == text { notice = "" }
    }
  }

  // MARK: Requests

  private func load() async {
    struct Response: Decodable, Sendable { let brand: BrandConfig; let assets: [BrandAsset]; let url: String }
    do {
      let response: Response = try await session.get("/v1/admin/brand", query: ["project": projectId])
      // A refresh keeps unsaved edits.
      if !dirty { config = response.brand }
      saved = response.brand
      assets = response.assets
      pagePath = response.url
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
  }

  /// The whole draft; the server replaces each list and merges `page`.
  private func save() async {
    struct Response: Decodable, Sendable { let brand: BrandConfig }
    guard let config else { return }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let response: Response = try await session.send("/v1/admin/brand?project=\(projectId)", method: "PATCH", body: config)
      saved = response.brand
      self.config = response.brand
      flash(String(localized: "Saved."))
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func upload(_ data: Data, filename: String) async {
    uploading += 1
    defer { uploading -= 1 }
    let mime = UTType(filenameExtension: (filename as NSString).pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    do {
      let response: BrandAssetResponse = try await session.upload("/v1/admin/brand/assets", fields: ["project": projectId], file: data, filename: filename, mimeType: mime)
      assets.append(response.asset)
    } catch {
      self.error = "\(filename): \(error.localizedDescription)"
    }
  }

  private func delete(_ asset: BrandAsset) async {
    do {
      try await session.delete("/v1/admin/brand/assets/\(asset.id)")
      assets.removeAll { $0.id == asset.id }
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// `PATCH /v1/admin/projects/:id` with `brandLogoUrl` or `iconUrl` (admins only; the server says so otherwise).
  private func useForProject(_ asset: BrandAsset, field: String) async {
    error = ""
    do {
      _ = try await ProjectsAdminProject.save(projectId, [field: asset.url], workspace: workspace)
      flash(field == "iconUrl" ? String(localized: "“\(asset.name)” is now the project icon.") : String(localized: "“\(asset.name)” is now the project logo."))
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// The public page as it would look with the unsaved draft.
  private func preview() async {
    struct Input: Encodable, Sendable { let brand: BrandConfig }
    struct Output: Decodable, Sendable { let html: String }
    guard let config else { return }
    previewLoading = true
    error = ""
    defer { previewLoading = false }
    do {
      let output: Output = try await session.send("/v1/admin/brand/preview?project=\(projectId)", body: Input(brand: config))
      previewPage = BrandPreviewPage(html: output.html)
    } catch {
      self.error = error.localizedDescription
    }
  }
}

private struct BrandPreviewPage: Identifiable {
  let id = UUID()
  let html: String
}

/// A file's tile: the image on the background it is drawn for, or its type for PDFs, icons and SVGs the system cannot draw.
private struct BrandThumbnail: View {
  let asset: BrandAsset

  var body: some View {
    ZStack {
      backdrop
      if asset.isImage, asset.mime != "image/x-icon", let url = URL(string: asset.url) {
        CachedAsyncImage(url: url) { phase in
          switch phase {
          case .success(let image): image.resizable().scaledToFit().padding(14)
          case .failure: typeLabel
          default: ProgressView().controlSize(.small)
          }
        }
      } else {
        typeLabel
      }
    }
    .clipped()
    .accessibilityHidden(true)
  }

  private var typeLabel: some View {
    Text(asset.typeLabel)
      .font(.app(size: 12, weight: .semibold, design: .monospaced))
      .foregroundStyle(asset.background == "dark" ? Color.white.opacity(0.75) : Theme.textMuted)
      .padding(.horizontal, 10).padding(.vertical, 6)
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusSmall).strokeBorder(asset.background == "dark" ? Color.white.opacity(0.25) : Theme.borderAccented))
  }

  @ViewBuilder private var backdrop: some View {
    switch asset.background {
    case "light": Color.white
    case "dark": Color(white: 0.09)
    default:
      Canvas { context, size in
        let cell: CGFloat = 8
        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Theme.elevated))
        for row in 0..<Int((size.height / cell).rounded(.up)) {
          for column in 0..<Int((size.width / cell).rounded(.up)) where (row + column).isMultiple(of: 2) {
            context.fill(Path(CGRect(x: CGFloat(column) * cell, y: CGFloat(row) * cell, width: cell, height: cell)), with: .color(Theme.accented))
          }
        }
      }
    }
  }
}
