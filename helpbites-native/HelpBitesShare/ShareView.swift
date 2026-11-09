import AVKit
import ImageIO
import PhotosUI
import SwiftUI

/// "Add to Planning": the app's New item form (BoardItemEditor) in the share sheet.
struct ShareView: View {
  @Bindable var model: ShareModel
  let cancel: () -> Void
  let finish: () -> Void
  @State private var photos: [PhotosPickerItem] = []
  @State private var pickingPost = false
  @State private var viewing: SharedImage?

  private static let accent = Color(red: 0x5e / 255, green: 0x6a / 255, blue: 0xd2 / 255)

  var body: some View {
    VStack(spacing: 0) {
      header
      ScrollView {
        content
          .frame(maxWidth: 640, alignment: .leading)
          .padding(.horizontal, 20)
          .padding(.top, 8)
          .padding(.bottom, 32)
          .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
    }
    .background(Color(.systemGroupedBackground))
    .tint(Self.accent)
    // A new item with no title gets one a second after the description stops changing (or once the form is ready).
    .task(id: "\(model.phase == .ready)|\(model.details)") { await model.writeTitleAfterPause() }
    .sheet(isPresented: $pickingPost) {
      SharePostPicker(model: model) { model.posts.append($0) }
    }
    .fullScreenCover(item: $viewing) { SharePreview(media: $0) }
  }

  // MARK: Header

  private var header: some View {
    HStack {
      Button(action: cancel) {
        Text("Cancel")
          .font(.title3.weight(.medium))
          .padding(.horizontal, 20)
          .frame(height: 52)
          .background(.regularMaterial, in: Capsule())
      }
      .buttonStyle(.plain)
      Spacer()
      if model.phase == .ready {
        Button {
          Task { if await model.send() { try? await Task.sleep(for: .seconds(model.queued ? 2.5 : 0.8)); finish() } }
        } label: {
          ZStack {
            if model.sent { Image(systemName: "checkmark") }
            else if model.sending { ProgressView().tint(.white) }
            else { Image(systemName: "arrow.up") }
          }
          .font(.title.weight(.semibold))
          .foregroundStyle(.white)
          .frame(width: 56, height: 56)
          .background(Self.accent.opacity(model.canSend || model.sent ? 1 : 0.4), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(!model.canSend)
        .accessibilityLabel("Add to Planning")
      }
    }
    .padding(.horizontal, 20)
    .padding(.top, 16)
    .padding(.bottom, 8)
  }

  // MARK: Content

  @ViewBuilder private var content: some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 6) {
        Text("Add to Planning").font(.largeTitle.bold())
        Text("Private until you put it on the roadmap.").font(.title3).foregroundStyle(.secondary)
        if model.offline || model.queued {
          Label {
            if model.sent { Text("Saved on this device. HelpBites uploads it as soon as it can reach the server.") }
            else { Text("Offline. The item is kept on this device and HelpBites uploads it when you're back online.") }
          } icon: {
            Image(systemName: "wifi.slash")
          }
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .padding(.bottom, 4)
      switch model.phase {
      case .loading:
        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
      case .signedOut:
        notice(String(localized: "Open HelpBites and sign in, then share again."))
      case .noBoard:
        notice(String(localized: "Planning is off for every project. Turn it on in HelpBites, then share again."))
      case .failed:
        notice(model.error)
      case .ready:
        form
      }
    }
  }

  private func notice(_ text: String) -> some View {
    Text(text).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).shareCard()
  }

  @ViewBuilder private var form: some View {
    if !model.error.isEmpty { Text(model.error).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }

    if model.projects.count > 1 {
      VStack(spacing: 0) {
        pickerRow("Project", selection: Binding(get: { model.projectId }, set: { model.select(project: $0) }), options: model.projects.map { ($0.id, $0.name) })
      }
      .shareCard()
    }

    HStack(spacing: 8) {
      TextField("Title", text: $model.title)
        .font(.title3)
        .submitLabel(.next)
        .onChange(of: model.title) { _, value in if value.count > BoardTitle.maxLength { model.title = String(value.prefix(BoardTitle.maxLength)) } }
      titleAccessory
    }
    .shareCard()

    ZStack(alignment: .topLeading) {
      if model.details.isEmpty {
        Text("Description (Markdown, internal: the roadmap never shows it)").foregroundStyle(.tertiary).padding(.horizontal, 5).padding(.top, 8).allowsHitTesting(false)
      }
      TextEditor(text: $model.details).scrollContentBackground(.hidden).frame(minHeight: 130)
    }
    .font(.body)
    .shareCard()

    images

    if let board = model.board {
      VStack(spacing: 0) {
        pickerRow("Status", selection: $model.status, options: board.statuses.map { ($0.key, $0.label) })
        Divider()
        pickerRow("Priority", selection: $model.priority, options: priorityOptions)
        Divider()
        pickerRow("Assignee", selection: $model.assigneeId, options: assigneeOptions)
        Divider()
        targetDate
      }
      .shareCard()
      labels(board)
      feedback
      roadmap(board)
    }
  }

  /// While the AI writes the title, a spinner; otherwise the button that writes it from the description.
  @ViewBuilder private var titleAccessory: some View {
    if !model.details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      if model.writingTitle {
        ProgressView().accessibilityLabel("Writing the title…")
      } else {
        Button { Task { await model.writeTitle(manual: true) } } label: {
          Image(systemName: "sparkles").font(.title3).foregroundStyle(Self.accent).frame(width: 32, height: 32).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Write the title with AI")
      }
    }
  }

  // MARK: Images

  private var images: some View {
    VStack(alignment: .leading, spacing: 16) {
      PhotosPicker(selection: $photos, maxSelectionCount: max(1, ShareModel.maxImages - model.images.count), matching: .any(of: [.images, .videos])) {
        Text("Add photos and videos").font(.title3).foregroundStyle(Self.accent).frame(maxWidth: .infinity, alignment: .leading)
      }
      .disabled(model.images.count >= ShareModel.maxImages)
      .onChange(of: photos) { _, items in
        guard !items.isEmpty else { return }
        photos = []
        Task {
          for item in items {
            if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
              if let movie = try? await item.loadTransferable(type: PickedMovie.self) { await model.addVideo(at: movie.url) }
              else { model.error = String(localized: "Could not read that video.") }
            } else if let data = try? await item.loadTransferable(type: Data.self) { model.addImage(data: data) }
            else { model.error = String(localized: "Could not read that image.") }
          }
        }
      }
      .padding(.vertical, 2)
      if !model.images.isEmpty {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 12) {
            ForEach(model.images) { image in
              Image(uiImage: image.preview)
                .resizable()
                .scaledToFill()
                .frame(width: 110, height: 150)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay { if image.isVideo { Image(systemName: "play.circle.fill").font(.largeTitle).foregroundStyle(.white.opacity(0.9)).shadow(radius: 3) } }
                .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .onTapGesture { viewing = image }
                .accessibilityAddTraits(.isButton)
                .accessibilityLabel(image.isVideo ? "Video" : "Image")
                .overlay(alignment: .topTrailing) {
                  Button { model.removeImage(image.id) } label: {
                    Image(systemName: "xmark.circle.fill").font(.title2).symbolRenderingMode(.palette).foregroundStyle(.white, .gray)
                  }
                  .buttonStyle(.plain)
                  .offset(x: 6, y: -6)
                  .accessibilityLabel(image.isVideo ? "Remove video" : "Remove image")
                }
            }
          }
          .padding(.top, 6)
          .padding(.trailing, 6)
        }
      }
    }
    .shareCard()
  }

  // MARK: Fields

  private func pickerRow<Value: Hashable>(_ title: LocalizedStringKey, selection: Binding<Value>, options: [(Value, String)]) -> some View {
    HStack {
      Text(title)
      Spacer(minLength: 12)
      Menu {
        Picker(title, selection: selection) {
          ForEach(options, id: \.0) { option in Text(option.1).tag(option.0) }
        }
      } label: {
        HStack(spacing: 4) {
          Text(options.first { $0.0 == selection.wrappedValue }?.1 ?? "").lineLimit(1)
          Image(systemName: "chevron.up.chevron.down").font(.caption2)
        }
        .foregroundStyle(.secondary)
      }
    }
    .frame(minHeight: 44)
  }

  private var priorityOptions: [(String, String)] {
    var options = [("", String(localized: "No priority"))]
    for priority in ShareModel.priorities { options.append((priority, Self.priorityName(priority))) }
    return options
  }

  private var assigneeOptions: [(String, String)] {
    var options = [("", String(localized: "Unassigned"))]
    for agent in model.agents { options.append((agent.id, agent.displayName)) }
    return options
  }

  private var targetDate: some View {
    VStack(spacing: 0) {
      Toggle("Target date", isOn: $model.hasDate).frame(minHeight: 44)
      if model.hasDate {
        DatePicker("Target date", selection: $model.targetDate, displayedComponents: .date)
          .labelsHidden()
          .frame(maxWidth: .infinity, alignment: .trailing)
          .padding(.bottom, 4)
      }
    }
  }

  private func labels(_ board: ShareBoard) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Labels").font(.headline)
      if !board.labels.isEmpty {
        ShareFlowLayout(spacing: 8) {
          ForEach(board.labels) { label in
            let on = model.labels.contains(label.key)
            Button { model.toggle(label: label.key) } label: {
              HStack(spacing: 4) {
                if on { Image(systemName: "checkmark").font(.caption.weight(.bold)) }
                Text(label.label)
              }
              .font(.callout.weight(.medium))
              .foregroundStyle(on ? Self.accent : .secondary)
              .padding(.horizontal, 12)
              .frame(height: 34)
              .background(on ? Self.accent.opacity(0.15) : Color(.tertiarySystemFill), in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(on ? .isSelected : [])
          }
        }
      }
      HStack(spacing: 8) {
        TextField("New label", text: $model.newLabel)
          .submitLabel(.done)
          .onSubmit { Task { await model.addLabel() } }
        Button("Add label") { Task { await model.addLabel() } }
          .disabled(model.newLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.addingLabel)
      }
    }
    .shareCard()
  }

  private var feedback: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 6) {
        Text("Feedback").font(.headline)
        Text("\(model.posts.count)").foregroundStyle(.secondary).monospacedDigit()
      }
      ForEach(model.posts) { post in
        HStack(spacing: 10) {
          Text(post.number.map { "#\($0) \(post.title)" } ?? post.title).lineLimit(1)
          Spacer(minLength: 0)
          Button { model.posts.removeAll { $0.id == post.id } } label: {
            Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(.secondary).frame(width: 28, height: 28)
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Remove \(post.title)")
        }
      }
      Button { pickingPost = true } label: { Label("Search feedback to attach", systemImage: "magnifyingglass") }
    }
    .shareCard()
  }

  private func roadmap(_ board: ShareBoard) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Toggle(isOn: $model.isPublic) {
        VStack(alignment: .leading, spacing: 2) {
          Text("On public roadmap")
          Text("Shows once planned, in progress or done — with only the public description below.").font(.footnote).foregroundStyle(.secondary)
        }
      }
      if model.isPublic {
        ZStack(alignment: .topLeading) {
          if model.publicDescription.isEmpty {
            Text("What this means for your users").foregroundStyle(.tertiary).padding(.horizontal, 5).padding(.top, 8).allowsHitTesting(false)
          }
          TextEditor(text: $model.publicDescription).scrollContentBackground(.hidden).frame(minHeight: 90)
        }
        .padding(8)
        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        if model.project?.roadmapReady != true {
          Text("The public roadmap is published through public feedback: turn it on, with its Roadmap view, under Feedback → Settings.")
            .font(.footnote).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
        } else if !board.isOnRoadmap(model.status) {
          Text("Not on the roadmap yet: \(board.status(model.status)?.label ?? String(localized: "this status")) stays private.")
            .font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .shareCard()
  }

  private static func priorityName(_ priority: String) -> String {
    switch priority {
    case "urgent": String(localized: "Urgent")
    case "high": String(localized: "High")
    case "normal": String(localized: "Normal")
    case "low": String(localized: "Low")
    default: priority.capitalized
    }
  }
}

// MARK: - Feedback picker

/// "Attach feedback": every post in the project, searchable by title or `#N` (FeedbackAttachSheet in the app).
private struct SharePostPicker: View {
  let model: ShareModel
  let pick: (SharePost) -> Void
  @State private var posts: [SharePost] = []
  @State private var loaded = false
  @State private var query = ""
  @State private var error = ""
  @Environment(\.dismiss) private var dismiss

  private var candidates: [SharePost] {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let number = Int(needle.hasPrefix("#") ? String(needle.dropFirst()) : needle)
    let taken = Set(model.posts.map(\.id))
    return posts.filter { post in
      !taken.contains(post.id) && (needle.isEmpty || (number != nil ? post.number == number : post.title.localizedStandardContains(needle)))
    }
  }

  var body: some View {
    NavigationStack {
      Group {
        if !error.isEmpty {
          Text(error).foregroundStyle(.red).padding(20).frame(maxHeight: .infinity, alignment: .top)
        } else if !loaded {
          ProgressView().frame(maxHeight: .infinity)
        } else if candidates.isEmpty {
          ContentUnavailableView(query.isEmpty ? "No other posts" : "Nothing matches", systemImage: "lightbulb")
        } else {
          List(candidates.prefix(100)) { post in
            Button {
              pick(post)
              dismiss()
            } label: {
              HStack(spacing: 8) {
                if let number = post.number { Text("#\(number)").monospacedDigit().foregroundStyle(.secondary) }
                Text(post.title).lineLimit(1)
                Spacer(minLength: 0)
                Label("\(post.voteCount ?? 0)", systemImage: "chevron.up").font(.footnote).foregroundStyle(.secondary)
              }
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
          }
        }
      }
      .searchable(text: $query, prompt: "Search feedback or #12")
      .navigationTitle("Attach feedback")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
      .task {
        guard !loaded else { return }
        do { posts = try await model.loadPosts() } catch { self.error = error.localizedDescription }
        loaded = true
      }
    }
    .presentationDetents([.medium, .large])
  }
}

// MARK: - Look

private extension View {
  /// A rounded white (dark: grey) block on the grouped background, like the fields of other share sheets.
  func shareCard() -> some View {
    padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
  }
}

/// Left-to-right wrapping layout for the label chips (FlowLayout in the app).
private struct ShareFlowLayout: Layout {
  var spacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
    let maxWidth = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x + size.width > maxWidth, x > 0 { x = 0; y += rowHeight + spacing; rowHeight = 0 }
      x += size.width + spacing
      rowHeight = max(rowHeight, size.height)
    }
    return CGSize(width: maxWidth.isFinite ? maxWidth : x, height: y + rowHeight)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
    var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x + size.width > bounds.width, x > 0 { x = 0; y += rowHeight + spacing; rowHeight = 0 }
      view.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      rowHeight = max(rowHeight, size.height)
    }
  }
}

/// The full-screen view of an attached picture (pinch to zoom, double-tap to reset) or video (plays).
private struct SharePreview: View {
  let media: SharedImage
  @Environment(\.dismiss) private var dismiss
  @State private var picture: UIImage?
  @State private var player: AVPlayer?
  @State private var steady: CGFloat = 1
  @GestureState private var pinch: CGFloat = 1

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      if media.isVideo {
        VideoPlayer(player: player).ignoresSafeArea()
      } else if let picture {
        Image(uiImage: picture).resizable().scaledToFit()
          .scaleEffect(steady * pinch)
          .gesture(MagnifyGesture().updating($pinch) { value, state, _ in state = value.magnification }.onEnded { value in steady = min(max(steady * value.magnification, 1), 5) })
          .onTapGesture(count: 2) { withAnimation { steady = 1 } }
      } else {
        ProgressView().tint(.white)
      }
    }
    .overlay(alignment: .topTrailing) {
      Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.title).foregroundStyle(.white, .white.opacity(0.25)) }.padding().accessibilityLabel("Close")
    }
    .statusBarHidden()
    .task {
      if let file = media.fileURL {
        player = AVPlayer(url: file)
        player?.play()
      } else if let source = CGImageSourceCreateWithData(media.data as CFData, nil) {
        // Decoded at screen size, so a 48 MP picture stays inside the extension's memory.
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 2400]
        picture = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary).map { UIImage(cgImage: $0) } ?? media.preview
      }
    }
    .onDisappear { player?.pause() }
  }
}
