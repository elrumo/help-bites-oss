import SwiftUI

/// The short tour a new account sees once (web: WelcomeTour.vue): five cards, skippable at any point,
/// replayable from Settings. Finishing or skipping clears `tourPending` on the server (`PATCH /v1/admin/me`).
struct WelcomeTourSheet: View {
  @Environment(SessionStore.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var step = 0

  private struct Card {
    let icon: String
    let title, body: LocalizedStringKey
    let points: [LocalizedStringKey]
  }

  private static let cards: [Card] = [
    Card(icon: "sparkles", title: "Welcome to HelpBites", body: "One toolkit for everything between you and your users. This takes about a minute.",
         points: ["Support, feedback, updates and email in one place", "Free to skip now and replay later from Settings", "Nothing to set up right away"]),
    Card(icon: "square.stack.3d.up", title: "Start with a project", body: "A project is one of your apps or sites. Everything else lives inside it.",
         points: ["Each project has its own public key for the widget and API", "Show only the sections you use in its sidebar", "Add as many projects as you have apps"]),
    Card(icon: "tray", title: "Talk to your users", body: "Every message lands in one shared inbox.",
         points: ["Chat from the widget, email and forms arrive together", "AI assistants answer from your knowledge base, and you approve the drafts", "Saved replies and email templates keep answers quick"]),
    Card(icon: "lightbulb", title: "Listen, ship, announce", body: "Close the loop with the people who use your product.",
         points: ["A feedback board and a public roadmap", "A changelog and blog your users can follow", "Error tracking and feature flags without a deploy"]),
    Card(icon: "person.2", title: "Make it yours", body: "A few things worth doing once you have a project.",
         points: ["Invite teammates from Settings → Team", "Pick your AI provider, and connect GitHub or Stripe", "Create API keys to automate anything you can click"])
  ]

  private var card: Card { Self.cards[step] }
  private var last: Bool { step == Self.cards.count - 1 }

  var body: some View {
    NavigationStack {
      VStack(spacing: 20) {
        Image(systemName: card.icon).font(.app(size: 28)).foregroundStyle(Theme.accentText)
          .frame(width: 56, height: 56)
          .background(Theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
          .accessibilityHidden(true)
        VStack(spacing: 6) {
          Text(card.title).font(.lnTitle).foregroundStyle(Theme.textHighlighted).multilineTextAlignment(.center)
          Text(card.body).font(.lnBody).foregroundStyle(Theme.textMuted).multilineTextAlignment(.center)
        }
        VStack(spacing: 8) {
          ForEach(Array(card.points.enumerated()), id: \.offset) { _, point in
            HStack(alignment: .top, spacing: 10) {
              Image(systemName: "checkmark").font(.app(size: 12, weight: .semibold)).foregroundStyle(Theme.accentText).padding(.top, 3)
              Text(point).font(.lnMeta).foregroundStyle(Theme.text)
              Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Theme.elevated, in: RoundedRectangle(cornerRadius: Metrics.radius))
          }
        }
        Spacer(minLength: 0)
        HStack(spacing: 6) {
          ForEach(0..<Self.cards.count, id: \.self) { i in
            Capsule().fill(i == step ? Theme.accent : Theme.accented).frame(width: i == step ? 16 : 6, height: 6)
          }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(step + 1) of \(Self.cards.count)")
        HStack(spacing: 10) {
          if step > 0 { Button("Back") { withAnimation { step -= 1 } }.buttonStyle(.lnSecondary) }
          Button(last ? "Done" : "Next") { if last { dismiss() } else { withAnimation { step += 1 } } }.buttonStyle(.lnPrimary)
        }
      }
      .padding(24)
      .frame(maxWidth: 480)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Theme.panel)
      .navigationTitle("")
      .toolbar {
        if !last { ToolbarItem(placement: .cancellationAction) { Button("Skip tour") { dismiss() } } }
      }
    }
    // A swipe down skips too; only a tour that was still pending tells the server.
    .onDisappear { if session.agent?.tourPending == true { Task { await session.finishTour() } } }
  }
}
