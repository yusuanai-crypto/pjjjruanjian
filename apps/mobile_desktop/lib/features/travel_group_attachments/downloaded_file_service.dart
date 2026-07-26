import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';

import 'attachment_picker_service.dart';

class DownloadedFileSaveResult {
  const DownloadedFileSaveResult({
    required this.path,
    required this.cancelled,
  });

  const DownloadedFileSaveResult.cancelled()
      : path = null,
        cancelled = true;

  final String? path;
  final bool cancelled;
}

enum ExternalOpenStatus {
  opened,
  noApplication,
  missingFile,
  failed,
}

class ExternalOpenResult {
  const ExternalOpenResult(this.status, {this.message});

  final ExternalOpenStatus status;
  final String? message;

  bool get opened => status == ExternalOpenStatus.opened;
}

abstract interface class ExternalFileOpener {
  Future<ExternalOpenResult> openFile({
    required String filePath,
    required String mimeType,
  });
}

class MethodChannelExternalFileOpener implements ExternalFileOpener {
  const MethodChannelExternalFileOpener({
    MethodChannel channel = const MethodChannel(
      'com.jiangjiu/attachments',
    ),
  }) : _channel = channel;

  final MethodChannel _channel;

  @override
  Future<ExternalOpenResult> openFile({
    required String filePath,
    required String mimeType,
  }) async {
    if (!await File(filePath).exists()) {
      return const ExternalOpenResult(
        ExternalOpenStatus.missingFile,
        message: '本地附件已丢失，请重新下载。',
      );
    }
    try {
      final result = await _channel.invokeMapMethod<String, dynamic>(
        'openFile',
        <String, dynamic>{
          'path': filePath,
          'mimeType': mimeType,
        },
      );
      return switch ('${result?['status'] ?? ''}') {
        'opened' => const ExternalOpenResult(ExternalOpenStatus.opened),
        'no_application' => const ExternalOpenResult(
            ExternalOpenStatus.noApplication,
            message: '没有找到可以打开该格式的应用。',
          ),
        'missing_file' => const ExternalOpenResult(
            ExternalOpenStatus.missingFile,
            message: '本地附件已丢失，请重新下载。',
          ),
        _ => ExternalOpenResult(
            ExternalOpenStatus.failed,
            message: '${result?['message'] ?? '打开附件失败，请稍后重试。'}',
          ),
      };
    } on MissingPluginException {
      return const ExternalOpenResult(
        ExternalOpenStatus.failed,
        message: '当前平台暂不支持调用其他应用打开附件。',
      );
    } on PlatformException catch (error) {
      return ExternalOpenResult(
        ExternalOpenStatus.failed,
        message: error.message?.trim().isNotEmpty == true
            ? error.message
            : '打开附件失败，请稍后重试。',
      );
    } catch (_) {
      return const ExternalOpenResult(
        ExternalOpenStatus.failed,
        message: '打开附件失败，请稍后重试。',
      );
    }
  }
}

abstract interface class DownloadDirectoryProvider {
  Future<Directory> getDownloadDirectory(TargetPlatform platform);
}

class PlatformDownloadDirectoryProvider implements DownloadDirectoryProvider {
  const PlatformDownloadDirectoryProvider();

  @override
  Future<Directory> getDownloadDirectory(TargetPlatform platform) async {
    Directory root;
    if (platform == TargetPlatform.android) {
      root = await getExternalStorageDirectory() ??
          await getApplicationDocumentsDirectory();
    } else {
      root = await getApplicationDocumentsDirectory();
    }
    return Directory(path.join(root.path, '附件下载'));
  }
}

abstract interface class DesktopDownloadSaver {
  Future<String?> save({
    required String fileName,
    required Uint8List bytes,
  });
}

class FilePickerDesktopDownloadSaver implements DesktopDownloadSaver {
  const FilePickerDesktopDownloadSaver();

  @override
  Future<String?> save({
    required String fileName,
    required Uint8List bytes,
  }) {
    return FilePicker.saveFile(
      dialogTitle: '保存附件',
      fileName: fileName,
      bytes: bytes,
      lockParentWindow: true,
    );
  }
}

class DownloadedFileService {
  DownloadedFileService({
    TargetPlatform? platform,
    ExternalFileOpener? opener,
    DownloadDirectoryProvider? directoryProvider,
    DesktopDownloadSaver? desktopSaver,
  })  : _platform = platform,
        _opener = opener ?? const MethodChannelExternalFileOpener(),
        _directoryProvider =
            directoryProvider ?? const PlatformDownloadDirectoryProvider(),
        _desktopSaver = desktopSaver ?? const FilePickerDesktopDownloadSaver();

  final TargetPlatform? _platform;
  final ExternalFileOpener _opener;
  final DownloadDirectoryProvider _directoryProvider;
  final DesktopDownloadSaver _desktopSaver;

  TargetPlatform get platform => _platform ?? defaultTargetPlatform;

  bool get isMobile {
    return !kIsWeb &&
        (platform == TargetPlatform.android || platform == TargetPlatform.iOS);
  }

  Future<DownloadedFileSaveResult> save({
    required String originalFileName,
    required Uint8List bytes,
  }) async {
    final safeName = sanitizeAttachmentFileName(originalFileName);
    if (!isMobile) {
      final savedPath = await _desktopSaver.save(
        fileName: safeName,
        bytes: bytes,
      );
      return savedPath == null
          ? const DownloadedFileSaveResult.cancelled()
          : DownloadedFileSaveResult(path: savedPath, cancelled: false);
    }

    final directory = await _directoryProvider.getDownloadDirectory(platform);
    await directory.create(recursive: true);
    final target = await _uniqueFile(directory, safeName);
    await target.writeAsBytes(bytes, flush: true);
    return DownloadedFileSaveResult(path: target.path, cancelled: false);
  }

  Future<ExternalOpenResult> open({
    required String filePath,
    required String mimeType,
  }) {
    return _opener.openFile(filePath: filePath, mimeType: mimeType);
  }

  Future<File> _uniqueFile(Directory directory, String fileName) async {
    final extension = path.extension(fileName);
    final stem = path.basenameWithoutExtension(fileName);
    var candidate = File(path.join(directory.path, fileName));
    var suffix = 1;
    while (await candidate.exists()) {
      candidate = File(
        path.join(directory.path, '$stem ($suffix)$extension'),
      );
      suffix += 1;
    }
    return candidate;
  }
}
