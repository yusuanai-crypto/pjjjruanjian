import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';

const fileSecurityMaxFileBytes = 10 * 1024 * 1024;
const fileSecurityMaxFiles = 5;
const fileSecurityMaxRequestBytes = 25 * 1024 * 1024;
const fileSecurityMaxTotalFileBytes = 24 * 1024 * 1024;
const fileSecurityMaxNameLength = 180;

const fileSecurityZipMaxEntries = 1024;
const fileSecurityZipMaxEntryBytes = 32 * 1024 * 1024;
const fileSecurityZipMaxTotalBytes = 64 * 1024 * 1024;
const fileSecurityZipMaxRatio = 100;
const fileSecurityZipMaxPathDepth = 12;

const _secureUploadDirectoryName = 'jiangjiu-secure-uploads';
const _orphanRetention = Duration(hours: 24);
final _secureUploadNamePattern = RegExp(
  r'^\.upload-[0-9a-f]{32}$',
  caseSensitive: false,
);
final _macroExtensions = <String>{
  '.docm',
  '.dotm',
  '.xlsm',
  '.xltm',
  '.xlam',
};
final _nestedArchiveExtensions = <String>{
  '.zip',
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.jar',
  '.apk',
  '.docx',
  '.xlsx',
  ..._macroExtensions,
};
final _blockedOpenXmlEntries = <RegExp>[
  RegExp(r'(^|/)vbaproject\.bin$', caseSensitive: false),
  RegExp(r'(^|/)activex/', caseSensitive: false),
  RegExp(r'(^|/)embeddings/', caseSensitive: false),
  RegExp(r'(^|/)externalLinks/', caseSensitive: false),
  RegExp(r'(^|/)oleObject', caseSensitive: false),
];
final _pdfActiveContentMarkers = <RegExp>[
  RegExp(r'/JavaScript\b', caseSensitive: false),
  RegExp(r'/JS\b', caseSensitive: false),
  RegExp(r'/Launch\b', caseSensitive: false),
  RegExp(r'/EmbeddedFile\b', caseSensitive: false),
];
const _oleSignature = <int>[
  0xd0,
  0xcf,
  0x11,
  0xe0,
  0xa1,
  0xb1,
  0x1a,
  0xe1,
];

typedef FileSecurityStreamFactory = Stream<List<int>> Function();

class FileSecuritySource {
  const FileSecuritySource({
    required this.fileName,
    required this.openRead,
    this.declaredMimeType,
  });

  final String fileName;
  final String? declaredMimeType;
  final FileSecurityStreamFactory openRead;
}

class PreparedSecureUpload {
  const PreparedSecureUpload({
    required this.fileName,
    required this.contentType,
    required this.path,
    required this.size,
  });

  final String fileName;
  final String contentType;
  final String path;
  final int size;

  Stream<List<int>> openRead() => File(path).openRead();

  Future<void> cleanup() => FileSecurityPolicy.deletePrivateTemporaryFile(path);
}

class FileSecurityViolation implements Exception {
  const FileSecurityViolation(this.code, this.userMessage);

  final String code;
  final String userMessage;

  @override
  String toString() => code;
}

class FileSecurityPolicy {
  const FileSecurityPolicy._();

  static Future<Directory> Function()? temporaryRootProviderForTesting;

  static void validateAggregateMetadata(Iterable<int> sizes) {
    final values = sizes.toList(growable: false);
    if (values.length > fileSecurityMaxFiles) {
      throw const FileSecurityViolation(
        'FILE_COUNT_LIMIT',
        '一次最多上传5个文件。',
      );
    }
    var total = 0;
    for (final size in values) {
      if (size < 0 || size > fileSecurityMaxFileBytes) {
        throw const FileSecurityViolation(
          'FILE_TOO_LARGE',
          '单个文件不能超过10MB。',
        );
      }
      total += size;
      if (total > fileSecurityMaxTotalFileBytes) {
        throw const FileSecurityViolation(
          'TOTAL_SIZE_LIMIT',
          '本次上传文件总大小不能超过24MB。',
        );
      }
    }
  }

  static Future<List<PreparedSecureUpload>> prepareUploads(
    List<FileSecuritySource> sources,
  ) async {
    if (sources.isEmpty) {
      throw const FileSecurityViolation(
        'FILE_REQUIRED',
        '请选择需要上传的文件。',
      );
    }
    validateAggregateMetadata(List<int>.filled(sources.length, 0));

    final directory = await _secureTemporaryDirectory();
    final prepared = <PreparedSecureUpload>[];
    try {
      for (final source in sources) {
        final originalExtension = path.extension(source.fileName).toLowerCase();
        if (_macroExtensions.contains(originalExtension)) {
          throw const FileSecurityViolation(
            'MACRO_ENABLED_DOCUMENT_REJECTED',
            '不支持含宏的 Office 文件。',
          );
        }
        final safeName = sanitizeFileName(source.fileName);
        final contentType = _validatedContentType(
          safeName,
          source.declaredMimeType,
        );
        final staged = await _stageBoundedFile(
          directory,
          safeName,
          contentType,
          source.openRead,
        );
        prepared.add(staged);
        validateAggregateMetadata(prepared.map((file) => file.size));
        await Isolate.run(
          () => _validateStagedFile(
            staged.path,
            staged.fileName,
            staged.contentType,
            staged.size,
          ),
        );
      }
      return prepared;
    } catch (_) {
      await cleanupPreparedUploads(prepared);
      rethrow;
    }
  }

  static String sanitizeFileName(String value) {
    final normalized = value.replaceAll('\\', '/');
    final baseName = path.basename(normalized).trim();
    final sanitized = baseName
        .replaceAll(RegExp(r'[\u0000-\u001f\u007f<>:"/\\|?*]'), '_')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    final safe = sanitized.isEmpty ? 'attachment' : sanitized;
    if (safe.length <= fileSecurityMaxNameLength) {
      return safe;
    }
    final extension = path.extension(safe);
    final stem = path.basenameWithoutExtension(safe);
    final keep = max(1, fileSecurityMaxNameLength - extension.length);
    return '${stem.substring(0, min(stem.length, keep))}$extension';
  }

  static Future<void> cleanupPreparedUploads(
    Iterable<PreparedSecureUpload> uploads,
  ) async {
    for (final upload in uploads) {
      await upload.cleanup();
    }
  }

  static Future<void> deletePrivateTemporaryFile(String value) async {
    try {
      final directory = await _secureTemporaryDirectory();
      final candidate = File(value);
      final candidatePath = path.canonicalize(candidate.absolute.path);
      final rootPath = path.canonicalize(directory.absolute.path);
      if (path.dirname(candidatePath) != rootPath ||
          !_secureUploadNamePattern.hasMatch(path.basename(candidatePath))) {
        return;
      }
      if (await candidate.exists()) {
        await candidate.delete();
      }
    } catch (_) {
      // The OS may already have reclaimed an application-private temp file.
    }
  }

  static Future<void> cleanupOrphanedTemporaryFiles({
    DateTime? now,
    Duration retention = _orphanRetention,
  }) async {
    try {
      final directory = await _secureTemporaryDirectory();
      final cutoff = (now ?? DateTime.now()).subtract(retention);
      await for (final entity in directory.list(followLinks: false)) {
        if (entity is! File ||
            !_secureUploadNamePattern.hasMatch(path.basename(entity.path))) {
          continue;
        }
        final stat = await entity.stat();
        if (stat.modified.isBefore(cutoff)) {
          await entity.delete();
        }
      }
    } catch (_) {
      // Startup cleanup is best-effort and never blocks app launch.
    }
  }

  static Future<Directory> _secureTemporaryDirectory() async {
    final root = temporaryRootProviderForTesting == null
        ? await getTemporaryDirectory()
        : await temporaryRootProviderForTesting!();
    final directory =
        Directory(path.join(root.path, _secureUploadDirectoryName));
    await directory.create(recursive: true);
    return directory;
  }

  static Future<PreparedSecureUpload> _stageBoundedFile(
    Directory directory,
    String fileName,
    String contentType,
    FileSecurityStreamFactory openRead,
  ) async {
    final random = Random.secure();
    final randomName = List<String>.generate(
      16,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    final target = File(path.join(directory.path, '.upload-$randomName'));
    await target.create(exclusive: true);
    final output = target.openWrite(mode: FileMode.writeOnly);
    var size = 0;
    var completed = false;
    try {
      await for (final chunk in openRead()) {
        size += chunk.length;
        if (size > fileSecurityMaxFileBytes) {
          throw const FileSecurityViolation(
            'FILE_TOO_LARGE',
            '单个文件不能超过10MB。',
          );
        }
        output.add(chunk);
      }
      await output.flush();
      await output.close();
      if (size == 0) {
        throw const FileSecurityViolation(
          'EMPTY_FILE',
          '不能上传空文件。',
        );
      }
      completed = true;
      return PreparedSecureUpload(
        fileName: fileName,
        contentType: contentType,
        path: target.path,
        size: size,
      );
    } finally {
      if (!completed) {
        try {
          await output.close();
        } catch (_) {
          // Preserve the original validation/cancellation error.
        }
        try {
          if (await target.exists()) {
            await target.delete();
          }
        } catch (_) {
          // A later orphan cleanup can finish failed temp cleanup.
        }
      }
    }
  }
}

String _validatedContentType(String fileName, String? declaredMimeType) {
  final extension = path.extension(fileName).toLowerCase();
  if (_macroExtensions.contains(extension)) {
    throw const FileSecurityViolation(
      'MACRO_ENABLED_DOCUMENT_REJECTED',
      '不支持含宏的 Office 文件。',
    );
  }
  final expected = _contentTypesByExtension[extension];
  if (expected == null) {
    throw const FileSecurityViolation(
      'UNSUPPORTED_FILE_TYPE',
      '文件格式不受支持。',
    );
  }
  final declared =
      declaredMimeType?.split(';').first.trim().toLowerCase() ?? '';
  if (declared.isNotEmpty &&
      declared != 'application/octet-stream' &&
      !expected.contains(declared)) {
    throw const FileSecurityViolation(
      'MIME_CONTENT_MISMATCH',
      '文件MIME类型与扩展名不一致。',
    );
  }
  return expected.first;
}

const _contentTypesByExtension = <String, List<String>>{
  '.jpg': ['image/jpeg', 'image/jpg'],
  '.jpeg': ['image/jpeg', 'image/jpg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.bmp': ['image/bmp', 'image/x-ms-bmp'],
  '.tif': ['image/tiff'],
  '.tiff': ['image/tiff'],
  '.avif': ['image/avif'],
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.xls': ['application/vnd.ms-excel', 'application/msexcel'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  '.xlsx': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  '.csv': ['text/csv', 'application/csv', 'application/vnd.ms-excel'],
  '.txt': ['text/plain'],
  '.log': ['text/plain'],
  '.md': ['text/plain', 'text/markdown'],
};

void _validateStagedFile(
  String filePath,
  String fileName,
  String contentType,
  int expectedSize,
) {
  final file = File(filePath);
  final stat = file.statSync();
  if (stat.type != FileSystemEntityType.file ||
      stat.size != expectedSize ||
      stat.size <= 0 ||
      stat.size > fileSecurityMaxFileBytes) {
    throw const FileSecurityViolation(
      'FILE_CHANGED_DURING_VALIDATION',
      '文件在校验过程中发生变化，请重新选择。',
    );
  }
  final bytes = file.readAsBytesSync();
  final extension = path.extension(fileName).toLowerCase();
  switch (extension) {
    case '.pdf':
      _validatePdf(bytes);
      return;
    case '.doc':
    case '.xls':
      _validateOle(bytes);
      return;
    case '.docx':
      _validateOpenXml(bytes, wordDocument: true);
      return;
    case '.xlsx':
      _validateOpenXml(bytes, wordDocument: false);
      return;
    default:
      _validateNonOfficeMagic(bytes, extension, contentType);
  }
}

void _validatePdf(Uint8List bytes) {
  if (!_startsWith(bytes, ascii.encode('%PDF-'))) {
    throw const FileSecurityViolation(
      'FILE_CONTENT_MISMATCH',
      'PDF内容与文件类型不一致。',
    );
  }
  if (bytes.length < 32) {
    throw const FileSecurityViolation(
      'TRUNCATED_PDF',
      'PDF文件已截断或格式损坏。',
    );
  }
  final tailStart = max(0, bytes.length - 4096);
  final tail = latin1.decode(bytes.sublist(tailStart), allowInvalid: true);
  final eofOffset = tail.lastIndexOf('%%EOF');
  if (eofOffset < 0 ||
      tail
          .substring(eofOffset + 5)
          .replaceAll(RegExp(r'[\u0000\t\n\f\r ]'), '')
          .isNotEmpty) {
    throw const FileSecurityViolation(
      'TRUNCATED_PDF',
      'PDF文件已截断或格式损坏。',
    );
  }
  final text = latin1.decode(bytes, allowInvalid: true);
  if (_pdfActiveContentMarkers.any((pattern) => pattern.hasMatch(text))) {
    throw const FileSecurityViolation(
      'ACTIVE_PDF_CONTENT_REJECTED',
      '不支持含脚本、启动动作或嵌入文件的PDF。',
    );
  }
}

void _validateOle(Uint8List bytes) {
  if (bytes.length < 512 || !_startsWith(bytes, _oleSignature)) {
    throw const FileSecurityViolation(
      'FILE_CONTENT_MISMATCH',
      '旧版Office文件内容与扩展名不一致。',
    );
  }
}

void _validateOpenXml(Uint8List bytes, {required bool wordDocument}) {
  if (bytes.length < 22 ||
      !_startsWith(bytes, const [0x50, 0x4b, 0x03, 0x04])) {
    throw const FileSecurityViolation(
      'FILE_CONTENT_MISMATCH',
      'Office文件不是有效的ZIP容器。',
    );
  }
  final directory = ZipDirectory();
  try {
    directory.read(InputMemoryStream(bytes));
  } catch (_) {
    throw const FileSecurityViolation(
      'INVALID_OFFICE_ZIP',
      'Office文件ZIP容器损坏。',
    );
  }
  final headers = directory.fileHeaders;
  if (headers.isEmpty || headers.length > fileSecurityZipMaxEntries) {
    throw const FileSecurityViolation(
      'ZIP_ENTRY_LIMIT_EXCEEDED',
      'Office文件ZIP条目数量异常。',
    );
  }

  final filesByName = <String, ZipFile>{};
  final seenNames = <String>{};
  var totalCompressed = 0;
  var totalUncompressed = 0;
  for (final header in headers) {
    final zipFile = header.file;
    final name = header.filename;
    final normalizedName = name.toLowerCase();
    if (zipFile == null ||
        name.isEmpty ||
        name.length > 512 ||
        RegExp(r'[\u0000-\u001f\u007f]').hasMatch(name) ||
        name.contains('\\') ||
        name.startsWith('/') ||
        RegExp(r'^[a-z]:', caseSensitive: false).hasMatch(name) ||
        name.split('/').contains('..') ||
        name.split('/').where((segment) => segment.isNotEmpty).length >
            fileSecurityZipMaxPathDepth) {
      throw const FileSecurityViolation(
        'ZIP_PATH_REJECTED',
        'Office文件包含不安全的ZIP路径。',
      );
    }
    if (!seenNames.add(normalizedName)) {
      throw const FileSecurityViolation(
        'DUPLICATE_ZIP_ENTRY_REJECTED',
        'Office文件包含重复ZIP条目。',
      );
    }
    if ((header.generalPurposeBitFlag & 0x1) != 0) {
      throw const FileSecurityViolation(
        'ENCRYPTED_ZIP_REJECTED',
        '不支持加密的Office文件。',
      );
    }
    final unixMode = header.externalFileAttributes >> 16;
    if ((unixMode & 0xf000) == 0xa000) {
      throw const FileSecurityViolation(
        'ZIP_PATH_REJECTED',
        'Office文件包含符号链接。',
      );
    }
    if (_blockedOpenXmlEntries.any((pattern) => pattern.hasMatch(name)) ||
        (!name.endsWith('/') &&
            _nestedArchiveExtensions
                .contains(path.posix.extension(name).toLowerCase()))) {
      throw const FileSecurityViolation(
        'EMBEDDED_OFFICE_CONTENT_REJECTED',
        'Office文件包含宏、嵌套压缩包或嵌入对象。',
      );
    }

    final compressed = header.compressedSize;
    final uncompressed = header.uncompressedSize;
    if (compressed < 0 ||
        uncompressed < 0 ||
        uncompressed > fileSecurityZipMaxEntryBytes) {
      throw const FileSecurityViolation(
        'ZIP_SIZE_LIMIT_EXCEEDED',
        'Office文件包含过大的ZIP条目。',
      );
    }
    if (uncompressed > 0 &&
        (compressed == 0 ||
            uncompressed / compressed > fileSecurityZipMaxRatio)) {
      throw const FileSecurityViolation(
        'ZIP_COMPRESSION_RATIO_EXCEEDED',
        'Office文件压缩比异常。',
      );
    }
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    if (totalUncompressed > fileSecurityZipMaxTotalBytes) {
      throw const FileSecurityViolation(
        'ZIP_SIZE_LIMIT_EXCEEDED',
        'Office文件解压后大小超过安全限制。',
      );
    }
    if (!name.endsWith('/')) {
      filesByName[name] = zipFile;
    }
  }
  if (totalUncompressed > 0 &&
      (totalCompressed == 0 ||
          totalUncompressed / totalCompressed > fileSecurityZipMaxRatio)) {
    throw const FileSecurityViolation(
      'ZIP_COMPRESSION_RATIO_EXCEEDED',
      'Office文件总体压缩比异常。',
    );
  }

  for (final zipFile in filesByName.values) {
    try {
      if (!zipFile.verifyCrc32()) {
        throw const FileSecurityViolation(
          'INVALID_OFFICE_ZIP',
          'Office文件CRC校验失败。',
        );
      }
    } on FileSecurityViolation {
      rethrow;
    } catch (_) {
      throw const FileSecurityViolation(
        'INVALID_OFFICE_ZIP',
        'Office文件ZIP容器损坏。',
      );
    }
  }

  final requiredPart = wordDocument ? 'word/document.xml' : 'xl/workbook.xml';
  final requiredPrefix = wordDocument ? 'word/' : 'xl/';
  if (!filesByName.containsKey('[Content_Types].xml') ||
      !filesByName.containsKey(requiredPart) ||
      !filesByName.keys.any((name) => name.startsWith(requiredPrefix))) {
    throw const FileSecurityViolation(
      'INVALID_OFFICE_STRUCTURE',
      'Office文件缺少必要目录或内容。',
    );
  }
  final contentTypes = _zipText(filesByName['[Content_Types].xml']!);
  if (RegExp(
    r'macroEnabled|vbaProject|application/vnd\.ms-office\.vbaProject',
    caseSensitive: false,
  ).hasMatch(contentTypes)) {
    throw const FileSecurityViolation(
      'MACRO_ENABLED_DOCUMENT_REJECTED',
      '不支持含宏的Office文件。',
    );
  }
  for (final entry in filesByName.entries) {
    if (!entry.key.toLowerCase().endsWith('.rels')) {
      continue;
    }
    if (RegExp(
      r'''TargetMode\s*=\s*["']External["']''',
      caseSensitive: false,
    ).hasMatch(_zipText(entry.value))) {
      throw const FileSecurityViolation(
        'EXTERNAL_OFFICE_RELATIONSHIP_REJECTED',
        '不支持包含外部链接的Office文件。',
      );
    }
  }
}

String _zipText(ZipFile file) {
  try {
    return utf8.decode(file.getStream().toUint8List(), allowMalformed: false);
  } catch (_) {
    throw const FileSecurityViolation(
      'INVALID_OFFICE_ZIP',
      'Office文件XML内容损坏。',
    );
  }
}

void _validateNonOfficeMagic(
  Uint8List bytes,
  String extension,
  String contentType,
) {
  final valid = switch (extension) {
    '.jpg' || '.jpeg' => _startsWith(bytes, const [0xff, 0xd8, 0xff]),
    '.png' => _startsWith(
        bytes,
        const [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ),
    '.gif' => _startsWith(bytes, ascii.encode('GIF87a')) ||
        _startsWith(bytes, ascii.encode('GIF89a')),
    '.webp' => bytes.length >= 12 &&
        ascii.decode(bytes.sublist(0, 4), allowInvalid: true) == 'RIFF' &&
        ascii.decode(bytes.sublist(8, 12), allowInvalid: true) == 'WEBP',
    '.bmp' => _startsWith(bytes, ascii.encode('BM')),
    '.tif' || '.tiff' => _startsWith(bytes, const [0x49, 0x49, 0x2a, 0x00]) ||
        _startsWith(bytes, const [0x4d, 0x4d, 0x00, 0x2a]),
    '.avif' => bytes.length >= 12 &&
        ascii.decode(bytes.sublist(4, 8), allowInvalid: true) == 'ftyp' &&
        {'avif', 'avis'}.contains(
          ascii.decode(bytes.sublist(8, 12), allowInvalid: true),
        ),
    '.csv' || '.txt' || '.log' || '.md' => _looksLikeText(bytes),
    _ => false,
  };
  if (!valid) {
    throw FileSecurityViolation(
      'FILE_CONTENT_MISMATCH',
      '$contentType 文件内容与扩展名不一致。',
    );
  }
}

bool _looksLikeText(Uint8List bytes) {
  if (bytes.isEmpty || bytes.contains(0)) {
    return false;
  }
  try {
    utf8.decode(bytes);
    return true;
  } on FormatException {
    return false;
  }
}

bool _startsWith(List<int> bytes, List<int> signature) {
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
