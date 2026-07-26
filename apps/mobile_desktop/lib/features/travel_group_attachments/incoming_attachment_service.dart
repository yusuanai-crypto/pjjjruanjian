import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'attachment_picker_service.dart';

enum PendingAttachmentCategory {
  guestInfo,
  keyCustomerPhoto,
}

class PendingIncomingAttachment {
  const PendingIncomingAttachment({
    required this.attachment,
    required this.category,
    required this.coldStart,
  });

  final PickedAttachment attachment;
  final PendingAttachmentCategory category;
  final bool coldStart;
}

abstract interface class IncomingAttachmentPlatform {
  Future<Map<String, dynamic>> takeIncomingFiles();

  void setIncomingFilesAvailableHandler(AsyncCallback? handler);
}

class MethodChannelIncomingAttachmentPlatform
    implements IncomingAttachmentPlatform {
  MethodChannelIncomingAttachmentPlatform({
    MethodChannel channel = const MethodChannel(
      'com.jiangjiu/attachments',
    ),
  }) : _channel = channel;

  final MethodChannel _channel;
  AsyncCallback? _handler;

  @override
  void setIncomingFilesAvailableHandler(AsyncCallback? handler) {
    _handler = handler;
    if (handler == null) {
      _channel.setMethodCallHandler(null);
      return;
    }
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'incomingFilesAvailable') {
        await _handler?.call();
      }
    });
  }

  @override
  Future<Map<String, dynamic>> takeIncomingFiles() async {
    final result = await _channel.invokeMapMethod<String, dynamic>(
      'takeIncomingFiles',
    );
    return result ?? const <String, dynamic>{};
  }
}

class IncomingAttachmentService extends ChangeNotifier {
  IncomingAttachmentService({
    IncomingAttachmentPlatform? platform,
    AttachmentPickerService? pickerService,
  })  : _platform = platform ?? MethodChannelIncomingAttachmentPlatform(),
        _pickerService = pickerService ?? AttachmentPickerService();

  static final IncomingAttachmentService instance = IncomingAttachmentService();

  final IncomingAttachmentPlatform _platform;
  final AttachmentPickerService _pickerService;
  final List<PendingIncomingAttachment> _pending =
      <PendingIncomingAttachment>[];

  bool _initialized = false;
  bool _refreshing = false;
  String? _lastErrorMessage;

  List<PendingIncomingAttachment> get pending =>
      List<PendingIncomingAttachment>.unmodifiable(_pending);

  int get pendingCount => _pending.length;

  String? get lastErrorMessage => _lastErrorMessage;

  Future<void> initialize() async {
    if (_initialized) {
      return;
    }
    _initialized = true;
    _platform.setIncomingFilesAvailableHandler(refresh);
    await refresh();
  }

  Future<void> refresh() async {
    if (_refreshing) {
      return;
    }
    _refreshing = true;
    try {
      final response = await _platform.takeIncomingFiles();
      final rawFiles = response['files'];
      final candidates = <AttachmentCandidate>[];
      final coldStartByPath = <String, bool>{};
      if (rawFiles is List) {
        for (final raw in rawFiles) {
          if (raw is! Map) {
            continue;
          }
          final filePath = '${raw['path'] ?? ''}'.trim();
          final fileName = '${raw['fileName'] ?? ''}'.trim();
          if (filePath.isEmpty || fileName.isEmpty) {
            continue;
          }
          candidates.add(
            AttachmentCandidate(
              fileName: fileName,
              path: filePath,
              declaredMimeType: '${raw['mimeType'] ?? ''}',
              temporary: true,
              requireDeclaredMimeMatch: true,
            ),
          );
          coldStartByPath[filePath] = raw['coldStart'] == true;
        }
      }
      if (candidates.isNotEmpty) {
        final result = await _pickerService.validateIncomingFiles(
          candidates,
          existingCount: _pending.length,
        );
        for (final attachment in result.files) {
          _pending.add(
            PendingIncomingAttachment(
              attachment: attachment,
              category: PendingAttachmentCategory.guestInfo,
              coldStart: coldStartByPath[attachment.temporaryPath] ?? true,
            ),
          );
        }
        _lastErrorMessage = result.message;
      }
      final errors = response['errors'];
      if (errors is List && errors.isNotEmpty) {
        final nativeMessage = errors.map((item) => '$item').join('；');
        _lastErrorMessage = [
          if ((_lastErrorMessage ?? '').isNotEmpty) _lastErrorMessage!,
          nativeMessage,
        ].join('；');
      }
      if (candidates.isNotEmpty ||
          (errors is List && errors.isNotEmpty) ||
          _lastErrorMessage != null) {
        notifyListeners();
      }
    } on MissingPluginException {
      // Desktop and widget tests do not install the mobile platform bridge.
    } on PlatformException catch (error) {
      _lastErrorMessage = error.message?.trim().isNotEmpty == true
          ? error.message
          : '接收外部附件失败。';
      notifyListeners();
    } catch (_) {
      _lastErrorMessage = '接收外部附件失败，请重新从微信导入。';
      notifyListeners();
    } finally {
      _refreshing = false;
    }
  }

  void addRecoveredPhotos(
    List<PickedAttachment> photos, {
    bool coldStart = true,
  }) {
    if (photos.isEmpty) {
      return;
    }
    for (final photo in photos) {
      _pending.add(
        PendingIncomingAttachment(
          attachment: photo,
          category: PendingAttachmentCategory.keyCustomerPhoto,
          coldStart: coldStart,
        ),
      );
    }
    notifyListeners();
  }

  List<PendingIncomingAttachment> claim({
    required PendingAttachmentCategory category,
    bool includeColdStart = true,
    int maxCount = attachmentMaxFileCount,
  }) {
    final claimed = <PendingIncomingAttachment>[];
    for (final item in List<PendingIncomingAttachment>.from(_pending)) {
      if (claimed.length >= maxCount ||
          item.category != category ||
          (!includeColdStart && item.coldStart)) {
        continue;
      }
      claimed.add(item);
      _pending.remove(item);
    }
    if (claimed.isNotEmpty) {
      notifyListeners();
    }
    return claimed;
  }

  void restore(List<PendingIncomingAttachment> items) {
    if (items.isEmpty) {
      return;
    }
    _pending.insertAll(0, items);
    notifyListeners();
  }

  Future<void> complete(List<PendingIncomingAttachment> items) async {
    for (final item in items) {
      await item.attachment.deleteTemporaryCopy();
    }
  }

  Future<void> discard(List<PendingIncomingAttachment> items) async {
    for (final item in items) {
      _pending.remove(item);
      await item.attachment.deleteTemporaryCopy();
    }
    notifyListeners();
  }

  void clearError() {
    if (_lastErrorMessage == null) {
      return;
    }
    _lastErrorMessage = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _platform.setIncomingFilesAvailableHandler(null);
    super.dispose();
  }
}
