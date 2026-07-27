import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';

typedef GlobalMarkQueryEventStreamFactory = Stream<ApiSseEvent> Function();
typedef GlobalMarkQuerySettingsLoader = Future<Map<String, dynamic>> Function();
typedef GlobalMarkQueryMutation = Future<Map<String, dynamic>> Function(
    bool restricted);
typedef GlobalMarkQueryReconnectDelay = Duration Function(int attempt);

class GlobalMarkQueryController extends ChangeNotifier {
  GlobalMarkQueryController({
    required ApiClient apiClient,
    required String token,
    GlobalMarkQueryEventStreamFactory? eventStreamFactory,
    GlobalMarkQuerySettingsLoader? settingsLoader,
    GlobalMarkQueryMutation? mutation,
    GlobalMarkQueryReconnectDelay? reconnectDelay,
  })  : _eventStreamFactory = eventStreamFactory ??
            (() => apiClient.openSse(
                  '/api/settings/global-mark-query/events',
                  token: token,
                )),
        _settingsLoader = settingsLoader ??
            (() => apiClient.getJson(
                  '/api/settings/global-mark-query',
                  token: token,
                )),
        _mutation = mutation ??
            ((restricted) => apiClient.postJson(
                  restricted
                      ? '/api/settings/global-mark-query/enable'
                      : '/api/settings/global-mark-query/restore',
                  token: token,
                )),
        _reconnectDelay = reconnectDelay ?? _defaultReconnectDelay;

  final GlobalMarkQueryEventStreamFactory _eventStreamFactory;
  final GlobalMarkQuerySettingsLoader _settingsLoader;
  final GlobalMarkQueryMutation _mutation;
  final GlobalMarkQueryReconnectDelay _reconnectDelay;

  StreamSubscription<ApiSseEvent>? _eventSubscription;
  Timer? _reconnectTimer;
  GlobalMarkQuerySettings? _settings;
  bool _started = false;
  bool _disposed = false;
  bool _loading = false;
  bool _busy = false;
  bool _connected = false;
  bool _calibratedForConnection = false;
  int _reconnectAttempt = 0;
  int _dataRevision = 0;
  String? _error;

  GlobalMarkQuerySettings? get settings => _settings;
  bool get loading => _loading;
  bool get busy => _busy;
  bool get connected => _connected;
  int get dataRevision => _dataRevision;
  String? get error => _error;

  Future<void> start() async {
    if (_disposed || _started) {
      return;
    }
    _started = true;
    await calibrate();
    if (!_disposed) {
      _connect();
    }
  }

  Future<void> calibrate() async {
    if (_disposed || _loading) {
      return;
    }
    _loading = true;
    _error = null;
    _notify();
    try {
      final payload = await _settingsLoader();
      if (_disposed) {
        return;
      }
      _applySettings(
        GlobalMarkQuerySettings.fromPayload(payload),
        authoritative: true,
      );
    } on ApiException catch (error) {
      if (!_disposed) {
        _error = error.message;
      }
    } catch (_) {
      if (!_disposed) {
        _error = '全局标记查询状态暂时无法同步。';
      }
    } finally {
      if (!_disposed) {
        _loading = false;
        _notify();
      }
    }
  }

  Future<void> setRestricted(bool restricted) async {
    if (_disposed || _busy) {
      return;
    }
    _busy = true;
    _error = null;
    _notify();
    try {
      final payload = await _mutation(restricted);
      if (!_disposed) {
        _applySettings(
          GlobalMarkQuerySettings.fromPayload(payload),
          authoritative: true,
        );
      }
    } on ApiException catch (error) {
      if (!_disposed) {
        _error = error.message;
      }
    } catch (_) {
      if (!_disposed) {
        _error = '全局标记查询状态更新失败。';
      }
    } finally {
      if (!_disposed) {
        _busy = false;
        _notify();
      }
    }
  }

  Future<void> onResumed() async {
    if (_disposed || !_started) {
      return;
    }
    await calibrate();
    if (_eventSubscription == null && _reconnectTimer == null) {
      _connect();
    }
  }

  Future<void> stop() async {
    _started = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    final subscription = _eventSubscription;
    _eventSubscription = null;
    _connected = false;
    if (subscription != null) {
      await subscription.cancel();
    }
  }

  void _connect() {
    if (_disposed || !_started || _eventSubscription != null) {
      return;
    }
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _calibratedForConnection = false;
    var terminatedSynchronously = false;
    final subscription = _eventStreamFactory().listen(
      _handleEvent,
      onError: (Object error, StackTrace stackTrace) {
        terminatedSynchronously = true;
        _eventSubscription = null;
        _handleDisconnect(error);
      },
      onDone: () {
        terminatedSynchronously = true;
        _eventSubscription = null;
        _handleDisconnect(null);
      },
      cancelOnError: true,
    );
    if (terminatedSynchronously) {
      unawaited(subscription.cancel());
      return;
    }
    _eventSubscription = subscription;
  }

  void _handleEvent(ApiSseEvent event) {
    if (_disposed || !_started) {
      return;
    }
    Map<String, dynamic> payload;
    try {
      payload = event.decodeJsonData();
    } on FormatException {
      return;
    }
    final eventName = '${payload['event'] ?? event.event}';
    if (eventName == 'heartbeat') {
      return;
    }
    if (eventName != 'global-mark-query.snapshot' &&
        eventName != 'global-mark-query.changed') {
      return;
    }

    final wasConnected = _connected;
    _connected = true;
    _reconnectAttempt = 0;
    _error = null;
    _applySettings(GlobalMarkQuerySettings.fromEventPayload(payload));
    if (!wasConnected) {
      _notify();
    }
    if (!_calibratedForConnection) {
      _calibratedForConnection = true;
      unawaited(calibrate());
    }
  }

  void _handleDisconnect(Object? error) {
    if (_disposed || !_started) {
      return;
    }
    _connected = false;
    if (error is ApiException &&
        error.code != 'NETWORK_ERROR' &&
        error.code != 'AUTH_TOKEN_EXPIRED') {
      _error = error.message;
    }
    _notify();
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_disposed || !_started || _reconnectTimer != null) {
      return;
    }
    _reconnectAttempt += 1;
    _reconnectTimer = Timer(_reconnectDelay(_reconnectAttempt), () {
      _reconnectTimer = null;
      _connect();
    });
  }

  void _applySettings(
    GlobalMarkQuerySettings next, {
    bool authoritative = false,
  }) {
    final current = _settings;
    if (current != null && next.isOlderThan(current)) {
      return;
    }
    if (!authoritative &&
        current != null &&
        next.revision == current.revision &&
        next.updatedAt == current.updatedAt) {
      return;
    }

    final visibilityChanged = current == null ||
        current.onlyShowMarkedRecords != next.onlyShowMarkedRecords ||
        current.restoreRequired != next.restoreRequired;
    final metadataChanged = current == null || current != next;
    _settings = next;
    if (visibilityChanged) {
      _dataRevision += 1;
    }
    if (metadataChanged) {
      _notify();
    }
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    _reconnectTimer?.cancel();
    unawaited(_eventSubscription?.cancel());
    _eventSubscription = null;
    super.dispose();
  }
}

@immutable
class GlobalMarkQuerySettings {
  const GlobalMarkQuerySettings({
    required this.onlyShowMarkedRecords,
    required this.restoreRequired,
    required this.updatedAt,
    required this.revision,
  });

  final bool onlyShowMarkedRecords;
  final bool restoreRequired;
  final DateTime? updatedAt;
  final int revision;

  factory GlobalMarkQuerySettings.fromPayload(
    Map<String, dynamic> payload,
  ) {
    final data = _stringKeyMap(payload['data']);
    final settings = _stringKeyMap(data['settings'] ?? payload['settings']);
    return GlobalMarkQuerySettings.fromEventPayload(settings);
  }

  factory GlobalMarkQuerySettings.fromEventPayload(
    Map<String, dynamic> payload,
  ) {
    final rawOnlyShowMarkedRecords =
        payload['onlyShowMarkedRecords'] ?? payload['only_show_marked_records'];
    final rawRestoreRequired =
        payload['restoreRequired'] ?? payload['restore_required'];
    return GlobalMarkQuerySettings(
      onlyShowMarkedRecords: _toBool(rawOnlyShowMarkedRecords),
      restoreRequired: _toBool(rawRestoreRequired),
      updatedAt: DateTime.tryParse('${payload['updatedAt'] ?? ''}')?.toUtc(),
      revision: _toRevision(payload['revision']),
    );
  }

  bool isOlderThan(GlobalMarkQuerySettings other) {
    if (revision != other.revision) {
      return revision < other.revision;
    }
    if (updatedAt != null && other.updatedAt != null) {
      return updatedAt!.isBefore(other.updatedAt!);
    }
    return false;
  }

  @override
  bool operator ==(Object other) {
    return other is GlobalMarkQuerySettings &&
        other.onlyShowMarkedRecords == onlyShowMarkedRecords &&
        other.restoreRequired == restoreRequired &&
        other.updatedAt == updatedAt &&
        other.revision == revision;
  }

  @override
  int get hashCode => Object.hash(
        onlyShowMarkedRecords,
        restoreRequired,
        updatedAt,
        revision,
      );
}

Duration _defaultReconnectDelay(int attempt) {
  final exponent = max(0, min(attempt - 1, 5));
  return Duration(seconds: pow(2, exponent).toInt());
}

Map<String, dynamic> _stringKeyMap(Object? value) {
  if (value is Map<String, dynamic>) {
    return value;
  }
  if (value is Map) {
    return value.map((key, mapValue) => MapEntry('$key', mapValue));
  }
  return const <String, dynamic>{};
}

bool _toBool(Object? value) {
  return value == true || '$value'.toLowerCase() == 'true';
}

int _toRevision(Object? value) {
  final parsed = value is num ? value.toInt() : int.tryParse('$value');
  return parsed != null && parsed >= 0 ? parsed : 0;
}
