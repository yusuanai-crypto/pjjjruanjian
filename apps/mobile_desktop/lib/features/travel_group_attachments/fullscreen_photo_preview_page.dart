import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/crash_reporting/crash_reporter.dart';

const photoPreviewMaxDecodeDimension = 4096;
const photoPreviewDecodeOverscan = 2.0;

@immutable
class PhotoPreviewDecodeSize {
  const PhotoPreviewDecodeSize({
    required this.cacheWidth,
    required this.cacheHeight,
  });

  final int cacheWidth;
  final int cacheHeight;
}

PhotoPreviewDecodeSize calculatePhotoPreviewDecodeSize({
  required Size mediaSize,
  required Size viewportSize,
  required double devicePixelRatio,
}) {
  final width = math.min(mediaSize.width, viewportSize.width);
  final height = math.min(mediaSize.height, viewportSize.height);
  final physicalScale = devicePixelRatio * photoPreviewDecodeOverscan;
  return PhotoPreviewDecodeSize(
    cacheWidth:
        (width * physicalScale).ceil().clamp(1, photoPreviewMaxDecodeDimension),
    cacheHeight: (height * physicalScale)
        .ceil()
        .clamp(1, photoPreviewMaxDecodeDimension),
  );
}

abstract interface class PhotoPreviewOrientationService {
  Future<void> enterPhotoPreview();

  Future<void> restorePortrait();
}

class SystemPhotoPreviewOrientationService
    implements PhotoPreviewOrientationService {
  const SystemPhotoPreviewOrientationService({
    TargetPlatform? platform,
  }) : _platform = platform;

  final TargetPlatform? _platform;

  bool get _isMobile {
    final platform = _platform ?? defaultTargetPlatform;
    return !kIsWeb &&
        (platform == TargetPlatform.android || platform == TargetPlatform.iOS);
  }

  @override
  Future<void> enterPhotoPreview() async {
    if (!_isMobile) {
      return;
    }
    await SystemChrome.setPreferredOrientations(const [
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
  }

  @override
  Future<void> restorePortrait() async {
    if (!_isMobile) {
      return;
    }
    await SystemChrome.setPreferredOrientations(const [
      DeviceOrientation.portraitUp,
    ]);
  }
}

class FullscreenPhotoPreviewPage extends StatefulWidget {
  const FullscreenPhotoPreviewPage({
    super.key,
    required this.fileName,
    required this.bytes,
    this.orientationService = const SystemPhotoPreviewOrientationService(),
  });

  final String fileName;
  final Uint8List bytes;
  final PhotoPreviewOrientationService orientationService;

  static Future<void> show(
    BuildContext context, {
    required String fileName,
    required Uint8List bytes,
    PhotoPreviewOrientationService orientationService =
        const SystemPhotoPreviewOrientationService(),
  }) async {
    CrashReporting.setUserAction('preview_image');
    CrashReporting.breadcrumb(
      'image_preview.start',
      data: {'attachmentSizeBytes': bytes.length},
    );
    try {
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          fullscreenDialog: true,
          builder: (context) => FullscreenPhotoPreviewPage(
            fileName: fileName,
            bytes: bytes,
            orientationService: orientationService,
          ),
        ),
      );
    } finally {
      await orientationService.restorePortrait();
      CrashReporting.breadcrumb(
        'image_preview.complete',
        data: {'attachmentSizeBytes': bytes.length},
      );
    }
  }

  @override
  State<FullscreenPhotoPreviewPage> createState() =>
      _FullscreenPhotoPreviewPageState();
}

class _FullscreenPhotoPreviewPageState
    extends State<FullscreenPhotoPreviewPage> {
  bool _restored = false;
  bool _imageReadyReported = false;
  bool _imageErrorReported = false;
  int? _lastReportedCacheWidth;
  int? _lastReportedCacheHeight;
  String? _orientationError;

  @override
  void initState() {
    super.initState();
    CrashReporting.breadcrumb(
      'image_preview.page_opened',
      data: {'attachmentSizeBytes': widget.bytes.length},
    );
    unawaited(_enterLandscape());
  }

  Future<void> _enterLandscape() async {
    try {
      await widget.orientationService.enterPhotoPreview();
    } catch (error, stackTrace) {
      CrashReporting.breadcrumb(
        'image_preview.orientation_failure',
        data: {'exceptionType': error.runtimeType.toString()},
      );
      unawaited(
        CrashReporting.recordError(
          error,
          stackTrace,
          source: 'image_preview.orientation',
          context: {'attachmentSizeBytes': widget.bytes.length},
        ),
      );
      if (mounted) {
        setState(() => _orientationError = '无法切换横屏，仍可继续预览照片。');
      }
    }
  }

  Future<void> _restorePortrait() async {
    if (_restored) {
      return;
    }
    _restored = true;
    try {
      await widget.orientationService.restorePortrait();
    } catch (_) {
      // The route-level finally block retries restoration.
    }
  }

  @override
  void dispose() {
    CrashReporting.breadcrumb(
      'image_preview.page_closed',
      data: {'attachmentSizeBytes': widget.bytes.length},
    );
    unawaited(_restorePortrait());
    super.dispose();
  }

  void _reportImageError(
    Object error,
    StackTrace? stackTrace,
    PhotoPreviewDecodeSize decodeSize,
  ) {
    if (_imageErrorReported) {
      return;
    }
    _imageErrorReported = true;
    CrashReporting.breadcrumb(
      'image_preview.decode_failure',
      data: {
        'attachmentSizeBytes': widget.bytes.length,
        'imageWidth': decodeSize.cacheWidth,
        'imageHeight': decodeSize.cacheHeight,
        'exceptionType': error.runtimeType.toString(),
      },
    );
    unawaited(
      CrashReporting.recordError(
        error,
        stackTrace ?? StackTrace.current,
        source: 'image_preview.decode',
        context: {
          'attachmentSizeBytes': widget.bytes.length,
          'imageWidth': decodeSize.cacheWidth,
          'imageHeight': decodeSize.cacheHeight,
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    return PopScope(
      onPopInvokedWithResult: (_, __) => unawaited(_restorePortrait()),
      child: Scaffold(
        key: const ValueKey('fullscreen-photo-preview'),
        backgroundColor: Colors.black,
        body: SafeArea(
          child: Column(
            children: [
              SizedBox(
                height: 56,
                child: Row(
                  children: [
                    IconButton(
                      tooltip: '关闭',
                      color: Colors.white,
                      onPressed: () async {
                        await _restorePortrait();
                        if (context.mounted) {
                          Navigator.of(context).pop();
                        }
                      },
                      icon: const Icon(Icons.close_rounded),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        widget.fileName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
                  ],
                ),
              ),
              if (_orientationError != null)
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 4,
                  ),
                  child: Text(
                    _orientationError!,
                    style: const TextStyle(color: Colors.orangeAccent),
                  ),
                ),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final decodeSize = calculatePhotoPreviewDecodeSize(
                      mediaSize: mediaQuery.size,
                      viewportSize: constraints.biggest,
                      devicePixelRatio: mediaQuery.devicePixelRatio,
                    );
                    if (_lastReportedCacheWidth != decodeSize.cacheWidth ||
                        _lastReportedCacheHeight != decodeSize.cacheHeight) {
                      _lastReportedCacheWidth = decodeSize.cacheWidth;
                      _lastReportedCacheHeight = decodeSize.cacheHeight;
                      _imageReadyReported = false;
                      CrashReporting.breadcrumb(
                        'image_preview.decode_planned',
                        data: {
                          'attachmentSizeBytes': widget.bytes.length,
                          'viewportWidth': constraints.maxWidth,
                          'viewportHeight': constraints.maxHeight,
                          'devicePixelRatio': mediaQuery.devicePixelRatio,
                          'imageWidth': decodeSize.cacheWidth,
                          'imageHeight': decodeSize.cacheHeight,
                        },
                      );
                    }
                    return Center(
                      child: InteractiveViewer(
                        minScale: 1,
                        maxScale: 5,
                        child: SizedBox.expand(
                          child: Image(
                            key: const ValueKey(
                              'fullscreen-photo-preview-image',
                            ),
                            image: ResizeImage(
                              MemoryImage(widget.bytes),
                              width: decodeSize.cacheWidth,
                              height: decodeSize.cacheHeight,
                              policy: ResizeImagePolicy.fit,
                            ),
                            fit: BoxFit.contain,
                            gaplessPlayback: true,
                            frameBuilder: (_, child, frame, __) {
                              if (frame != null && !_imageReadyReported) {
                                _imageReadyReported = true;
                                CrashReporting.breadcrumb(
                                  'image_preview.decode_complete',
                                  data: {
                                    'attachmentSizeBytes': widget.bytes.length,
                                    'imageWidth': decodeSize.cacheWidth,
                                    'imageHeight': decodeSize.cacheHeight,
                                  },
                                );
                              }
                              return child;
                            },
                            errorBuilder: (_, error, stackTrace) {
                              _reportImageError(
                                error,
                                stackTrace,
                                decodeSize,
                              );
                              return const Center(
                                child: Padding(
                                  padding: EdgeInsets.all(32),
                                  child: Text(
                                    '图片预览失败，请下载后查看。',
                                    style: TextStyle(color: Colors.white),
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
