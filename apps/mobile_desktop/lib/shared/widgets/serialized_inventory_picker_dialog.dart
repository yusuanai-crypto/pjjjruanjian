import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';

class SerializedUnitSelection {
  const SerializedUnitSelection({
    required this.id,
    required this.moutaiName,
    required this.logisticsCode,
    required this.factoryDate,
    required this.productionBatch,
    required this.batchSerialNo,
  });

  final String id;
  final String moutaiName;
  final String logisticsCode;
  final String factoryDate;
  final String productionBatch;
  final String batchSerialNo;

  factory SerializedUnitSelection.fromInventory(
    SerializedInventoryUnitRecord unit,
  ) {
    return SerializedUnitSelection(
      id: unit.id,
      moutaiName: unit.moutaiName ?? '',
      logisticsCode: unit.logisticsCode ?? '',
      factoryDate: unit.factoryDate ?? '',
      productionBatch: unit.productionBatch ?? '',
      batchSerialNo: unit.batchSerialNo ?? '',
    );
  }

  factory SerializedUnitSelection.fromOrder(
    SalesOrderSerializedUnitRecord unit,
  ) {
    return SerializedUnitSelection(
      id: unit.id,
      moutaiName: unit.moutaiName ?? '',
      logisticsCode: unit.logisticsCode ?? '',
      factoryDate: unit.factoryDate ?? '',
      productionBatch: unit.productionBatch ?? '',
      batchSerialNo: unit.batchSerialNo ?? '',
    );
  }
}

class SerializedInventoryPickerDialog extends StatefulWidget {
  const SerializedInventoryPickerDialog({
    super.key,
    required this.businessApi,
    required this.productId,
    this.initialUnits = const [],
  });

  final BusinessApi businessApi;
  final String productId;
  final List<SerializedUnitSelection> initialUnits;

  @override
  State<SerializedInventoryPickerDialog> createState() =>
      _SerializedInventoryPickerDialogState();
}

class _SerializedInventoryPickerDialogState
    extends State<SerializedInventoryPickerDialog> {
  final _query = TextEditingController();
  final Map<String, SerializedUnitSelection> _selected = {};
  List<SerializedUnitSelection> _units = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final unit in widget.initialUnits) {
      _selected[unit.id] = unit;
    }
    _load();
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final available =
          await widget.businessApi.listAvailableSerializedInventory(
        productId: widget.productId,
        query: _query.text.trim(),
      );
      final merged = <String, SerializedUnitSelection>{
        for (final unit in widget.initialUnits) unit.id: unit,
        for (final unit in available)
          unit.id: SerializedUnitSelection.fromInventory(unit),
      };
      if (!mounted) return;
      setState(() {
        _units = merged.values.toList();
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error is ApiException ? error.message : '可售库存加载失败。';
      });
    }
  }

  String? get _selectedName {
    for (final unit in _selected.values) {
      final normalized = _normalizeName(unit.moutaiName);
      if (normalized.isNotEmpty) return normalized;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('选择物流码'),
      content: SizedBox(
        width: 760,
        height: 520,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('serialized-inventory-query'),
                    controller: _query,
                    decoration: const InputDecoration(
                      labelText: '搜索商品名称、物流码、批次或序号',
                    ),
                    onSubmitted: (_) => _load(),
                  ),
                ),
                const SizedBox(width: 10),
                OutlinedButton(onPressed: _load, child: const Text('查询')),
              ],
            ),
            const SizedBox(height: 10),
            Text('已选择 ${_selected.length} 瓶；同一明细只能选择相同商品名称。'),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 8),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _units.isEmpty
                      ? const Center(child: Text('暂无可售逐瓶库存。'))
                      : ListView.separated(
                          itemCount: _units.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (context, index) {
                            final unit = _units[index];
                            final selected = _selected.containsKey(unit.id);
                            final mismatched = !selected &&
                                _selectedName != null &&
                                _normalizeName(unit.moutaiName) !=
                                    _selectedName;
                            return CheckboxListTile(
                              key: ValueKey('serialized-unit-${unit.id}'),
                              value: selected,
                              onChanged: mismatched
                                  ? null
                                  : (checked) {
                                      setState(() {
                                        if (checked == true) {
                                          _selected[unit.id] = unit;
                                        } else {
                                          _selected.remove(unit.id);
                                        }
                                      });
                                    },
                              title: Text(
                                '${unit.moutaiName} · ${unit.logisticsCode}',
                              ),
                              subtitle: Text(
                                '出厂日期 ${unit.factoryDate}　'
                                '生产批次 ${unit.productionBatch}　'
                                '批次序号 ${unit.batchSerialNo}',
                              ),
                            );
                          },
                        ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton(
          key: const Key('serialized-inventory-confirm'),
          onPressed: _selected.isEmpty
              ? null
              : () => Navigator.of(context).pop(
                    _selected.values.toList(growable: false),
                  ),
          child: const Text('确认选择'),
        ),
      ],
    );
  }
}

String _normalizeName(String value) {
  return value.trim().replaceAll(RegExp(r'\s+'), '').toLowerCase();
}
