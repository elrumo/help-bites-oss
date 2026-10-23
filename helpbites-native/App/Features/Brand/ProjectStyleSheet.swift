import SwiftUI

/// The project's style in its own sheet (components/style/StyleProjectActions.vue's modal).
/// `from` is what a style panel offers to "Save as project style": it is laid over the
/// saved style so the person sees exactly what will be saved.
struct ProjectStyleSheet: View {
  let projectId: String
  var from: ProjectStyle? = nil
  var onSaved: () -> Void = {}
  @Environment(Workspace.self) private var workspace
  @Environment(\.dismiss) private var dismiss
  @State private var draft = ProjectStyle()
  @State private var kit = StyleBase()
  @State private var loaded = false
  @State private var saving = false
  @State private var error = ""

  private struct Patch: Encodable, Sendable { let style: ProjectStyle }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("One style for the whole project: its logo and icon, light and dark colours, corners, shadow and font. Every feature that has a style panel wears it unless it sets its own.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted).fixedSize(horizontal: false, vertical: true)
          if from != nil {
            Text("These are the choices from this panel. Saving makes them the project's style, so the other styled features follow.")
              .font(.lnCaption).foregroundStyle(Theme.textMuted).padding(10).frame(maxWidth: .infinity, alignment: .leading)
              .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radiusLarge))
          }
          if loaded { ProjectStyleEditor(style: $draft, kit: kit) } else { SkeletonRows(count: 4) }
          ErrorText(message: error)
        }
        .frame(maxWidth: 620, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .panelScreen("Project style")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button { Task { await save() } } label: { Text(saving ? "Saving…" : "Save style") }.disabled(!loaded || saving || !draft.isValid)
        }
      }
      .task { await load() }
    }
    .presentationDetents([.large])
    #if os(macOS)
    .frame(minWidth: 560, idealWidth: 640, minHeight: 640, idealHeight: 760)
    #endif
  }

  private func load() async {
    do {
      let project = try await ProjectsAdminProject.load(projectId, session: workspace.session)
      kit = project.look?.kit ?? StyleBase()
      let current = project.style ?? ProjectStyle()
      draft = from.map { current.overlaid(by: $0) } ?? current
      loaded = true
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func save() async {
    saving = true
    error = ""
    defer { saving = false }
    do {
      _ = try await ProjectsAdminProject.save(projectId, Patch(style: draft), workspace: workspace)
      onSaved()
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// The two ways into the project style from any style panel: edit it, or save what this
/// panel has chosen as the project's style (StyleProjectActions.vue).
struct ProjectStyleActions: View {
  let projectId: String
  var from: ProjectStyle? = nil
  var onSaved: () -> Void = {}
  @State private var route: Route?

  private enum Route: Identifiable {
    case save(ProjectStyle), edit
    var id: String { switch self { case .save: "save"; case .edit: "edit" } }
  }

  var body: some View {
    HStack(spacing: 8) {
      if let from { Button { route = .save(from) } label: { Label("Save as project style", systemImage: "bookmark") }.buttonStyle(.lnSecondaryCompact) }
      Button { route = .edit } label: { Label("Edit project style", systemImage: "paintpalette") }.buttonStyle(.lnGhost)
    }
    .sheet(item: $route) { route in
      switch route {
      case .save(let style): ProjectStyleSheet(projectId: projectId, from: style, onSaved: onSaved)
      case .edit: ProjectStyleSheet(projectId: projectId, onSaved: onSaved)
      }
    }
  }
}
