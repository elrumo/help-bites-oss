import SwiftUI

#if os(macOS)
// iOS-only SwiftUI API, given the same spelling on the Mac so screens stay shared.
// Where the Mac has a real equivalent (a toolbar's trailing edge, a sheet in place
// of a full-screen cover) it maps to that; text-input hints are no-ops.

enum UIKeyboardType { case `default`, URL, emailAddress, numberPad, decimalPad, asciiCapable, phonePad, twitter, webSearch, namePhonePad, asciiCapableNumberPad }

struct TextInputAutocapitalization: Sendable {
  static let never = TextInputAutocapitalization()
  static let words = TextInputAutocapitalization()
  static let sentences = TextInputAutocapitalization()
  static let characters = TextInputAutocapitalization()
}

enum TitleDisplayMode { case automatic, inline, large }

extension View {
  func keyboardType(_ type: UIKeyboardType) -> some View { self }
  func textInputAutocapitalization(_ value: TextInputAutocapitalization?) -> some View { self }
  func navigationBarTitleDisplayMode(_ mode: TitleDisplayMode) -> some View { self }
  func statusBarHidden(_ hidden: Bool = true) -> some View { self }
  func fullScreenCover<Item: Identifiable, Content: View>(item: Binding<Item?>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping (Item) -> Content) -> some View {
    sheet(item: item, onDismiss: onDismiss, content: content)
  }
  func fullScreenCover<Content: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) -> some View {
    sheet(isPresented: isPresented, onDismiss: onDismiss, content: content)
  }
}

// A Mac sheet sizes to its content, and a ScrollView has none: give every sheet that asked for
// detents a window-like size (wider and taller when it asked for .large), grown with the text size
// so a row of fields still fits. Its controls get the same look as everywhere else in the window.
extension View {
  func presentationDetents(_ detents: [PresentationDetent]) -> some View {
    let tall = detents.contains(.large)
    let scale = { (value: CGFloat) in Metrics.scaled(value) }
    return frame(minWidth: scale(tall ? 640 : 500), idealWidth: scale(tall ? 760 : 580), minHeight: tall ? 560 : 380, idealHeight: scale(tall ? 720 : 460))
      .panelControls()
  }
  func presentationDetents(_ detents: [PresentationDetent], selection: Binding<PresentationDetent>) -> some View {
    presentationDetents(detents)
  }
}

/// The panel's controls draw themselves (a bordered field, a menu whose label is a field or a chip), as they do
/// on iPhone and iPad. The Mac's defaults would wrap each one in its own bezel and add a second chevron.
struct LabelMenuStyle: MenuStyle {
  func makeBody(configuration: Configuration) -> some View {
    Menu(configuration).menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden)
  }
}

extension View {
  /// Applied to the window and to every sheet; a control's own `.menuStyle` or `.textFieldStyle` still wins.
  func panelControls() -> some View { menuStyle(LabelMenuStyle()).textFieldStyle(.plain) }
}

extension ToolbarItemPlacement {
  static var topBarLeading: ToolbarItemPlacement { .navigation }
  static var topBarTrailing: ToolbarItemPlacement { .primaryAction }
  static var bottomBar: ToolbarItemPlacement { .automatic }
}
#endif
