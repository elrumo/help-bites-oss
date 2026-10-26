import SwiftUI
import UIKit

/// The share sheet's host: the system presents this controller, and it hosts the SwiftUI form.
@objc(ShareViewController)
final class ShareViewController: UIViewController {
  private let model = ShareModel()

  override func viewDidLoad() {
    super.viewDidLoad()
    let root = ShareView(model: model, cancel: { [weak self] in self?.cancel() }, finish: { [weak self] in self?.finish() })
    let host = UIHostingController(rootView: root)
    addChild(host)
    host.view.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.topAnchor.constraint(equalTo: view.topAnchor),
      host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)
    ])
    host.didMove(toParent: self)
    let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
    Task { await model.start(items) }
  }

  private func cancel() {
    extensionContext?.cancelRequest(withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: nil)
  }
}
