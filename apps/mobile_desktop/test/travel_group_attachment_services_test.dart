import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_attachments/attachment_picker_service.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_attachments/downloaded_file_service.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_attachments/fullscreen_photo_preview_page.dart';
import 'package:jiangjiu_mobile_desktop/features/travel_group_attachments/incoming_attachment_service.dart';

void main() {
  group('AttachmentPickerService', () {
    test('mobile key customer photos use gallery and never file picker',
        () async {
      final gallery = _FakeGalleryPicker([
        AttachmentCandidate(
          fileName: 'vip.jpg',
          bytes: _jpegBytes(),
          declaredMimeType: 'image/jpeg',
        ),
      ]);
      final files = _FakeDeviceFilePicker();
      final service = AttachmentPickerService(
        galleryPicker: gallery,
        filePicker: files,
        nativeBridge: const _FakeNativeBridge(),
        platform: TargetPlatform.android,
      );

      final result = await service.pickKeyCustomerPhotos(existingCount: 0);

      expect(result.files.single.fileName, 'vip.jpg');
      expect(gallery.pickCalls, 1);
      expect(gallery.lastLimit, 5);
      expect(files.pickCalls, 0);
    });

    test('guest gallery, phone file, and incoming files keep classification',
        () async {
      final gallery = _FakeGalleryPicker([
        AttachmentCandidate(
          fileName: 'screenshot.png',
          bytes: _pngBytes(),
          declaredMimeType: 'image/png',
        ),
      ]);
      final files = _FakeDeviceFilePicker([
        AttachmentCandidate(
          fileName: 'guests.pdf',
          bytes: Uint8List.fromList('%PDF-1.7\n'.codeUnits),
        ),
      ]);
      final service = AttachmentPickerService(
        galleryPicker: gallery,
        filePicker: files,
        nativeBridge: const _FakeNativeBridge(),
        platform: TargetPlatform.android,
      );

      final galleryResult = await service.pickGuestInfoPhotos(existingCount: 0);
      final fileResult = await service.pickGuestInfoFiles(existingCount: 0);
      final incomingResult = await service.validateIncomingFiles(
        [
          AttachmentCandidate(
            fileName: 'wechat.pdf',
            bytes: Uint8List.fromList('%PDF-1.7\n'.codeUnits),
            declaredMimeType: 'application/pdf',
            requireDeclaredMimeMatch: true,
          ),
        ],
        existingCount: 0,
      );

      expect(galleryResult.files.single.kind, AttachmentFileKind.png);
      expect(fileResult.files.single.kind, AttachmentFileKind.pdf);
      expect(incomingResult.files.single.kind, AttachmentFileKind.pdf);
    });

    test('rejects more than five files before accepting any', () async {
      final gallery = _FakeGalleryPicker(
        List.generate(
          6,
          (index) => AttachmentCandidate(
            fileName: 'photo-$index.jpg',
            bytes: _jpegBytes(),
          ),
        ),
      );
      final service = AttachmentPickerService(
        galleryPicker: gallery,
        filePicker: _FakeDeviceFilePicker(),
        nativeBridge: const _FakeNativeBridge(),
        platform: TargetPlatform.android,
      );

      final result = await service.pickKeyCustomerPhotos(existingCount: 0);

      expect(result.files, isEmpty);
      expect(result.message, contains('最多只能选择5个文件'));
    });

    test('rejects files over 10MB and disguised unsupported files', () async {
      final service = AttachmentPickerService(
        galleryPicker: _FakeGalleryPicker(),
        filePicker: _FakeDeviceFilePicker(),
        nativeBridge: const _FakeNativeBridge(),
        platform: TargetPlatform.android,
      );

      final result = await service.validateIncomingFiles(
        [
          AttachmentCandidate(
            fileName: 'too-large.jpg',
            bytes: Uint8List(attachmentMaxFileSizeBytes + 1)
              ..setRange(0, 3, const [0xff, 0xd8, 0xff]),
          ),
          AttachmentCandidate(
            fileName: 'fake.pdf',
            bytes: Uint8List.fromList([0x4d, 0x5a, 0x90, 0x00]),
            declaredMimeType: 'application/pdf',
            requireDeclaredMimeMatch: true,
          ),
        ],
        existingCount: 0,
      );

      expect(result.files, isEmpty);
      expect(result.message, contains('超过10MB'));
      expect(result.message, contains('文件内容与扩展名不一致'));
    });

    test('Android lost image data is recovered through image picker', () async {
      final gallery = _FakeGalleryPicker(
        const [],
        [
          AttachmentCandidate(
            fileName: 'recovered.jpg',
            bytes: _jpegBytes(),
          ),
        ],
      );
      final service = AttachmentPickerService(
        galleryPicker: gallery,
        filePicker: _FakeDeviceFilePicker(),
        nativeBridge: const _FakeNativeBridge(),
        platform: TargetPlatform.android,
      );

      final result = await service.retrieveLostPhotoSelection();

      expect(gallery.retrieveCalls, 1);
      expect(result.files.single.fileName, 'recovered.jpg');
    });
  });

  testWidgets('guest attachment sheet exposes three sources and cancel',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => FilledButton(
            onPressed: () => showGuestAttachmentSourceSheet(context),
            child: const Text('选择附件'),
          ),
        ),
      ),
    );

    await tester.tap(find.text('选择附件'));
    await tester.pumpAndSettle();

    expect(find.text('从相册选择照片或截图'), findsOneWidget);
    expect(find.text('从微信导入 Excel、PDF、Word'), findsOneWidget);
    expect(find.text('从手机文件选择'), findsOneWidget);
    expect(find.text('取消'), findsOneWidget);
  });

  testWidgets('photo preview enters landscape and restores on close',
      (tester) async {
    final orientation = _FakeOrientationService();
    await tester.pumpWidget(
      MaterialApp(
        home: FullscreenPhotoPreviewPage(
          fileName: 'vip.jpg',
          bytes: _jpegBytes(),
          orientationService: orientation,
        ),
      ),
    );
    await tester.pump();

    expect(orientation.enterCalls, 1);
    expect(
        find.byKey(const ValueKey('fullscreen-photo-preview')), findsOneWidget);
    expect(find.byType(InteractiveViewer), findsOneWidget);

    await tester.tap(find.byTooltip('关闭'));
    await tester.pumpAndSettle();

    expect(orientation.restoreCalls, greaterThanOrEqualTo(1));
  });

  testWidgets('photo preview restores portrait after orientation exception',
      (tester) async {
    final orientation = _FakeOrientationService(throwOnEnter: true);
    await tester.pumpWidget(
      MaterialApp(
        home: FullscreenPhotoPreviewPage(
          fileName: 'vip.jpg',
          bytes: _jpegBytes(),
          orientationService: orientation,
        ),
      ),
    );
    await tester.pump();

    expect(find.text('无法切换横屏，仍可继续预览照片。'), findsOneWidget);

    await tester.tap(find.byTooltip('关闭'));
    await tester.pumpAndSettle();

    expect(orientation.enterCalls, 1);
    expect(orientation.restoreCalls, greaterThanOrEqualTo(1));
  });

  test('download service avoids overwrite and reports external open failure',
      () async {
    final directory = Directory(
      '${Directory.current.path}${Platform.pathSeparator}build'
      '${Platform.pathSeparator}attachment-service-test-'
      '${DateTime.now().microsecondsSinceEpoch}',
    );
    await directory.create(recursive: true);
    addTearDown(() async {
      if (await directory.exists()) {
        await directory.delete(recursive: true);
      }
    });
    const opener = _FakeExternalFileOpener(
      ExternalOpenResult(
        ExternalOpenStatus.failed,
        message: '打开附件失败，请稍后重试。',
      ),
    );
    final service = DownloadedFileService(
      platform: TargetPlatform.android,
      opener: opener,
      directoryProvider: _FixedDirectoryProvider(directory),
    );

    final first = await service.save(
      originalFileName: '名单.pdf',
      bytes: Uint8List.fromList('%PDF-1.7'.codeUnits),
    );
    final second = await service.save(
      originalFileName: '名单.pdf',
      bytes: Uint8List.fromList('%PDF-1.7'.codeUnits),
    );
    final opened = await service.open(
      filePath: first.path!,
      mimeType: 'application/pdf',
    );

    expect(first.path, isNot(second.path));
    expect(second.path, contains('名单 (1).pdf'));
    expect(opened.status, ExternalOpenStatus.failed);
    expect(opened.message, contains('打开附件失败'));
  });

  test('incoming service keeps cold-start files pending until claimed',
      () async {
    final directory = Directory(
      '${Directory.current.path}${Platform.pathSeparator}build'
      '${Platform.pathSeparator}incoming-service-test-'
      '${DateTime.now().microsecondsSinceEpoch}',
    );
    await directory.create(recursive: true);
    final incomingFile = File(
      '${directory.path}${Platform.pathSeparator}wechat.pdf',
    );
    await incomingFile.writeAsString('%PDF-1.7');
    addTearDown(() async {
      if (await directory.exists()) {
        await directory.delete(recursive: true);
      }
    });
    final platform = _FakeIncomingPlatform({
      'files': [
        {
          'path': incomingFile.path,
          'fileName': 'wechat.pdf',
          'mimeType': 'application/pdf',
          'coldStart': true,
        },
      ],
      'errors': <String>[],
    });
    final picker = AttachmentPickerService(
      galleryPicker: _FakeGalleryPicker(),
      filePicker: _FakeDeviceFilePicker(),
      nativeBridge: const _FakeNativeBridge(),
      platform: TargetPlatform.android,
    );
    final service = IncomingAttachmentService(
      platform: platform,
      pickerService: picker,
    );

    await service.initialize();
    final hotOnly = service.claim(
      category: PendingAttachmentCategory.guestInfo,
      includeColdStart: false,
    );
    final confirmed = service.claim(
      category: PendingAttachmentCategory.guestInfo,
      includeColdStart: true,
    );

    expect(hotOnly, isEmpty);
    expect(confirmed.single.attachment.fileName, 'wechat.pdf');
  });
}

Uint8List _jpegBytes() => Uint8List.fromList(
      const [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46],
    );

Uint8List _pngBytes() => Uint8List.fromList(
      const [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    );

class _FakeGalleryPicker implements GalleryPickerGateway {
  _FakeGalleryPicker([
    this.files = const <AttachmentCandidate>[],
    this.lost = const <AttachmentCandidate>[],
  ]);

  final List<AttachmentCandidate> files;
  final List<AttachmentCandidate> lost;
  int pickCalls = 0;
  int retrieveCalls = 0;
  int? lastLimit;

  @override
  Future<List<AttachmentCandidate>> pickMultiImage({
    required int limit,
  }) async {
    pickCalls += 1;
    lastLimit = limit;
    return files;
  }

  @override
  Future<List<AttachmentCandidate>> retrieveLostImages() async {
    retrieveCalls += 1;
    return lost;
  }
}

class _FakeDeviceFilePicker implements DeviceFilePickerGateway {
  _FakeDeviceFilePicker([
    this.files = const <AttachmentCandidate>[],
  ]);

  final List<AttachmentCandidate> files;
  int pickCalls = 0;

  @override
  Future<List<AttachmentCandidate>> pickFiles({
    required List<String> allowedExtensions,
  }) async {
    pickCalls += 1;
    return files;
  }
}

class _FakeNativeBridge implements AttachmentNativeBridge {
  const _FakeNativeBridge();

  @override
  Future<AttachmentCandidate> convertHeicToJpeg(
    AttachmentCandidate source,
  ) async {
    return AttachmentCandidate(
      fileName: 'converted.jpg',
      bytes: _jpegBytes(),
      declaredMimeType: 'image/jpeg',
    );
  }
}

class _FakeOrientationService implements PhotoPreviewOrientationService {
  _FakeOrientationService({this.throwOnEnter = false});

  final bool throwOnEnter;
  int enterCalls = 0;
  int restoreCalls = 0;

  @override
  Future<void> enterPhotoPreview() async {
    enterCalls += 1;
    if (throwOnEnter) {
      throw StateError('orientation failed');
    }
  }

  @override
  Future<void> restorePortrait() async {
    restoreCalls += 1;
  }
}

class _FixedDirectoryProvider implements DownloadDirectoryProvider {
  const _FixedDirectoryProvider(this.directory);

  final Directory directory;

  @override
  Future<Directory> getDownloadDirectory(TargetPlatform platform) async {
    return directory;
  }
}

class _FakeExternalFileOpener implements ExternalFileOpener {
  const _FakeExternalFileOpener(this.result);

  final ExternalOpenResult result;

  @override
  Future<ExternalOpenResult> openFile({
    required String filePath,
    required String mimeType,
  }) async {
    return result;
  }
}

class _FakeIncomingPlatform implements IncomingAttachmentPlatform {
  _FakeIncomingPlatform(this.response);

  final Map<String, dynamic> response;

  @override
  void setIncomingFilesAvailableHandler(AsyncCallback? handler) {}

  @override
  Future<Map<String, dynamic>> takeIncomingFiles() async => response;
}
