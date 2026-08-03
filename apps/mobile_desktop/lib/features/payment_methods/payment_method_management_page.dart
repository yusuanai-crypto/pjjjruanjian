import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class PaymentMethodManagementPage extends StatefulWidget {
  const PaymentMethodManagementPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<PaymentMethodManagementPage> createState() =>
      _PaymentMethodManagementPageState();
}

class _PaymentMethodManagementPageState
    extends State<PaymentMethodManagementPage> {
  late BusinessApi _businessApi;
  List<PaymentMethodRecord> _methods = const [];
  bool _loading = true;
  bool _mutating = false;
  String? _errorMessage;

  bool get _canManage => canManagePaymentMethods(widget.role);

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    if (_canManage) {
      _load();
    } else {
      _loading = false;
    }
  }

  @override
  void didUpdateWidget(covariant PaymentMethodManagementPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.role != widget.role) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      if (_canManage) {
        _load();
      } else {
        setState(() {
          _methods = const [];
          _loading = false;
          _errorMessage = null;
        });
      }
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final methods = await _businessApi.listPaymentMethods(
        includeInactive: true,
      );
      if (!mounted) return;
      setState(() {
        _methods = methods;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _openEditor([PaymentMethodRecord? method]) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => _PaymentMethodEditorDialog(
        businessApi: _businessApi,
        method: method,
      ),
    );
    if (saved != true || !mounted) return;
    _showMessage(method == null ? '收款方式已新增。' : '收款方式已更新。');
    await _load();
  }

  Future<void> _changeStatus(PaymentMethodRecord method) async {
    final nextActive = !method.isActive;
    if (!nextActive && method.isDefault) {
      _showMessage(
        '当前默认方式不能停用，请先设置新的默认收款方式。',
        isError: true,
      );
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(nextActive ? '启用收款方式' : '停用收款方式'),
        content: Text(
          nextActive ? '启用后可用于新订单，历史订单不受影响。' : '停用后不能用于新增收款明细，历史订单仍显示原快照。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            key: const ValueKey('payment-method-status-confirm-button'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(nextActive ? '确认启用' : '确认停用'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _runMutation(
      () => nextActive
          ? _businessApi.enablePaymentMethod(method.id)
          : _businessApi.disablePaymentMethod(method.id),
      nextActive ? '收款方式已启用。' : '收款方式已停用。',
    );
  }

  Future<void> _setDefault(PaymentMethodRecord method) async {
    if (method.isDefault) return;
    await _runMutation(
      () => _businessApi.setDefaultPaymentMethod(method.id),
      '默认收款方式已更新。',
    );
  }

  Future<void> _move(int fromIndex, int toIndex) async {
    if (fromIndex < 0 ||
        fromIndex >= _methods.length ||
        toIndex < 0 ||
        toIndex >= _methods.length ||
        fromIndex == toIndex) {
      return;
    }
    final reordered = [..._methods];
    final moved = reordered.removeAt(fromIndex);
    reordered.insert(toIndex, moved);
    await _runMutation(
      () => _businessApi.sortPaymentMethods([
        for (var index = 0; index < reordered.length; index += 1)
          {
            'id': reordered[index].id,
            'sortOrder': (index + 1) * 10,
          },
      ]),
      '收款方式排序已更新。',
    );
  }

  Future<void> _runMutation(
    Future<Object?> Function() operation,
    String successMessage,
  ) async {
    setState(() => _mutating = true);
    try {
      await operation();
      if (!mounted) return;
      await _load();
      if (!mounted) return;
      _showMessage(successMessage);
    } catch (error) {
      if (!mounted) return;
      _showMessage(_messageForError(error), isError: true);
    } finally {
      if (mounted) {
        setState(() => _mutating = false);
      }
    }
  }

  void _showMessage(String message, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? Theme.of(context).colorScheme.error : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_canManage) {
      return const ResponsivePage(
        key: ValueKey('payment-method-management-access-denied'),
        children: [
          _InlineNotice(
            message: '当前角色不可访问收款方式管理。',
            tone: StatusTone.danger,
          ),
        ],
      );
    }
    return ResponsivePage(
      maxWidth: 1200,
      children: [
        FormSection(
          title: '收款方式管理',
          trailing: FilledButton.icon(
            key: const ValueKey('payment-method-add-button'),
            onPressed: _loading || _mutating ? null : () => _openEditor(),
            icon: const Icon(Icons.add_rounded),
            label: const Text('新增收款方式'),
          ),
          children: [
            const Text(
              '维护名称、分类、手续费率、启停、顺序和默认方式。费率变更会用于未财务标记订单的实时估算；已标记历史订单仍优先使用原费率快照。',
            ),
            if (_loading) ...[
              const SizedBox(height: 12),
              const LinearProgressIndicator(),
            ],
            if (_errorMessage != null) ...[
              const SizedBox(height: 12),
              _InlineNotice(
                message: _errorMessage!,
                tone: StatusTone.danger,
              ),
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  key: const ValueKey('payment-method-list-retry-button'),
                  onPressed: _loading ? null : _load,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('重试'),
                ),
              ),
            ],
            if (!_loading && _errorMessage == null && _methods.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('暂无收款方式。'),
              ),
            if (!_loading && _errorMessage == null)
              for (var index = 0; index < _methods.length; index += 1) ...[
                if (index > 0) const SizedBox(height: 10),
                _PaymentMethodCard(
                  method: _methods[index],
                  busy: _mutating,
                  canMoveUp: index > 0,
                  canMoveDown: index < _methods.length - 1,
                  onEdit: () => _openEditor(_methods[index]),
                  onStatusChanged: () => _changeStatus(_methods[index]),
                  onSetDefault: () => _setDefault(_methods[index]),
                  onMoveUp: () => _move(index, index - 1),
                  onMoveDown: () => _move(index, index + 1),
                ),
              ],
          ],
        ),
      ],
    );
  }
}

class _PaymentMethodCard extends StatelessWidget {
  const _PaymentMethodCard({
    required this.method,
    required this.busy,
    required this.canMoveUp,
    required this.canMoveDown,
    required this.onEdit,
    required this.onStatusChanged,
    required this.onSetDefault,
    required this.onMoveUp,
    required this.onMoveDown,
  });

  final PaymentMethodRecord method;
  final bool busy;
  final bool canMoveUp;
  final bool canMoveDown;
  final VoidCallback onEdit;
  final VoidCallback onStatusChanged;
  final VoidCallback onSetDefault;
  final VoidCallback onMoveUp;
  final VoidCallback onMoveDown;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: ValueKey('payment-method-card-${method.id}'),
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  method.name,
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                if (method.isDefault)
                  const StatusTag(
                    label: '当前默认',
                    tone: StatusTone.success,
                  ),
                StatusTag(
                  label: method.isActive ? '已启用' : '已停用',
                  tone: method.isActive ? StatusTone.info : StatusTone.neutral,
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '${_categoryLabel(method.category)} · 编码 ${method.code} · 排序 ${method.sortOrder}',
            ),
            const SizedBox(height: 4),
            Text(
              method.serviceFeeRate == null
                  ? '手续费率未设置'
                  : '手续费率 ${_proportionToPercentageText(method.serviceFeeRate!)}%',
              key: ValueKey('payment-method-service-fee-${method.id}'),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.end,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                IconButton(
                  key: ValueKey('payment-method-up-${method.id}'),
                  tooltip: '上移',
                  onPressed: busy || !canMoveUp ? null : onMoveUp,
                  icon: const Icon(Icons.arrow_upward_rounded),
                ),
                IconButton(
                  key: ValueKey('payment-method-down-${method.id}'),
                  tooltip: '下移',
                  onPressed: busy || !canMoveDown ? null : onMoveDown,
                  icon: const Icon(Icons.arrow_downward_rounded),
                ),
                OutlinedButton.icon(
                  key: ValueKey('payment-method-edit-${method.id}'),
                  onPressed: busy ? null : onEdit,
                  icon: const Icon(Icons.edit_rounded),
                  label: const Text('编辑'),
                ),
                OutlinedButton.icon(
                  key: ValueKey('payment-method-status-${method.id}'),
                  onPressed: busy ? null : onStatusChanged,
                  icon: Icon(
                    method.isActive
                        ? Icons.pause_circle_outline_rounded
                        : Icons.play_circle_outline_rounded,
                  ),
                  label: Text(method.isActive ? '停用' : '启用'),
                ),
                if (!method.isDefault)
                  FilledButton.tonalIcon(
                    key: ValueKey('payment-method-default-${method.id}'),
                    onPressed: busy ? null : onSetDefault,
                    icon: const Icon(Icons.star_rounded),
                    label: const Text('设为默认'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PaymentMethodEditorDialog extends StatefulWidget {
  const _PaymentMethodEditorDialog({
    required this.businessApi,
    this.method,
  });

  final BusinessApi businessApi;
  final PaymentMethodRecord? method;

  @override
  State<_PaymentMethodEditorDialog> createState() =>
      _PaymentMethodEditorDialogState();
}

class _PaymentMethodEditorDialogState
    extends State<_PaymentMethodEditorDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _serviceFeeRateController;
  late String _category;
  bool _saving = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.method?.name ?? '');
    _serviceFeeRateController = TextEditingController(
      text: widget.method?.serviceFeeRate == null
          ? ''
          : _proportionToPercentageText(
              widget.method!.serviceFeeRate!,
            ),
    );
    _category = widget.method?.category ?? 'direct_receipt';
  }

  @override
  void dispose() {
    _nameController.dispose();
    _serviceFeeRateController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _errorMessage = '收款方式名称不能为空。');
      return;
    }
    final serviceFeeRateInput = _serviceFeeRateController.text.trim();
    final serviceFeeRateError = _validatePercentageInput(serviceFeeRateInput);
    if (serviceFeeRateError != null) {
      setState(() => _errorMessage = serviceFeeRateError);
      return;
    }
    setState(() {
      _saving = true;
      _errorMessage = null;
    });
    final body = <String, dynamic>{
      'name': name,
      'category': _category,
      'serviceFeeRate': serviceFeeRateInput.isEmpty
          ? null
          : _percentageToProportion(serviceFeeRateInput),
    };
    try {
      final method = widget.method;
      if (method == null) {
        await widget.businessApi.createPaymentMethod(body);
      } else {
        await widget.businessApi.updatePaymentMethod(method.id, body);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.method == null ? '新增收款方式' : '编辑收款方式'),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.method != null) ...[
              Text('编码：${widget.method!.code}（创建后不可修改）'),
              const SizedBox(height: 12),
            ],
            TextField(
              key: const ValueKey('payment-method-name-field'),
              controller: _nameController,
              enabled: !_saving,
              decoration: const InputDecoration(labelText: '名称'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: const ValueKey('payment-method-category-field'),
              initialValue: _category,
              decoration: const InputDecoration(labelText: '分类'),
              items: const [
                DropdownMenuItem(
                  value: 'direct_receipt',
                  child: Text('即时收款'),
                ),
                DropdownMenuItem(
                  value: 'collect_on_delivery',
                  child: Text('代收营业款'),
                ),
              ],
              onChanged: _saving
                  ? null
                  : (value) => setState(
                        () => _category = value ?? 'direct_receipt',
                      ),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey(
                'payment-method-service-fee-rate-field',
              ),
              controller: _serviceFeeRateController,
              enabled: !_saving,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: '手续费率（%）',
                hintText: '例如 0.6',
                suffixText: '%',
                helperText: '最多四位小数；留空表示未配置。',
              ),
            ),
            if (_errorMessage != null) ...[
              const SizedBox(height: 12),
              _InlineNotice(
                message: _errorMessage!,
                tone: StatusTone.danger,
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
          key: const ValueKey('payment-method-save-button'),
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.save_rounded),
          label: const Text('保存'),
        ),
      ],
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({
    required this.message,
    required this.tone,
  });

  final String message;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: StatusTag(label: message, tone: tone),
    );
  }
}

String _categoryLabel(String category) {
  return category == 'collect_on_delivery' ? '代收营业款' : '即时收款';
}

String? _validatePercentageInput(String value) {
  if (value.isEmpty) return null;
  if (value.startsWith('-')) {
    return '手续费率必须在 0% 到 100% 之间。';
  }
  final match = RegExp(r'^(\d+)(?:\.(\d*))?$').firstMatch(value);
  if (match == null) {
    return '请输入有效的手续费率百分比。';
  }
  final whole = int.tryParse(match.group(1)!);
  final fraction = match.group(2) ?? '';
  if (whole == null ||
      whole > 100 ||
      (whole == 100 && fraction.contains(RegExp(r'[1-9]')))) {
    return '手续费率必须在 0% 到 100% 之间。';
  }
  if (fraction.length > 4) {
    return '手续费率最多支持四位小数。';
  }
  return null;
}

String _percentageToProportion(String value) {
  final parts = value.split('.');
  final whole = int.parse(parts[0]);
  final fraction = parts.length == 1 ? '' : parts[1];
  final fractionUnits = int.parse(
    fraction.padRight(4, '0').substring(0, 4),
  );
  final percentageTenThousandths = whole * 10000 + fractionUnits;
  final proportionWhole = percentageTenThousandths ~/ 1000000;
  final proportionFraction =
      (percentageTenThousandths % 1000000).toString().padLeft(6, '0');
  return '$proportionWhole.$proportionFraction';
}

String _proportionToPercentageText(String value) {
  final match = RegExp(r'^(\d+)(?:\.(\d{1,6}))?$').firstMatch(value.trim());
  if (match == null) return value;
  final proportionWhole = int.tryParse(match.group(1)!);
  if (proportionWhole == null) return value;
  final proportionFraction = int.parse(
    (match.group(2) ?? '').padRight(6, '0'),
  );
  final percentageTenThousandths =
      proportionWhole * 1000000 + proportionFraction;
  final percentageWhole = percentageTenThousandths ~/ 10000;
  final fraction = (percentageTenThousandths % 10000)
      .toString()
      .padLeft(4, '0')
      .replaceFirst(RegExp(r'0+$'), '');
  return fraction.isEmpty ? '$percentageWhole' : '$percentageWhole.$fraction';
}

String _messageForError(Object error) {
  if (error is ApiException) {
    final message = error.message.trim();
    return message.isEmpty ? '操作失败，请稍后重试。' : message;
  }
  return '操作失败，请稍后重试。';
}
