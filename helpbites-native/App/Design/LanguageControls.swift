import SwiftUI

// The controls the Languages sections of onboarding, legal and email share.

/// A menu of languages: the common ones, then "Other…" for any tag. `onPick` gets a normalised tag.
struct LanguageMenu<Label: View>: View {
  var exclude: [String] = []
  /// A tag worth showing even when it is not a common one (the language already chosen).
  var include: [String] = []
  let onPick: (String) -> Void
  @ViewBuilder let label: () -> Label
  @State private var typing = false
  @State private var text = ""

  var body: some View {
    Menu {
      ForEach(ContentLocale.choices(excluding: exclude, including: include), id: \.self) { tag in
        Button(ContentLocale.label(tag)) { onPick(tag) }
      }
      Divider()
      Button("Other…") { text = ""; typing = true }
    } label: { label() }
    .menuStyle(.button).buttonStyle(.lnSecondaryCompact).fixedSize()
    .alert("Language tag", isPresented: $typing) {
      TextField("pt-BR", text: $text).textInputAutocapitalization(.never).autocorrectionDisabled()
      Button("Cancel", role: .cancel) {}
      Button("Use") { if let tag = ContentLocale.normalize(text) { onPick(tag) } }
        .disabled(ContentLocale.normalize(text) == nil || exclude.contains { ContentLocale.same($0, ContentLocale.normalize(text) ?? "") })
    } message: {
      Text("A language code such as es, fr or pt-BR.")
    }
  }
}

/// "Translate with AI": pick the languages (at most `limit`), say whether to replace strings that
/// already have a translation, and run. `run` throws the server's message, shown here as it is
/// (501: no AI provider configured; 429: too many requests; 502: unusable answer).
struct TranslateSheet: View {
  let title: String
  /// The language the content is written in; not offered.
  let source: String
  /// Languages that already have a translation, marked as such.
  var existing: [String] = []
  /// Most languages one request takes; 1 makes it a single choice.
  var limit = ContentLocale.translateRequest
  var overwriteHint: String? = String(localized: "Replace strings that already have a translation. Off: only what is missing is filled in.")
  let note: String
  let run: ([String], Bool) async throws -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var picked: [String] = []
  @State private var overwrite = false
  @State private var busy = false
  @State private var error = ""
  @State private var typing = false
  @State private var text = ""

  private var single: Bool { limit == 1 }
  private var tags: [String] { ContentLocale.choices(excluding: [source], including: picked + existing.filter { !ContentLocale.same($0, source) }) }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text(note).font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: single ? "Language" : "Languages", hint: single ? nil : "\(picked.count) of \(limit) selected") {
            FlowLayout(spacing: 8) {
              ForEach(tags, id: \.self) { tag in
                let on = picked.contains { ContentLocale.same($0, tag) }
                Pill(label: ContentLocale.name(tag), count: nil, systemImage: on ? "checkmark" : (existing.contains { ContentLocale.same($0, tag) } ? "text.badge.checkmark" : nil), isActive: on) { toggle(tag) }
                  .disabled(busy || (!on && !single && picked.count >= limit))
              }
              Button { text = ""; typing = true } label: { Label("Other", systemImage: "plus") }.buttonStyle(.lnSecondaryCompact).disabled(busy)
            }
          }
          if !single, let overwriteHint {
            Toggle(isOn: $overwrite) {
              VStack(alignment: .leading, spacing: 2) {
                Text("Overwrite").font(.lnRow).foregroundStyle(Theme.text)
                Text(overwriteHint).font(.lnCaption).foregroundStyle(Theme.textMuted)
              }
            }
            .toggleStyle(.switch).tint(Theme.accent).disabled(busy)
          }
          ErrorText(message: error)
          if busy {
            HStack(spacing: 8) {
              ProgressView().controlSize(.small)
              Text("Translating. This can take a minute or two.").font(.lnMeta).foregroundStyle(Theme.textMuted)
            }
          }
        }
        .padding(20)
        .frame(maxWidth: 560, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .panelScreen(title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button { Task { await translate() } } label: { Text(busy ? String(localized: "Translating…") : String(localized: "Translate")) }.disabled(picked.isEmpty || busy)
        }
      }
      .alert("Language tag", isPresented: $typing) {
        TextField("pt-BR", text: $text).textInputAutocapitalization(.never).autocorrectionDisabled()
        Button("Cancel", role: .cancel) {}
        Button("Add") { if let tag = ContentLocale.normalize(text), !ContentLocale.same(tag, source) { toggle(tag, forceOn: true) } }
          .disabled(ContentLocale.normalize(text) == nil)
      } message: {
        Text("A language code such as es, fr or pt-BR.")
      }
    }
    .interactiveDismissDisabled(busy)
    .presentationDetents([.medium, .large])
  }

  private func toggle(_ tag: String, forceOn: Bool = false) {
    if single { picked = [tag]; return }
    if let index = picked.firstIndex(where: { ContentLocale.same($0, tag) }) {
      if !forceOn { picked.remove(at: index) }
    } else if picked.count < limit {
      picked.append(tag)
    }
  }

  private func translate() async {
    busy = true
    error = ""
    defer { busy = false }
    do {
      try await run(picked, overwrite)
      dismiss()
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
  }
}

/// How many of `total` strings a translation has: "3 of 7 filled".
func translationProgress(_ filled: Int, of total: Int) -> String {
  total == 0 ? String(localized: "Nothing to translate yet") : String(localized: "\(filled) of \(total) filled")
}

/// A language picked for editing, for `.sheet(item:)`.
struct LanguageSelection: Identifiable, Hashable {
  let id: String
}
