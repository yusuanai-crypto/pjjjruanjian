import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as path;

import '../../core/api/api_client.dart';
import '../../core/crash_reporting/crash_reporter.dart';
import '../../core/file_security_policy.dart';

const attachmentMaxFileCount = fileSecurityMaxFiles;
const attachmentMaxFileSizeBytes = fileSecurityMaxFileBytes;
const _attachmentFileHeaderSize = 32;

const guestInfoAttachmentExtensions = <String>[
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'avif',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'txt',
  'log',
  'md',
];

const photoAttachmentExtensions = <String>[
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'avif',
];

enum GuestAttachmentSource {
  gallery,
  wechat,
  files,
}

enum AttachmentFileKind {
  jpeg('image/jpeg'),
  png('image/png'),
  gif('image/gif'),
  webp('image/webp'),
  bmp('image/bmp'),
  tiff('image/tiff'),
  avif('image/avif'),
  heic('image/heic'),
  pdf('application/pdf'),
  wordBinary('application/msword'),
  excelBinary('application/vnd.ms-excel'),
  wordOpenXml(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ),
  excelOpenXml(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ),
  text('text/plain');

  const AttachmentFileKind(this.mimeType);

  final String mimeType;

  bool get isImage {
    return switch (this) {
      jpeg || png || gif || webp || bmp || tiff || avif || heic => true,
      _ => false,
    };
  }
}

class PickedAttachment {
  const PickedAttachment({
    required this.file,
    required this.kind,
    this.temporaryPath,
  });

  final ApiMultipartFile file;
  final AttachmentFileKind kind;
  final String? temporaryPath;

  String get fileName => file.fileName;

  Future<void> deleteTemporaryCopy() async {
    final candidate = temporaryPath;
    if (candidate == null || candidate.trim().isEmpty) {
      return;
    }
    try {
      final file = File(candidate);
      if (await file.exists()) {
        await file.delete();
      }
      final parent = file.parent;
      if (await parent.exists() && (await parent.list().isEmpty)) {
        await parent.delete();
      }
    } catch (_) {
      // A later operating-system cache cleanup can safely finish this work.
    }
  }
}

class AttachmentPickResult {
  const AttachmentPickResult({
    this.files = const <PickedAttachment>[],
    this.message,
  });

  final List<PickedAttachment> files;
  final String? message;

  bool get isEmpty => files.isEmpty;
}

class AttachmentCandidate {
  const AttachmentCandidate({
    required this.fileName,
    this.path,
    this.bytes,
    this.declaredMimeType,
    this.temporary = false,
    this.requireDeclaredMimeMatch = false,
  }) : assert(path != null || bytes != null);

  final String fileName;
  final String? path;
  final Uint8List? bytes;
  final String? declaredMimeType;
  final bool temporary;
  final bool requireDeclaredMimeMatch;

  Future<Uint8List> readBytes() async {
    final memoryBytes = bytes;
    if (memoryBytes != null) {
      return memoryBytes;
    }
    return File(path!).readAsBytes();
  }

  Future<Uint8List> readHeaderBytes([
    int maxLength = _attachmentFileHeaderSize,
  ]) async {
    final memoryBytes = bytes;
    if (memoryBytes != null) {
      if (memoryBytes.length <= maxLength) {
        return memoryBytes;
      }
      return Uint8List.sublistView(memoryBytes, 0, maxLength);
    }
    final file = await File(path!).open();
    try {
      return await file.read(maxLength);
    } finally {
      await file.close();
    }
  }

  Future<int> length() async {
    final memoryBytes = bytes;
    if (memoryBytes != null) {
      return memoryBytes.length;
    }
    return File(path!).length();
  }
}

abstract interface class GalleryPickerGateway {
  Future<List<AttachmentCandidate>> pickMultiImage({required int limit});

  Future<List<AttachmentCandidate>> retrieveLostImages();
}

class ImagePickerGalleryGateway implements GalleryPickerGateway {
  ImagePickerGalleryGateway({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<List<AttachmentCandidate>> pickMultiImage({
    required int limit,
  }) async {
    final files = await _picker.pickMultiImage(
      imageQuality: 100,
      limit: limit,
      requestFullMetadata: true,
    );
    return files.map(_candidateFromXFile).toList();
  }

  @override
  Future<List<AttachmentCandidate>> retrieveLostImages() async {
    final response = await _picker.retrieveLostData();
    if (response.isEmpty) {
      return const <AttachmentCandidate>[];
    }
    final files = response.files;
    if (files != null) {
      return files.map(_candidateFromXFile).toList();
    }
    throw response.exception ?? StateError('系统恢复了图片选择流程，但没有返回可读取的照片。');
  }

  AttachmentCandidate _candidateFromXFile(XFile file) {
    return AttachmentCandidate(
      fileName: file.name,
      path: file.path,
      declaredMimeType: file.mimeType,
      temporary: true,
    );
  }
}

abstract interface class DeviceFilePickerGateway {
  Future<List<AttachmentCandidate>> pickFiles({
    required List<String> allowedExtensions,
  });
}

class FilePickerGateway implements DeviceFilePickerGateway {
  const FilePickerGateway();

  @override
  Future<List<AttachmentCandidate>> pickFiles({
    required List<String> allowedExtensions,
  }) async {
    final result = await FilePicker.pickFiles(
      allowMultiple: true,
      type: FileType.custom,
      allowedExtensions: allowedExtensions,
      withData: false,
    );
    return result?.files.map(_candidateFromPlatformFile).toList() ??
        const <AttachmentCandidate>[];
  }

  AttachmentCandidate _candidateFromPlatformFile(PlatformFile file) {
    final bytes = file.bytes;
    if (bytes != null) {
      return AttachmentCandidate(fileName: file.name, bytes: bytes);
    }
    final selectedPath = file.path;
    if (selectedPath == null || selectedPath.trim().isEmpty) {
      throw StateError('无法读取“${file.name}”，请重新选择。');
    }
    return AttachmentCandidate(fileName: file.name, path: selectedPath);
  }
}

abstract interface class AttachmentNativeBridge {
  Future<AttachmentCandidate> convertHeicToJpeg(
    AttachmentCandidate source,
  );
}

class MethodChannelAttachmentNativeBridge implements AttachmentNativeBridge {
  const MethodChannelAttachmentNativeBridge({
    MethodChannel channel = const MethodChannel(
      'com.jiangjiu/attachments',
    ),
  }) : _channel = channel;

  final MethodChannel _channel;

  @override
  Future<AttachmentCandidate> convertHeicToJpeg(
    AttachmentCandidate source,
  ) async {
    final sourcePath = source.path;
    if (sourcePath == null || sourcePath.trim().isEmpty) {
      throw StateError('HEIC/HEIF 照片缺少可转换的本地路径。');
    }
    CrashReporting.breadcrumb('heic_conversion.native.start');
    try {
      final result = await _channel.invokeMapMethod<String, dynamic>(
        'convertHeicToJpeg',
        <String, dynamic>{
          'path': sourcePath,
          'fileName': source.fileName,
        },
      );
      final convertedPath = '${result?['path'] ?? ''}'.trim();
      final convertedName = '${result?['fileName'] ?? ''}'.trim();
      if (convertedPath.isEmpty || convertedName.isEmpty) {
        throw StateError('HEIC/HEIF 照片转换失败，请重新选择。');
      }
      CrashReporting.breadcrumb(
        'heic_conversion.native.success',
        data: {
          if (result?['width'] is num) 'imageWidth': result!['width'],
          if (result?['height'] is num) 'imageHeight': result!['height'],
        },
      );
      return AttachmentCandidate(
        fileName: convertedName,
        path: convertedPath,
        declaredMimeType: 'image/jpeg',
        temporary: true,
        requireDeclaredMimeMatch: true,
      );
    } catch (error, stackTrace) {
      CrashReporting.breadcrumb(
        'heic_conversion.native.failure',
        data: {'exceptionType': error.runtimeType.toString()},
      );
      unawaited(
        CrashReporting.recordError(
          error,
          stackTrace,
          source: 'attachment.heic_conversion',
        ),
      );
      rethrow;
    }
  }
}

class AttachmentPickerService {
  AttachmentPickerService({
    GalleryPickerGateway? galleryPicker,
    DeviceFilePickerGateway? filePicker,
    AttachmentNativeBridge? nativeBridge,
    TargetPlatform? platform,
  })  : _galleryPicker = galleryPicker ?? ImagePickerGalleryGateway(),
        _filePicker = filePicker ?? const FilePickerGateway(),
        _nativeBridge =
            nativeBridge ?? const MethodChannelAttachmentNativeBridge(),
        _platform = platform;

  final GalleryPickerGateway _galleryPicker;
  final DeviceFilePickerGateway _filePicker;
  final AttachmentNativeBridge _nativeBridge;
  final TargetPlatform? _platform;

  TargetPlatform get platform => _platform ?? defaultTargetPlatform;

  bool get isMobile {
    return !kIsWeb &&
        (platform == TargetPlatform.android || platform == TargetPlatform.iOS);
  }

  Future<AttachmentPickResult> pickKeyCustomerPhotos({
    required int existingCount,
  }) async {
    if (isMobile) {
      return _pickGallery(existingCount: existingCount);
    }
    return _pickDeviceFiles(
      existingCount: existingCount,
      allowedExtensions: photoAttachmentExtensions,
      imagesOnly: true,
    );
  }

  Future<AttachmentPickResult> pickGuestInfoPhotos({
    required int existingCount,
  }) {
    return _pickGallery(existingCount: existingCount);
  }

  Future<AttachmentPickResult> pickGuestInfoFiles({
    required int existingCount,
  }) {
    return _pickDeviceFiles(
      existingCount: existingCount,
      allowedExtensions: guestInfoAttachmentExtensions,
      imagesOnly: false,
    );
  }

  Future<AttachmentPickResult> retrieveLostPhotoSelection({
    int existingCount = 0,
  }) async {
    if (kIsWeb || platform != TargetPlatform.android) {
      return const AttachmentPickResult();
    }
    CrashReporting.breadcrumb('image_selection.restore.start');
    late final List<AttachmentCandidate> candidates;
    try {
      candidates = await _galleryPicker.retrieveLostImages();
    } catch (error, stackTrace) {
      CrashReporting.breadcrumb(
        'image_selection.restore.failure',
        data: {'exceptionType': error.runtimeType.toString()},
      );
      unawaited(
        CrashReporting.recordError(
          error,
          stackTrace,
          source: 'image_selection.restore',
        ),
      );
      rethrow;
    }
    CrashReporting.breadcrumb(
      'image_selection.restore.complete',
      data: {'selectedCount': candidates.length},
    );
    return _prepareAndValidate(
      candidates,
      existingCount: existingCount,
      imagesOnly: true,
    );
  }

  Future<AttachmentPickResult> validateIncomingFiles(
    List<AttachmentCandidate> candidates, {
    required int existingCount,
    bool imagesOnly = false,
  }) {
    return _prepareAndValidate(
      candidates,
      existingCount: existingCount,
      imagesOnly: imagesOnly,
    );
  }

  Future<AttachmentPickResult> _pickGallery({
    required int existingCount,
  }) async {
    final remaining = attachmentMaxFileCount - existingCount;
    if (remaining <= 0) {
      return const AttachmentPickResult(message: '最多只能选择5个文件，请先移除已有文件。');
    }
    CrashReporting.setUserAction('select_images');
    CrashReporting.breadcrumb(
      'image_selection.gallery.start',
      data: {'remainingCount': remaining},
    );
    late final List<AttachmentCandidate> candidates;
    try {
      candidates = await _galleryPicker.pickMultiImage(limit: remaining);
    } catch (error, stackTrace) {
      CrashReporting.breadcrumb(
        'image_selection.gallery.failure',
        data: {'exceptionType': error.runtimeType.toString()},
      );
      unawaited(
        CrashReporting.recordError(
          error,
          stackTrace,
          source: 'image_selection.gallery',
        ),
      );
      rethrow;
    }
    CrashReporting.breadcrumb(
      'image_selection.gallery.complete',
      data: {'selectedCount': candidates.length},
    );
    return _prepareAndValidate(
      candidates,
      existingCount: existingCount,
      imagesOnly: true,
    );
  }

  Future<AttachmentPickResult> _pickDeviceFiles({
    required int existingCount,
    required List<String> allowedExtensions,
    required bool imagesOnly,
  }) async {
    CrashReporting.setUserAction(
      imagesOnly ? 'select_images' : 'select_attachments',
    );
    CrashReporting.breadcrumb(
      'image_selection.files.start',
      data: {'imagesOnly': imagesOnly},
    );
    late final List<AttachmentCandidate> candidates;
    try {
      candidates = await _filePicker.pickFiles(
        allowedExtensions: allowedExtensions,
      );
    } catch (error, stackTrace) {
      CrashReporting.breadcrumb(
        'image_selection.files.failure',
        data: {'exceptionType': error.runtimeType.toString()},
      );
      unawaited(
        CrashReporting.recordError(
          error,
          stackTrace,
          source: 'image_selection.files',
          context: {'imagesOnly': imagesOnly},
        ),
      );
      rethrow;
    }
    CrashReporting.breadcrumb(
      'image_selection.files.complete',
      data: {
        'imagesOnly': imagesOnly,
        'selectedCount': candidates.length,
      },
    );
    return _prepareAndValidate(
      candidates,
      existingCount: existingCount,
      imagesOnly: imagesOnly,
    );
  }

  Future<AttachmentPickResult> _prepareAndValidate(
    List<AttachmentCandidate> candidates, {
    required int existingCount,
    required bool imagesOnly,
  }) async {
    CrashReporting.breadcrumb(
      'attachment_validation.start',
      data: {
        'candidateCount': candidates.length,
        'existingCount': existingCount,
        'imagesOnly': imagesOnly,
      },
    );
    if (candidates.isEmpty) {
      return const AttachmentPickResult();
    }
    if (existingCount + candidates.length > attachmentMaxFileCount) {
      CrashReporting.breadcrumb(
        'attachment_validation.rejected',
        data: {'reason': 'file_count_limit'},
      );
      await _deleteTemporaryCandidates(candidates);
      return AttachmentPickResult(
        message: '最多只能选择5个文件；当前已有$existingCount个，本次选择了${candidates.length}个。',
      );
    }

    final accepted = <PickedAttachment>[];
    final rejected = <String>[];
    var acceptedBytes = 0;
    for (var index = 0; index < candidates.length; index += 1) {
      final original = candidates[index];
      AttachmentCandidate candidate = original;
      int? observedSize;
      try {
        final initialLength = await candidate.length();
        observedSize = initialLength;
        CrashReporting.breadcrumb(
          'attachment_validation.size_checked',
          data: {
            'candidateIndex': index,
            'attachmentSizeBytes': initialLength,
          },
        );
        if (initialLength > attachmentMaxFileSizeBytes) {
          CrashReporting.breadcrumb(
            'attachment_validation.rejected',
            data: {
              'candidateIndex': index,
              'attachmentSizeBytes': initialLength,
              'reason': 'file_size_limit',
            },
          );
          rejected.add('“${candidate.fileName}”超过10MB');
          await _deleteTemporaryCandidate(candidate);
          continue;
        }
        final initialExtension =
            path.extension(candidate.fileName).toLowerCase();
        if (_isExternalDocumentExtension(initialExtension)) {
          final prepared = await FileSecurityPolicy.prepareUploads(
            <FileSecuritySource>[
              FileSecuritySource(
                fileName: candidate.fileName,
                declaredMimeType: candidate.declaredMimeType,
                openRead: () => candidate.path == null
                    ? Stream<List<int>>.value(candidate.bytes!)
                    : File(candidate.path!).openRead(),
              ),
            ],
          );
          final staged = prepared.single;
          if (acceptedBytes + staged.size > fileSecurityMaxTotalFileBytes) {
            await staged.cleanup();
            rejected.add('本次选择的文件总大小超过24MB');
            await _deleteTemporaryCandidate(candidate);
            continue;
          }
          acceptedBytes += staged.size;
          if (candidate.temporary) {
            await _deleteTemporaryCandidate(candidate);
          }
          final kind = attachmentKindForFileName(staged.fileName);
          accepted.add(
            PickedAttachment(
              file: ApiMultipartFile.fromPath(
                fileName: staged.fileName,
                path: staged.path,
                contentType: staged.contentType,
              ),
              kind: kind,
              temporaryPath: staged.path,
            ),
          );
          CrashReporting.breadcrumb(
            'attachment_validation.accepted',
            data: {
              'candidateIndex': index,
              'attachmentSizeBytes': staged.size,
              'fileKind': kind.name,
            },
          );
          continue;
        }
        final initialHeader = await candidate.readHeaderBytes();
        final initialKind = detectAttachmentFileKind(initialHeader);
        if (initialKind == AttachmentFileKind.heic) {
          CrashReporting.breadcrumb(
            'heic_conversion.start',
            data: {
              'candidateIndex': index,
              'attachmentSizeBytes': initialLength,
            },
          );
          candidate = await _nativeBridge.convertHeicToJpeg(candidate);
          if (candidate.path != original.path && original.temporary) {
            await _deleteTemporaryCandidate(original);
          }
          final convertedLength = await candidate.length();
          observedSize = convertedLength;
          CrashReporting.breadcrumb(
            'heic_conversion.complete',
            data: {
              'candidateIndex': index,
              'attachmentSizeBytes': convertedLength,
            },
          );
          if (convertedLength > attachmentMaxFileSizeBytes) {
            rejected.add('“${candidate.fileName}”超过10MB');
            await _deleteTemporaryCandidate(candidate);
            continue;
          }
        }
        final bytes = await candidate.readBytes();
        observedSize = bytes.length;
        if (bytes.length > attachmentMaxFileSizeBytes) {
          rejected.add('“${candidate.fileName}”超过10MB');
          await _deleteTemporaryCandidate(candidate);
          continue;
        }
        if (acceptedBytes + bytes.length > fileSecurityMaxTotalFileBytes) {
          rejected.add('本次选择的文件总大小超过24MB');
          await _deleteTemporaryCandidate(candidate);
          continue;
        }
        final kind = detectAttachmentFileKind(bytes);
        final validationError = _validateCandidate(
          candidate,
          kind,
          imagesOnly: imagesOnly,
        );
        if (validationError != null) {
          rejected.add(validationError);
          await _deleteTemporaryCandidate(candidate);
          continue;
        }
        final safeName = sanitizeAttachmentFileName(candidate.fileName);
        accepted.add(
          PickedAttachment(
            file: candidate.path == null
                ? ApiMultipartFile.fromBytes(
                    fileName: safeName,
                    bytes: candidate.bytes ?? bytes,
                    contentType: kind!.mimeType,
                  )
                : ApiMultipartFile.fromPath(
                    fileName: safeName,
                    path: candidate.path!,
                    contentType: kind!.mimeType,
                  ),
            kind: kind,
            temporaryPath: candidate.temporary ? candidate.path : null,
          ),
        );
        acceptedBytes += bytes.length;
        CrashReporting.breadcrumb(
          'attachment_validation.accepted',
          data: {
            'candidateIndex': index,
            'attachmentSizeBytes': bytes.length,
            'fileKind': kind.name,
          },
        );
      } catch (error, stackTrace) {
        CrashReporting.breadcrumb(
          'attachment_validation.failure',
          data: {
            'candidateIndex': index,
            if (observedSize != null) 'attachmentSizeBytes': observedSize,
            'exceptionType': error.runtimeType.toString(),
          },
        );
        unawaited(
          CrashReporting.recordError(
            error,
            stackTrace,
            source: 'attachment.validation',
            context: {
              'candidateIndex': index,
              if (observedSize != null) 'attachmentSizeBytes': observedSize,
              'imagesOnly': imagesOnly,
            },
          ),
        );
        rejected.add(
          error is FileSecurityViolation
              ? error.userMessage
              : '“${candidate.fileName}”读取或处理失败',
        );
        await _deleteTemporaryCandidate(candidate);
      }
    }
    CrashReporting.breadcrumb(
      'attachment_validation.complete',
      data: {
        'acceptedCount': accepted.length,
        'rejectedCount': rejected.length,
      },
    );
    return AttachmentPickResult(
      files: accepted,
      message: rejected.isEmpty ? null : '${rejected.join('；')}，已拒绝添加。',
    );
  }

  String? _validateCandidate(
    AttachmentCandidate candidate,
    AttachmentFileKind? kind, {
    required bool imagesOnly,
  }) {
    final extension =
        path.extension(candidate.fileName).replaceFirst('.', '').toLowerCase();
    if (kind == null ||
        !_extensionsForKind(kind).contains(extension) ||
        (imagesOnly && !kind.isImage) ||
        (!imagesOnly && !guestInfoAttachmentExtensions.contains(extension))) {
      return '“${candidate.fileName}”格式不受支持或文件内容与扩展名不一致';
    }
    final declared =
        candidate.declaredMimeType?.split(';').first.trim().toLowerCase();
    if (declared != null &&
        declared.isNotEmpty &&
        declared != 'application/octet-stream' &&
        !_mimeTypesForKind(kind).contains(declared)) {
      return '“${candidate.fileName}”的MIME类型与实际内容不一致';
    }
    if (candidate.requireDeclaredMimeMatch &&
        (declared == null ||
            declared.isEmpty ||
            declared == 'application/octet-stream')) {
      return '“${candidate.fileName}”缺少可信的文件类型信息';
    }
    return null;
  }

  Future<void> _deleteTemporaryCandidates(
    List<AttachmentCandidate> candidates,
  ) async {
    for (final candidate in candidates) {
      await _deleteTemporaryCandidate(candidate);
    }
  }

  Future<void> _deleteTemporaryCandidate(AttachmentCandidate candidate) async {
    final candidatePath = candidate.path;
    if (!candidate.temporary ||
        candidatePath == null ||
        candidatePath.trim().isEmpty) {
      return;
    }
    try {
      final file = File(candidatePath);
      if (await file.exists()) {
        await file.delete();
      }
    } catch (_) {
      // Temporary files may already have been reclaimed by the platform.
    }
  }
}

Future<GuestAttachmentSource?> showGuestAttachmentSourceSheet(
  BuildContext context,
) {
  return showModalBottomSheet<GuestAttachmentSource>(
    context: context,
    useSafeArea: true,
    builder: (context) => const _GuestAttachmentSourceSheet(),
  );
}

class _GuestAttachmentSourceSheet extends StatelessWidget {
  const _GuestAttachmentSourceSheet();

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey('guest-attachment-source-sheet'),
      mainAxisSize: MainAxisSize.min,
      children: [
        ListTile(
          leading: const Icon(Icons.photo_library_outlined),
          title: const Text('从相册选择照片或截图'),
          onTap: () => Navigator.of(context).pop(GuestAttachmentSource.gallery),
        ),
        ListTile(
          leading: const Icon(Icons.wechat),
          title: const Text('从微信导入 Excel、PDF、Word'),
          onTap: () => Navigator.of(context).pop(GuestAttachmentSource.wechat),
        ),
        ListTile(
          leading: const Icon(Icons.folder_open_rounded),
          title: const Text('从手机文件选择'),
          onTap: () => Navigator.of(context).pop(GuestAttachmentSource.files),
        ),
        ListTile(
          leading: const Icon(Icons.close_rounded),
          title: const Text('取消'),
          onTap: () => Navigator.of(context).pop(),
        ),
      ],
    );
  }
}

AttachmentFileKind? detectAttachmentFileKind(Uint8List bytes) {
  bool startsWith(List<int> signature) {
    if (bytes.length < signature.length) {
      return false;
    }
    for (var index = 0; index < signature.length; index += 1) {
      if (bytes[index] != signature[index]) {
        return false;
      }
    }
    return true;
  }

  if (startsWith(const [0xff, 0xd8, 0xff])) {
    return AttachmentFileKind.jpeg;
  }
  if (startsWith(const [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return AttachmentFileKind.png;
  }
  if (startsWith(ascii.encode('GIF87a')) ||
      startsWith(ascii.encode('GIF89a'))) {
    return AttachmentFileKind.gif;
  }
  if (bytes.length >= 12 &&
      ascii.decode(bytes.sublist(0, 4), allowInvalid: true) == 'RIFF' &&
      ascii.decode(bytes.sublist(8, 12), allowInvalid: true) == 'WEBP') {
    return AttachmentFileKind.webp;
  }
  if (startsWith(ascii.encode('BM'))) {
    return AttachmentFileKind.bmp;
  }
  if (startsWith(const [0x49, 0x49, 0x2a, 0x00]) ||
      startsWith(const [0x4d, 0x4d, 0x00, 0x2a])) {
    return AttachmentFileKind.tiff;
  }
  if (bytes.length >= 12 &&
      ascii.decode(bytes.sublist(4, 8), allowInvalid: true) == 'ftyp') {
    final brand = ascii.decode(bytes.sublist(8, 12), allowInvalid: true);
    if (const {'avif', 'avis'}.contains(brand)) {
      return AttachmentFileKind.avif;
    }
    if (const {
      'heic',
      'heix',
      'hevc',
      'hevx',
      'heim',
      'heis',
      'mif1',
      'msf1',
    }.contains(brand)) {
      return AttachmentFileKind.heic;
    }
  }
  if (startsWith(ascii.encode('%PDF-'))) {
    return AttachmentFileKind.pdf;
  }
  if (startsWith(const [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    final body = latin1.decode(bytes, allowInvalid: true);
    if (body.contains('Workbook') ||
        body.contains('W\u0000o\u0000r\u0000k\u0000b\u0000o\u0000o\u0000k') ||
        body.contains('Book') ||
        body.contains('B\u0000o\u0000o\u0000k')) {
      return AttachmentFileKind.excelBinary;
    }
    return AttachmentFileKind.wordBinary;
  }
  if (startsWith(const [0x50, 0x4b, 0x03, 0x04])) {
    final body = latin1.decode(bytes, allowInvalid: true);
    if (body.contains('word/')) {
      return AttachmentFileKind.wordOpenXml;
    }
    if (body.contains('xl/')) {
      return AttachmentFileKind.excelOpenXml;
    }
    return null;
  }
  if (_looksLikeText(bytes)) {
    return AttachmentFileKind.text;
  }
  return null;
}

bool _looksLikeText(Uint8List bytes) {
  if (bytes.isEmpty) {
    return true;
  }
  final sample = bytes.length > 8192 ? bytes.sublist(0, 8192) : bytes;
  if (sample.contains(0)) {
    return false;
  }
  try {
    utf8.decode(sample);
    return true;
  } on FormatException {
    return sample.every(
      (value) =>
          value == 9 ||
          value == 10 ||
          value == 13 ||
          (value >= 32 && value != 127),
    );
  }
}

Set<String> _extensionsForKind(AttachmentFileKind kind) {
  return switch (kind) {
    AttachmentFileKind.jpeg => const {'jpg', 'jpeg'},
    AttachmentFileKind.png => const {'png'},
    AttachmentFileKind.gif => const {'gif'},
    AttachmentFileKind.webp => const {'webp'},
    AttachmentFileKind.bmp => const {'bmp'},
    AttachmentFileKind.tiff => const {'tif', 'tiff'},
    AttachmentFileKind.avif => const {'avif'},
    AttachmentFileKind.heic => const {'heic', 'heif'},
    AttachmentFileKind.pdf => const {'pdf'},
    AttachmentFileKind.wordBinary => const {'doc'},
    AttachmentFileKind.excelBinary => const {'xls'},
    AttachmentFileKind.wordOpenXml => const {'docx'},
    AttachmentFileKind.excelOpenXml => const {'xlsx'},
    AttachmentFileKind.text => const {'csv', 'txt', 'log', 'md'},
  };
}

Set<String> _mimeTypesForKind(AttachmentFileKind kind) {
  return switch (kind) {
    AttachmentFileKind.jpeg => const {'image/jpeg', 'image/jpg'},
    AttachmentFileKind.png => const {'image/png'},
    AttachmentFileKind.gif => const {'image/gif'},
    AttachmentFileKind.webp => const {'image/webp'},
    AttachmentFileKind.bmp => const {'image/bmp', 'image/x-ms-bmp'},
    AttachmentFileKind.tiff => const {'image/tiff'},
    AttachmentFileKind.avif => const {'image/avif'},
    AttachmentFileKind.heic => const {'image/heic', 'image/heif'},
    AttachmentFileKind.pdf => const {'application/pdf'},
    AttachmentFileKind.wordBinary => const {'application/msword'},
    AttachmentFileKind.excelBinary => const {
        'application/vnd.ms-excel',
        'application/msexcel',
      },
    AttachmentFileKind.wordOpenXml => const {
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    AttachmentFileKind.excelOpenXml => const {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    AttachmentFileKind.text => const {
        'text/plain',
        'text/csv',
        'application/csv',
      },
  };
}

String sanitizeAttachmentFileName(String value) {
  return FileSecurityPolicy.sanitizeFileName(value);
}

bool _isExternalDocumentExtension(String extension) {
  return const <String>{
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.docm',
    '.dotm',
    '.xlsm',
    '.xltm',
    '.xlam',
  }.contains(extension);
}

AttachmentFileKind attachmentKindForFileName(String fileName) {
  final extension =
      path.extension(fileName).replaceFirst('.', '').toLowerCase();
  return switch (extension) {
    'jpg' || 'jpeg' => AttachmentFileKind.jpeg,
    'png' => AttachmentFileKind.png,
    'gif' => AttachmentFileKind.gif,
    'webp' => AttachmentFileKind.webp,
    'bmp' => AttachmentFileKind.bmp,
    'tif' || 'tiff' => AttachmentFileKind.tiff,
    'avif' => AttachmentFileKind.avif,
    'pdf' => AttachmentFileKind.pdf,
    'doc' => AttachmentFileKind.wordBinary,
    'docx' => AttachmentFileKind.wordOpenXml,
    'xls' => AttachmentFileKind.excelBinary,
    'xlsx' => AttachmentFileKind.excelOpenXml,
    _ => AttachmentFileKind.text,
  };
}
