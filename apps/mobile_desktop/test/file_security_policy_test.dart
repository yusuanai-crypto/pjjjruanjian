import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/core/file_security_policy.dart';
import 'package:path/path.dart' as path;

void main() {
  late Directory testRoot;

  setUp(() async {
    testRoot = await Directory.systemTemp.createTemp(
      'jiangjiu-file-security-',
    );
    FileSecurityPolicy.temporaryRootProviderForTesting = () async => testRoot;
  });

  tearDown(() async {
    FileSecurityPolicy.temporaryRootProviderForTesting = null;
    if (await testRoot.exists()) {
      await testRoot.delete(recursive: true);
    }
  });

  test('accepts harmless PDF, DOCX and XLSX into random private temp names',
      () async {
    final fixtures = <({String name, String mime, Uint8List bytes})>[
      (
        name: 'safe.pdf',
        mime: 'application/pdf',
        bytes: Uint8List.fromList(_validPdf()),
      ),
      (
        name: 'safe.docx',
        mime:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes: _openXml(wordDocument: true),
      ),
      (
        name: 'safe.xlsx',
        mime:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes: _openXml(wordDocument: false),
      ),
    ];

    for (final fixture in fixtures) {
      final prepared = await FileSecurityPolicy.prepareUploads(
        <FileSecuritySource>[
          _source(fixture.name, fixture.mime, fixture.bytes),
        ],
      );
      expect(prepared.single.fileName, fixture.name);
      expect(
        path.basename(prepared.single.path),
        matches(RegExp(r'^\.upload-[0-9a-f]{32}$')),
      );
      expect(await File(prepared.single.path).readAsBytes(), fixture.bytes);
      await FileSecurityPolicy.cleanupPreparedUploads(prepared);
      expect(await File(prepared.single.path).exists(), isFalse);
    }
  });

  test('rejects empty, mismatched MIME, renamed and truncated documents',
      () async {
    await _expectCode(
      FileSecurityPolicy.prepareUploads(
        <FileSecuritySource>[
          _source('empty.pdf', 'application/pdf', Uint8List(0)),
        ],
      ),
      'EMPTY_FILE',
    );
    await _expectCode(
      FileSecurityPolicy.prepareUploads(
        <FileSecuritySource>[
          _source(
            'wrong.pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            Uint8List.fromList(_validPdf()),
          ),
        ],
      ),
      'MIME_CONTENT_MISMATCH',
    );
    await _expectCode(
      FileSecurityPolicy.prepareUploads(
        <FileSecuritySource>[
          _source(
            'renamed.pdf',
            'application/pdf',
            Uint8List.fromList(utf8.encode('not a PDF')),
          ),
        ],
      ),
      'FILE_CONTENT_MISMATCH',
    );
    await _expectCode(
      FileSecurityPolicy.prepareUploads(
        <FileSecuritySource>[
          _source(
            'truncated.pdf',
            'application/pdf',
            Uint8List.fromList(
              ascii.encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'),
            ),
          ),
        ],
      ),
      'TRUNCATED_PDF',
    );
  });

  test('rejects damaged or structurally invalid Office ZIP containers',
      () async {
    await _expectCode(
      FileSecurityPolicy.prepareUploads(
        <FileSecuritySource>[
          _source(
            'damaged.docx',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            Uint8List.fromList(<int>[
              0x50,
              0x4b,
              0x03,
              0x04,
              ...List<int>.filled(40, 0),
            ]),
          ),
        ],
      ),
      'ZIP_ENTRY_LIMIT_EXCEEDED',
    );
    await _expectCode(
      FileSecurityPolicy.prepareUploads(
        <FileSecuritySource>[
          _source(
            'missing.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            _zip(<String, List<int>>{
              '[Content_Types].xml': utf8.encode('<Types />'),
            }),
          ),
        ],
      ),
      'INVALID_OFFICE_STRUCTURE',
    );
    await _expectCode(
      FileSecurityPolicy.prepareUploads(
        <FileSecuritySource>[
          _source(
            'traversal.docx',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            _openXml(
              wordDocument: true,
              extraEntries: <String, List<int>>{
                '../escape.xml': utf8.encode('<safe />'),
              },
            ),
          ),
        ],
      ),
      'ZIP_PATH_REJECTED',
    );
    await _expectCode(
      FileSecurityPolicy.prepareUploads(
        <FileSecuritySource>[
          _source(
            'nested.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            _openXml(
              wordDocument: false,
              extraEntries: <String, List<int>>{
                'xl/embeddings/nested.zip': const <int>[0x50, 0x4b],
              },
            ),
          ),
        ],
      ),
      'EMBEDDED_OFFICE_CONTENT_REJECTED',
    );
  });

  test('sanitizes names and rejects macros, count, single and total limits',
      () async {
    expect(
      FileSecurityPolicy.sanitizeFileName(
        '../../folder\\bad\r\nname.pdf',
      ),
      'bad__name.pdf',
    );
    expect(
      FileSecurityPolicy.sanitizeFileName(
        '${List<String>.filled(240, 'a').join()}.pdf',
      ).length,
      fileSecurityMaxNameLength,
    );
    await _expectCode(
      FileSecurityPolicy.prepareUploads(
        <FileSecuritySource>[
          _source(
            'macro.docm',
            'application/vnd.ms-word.document.macroEnabled.12',
            _openXml(wordDocument: true),
          ),
        ],
      ),
      'MACRO_ENABLED_DOCUMENT_REJECTED',
    );
    expect(
      () => FileSecurityPolicy.validateAggregateMetadata(
        List<int>.filled(fileSecurityMaxFiles + 1, 1),
      ),
      throwsA(_violationCode('FILE_COUNT_LIMIT')),
    );
    expect(
      () => FileSecurityPolicy.validateAggregateMetadata(
        <int>[fileSecurityMaxFileBytes + 1],
      ),
      throwsA(_violationCode('FILE_TOO_LARGE')),
    );
    expect(
      () => FileSecurityPolicy.validateAggregateMetadata(
        const <int>[
          9 * 1024 * 1024,
          9 * 1024 * 1024,
          8 * 1024 * 1024,
        ],
      ),
      throwsA(_violationCode('TOTAL_SIZE_LIMIT')),
    );
  });

  test('stream failures and orphan cleanup do not leave private temp files',
      () async {
    await _expectCode(
      FileSecurityPolicy.prepareUploads(
        <FileSecuritySource>[
          FileSecuritySource(
            fileName: 'cancelled.pdf',
            declaredMimeType: 'application/pdf',
            openRead: () => Stream<List<int>>.multi((controller) {
              controller.add(ascii.encode('%PDF-1.4\n'));
              controller.addError(StateError('simulated cancellation'));
            }),
          ),
        ],
      ),
      null,
      errorType: StateError,
    );
    final privateDirectory = Directory(
      path.join(testRoot.path, 'jiangjiu-secure-uploads'),
    );
    expect(await privateDirectory.list().toList(), isEmpty);

    final expired = File(
      path.join(
        privateDirectory.path,
        '.upload-${List<String>.filled(32, 'a').join()}',
      ),
    );
    final current = File(
      path.join(
        privateDirectory.path,
        '.upload-${List<String>.filled(32, 'b').join()}',
      ),
    );
    final unrelated = File(path.join(privateDirectory.path, 'keep.txt'));
    await expired.writeAsString('expired');
    await current.writeAsString('current');
    await unrelated.writeAsString('unrelated');
    await expired.setLastModified(DateTime(2026, 1, 1));

    await FileSecurityPolicy.cleanupOrphanedTemporaryFiles(
      now: DateTime(2026, 1, 3),
    );
    expect(await expired.exists(), isFalse);
    expect(await current.exists(), isTrue);
    expect(await unrelated.exists(), isTrue);
  });
}

FileSecuritySource _source(String name, String mime, Uint8List bytes) {
  return FileSecuritySource(
    fileName: name,
    declaredMimeType: mime,
    openRead: () => Stream<List<int>>.value(bytes),
  );
}

List<int> _validPdf() {
  return ascii.encode(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'
    'trailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF\n',
  );
}

Uint8List _openXml({
  required bool wordDocument,
  Map<String, List<int>> extraEntries = const <String, List<int>>{},
}) {
  return _zip(<String, List<int>>{
    '[Content_Types].xml': utf8.encode(
      wordDocument
          ? '<Types><Override PartName="/word/document.xml" /></Types>'
          : '<Types><Override PartName="/xl/workbook.xml" /></Types>',
    ),
    wordDocument ? 'word/document.xml' : 'xl/workbook.xml':
        utf8.encode(wordDocument ? '<document />' : '<workbook />'),
    ...extraEntries,
  });
}

Uint8List _zip(Map<String, List<int>> entries) {
  final archive = Archive();
  for (final entry in entries.entries) {
    archive.addFile(ArchiveFile.bytes(entry.key, entry.value));
  }
  return Uint8List.fromList(ZipEncoder().encode(archive));
}

Future<void> _expectCode(
  Future<Object?> future,
  String? code, {
  Type? errorType,
}) async {
  await expectLater(
    future,
    throwsA(
      predicate<Object>(
        (error) =>
            (code == null ||
                error is FileSecurityViolation && error.code == code) &&
            (errorType == null || error.runtimeType == errorType),
      ),
    ),
  );
}

Matcher _violationCode(String code) {
  return isA<FileSecurityViolation>().having(
    (error) => error.code,
    'code',
    code,
  );
}
