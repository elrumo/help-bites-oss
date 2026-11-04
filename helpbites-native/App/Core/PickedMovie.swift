import CoreTransferable
import UniformTypeIdentifiers

/// A video chosen in the photo picker, copied to a temporary file so it is never held in memory whole.
/// The caller reads it (mapped) and deletes it. Compiled into the app and the share extension.
struct PickedMovie: Transferable {
  let url: URL

  static var transferRepresentation: some TransferRepresentation {
    FileRepresentation(contentType: .movie) { SentTransferredFile($0.url) } importing: { received in
      let copy = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).\(received.file.pathExtension)")
      try FileManager.default.copyItem(at: received.file, to: copy)
      return PickedMovie(url: copy)
    }
  }

  /// The extension and type the server accepts for a video (ITEM_FILE_TYPES): `.mov` stays, everything else is sent as `.mp4`.
  var serverName: (ext: String, mime: String) { url.pathExtension.lowercased() == "mov" ? ("mov", "video/quicktime") : ("mp4", "video/mp4") }
}
