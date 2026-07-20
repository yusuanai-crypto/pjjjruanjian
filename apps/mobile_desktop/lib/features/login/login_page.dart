import 'package:flutter/material.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/config/app_config.dart';
import '../../shared/widgets/brand_logo.dart';

typedef LoginSubmit = Future<void> Function({
  required String apiBaseUrl,
  required String username,
  required String password,
});

class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    required this.initialApiBaseUrl,
    required this.onLogin,
    this.initialMessage,
  });

  final String initialApiBaseUrl;
  final String? initialMessage;
  final LoginSubmit onLogin;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _usernameController = TextEditingController(text: 'admin');
  final _passwordController = TextEditingController();
  late final TextEditingController _apiHostController;
  bool _obscurePassword = true;
  bool _submitting = false;
  String? _message;

  @override
  void initState() {
    super.initState();
    _apiHostController = TextEditingController(text: widget.initialApiBaseUrl);
    _message = widget.initialMessage;
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    _apiHostController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final apiBaseUrl = _apiHostController.text.trim();
    final username = _usernameController.text.trim();
    final password = _passwordController.text;

    if (username.isEmpty || password.isEmpty) {
      setState(() => _message = '请输入账号和密码。');
      return;
    }

    setState(() {
      _submitting = true;
      _message = null;
    });

    try {
      await widget.onLogin(
        apiBaseUrl: apiBaseUrl,
        username: username,
        password: password,
      );
    } on AuthFailure catch (error) {
      if (mounted) {
        setState(() => _message = error.message);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _message = '登录失败，请稍后重试。');
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: LayoutBuilder(
        builder: (context, constraints) {
          final desktop = constraints.maxWidth >= 900;
          return Center(
            child: SingleChildScrollView(
              padding: EdgeInsets.symmetric(
                horizontal: desktop ? 32 : 16,
                vertical: 24,
              ),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1040),
                child: desktop
                    ? Row(
                        children: [
                          const Expanded(child: _BrandPanel()),
                          const SizedBox(width: 20),
                          SizedBox(width: 420, child: _loginForm()),
                        ],
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const _BrandPanel(),
                          const SizedBox(height: 16),
                          _loginForm(),
                        ],
                      ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _loginForm() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '员工登录',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 18),
            TextField(
              controller: _apiHostController,
              enabled: !_submitting,
              decoration: const InputDecoration(
                labelText: '服务器地址',
                prefixIcon: Icon(Icons.cloud_queue_rounded),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _usernameController,
              enabled: !_submitting,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: '账号',
                prefixIcon: Icon(Icons.person_rounded),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _passwordController,
              enabled: !_submitting,
              obscureText: _obscurePassword,
              onSubmitted: (_) {
                if (!_submitting) {
                  _submit();
                }
              },
              decoration: InputDecoration(
                labelText: '密码',
                prefixIcon: const Icon(Icons.lock_rounded),
                suffixIcon: IconButton(
                  tooltip: _obscurePassword ? '显示密码' : '隐藏密码',
                  onPressed: _submitting
                      ? null
                      : () =>
                          setState(() => _obscurePassword = !_obscurePassword),
                  icon: Icon(_obscurePassword
                      ? Icons.visibility_rounded
                      : Icons.visibility_off_rounded),
                ),
              ),
            ),
            if (_message != null) ...[
              const SizedBox(height: 12),
              _LoginMessage(message: _message!),
            ],
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: _submitting ? null : () => _submit(),
              icon: _submitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.login_rounded),
              label: Text(_submitting ? '登录中' : '进入系统'),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _submitting
                  ? null
                  : () => setState(() {
                        _apiHostController.text = AppConfig.defaultApiBaseUrl;
                        _usernameController.text = 'admin';
                        _passwordController.clear();
                        _message = null;
                      }),
              icon: const Icon(Icons.restore_rounded),
              label: const Text('使用默认配置'),
            ),
          ],
        ),
      ),
    );
  }
}

class _LoginMessage extends StatelessWidget {
  const _LoginMessage({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(Icons.error_outline_rounded, color: scheme.onErrorContainer),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                message,
                style: TextStyle(
                    color: scheme.onErrorContainer,
                    fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BrandPanel extends StatelessWidget {
  const _BrandPanel();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(
              width: 156,
              height: 156,
              child: BrandLogo(),
            ),
            const SizedBox(height: 22),
            Text(
              '品鉴酱酒中心',
              style: Theme.of(context)
                  .textTheme
                  .headlineMedium
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 8),
            Text(
              '内部业务软件',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 24),
            const Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                Chip(
                  avatar: Icon(Icons.schedule_rounded, size: 18),
                  label: Text('Asia/Shanghai'),
                ),
                Chip(
                  avatar: Icon(Icons.payments_rounded, size: 18),
                  label: Text('金额按分'),
                ),
                Chip(
                  avatar: Icon(Icons.history_rounded, size: 18),
                  label: Text('关键修改留痕'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
