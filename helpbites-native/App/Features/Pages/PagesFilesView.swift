import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// A project's files for Pages (web: components/cms/CmsAssets.vue): upload, rename, alt text,
/// copy the URL, delete. With `onPick`, a tap hands the file to the caller instead (the asset picker).
struct PagesFilesView: View {
  let projectId: String
  var onPick: ((CmsAsset) -> Void)? = nil
  @Environment(SessionStore.self) private var session
  @State private var assets: [CmsAsset] = []
  @State private var loading = true
  @State private var error = ""
  @State private var notice = ""
  @State private var query = ""
  @State private var photos: [PhotosPickerItem] = []
  @State private var importing = false
  @State private var uploading = 0
  @State private var editing: CmsAsset?
  @State private var deleting: CmsAsset?

  private var shown: [CmsAsset] {
    let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
    return needle.isEmpty ? assets : assets.filter { $0.name.lowercased().contains(needle) || $0.alt.lowercased().contains(needle) }
  }
  /// PNG, JPEG, GIF, WebP, SVG, ICO, PDF, MP4 and WebM.
  private static let fileTypes: [UTType] = [.png, .jpeg, .gif, .webP, .svg, .ico, .pdf, .mpeg4Movie] + [UTType(filenameExtension: "webm")].compactMap { $0 }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        HStack(spacing: 8) {
          Button { importing = true } label: { Label("Upload files", systemImage: "square.and.arrow.up") }.buttonStyle(.lnPrimaryCompact)
          #if os(iOS)
          PhotosPicker(selection: $photos, maxSelectionCount: 20, matching: .any(of: [.images, .videos]), preferredItemEncoding: .compatible) {
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
        .disabled(uploading > 0 || assets.count >= CmsLimits.assets)
        Text("Images, MP4 and WebM video, and PDFs, up to 20 MB each. A file is public at its URL.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        if !assets.isEmpty { SearchField(text: $query, prompt: "Search files") }
        ErrorText(message: error)
        if !notice.isEmpty { Label(notice, systemImage: "checkmark").font(.lnCaption).foregroundStyle(Theme.textMuted) }
        if loading && assets.isEmpty {
          SkeletonRows(count: 3)
        } else if assets.isEmpty && error.isEmpty {
          EmptyState(systemImage: "photo.stack", title: "No files yet", message: "Upload images, videos or PDFs, then choose them in a page's file fields.")
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else {
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            ForEach(shown) { tile($0) }
          }
        }
      }
      .frame(maxWidth: 1000, alignment: .leading)
      .padding(.horizontal, 20)
      .padding(.vertical, 20)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .refreshable { await load() }
    .sheet(item: $editing) { asset in
      PagesFileSheet(asset: asset) { updated in
        if let index = assets.firstIndex(where: { $0.id == updated.id }) { assets[index] = updated }
      }
    }
    .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { asset in
      Button("Delete file", role: .destructive) { Task { await delete(asset) } }
    } message: { _ in
      Text("Pages that use it will show it broken.")
    }
    .onChange(of: photos) { _, items in
      guard !items.isEmpty else { return }
      photos = []
      Task {
        for item in items {
          guard let data = try? await item.loadTransferable(type: Data.self) else { error = String(localized: "Could not read that photo."); continue }
          let type = item.supportedContentTypes.first
          await upload(data, filename: "Photo.\(type?.preferredFilenameExtension ?? "jpg")", mimeType: type?.preferredMIMEType)
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
        Task { for (data, name) in files { await upload(data, filename: name, mimeType: nil) } }
      }
    }
    .task { if assets.isEmpty { await load() } }
  }

  private func tile(_ asset: CmsAsset) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Button {
        if let onPick { onPick(asset) } else { editing = asset }
      } label: {
        PagesThumbnail(asset: asset).frame(height: 110).frame(maxWidth: .infinity)
      }
      .buttonStyle(.plain)
      Rectangle().fill(Theme.border).frame(height: Hairline.width)
      HStack(alignment: .top, spacing: 4) {
        VStack(alignment: .leading, spacing: 2) {
          Text(asset.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Text(asset.detail).font(.lnCaption).foregroundStyle(Theme.textDimmed).lineLimit(1)
        }
        Spacer(minLength: 0)
        if onPick == nil {
          Menu { actions(asset) } label: {
            Image(systemName: "ellipsis").font(.app(size: 14, weight: .medium)).foregroundStyle(Theme.textMuted).frame(width: 28, height: 28).contentShape(Rectangle())
          }
          .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
          .accessibilityLabel("Actions for \(asset.name)")
        }
      }
      .padding(10)
    }
    .background(Theme.panel)
    .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusLarge))
    .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
    .contextMenu { if onPick == nil { actions(asset) } }
  }

  @ViewBuilder private func actions(_ asset: CmsAsset) -> some View {
    Button { editing = asset } label: { Label("Edit", systemImage: "pencil") }
    Button { Clipboard.copy(asset.url); flash(String(localized: "Copied the file's URL.")) } label: { Label("Copy URL", systemImage: "link") }
    Divider()
    Button(role: .destructive) { deleting = asset } label: { Label("Delete", systemImage: "trash") }
  }

  private func flash(_ text: String) {
    notice = text
    Task {
      try? await Task.sleep(for: .seconds(3))
      if notice == text { notice = "" }
    }
  }

  private func load() async {
    struct Response: Decodable, Sendable { let assets: [CmsAsset] }
    do {
      let response: Response = try await session.get("/v1/admin/cms/assets", query: ["project": projectId])
      assets = response.assets
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
  }

  private func upload(_ data: Data, filename: String, mimeType: String?) async {
    if data.count > CmsLimits.assetBytes {
      error = String(localized: "\(filename) is larger than \(CmsLimits.assetBytes / 1024 / 1024) MB.")
      return
    }
    uploading += 1
    defer { uploading -= 1 }
    let mime = mimeType ?? UTType(filenameExtension: (filename as NSString).pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    do {
      let response: CmsAssetResponse = try await session.upload("/v1/admin/cms/assets", fields: ["project": projectId], file: data, filename: filename, mimeType: mime)
      assets.insert(response.asset, at: 0)
      error = ""
    } catch {
      self.error = "\(filename): \(error.localizedDescription)"
    }
  }

  private func delete(_ asset: CmsAsset) async {
    do {
      try await session.delete("/v1/admin/cms/assets/\(asset.id)")
      assets.removeAll { $0.id == asset.id }
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// A file's name and alt text (`PATCH /v1/admin/cms/assets/:id`). Pages keep the alt text they were saved with.
private struct PagesFileSheet: View {
  let asset: CmsAsset
  let onSave: (CmsAsset) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var name: String
  @State private var alt: String
  @State private var saving = false
  @State private var error = ""

  init(asset: CmsAsset, onSave: @escaping (CmsAsset) -> Void) {
    self.asset = asset
    self.onSave = onSave
    _name = State(initialValue: asset.name)
    _alt = State(initialValue: asset.alt)
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          PagesThumbnail(asset: asset).frame(height: 160).frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusLarge))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
          LabeledField(label: "Name") {
            TextField("", text: $name).textFieldStyle(.linear)
              .onChange(of: name) { _, value in name = value.clipped(to: CmsLimits.assetName) }
          }
          LabeledField(label: "Alt text", hint: "What the picture shows, for people who cannot see it and for search engines. Pages keep the alt text they were saved with; choose the file again to take the new one.") {
            TextField("", text: $alt).textFieldStyle(.linear)
              .onChange(of: alt) { _, value in alt = value.clipped(to: CmsLimits.alt) }
          }
          Text("\(asset.mime) · \(asset.detail)").font(.lnMono).foregroundStyle(Theme.textDimmed)
          ErrorText(message: error)
        }
        .frame(maxWidth: 560, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("Edit file")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") { Task { await save() } }
            .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty || (name == asset.name && alt == asset.alt))
        }
      }
    }
    .presentationDetents([.large])
  }

  private func save() async {
    struct Input: Encodable, Sendable { let name, alt: String }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let response: CmsAssetResponse = try await session.send("/v1/admin/cms/assets/\(asset.id)", method: "PATCH", body: Input(name: name, alt: alt))
      onSave(response.asset)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// A file's tile: the image, or its type for videos, PDFs and icons the system cannot draw.
struct PagesThumbnail: View {
  let asset: CmsAsset

  var body: some View {
    ZStack {
      Theme.elevated
      if asset.isImage, asset.mime != "image/x-icon", let url = URL(string: asset.url) {
        CachedAsyncImage(url: url) { phase in
          switch phase {
          case .success(let image): image.resizable().scaledToFit().padding(10)
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
      .foregroundStyle(Theme.textMuted)
      .padding(.horizontal, 10).padding(.vertical, 6)
      .overlay(RoundedRectangle(cornerRadius: Metrics.radiusSmall).strokeBorder(Theme.borderAccented))
  }
}
