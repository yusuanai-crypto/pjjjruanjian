import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

const sensitiveDestinationIds = <String>{
  'employee_accounts',
  'role_menu',
  'operation_logs',
  'travel_group_finance_supplement',
  'guide_points_table',
  'order_form',
  'order_query',
  'special_orders',
  'qr_sales_sheet',
  'taster_commissions',
  'finance_query',
  'commission_rules',
  'payment_method_management',
  'product_management',
  'travel_agency_management',
  'moutai_inventory',
  'reconciliation_table',
  'warehouse_management',
  'after_sales_form',
  'analytics',
  'profit_analysis',
  'travel_group_query',
};

bool isSensitiveDestination(String destinationId) {
  return sensitiveDestinationIds.contains(destinationId);
}

abstract interface class SensitiveScreenProtectionPlatform {
  Future<void> enableSecureScreen();

  Future<void> disableSecureScreen();
}

class MethodChannelSensitiveScreenProtectionPlatform
    implements SensitiveScreenProtectionPlatform {
  const MethodChannelSensitiveScreenProtectionPlatform({
    MethodChannel channel = const MethodChannel(
      'com.jiangjiu/sensitive_screen',
    ),
    TargetPlatform? platform,
  })  : _channel = channel,
        _platform = platform;

  final MethodChannel _channel;
  final TargetPlatform? _platform;

  bool get _isAndroid {
    return !kIsWeb &&
        (_platform ?? defaultTargetPlatform) == TargetPlatform.android;
  }

  @override
  Future<void> enableSecureScreen() async {
    if (!_isAndroid) {
      return;
    }
    await _channel.invokeMethod<void>('enableSecureScreen');
  }

  @override
  Future<void> disableSecureScreen() async {
    if (!_isAndroid) {
      return;
    }
    await _channel.invokeMethod<void>('disableSecureScreen');
  }
}

class SensitiveScreenProtectionService {
  SensitiveScreenProtectionService({
    SensitiveScreenProtectionPlatform? platform,
  }) : _platform =
            platform ?? const MethodChannelSensitiveScreenProtectionPlatform();

  static final SensitiveScreenProtectionService instance =
      SensitiveScreenProtectionService();

  final SensitiveScreenProtectionPlatform _platform;
  Future<void> _pendingOperation = Future<void>.value();
  int _activeGuardCount = 0;

  @visibleForTesting
  int get activeGuardCount => _activeGuardCount;

  @visibleForTesting
  Future<void> get whenIdle => _pendingOperation;

  SensitiveScreenProtectionLease acquire() {
    _activeGuardCount += 1;
    if (_activeGuardCount == 1) {
      _schedule(_platform.enableSecureScreen);
    }
    return SensitiveScreenProtectionLease._(this);
  }

  Future<void> reassertAfterResume() {
    if (_activeGuardCount == 0) {
      return Future<void>.value();
    }
    return _schedule(_platform.enableSecureScreen);
  }

  void _release() {
    if (_activeGuardCount == 0) {
      return;
    }
    _activeGuardCount -= 1;
    if (_activeGuardCount == 0) {
      _schedule(_platform.disableSecureScreen);
    }
  }

  Future<void> _schedule(Future<void> Function() operation) {
    _pendingOperation = _pendingOperation.then((_) async {
      try {
        await operation();
      } catch (_) {
        // Platform protection must never crash navigation or app lifecycle.
      }
    });
    return _pendingOperation;
  }
}

class SensitiveScreenProtectionLease {
  SensitiveScreenProtectionLease._(this._service);

  SensitiveScreenProtectionService? _service;

  void release() {
    final service = _service;
    if (service == null) {
      return;
    }
    _service = null;
    service._release();
  }
}
