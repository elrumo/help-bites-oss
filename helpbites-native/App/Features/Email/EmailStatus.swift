import SwiftUI

// How each send status reads in the panel (app/utils/emailStatus.ts). Status
// colours mean state, so they always come with an icon and a word, never colour alone.

enum EmailTone: Sendable {
  case neutral, success, warning, error

  var color: Color {
    switch self {
    case .neutral: Theme.textMuted
    case .success: Theme.success
    case .warning: Theme.warning
    case .error: Theme.error
    }
  }
}

struct EmailStatusStyle: Sendable {
  let label: String
  let systemImage: String
  let tone: EmailTone
  let hint: String
}

enum EmailStatusText {
  /// Every status the log knows, in the web's order.
  static let statuses: [(key: String, style: EmailStatusStyle)] = [
    ("scheduled", EmailStatusStyle(label: "Scheduled", systemImage: "clock", tone: .neutral, hint: "Accepted; Mailgun delivers it at the scheduled time.")),
    ("sent", EmailStatusStyle(label: "Sent", systemImage: "paperplane", tone: .neutral, hint: "Accepted by Mailgun. Delivery events need the Mailgun webhook.")),
    ("delivered", EmailStatusStyle(label: "Delivered", systemImage: "checkmark", tone: .success, hint: "The receiving server accepted it.")),
    ("opened", EmailStatusStyle(label: "Opened", systemImage: "envelope.open", tone: .success, hint: "Opened at least once (needs open tracking).")),
    ("clicked", EmailStatusStyle(label: "Clicked", systemImage: "cursorarrow.click", tone: .success, hint: "A link was clicked (needs click tracking).")),
    ("unsubscribed", EmailStatusStyle(label: "Unsubscribed", systemImage: "bell.slash", tone: .warning, hint: "The recipient unsubscribed; the address is suppressed.")),
    ("bounced", EmailStatusStyle(label: "Bounced", systemImage: "xmark.circle", tone: .error, hint: "Permanently refused; the address is suppressed.")),
    ("complained", EmailStatusStyle(label: "Spam report", systemImage: "flag", tone: .error, hint: "Marked as spam; the address is suppressed.")),
    ("failed", EmailStatusStyle(label: "Failed", systemImage: "exclamationmark.circle", tone: .error, hint: "Mailgun did not accept it.")),
    ("suppressed", EmailStatusStyle(label: "Not sent", systemImage: "nosign", tone: .warning, hint: "Skipped: the address is on the suppression list."))
  ]

  static func known(_ key: String) -> EmailStatusStyle? { statuses.first { $0.key == key }?.style }

  static func style(_ key: String) -> EmailStatusStyle {
    known(key) ?? EmailStatusStyle(label: key.isEmpty ? "Sent" : key.capitalized, systemImage: "hourglass", tone: .neutral, hint: "")
  }

  static let sources: [(key: String, label: String)] = [
    ("api", "API"), ("admin", "Operator"), ("test", "Test"), ("notification", "Notification"), ("feedback", "Feedback"), ("system", "HelpBites"),
    ("campaign", "Campaign"), ("sequence", "Sequence"), ("form", "Lead form")
  ]

  static func source(_ key: String?) -> String {
    guard let key, !key.isEmpty else { return "" }
    return sources.first { $0.key == key }?.label ?? key
  }

  static let suppressionReasons: [(key: String, label: String)] = [
    ("bounce", "Bounced"), ("complaint", "Spam report"), ("unsubscribe", "Unsubscribed"), ("manual", "Added by hand")
  ]

  static func reason(_ key: String?) -> String {
    guard let key, !key.isEmpty else { return "" }
    return suppressionReasons.first { $0.key == key }?.label ?? key
  }

  static func reasonTone(_ key: String?) -> EmailTone {
    switch key {
    case "bounce", "complaint": .error
    case "unsubscribe": .warning
    default: .neutral
    }
  }

  /// 1,284 · 12.9K · 4.2M
  static func compactCount(_ value: Int) -> String {
    value < 10_000 ? value.formatted() : value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
  }

  static func date(_ raw: String?) -> Date? {
    guard let raw, !raw.isEmpty else { return nil }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: raw) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: raw)
  }

  /// Today's time ("14:05"), else the day ("Sep 12"), with the year when it isn't this one.
  static func logTime(_ raw: String?) -> String {
    guard let date = date(raw) else { return "" }
    let calendar = Calendar.current
    if calendar.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
    if calendar.component(.year, from: date) == calendar.component(.year, from: Date()) {
      return date.formatted(.dateTime.month(.abbreviated).day())
    }
    return date.formatted(.dateTime.month(.abbreviated).day().year())
  }

  /// "Sep 12, 2026 at 14:05:09".
  static func fullDate(_ raw: String?) -> String {
    guard let date = date(raw) else { return "" }
    return date.formatted(date: .abbreviated, time: .standard)
  }

  static func kilobytes(_ bytes: Double) -> String {
    if bytes < 1024 { return "\(Int(bytes)) B" }
    let kb = bytes / 1024
    return bytes < 10 * 1024 ? String(format: "%.1f KB", kb) : "\(Int(kb.rounded())) KB"
  }

  /// A logged value as text: strings as they are, numbers without a trailing ".0".
  static func plain(_ value: JSONValue?) -> String {
    guard let value else { return "" }
    switch value {
    case .string(let text): return text
    case .null: return ""
    default: return EmailRender.js(value)
    }
  }
}

/// The status chip: icon, word and tone.
struct EmailStatusBadge: View {
  let status: String
  var body: some View {
    let style = EmailStatusText.style(status)
    EmailToneBadge(label: style.label, systemImage: style.systemImage, tone: style.tone)
  }
}

struct EmailToneBadge: View {
  let label: String
  var systemImage: String? = nil
  let tone: EmailTone
  var body: some View {
    HStack(spacing: 4) {
      if let systemImage { Image(systemName: systemImage).font(.system(size: 10, weight: .semibold)) }
      Text(label).lineLimit(1)
    }
    .font(.lnCaptionMedium)
    .foregroundStyle(tone == .neutral ? Theme.textToned : tone.color)
    .padding(.horizontal, 8)
    .frame(height: 22)
    .background((tone == .neutral ? Theme.textMuted : tone.color).opacity(0.12), in: Capsule())
  }
}

/// A soft notice box (the web's UAlert variant="soft").
struct EmailNotice: View {
  let systemImage: String
  let title: String
  var message: String? = nil
  var tone: EmailTone = .neutral
  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: systemImage).font(.system(size: 14, weight: .medium)).foregroundStyle(tone == .neutral ? Theme.textMuted : tone.color)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
        if let message, !message.isEmpty { Text(message).font(.lnCaption).foregroundStyle(Theme.textMuted).textSelection(.enabled) }
      }
      Spacer(minLength: 0)
    }
    .padding(12)
    .background((tone == .neutral ? Theme.textMuted : tone.color).opacity(0.1), in: RoundedRectangle(cornerRadius: Metrics.radius))
  }
}

/// What a project's email still needs, under the tab bar of every Email tab (web: EmailSetupStrip.vue):
/// a mailer on the server, a sender, the delivery webhook, and for campaigns and sequences a postal
/// address and a sender that is not paused. Nothing shows once there is nothing to say. The judging is
/// the server's; this only words it.
struct EmailSetupStrip: View {
  let checks: [EmailSetupCheck]
  /// On Campaigns, Sequences and Settings, which have two more things to be ready.
  var bulk = false
  /// Opens Email → Settings.
  let openSettings: () -> Void

  /// Blocking things first; the delivery webhook is a nudge, shown while there is nothing worse.
  private var problems: [EmailSetupCheck] {
    let open = checks.filter { $0.state != "ok" && ($0.scope == "all" || bulk) && Self.words($0) != nil }
    return open.filter { $0.state == "todo" } + open.filter { $0.state != "todo" }
  }

  private var blocking: Bool { problems.contains { $0.state == "todo" } }

  var body: some View {
    if !problems.isEmpty {
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          Image(systemName: blocking ? "exclamationmark.triangle" : "info.circle")
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(blocking ? Theme.warning : Theme.textMuted)
          Text(blocking ? "Email cannot go out yet" : "Email works; one thing is worth fixing").font(.lnMetaMedium).foregroundStyle(Theme.textHighlighted)
          Spacer(minLength: 8)
          Button("Open settings", action: openSettings).buttonStyle(.lnGhost)
        }
        ForEach(problems) { check in
          if let words = Self.words(check) {
            Text("\(Text(words.title).fontWeight(.medium).foregroundStyle(Theme.text)) \(words.text)")
              .font(.lnCaption)
              .foregroundStyle(Theme.textMuted)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.leading, 22)
          }
        }
      }
      .padding(.horizontal, Metrics.gutter)
      .padding(.vertical, 10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(blocking ? Theme.warning.opacity(0.08) : Theme.elevated.opacity(0.5))
      .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 0.5) }
      .accessibilityElement(children: .contain)
    }
  }

  /// `emailSetup.<key>.title` and `emailSetup.<key>.<state>` of en.json; a pair the server does not send has no words.
  private static func words(_ check: EmailSetupCheck) -> (title: String, text: String)? {
    switch (check.key, check.state) {
    case ("mailer", "todo"): return ("Mail server.", "This server has no Mailgun API key, so it cannot send any email. Set MAILGUN_API_KEY.")
    case ("sender", "todo"): return ("Sender.", "Neither this project nor the server has a from address and sending domain. Set them in Email → Settings.")
    case ("webhook", "warn"): return ("Delivery events.", "Mailgun's webhook is not set up, so the log never learns about deliveries, opens or bounces and bounced addresses are not suppressed.")
    case ("postalAddress", "todo"): return ("Postal address.", "Every campaign must carry one. Add it in Email → Settings.")
    case ("paused", "todo"): return ("Bulk mail is paused.", "\(check.value ?? "").")
    default: return nil
    }
  }
}

/// A file waiting to be shared.
struct EmailSharedFile: Identifiable {
  let id = UUID()
  let url: URL
}

enum EmailFiles {
  /// A file-safe name: "Password reset!" becomes "password-reset".
  static func slug(_ name: String, fallback: String = "email") -> String {
    let lowered = name.lowercased().replacing(#/[^a-z0-9.-]+/#, with: "-")
    let trimmed = lowered.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    return trimmed.isEmpty ? fallback : trimmed
  }

  /// Writes `data` under a fresh temporary folder, so the share sheet offers it by its own name.
  static func write(_ data: Data, named filename: String) throws -> URL {
    let folder = FileManager.default.temporaryDirectory.appending(path: "email-exports").appending(path: UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appending(path: filename)
    try data.write(to: url, options: .atomic)
    return url
  }

  static func prettyJSON<Value: Encodable>(_ value: Value) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes, .sortedKeys]
    return try encoder.encode(value)
  }
}
