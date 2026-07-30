import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../core/auth/auth_controller.dart';
import '../core/crash_reporting/crash_reporter.dart';
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
    CrashReporting.setCurrentPage('bootstrap');
    CrashReporting.setUserAction('app_bootstrap');
    CrashReporting.breadcrumb('auth.bootstrap.start');
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
      final authController = await _createAuthControllerForLogin().timeout(
        widget.bootstrapTimeout,
      );

      if (!mounted) {
        return;
      }

      final destinationId = _firstDestinationId(authController);
      setState(() {
        _authController = authController;
        _selectedDestinationId = destinationId;
        _bootstrapping = false;
        _bootstrapError = null;
      });
      CrashReporting.setCurrentPage(
        authController.session == null ? 'login' : destinationId,
      );
      CrashReporting.breadcrumb(
        'auth.bootstrap.success',
        data: {'hasSession': authController.session != null},
      );
    } on TimeoutException catch (error, stackTrace) {
      CrashReporting.breadcrumb(
        'auth.bootstrap.failure',
        data: {'reason': 'timeout'},
      );
      unawaited(
        CrashReporting.recordError(
          error,
          stackTrace,
          source: 'auth.bootstrap',
        ),
      );
      _showBootstrapError('启动超时，请检查网络连接后重新尝试。');
    } catch (error, stackTrace) {
      CrashReporting.breadcrumb(
        'auth.bootstrap.failure',
        data: {
          'reason': 'exception',
          'exceptionType': error.runtimeType.toString(),
        },
      );
      unawaited(
        CrashReporting.recordError(
          error,
          stackTrace,
          source: 'auth.bootstrap',
        ),
      );
      _showBootstrapError('客户端启动失败，请重新尝试；如仍失败，请联系管理员。');
    }
  }

  Future<AuthController> _createAuthControllerForLogin() async {
    final storage = await widget.sessionStorageFactory();
    final authController = widget.authControllerFactory?.call(
          storage,
          _handleSessionRevoked,
        ) ??
        AuthController(
          storage: storage,
          onSessionRevoked: _handleSessionRevoked,
        );
    await authController.requireLoginOnLaunch();
    return authController;
  }

  void _showBootstrapError(String message) {
    if (!mounted) {
      return;
    }
    CrashReporting.setCurrentPage('bootstrap_error');
    setState(() {
      _authController = null;
      _bootstrapping = false;
      _bootstrapError = message;
    });
  }

  void _retryBootstrap() {
    CrashReporting.setCurrentPage('bootstrap');
    CrashReporting.setUserAction('bootstrap_retry');
    CrashReporting.breadcrumb('auth.bootstrap.retry');
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

    CrashReporting.setUserAction('login_submit');
    CrashReporting.breadcrumb(
      'auth.login.start',
      data: {'rememberPassword': rememberPassword},
    );
    await authController.login(
      username: username,
      password: password,
      rememberPassword: rememberPassword,
    );

    if (!mounted) {
      return;
    }
    final destinationId = _firstDestinationId(authController);
    setState(() {
      _selectedDestinationId = destinationId;
    });
    CrashReporting.setCurrentPage(destinationId);
    CrashReporting.breadcrumb('auth.login.success');
  }

  Future<void> _handleLogout() async {
    CrashReporting.setUserAction('logout');
    CrashReporting.breadcrumb('auth.logout.start');
    await _authController?.logout();
    if (!mounted) {
      return;
    }
    setState(() {
      _selectedDestinationId = 'dashboard';
    });
    CrashReporting.setCurrentPage('login');
    CrashReporting.breadcrumb('auth.logout.success');
  }

  void _handleSessionRevoked() {
    Future<void>.delayed(Duration.zero, () {
      if (!mounted) {
        return;
      }
      setState(() {
        _selectedDestinationId = 'dashboard';
      });
      CrashReporting.setCurrentPage('login');
      CrashReporting.setUserAction('session_revoked');
      CrashReporting.breadcrumb('auth.session.revoked');
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
    CrashReporting.setUserAction('change_password');
    CrashReporting.breadcrumb('auth.password_change.start');
    await authController.changePassword(
      currentPassword: currentPassword,
      newPassword: newPassword,
    );
    if (!mounted) {
      return;
    }
    final destinationId = _firstDestinationId(authController);
    setState(() {
      _selectedDestinationId = destinationId;
    });
    CrashReporting.setCurrentPage(destinationId);
    CrashReporting.breadcrumb('auth.password_change.success');
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
    CrashReporting.setCurrentPage(destinationId);
    CrashReporting.setUserAction('navigate');
    CrashReporting.breadcrumb(
      'navigation.destination.changed',
      data: {'destination': destinationId},
    );
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
