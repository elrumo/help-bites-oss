import SwiftUI

// Linear's small glyphs, drawn rather than borrowed from SF Symbols so they
// match the web panel's exactly (components/StatusIcon.vue, PriorityIcon.vue).

/// Status category glyph: open is an empty ring, pending half full, resolved a
/// filled check, closed a filled cross.
struct StatusIcon: View {
  let category: String
  var size: CGFloat = 14

  var body: some View {
    ZStack {
      switch category {
      case "resolved", "closed":
        Circle().fill(tone)
        Image(systemName: category == "resolved" ? "checkmark" : "xmark")
          .font(.system(size: size * 0.5, weight: .bold))
          .foregroundStyle(.white)
      default:
        Circle().strokeBorder(tone, lineWidth: size * 0.11)
        if category == "pending" {
          HalfDisc().fill(tone).padding(size * 0.25)
        }
      }
    }
    .frame(width: size, height: size)
    .accessibilityLabel(Text(LocalizedStringKey(category.capitalized)))
  }

  private var tone: Color {
    switch category {
    case "pending": Theme.pending
    case "resolved": Theme.accent
    default: Theme.textDimmed
    }
  }
}

private struct HalfDisc: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: rect.midX, y: rect.minY))
    path.addArc(center: CGPoint(x: rect.midX, y: rect.midY), radius: rect.width / 2, startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: false)
    path.closeSubpath()
    return path
  }
}

/// Priority glyph: bars that fill with the level, an orange flag for urgent.
struct PriorityIcon: View {
  let priority: String
  var size: CGFloat = 14

  var body: some View {
    Group {
      if priority == "urgent" {
        RoundedRectangle(cornerRadius: size * 0.22)
          .fill(Theme.urgent)
          .overlay(Text("!").font(.system(size: size * 0.72, weight: .heavy)).foregroundStyle(.white))
      } else {
        HStack(alignment: .bottom, spacing: size * 0.12) {
          ForEach(0..<3, id: \.self) { index in
            RoundedRectangle(cornerRadius: 1)
              .fill(Theme.textToned.opacity(index < level ? 1 : 0.3))
              .frame(width: size * 0.22, height: size * [0.36, 0.58, 0.8][index])
          }
        }
        .frame(width: size, height: size, alignment: .bottom)
        .padding(.bottom, size * 0.08)
      }
    }
    .frame(width: size, height: size)
    .accessibilityLabel(Text("\(String(localized: String.LocalizationValue(priority.capitalized))) priority"))
  }

  private var level: Int { ["low": 1, "normal": 2, "high": 3][priority] ?? 0 }
}

/// A lifecycle state the Linear way: a coloured dot and the word.
struct StatusDot: View {
  let status: String
  var label: String? = nil

  var body: some View {
    HStack(spacing: 6) {
      Circle().fill(tone).frame(width: 6, height: 6)
      name.font(.lnCaption).foregroundStyle(Theme.textMuted)
    }
  }

  /// A status the app defines is looked up in the catalog; a label the team wrote stays as it is.
  private var name: Text { label.map { Text($0.capitalized) } ?? Text(LocalizedStringKey(status.capitalized)) }

  private var tone: Color {
    switch status {
    case "active", "ready", "processed", "on": Theme.success
    case "draft", "outdated", "pending", "admins": Theme.warning
    case "processing": Theme.info
    case "failed", "error": Theme.error
    default: Theme.textDimmed
    }
  }
}

/// The sidebar's team-style project icon: the project's custom icon, else its
/// initial on its colour (web: ProjectDot.vue).
struct ProjectTile: View {
  let id: String
  let name: String
  var accent: String? = nil
  var icon: String? = nil
  var size: CGFloat = 18

  var body: some View {
    Group {
      if let url = ProjectIcon.url(icon) {
        CachedAsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { initial }
          .frame(width: size, height: size)
          .clipShape(RoundedRectangle(cornerRadius: size * 0.28))
      } else {
        initial
      }
    }
    .accessibilityHidden(true)
  }

  private var initial: some View {
    Text(String(name.prefix(1)).uppercased())
      .font(.system(size: size * 0.56, weight: .semibold))
      .foregroundStyle(.white)
      .frame(width: size, height: size)
      .background(Theme.projectColor(id: id, accent: accent), in: RoundedRectangle(cornerRadius: size * 0.28))
      .overlay(RoundedRectangle(cornerRadius: size * 0.28).strokeBorder(.white.opacity(0.12)))
  }
}

/// The small project colour dot that tags conversations and customers; the
/// project's icon when it has one.
struct ProjectDot: View {
  let id: String
  var accent: String? = nil
  var icon: String? = nil
  var size: CGFloat = 8

  var body: some View {
    Group {
      if let url = ProjectIcon.url(icon) {
        CachedAsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { dot }
          .frame(width: size * 1.5, height: size * 1.5)
          .clipShape(RoundedRectangle(cornerRadius: size * 0.4))
      } else {
        dot
      }
    }
    .accessibilityHidden(true)
  }

  private var dot: some View {
    Circle().fill(Theme.projectColor(id: id, accent: accent)).frame(width: size, height: size)
  }
}

enum ProjectIcon {
  static func url(_ raw: String?) -> URL? {
    guard let raw, !raw.isEmpty else { return nil }
    return URL(string: raw)
  }
}

/// Initials in a grey circle, as Linear draws people.
struct Avatar: View {
  let name: String
  var size: CGFloat = 24
  var tint: Color? = nil

  var body: some View {
    Text(Self.initials(name))
      .font(.system(size: max(9, size * 0.4), weight: .semibold))
      .foregroundStyle(tint == nil ? Theme.textToned : .white)
      .frame(width: size, height: size)
      .background(tint ?? Theme.accented, in: Circle())
      .accessibilityHidden(true)
  }

  static func initials(_ value: String) -> String {
    let words = value.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "@" }).prefix(2)
    let letters = words.compactMap(\.first).map(String.init).joined().uppercased()
    return letters.isEmpty ? "?" : letters
  }
}
