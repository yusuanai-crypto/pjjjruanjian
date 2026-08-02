import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/auth_models.dart';
import '../../shared/widgets/status_tag.dart';

const _defaultEmployeePassword = 'A12345678';

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
  final _verticalScrollController = ScrollController();
  final _horizontalScrollController = ScrollController();
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
    _verticalScrollController.dispose();
    _horizontalScrollController.dispose();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    if (!mounted) {
      return;
    }
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
      if (!mounted) {
        return;
      }
      setState(() {
        _users = rows
            .whereType<Map>()
            .map((item) => EmployeeAccountRecord.fromJson(_stringKeyMap(item)))
            .toList();
      });
    } on ApiException catch (error) {
      if (mounted) {
        setState(() => _error = error.message);
      }
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
    if (!mounted) {
      return;
    }
    if (created == true) {
      await _loadUsers();
      _showMessage('员工账号已创建，员工首次登录必须修改密码。');
    }
  }

  Future<void> _setUserActive(EmployeeAccountRecord user, bool active) async {
    final reason = await _askReason(active ? '填写解冻原因' : '填写冻结原因');
    if (reason == null || !mounted) {
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

  Future<void> _changePassword(EmployeeAccountRecord user) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (context) => _ChangePasswordDialog(
        apiClient: widget.apiClient,
        token: widget.token,
        user: user,
      ),
    );
    if (!mounted) {
      return;
    }
    if (changed == true) {
      await _loadUsers();
      _showMessage('修改密码成功：员工密码已修改，原登录已失效。');
    }
  }

  Future<void> _editUser(EmployeeAccountRecord user) async {
    final updated = await showDialog<bool>(
      context: context,
      builder: (context) => _EditEmployeeDialog(
        apiClient: widget.apiClient,
        token: widget.token,
        actorRole: widget.role,
        user: user,
      ),
    );
    if (!mounted) {
      return;
    }
    if (updated == true) {
      await _loadUsers();
      _showMessage('员工资料已修改。');
    }
  }

  Future<void> _deleteUser(EmployeeAccountRecord user) async {
    final deleted = await showDialog<bool>(
      context: context,
      builder: (context) => _DeleteEmployeeDialog(
        apiClient: widget.apiClient,
        token: widget.token,
        user: user,
      ),
    );
    if (!mounted) {
      return;
    }
    if (deleted == true) {
      await _loadUsers();
      _showMessage('员工账号已删除');
    }
  }

  Future<void> _resetPasswordToDefault(EmployeeAccountRecord user) async {
    final reset = await showDialog<bool>(
      context: context,
      builder: (context) => _ResetPasswordToDefaultDialog(
        apiClient: widget.apiClient,
        token: widget.token,
        user: user,
      ),
    );
    if (!mounted) {
      return;
    }
    if (reset == true) {
      await _loadUsers();
      _showMessage(
        '重置密码成功：密码已重置为 $_defaultEmployeePassword，员工下次登录必须修改密码。',
      );
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
    if (widget.role != UserRole.admin && widget.role != UserRole.superAdmin) {
      return false;
    }
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
                      isExpanded: true,
                      initialValue: _roleFilter,
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
                      isExpanded: true,
                      initialValue: _statusFilter,
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
                  : LayoutBuilder(
                      builder: (context, constraints) {
                        return Scrollbar(
                          key: const ValueKey('employee-table-scrollbar'),
                          controller: _verticalScrollController,
                          thumbVisibility: true,
                          interactive: true,
                          child: SingleChildScrollView(
                            key: const ValueKey(
                              'employee-table-vertical-scroll',
                            ),
                            controller: _verticalScrollController,
                            primary: false,
                            scrollDirection: Axis.vertical,
                            child: SingleChildScrollView(
                              key: const ValueKey(
                                'employee-table-horizontal-scroll',
                              ),
                              controller: _horizontalScrollController,
                              primary: false,
                              scrollDirection: Axis.horizontal,
                              child: ConstrainedBox(
                                constraints: BoxConstraints(
                                  minWidth: constraints.maxWidth,
                                ),
                                child: DataTable(
                                  dataRowMinHeight: 48,
                                  dataRowMaxHeight: 72,
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
                                        key: ValueKey(
                                          'employee-row-${user.id}',
                                        ),
                                        cells: [
                                          DataCell(Text(user.name)),
                                          DataCell(Text(
                                            user.phone ?? user.username,
                                          )),
                                          DataCell(Text(user.role.label)),
                                          DataCell(
                                            StatusTag(
                                              label:
                                                  user.isActive ? '启用' : '冻结',
                                              tone: user.isActive
                                                  ? StatusTone.success
                                                  : StatusTone.warning,
                                            ),
                                          ),
                                          DataCell(Text(
                                            user.mustChangePassword
                                                ? '待修改'
                                                : '已完成',
                                          )),
                                          DataCell(SizedBox(
                                            width: 180,
                                            child: Text(
                                              user.statusReason ?? '-',
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                          )),
                                          DataCell(
                                            SizedBox(
                                              width: 264,
                                              child: Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  IconButton(
                                                    key: ValueKey(
                                                      'employee-action-edit-${user.id}',
                                                    ),
                                                    tooltip: '修改',
                                                    onPressed: _canManage(user)
                                                        ? () => _editUser(user)
                                                        : null,
                                                    icon: const Icon(
                                                      Icons.edit_rounded,
                                                    ),
                                                  ),
                                                  const SizedBox(width: 6),
                                                  IconButton(
                                                    key: ValueKey(
                                                      'employee-action-delete-${user.id}',
                                                    ),
                                                    tooltip: '删除',
                                                    onPressed: _canManage(user)
                                                        ? () =>
                                                            _deleteUser(user)
                                                        : null,
                                                    icon: const Icon(
                                                      Icons.delete_rounded,
                                                    ),
                                                  ),
                                                  const SizedBox(width: 6),
                                                  IconButton(
                                                    key: ValueKey(
                                                      'employee-action-toggle-${user.id}',
                                                    ),
                                                    tooltip: user.isActive
                                                        ? '冻结'
                                                        : '解冻',
                                                    onPressed: _canManage(user)
                                                        ? () => _setUserActive(
                                                              user,
                                                              !user.isActive,
                                                            )
                                                        : null,
                                                    icon: Icon(user.isActive
                                                        ? Icons.lock_rounded
                                                        : Icons
                                                            .lock_open_rounded),
                                                  ),
                                                  const SizedBox(width: 6),
                                                  IconButton(
                                                    key: ValueKey(
                                                      'employee-action-change-password-${user.id}',
                                                    ),
                                                    tooltip: '修改密码',
                                                    onPressed: _canManage(user)
                                                        ? () => _changePassword(
                                                              user,
                                                            )
                                                        : null,
                                                    icon: const Icon(
                                                      Icons.password_rounded,
                                                    ),
                                                  ),
                                                  const SizedBox(width: 6),
                                                  IconButton(
                                                    key: ValueKey(
                                                      'employee-action-reset-password-${user.id}',
                                                    ),
                                                    tooltip: '重置密码',
                                                    onPressed: _canManage(user)
                                                        ? () =>
                                                            _resetPasswordToDefault(
                                                              user,
                                                            )
                                                        : null,
                                                    icon: const Icon(
                                                      Icons.lock_reset_rounded,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        );
                      },
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
  final _passwordController =
      TextEditingController(text: _defaultEmployeePassword);
  final _confirmPasswordController =
      TextEditingController(text: _defaultEmployeePassword);
  UserRole _role = UserRole.frontDesk;
  bool _saving = false;
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
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
      if (mounted) {
        setState(() => _error = error.message);
      }
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
              obscureText: _obscurePassword,
              decoration: InputDecoration(
                labelText: '初始密码',
                prefixIcon: const Icon(Icons.password_rounded),
                suffixIcon: IconButton(
                  tooltip: _obscurePassword ? '显示初始密码' : '隐藏初始密码',
                  onPressed: _saving
                      ? null
                      : () => setState(
                            () => _obscurePassword = !_obscurePassword,
                          ),
                  icon: Icon(
                    _obscurePassword
                        ? Icons.visibility_rounded
                        : Icons.visibility_off_rounded,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _confirmPasswordController,
              enabled: !_saving,
              obscureText: _obscureConfirmPassword,
              decoration: InputDecoration(
                labelText: '确认初始密码',
                prefixIcon: const Icon(Icons.done_all_rounded),
                suffixIcon: IconButton(
                  tooltip: _obscureConfirmPassword ? '显示确认密码' : '隐藏确认密码',
                  onPressed: _saving
                      ? null
                      : () => setState(
                            () => _obscureConfirmPassword =
                                !_obscureConfirmPassword,
                          ),
                  icon: Icon(
                    _obscureConfirmPassword
                        ? Icons.visibility_rounded
                        : Icons.visibility_off_rounded,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<UserRole>(
              initialValue: _role,
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

class _EditEmployeeDialog extends StatefulWidget {
  const _EditEmployeeDialog({
    required this.apiClient,
    required this.token,
    required this.actorRole,
    required this.user,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole actorRole;
  final EmployeeAccountRecord user;

  @override
  State<_EditEmployeeDialog> createState() => _EditEmployeeDialogState();
}

class _EditEmployeeDialogState extends State<_EditEmployeeDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _phoneController;
  late UserRole _role;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.user.name);
    _phoneController = TextEditingController(
      text: widget.user.phone ?? widget.user.username,
    );
    _role = widget.user.role;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_saving) {
      return;
    }
    final name = _nameController.text.trim();
    final phone = _phoneController.text.replaceAll(RegExp(r'\s+'), '');
    if (name.isEmpty || phone.isEmpty) {
      setState(() => _error = '请填写姓名和手机号。');
      return;
    }
    if (!RegExp(r'^1[3-9]\d{9}$').hasMatch(phone)) {
      setState(() => _error = '请输入正确的中国大陆手机号。');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.apiClient.patchJson(
        '/api/users/${widget.user.id}',
        token: widget.token,
        body: {
          'name': name,
          'phone': phone,
          'role': _role.value,
        },
      );
      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } on ApiException catch (error) {
      if (mounted) {
        setState(() => _error = error.message);
      }
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final roles = _editableRolesFor(widget.actorRole);
    return AlertDialog(
      title: Text('修改 ${widget.user.name} 的资料'),
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
            DropdownButtonFormField<UserRole>(
              initialValue: _role,
              decoration: const InputDecoration(
                labelText: '角色',
                prefixIcon: Icon(Icons.badge_rounded),
              ),
              items: [
                for (final role in roles)
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
              : const Icon(Icons.save_rounded),
          label: Text(_saving ? '保存中' : '保存'),
        ),
      ],
    );
  }
}

class _DeleteEmployeeDialog extends StatefulWidget {
  const _DeleteEmployeeDialog({
    required this.apiClient,
    required this.token,
    required this.user,
  });

  final ApiClient apiClient;
  final String token;
  final EmployeeAccountRecord user;

  @override
  State<_DeleteEmployeeDialog> createState() => _DeleteEmployeeDialogState();
}

class _DeleteEmployeeDialogState extends State<_DeleteEmployeeDialog> {
  final _reasonController = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_saving) {
      return;
    }
    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = '请填写删除原因。');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.apiClient.deleteJson(
        '/api/users/${widget.user.id}',
        token: widget.token,
        body: {'reason': reason},
      );
      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } on ApiException catch (error) {
      if (mounted) {
        setState(() => _error = error.message);
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
    return AlertDialog(
      title: const Text('删除员工账号'),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('员工姓名：${widget.user.name}'),
            const SizedBox(height: 8),
            Text(
              '手机号/登录账号：${widget.user.phone ?? widget.user.username}',
            ),
            const SizedBox(height: 16),
            Text(
              '删除后该员工不能登录，并从员工列表隐藏，但历史业务记录会保留。',
              style: TextStyle(
                color: scheme.error,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _reasonController,
              enabled: !_saving,
              autofocus: true,
              maxLength: 255,
              decoration: const InputDecoration(
                labelText: '删除原因（必填）',
                prefixIcon: Icon(Icons.edit_note_rounded),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: TextStyle(color: scheme.error)),
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
          style: FilledButton.styleFrom(
            backgroundColor: scheme.error,
            foregroundColor: scheme.onError,
          ),
          onPressed: _saving ? null : _submit,
          icon: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.delete_forever_rounded),
          label: Text(_saving ? '删除中' : '确认删除'),
        ),
      ],
    );
  }
}

class _ChangePasswordDialog extends StatefulWidget {
  const _ChangePasswordDialog({
    required this.apiClient,
    required this.token,
    required this.user,
  });

  final ApiClient apiClient;
  final String token;
  final EmployeeAccountRecord user;

  @override
  State<_ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends State<_ChangePasswordDialog> {
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
      if (mounted) {
        setState(() {
          _message = '验证码已发送至 ${verification['phoneMasked'] ?? '员工手机'}。';
        });
      }
    } on ApiException catch (error) {
      if (mounted) {
        setState(() => _message = error.message);
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  Future<void> _submit() async {
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
    return AlertDialog(
      title: Text('修改 ${widget.user.name} 的密码'),
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
          onPressed: _sending || _saving
              ? null
              : () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: _sending || _saving ? null : _submit,
          icon: const Icon(Icons.lock_reset_rounded),
          label: Text(_saving ? '修改中' : '确认修改'),
        ),
      ],
    );
  }
}

class _ResetPasswordToDefaultDialog extends StatefulWidget {
  const _ResetPasswordToDefaultDialog({
    required this.apiClient,
    required this.token,
    required this.user,
  });

  final ApiClient apiClient;
  final String token;
  final EmployeeAccountRecord user;

  @override
  State<_ResetPasswordToDefaultDialog> createState() =>
      _ResetPasswordToDefaultDialogState();
}

class _ResetPasswordToDefaultDialogState
    extends State<_ResetPasswordToDefaultDialog> {
  final _reasonController = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final reason = _reasonController.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = '请填写重置原因。');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.apiClient.postJson(
        '/api/users/${widget.user.id}/reset-password-to-default',
        token: widget.token,
        body: {
          'reason': reason,
        },
      );
      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } on ApiException catch (error) {
      if (mounted) {
        setState(() => _error = error.message);
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
    return AlertDialog(
      title: const Text('重置密码'),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('员工姓名：${widget.user.name}'),
            const SizedBox(height: 8),
            Text(
              '手机号/登录账号：${widget.user.phone ?? widget.user.username}',
            ),
            const SizedBox(height: 16),
            const Text(
              '密码将重置为 $_defaultEmployeePassword',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              '员工当前登录将失效，下次登录必须修改密码。',
              style: TextStyle(
                color: scheme.error,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _reasonController,
              enabled: !_saving,
              autofocus: true,
              maxLength: 255,
              decoration: const InputDecoration(
                labelText: '重置原因（必填）',
                prefixIcon: Icon(Icons.edit_note_rounded),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: TextStyle(color: scheme.error),
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
              : const Icon(Icons.lock_reset_rounded),
          label: Text(_saving ? '重置中' : '确认重置'),
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

List<UserRole> _editableRolesFor(UserRole actorRole) {
  if (actorRole == UserRole.superAdmin) {
    return <UserRole>[UserRole.admin, ..._employeeRoles];
  }
  return _employeeRoles;
}

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
