import SwiftUI

/// The email editor, full screen and native (web: pages/emails/[id].vue and
/// EmailEditor.vue). On iPhone the email fills the screen and everything else
/// comes up in one sheet: the selected block's inspector, the email's settings,
/// variables, layers or the AI designer. On iPad and Mac it's the web's three
/// panes: AI and layers, the canvas, the inspector.
struct EmailEditorScreen: View {
  let target: EmailEditorTarget
  @Environment(SessionStore.self) private var session

  var body: some View {
    EmailEditorRoot(target: target, session: session)
  }
}

private struct EmailEditorRoot: View {
  @State private var store: EmailEditorStore
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase

  /// iPhone's one sheet, and what it shows.
  enum Panel: String, Identifiable { case design, variables, ai, layers; var id: String { rawValue } }
  /// Everything else that opens over the editor.
  enum Modal: Identifiable, Sendable {
    case starters, test(EmailTemplateItem), share(EmailTemplateItem), api(EmailTemplateItem), file(URL), checks, languages
    var id: String {
      switch self {
      case .starters: "starters"
      case .languages: "languages"
      case .test: "test"
      case .share: "share"
      case .api: "api"
      case .file(let url): url.absoluteString
      case .checks: "checks"
      }
    }
  }
  enum SidebarTab: String, CaseIterable, Identifiable { case ai, layers; var id: String { rawValue } }
  enum InspectorTab: String, CaseIterable, Identifiable { case design, variables; var id: String { rawValue } }

  @State private var panel: Panel?
  @State private var detent = PresentationDetent.fraction(0.45)
  @State private var modal: Modal?
  /// A modal waiting for the panel sheet to finish closing (one sheet at a time).
  @State private var queuedModal: Modal?
  @State private var showSidebar = true
  @State private var sidebarTab = SidebarTab.ai
  @State private var showInspector = true
  @State private var inspectorTab = InspectorTab.design
  @State private var checksOpen = false
  @State private var renaming = false
  @State private var renameText = ""
  @State private var confirmLeave = false

  init(target: EmailEditorTarget, session: SessionStore) {
    _store = State(initialValue: EmailEditorStore(target: target, session: session))
  }

  private var compact: Bool { sizeClass == .compact }

  var body: some View {
    NavigationStack {
      Group {
        if store.loading {
          ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if !store.loadError.isEmpty {
          EmptyState(systemImage: "exclamationmark.triangle", title: "Could not open the email", message: store.loadError) {
            Button("Close") { dismiss() }.buttonStyle(.lnSecondaryCompact)
          }
          .frame(maxHeight: .infinity)
        } else if compact {
          compactLayout
        } else {
          regularLayout
        }
      }
      .background(Theme.panel)
      .sheet(item: componentRequest(presentedHere: panel == nil)) { componentSheet($0) }
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { toolbar }
      .alert("Rename", isPresented: $renaming) {
        TextField("Name", text: $renameText)
        Button("Cancel", role: .cancel) {}
        Button("Rename") { store.setName(renameText) }
      }
      .alert("Your latest changes aren't saved", isPresented: $confirmLeave) {
        Button("Try again") { Task { await done() } }
        Button("Leave anyway", role: .destructive) { dismiss() }
        Button("Stay", role: .cancel) {}
      } message: {
        if case .failed(let message) = store.saveState { Text(message) }
      }
      .alert("Something went wrong", isPresented: Binding(get: { !store.notice.isEmpty }, set: { if !$0 { store.notice = "" } })) {
        Button("OK", role: .cancel) {}
      } message: { Text(store.notice) }
      .sheet(item: $modal) { modalView($0) }
    }
    .task { await store.start() }
    .onChange(of: scenePhase) { _, phase in
      if phase != .active { Task { await store.flush() } }
    }
  }

  // MARK: iPhone

  private var compactLayout: some View {
    VStack(spacing: 0) {
      modeBar
      Rectangle().fill(Theme.border).frame(height: 1)
      stage
      if store.mode == .edit { bottomBar }
    }
    .sheet(isPresented: Binding(get: { panel != nil }, set: { if !$0 { panel = nil } }), onDismiss: presentQueued) {
      panelSheet
    }
    // Tapping a block opens its inspector, unless the AI is open: then it points the AI at it.
    .onChange(of: store.selectedId) { _, id in
      if id != nil, panel != .ai { panel = .design }
    }
  }

  private var panelSheet: some View {
    NavigationStack {
      Group {
        switch panel ?? .design {
        case .design: designPanel
        case .variables: EmailVariablesPanel(store: store)
        case .ai: EmailChatPanel(store: store)
        case .layers: EmailLayersPanel(store: store)
        }
      }
      .panelScreen(panelTitle)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button("Done") { panel = nil } }
        if panel == .design, store.selectedId != nil {
          ToolbarItem(placement: .cancellationAction) {
            Button { store.selectedId = nil } label: { Label("Email settings", systemImage: "envelope") }
          }
        }
      }
    }
    .sheet(item: componentRequest(presentedHere: panel != nil)) { componentSheet($0) }
    .presentationDetents([.fraction(0.45), .large], selection: $detent)
    .presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.45)))
    .presentationContentInteraction(.scrolls)
  }

  private var panelTitle: String {
    switch panel ?? .design {
    case .design: store.selected.map { $0.kind?.label ?? String(localized: "Block") } ?? String(localized: "Email")
    case .variables: String(localized: "Variables")
    case .ai: String(localized: "AI designer")
    case .layers: String(localized: "Layers")
    }
  }

  /// Layers, Add, AI, Email and Variables along the bottom, in thumb's reach.
  private var bottomBar: some View {
    HStack(spacing: 0) {
      barButton(String(localized: "Layers"), "square.3.layers.3d") { panel = .layers }
      EmailAddBlockMenu(store: store) { barLabel(String(localized: "Add"), "plus.circle.fill", tint: Theme.accent) }
        .frame(maxWidth: .infinity)
      barButton(String(localized: "AI"), "sparkles") { panel = .ai; detent = .large }
      barButton(String(localized: "Email"), "envelope") { store.selectedId = nil; panel = .design }
      barButton(String(localized: "Variables"), "curlybraces") { panel = .variables }
    }
    .padding(.top, 6)
    .background(Theme.panel)
    .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
  }

  private func barButton(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
    Button(action: action) { barLabel(title, symbol) }
      .buttonStyle(.plain)
      .frame(maxWidth: .infinity)
  }

  private func barLabel(_ title: String, _ symbol: String, tint: Color = Theme.textMuted) -> some View {
    VStack(spacing: 3) {
      Image(systemName: symbol).font(.system(size: 18)).foregroundStyle(tint)
      Text(title).font(.system(size: 10, weight: .medium)).foregroundStyle(Theme.textMuted)
    }
    .frame(maxWidth: .infinity, minHeight: 44)
    .contentShape(Rectangle())
  }

  // MARK: iPad and Mac

  private var regularLayout: some View {
    HStack(spacing: 0) {
      if showSidebar {
        VStack(spacing: 0) {
          Picker("Sidebar", selection: $sidebarTab) {
            Text("AI designer").tag(SidebarTab.ai)
            Text("Layers").tag(SidebarTab.layers)
          }
          .pickerStyle(.segmented)
          .padding(12)
          switch sidebarTab {
          case .ai: EmailChatPanel(store: store)
          case .layers: EmailLayersPanel(store: store)
          }
        }
        .frame(width: 320)
        .background(Theme.panel)
        Rectangle().fill(Theme.border).frame(width: 1)
      }
      VStack(spacing: 0) {
        modeBar
        Rectangle().fill(Theme.border).frame(height: 1)
        stage
      }
    }
    .inspector(isPresented: $showInspector) {
      VStack(spacing: 0) {
        Picker("Inspector", selection: $inspectorTab) {
          Text("Design").tag(InspectorTab.design)
          Text("Variables").tag(InspectorTab.variables)
        }
        .pickerStyle(.segmented)
        .padding(12)
        switch inspectorTab {
        case .design: designPanel
        case .variables: EmailVariablesPanel(store: store)
        }
      }
      .background(Theme.panel)
      .inspectorColumnWidth(min: 280, ideal: 320, max: 420)
    }
    .onChange(of: store.selectedId) { _, id in
      if id != nil { inspectorTab = .design; showInspector = true }
    }
  }

  // MARK: Shared pieces

  /// The selected block's inspector, else the email's own settings (web: EmailInspector.vue).
  @ViewBuilder private var designPanel: some View {
    if let id = store.selectedId, store.design.block(id) != nil {
      EmailBlockInspector(store: store, blockId: id).id(id)
    } else {
      EmailSettingsPanel(store: store)
    }
  }

  /// Edit or Preview, the preview's device, and the checks.
  private var modeBar: some View {
    HStack(spacing: 10) {
      Picker("Mode", selection: $store.mode) {
        Text("Edit").tag(EmailEditorStore.Mode.edit)
        Text("Preview").tag(EmailEditorStore.Mode.preview)
      }
      .pickerStyle(.segmented)
      .frame(maxWidth: 200)
      Picker("Device", selection: $store.device) {
        ForEach(EmailEditorStore.Device.allCases) { device in
          Image(systemName: device.systemImage).accessibilityLabel(device.label).tag(device)
        }
      }
      .pickerStyle(.segmented)
      .frame(maxWidth: 96)
      if store.mode == .preview, !store.translations.isEmpty {
        Picker("Language", selection: $store.previewLocale) {
          Text(ContentLocale.name(store.locale)).tag(String?.none)
          ForEach(store.translations.keys.sorted(), id: \.self) { Text(ContentLocale.name($0)).tag(Optional($0)) }
        }
        .pickerStyle(.menu).labelsHidden()
      }
      Spacer(minLength: 0)
      checksButton
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
  }

  @ViewBuilder private var stage: some View {
    switch store.mode {
    case .edit:
      EmailCanvas(store: store) { id in askAI(about: id) }
    case .preview:
      EmailPreviewPane(html: store.stageHTML, device: store.device)
    }
  }

  private var checksButton: some View {
    let errors = store.errorCount
    let count = store.issues.count
    let tint = errors > 0 ? Theme.error : count > 0 ? Theme.warning : Theme.textMuted
    return Button {
      if compact { open(.checks) } else { checksOpen = true }
    } label: {
      Label(count > 0 ? "\(count)" : "Checks", systemImage: errors > 0 ? "exclamationmark.circle" : count > 0 ? "exclamationmark.triangle" : "checkmark.circle")
        .font(.lnMetaMedium)
        .foregroundStyle(tint)
        .frame(minHeight: 32)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(count > 0 ? "\(count) checks failing" : "All checks pass")
    .popover(isPresented: $checksOpen) {
      EmailChecksList(store: store, onSelect: { checksOpen = false }, onFix: { checksOpen = false; fixWithAI() })
        .frame(width: 340)
        .frame(minHeight: 120)
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .cancellationAction) {
      Button("Done") { Task { await done() } }
    }
    ToolbarItem(placement: .principal) {
      Button { renameText = store.name; renaming = true } label: {
        HStack(spacing: 6) {
          Text(store.name.isEmpty ? String(localized: "Email") : store.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          saveDot
        }
      }
      .buttonStyle(.plain)
      .accessibilityHint("Renames the email")
    }
    ToolbarItemGroup(placement: .primaryAction) {
      if !compact {
        Button { withAnimation { showSidebar.toggle() } } label: { Label("Sidebar", systemImage: "sidebar.left") }
        EmailAddBlockMenu(store: store) { Label("Add block", systemImage: "plus") }
      }
      Button { store.undo() } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
        .disabled(!store.canUndo)
        .keyboardShortcut("z", modifiers: .command)
      Button { store.redo() } label: { Label("Redo", systemImage: "arrow.uturn.forward") }
        .disabled(!store.canRedo)
        .keyboardShortcut("z", modifiers: [.command, .shift])
      moreMenu
      if !compact {
        Button { withAnimation { showInspector.toggle() } } label: { Label("Inspector", systemImage: "sidebar.right") }
      }
    }
  }

  /// Saved, saving, waiting, or failed (tap to retry), like the web's status pill.
  @ViewBuilder private var saveDot: some View {
    switch store.saveState {
    case .saved:
      Circle().fill(Theme.success).frame(width: 6, height: 6).accessibilityLabel("Saved")
    case .pending, .saving:
      ProgressView().controlSize(.mini).accessibilityLabel("Saving")
    case .failed:
      Button { Task { await store.save() } } label: {
        Image(systemName: "exclamationmark.circle.fill").font(.system(size: 12)).foregroundStyle(Theme.error)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Not saved. Retry")
    }
  }

  private var moreMenu: some View {
    Menu {
      Button { open(.starters) } label: { Label("Start from a template", systemImage: "square.grid.2x2") }
      Button { renameText = store.name; renaming = true } label: { Label("Rename", systemImage: "pencil") }
      Button { open(.languages) } label: { Label("Languages", systemImage: "globe") }
      Divider()
      Button { withSaved { .test($0) } } label: { Label("Send test", systemImage: "paperplane") }
      Button { withSaved { .share($0) } } label: { Label("Share", systemImage: "link") }
      Menu {
        Button { Clipboard.copy(store.previewHTML) } label: { Label("Copy HTML", systemImage: "doc.on.doc") }
        Button { shareHTML() } label: { Label("Share HTML file", systemImage: "doc.richtext") }
        Button { shareJSON() } label: { Label("Share JSON file", systemImage: "curlybraces.square") }
        Button { withSaved { .api($0) } } label: { Label("Use via API", systemImage: "chevron.left.forwardslash.chevron.right") }
      } label: {
        Label("Export", systemImage: "square.and.arrow.up")
      }
    } label: {
      Label("More", systemImage: "ellipsis.circle")
    }
  }

  // MARK: Modals

  @ViewBuilder private func modalView(_ modal: Modal) -> some View {
    switch modal {
    case .starters:
      EmailStarterPicker(title: "Start from a template", onPick: { starter in
        self.modal = nil
        Task { await store.applyStarter(starter.id) }
      }, onBlank: {
        self.modal = nil
        store.applyBlank()
      })
    case .test(let item):
      EmailTestSheet(template: item)
    case .share(let item):
      EmailShareSheet(template: item) { mode, token, expiresAt in store.updateShare(mode: mode, token: token, expiresAt: expiresAt) }
    case .api(let item):
      EmailAPISheet(template: item) { key in store.updateKey(key) }
    case .file(let url):
      ShareSheet(url: url).presentationDetents([.medium, .large])
    case .languages:
      EmailLanguagesPanel(store: store)
    case .checks:
      NavigationStack {
        EmailChecksList(store: store, onSelect: { self.modal = nil }, onFix: { self.modal = nil; fixWithAI() })
          .panelScreen("Checks")
          .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { self.modal = nil } } }
      }
      .presentationDetents([.medium, .large])
    }
  }

  /// One sheet at a time: close the panel first, then show the modal.
  private func open(_ next: Modal) {
    if panel != nil {
      queuedModal = next
      panel = nil
    } else {
      modal = next
    }
  }

  private func presentQueued() {
    guard let next = queuedModal else { return }
    queuedModal = nil
    modal = next
  }

  /// Test sends, shares and the API read the saved template, so save first.
  private func withSaved(_ make: @escaping @Sendable (EmailTemplateItem) -> Modal) {
    Task {
      await store.flush()
      guard let item = store.currentItem else { return }
      open(make(item))
    }
  }

  private func shareHTML() {
    do { open(.file(try EmailFiles.write(Data(store.previewHTML.utf8), named: "\(EmailFiles.slug(store.name)).html"))) }
    catch { store.notice = error.localizedDescription }
  }

  private func shareJSON() {
    guard let item = store.currentItem else { return }
    do { open(.file(try EmailExport.jsonFile(item))) }
    catch { store.notice = error.localizedDescription }
  }

  // MARK: Components

  /// The component sheet (Save as component, Edit component, New component…):
  /// over iPhone's panel while that's open, else over the editor.
  private func componentRequest(presentedHere: Bool) -> Binding<EmailComponentRequest?> {
    Binding(
      get: { presentedHere ? store.componentRequest : nil },
      set: { if presentedHere { store.componentRequest = $0 } }
    )
  }

  private func componentSheet(_ request: EmailComponentRequest) -> some View {
    // "Let the AI do it" only when a block is being saved.
    var askAI: (() -> Void)?
    if request.replaceId != nil { askAI = { makeReusableWithAI() } }
    return EmailComponentEditor(
      request: request,
      projectId: store.template?.projectId,
      onSaved: { saved in store.componentSaved(saved, replacing: request.replaceId) },
      onAskAI: askAI
    )
  }

  /// "Let the AI do it": the designer saves the selected block as a component itself.
  private func makeReusableWithAI() {
    openAI()
    store.chat.send(EmailChatPrompts.makeReusable.prompt)
  }

  // MARK: AI

  private func askAI(about id: String) {
    store.selectedId = id
    openAI()
  }

  private func fixWithAI() {
    openAI()
    store.chat.send(store.fixPrompt)
  }

  private func openAI() {
    if compact {
      panel = .ai
      detent = .large
    } else {
      showSidebar = true
      sidebarTab = .ai
    }
  }

  // MARK: Leaving

  private func done() async {
    await store.flush()
    if case .failed = store.saveState { confirmLeave = true } else { dismiss() }
  }
}

/// The email checks (lint.ts): tap one to select its block; Fix with AI hands them all to the AI.
private struct EmailChecksList: View {
  @Bindable var store: EmailEditorStore
  var onSelect: () -> Void
  var onFix: () -> Void

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 4) {
        Text(store.issues.isEmpty ? "All checks pass" : "Checks").font(.lnCaptionMedium).foregroundStyle(Theme.textMuted).padding(.bottom, 4)
        ForEach(store.issues) { issue in
          Button {
            if let id = issue.blockId {
              store.selectedId = id
              store.mode = .edit
            }
            onSelect()
          } label: {
            HStack(alignment: .top, spacing: 8) {
              Image(systemName: issue.level == .error ? "exclamationmark.circle" : "exclamationmark.triangle")
                .foregroundStyle(issue.level == .error ? Theme.error : Theme.warning)
              Text(issue.message).font(.lnCallout).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
              Spacer(minLength: 0)
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
        if !store.issues.isEmpty {
          Button(action: onFix) { Label("Fix with AI", systemImage: "sparkles").frame(maxWidth: .infinity) }
            .buttonStyle(.lnSecondary)
            .padding(.top, 8)
        }
      }
      .padding(16)
    }
  }
}
