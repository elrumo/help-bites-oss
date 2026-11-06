import SwiftUI

/// A project's onboarding flows (web: projects/[id]/onboarding/index.vue): the list,
/// and the sheet that starts one and opens it in the editor.
struct OnboardingScreen: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var flows: [OnboardingFlow] = []
  @State private var loading = true
  @State private var error = ""
  @State private var creating = false
  /// The flow the sheet just made, pushed once the sheet is gone.
  @State private var created: String?
  @State private var path: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Onboarding").font(.lnHeading).foregroundStyle(Theme.textHighlighted)
          Text("Show new users a few screens that explain your app. Publish a flow and your web or Swift app shows it once, even when HelpBites is unreachable.")
            .font(.lnMeta).foregroundStyle(Theme.textMuted)
        }
        ErrorText(message: error)
        if loading && flows.isEmpty {
          SkeletonRows(count: 3)
        } else if flows.isEmpty && error.isEmpty {
          EmptyState(systemImage: "rectangle.stack", title: "No flows yet", message: "Start a flow, write a few screens, and publish it. Your app shows it to new users once.") {
            Button { creating = true } label: { Label("New flow", systemImage: "plus") }.buttonStyle(.lnPrimaryCompact)
          }
          .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else if !flows.isEmpty {
          Card {
            ForEach(Array(flows.enumerated()), id: \.element.id) { index, flow in
              CardRow(divider: index < flows.count - 1) { row(flow) }
            }
          }
        }
      }
      .frame(maxWidth: 760, alignment: .leading)
      .padding(.horizontal, 20)
      .padding(.vertical, 28)
      .frame(maxWidth: .infinity)
    }
    .refreshable { await load() }
    .projectScreen(projectId, "Onboarding")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button { creating = true } label: { Label("New flow", systemImage: "plus") }.disabled(flows.count >= OnboardingLimits.flows)
      }
    }
    .sheet(isPresented: $creating, onDismiss: {
      if let created { path = created; self.created = nil }
    }) {
      OnboardingNewFlowSheet(projectId: projectId) { flow in
        flows.append(flow)
        created = flow.id
      }
    }
    .navigationDestination(item: $path) { id in OnboardingFlowScreen(projectId: projectId, flowId: id) }
    .task { await load() }
  }

  private func row(_ flow: OnboardingFlow) -> some View {
    NavigationLink(value: AppRoute.onboardingFlow(projectId, flow.id)) {
      HStack(spacing: 10) {
        VStack(alignment: .leading, spacing: 2) {
          Text(flow.name).font(.lnRow).foregroundStyle(Theme.textHighlighted).lineLimit(1)
          Text(flow.key).font(.lnMono).foregroundStyle(Theme.textMuted).lineLimit(1)
          HStack(spacing: 6) {
            Tag(text: flow.statusLabel, tint: flow.isPublished ? Theme.success : Theme.textDimmed)
            if flow.changed { Tag(text: "Unpublished changes", tint: Theme.warning) }
            Text("\(flow.steps.count) \(flow.steps.count == 1 ? String(localized: "step") : String(localized: "steps"))").font(.lnCaption).foregroundStyle(Theme.textMuted)
          }
          .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        Image(systemName: "chevron.right").font(.app(size: 11, weight: .semibold)).foregroundStyle(Theme.textDimmed)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func load() async {
    struct Response: Decodable, Sendable { let flows: [OnboardingFlow] }
    do {
      let response: Response = try await session.get("/v1/admin/onboarding/flows", query: ["project": projectId])
      flows = response.flows
      error = ""
    } catch {
      if case APIError.cancelled = error { return }
      self.error = error.localizedDescription
    }
    loading = false
  }
}

/// Name a new flow (and optionally its key); it starts with three starter steps.
private struct OnboardingNewFlowSheet: View {
  let projectId: String
  let onCreate: (OnboardingFlow) -> Void
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var key = ""
  @State private var saving = false
  @State private var error = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("It starts with three screens to edit. Nothing shows in your app until you publish.").font(.lnMeta).foregroundStyle(Theme.textMuted)
          LabeledField(label: "Name") {
            TextField("Welcome", text: $name).textFieldStyle(.linear)
              .onChange(of: name) { _, value in name = value.clipped(to: OnboardingLimits.name) }
          }
          LabeledField(label: "Key", hint: "Optional. Your app asks for the flow by it; empty makes one from the name.") {
            TextField("welcome", text: $key).textFieldStyle(.linear).font(.lnMono).textInputAutocapitalization(.never).autocorrectionDisabled()
          }
          ErrorText(message: error)
        }
        .padding(20)
      }
      .panelScreen("New flow")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Create") { Task { await create() } }.disabled(saving)
        }
      }
    }
    .presentationDetents([.medium])
  }

  private func create() async {
    struct Input: Encodable, Sendable { let project, name: String; let key: String? }
    let key = key.trimmingCharacters(in: .whitespaces).lowercased()
    if !key.isEmpty, !OnboardingLimits.validKey(key) { error = OnboardingLimits.keyRule; return }
    saving = true
    error = ""
    defer { saving = false }
    do {
      let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
      let response: OnboardingFlowResponse = try await session.send("/v1/admin/onboarding/flows", body: Input(project: projectId, name: name.isEmpty ? "Welcome" : name, key: key.isEmpty ? nil : key))
      onCreate(response.flow)
      dismiss()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
