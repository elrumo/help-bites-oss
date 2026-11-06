import ImageIO
import SwiftUI

/// A memory-and-disk cached remote image. `AsyncImage` re-fetches and flashes its placeholder
/// every time a row scrolls back in (project icons, avatars, attachments); this keeps decoded
/// images in an `NSCache` and shares one in-flight request per URL.
@MainActor final class ImageCache {
  static let shared = ImageCache()
  private let cache: NSCache<NSURL, PlatformImage> = { let cache = NSCache<NSURL, PlatformImage>(); cache.countLimit = 300; return cache }()
  private var inFlight: [URL: Task<PlatformImage?, Never>] = [:]
  private let session: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.urlCache = URLCache(memoryCapacity: 16 << 20, diskCapacity: 128 << 20)
    configuration.requestCachePolicy = .returnCacheDataElseLoad
    return URLSession(configuration: configuration)
  }()

  nonisolated private static func decode(_ data: Data) -> PlatformImage? {
    #if os(macOS)
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
    else { return NSImage(data: data) }
    return NSImage(cgImage: image, size: .zero)
    #else
    return UIImage(data: data)?.preparingForDisplay()
    #endif
  }

  func cached(_ url: URL) -> PlatformImage? { cache.object(forKey: url as NSURL) }

  func image(for url: URL) async -> PlatformImage? {
    if let image = cached(url) { return image }
    if let task = inFlight[url] { return await task.value }
    let session = session
    let task = Task<PlatformImage?, Never> {
      guard let (data, response) = try? await session.data(from: url), (response as? HTTPURLResponse)?.statusCode ?? 200 < 300 else { return nil }
      // Decoded here, off the main thread: a lazily decoded image decodes on its first draw, mid-scroll.
      return await Task.detached(priority: .userInitiated) { ImageCache.decode(data) }.value
    }
    inFlight[url] = task
    let image = await task.value
    inFlight[url] = nil
    if let image { cache.setObject(image, forKey: url as NSURL) }
    return image
  }
}

/// Drop-in for `AsyncImage(url:content:placeholder:)` and `AsyncImage(url:content:)` (phase form).
struct CachedAsyncImage<Content: View>: View {
  let url: URL?
  @ViewBuilder let content: (AsyncImagePhase) -> Content
  @State private var phase: AsyncImagePhase = .empty

  init(url: URL?, @ViewBuilder content: @escaping (AsyncImagePhase) -> Content) {
    self.url = url
    self.content = content
    if let url, let image = ImageCache.shared.cached(url) { _phase = State(initialValue: .success(Image(platformImage: image))) }
  }

  var body: some View {
    content(phase).task(id: url) {
      guard let url else { phase = .empty; return }
      if let image = ImageCache.shared.cached(url) { phase = .success(Image(platformImage: image)); return }
      if let image = await ImageCache.shared.image(for: url) { phase = .success(Image(platformImage: image)) }
      else if !Task.isCancelled { phase = .failure(URLError(.cannotDecodeContentData)) }
    }
  }
}

extension CachedAsyncImage {
  init<Done: View, Waiting: View>(url: URL?, @ViewBuilder content: @escaping (Image) -> Done, @ViewBuilder placeholder: @escaping () -> Waiting) where Content == _ConditionalContent<Done, Waiting> {
    self.init(url: url) { phase in
      if case .success(let image) = phase { content(image) } else { placeholder() }
    }
  }
}
