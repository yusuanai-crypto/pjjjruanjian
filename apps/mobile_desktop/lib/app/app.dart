import 'package:flutter/material.dart';

import '../core/auth/auth_controller.dart';
import '../core/storage/session_storage.dart';
import '../features/login/login_page.dart';
import '../features/shell/app_shell.dart';
import 'destinations.dart';
import 'theme.dart';

class JiangjiuApp extends StatefulWidget {
  const JiangjiuApp({super.key});

  @override
  State<JiangjiuApp> createState() => _JiangjiuAppState();
}

class _JiangjiuAppState extends State<JiangjiuApp> {
  AuthController? _authController;
  bool _bootstrapping = true;
  String _selectedDestinationId = 'dashboard';

  @override
  void initState() {
    super.initState();
    _bootstrapAuth();
  }

  Future<void> _bootstrapAuth() async {
    final storage = await SessionStorage.create();
    final authController = AuthController(storage: storage);
    await authController.restore();

    if (!mounted) {
      return;
    }

    setState(() {
      _authController = authController;
      _selectedDestinationId = _firstDestinationId(authController);
      _bootstrapping = false;
    });
  }

  Future<void> _handleLogin({
    required String apiBaseUrl,
    required String username,
    required String password,
  }) async {
    final authController = _authController;
    if (authController == null) {
      return;
    }

    await authController.login(
      nextApiBaseUrl: apiBaseUrl,
      username: username,
      password: password,
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
      home: _bootstrapping || authController == null
          ? const _BootstrapPage()
          : session == null
              ? LoginPage(
                  initialApiBaseUrl: authController.apiBaseUrl,
                  initialMessage: authController.restoreMessage,
                  onLogin: _handleLogin,
                )
              : AppShell(
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

    final destinations = destinationsForBackendMenus(session.menus, session.user.role);
    if (destinations.isEmpty) {
      return 'dashboard';
    }
    return destinations.any((item) => item.id == 'dashboard') ? 'dashboard' : destinations.first.id;
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
