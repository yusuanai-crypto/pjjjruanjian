import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../core/sensitive_screen_protection_service.dart';

class SensitiveScreenGuard extends StatefulWidget {
  const SensitiveScreenGuard({
    super.key,
    required this.child,
    this.service,
  });

  final Widget child;
  final SensitiveScreenProtectionService? service;

  @override
  State<SensitiveScreenGuard> createState() => _SensitiveScreenGuardState();
}

class _SensitiveScreenGuardState extends State<SensitiveScreenGuard>
    with WidgetsBindingObserver {
  late SensitiveScreenProtectionService _service;
  late SensitiveScreenProtectionLease _lease;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _service = widget.service ?? SensitiveScreenProtectionService.instance;
    _lease = _service.acquire();
  }

  @override
  void didUpdateWidget(covariant SensitiveScreenGuard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextService =
        widget.service ?? SensitiveScreenProtectionService.instance;
    if (identical(nextService, _service)) {
      return;
    }
    _lease.release();
    _service = nextService;
    _lease = _service.acquire();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_service.reassertAfterResume());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _lease.release();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
