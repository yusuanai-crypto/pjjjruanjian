import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/auth_models.dart';
import '../../shared/widgets/status_tag.dart';

class EmployeeAccountsPage extends StatefulWidget {
  const EmployeeAccountsPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    required this.currentUserId,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final String currentUserId;

  @override
  State<EmployeeAccountsPage> createState() => _EmployeeAccountsPageState();
}

class _EmployeeAccountsPageState extends State<EmployeeAccountsPage> {
  final _keywordController = TextEditingController();
  List<EmployeeAccountRecord> _users = const <EmployeeAccountRecord>[];
  UserRole? _roleFilter;
  String _statusFilter = 'all';
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  @override
  void dispose() {
    _keywordController.dispose();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final query = <String, String>{};
      final keyword = _keywordController.text.trim();
      if (keyword.isNotEmpty) {
        query['keyword'] = keyword;
      }
      if (_roleFilter != null) {
        query['role'] = _roleFilter!.value;
      }
      if (_statusFilter != 'all') {
        query['status'] = _statusFilter;
      }
      final uri = Uri(
          path: '/api/users', queryParameters: query.isEmpty ? null : query);
      final payload = await widget.apiClient.getJson(
        uri.toString(),
        token: widget.token,
      );
      final data = _data(payload);
      final rows = data['users'] is List ? data['users'] as List : const [];
      setState(() {
        _users = rows
            .whereType<Map>()
            .map((item) => EmployeeAccountRecord.fromJson(_stringKeyMap(item)))
            .toList();
      });
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _createUser() async {
    final created = await showDialog<bool>(
      context: context,
      builder: (context) => _CreateEmployeeDialog(
        apiClient: widget.apiClient,
        token: widget.token,
      ),
    );
    if (created == true) {
      _showMessage('员工账号已创建，请通过受控渠道交付初始密码。');
      await _loadUsers();
    }
  }

  Future<void> _setUserActive(EmployeeAccountRecord user, bool active) async {
    final reason = await _askReason(active ? '填写解冻原因' : '填写冻结原因');
    if (reason == null) {
      return;
    }
    try {
      await widget.apiClient.postJson(
        '/api/users/${user.id}/${active ? 'enable' : 'disable'}',
        token: widget.token,
        body: {'reason': reason},
      );
      _showMessage(active ? '账号已解冻。' : '账号已冻结。');
      await _loadUsers();
    } on ApiException catch (error) {
      _showMessage(error.message);
    }
  }

  Future<void> _resetPassword(EmployeeAccountRecord user) async {
    final reset = await showDialog<bool>(
      context: context,
      builder: (context) => _ResetPasswordDialog(
        apiClient: widget.apiClient,
        token: widget.token,
        user: user,
      ),
    );
    if (reset == true) {
      _showMessage('验证码已核验，员工的新密码已生效。');
      await _loadUsers();
    }
  }

  Future<String?> _askReason(String title) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(title),
          content: TextField(
            controller: controller,
            autofocus: true,
            maxLength: 255,
            decoration: const InputDecoration(
              labelText: '原因',
              prefixIcon: Icon(Icons.edit_note_rounded),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () {
                final text = controller.text.trim();
                if (text.isNotEmpty) {
                  Navigator.of(context).pop(text);
                }
              },
              child: const Text('确认'),
            ),
          ],
        );
      },
    );
    controller.dispose();
    return result;
  }

  void _showMessage(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  bool _canManage(EmployeeAccountRecord user) {
    if (user.id == widget.currentUserId || user.role == UserRole.superAdmin) {
      return false;
    }
    if (user.role == UserRole.admin && widget.role != UserRole.superAdmin) {
      return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '员工账号管理',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              FilledButton.icon(
                onPressed: _createUser,
                icon: const Icon(Icons.person_add_rounded),
                label: const Text('新增员工'),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Wrap(
                spacing: 12,
                runSpacing: 12,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  SizedBox(
                    width: 260,
                    child: TextField(
                      controller: _keywordController,
                      onSubmitted: (_) => _loadUsers(),
                      decoration: const InputDecoration(
                        labelText: '姓名或手机号',
                        prefixIcon: Icon(Icons.search_rounded),
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 180,
                    child: DropdownButtonFormField<UserRole?>(
                      value: _roleFilter,
                      decoration: const InputDecoration(
                        labelText: '角色',
                        prefixIcon: Icon(Icons.badge_rounded),
                      ),
                      items: [
                        const DropdownMenuItem<UserRole?>(
                          value: null,
                          child: Text('全部角色'),
                        ),
                        for (final role in _employeeRoles)
                          DropdownMenuItem<UserRole?>(
                            value: role,
                            child: Text(role.label),
                          ),
                        const DropdownMenuItem<UserRole?>(
                          value: UserRole.admin,
                          child: Text('管理员'),
                        ),
                        const DropdownMenuItem<UserRole?>(
                          value: UserRole.superAdmin,
                          child: Text('超级管理员'),
                        ),
                      ],
                      onChanged: (value) {
                        setState(() => _roleFilter = value);
                        _loadUsers();
                      },
                    ),
                  ),
                  SizedBox(
                    width: 160,
                    child: DropdownButtonFormField<String>(
                      value: _statusFilter,
                      decoration: const InputDecoration(
                        labelText: '状态',
                        prefixIcon: Icon(Icons.toggle_on_rounded),
                      ),
                      items: const [
                        DropdownMenuItem(value: 'all', child: Text('全部状态')),
                        DropdownMenuItem(value: 'active', child: Text('启用')),
                        DropdownMenuItem(value: 'frozen', child: Text('冻结')),
                      ],
                      onChanged: (value) {
                        setState(() => _statusFilter = value ?? 'all');
                        _loadUsers();
                      },
                    ),
                  ),
                  OutlinedButton.icon(
                    onPressed: _loading ? null : _loadUsers,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('刷新'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (_error != null)
            Text(_error!, style: TextStyle(color: scheme.error)),
          if (_loading) const LinearProgressIndicator(),
          const SizedBox(height: 8),
          Expanded(
            child: Card(
              child: _users.isEmpty && !_loading
                  ? const Center(child: Text('暂无员工账号'))
                  : SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: DataTable(
                        columns: const [
                          DataColumn(label: Text('姓名')),
                          DataColumn(label: Text('手机号/用户名')),
                          DataColumn(label: Text('角色')),
                          DataColumn(label: Text('状态')),
                          DataColumn(label: Text('首次改密')),
                          DataColumn(label: Text('最近原因')),
                          DataColumn(label: Text('操作')),
                        ],
                        rows: [
                          for (final user in _users)
                            DataRow(
                              cells: [
                                DataCell(Text(user.name)),
                                DataCell(Text(user.phone ?? user.username)),
                                DataCell(Text(user.role.label)),
                                DataCell(
                                  StatusTag(
                                    label: user.isActive ? '启用' : '冻结',
                                    tone: user.isActive
                                        ? StatusTone.success
                                        : StatusTone.warning,
                                  ),
                                ),
                                DataCell(Text(
                                    user.mustChangePassword ? '待修改' : '已完成')),
                                DataCell(SizedBox(
                                  width: 180,
                                  child: Text(
                                    user.statusReason ?? '-',
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                )),
                                DataCell(
                                  Wrap(
                                    spacing: 6,
                                    children: [
                                      IconButton(
                                        tooltip: user.isActive ? '冻结' : '解冻',
                                        onPressed: _canManage(user)
                                            ? () => _setUserActive(
                                                  user,
                                                  !user.isActive,
                                                )
                                            : null,
                                        icon: Icon(user.isActive
                                            ? Icons.lock_rounded
                                            : Icons.lock_open_rounded),
                                      ),
                                      IconButton(
                                        tooltip: '重置密码',
                                        onPressed: _canManage(user)
                                            ? () => _resetPassword(user)
                                            : null,
                                        icon:
                                            const Icon(Icons.password_rounded),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                        ],
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CreateEmployeeDialog extends StatefulWidget {
  const _CreateEmployeeDialog({
    required this.apiClient,
    required this.token,
  });

  final ApiClient apiClient;
  final String token;

  @override
  State<_CreateEmployeeDialog> createState() => _CreateEmployeeDialogState();
}

class _CreateEmployeeDialogState extends State<_CreateEmployeeDialog> {
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  UserRole _role = UserRole.frontDesk;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    final phone = _phoneController.text.trim();
    final password = _passwordController.text;
    final confirmPassword = _confirmPasswordController.text;
    if (name.isEmpty || phone.isEmpty) {
      setState(() => _error = '请填写姓名和手机号。');
      return;
    }
    if (password.length < 8) {
      setState(() => _error = '初始密码至少需要 8 位。');
      return;
    }
    if (password != confirmPassword) {
      setState(() => _error = '两次输入的密码不一致。');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.apiClient.postJson(
        '/api/users',
        token: widget.token,
        body: {
          'name': name,
          'phone': phone,
          'role': _role.value,
          'password': password,
          'mustChangePassword': true,
        },
      );
      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('新增员工账号'),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _nameController,
              enabled: !_saving,
              decoration: const InputDecoration(
                labelText: '姓名',
                prefixIcon: Icon(Icons.person_rounded),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _phoneController,
              enabled: !_saving,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: '手机号',
                prefixIcon: Icon(Icons.phone_rounded),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _passwordController,
              enabled: !_saving,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: '初始密码',
                prefixIcon: Icon(Icons.password_rounded),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _confirmPasswordController,
              enabled: !_saving,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: '确认初始密码',
                prefixIcon: Icon(Icons.done_all_rounded),
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<UserRole>(
              value: _role,
              decoration: const InputDecoration(
                labelText: '角色',
                prefixIcon: Icon(Icons.badge_rounded),
              ),
              items: [
                for (final role in _employeeRoles)
                  DropdownMenuItem(
                    value: role,
                    child: Text(role.label),
                  ),
              ],
              onChanged:
                  _saving ? null : (value) => setState(() => _role = value!),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: _saving ? null : _submit,
          icon: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.check_rounded),
          label: const Text('创建'),
        ),
      ],
    );
  }
}

class _ResetPasswordDialog extends StatefulWidget {
  const _ResetPasswordDialog({
    required this.apiClient,
    required this.token,
    required this.user,
  });

  final ApiClient apiClient;
  final String token;
  final EmployeeAccountRecord user;

  @override
  State<_ResetPasswordDialog> createState() => _ResetPasswordDialogState();
}

class _ResetPasswordDialogState extends State<_ResetPasswordDialog> {
  final _codeController = TextEditingController();
  final _newPasswordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _reasonController = TextEditingController();
  bool _sending = false;
  bool _saving = false;
  String? _message;

  @override
  void dispose() {
    _codeController.dispose();
    _newPasswordController.dispose();
    _confirmPasswordController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    setState(() {
      _sending = true;
      _message = null;
    });
    try {
      final payload = await widget.apiClient.postJson(
        '/api/users/${widget.user.id}/reset-password-code',
        token: widget.token,
      );
      final verification = _stringKeyMap(_data(payload)['verification'] as Map);
      setState(() {
        _message = '验证码已发送至 ${verification['phoneMasked'] ?? '员工手机'}。';
      });
    } on ApiException catch (error) {
      setState(() => _message = error.message);
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  Future<void> _reset() async {
    final code = _codeController.text.trim();
    final newPassword = _newPasswordController.text;
    final confirmPassword = _confirmPasswordController.text;
    if (code.isEmpty) {
      setState(() => _message = '请填写短信验证码。');
      return;
    }
    if (newPassword.length < 8) {
      setState(() => _message = '新密码至少需要 8 位。');
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
      await widget.apiClient.postJson(
        '/api/users/${widget.user.id}/reset-password',
        token: widget.token,
        body: {
          'verificationCode': code,
          'newPassword': newPassword,
          'reason': _reasonController.text.trim(),
        },
      );
      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } on ApiException catch (error) {
      setState(() => _message = error.message);
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('重置 ${widget.user.name} 的密码'),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(widget.user.phone ?? widget.user.username),
                ),
                OutlinedButton.icon(
                  onPressed: _sending || _saving ? null : _sendCode,
                  icon: const Icon(Icons.sms_rounded),
                  label: Text(_sending ? '发送中' : '发送验证码'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _newPasswordController,
              enabled: !_saving,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: '员工设置的新密码',
                prefixIcon: Icon(Icons.password_rounded),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _confirmPasswordController,
              enabled: !_saving,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: '确认新密码',
                prefixIcon: Icon(Icons.done_all_rounded),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _codeController,
              enabled: !_saving,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: '短信验证码',
                prefixIcon: Icon(Icons.pin_rounded),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _reasonController,
              enabled: !_saving,
              maxLength: 255,
              decoration: const InputDecoration(
                labelText: '备注原因',
                prefixIcon: Icon(Icons.edit_note_rounded),
              ),
            ),
            if (_message != null) ...[
              const SizedBox(height: 8),
              Text(_message!),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: _saving ? null : _reset,
          icon: const Icon(Icons.lock_reset_rounded),
          label: Text(_saving ? '重置中' : '确认新密码'),
        ),
      ],
    );
  }
}

class EmployeeAccountRecord {
  const EmployeeAccountRecord({
    required this.id,
    required this.name,
    required this.username,
    required this.role,
    required this.isActive,
    required this.mustChangePassword,
    this.phone,
    this.statusReason,
  });

  final String id;
  final String name;
  final String username;
  final UserRole role;
  final bool isActive;
  final bool mustChangePassword;
  final String? phone;
  final String? statusReason;

  factory EmployeeAccountRecord.fromJson(Map<String, dynamic> json) {
    return EmployeeAccountRecord(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}',
      username: '${json['username'] ?? ''}',
      role: userRoleFromValue('${json['role'] ?? ''}'),
      isActive: json['isActive'] == true,
      mustChangePassword: json['mustChangePassword'] == true,
      phone: _nullableString(json['phone']),
      statusReason: _nullableString(json['statusReason']),
    );
  }
}

const _employeeRoles = <UserRole>[
  UserRole.frontDesk,
  UserRole.finance,
  UserRole.afterSales,
  UserRole.sales,
  UserRole.taster,
  UserRole.boss,
  UserRole.warehouse,
];

Map<String, dynamic> _data(Map<String, dynamic> payload) {
  final data = payload['data'];
  return data is Map ? _stringKeyMap(data) : <String, dynamic>{};
}

Map<String, dynamic> _stringKeyMap(Map value) {
  return value.map((key, mapValue) => MapEntry('$key', mapValue));
}

String? _nullableString(Object? value) {
  if (value == null) {
    return null;
  }
  final text = '$value'.trim();
  return text.isEmpty ? null : text;
}
