import 'package:flutter/material.dart';

import '../../core/auth/auth_controller.dart';

typedef ForcePasswordSubmit = Future<void> Function({
  required String currentPassword,
  required String newPassword,
});

class ForceChangePasswordPage extends StatefulWidget {
  const ForceChangePasswordPage({
    super.key,
    required this.onSubmit,
    required this.onLogout,
  });

  final ForcePasswordSubmit onSubmit;
  final Future<void> Function() onLogout;

  @override
  State<ForceChangePasswordPage> createState() =>
      _ForceChangePasswordPageState();
}

class _ForceChangePasswordPageState extends State<ForceChangePasswordPage> {
  final _currentPasswordController = TextEditingController(text: '123456');
  final _newPasswordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _saving = false;
  bool _obscure = true;
  String? _message;

  @override
  void dispose() {
    _currentPasswordController.dispose();
    _newPasswordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final currentPassword = _currentPasswordController.text;
    final newPassword = _newPasswordController.text;
    final confirmPassword = _confirmPasswordController.text;
    if (newPassword.length < 8) {
      setState(() => _message = '新密码至少需要 8 位。');
      return;
    }
    if (newPassword == '123456') {
      setState(() => _message = '新密码不能继续使用初始密码 123456。');
      return;
    }
    if (newPassword != confirmPassword) {
      setState(() => _message = '两次输入的新密码不一致。');
      return;
    }
    setState(() {
      _saving = true;
      _message = null;
    });
    try {
      await widget.onSubmit(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );
    } on AuthFailure catch (error) {
      if (mounted) {
        setState(() => _message = error.message);
      }
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(Icons.lock_reset_rounded,
                      size: 42, color: scheme.primary),
                  const SizedBox(height: 16),
                  Text(
                    '修改初始密码',
                    textAlign: TextAlign.center,
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '首次登录后需要设置新的登录密码。',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: scheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 20),
                  TextField(
                    controller: _currentPasswordController,
                    obscureText: _obscure,
                    enabled: !_saving,
                    decoration: const InputDecoration(
                      labelText: '当前密码',
                      prefixIcon: Icon(Icons.lock_outline_rounded),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _newPasswordController,
                    obscureText: _obscure,
                    enabled: !_saving,
                    decoration: InputDecoration(
                      labelText: '新密码',
                      prefixIcon: const Icon(Icons.password_rounded),
                      suffixIcon: IconButton(
                        tooltip: _obscure ? '显示密码' : '隐藏密码',
                        onPressed: _saving
                            ? null
                            : () => setState(() => _obscure = !_obscure),
                        icon: Icon(_obscure
                            ? Icons.visibility_rounded
                            : Icons.visibility_off_rounded),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _confirmPasswordController,
                    obscureText: _obscure,
                    enabled: !_saving,
                    onSubmitted: (_) {
                      if (!_saving) {
                        _submit();
                      }
                    },
                    decoration: const InputDecoration(
                      labelText: '确认新密码',
                      prefixIcon: Icon(Icons.done_all_rounded),
                    ),
                  ),
                  if (_message != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _message!,
                      style: TextStyle(
                        color: scheme.error,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    onPressed: _saving ? null : _submit,
                    icon: _saving
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.check_rounded),
                    label: Text(_saving ? '保存中' : '保存新密码'),
                  ),
                  TextButton.icon(
                    onPressed: _saving ? null : widget.onLogout,
                    icon: const Icon(Icons.logout_rounded),
                    label: const Text('退出登录'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
