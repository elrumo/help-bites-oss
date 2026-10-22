import SwiftUI

/// What of an email is words, and how a translation goes back in: a hand port of
/// shared/email/translate.ts (`emailTexts`, `localizeEmail`). A translation is a flat map
/// `key → text` kept next to the design, so editing the design never forks it. Keys:
/// `subject`, `preheader`, `text` (the plain-text part) and `<blockId>#<field>`: a heading's
/// `text`, a text block's `html`, a button's `label`, an image's `alt`, and a component's
/// `values.<fieldKey>` for its text and richtext fields.
enum EmailTexts {
  struct Entry: Identifiable, Equatable, Sendable {
    let key: String
    /// "Subject", "Heading", "Button"…: where the words sit.
    let label: String
    /// The words in the email's own language.
    let text: String
    var id: String { key }
    /// Long or HTML copy gets a multi-line field.
    var multiline: Bool { key == "text" || key.hasSuffix("#html") || text.count > 80 }
  }

  /// Every translatable string of the design, in reading order. Empty ones are left out.
  static func of(_ design: EmailDesign) -> [Entry] {
    var out: [Entry] = []
    func add(_ key: String, _ label: String, _ value: String) {
      if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append(Entry(key: key, label: label, text: value)) }
    }
    add("subject", String(localized: "Subject"), design.settings.title)
    add("preheader", String(localized: "Preheader"), design.settings.preheader)
    add("text", String(localized: "Plain-text version"), design.settings.text)
    for block in design.allBlocks {
      switch block.kind {
      case .heading: add("\(block.id)#text", String(localized: "Heading"), block.text)
      case .text: add("\(block.id)#html", String(localized: "Text"), block.html)
      case .button: add("\(block.id)#label", String(localized: "Button"), block.label)
      case .image: add("\(block.id)#alt", String(localized: "Image description"), block.alt)
      case .component:
        let values = block.values
        for field in block.componentFields where field.type == .text || field.type == .richtext {
          add("\(block.id)#values.\(field.key)", "\(block.name.isEmpty ? String(localized: "Component") : block.name): \(field.label.isEmpty ? field.key : field.label)", values[field.key] ?? field.defaultValue)
        }
      default: break
      }
    }
    return out
  }

  /// How many of the design's strings a translation has, and how many there are.
  static func progress(_ entries: [Entry], _ strings: [String: String]) -> (filled: Int, total: Int) {
    (entries.filter { !(strings[$0.key] ?? "").isEmpty }.count, entries.count)
  }

  /// The design with `strings` in place of the matching words (a missing or empty one stays).
  static func localize(_ design: EmailDesign, _ strings: [String: String]) -> EmailDesign {
    var next = design
    func word(_ key: String) -> String? { strings[key].flatMap { $0.isEmpty ? nil : $0 } }
    if let value = word("subject") { next.settings.title = value }
    if let value = word("preheader") { next.settings.preheader = value }
    if let value = word("text") { next.settings.text = value }
    for original in design.allBlocks {
      next.update(original.id) { block in
        func at(_ field: String) -> String? { word("\(original.id)#\(field)") }
        switch block.kind {
        case .heading: if let value = at("text") { block.text = value }
        case .text: if let value = at("html") { block.html = value }
        case .button: if let value = at("label") { block.label = value }
        case .image: if let value = at("alt") { block.alt = value }
        case .component:
          for field in block.componentFields { if let value = at("values.\(field.key)") { block.setComponentValue(field.key, value) } }
        default: break
        }
      }
    }
    return next
  }
}

/// A template's languages (web: the Languages section of the email editor): the language the
/// design is written in, one translation per other language, and the AI that fills them in.
struct EmailLanguagesPanel: View {
  @Bindable var store: EmailEditorStore
  @Environment(\.dismiss) private var dismiss
  @State private var editing: LanguageSelection?
  @State private var translating = false
  @State private var busy = false
  @State private var error = ""

  private var texts: [EmailTexts.Entry] { EmailTexts.of(store.design) }
  private var tags: [String] { store.translations.keys.sorted() }
  private var own: String { store.locale }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Text("Translations are kept next to the design, so changing the design never forks it. A block added later shows in \(ContentLocale.name(own)) until it is translated.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Written in", hint: "The language of the design. The send API's `locale` picks another one; anything else goes out in this.") {
            LanguageMenu(include: [own], onPick: { tag in Task { await run { try await store.setLocale(tag) } } }) { Label(ContentLocale.label(own), systemImage: "globe") }
              .disabled(busy)
          }
          HStack {
            SectionLabel("Translations")
            Text("\(tags.count) of \(ContentLocale.emailTranslations)").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
          }
          if tags.isEmpty {
            Text("No translations yet. Add a language to write it yourself, or translate with AI.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          } else {
            Card {
              ForEach(Array(tags.enumerated()), id: \.element) { index, tag in
                let progress = EmailTexts.progress(texts, store.translations[tag] ?? [:])
                CardRow(divider: index < tags.count - 1) {
                  Button { editing = LanguageSelection(id: tag) } label: {
                    HStack(spacing: 8) {
                      VStack(alignment: .leading, spacing: 2) {
                        Text(ContentLocale.label(tag)).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                        Text(translationProgress(progress.filled, of: progress.total)).font(.lnCaption).foregroundStyle(progress.filled < progress.total ? Theme.warning : Theme.textMuted)
                      }
                      Spacer(minLength: 4)
                      Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
                    }
                    .contentShape(Rectangle())
                  }
                  .buttonStyle(.plain)
                }
              }
            }
          }
          FlowLayout(spacing: 8) {
            LanguageMenu(exclude: [own] + tags, onPick: { tag in Task { await add(tag) } }) { Label("Add language", systemImage: "plus") }
              .disabled(busy || tags.count >= ContentLocale.emailTranslations)
            Button { translating = true } label: { Label("Translate with AI", systemImage: "sparkles") }
              .buttonStyle(.lnSecondaryCompact).disabled(busy || texts.isEmpty)
            if busy { ProgressView().controlSize(.small).frame(height: 30) }
          }
          Text("AI translations are drafts: read them before you send. They keep {{placeholders}}, links and tags.").font(.lnCaption).foregroundStyle(Theme.textMuted)
          ErrorText(message: error)
        }
        .padding(20)
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .panelScreen("Languages")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
      .navigationDestination(item: $editing) { EmailTranslationEditor(store: store, tag: $0.id) }
      .sheet(isPresented: $translating) {
        TranslateSheet(
          title: String(localized: "Translate with AI"), source: own, existing: tags,
          note: String(localized: "Fills in the subject, preheader, headings, text, buttons and image descriptions. Strings you already translated are kept unless you overwrite."),
          run: { locales, overwrite in try await store.translate(locales, overwrite: overwrite) }
        )
      }
    }
    .presentationDetents([.large])
  }

  private func run(_ work: () async throws -> Void) async {
    busy = true
    error = ""
    defer { busy = false }
    do { try await work() } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
  }

  /// A new language starts empty and opens for writing.
  private func add(_ tag: String) async {
    await run { try await store.saveTranslations([tag: [:]]) }
    if error.isEmpty { editing = LanguageSelection(id: tag) }
  }
}

/// One language of an email: each string with the original above it. A field left empty falls back to the original.
private struct EmailTranslationEditor: View {
  @Bindable var store: EmailEditorStore
  let tag: String
  @Environment(\.dismiss) private var dismiss
  @State private var strings: [String: String]
  @State private var saving = false
  @State private var error = ""
  @State private var confirmRemove = false

  init(store: EmailEditorStore, tag: String) {
    self.store = store
    self.tag = tag
    _strings = State(initialValue: store.translations[tag] ?? [:])
  }

  private var texts: [EmailTexts.Entry] { EmailTexts.of(store.design) }
  /// Only strings the design still has, and none that are empty.
  private var cleaned: [String: String] {
    let keys = Set(texts.map(\.key))
    return strings.filter { keys.contains($0.key) && !$0.value.isEmpty }
  }
  private var dirty: Bool { cleaned != (store.translations[tag] ?? [:]).filter { Set(texts.map(\.key)).contains($0.key) } }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        Text("Leave a field empty to send the original, in \(ContentLocale.name(store.locale)).").font(.lnMeta).foregroundStyle(Theme.textMuted)
        if texts.isEmpty { Text("The design has no text to translate yet.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
        ForEach(texts) { entry in
          LabeledField(label: entry.label) {
            Text(entry.text).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(4).textSelection(.enabled)
            if entry.multiline {
              LinearTextEditor(text: binding(entry.key), placeholder: entry.text, minHeight: 88)
            } else {
              TextField(entry.text, text: binding(entry.key)).textFieldStyle(.linear)
            }
          }
        }
        ErrorText(message: error)
        Button(role: .destructive) { confirmRemove = true } label: { Label("Remove this language", systemImage: "trash") }
          .buttonStyle(GhostButtonStyle(tint: Theme.error))
      }
      .padding(20)
      .frame(maxWidth: 640, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .panelScreen(ContentLocale.label(tag))
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        if saving { ProgressView() } else { Button("Save") { Task { await save() } }.disabled(!dirty) }
      }
    }
    .confirmationDialog("Remove \(ContentLocale.name(tag))?", isPresented: $confirmRemove, titleVisibility: .visible) {
      Button("Remove language", role: .destructive) { Task { await remove() } }
    } message: {
      Text("Its text is deleted. Emails asked for it go out in \(ContentLocale.name(store.locale)).")
    }
  }

  private func binding(_ key: String) -> Binding<String> {
    Binding(get: { strings[key] ?? "" }, set: { strings[key] = $0 })
  }

  private func save() async {
    saving = true
    error = ""
    defer { saving = false }
    do { try await store.saveTranslations([tag: cleaned]) } catch { self.error = error.localizedDescription }
  }

  private func remove() async {
    do {
      try await store.saveTranslations([tag: nil])
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
