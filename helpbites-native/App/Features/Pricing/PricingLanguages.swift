import SwiftUI

/// A table's languages (web: the language tabs of projects/[id]/pricing/[tableId].vue): the language
/// it is written in, one translation per other language, and the AI that fills them in. Edits go to
/// the draft and save with the rest of the table.
struct PricingLanguagesPanel: View {
  @Binding var draft: PricingDraft
  /// The AI works on the saved copy, so only when nothing is waiting to be saved.
  let canTranslate: Bool
  let translate: ([String], Bool) async throws -> Void
  @State private var editing: LanguageSelection?
  @State private var translating = false

  private var tags: [String] { draft.translations.keys.sorted() }
  private var full: Bool { tags.count >= PricingLimits.locales }

  var body: some View {
    LegalPanel(title: "Languages", trailing: {
      Text("\(tags.count) of \(PricingLimits.locales)").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
    }, content: {
      LabeledField(label: "Written in", hint: "The language of the words above. Sites and apps that ask for a language the table lacks get this one.") {
        LanguageMenu(include: [draft.locale], onPick: setLocale) { Label(ContentLocale.label(draft.locale), systemImage: "globe") }
      }
      if tags.isEmpty {
        Text("No translations yet. Add a language to write it yourself, or translate with AI.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      } else {
        let texts = draft.texts
        VStack(spacing: 0) {
          ForEach(tags, id: \.self) { tag in
            let words = draft.translations[tag] ?? [:]
            let filled = texts.filter { !(words[$0.key] ?? "").isEmpty }.count
            Button { editing = LanguageSelection(id: tag) } label: {
              HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                  Text(ContentLocale.label(tag)).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                  Text(translationProgress(filled, of: texts.count)).font(.lnCaption).foregroundStyle(filled < texts.count ? Theme.warning : Theme.textMuted)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.app(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
              }
              .padding(.vertical, 8)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
          }
        }
      }
      FlowLayout(spacing: 8) {
        LanguageMenu(exclude: [draft.locale] + tags, onPick: add) { Label("Add language", systemImage: "plus") }.disabled(full)
        Button { translating = true } label: { Label("Translate with AI", systemImage: "sparkles") }
          .buttonStyle(.lnSecondaryCompact).disabled(!canTranslate || draft.texts.isEmpty)
      }
      if !canTranslate { Text("Save your changes first: the AI translates the saved table.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
      Text("Translations are machine drafts: read them before you publish. Sites and apps see them after the next publish.").font(.lnCaption).foregroundStyle(Theme.textMuted)
    })
    .sheet(item: $editing) { selection in
      PricingTranslationSheet(tag: selection.id, draft: $draft)
    }
    .sheet(isPresented: $translating) {
      TranslateSheet(
        title: String(localized: "Translate with AI"), source: draft.locale, existing: tags,
        note: String(localized: "Fills in the name, words, plans, features, values and button labels of the saved table. Strings you already translated are kept unless you overwrite."),
        run: { locales, overwrite in try await translate(locales, overwrite) }
      )
    }
  }

  /// Another language for the words: a translation into that language makes no sense any more.
  private func setLocale(_ tag: String) {
    draft.locale = tag
    draft.translations = draft.translations.filter { !ContentLocale.same($0.key, tag) }
  }

  private func add(_ tag: String) {
    guard !full, !draft.translations.keys.contains(where: { ContentLocale.same($0, tag) }) else { return }
    draft.translations[tag] = [:]
    editing = LanguageSelection(id: tag)
  }
}

/// One language: every string of the table, grouped as the web lists them, with the original as the
/// placeholder. A field left empty falls back to the original.
private struct PricingTranslationSheet: View {
  let tag: String
  @Binding var draft: PricingDraft
  @Environment(\.dismiss) private var dismiss
  @State private var confirmRemove = false

  /// The strings in their groups, in the table's order: Words, each plan, Features.
  private var groups: [(name: String, texts: [PricingText])] {
    var out: [(name: String, texts: [PricingText])] = []
    for text in draft.texts {
      if let index = out.firstIndex(where: { $0.name == text.group }) { out[index].texts.append(text) } else { out.append((name: text.group, texts: [text])) }
    }
    return out
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Leave a field empty to show the original, in \(ContentLocale.name(draft.locale)).").font(.lnMeta).foregroundStyle(Theme.textMuted)
          if draft.texts.isEmpty { Text("The table has no words to translate yet.").font(.lnMeta).foregroundStyle(Theme.textMuted) }
          ForEach(groups, id: \.name) { group in
            LegalPanel(group.name) {
              ForEach(group.texts) { text in
                OnboardingTextField(label: text.field, text: binding(text.key), limit: text.limit, placeholder: text.text, multiline: text.limit > 200)
              }
            }
          }
          Button(role: .destructive) { confirmRemove = true } label: { Label("Remove this language", systemImage: "trash") }
            .buttonStyle(GhostButtonStyle(tint: Theme.error))
        }
        .padding(20)
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen(ContentLocale.label(tag))
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
      .confirmationDialog("Remove \(ContentLocale.name(tag))?", isPresented: $confirmRemove, titleVisibility: .visible) {
        Button("Remove language", role: .destructive) {
          draft.translations[tag] = nil
          dismiss()
        }
      } message: {
        Text("Its words are deleted when you save. Sites and apps that ask for it get the original.")
      }
    }
    .presentationDetents([.large])
  }

  private func binding(_ key: String) -> Binding<String> {
    Binding(
      get: { draft.translations[tag]?[key] ?? "" },
      set: { value in
        if value.isEmpty { draft.translations[tag, default: [:]][key] = nil } else { draft.translations[tag, default: [:]][key] = value }
      }
    )
  }
}
