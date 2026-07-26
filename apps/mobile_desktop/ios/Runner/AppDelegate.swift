import Flutter
import UIKit
import UniformTypeIdentifiers

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate,
  UIDocumentInteractionControllerDelegate
{
  private let attachmentChannelName = "com.jiangjiu/attachments"
  private let appGroupIdentifier =
    "group.com.example.jiangjiuMobileDesktop.share"
  private let maxFileSize: Int64 = 10 * 1024 * 1024
  private var attachmentChannel: FlutterMethodChannel?
  private var documentInteractionController: UIDocumentInteractionController?
  private var hasTakenIncomingFiles = false

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if url.isFileURL, stageIncomingDocument(url) {
      return true
    }
    return super.application(app, open: url, options: options)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "JiangjiuAttachmentBridge"
    )
    let channel = FlutterMethodChannel(
      name: attachmentChannelName,
      binaryMessenger: registrar.messenger()
    )
    channel.setMethodCallHandler { [weak self] call, result in
      self?.handleAttachmentMethod(call, result: result)
    }
    attachmentChannel = channel
  }

  private func handleAttachmentMethod(
    _ call: FlutterMethodCall,
    result: @escaping FlutterResult
  ) {
    switch call.method {
    case "takeIncomingFiles":
      let coldStart = !hasTakenIncomingFiles
      hasTakenIncomingFiles = true
      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        let response = self?.takeIncomingFiles(coldStart: coldStart)
          ?? ["files": [], "errors": ["接收外部附件失败。"]]
        DispatchQueue.main.async {
          result(response)
        }
      }
    case "convertHeicToJpeg":
      convertHeicToJpeg(call, result: result)
    case "openFile":
      openFile(call, result: result)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func takeIncomingFiles(coldStart: Bool) -> [String: Any] {
    guard
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupIdentifier
      )
    else {
      return [
        "files": [],
        "errors": ["未找到共享附件容器，请检查 iPhone App Group 配置。"],
      ]
    }
    let incomingDirectory = container.appendingPathComponent(
      "incoming",
      isDirectory: true
    )
    guard
      let enumerator = FileManager.default.enumerator(
        at: incomingDirectory,
        includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
        options: [.skipsHiddenFiles]
      )
    else {
      return ["files": [], "errors": []]
    }

    var files: [[String: Any]] = []
    var errors: [String] = []
    for case let source as URL in enumerator {
      guard files.count < 5 else {
        errors.append("一次最多导入5个文件。")
        try? FileManager.default.removeItem(at: source)
        continue
      }
      do {
        let values = try source.resourceValues(
          forKeys: [.isRegularFileKey, .fileSizeKey]
        )
        guard values.isRegularFile == true else {
          continue
        }
        let safeName = sanitizeFileName(source.lastPathComponent)
        guard
          let mimeType = supportedMimeType(forFileName: safeName)
        else {
          errors.append("“\(safeName)”格式不受支持。")
          try? FileManager.default.removeItem(at: source)
          continue
        }
        let fileSize = Int64(values.fileSize ?? 0)
        guard fileSize <= maxFileSize else {
          errors.append("“\(safeName)”超过10MB，已拒绝导入。")
          try? FileManager.default.removeItem(at: source)
          continue
        }
        let targetDirectory = FileManager.default.temporaryDirectory
          .appendingPathComponent("incoming", isDirectory: true)
          .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
          at: targetDirectory,
          withIntermediateDirectories: true
        )
        let target = targetDirectory.appendingPathComponent(safeName)
        try FileManager.default.copyItem(at: source, to: target)
        try FileManager.default.removeItem(at: source)
        files.append([
          "path": target.path,
          "fileName": safeName,
          "mimeType": mimeType,
          "coldStart": coldStart,
        ])
      } catch {
        errors.append("复制“\(source.lastPathComponent)”失败，请重新导入。")
      }
    }
    removeEmptyDirectories(below: incomingDirectory)
    return ["files": files, "errors": errors]
  }

  @discardableResult
  func stageIncomingDocument(_ sourceURL: URL) -> Bool {
    guard sourceURL.isFileURL else {
      return false
    }
    let securityScoped = sourceURL.startAccessingSecurityScopedResource()
    defer {
      if securityScoped {
        sourceURL.stopAccessingSecurityScopedResource()
      }
    }
    let safeName = sanitizeFileName(sourceURL.lastPathComponent)
    guard supportedMimeType(forFileName: safeName) != nil else {
      return false
    }
    guard
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupIdentifier
      )
    else {
      return false
    }
    let targetDirectory = container
      .appendingPathComponent("incoming", isDirectory: true)
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let target = targetDirectory.appendingPathComponent(safeName)
    var coordinatorError: NSError?
    var copyError: Error?
    let coordinator = NSFileCoordinator()
    coordinator.coordinate(
      readingItemAt: sourceURL,
      options: [.withoutChanges],
      error: &coordinatorError
    ) { readableURL in
      do {
        let values = try readableURL.resourceValues(
          forKeys: [.fileSizeKey]
        )
        guard Int64(values.fileSize ?? 0) <= maxFileSize else {
          throw IncomingDocumentError.fileTooLarge
        }
        try FileManager.default.createDirectory(
          at: targetDirectory,
          withIntermediateDirectories: true
        )
        try FileManager.default.copyItem(at: readableURL, to: target)
      } catch {
        copyError = error
      }
    }
    guard coordinatorError == nil, copyError == nil else {
      try? FileManager.default.removeItem(at: targetDirectory)
      return false
    }
    attachmentChannel?.invokeMethod("incomingFilesAvailable", arguments: nil)
    return true
  }

  private func convertHeicToJpeg(
    _ call: FlutterMethodCall,
    result: @escaping FlutterResult
  ) {
    guard
      let arguments = call.arguments as? [String: Any],
      let sourcePath = arguments["path"] as? String,
      !sourcePath.isEmpty
    else {
      result(
        FlutterError(
          code: "HEIC_PATH_MISSING",
          message: "HEIC/HEIF照片缺少本地路径。",
          details: nil
        )
      )
      return
    }
    let originalName = arguments["fileName"] as? String ?? "photo.heic"
    DispatchQueue.global(qos: .userInitiated).async {
      guard let sourceImage = UIImage(contentsOfFile: sourcePath) else {
        DispatchQueue.main.async {
          result(
            FlutterError(
              code: "HEIC_DECODE_FAILED",
              message: "HEIC/HEIF照片解码失败，请重新选择。",
              details: nil
            )
          )
        }
        return
      }
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      let renderer = UIGraphicsImageRenderer(
        size: sourceImage.size,
        format: format
      )
      let normalizedImage = renderer.image { _ in
        sourceImage.draw(
          in: CGRect(origin: .zero, size: sourceImage.size)
        )
      }
      guard let jpegData = normalizedImage.jpegData(compressionQuality: 0.95)
      else {
        DispatchQueue.main.async {
          result(
            FlutterError(
              code: "JPEG_ENCODE_FAILED",
              message: "照片转换为JPEG失败，请重新选择。",
              details: nil
            )
          )
        }
        return
      }
      guard Int64(jpegData.count) <= self.maxFileSize else {
        DispatchQueue.main.async {
          result(
            FlutterError(
              code: "CONVERTED_FILE_TOO_LARGE",
              message: "转换后的JPEG照片超过10MB。",
              details: nil
            )
          )
        }
        return
      }
      do {
        let targetDirectory = FileManager.default.temporaryDirectory
          .appendingPathComponent("converted", isDirectory: true)
          .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
          at: targetDirectory,
          withIntermediateDirectories: true
        )
        let stem = (originalName as NSString).deletingPathExtension
        let target = targetDirectory.appendingPathComponent(
          "\(self.sanitizeFileName(stem)).jpg"
        )
        try jpegData.write(to: target, options: [.atomic])
        DispatchQueue.main.async {
          result([
            "path": target.path,
            "fileName": target.lastPathComponent,
          ])
        }
      } catch {
        DispatchQueue.main.async {
          result(
            FlutterError(
              code: "HEIC_CONVERSION_FAILED",
              message: "HEIC/HEIF照片转换失败，请重新选择。",
              details: nil
            )
          )
        }
      }
    }
  }

  private func openFile(
    _ call: FlutterMethodCall,
    result: FlutterResult
  ) {
    guard
      let arguments = call.arguments as? [String: Any],
      let filePath = arguments["path"] as? String,
      !filePath.isEmpty
    else {
      result(["status": "failed", "message": "附件参数不完整。"])
      return
    }
    guard FileManager.default.fileExists(atPath: filePath) else {
      result(["status": "missing_file"])
      return
    }
    guard let presenter = topViewController() else {
      result(["status": "failed", "message": "无法显示系统打开方式菜单。"])
      return
    }
    let controller = UIDocumentInteractionController(
      url: URL(fileURLWithPath: filePath)
    )
    controller.delegate = self
    documentInteractionController = controller
    let presented = controller.presentOpenInMenu(
      from: presenter.view.bounds,
      in: presenter.view,
      animated: true
    )
    result(["status": presented ? "opened" : "no_application"])
  }

  func documentInteractionControllerViewControllerForPreview(
    _ controller: UIDocumentInteractionController
  ) -> UIViewController {
    return topViewController() ?? UIViewController()
  }

  private func topViewController(
    from root: UIViewController? = UIApplication.shared.connectedScenes
      .compactMap {
        ($0 as? UIWindowScene)?.windows.first(where: { $0.isKeyWindow })
      }
      .first?.rootViewController
  ) -> UIViewController? {
    if let navigation = root as? UINavigationController {
      return topViewController(from: navigation.visibleViewController)
    }
    if let tab = root as? UITabBarController {
      return topViewController(from: tab.selectedViewController)
    }
    if let presented = root?.presentedViewController {
      return topViewController(from: presented)
    }
    return root
  }

  private func supportedMimeType(forFileName fileName: String) -> String? {
    switch (fileName as NSString).pathExtension.lowercased() {
    case "pdf":
      return UTType.pdf.preferredMIMEType ?? "application/pdf"
    case "doc":
      return "application/msword"
    case "docx":
      return
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    case "xls":
      return "application/vnd.ms-excel"
    case "xlsx":
      return
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    default:
      return nil
    }
  }

  private func sanitizeFileName(_ value: String) -> String {
    let baseName = (value as NSString).lastPathComponent
    let invalid = CharacterSet(charactersIn: "<>:\"/\\|?*")
      .union(.controlCharacters)
    let components = baseName.components(separatedBy: invalid)
    let sanitized = components.joined(separator: "_")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let safe = sanitized.isEmpty ? "attachment" : sanitized
    return String(safe.prefix(180))
  }

  private func removeEmptyDirectories(below directory: URL) {
    guard
      let enumerator = FileManager.default.enumerator(
        at: directory,
        includingPropertiesForKeys: [.isDirectoryKey],
        options: [.skipsHiddenFiles]
      )
    else {
      return
    }
    let directories = enumerator.compactMap { $0 as? URL }.reversed()
    for candidate in directories {
      guard
        (try? candidate.resourceValues(forKeys: [.isDirectoryKey]))
          ?.isDirectory == true,
        (try? FileManager.default.contentsOfDirectory(atPath: candidate.path))
          ?.isEmpty == true
      else {
        continue
      }
      try? FileManager.default.removeItem(at: candidate)
    }
  }

  private enum IncomingDocumentError: Error {
    case fileTooLarge
  }
}
