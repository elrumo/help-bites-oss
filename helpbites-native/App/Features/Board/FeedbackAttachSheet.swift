import SwiftUI

/// "Attach feedback": every post in the project, searchable by title, text, author or `#N`
/// (components/FeedbackSearchPicker.vue). The caller decides what picking means.
struct FeedbackAttachSheet: View {
  let session: SessionStore
  let projectId: String
  let exclude: Set<String>
  let pick: (FeedbackPost) -> Void
  @State private var posts: [FeedbackPost] = []
  @State private var loaded = false
  @State private var query = ""
  @State private var error = ""
  @Environment(\.dismiss) private var dismiss

  private struct PostsResponse: Decodable, Sendable { let posts: [FeedbackPost] }

  private var candidates: [FeedbackPost] {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let number = Int(needle.hasPrefix("#") ? String(needle.dropFirst()) : needle)
    return posts.filter { post in
      !exclude.contains(post.id) && (needle.isEmpty || (number != nil ? post.number == number : [post.title, post.body, post.author?.name ?? "", post.author?.email ?? ""].contains { $0.localizedStandardContains(needle) }))
    }
  }

  var body: some View {
    NavigationStack {
      Group {
        if !error.isEmpty {
          ErrorText(message: error).padding(20).frame(maxHeight: .infinity, alignment: .top)
        } else if !loaded {
          SkeletonRows(count: 4).frame(maxHeight: .infinity, alignment: .top)
        } else if candidates.isEmpty {
          EmptyState(systemImage: "lightbulb", title: query.isEmpty ? "No other posts" : "Nothing matches", message: query.isEmpty ? "Every post is attached already, or there are none yet." : nil)
            .frame(maxHeight: .infinity, alignment: .top)
        } else {
          List(candidates.prefix(100)) { post in
            Button {
              pick(post)
              dismiss()
            } label: {
              HStack(spacing: 8) {
                HStack(spacing: 2) { Image(systemName: "chevron.up").font(.system(size: 9, weight: .bold)); Text("\(post.voteCount)").monospacedDigit() }
                  .font(.lnCaptionMedium).foregroundStyle(Theme.textMuted).frame(width: 36, alignment: .leading)
                if let number = post.number { Text("#\(number)").monospacedDigit().foregroundStyle(Theme.textMuted) }
                Text(post.title).foregroundStyle(Theme.text).lineLimit(1)
                Spacer(minLength: 0)
              }
              .font(.lnMeta)
              .frame(minHeight: 36)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .linearRow()
          }
          .linearList()
        }
      }
      .searchable(text: $query, prompt: "Search feedback or #12")
      .panelScreen("Attach feedback")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
      .task {
        guard !loaded else { return }
        do {
          let result: PostsResponse = try await session.get("/v1/feedback", query: ["project": projectId, "includeHidden": "1", "limit": "500", "sort": "new"])
          posts = result.posts
        } catch {
          self.error = error.localizedDescription
        }
        loaded = true
      }
    }
    .presentationDetents([.medium, .large])
  }
}
