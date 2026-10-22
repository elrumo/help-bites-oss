import SwiftUI

/// A flow's languages (web: the Languages section of projects/[id]/onboarding/[flowId].vue): the
/// language the steps are written in, one translation per other language, and the AI that fills
/// them in. Edits go to the draft and save with the rest of the flow.
struct OnboardingLanguagesPanel: View {
  @Binding var draft: OnboardingDraft
  /// The AI works on the saved copy, so only when nothing is waiting to be saved.
  let canTranslate: Bool
  let translate: ([String], Bool) async throws -> Void
  @State private var editing: LanguageSelection?
  @State private var translating = false

  private var tags: [String] { draft.translations.keys.sorted() }
  private var full: Bool { tags.count >= ContentLocale.onboardingTranslations }

  var body: some View {
    LegalPanel(title: "Languages", trailing: {
      Text("\(tags.count) of \(ContentLocale.onboardingTranslations)").font(.lnCaption).foregroundStyle(Theme.textMuted).monospacedDigit()
    }, content: {
      LabeledField(label: "Written in", hint: "The language of the steps above. Apps that ask for a language the flow lacks get this one.") {
        LanguageMenu(include: [draft.locale], onPick: setLocale) { Label(ContentLocale.label(draft.locale), systemImage: "globe") }
      }
      if tags.isEmpty {
        Text("No translations yet. Add a language to write it yourself, or translate with AI.").font(.lnMeta).foregroundStyle(Theme.textMuted)
      } else {
        VStack(spacing: 0) {
          ForEach(tags, id: \.self) { tag in
            let progress = (draft.translations[tag] ?? OnboardingTranslation()).progress(name: draft.name, steps: draft.steps)
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
          .buttonStyle(.lnSecondaryCompact).disabled(!canTranslate || draft.steps.isEmpty)
      }
      if !canTranslate { Text("Save your changes first: the AI translates the saved flow.").font(.lnCaption).foregroundStyle(Theme.textMuted) }
      Text("Translations are machine drafts: read them before you publish. Apps see them after the next publish.").font(.lnCaption).foregroundStyle(Theme.textMuted)
    })
    .sheet(item: $editing) { selection in
      OnboardingTranslationSheet(tag: selection.id, draft: $draft)
    }
    .sheet(isPresented: $translating) {
      TranslateSheet(
        title: String(localized: "Translate with AI"), source: draft.locale, existing: tags,
        note: String(localized: "Fills in the name, titles, bodies, button labels and image descriptions of the saved flow. Strings you already translated are kept unless you overwrite."),
        run: { locales, overwrite in try await translate(locales, overwrite) }
      )
    }
  }

  /// Another language for the steps: a translation into that language makes no sense any more.
  private func setLocale(_ tag: String) {
    draft.locale = tag
    draft.translations = draft.translations.filter { !ContentLocale.same($0.key, tag) }
  }

  private func add(_ tag: String) {
    guard !full, !draft.translations.keys.contains(where: { ContentLocale.same($0, tag) }) else { return }
    draft.translations[tag] = OnboardingTranslation()
    editing = LanguageSelection(id: tag)
  }
}

/// One language: the name and each step's words, with the original as the placeholder. A field left empty falls back to the original.
private struct OnboardingTranslationSheet: View {
  let tag: String
  @Binding var draft: OnboardingDraft
  @Environment(\.dismiss) private var dismiss
  @State private var confirmRemove = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("Leave a field empty to show the original, in \(ContentLocale.name(draft.locale)).").font(.lnMeta).foregroundStyle(Theme.textMuted)
          OnboardingTextField(label: "Name", text: nameBinding, limit: OnboardingLimits.name, placeholder: draft.name)
          ForEach(Array(draft.steps.enumerated()), id: \.element.id) { index, step in
            LegalPanel("Step \(index + 1)") {
              ForEach(StepField.allCases.filter { $0 != .imageAlt || !step.imageUrl.isEmpty }) { field in
                OnboardingTextField(label: field.label, text: binding(step.id, field), limit: field.limit, placeholder: placeholder(step, field, last: index == draft.steps.count - 1), multiline: field == .body)
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
        Text("Its text is deleted when you save. Apps that ask for it get the original.")
      }
    }
    .presentationDetents([.large])
  }

  private var nameBinding: Binding<String> {
    Binding(get: { draft.translations[tag]?.name ?? "" }, set: { draft.translations[tag, default: OnboardingTranslation()].name = $0 })
  }

  private func binding(_ stepId: String, _ field: StepField) -> Binding<String> {
    Binding(
      get: { draft.translations[tag]?.steps[stepId]?[field] ?? "" },
      set: { draft.translations[tag, default: OnboardingTranslation()].steps[stepId, default: OnboardingStepText()][field] = $0 }
    )
  }

  /// The original; a button without one shows the client's own wording.
  private func placeholder(_ step: OnboardingStep, _ field: StepField, last: Bool) -> String {
    let original = field.original(step)
    if !original.isEmpty || field != .buttonLabel { return original }
    return last ? "Get started" : "Continue"
  }
}
