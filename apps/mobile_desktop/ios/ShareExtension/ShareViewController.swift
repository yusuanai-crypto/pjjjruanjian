import Social
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private let appGroupIdentifier =
    "group.com.example.jiangjiuMobileDesktop.share"
  private let maxFileSize: Int64 = 10 * 1024 * 1024
  private let statusLabel = UILabel()

  private let supportedTypes: [(UTType, String)] = [
    (.pdf, "pdf"),
    (UTType("com.microsoft.word.doc")!, "doc"),
    (
      UTType(
        "org.openxmlformats.wordprocessingml.document"
      )!,
      "docx"
    ),
    (UTType("com.microsoft.excel.xls")!, "xls"),
    (
      UTType(
        "org.openxmlformats.spreadsheetml.sheet"
      )!,
      "xlsx"
    ),
  ]

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    statusLabel.numberOfLines = 0
    statusLabel.textAlignment = .center
    statusLabel.text = "正在安全导入附件…"
    view.addSubview(statusLabel)
    NSLayoutConstraint.activate([
      statusLabel.leadingAnchor.constraint(
        equalTo: view.leadingAnchor,
        constant: 24
      ),
      statusLabel.trailingAnchor.constraint(
        equalTo: view.trailingAnchor,
        constant: -24
      ),
      statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    importAttachments()
  }

  private func importAttachments() {
    let providers = extensionContext?.inputItems
      .compactMap { $0 as? NSExtensionItem }
      .flatMap { $0.attachments ?? [] } ?? []
    guard !providers.isEmpty else {
      finish(message: "没有收到可导入的文件。", openApp: false)
      return
    }
    guard providers.count <= 5 else {
      finish(message: "一次最多导入5个文件。", openApp: false)
      return
    }
    guard
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupIdentifier
      )
    else {
      finish(message: "共享附件容器不可用。", openApp: false)
      return
    }
    let incomingDirectory = container.appendingPathComponent(
      "incoming",
      isDirectory: true
    )
    do {
      try FileManager.default.createDirectory(
        at: incomingDirectory,
        withIntermediateDirectories: true
      )
    } catch {
      finish(message: "无法创建附件临时目录。", openApp: false)
      return
    }

    let group = DispatchGroup()
    let lock = NSLock()
    var importedCount = 0
    var errors: [String] = []
    for provider in providers {
      guard let supported = supportedType(for: provider) else {
        errors.append("包含不支持的文件格式。")
        continue
      }
      group.enter()
      provider.loadFileRepresentation(
        forTypeIdentifier: supported.0.identifier
      ) { [weak self] sourceURL, error in
        defer { group.leave() }
        guard let self, let sourceURL, error == nil else {
          lock.lock()
          errors.append("微信附件读取失败。")
          lock.unlock()
          return
        }
        let securityScoped = sourceURL.startAccessingSecurityScopedResource()
        defer {
          if securityScoped {
            sourceURL.stopAccessingSecurityScopedResource()
          }
        }
        do {
          let values = try sourceURL.resourceValues(
            forKeys: [.fileSizeKey]
          )
          guard Int64(values.fileSize ?? 0) <= self.maxFileSize else {
            throw ImportError.fileTooLarge
          }
          let originalStem = (sourceURL.lastPathComponent as NSString)
            .deletingPathExtension
          let safeName =
            "\(self.sanitizeFileName(originalStem)).\(supported.1)"
          let targetDirectory = incomingDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
          try FileManager.default.createDirectory(
            at: targetDirectory,
            withIntermediateDirectories: true
          )
          let target = targetDirectory.appendingPathComponent(safeName)
          try FileManager.default.copyItem(at: sourceURL, to: target)
          lock.lock()
          importedCount += 1
          lock.unlock()
        } catch ImportError.fileTooLarge {
          lock.lock()
          errors.append("“\(sourceURL.lastPathComponent)”超过10MB。")
          lock.unlock()
        } catch {
          lock.lock()
          errors.append("复制“\(sourceURL.lastPathComponent)”失败。")
          lock.unlock()
        }
      }
    }
    group.notify(queue: .main) { [weak self] in
      guard let self else { return }
      if importedCount == 0 {
        self.finish(
          message: errors.isEmpty ? "没有可导入的文件。" : errors.joined(separator: "；"),
          openApp: false
        )
        return
      }
      let suffix = errors.isEmpty ? "" : "；\(errors.joined(separator: "；"))"
      self.finish(
        message: "已接收\(importedCount)个附件\(suffix)",
        openApp: true
      )
    }
  }

  private func supportedType(
    for provider: NSItemProvider
  ) -> (UTType, String)? {
    return supportedTypes.first {
      provider.hasItemConformingToTypeIdentifier($0.0.identifier)
    }
  }

  private func finish(message: String, openApp: Bool) {
    statusLabel.text = message
    let complete = { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: nil)
    }
    guard
      openApp,
      let url = URL(string: "jiangjiu-attachments://incoming")
    else {
      DispatchQueue.main.asyncAfter(
        deadline: .now() + 1,
        execute: complete
      )
      return
    }
    extensionContext?.open(url) { _ in
      DispatchQueue.main.asyncAfter(
        deadline: .now() + 0.4,
        execute: complete
      )
    }
  }

  private func sanitizeFileName(_ value: String) -> String {
    let baseName = (value as NSString).lastPathComponent
    let invalid = CharacterSet(charactersIn: "<>:\"/\\|?*")
      .union(.controlCharacters)
    let sanitized = baseName.components(separatedBy: invalid)
      .joined(separator: "_")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return String((sanitized.isEmpty ? "attachment" : sanitized).prefix(160))
  }

  private enum ImportError: Error {
    case fileTooLarge
  }
}
