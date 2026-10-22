import SwiftUI

/// A form's languages (web: the language bar of projects/[id]/forms/[formId].vue): the language
/// it is written in, one translation per other language, and the AI that fills them in. Edits go
/// to the draft and save with the rest of the form; visitors see them at once.
struct LeadFormLanguagesPanel: View {
  @Binding var draft: LeadFormDraft
  /// The AI works on the saved form, so only when nothing is waiting to be saved.
  let canTranslate: Bool
  let translate: ([String], Bool) async throws -> Void
  @State private var editing: LanguageSelection?
  @State private var translating = false

  private var tags: [String] { draft.translations.keys.sorted() }
  private var full: Bool { tags.count >= ContentLocale.leadFormTranslations }

  var body: some View {
    LegalPanel(title: "Languages", trailing: {
      Text("\(tags.count) of \(ContentLocale.leadFormTranslations)").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
    }, content: {
      LabeledField(label: "Written in", hint: "The language of the words above. Visitors who ask for a language the form lacks get this one.") {
        LanguageMenu(include: [draft.locale], onPick: setLocale) { Label(ContentLocale.label(draft.locale), systemImage: "globe") }
      }
      if tags.isEmpty {
        Text("No translations yet. Add a language to write it yourself, or translate with AI.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      } else {
        VStack(spacing: 0) {
          ForEach(tags, id: \.self) { tag in
            let progress = (draft.translations[tag] ?? LeadFormTranslation()).progress(content: draft.content, fields: draft.fields)
            Button { editing = LanguageSelection(id: tag) } label: {
              HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                  Text(ContentLocale.label(tag)).font(.lnRow).foregroundStyle(Theme.textHighlighted)
                  Text(translationProgress(progress.filled, of: progress.total)).font(.lnCaption).foregroundStyle(progress.filled < progress.total ? Theme.warning : Theme.textMuted)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
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
          .buttonStyle(.lnSecondaryCompact).disabled(!canTranslate)
      }
      if !canTranslate { Text("Save your changes first: the AI translates the saved form.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
      Text("The script, the hosted page and the Swift snippet show the visitor's language when the form has it. Errors, the confirmation email and the welcome email follow.").font(.lnCaption).foregroundStyle(Theme.textMuted)
    })
    .sheet(item: $editing) { selection in
      LeadFormTranslationSheet(tag: selection.id, draft: $draft)
    }
    .sheet(isPresented: $translating) {
      TranslateSheet(
        title: "Translate with AI", source: draft.locale, existing: tags,
        note: String(localized: "Fills in the title, description, button, thank-you words and every field's label, placeholder and options of the saved form. Words you already translated are kept unless you overwrite."),
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
    draft.translations[tag] = LeadFormTranslation()
    editing = LanguageSelection(id: tag)
  }
}

/// One language: the form's words and each field's, with the original as the placeholder. A word left empty falls back to the original.
private struct LeadFormTranslationSheet: View {
  let tag: String
  @Binding var draft: LeadFormDraft
  @Environment(\.dismiss) private var dismiss
  @State private var confirmRemove = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Leave a field empty to show the original, in \(ContentLocale.name(draft.locale)).").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LegalPanel("Words") {
            ForEach(LeadFormContent.keys.filter { !draft.content[word: $0.name].isEmpty && ($0.name != "confirmMessage" || draft.settings.doubleOptIn) }, id: \.name) { item in
              OnboardingTextField(label: item.label, text: contentBinding(item.name), limit: item.limit, placeholder: draft.content[word: item.name], multiline: item.name == "description")
            }
          }
          ForEach(draft.fields) { field in
            LegalPanel(LeadFormLimits.typeLabel(field.type)) {
              OnboardingTextField(label: "Label", text: fieldBinding(field.id, "label"), limit: LeadFormLimits.label, placeholder: field.label.isEmpty ? LeadFormLimits.typeLabel(field.type) : field.label)
              if field.hasPlaceholder && !field.placeholder.isEmpty {
                OnboardingTextField(label: "Placeholder", text: fieldBinding(field.id, "placeholder"), limit: LeadFormLimits.placeholder, placeholder: field.placeholder)
              }
              if field.type == "select" {
                ForEach(Array(field.options.enumerated()), id: \.offset) { index, option in
                  OnboardingTextField(label: String(localized: "Option \(index + 1)"), text: optionBinding(field, index), limit: LeadFormLimits.option, placeholder: option)
                }
                Text("The answer saved is still the original option.").font(.lnCaption).foregroundStyle(Theme.textMuted)
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
        Text("Its words are deleted when you save. Visitors who ask for it get the original.")
      }
    }
    .presentationDetents([.large])
  }

  private func contentBinding(_ name: String) -> Binding<String> {
    Binding(get: { draft.translations[tag]?.content[name] ?? "" }, set: { draft.translations[tag, default: LeadFormTranslation()].content[name] = $0 })
  }

  private func fieldBinding(_ id: String, _ name: String) -> Binding<String> {
    Binding(
      get: { draft.translations[tag]?.fields[id]?[text: name] ?? "" },
      set: { draft.translations[tag, default: LeadFormTranslation()].fields[id, default: LeadFormTranslation.FieldText()][text: name] = $0 }
    )
  }

  /// Options line up with the field's own; the list grows to reach the one being typed.
  private func optionBinding(_ field: LeadFormField, _ index: Int) -> Binding<String> {
    Binding(
      get: {
        let options = draft.translations[tag]?.fields[field.id]?.options ?? []
        return index < options.count ? options[index] : ""
      },
      set: { value in
        var words = draft.translations[tag]?.fields[field.id] ?? LeadFormTranslation.FieldText()
        var options = field.options.indices.map { $0 < words.options.count ? words.options[$0] : "" }
        options[index] = value
        words.options = options
        draft.translations[tag, default: LeadFormTranslation()].fields[field.id] = words
      }
    )
  }
}
