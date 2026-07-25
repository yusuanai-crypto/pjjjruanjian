import 'package:flutter/material.dart';

import '../../core/auth/auth_controller.dart';
import '../../shared/widgets/brand_logo.dart';

typedef LoginSubmit = Future<void> Function({
  required String username,
  required String password,
  required bool rememberPassword,
});

typedef RememberedPasswordLookup = Future<String?> Function(String username);
typedef ForgetAccount = Future<void> Function(String username);

class LoginPage extends StatefulWidget {
  const LoginPage({
    super.key,
    required this.initialUsername,
    required this.onLogin,
    this.initialMessage,
    this.rememberedUsernames = const <String>[],
    this.rememberPassword = false,
    this.onPasswordLookup,
    this.onForgetAccount,
  });

  final String initialUsername;
  final String? initialMessage;
  final List<String> rememberedUsernames;
  final bool rememberPassword;
  final RememberedPasswordLookup? onPasswordLookup;
  final ForgetAccount? onForgetAccount;
  final LoginSubmit onLogin;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  late final TextEditingController _usernameController;
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  bool _submitting = false;
  late bool _rememberPassword;
  late List<String> _rememberedUsernames;
  String? _message;
  String? _autofilledUsername;
  int _passwordLookupGeneration = 0;

  @override
  void initState() {
    super.initState();
    _usernameController = TextEditingController(text: widget.initialUsername);
    _message = widget.initialMessage;
    _rememberPassword = widget.rememberPassword;
    _rememberedUsernames = _normalizeUsernames(widget.rememberedUsernames);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _matchRememberedPassword(_usernameController.text);
    });
  }

  Future<void> _matchRememberedPassword(String username) async {
    final normalizedUsername = username.trim().toLowerCase();
    final generation = ++_passwordLookupGeneration;
    if (!_rememberedUsernames.contains(normalizedUsername) ||
        widget.onPasswordLookup == null) {
      if (_autofilledUsername != null) {
        _passwordController.clear();
        _autofilledUsername = null;
      }
      return;
    }
    final password = await widget.onPasswordLookup!(normalizedUsername);
    if (!mounted ||
        generation != _passwordLookupGeneration ||
        _usernameController.text.trim().toLowerCase() != normalizedUsername) {
      return;
    }
    if (password != null && password.isNotEmpty) {
      setState(() {
        _passwordController.text = password;
        _passwordController.selection = TextSelection.collapsed(
          offset: password.length,
        );
        _autofilledUsername = normalizedUsername;
        _rememberPassword = true;
      });
    }
  }

  void _selectUsername(String username) {
    _usernameController.text = username;
    _usernameController.selection = TextSelection.collapsed(
      offset: username.length,
    );
    _matchRememberedPassword(username);
  }

  Future<void> _forgetCurrentAccount() async {
    final username = _usernameController.text.trim().toLowerCase();
    if (!_rememberedUsernames.contains(username) ||
        widget.onForgetAccount == null) {
      return;
    }
    setState(() => _submitting = true);
    try {
      await widget.onForgetAccount!(username);
      if (!mounted) {
        return;
      }
      setState(() {
        _rememberedUsernames.remove(username);
        _passwordController.clear();
        _autofilledUsername = null;
        _rememberPassword = false;
        _message = '已忘记此账号保存的密码。';
      });
    } catch (_) {
      if (mounted) {
        setState(() => _message = '忘记账号失败，请稍后重试。');
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
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
        username: username,
        password: password,
        rememberPassword: _rememberPassword,
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
              key: const ValueKey('login-username-field'),
              controller: _usernameController,
              enabled: !_submitting,
              textInputAction: TextInputAction.next,
              onChanged: _matchRememberedPassword,
              decoration: InputDecoration(
                labelText: '账号',
                prefixIcon: const Icon(Icons.person_rounded),
                suffixIcon: _rememberedUsernames.isEmpty
                    ? null
                    : PopupMenuButton<String>(
                        key: const ValueKey('remembered-account-menu'),
                        tooltip: '选择已保存账号',
                        onSelected: _selectUsername,
                        itemBuilder: (context) => _rememberedUsernames
                            .map(
                              (username) => PopupMenuItem<String>(
                                value: username,
                                child: Text(username),
                              ),
                            )
                            .toList(),
                        icon: const Icon(Icons.arrow_drop_down_rounded),
                      ),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('login-password-field'),
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
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: CheckboxListTile(
                    key: const ValueKey('remember-password-checkbox'),
                    value: _rememberPassword,
                    enabled: !_submitting,
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    title: const Text('记住密码'),
                    onChanged: (value) {
                      setState(() => _rememberPassword = value ?? false);
                    },
                  ),
                ),
                if (_rememberedUsernames.contains(
                  _usernameController.text.trim().toLowerCase(),
                ))
                  TextButton.icon(
                    key: const ValueKey('forget-account-button'),
                    onPressed: _submitting ? null : _forgetCurrentAccount,
                    icon: const Icon(Icons.person_remove_alt_1_rounded),
                    label: const Text('忘记此账号'),
                  ),
              ],
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
          ],
        ),
      ),
    );
  }
}

List<String> _normalizeUsernames(Iterable<String> usernames) {
  final result = <String>[];
  for (final username in usernames) {
    final normalized = username.trim().toLowerCase();
    if (normalized.isNotEmpty && !result.contains(normalized)) {
      result.add(normalized);
    }
  }
  return result;
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
