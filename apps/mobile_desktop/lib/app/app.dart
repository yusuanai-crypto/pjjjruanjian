import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../core/auth/auth_controller.dart';
import '../core/storage/session_storage.dart';
import '../features/login/force_change_password_page.dart';
import '../features/login/login_page.dart';
import '../features/shell/app_shell.dart';
import 'destinations.dart';
import 'theme.dart';

typedef SessionStorageFactory = Future<SessionStorage> Function();
typedef AuthControllerFactory = AuthController Function(
  SessionStorage storage,
  VoidCallback onSessionRevoked,
);

class JiangjiuApp extends StatefulWidget {
  const JiangjiuApp({
    super.key,
    this.sessionStorageFactory = SessionStorage.create,
    this.bootstrapTimeout = const Duration(seconds: 15),
    this.authControllerFactory,
  });

  final SessionStorageFactory sessionStorageFactory;
  final Duration bootstrapTimeout;
  final AuthControllerFactory? authControllerFactory;

  @override
  State<JiangjiuApp> createState() => _JiangjiuAppState();
}

class _JiangjiuAppState extends State<JiangjiuApp> with WidgetsBindingObserver {
  AuthController? _authController;
  Timer? _sessionRefreshTimer;
  bool _bootstrapping = true;
  String? _bootstrapError;
  String _selectedDestinationId = 'dashboard';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _bootstrapAuth();
    _startSessionRefreshTimer();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sessionRefreshTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _startSessionRefreshTimer();
      unawaited(_refreshSessionIfNeeded());
      return;
    }
    _sessionRefreshTimer?.cancel();
    _sessionRefreshTimer = null;
  }

  Future<void> _bootstrapAuth() async {
    try {
      final authController = await _createAndRestoreAuthController().timeout(
        widget.bootstrapTimeout,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _authController = authController;
        _selectedDestinationId = _firstDestinationId(authController);
        _bootstrapping = false;
        _bootstrapError = null;
      });
    } on TimeoutException {
      _showBootstrapError('启动超时，请检查网络连接后重新尝试。');
    } catch (_) {
      _showBootstrapError('客户端启动失败，请重新尝试；如仍失败，请联系管理员。');
    }
  }

  Future<AuthController> _createAndRestoreAuthController() async {
    final storage = await widget.sessionStorageFactory();
    final authController = widget.authControllerFactory?.call(
          storage,
          _handleSessionRevoked,
        ) ??
        AuthController(
          storage: storage,
          onSessionRevoked: _handleSessionRevoked,
        );
    await authController.restore();
    return authController;
  }

  void _showBootstrapError(String message) {
    if (!mounted) {
      return;
    }
    setState(() {
      _authController = null;
      _bootstrapping = false;
      _bootstrapError = message;
    });
  }

  void _retryBootstrap() {
    setState(() {
      _bootstrapping = true;
      _bootstrapError = null;
    });
    _bootstrapAuth();
  }

  Future<void> _handleLogin({
    required String username,
    required String password,
    required bool rememberPassword,
  }) async {
    final authController = _authController;
    if (authController == null) {
      return;
    }

    await authController.login(
      username: username,
      password: password,
      rememberPassword: rememberPassword,
    );

    setState(() {
      _selectedDestinationId = _firstDestinationId(authController);
    });
  }

  Future<void> _handleLogout() async {
    await _authController?.logout();
    setState(() {
      _selectedDestinationId = 'dashboard';
    });
  }

  void _handleSessionRevoked() {
    Future<void>.delayed(Duration.zero, () {
      if (!mounted) {
        return;
      }
      setState(() {
        _selectedDestinationId = 'dashboard';
      });
    });
  }

  Future<void> _handleChangePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final authController = _authController;
    if (authController == null) {
      return;
    }
    await authController.changePassword(
      currentPassword: currentPassword,
      newPassword: newPassword,
    );
    setState(() {
      _selectedDestinationId = _firstDestinationId(authController);
    });
  }

  Future<void> _refreshSessionIfNeeded() async {
    final authController = _authController;
    if (!mounted || authController?.session == null) {
      return;
    }
    try {
      await authController!.refreshSession();
      if (mounted) {
        setState(() {});
      }
    } catch (_) {
      if (mounted && authController?.session == null) {
        setState(() => _selectedDestinationId = 'dashboard');
      }
    }
  }

  void _startSessionRefreshTimer() {
    if (_sessionRefreshTimer != null) {
      return;
    }
    _sessionRefreshTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => _refreshSessionIfNeeded(),
    );
  }

  void _handleDestinationChanged(String destinationId) {
    setState(() {
      _selectedDestinationId = destinationId;
    });
  }

  @override
  Widget build(BuildContext context) {
    final authController = _authController;
    final session = authController?.session;
    final destinations = session == null
        ? const <AppDestination>[]
        : destinationsForBackendMenus(session.menus, session.user.role);

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: '品鉴酱酒中心',
      theme: buildJiangjiuTheme(),
      locale: const Locale('zh', 'CN'),
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('zh', 'CN'),
        Locale('en', 'US'),
      ],
      home: _bootstrapping
          ? const _BootstrapPage()
          : _bootstrapError != null || authController == null
              ? _BootstrapErrorPage(
                  message: _bootstrapError ?? '客户端启动失败，请重新尝试。',
                  onRetry: _retryBootstrap,
                )
              : session == null
                  ? LoginPage(
                      initialUsername: authController.lastUsername,
                      initialMessage: authController.restoreMessage,
                      rememberedUsernames: authController.rememberedUsernames,
                      rememberPassword: authController.rememberPasswordEnabled,
                      onPasswordLookup: authController.readRememberedPassword,
                      onForgetAccount: authController.forgetAccount,
                      onLogin: _handleLogin,
                    )
                  : session.user.mustChangePassword
                      ? ForceChangePasswordPage(
                          onSubmit: _handleChangePassword,
                          onLogout: _handleLogout,
                        )
                      : AppShell(
                          apiClient: authController.apiClient,
                          token: authController.token,
                          role: session.user.role,
                          user: session.user,
                          allowedDestinations: destinations,
                          selectedDestinationId: _selectedDestinationId,
                          onDestinationChanged: _handleDestinationChanged,
                          onLogout: _handleLogout,
                        ),
    );
  }

  String _firstDestinationId(AuthController authController) {
    final session = authController.session;
    if (session == null) {
      return 'dashboard';
    }

    final destinations =
        destinationsForBackendMenus(session.menus, session.user.role);
    if (destinations.isEmpty) {
      return 'dashboard';
    }
    return destinations.any((item) => item.id == 'dashboard')
        ? 'dashboard'
        : destinations.first.id;
  }
}

class _BootstrapPage extends StatelessWidget {
  const _BootstrapPage();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: CircularProgressIndicator(),
      ),
    );
  }
}

class _BootstrapErrorPage extends StatelessWidget {
  const _BootstrapErrorPage({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      key: const ValueKey('bootstrap-error-page'),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.cloud_off_rounded,
                      size: 48,
                      color: colorScheme.error,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      '启动失败',
                      style: Theme.of(context)
                          .textTheme
                          .headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      message,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: colorScheme.onSurfaceVariant),
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      key: const ValueKey('bootstrap-retry-button'),
                      onPressed: onRetry,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('重新尝试'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
