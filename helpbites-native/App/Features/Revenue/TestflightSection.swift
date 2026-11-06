import SwiftUI

/// TestFlight usage under the App Store source (web: the TestFlight section of projects/[id]/revenue.vue):
/// installs, sessions, crashes, invites and feedback, in total and for each app's newest builds.
/// It loads on its own, so a key that only reads sales shows a note here and leaves the revenue alone.
struct TestflightSection: View {
  let projectId: String
  @Environment(SessionStore.self) private var session
  @State private var report: TestflightReport?
  @State private var loading = true
  @State private var error = ""

  private func tiles(_ totals: TestflightReport.Counts) -> [(label: String, value: Int)] {
    [(String(localized: "Installs"), totals.installs), (String(localized: "Sessions"), totals.sessions), (String(localized: "Crashes"), totals.crashes), (String(localized: "Invites"), totals.invites), (String(localized: "Feedback"), totals.feedback)]
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionLabel("TestFlight")
      if loading {
        RoundedRectangle(cornerRadius: Metrics.radiusLarge).fill(Theme.elevated).frame(height: 92).redacted(reason: .placeholder)
      } else if !error.isEmpty {
        Label { VStack(alignment: .leading, spacing: 2) { Text("TestFlight could not be read").font(.lnRow); Text(error).font(.lnMeta) } } icon: { Image(systemName: "exclamationmark.triangle") }
          .foregroundStyle(Theme.warning).padding(12).frame(maxWidth: .infinity, alignment: .leading)
          .background(Theme.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: Metrics.radius))
      } else if let report, report.apps.contains(where: { !$0.builds.isEmpty }) {
        Text("Beta usage of each app's newest builds, as TestFlight reports it.").font(.lnCaption).foregroundStyle(Theme.textMuted)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 12)], spacing: 12) {
          ForEach(tiles(report.totals), id: \.label) { tile in
            VStack(alignment: .leading, spacing: 4) {
              Text(tile.label).font(.lnCaption).foregroundStyle(Theme.textMuted)
              Text(tile.value.formatted()).font(.app(size: 24, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.textHighlighted).lineLimit(1).minimumScaleFactor(0.6)
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: Metrics.radiusLarge).strokeBorder(Theme.border))
            .accessibilityElement(children: .combine)
          }
        }
        ForEach(report.apps.filter { !$0.builds.isEmpty }) { app in
          VStack(alignment: .leading, spacing: 6) {
            HStack { Text(app.name).font(.lnCallout.weight(.medium)).foregroundStyle(Theme.text); Spacer(minLength: 8); Text(app.bundleId).font(.lnCaption).foregroundStyle(Theme.textMuted).lineLimit(1) }
            Card {
              ForEach(app.builds) { build in
                CardRow(divider: build.id != app.builds.last?.id) { buildRow(build) }
              }
            }
          }
        }
      } else {
        Text("No builds have been uploaded to TestFlight yet.").font(.lnCaption).foregroundStyle(Theme.textDimmed)
      }
    }
    .task(id: projectId) { await load() }
  }

  /// "Build 1.4 (12)", then installs · sessions · crashes · feedback and when it was uploaded.
  private func buildRow(_ build: TestflightReport.Build) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 8) {
        Text("Build \(build.version.isEmpty ? "?" : build.version) (\(build.build))").font(.lnCallout).foregroundStyle(Theme.text).lineLimit(1)
        if build.expired { Tag(text: String(localized: "Expired")) }
        Spacer(minLength: 8)
        Text(Money.logTime(build.uploadedAt)).font(.lnCaption).foregroundStyle(Theme.textMuted)
      }
      Text("\(build.installs.formatted()) installs · \(build.sessions.formatted()) sessions · \(build.crashes.formatted()) crashes · \(build.invites.formatted()) invites · \(build.feedback.formatted()) feedback")
        .font(.lnCaption).monospacedDigit().foregroundStyle(Theme.textMuted)
    }
    .accessibilityElement(children: .combine)
  }

  private func load() async {
    struct Output: Decodable, Sendable { let report: TestflightReport }
    do {
      let output: Output = try await session.get("/v1/admin/revenue/testflight", query: ["project": projectId])
      report = output.report
      error = ""
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    loading = false
  }
}
