import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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
    }
  }

  @override
  State<FullscreenPhotoPreviewPage> createState() =>
      _FullscreenPhotoPreviewPageState();
}

class _FullscreenPhotoPreviewPageState
    extends State<FullscreenPhotoPreviewPage> {
  bool _restored = false;
  String? _orientationError;

  @override
  void initState() {
    super.initState();
    unawaited(_enterLandscape());
  }

  Future<void> _enterLandscape() async {
    try {
      await widget.orientationService.enterPhotoPreview();
    } catch (_) {
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
    unawaited(_restorePortrait());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
                child: Center(
                  child: InteractiveViewer(
                    minScale: 1,
                    maxScale: 5,
                    child: SizedBox.expand(
                      child: Image.memory(
                        widget.bytes,
                        fit: BoxFit.contain,
                        gaplessPlayback: true,
                        errorBuilder: (_, __, ___) => const Center(
                          child: Padding(
                            padding: EdgeInsets.all(32),
                            child: Text(
                              '图片预览失败，请下载后查看。',
                              style: TextStyle(color: Colors.white),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
