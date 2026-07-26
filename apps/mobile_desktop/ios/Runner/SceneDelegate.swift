import Flutter
import UIKit

class SceneDelegate: FlutterSceneDelegate {
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
}
