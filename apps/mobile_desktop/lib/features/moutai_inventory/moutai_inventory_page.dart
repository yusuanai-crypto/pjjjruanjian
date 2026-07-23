import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';

typedef MoutaiSavePathPicker = Future<String?> Function(String fileName);
typedef MoutaiFileWriter = Future<void> Function(
  String path,
  List<int> bytes,
);

class MoutaiInventoryPage extends StatefulWidget {
  const MoutaiInventoryPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    this.businessApi,
    this.savePathPicker,
    this.fileWriter,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final BusinessApi? businessApi;
  final MoutaiSavePathPicker? savePathPicker;
  final MoutaiFileWriter? fileWriter;

  @override
  State<MoutaiInventoryPage> createState() => _MoutaiInventoryPageState();
}

class _MoutaiInventoryPageState extends State<MoutaiInventoryPage> {
  late BusinessApi _api;
  final _nameFilter = TextEditingController();
  final _codeFilter = TextEditingController();
  final _dateFilter = TextEditingController();
  final _batchFilter = TextEditingController();
  final _serialFilter = TextEditingController();
  final _orderFilter = TextEditingController();

  List<SerializedInventoryUnitRecord> _units = const [];
  final Set<String> _selectedIds = {};
  bool _loading = true;
  bool _exporting = false;
  String? _statusFilter;
  String? _error;

  bool get _canSeeCost =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance;

  bool get _canCreate =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance ||
      widget.role == UserRole.warehouse;

  @override
  void initState() {
    super.initState();
    _api = widget.businessApi ??
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _load();
  }

  @override
  void didUpdateWidget(covariant MoutaiInventoryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.businessApi != widget.businessApi ||
        oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _api = widget.businessApi ??
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _load();
    }
  }

  @override
  void dispose() {
    _nameFilter.dispose();
    _codeFilter.dispose();
    _dateFilter.dispose();
    _batchFilter.dispose();
    _serialFilter.dispose();
    _orderFilter.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await _api.listSerializedInventory(
        pageSize: 100,
        moutaiName: _nameFilter.text.trim(),
        logisticsCode: _codeFilter.text.trim(),
        factoryDate: _tryDate(_dateFilter.text),
        productionBatch: _batchFilter.text.trim(),
        batchSerialNo: _serialFilter.text.trim(),
        status: _statusFilter,
        orderNo: _orderFilter.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _units = page.units;
        _selectedIds.removeWhere(
          (id) => !_units.any((unit) => unit.id == id),
        );
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _message(error);
      });
    }
  }

  Future<void> _export() async {
    if (_exporting) return;
    if (_selectedIds.isEmpty) {
      _show('请先勾选需要导出的茅台。');
      return;
    }
    setState(() => _exporting = true);
    try {
      final orderedIds = [
        for (final unit in _units)
          if (_selectedIds.contains(unit.id)) unit.id,
      ];
      final downloaded = await _api.exportMoutaiLogisticsDocx(orderedIds);
      final targetPath = await (widget.savePathPicker?.call(
            downloaded.fileName,
          ) ??
          FilePicker.saveFile(
            dialogTitle: '保存茅台物流单',
            fileName: _safeFileName(downloaded.fileName),
            type: FileType.custom,
            allowedExtensions: const ['docx'],
          ));
      if (targetPath == null || targetPath.trim().isEmpty) {
        if (mounted) setState(() => _exporting = false);
        return;
      }
      if (widget.fileWriter != null) {
        await widget.fileWriter!(targetPath, downloaded.bytes);
      } else {
        await File(targetPath).writeAsBytes(downloaded.bytes, flush: true);
      }
      if (!mounted) return;
      setState(() => _exporting = false);
      _show('已保存到：$targetPath');
    } catch (error) {
      if (!mounted) return;
      setState(() => _exporting = false);
      _show(_message(error));
    }
  }

  Future<void> _openInbound() async {
    final created = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _MoutaiInboundDialog(
        api: _api,
        canEditCost: _canSeeCost,
      ),
    );
    if (created == true && mounted) await _load();
  }

  Future<void> _openEdit(SerializedInventoryUnitRecord unit) async {
    final updated = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _MoutaiEditDialog(
        api: _api,
        unit: unit,
        canEditCost: _canSeeCost,
      ),
    );
    if (updated == true && mounted) await _load();
  }

  void _show(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: 12,
                runSpacing: 12,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    '茅台',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  Text('已选择 ${_selectedIds.length} 瓶'),
                  OutlinedButton.icon(
                    onPressed: _loading ? null : _load,
                    icon: const Icon(Icons.refresh),
                    label: const Text('刷新'),
                  ),
                  FilledButton.icon(
                    key: const Key('moutai-export-button'),
                    onPressed: _exporting ? null : _export,
                    icon: _exporting
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.description_outlined),
                    label: Text(_exporting ? '正在生成…' : '导出物流单'),
                  ),
                  if (_canCreate)
                    FilledButton.tonalIcon(
                      onPressed: _openInbound,
                      icon: const Icon(Icons.add_box_outlined),
                      label: const Text('逐瓶入库'),
                    ),
                ],
              ),
              const SizedBox(height: 14),
              _buildFilters(),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, style: const TextStyle(color: Colors.red)),
              ],
              const SizedBox(height: 12),
              Expanded(
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : _buildTable(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilters() {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        _filter(_nameFilter, '商品名称'),
        _filter(_codeFilter, '物流码'),
        _filter(_dateFilter, '出厂日期 YYYY-MM-DD'),
        _filter(_batchFilter, '生产批次'),
        _filter(_serialFilter, '批次序号'),
        SizedBox(
          width: 165,
          child: DropdownButtonFormField<String?>(
            initialValue: _statusFilter,
            decoration: const InputDecoration(labelText: '库存状态', isDense: true),
            items: const [
              DropdownMenuItem(value: null, child: Text('全部')),
              DropdownMenuItem(
                value: 'pending_cost',
                child: Text('待补进货价'),
              ),
              DropdownMenuItem(value: 'available', child: Text('可售')),
              DropdownMenuItem(value: 'allocated', child: Text('已占用')),
              DropdownMenuItem(value: 'void', child: Text('作废')),
            ],
            onChanged: (value) => setState(() => _statusFilter = value),
          ),
        ),
        _filter(_orderFilter, '关联订单号'),
        FilledButton.tonal(onPressed: _load, child: const Text('查询')),
      ],
    );
  }

  Widget _filter(TextEditingController controller, String label) {
    return SizedBox(
      width: 180,
      child: TextField(
        controller: controller,
        decoration: InputDecoration(labelText: label, isDense: true),
        onSubmitted: (_) => _load(),
      ),
    );
  }

  Widget _buildTable() {
    if (_units.isEmpty) {
      return const Center(child: Text('暂无逐瓶库存。'));
    }
    return Scrollbar(
      thumbVisibility: true,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SingleChildScrollView(
          child: DataTable(
            columns: [
              DataColumn(
                label: Checkbox(
                  key: const Key('moutai-select-all'),
                  value: _selectedIds.length == _units.length,
                  tristate: _selectedIds.isNotEmpty &&
                      _selectedIds.length != _units.length,
                  onChanged: (checked) {
                    setState(() {
                      if (checked == true) {
                        _selectedIds.addAll(_units.map((unit) => unit.id));
                      } else {
                        _selectedIds.clear();
                      }
                    });
                  },
                ),
              ),
              const DataColumn(label: Text('商品名称')),
              const DataColumn(label: Text('物流码')),
              const DataColumn(label: Text('出厂日期')),
              const DataColumn(label: Text('生产批次')),
              const DataColumn(label: Text('批次序号')),
              const DataColumn(label: Text('库存状态')),
              const DataColumn(label: Text('关联订单')),
              const DataColumn(label: Text('入库时间')),
              if (_canSeeCost) const DataColumn(label: Text('进货价')),
              const DataColumn(label: Text('操作')),
            ],
            rows: [
              for (final unit in _units)
                DataRow(
                  selected: _selectedIds.contains(unit.id),
                  cells: [
                    DataCell(
                      Checkbox(
                        key: ValueKey('moutai-select-${unit.id}'),
                        value: _selectedIds.contains(unit.id),
                        onChanged: (checked) {
                          setState(() {
                            if (checked == true) {
                              _selectedIds.add(unit.id);
                            } else {
                              _selectedIds.remove(unit.id);
                            }
                          });
                        },
                      ),
                    ),
                    DataCell(Text(unit.moutaiName ?? '资料不完整')),
                    DataCell(Text(unit.logisticsCode ?? '-')),
                    DataCell(Text(unit.factoryDate ?? '-')),
                    DataCell(Text(unit.productionBatch ?? '-')),
                    DataCell(Text(unit.batchSerialNo ?? '-')),
                    DataCell(Text(_statusLabel(unit.status))),
                    DataCell(Text(unit.salesOrderNo ?? '-')),
                    DataCell(Text(unit.createdAt ?? '-')),
                    if (_canSeeCost)
                      DataCell(
                        Text(
                          unit.purchaseCostCents == null
                              ? '待补'
                              : formatMoneyCents(unit.purchaseCostCents!),
                        ),
                      ),
                    DataCell(
                      IconButton(
                        tooltip: unit.salesOrderId == null ? '编辑' : '资料纠错',
                        onPressed: () => _openEdit(unit),
                        icon: Icon(
                          unit.salesOrderId == null
                              ? Icons.edit_outlined
                              : Icons.rule_outlined,
                        ),
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MoutaiInboundDialog extends StatefulWidget {
  const _MoutaiInboundDialog({
    required this.api,
    required this.canEditCost,
  });

  final BusinessApi api;
  final bool canEditCost;

  @override
  State<_MoutaiInboundDialog> createState() => _MoutaiInboundDialogState();
}

class _MoutaiInboundDialogState extends State<_MoutaiInboundDialog> {
  final _name = TextEditingController(text: '飞天茅台');
  final _date = TextEditingController();
  final _batch = TextEditingController();
  final _cost = TextEditingController();
  final _rows = TextEditingController();
  List<ProductOptionRecord> _products = const [];
  String? _productId;
  bool _loadingProducts = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  @override
  void dispose() {
    _name.dispose();
    _date.dispose();
    _batch.dispose();
    _cost.dispose();
    _rows.dispose();
    super.dispose();
  }

  Future<void> _loadProducts() async {
    try {
      final products = (await widget.api.listProductOptions())
          .where((product) => product.usesSerializedInventory)
          .toList();
      if (!mounted) return;
      setState(() {
        _products = products;
        _productId = products.isEmpty ? null : products.first.id;
        _loadingProducts = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingProducts = false;
        _error = _message(error);
      });
    }
  }

  Future<void> _submit() async {
    if (_saving) return;
    final productId = _productId;
    if (productId == null) {
      setState(() => _error = '没有已启用逐瓶库存的茅台主商品。');
      return;
    }
    try {
      final units = _parseInboundRows(_rows.text, widget.canEditCost);
      final defaults = <String, dynamic>{
        'moutaiName': _name.text.trim(),
        'factoryDate': _date.text.trim(),
        'productionBatch': _batch.text.trim(),
      };
      if (widget.canEditCost && _cost.text.trim().isNotEmpty) {
        defaults['purchaseCostCents'] = _yuanToCents(_cost.text);
      }
      setState(() {
        _saving = true;
        _error = null;
      });
      await widget.api.createSerializedInventoryUnits({
        'productId': productId,
        'defaults': defaults,
        'units': units,
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = _message(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('茅台逐瓶入库'),
      content: SizedBox(
        width: 680,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_loadingProducts) const LinearProgressIndicator(),
              DropdownButtonFormField<String>(
                initialValue: _productId,
                decoration: const InputDecoration(labelText: '茅台主商品'),
                items: [
                  for (final product in _products)
                    DropdownMenuItem(
                      value: product.id,
                      child: Text(product.label),
                    ),
                ],
                onChanged: (value) => setState(() => _productId = value),
              ),
              TextField(
                controller: _name,
                decoration: const InputDecoration(labelText: '默认商品名称'),
              ),
              TextField(
                controller: _date,
                decoration:
                    const InputDecoration(labelText: '默认出厂日期 YYYY-MM-DD'),
              ),
              TextField(
                controller: _batch,
                decoration: const InputDecoration(labelText: '默认生产批次'),
              ),
              if (widget.canEditCost)
                TextField(
                  controller: _cost,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: '默认进货价（元）'),
                ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('moutai-inbound-rows'),
                controller: _rows,
                minLines: 6,
                maxLines: 14,
                decoration: InputDecoration(
                  labelText: '逐瓶资料（一行一瓶）',
                  alignLabelWithHint: true,
                  helperMaxLines: 4,
                  helperText: widget.canEditCost
                      ? '格式：物流码,批次序号[,商品名称覆盖[,进货价元覆盖]]；'
                          '扫码枪可连续录入，一行一个物流码。'
                      : '格式：物流码,批次序号[,商品名称覆盖]；'
                          '库管录入后状态为“待补进货价”。',
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, style: const TextStyle(color: Colors.red)),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: _saving ? null : _submit,
          child: Text(_saving ? '保存中…' : '确认入库'),
        ),
      ],
    );
  }
}

class _MoutaiEditDialog extends StatefulWidget {
  const _MoutaiEditDialog({
    required this.api,
    required this.unit,
    required this.canEditCost,
  });

  final BusinessApi api;
  final SerializedInventoryUnitRecord unit;
  final bool canEditCost;

  @override
  State<_MoutaiEditDialog> createState() => _MoutaiEditDialogState();
}

class _MoutaiEditDialogState extends State<_MoutaiEditDialog> {
  late final TextEditingController _name;
  late final TextEditingController _date;
  late final TextEditingController _batch;
  late final TextEditingController _serial;
  late final TextEditingController _code;
  late final TextEditingController _cost;
  final _reason = TextEditingController();
  bool _saving = false;
  String? _error;

  bool get _correction => widget.unit.salesOrderId != null;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.unit.moutaiName);
    _date = TextEditingController(text: widget.unit.factoryDate);
    _batch = TextEditingController(text: widget.unit.productionBatch);
    _serial = TextEditingController(text: widget.unit.batchSerialNo);
    _code = TextEditingController(text: widget.unit.logisticsCode);
    _cost = TextEditingController(
      text: widget.unit.purchaseCostCents == null
          ? ''
          : (widget.unit.purchaseCostCents! / 100).toStringAsFixed(2),
    );
  }

  @override
  void dispose() {
    _name.dispose();
    _date.dispose();
    _batch.dispose();
    _serial.dispose();
    _code.dispose();
    _cost.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_saving) return;
    final body = <String, dynamic>{
      'moutaiName': _name.text.trim(),
      'factoryDate': _date.text.trim(),
      'productionBatch': _batch.text.trim(),
      'batchSerialNo': _serial.text.trim(),
      'logisticsCode': _code.text.trim(),
    };
    if (widget.canEditCost && _cost.text.trim().isNotEmpty) {
      body['purchaseCostCents'] = _yuanToCents(_cost.text);
    }
    if (_correction) body['reason'] = _reason.text.trim();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      if (_correction) {
        await widget.api.correctSerializedInventoryUnit(widget.unit.id, body);
      } else {
        await widget.api.updateSerializedInventoryUnit(widget.unit.id, body);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = _message(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_correction ? '逐瓶资料纠错' : '编辑逐瓶资料'),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _name,
                decoration: const InputDecoration(labelText: '商品名称'),
              ),
              TextField(
                controller: _date,
                decoration: const InputDecoration(labelText: '出厂日期 YYYY-MM-DD'),
              ),
              TextField(
                controller: _batch,
                decoration: const InputDecoration(labelText: '生产批次'),
              ),
              TextField(
                controller: _serial,
                decoration: const InputDecoration(labelText: '批次序号'),
              ),
              TextField(
                controller: _code,
                decoration: const InputDecoration(labelText: '物流码'),
              ),
              if (widget.canEditCost)
                TextField(
                  controller: _cost,
                  decoration: const InputDecoration(labelText: '进货价（元）'),
                ),
              if (_correction)
                TextField(
                  controller: _reason,
                  decoration: const InputDecoration(labelText: '纠错原因（必填）'),
                ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, style: const TextStyle(color: Colors.red)),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: _saving ? null : _submit,
          child: Text(_saving ? '保存中…' : '保存'),
        ),
      ],
    );
  }
}

List<Map<String, dynamic>> _parseInboundRows(
  String text,
  bool canEditCost,
) {
  final result = <Map<String, dynamic>>[];
  final seenCodes = <String>{};
  final lines = text
      .split(RegExp(r'\r?\n'))
      .map((line) => line.trim())
      .where((line) => line.isNotEmpty);
  for (final line in lines) {
    final parts =
        line.split(RegExp(r'[,，\t]')).map((part) => part.trim()).toList();
    if (parts.length < 2 || parts[0].isEmpty || parts[1].isEmpty) {
      throw const FormatException('每行至少需要“物流码,批次序号”。');
    }
    final normalizedCode =
        parts[0].replaceAll(RegExp(r'\s+'), '').toUpperCase();
    if (!seenCodes.add(normalizedCode)) {
      throw FormatException('本次录入存在重复物流码：${parts[0]}');
    }
    final row = <String, dynamic>{
      'logisticsCode': parts[0],
      'batchSerialNo': parts[1],
    };
    if (parts.length > 2 && parts[2].isNotEmpty) {
      row['moutaiName'] = parts[2];
    }
    if (canEditCost && parts.length > 3 && parts[3].isNotEmpty) {
      row['purchaseCostCents'] = _yuanToCents(parts[3]);
    }
    result.add(row);
  }
  if (result.isEmpty) {
    throw const FormatException('请录入至少一瓶的物流码和批次序号。');
  }
  return result;
}

int _yuanToCents(String value) {
  final match = RegExp(r'^(\d+)(?:\.(\d{1,2}))?$').firstMatch(value.trim());
  if (match == null) {
    throw const FormatException('进货价格式不正确。');
  }
  final yuan = int.tryParse(match.group(1)!);
  final fraction = (match.group(2) ?? '').padRight(2, '0');
  if (yuan == null || yuan > 21474836) {
    throw const FormatException('进货价格式不正确。');
  }
  final cents = yuan * 100 + int.parse(fraction.isEmpty ? '0' : fraction);
  if (cents > 2147483647) {
    throw const FormatException('进货价格式不正确。');
  }
  return cents;
}

DateTime? _tryDate(String value) {
  final text = value.trim();
  if (text.isEmpty) return null;
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(text);
  if (match == null) {
    throw const FormatException('出厂日期筛选必须使用 YYYY-MM-DD。');
  }
  return DateTime(
    int.parse(match.group(1)!),
    int.parse(match.group(2)!),
    int.parse(match.group(3)!),
  );
}

String _statusLabel(String status) {
  return switch (status.toLowerCase()) {
    'pending_cost' => '待补进货价',
    'available' => '可售',
    'allocated' => '已占用',
    'void' => '作废',
    _ => status,
  };
}

String _safeFileName(String value) {
  final sanitized =
      value.replaceAll(RegExp(r'[<>:"/\\|?*\x00-\x1F]'), '_').trim();
  return sanitized.isEmpty ? '茅台物流单.docx' : sanitized;
}

String _message(Object error) {
  if (error is ApiException) {
    return switch (error.code) {
      'PERMISSION_DENIED' || 'FIELD_PERMISSION_DENIED' => '没有此操作权限。',
      'SERIALIZED_INVENTORY_DATA_INCOMPLETE' => '所选库存资料不完整，无法导出。',
      'MOUTAI_LOGISTICS_TEMPLATE_INVALID' ||
      'MOUTAI_LOGISTICS_TEMPLATE_MISSING' =>
        '物流单模板损坏或缺失，请联系管理员。',
      'LOGISTICS_CODE_DUPLICATE' => '物流码已存在或本次录入重复。',
      _ => error.message,
    };
  }
  if (error is FormatException) return error.message;
  if (error is FileSystemException) {
    return '文件保存失败，请检查保存位置和权限。';
  }
  return '操作失败，请稍后重试。';
}
