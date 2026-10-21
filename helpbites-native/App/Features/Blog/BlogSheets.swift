import SwiftUI

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

// MARK: - Settings

/// The blog's settings (web: the Settings slide-over on the blog page). Switches
/// save as they change; the text fields with their own button. Admins only.
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

      SectionLabel("On your site")
      hint("Paste this where the blog should appear. Hand it your user's identity token to let them react and comment (see the Blog guide).")
      CodeBlock(code: snippet)
    } trailing: {}
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

// MARK: - Newsletter

/// Email a published post to subscribers. It becomes a campaign (test sends,
/// pause, numbers under Email → Campaigns); "Save as a draft" stops there.
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
      if (store.project?.marketing?.postalAddress ?? "").isEmpty {
        hint("Campaigns must carry your postal address. Add it under Email → Settings first.")
      }
      HStack(spacing: 8) {
        Button { Task { await send("draft") } } label: { busyLabel("Save as a draft", "draft") }.buttonStyle(.lnSecondary)
        Spacer(minLength: 0)
        Button { Task { await send(later ? "schedule" : "now") } } label: { busyLabel(later ? "Schedule" : "Send now", later ? "schedule" : "now") }.buttonStyle(.lnPrimary)
      }
      .disabled(!busy.isEmpty)
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
