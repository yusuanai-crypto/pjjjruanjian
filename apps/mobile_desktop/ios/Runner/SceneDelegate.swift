import Flutter
import UIKit

class SceneDelegate: FlutterSceneDelegate {
  private var privacyOverlay: UIView?

  override func sceneWillResignActive(_ scene: UIScene) {
    showPrivacyOverlay(in: scene)
    super.sceneWillResignActive(scene)
  }

  override func sceneDidEnterBackground(_ scene: UIScene) {
    showPrivacyOverlay(in: scene)
    super.sceneDidEnterBackground(scene)
  }

  override func sceneDidBecomeActive(_ scene: UIScene) {
    removePrivacyOverlay()
    super.sceneDidBecomeActive(scene)
  }

  override func scene(
    _ scene: UIScene,
    openURLContexts URLContexts: Set<UIOpenURLContext>
  ) {
    if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
      for context in URLContexts where context.url.isFileURL {
        appDelegate.stageIncomingDocument(context.url)
      }
    }
    super.scene(scene, openURLContexts: URLContexts)
  }

  private func showPrivacyOverlay(in scene: UIScene) {
    guard
      privacyOverlay == nil,
      let windowScene = scene as? UIWindowScene,
      let window =
        windowScene.windows.first(where: { $0.isKeyWindow })
        ?? windowScene.windows.first
    else {
      return
    }

    let overlay = UIView(frame: window.bounds)
    overlay.backgroundColor = .systemBackground
    overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    overlay.accessibilityIdentifier = "privacy-task-snapshot-overlay"

    let label = UILabel()
    label.translatesAutoresizingMaskIntoConstraints = false
    label.text = "品鉴酱酒中心\n内容已保护"
    label.textAlignment = .center
    label.numberOfLines = 0
    label.textColor = .secondaryLabel
    label.font = .preferredFont(forTextStyle: .headline)
    overlay.addSubview(label)
    NSLayoutConstraint.activate([
      label.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
      label.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
    ])

    window.addSubview(overlay)
    privacyOverlay = overlay
  }

  private func removePrivacyOverlay() {
    privacyOverlay?.removeFromSuperview()
    privacyOverlay = nil
  }
}
