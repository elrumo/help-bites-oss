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

extension ToolbarItemPlacement {
  static var topBarLeading: ToolbarItemPlacement { .navigation }
  static var topBarTrailing: ToolbarItemPlacement { .primaryAction }
  static var bottomBar: ToolbarItemPlacement { .automatic }
}
#endif
