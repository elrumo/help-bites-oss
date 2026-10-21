import PhotosUI
import SwiftUI

/// One onboarding flow (web: projects/[id]/onboarding/[flowId].vue): its name and
/// key, steps, look and behaviour, with a live preview beside it (in a sheet on
/// iPhone). Edits save together; publishing freezes them into the next version.
struct OnboardingFlowScreen: View {
  let projectId: String
  let flowId: String
  @Environment(SessionStore.self) private var session
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var flow: OnboardingFlow?
  @State private var draft: OnboardingDraft?
  /// The project's brand kit images, offered as step pictures.
  @State private var brandImages: [BrandAsset] = []
  @State private var loading = true
  @State private var error = ""
  /// save, publish, unpublish or delete while that request runs.
  @State private var busy = ""
  @State private var previewing = false
  @State private var confirm: Confirm?
  @State private var sharedFile: EmailSharedFile?

  private enum Confirm: String, Identifiable { case unpublish, delete; var id: String { rawValue } }

  /// The preview sits beside the form on iPad and the Mac.
  private var wide: Bool { sizeClass != .compact }
  private var dirty: Bool { flow.map { draft != OnboardingDraft($0) } ?? false }
  private var projectAccent: String? { workspace.project(projectId)?.theme.accent }

  var body: some View {
    Group {
      if let flow, let draft = Binding($draft) {
        editor(flow, draft)
      } else if loading {
        SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
      } else {
        VStack(spacing: 12) {
          ErrorText(message: error.isEmpty ? "Flow not found" : error)
          Button("Try again") { Task { await load() } }.buttonStyle(.lnSecondaryCompact)
        }
        .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      }
    }
    .projectScreen(projectId, flow?.name ?? "Flow")
    .toolbar { if let flow { toolbar(flow) } }
    .confirmationDialog(confirm == .delete ? "Delete this flow?" : "Unpublish this flow?", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { item in
      switch item {
      case .unpublish: Button("Unpublish") { Task { await run("unpublish") } }
      case .delete: Button("Delete flow", role: .destructive) { Task { await delete() } }
      }
    } message: { item in
      switch item {
      case .unpublish: Text("Its URL answers 404 and apps stop showing it. The published copy is kept until you publish again.")
      case .delete: Text("Apps asking for it get a 404 and stop showing it. This cannot be undone.")
      }
    }
    .sheet(item: $sharedFile) { ShareSheet(url: $0.url).presentationDetents([.medium, .large]) }
    .sheet(isPresented: $previewing) {
      NavigationStack {
        ScrollView { if let draft { preview(draft).padding(20) } }
          .panelScreen("Preview")
          .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { previewing = false } } }
      }
      .presentationDetents([.large])
    }
    .task { if flow == nil { await load() } }
  }

  // MARK: Toolbar

  @ToolbarContentBuilder private func toolbar(_ flow: OnboardingFlow) -> some ToolbarContent {
    ToolbarItem(placement: .primaryAction) {
      Menu {
        if flow.isPublished {
          Button { confirm = .unpublish } label: { Label("Unpublish", systemImage: "eye.slash") }.disabled(busy != "")
        }
        Button { download(flow) } label: { Label("Download offline copy", systemImage: "arrow.down.doc") }.disabled(flow.published == nil)
        Button { Clipboard.copy(snippet(flow)) } label: { Label("Copy install snippet", systemImage: "chevron.left.forwardslash.chevron.right") }
        Divider()
        Button(role: .destructive) { confirm = .delete } label: { Label("Delete flow", systemImage: "trash") }.disabled(busy != "")
      } label: { Label("More", systemImage: "ellipsis.circle") }
    }
    if !wide {
      ToolbarItem(placement: .primaryAction) {
        Button { previewing = true } label: { Label("Preview", systemImage: "eye") }
      }
    }
    ToolbarItem(placement: .primaryAction) {
      if dirty {
        Button { Task { await save() } } label: { Text(busy == "save" ? "Saving…" : "Save") }
          .keyboardShortcut("s", modifiers: .command).disabled(busy != "")
      } else if !flow.isPublished || flow.changed {
        Button { Task { await run("publish") } } label: { Text(busy == "publish" ? "Publishing…" : flow.isPublished ? "Publish changes" : "Publish") }
          .disabled(busy != "")
      }
    }
  }

  // MARK: Layout

  @ViewBuilder private func editor(_ flow: OnboardingFlow, _ draft: Binding<OnboardingDraft>) -> some View {
    let fields = ScrollView {
      form(flow, draft).frame(maxWidth: 680, alignment: .leading).padding(20).frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    if wide {
      HStack(spacing: 0) {
        fields
        Rectangle().fill(Theme.border).frame(width: Hairline.width)
        ScrollView { preview(draft.wrappedValue).padding(20) }.frame(width: 360).background(Theme.canvas)
      }
    } else {
      fields
    }
  }

  private func preview(_ draft: OnboardingDraft) -> some View {
    OnboardingPreview(steps: draft.steps, style: draft.style, options: draft.options, projectAccent: projectAccent)
  }

  private func form(_ flow: OnboardingFlow, _ draft: Binding<OnboardingDraft>) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 8) {
        Tag(text: flow.statusLabel, tint: flow.isPublished ? Theme.success : Theme.textDimmed)
        if let published = flow.publishedAt, flow.isPublished { Text(DateText.day(published)).font(.lnCaption).foregroundStyle(Theme.textMuted) }
        if dirty { Text("Unsaved changes").font(.lnCaption).foregroundStyle(Theme.warning) }
      }
      if flow.changed {
        Label("These changes are not published yet. Apps keep showing version \(flow.version) until you publish.", systemImage: "info.circle")
          .font(.lnMeta).foregroundStyle(Theme.warning)
      }
      ErrorText(message: error)

      LegalPanel("Details") {
        OnboardingTextField(label: "Name", text: draft.name, limit: OnboardingLimits.name)
        LabeledField(label: "Key", hint: OnboardingLimits.validKey(draft.wrappedValue.key) ? "Your app asks for the flow by its key. Changing it on a published flow moves its URL." : OnboardingLimits.keyRule) {
          TextField("welcome", text: draft.key).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
      }

      HStack {
        SectionLabel("Steps")
        Text("\(draft.wrappedValue.steps.count) of \(OnboardingLimits.steps)").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
      }
      ForEach(draft.steps) { $step in
        let index = draft.wrappedValue.steps.firstIndex { $0.id == step.id } ?? 0
        OnboardingStepCard(
          step: $step, index: index, count: draft.wrappedValue.steps.count, projectId: projectId, brandImages: brandImages,
          move: { draft.wrappedValue.steps.move(index, by: $0) },
          remove: { draft.wrappedValue.steps.removeAll { $0.id == step.id } }
        )
      }
      Button { draft.wrappedValue.steps.append(.blank()) } label: { Label("Add step", systemImage: "plus") }
        .buttonStyle(.lnSecondaryCompact).disabled(draft.wrappedValue.steps.count >= OnboardingLimits.steps)

      LegalPanel("Look") {
        OptionalColorField(label: "Accent", hex: draft.style.accent, fallback: Color(hexString: projectAccent) ?? Theme.accent, empty: "Project accent")
        OptionalColorField(label: "Background", hex: draft.style.background, fallback: .white, empty: "Follows light or dark")
        OptionalColorField(label: "Text", hex: draft.style.text, fallback: .black, empty: "Follows light or dark")
        LabeledField(label: "Corner radius") {
          HStack(spacing: 12) {
            Slider(value: Binding(get: { Double(draft.wrappedValue.style.radius) }, set: { draft.wrappedValue.style.radius = Int($0.rounded()) }), in: 0...Double(OnboardingLimits.radius), step: 1)
              .tint(Theme.accent)
            Text("\(draft.wrappedValue.style.radius) pt").font(.lnMeta).foregroundStyle(Theme.textMuted).monospacedDigit().frame(width: 44, alignment: .trailing)
          }
        }
        LabeledField(label: "Font") {
          Picker("Font", selection: draft.style.font) {
            ForEach(OnboardingLimits.fonts, id: \.id) { Text($0.label).tag($0.id) }
          }
          .pickerStyle(.segmented).labelsHidden()
        }
      }

      LegalPanel("Behaviour") {
        Toggle(isOn: draft.options.skippable) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Skippable").font(.lnRow).foregroundStyle(Theme.text)
            Text("Shows Skip, and lets Escape close it on the web.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
        }
        .toggleStyle(.switch).tint(Theme.accent)
        LabeledField(label: "Progress") {
          Picker("Progress", selection: draft.options.progress) {
            ForEach(OnboardingLimits.progress, id: \.id) { Text($0.label).tag($0.id) }
          }
          .pickerStyle(.segmented).labelsHidden()
        }
      }
    }
  }

  // MARK: Actions

  private func apply(_ flow: OnboardingFlow) {
    self.flow = flow
    draft = OnboardingDraft(flow)
  }

  private func load() async {
    loading = true
    do {
      let response: OnboardingFlowResponse = try await session.get("/v1/admin/onboarding/flows/\(flowId)")
      apply(response.flow)
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
    struct Kit: Decodable, Sendable { let assets: [BrandAsset] }
    if let kit: Kit = try? await session.get("/v1/admin/brand", query: ["project": projectId]) {
      brandImages = kit.assets.filter { $0.mime.hasPrefix("image/") }
    }
  }

  private func save() async {
    guard var body = draft else { return }
    body.name = body.name.trimmingCharacters(in: .whitespacesAndNewlines)
    body.key = body.key.trimmingCharacters(in: .whitespaces).lowercased()
    if body.name.isEmpty { error = "Give the flow a name."; return }
    if !OnboardingLimits.validKey(body.key) { error = OnboardingLimits.keyRule; return }
    busy = "save"
    error = ""
    defer { busy = "" }
    do {
      let response: OnboardingFlowResponse = try await session.send("/v1/admin/onboarding/flows/\(flowId)", method: "PATCH", body: body)
      apply(response.flow)
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// publish or unpublish.
  private func run(_ action: String) async {
    busy = action
    error = ""
    defer { busy = "" }
    do {
      let response: OnboardingFlowResponse = try await session.send("/v1/admin/onboarding/flows/\(flowId)/\(action)")
      apply(response.flow)
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func delete() async {
    busy = "delete"
    defer { busy = "" }
    do {
      try await session.delete("/v1/admin/onboarding/flows/\(flowId)")
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }

  /// `onboarding-<key>.json`: the same `{ flow }` the public API answers, for apps to bundle.
  private func download(_ flow: OnboardingFlow) {
    struct Envelope: Encodable { let flow: OnboardingPublicFlow }
    guard let published = flow.published else { return }
    do { sharedFile = EmailSharedFile(url: try EmailFiles.write(try EmailFiles.prettyJSON(Envelope(flow: published)), named: "onboarding-\(flow.key).json")) }
    catch { self.error = error.localizedDescription }
  }

  private func snippet(_ flow: OnboardingFlow) -> String {
    let base = session.endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let key = workspace.project(projectId)?.publicKey ?? "pk_…"
    return "<script src=\"\(base)/onboarding.js\" data-project=\"\(key)\" data-flow=\"\(flow.key)\" defer></script>"
  }
}

/// A text field with its character count against the server's limit, which it never lets the text pass.
private struct OnboardingTextField: View {
  let label: String
  @Binding var text: String
  let limit: Int
  var placeholder = ""
  var multiline = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(label).font(.lnMetaMedium).foregroundStyle(Theme.textToned)
        Spacer()
        Text("\(text.utf16.count)/\(limit)").font(.lnCaption).foregroundStyle(Theme.textDimmed).monospacedDigit()
      }
      if multiline {
        LinearTextEditor(text: $text, placeholder: placeholder, minHeight: 88)
      } else {
        TextField(placeholder, text: $text).textFieldStyle(.linear)
      }
    }
    .onChange(of: text) { _, value in
      if value.utf16.count > limit { text = value.clipped(to: limit) }
    }
  }
}

/// One step: title, body, picture (upload, URL or brand kit), its alt text and the button label.
private struct OnboardingStepCard: View {
  @Binding var step: OnboardingStep
  let index: Int
  let count: Int
  let projectId: String
  let brandImages: [BrandAsset]
  let move: (Int) -> Void
  let remove: () -> Void
  @Environment(SessionStore.self) private var session
  @State private var photo: PhotosPickerItem?
  @State private var importing = false
  @State private var uploading = false
  @State private var error = ""

  var body: some View {
    LegalPanel(title: "Step \(index + 1)", trailing: {
      ReorderControls(index: index, count: count, move: move, remove: remove)
    }, content: {
      OnboardingTextField(label: "Title", text: $step.title, limit: OnboardingLimits.title)
      OnboardingTextField(label: "Body", text: $step.body, limit: OnboardingLimits.body, multiline: true)
      image
      if !step.imageUrl.isEmpty {
        OnboardingTextField(label: "Image description", text: $step.imageAlt, limit: OnboardingLimits.alt, placeholder: "What the picture shows, for screen readers")
      }
      OnboardingTextField(label: "Button label", text: $step.buttonLabel, limit: OnboardingLimits.label, placeholder: index == count - 1 ? "Get started" : "Continue")
    })
  }

  private var image: some View {
    LabeledField(label: "Image", hint: "Optional. Any https URL, an upload, or a file from the brand kit.") {
      HStack(spacing: 10) {
        if let url = URL(string: step.imageUrl), step.imageUrl.lowercased().hasPrefix("http") {
          CachedAsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Image(systemName: "photo").foregroundStyle(Theme.textDimmed) }
            .frame(width: 40, height: 40).background(Theme.elevated).clipShape(RoundedRectangle(cornerRadius: Metrics.radiusSmall))
            .accessibilityHidden(true)
        }
        TextField("https://", text: $step.imageUrl).textFieldStyle(.linear).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
      }
      FlowLayout(spacing: 8) {
        PhotosPicker(selection: $photo, matching: .images, preferredItemEncoding: .compatible) {
          Label("Upload", systemImage: "square.and.arrow.up")
        }
        .buttonStyle(.lnSecondaryCompact)
        Button("Files…") { importing = true }.buttonStyle(.lnSecondaryCompact)
        if uploading { ProgressView().controlSize(.small).frame(height: 30) }
        if !brandImages.isEmpty {
          Menu {
            ForEach(brandImages) { asset in
              Button(asset.name) {
                step.imageUrl = asset.url
                if step.imageAlt.isEmpty { step.imageAlt = (asset.description.isEmpty ? asset.name : asset.description).clipped(to: OnboardingLimits.alt) }
              }
            }
          } label: { Label("Brand kit", systemImage: "paintpalette") }
          .menuStyle(.button).buttonStyle(.lnSecondaryCompact).fixedSize()
        }
        if !step.imageUrl.isEmpty { Button("Remove image") { step.imageUrl = ""; step.imageAlt = "" }.buttonStyle(.lnGhost) }
      }
      .disabled(uploading)
      ErrorText(message: error)
    }
    .onChange(of: photo) { _, item in
      guard let item else { return }
      Task {
        defer { photo = nil }
        if let data = try? await item.loadTransferable(type: Data.self) { await upload(data) } else { error = "Could not read that photo." }
      }
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
      switch result {
      case .failure(let failure): error = failure.localizedDescription
      case .success(let url):
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        if let data = try? Data(contentsOf: url) { Task { await upload(data) } } else { error = "Could not read that file." }
      }
    }
  }

  /// `POST /v1/admin/onboarding/images`: PNG, JPEG, GIF or WebP; anything else (HEIC) goes up as a JPEG.
  private func upload(_ data: Data) async {
    uploading = true
    error = ""
    defer { uploading = false }
    do {
      let file = try EmailImageUpload.prepare(data)
      let stored: Attachment = try await session.upload("/v1/admin/onboarding/images", fields: ["project": projectId], file: file.data, filename: "image.\(file.ext)", mimeType: file.mime)
      step.imageUrl = stored.url
    } catch {
      self.error = error.localizedDescription
    }
  }
}
