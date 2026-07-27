import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/inventory_api.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import '../../shared/widgets/money_text.dart';
import 'warehouse_management_page.dart' show inventoryErrorMessage, confirmInventoryAction, parseBottleQuantity, parseNonNegativeInt;

// ===========================================================================
// 商品库存
// ===========================================================================

class StockTab extends StatefulWidget {
  const StockTab({super.key, required this.api, required this.role});
  final InventoryApi api;
  final UserRole role;

  @override
  State<StockTab> createState() => _StockTabState();
}

class _StockTabState extends State<StockTab> {
  StockPage? _page;
  bool _loading = true;
  String? _error;
  final _searchController = TextEditingController();
  bool _shortageOnly = false;
  bool _lowStockOnly = false;
  int _page_ = 1;

  bool get _canReadCost => canReadInventoryCost(widget.role);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.listStocks(
        page: _page_,
        pageSize: 50,
        warehouse: _searchController.text.trim().isEmpty
            ? null
            : _searchController.text.trim(),
        product: null,
        hasShortage: _shortageOnly ? true : null,
        isLowStock: _lowStockOnly ? true : null,
      );
      if (!mounted) return;
      setState(() {
        _page = result;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = inventoryErrorMessage(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(title: '正在加载商品库存');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _page;
    if (page == null || page.stocks.isEmpty) {
      return EmptyState(
        title: '暂无库存数据',
        action: OutlinedButton.icon(
            onPressed: _load,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('刷新')),
      );
    }
    return Column(
      children: [
        _buildFilters(),
        const SizedBox(height: 8),
        Expanded(child: _buildList(page)),
        _buildPagination(page),
      ],
    );
  }

  Widget _buildFilters() {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        SizedBox(
          width: 200,
          child: TextField(
            key: const ValueKey('warehouse-stock-search'),
            controller: _searchController,
            decoration: const InputDecoration(
              labelText: '搜索仓库',
              isDense: true,
              border: OutlineInputBorder(),
            ),
            onSubmitted: (_) => _load(),
          ),
        ),
        FilterChip(
          key: const ValueKey('warehouse-stock-shortage-filter'),
          label: const Text('仅短缺'),
          selected: _shortageOnly,
          onSelected: (v) {
            setState(() {
              _shortageOnly = v;
              _page_ = 1;
            });
            _load();
          },
        ),
        FilterChip(
          key: const ValueKey('warehouse-stock-lowstock-filter'),
          label: const Text('仅低库存'),
          selected: _lowStockOnly,
          onSelected: (v) {
            setState(() {
              _lowStockOnly = v;
              _page_ = 1;
            });
            _load();
          },
        ),
        OutlinedButton.icon(
            onPressed: _load,
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('刷新')),
      ],
    );
  }

  Widget _buildList(StockPage page) {
    final desktop = isDesktopWidth(MediaQuery.of(context).size.width);
    if (desktop) {
      return _buildDesktopTable(page);
    }
    return ListView.separated(
      itemCount: page.stocks.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, i) => _StockCard(
          stock: page.stocks[i], canReadCost: _canReadCost),
    );
  }

  Widget _buildDesktopTable(StockPage page) {
    final stocks = page.stocks;
    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          key: const ValueKey('warehouse-stock-table'),
          columnSpacing: 20,
          columns: [
            const DataColumn(label: Text('仓库')),
            const DataColumn(label: Text('商品'), numeric: true),
            const DataColumn(label: Text('现存'), numeric: true),
            const DataColumn(label: Text('占用'), numeric: true),
            const DataColumn(label: Text('不可售'), numeric: true),
            const DataColumn(label: Text('在途'), numeric: true),
            const DataColumn(label: Text('可售'), numeric: true),
            const DataColumn(label: Text('短缺'), numeric: true),
            if (_canReadCost) const DataColumn(label: Text('库存成本'), numeric: true),
          ],
          rows: stocks.map((s) {
            return DataRow(
              key: ValueKey('warehouse-stock-row-${s.id}'),
              color: s.isNegative
                  ? WidgetStateProperty.all(Colors.red.shade50)
                  : (s.isLowStock
                      ? WidgetStateProperty.all(Colors.orange.shade50)
                      : null),
              cells: [
                DataCell(Text(s.warehouseName, style: const TextStyle(fontWeight: FontWeight.w600))),
                DataCell(Text('${s.productName} (${s.productUnit})')),
                DataCell(Text('${s.onHandQty}')),
                DataCell(Text('${s.reservedQty}')),
                DataCell(Text('${s.unavailableQty}')),
                DataCell(Text('${s.inTransitQty}')),
                DataCell(_availableCell(s)),
                DataCell(_shortageCell(s)),
                if (_canReadCost)
                  DataCell(s.inventoryCostAmountCents != null
                      ? MoneyText(cents: s.inventoryCostAmountCents!)
                      : const Text('—')),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _availableCell(StockRecord s) {
    if (s.isNegative) {
      return Text('${s.availableQty}',
          style: TextStyle(
              color: Colors.red.shade700, fontWeight: FontWeight.w700));
    }
    return Text('${s.availableQty}');
  }

  Widget _shortageCell(StockRecord s) {
    if (s.shortageQty > 0) {
      return Text('${s.shortageQty}',
          style: TextStyle(
              color: Colors.orange.shade700, fontWeight: FontWeight.w600));
    }
    return const Text('0');
  }

  Widget _buildPagination(StockPage page) {
    if (page.totalPages <= 1) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            key: const ValueKey('warehouse-stock-prev-page'),
            icon: const Icon(Icons.chevron_left_rounded),
            onPressed: _page_ > 1
                ? () {
                    setState(() => _page_--);
                    _load();
                  }
                : null,
          ),
          Text('第 $_page_ / ${page.totalPages} 页（共 ${page.total} 条）'),
          IconButton(
            key: const ValueKey('warehouse-stock-next-page'),
            icon: const Icon(Icons.chevron_right_rounded),
            onPressed: _page_ < page.totalPages
                ? () {
                    setState(() => _page_++);
                    _load();
                  }
                : null,
          ),
        ],
      ),
    );
  }
}

class _StockCard extends StatelessWidget {
  const _StockCard({required this.stock, required this.canReadCost});
  final StockRecord stock;
  final bool canReadCost;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text('${stock.warehouseName} · ${stock.productName}',
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
                if (stock.isNegative)
                  const StatusTag(label: '可售为负', tone: StatusTone.danger)
                else if (stock.isLowStock)
                  const StatusTag(label: '低库存', tone: StatusTone.warning),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 12,
              runSpacing: 4,
              children: [
                _kv('现存', '${stock.onHandQty}'),
                _kv('占用', '${stock.reservedQty}'),
                _kv('不可售', '${stock.unavailableQty}'),
                _kv('在途', '${stock.inTransitQty}'),
                _kv('可售', '${stock.availableQty}',
                    accent: stock.isNegative),
                _kv('短缺', '${stock.shortageQty}',
                    accent: stock.shortageQty > 0),
                if (canReadCost && stock.inventoryCostAmountCents != null)
                  _kv('成本', ''),
                if (canReadCost && stock.inventoryCostAmountCents != null)
                  MoneyText(cents: stock.inventoryCostAmountCents!),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _kv(String label, String value, {bool accent = false}) {
    return RichText(
      text: TextSpan(
        style: const TextStyle(fontSize: 13, color: Colors.black87),
        children: [
          TextSpan(text: '$label：', style: const TextStyle(color: Colors.grey)),
          TextSpan(
              text: value,
              style: TextStyle(
                  fontWeight: accent ? FontWeight.w700 : FontWeight.w400,
                  color: accent ? Colors.red.shade700 : Colors.black87)),
        ],
      ),
    );
  }
}

// ===========================================================================
// 入库管理
// ===========================================================================

class InboundTab extends StatefulWidget {
  const InboundTab({super.key, required this.api, required this.role});
  final InventoryApi api;
  final UserRole role;

  @override
  State<InboundTab> createState() => _InboundTabState();
}

class _InboundTabState extends State<InboundTab> {
  InboundDocumentPage? _page;
  bool _loading = true;
  String? _error;
  String? _typeFilter;
  int _page_ = 1;
  List<WarehouseRecord> _warehouses = const [];

  bool get _canWrite => canInboundWrite(widget.role);
  bool get _canReadCost => canReadInventoryCost(widget.role);
  bool get _canSetCostOnInbound =>
      widget.role == UserRole.superAdmin || widget.role == UserRole.admin;

  @override
  void initState() {
    super.initState();
    _load();
    _loadWarehouses();
  }

  Future<void> _loadWarehouses() async {
    try {
      final wh = await widget.api.listWarehouses(isActive: true);
      if (mounted) setState(() => _warehouses = wh);
    } catch (_) {}
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.listInbounds(
        page: _page_,
        pageSize: 50,
        type: _typeFilter,
      );
      if (!mounted) return;
      setState(() {
        _page = result;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = inventoryErrorMessage(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(title: '正在加载入库记录');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _page;
    if (page == null || page.inbounds.isEmpty) {
      return Column(
        children: [
          _buildFilters(),
          const SizedBox(height: 8),
          Expanded(
            child: EmptyState(
              title: '暂无入库记录',
              action: _canWrite
                  ? FilledButton.icon(
                      key: const ValueKey('warehouse-inbound-create-empty'),
                      onPressed: _showCreateDialog,
                      icon: const Icon(Icons.add_rounded),
                      label: const Text('新建入库'))
                  : null,
            ),
          ),
        ],
      );
    }
    return Column(
      children: [
        _buildFilters(),
        const SizedBox(height: 8),
        Expanded(child: _buildList(page)),
        if (_canWrite)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: FilledButton.icon(
              key: const ValueKey('warehouse-inbound-create-button'),
              onPressed: _showCreateDialog,
              icon: const Icon(Icons.add_rounded),
              label: const Text('新建入库')),
          ),
      ],
    );
  }

  Widget _buildFilters() {
    return Wrap(
      spacing: 8,
      children: [
        ChoiceChip(label: const Text('全部'), selected: _typeFilter == null, onSelected: (_) { setState(() { _typeFilter = null; _page_ = 1; }); _load(); }),
        ChoiceChip(label: const Text('期初'), selected: _typeFilter == 'OPENING', onSelected: (_) { setState(() { _typeFilter = 'OPENING'; _page_ = 1; }); _load(); }),
        ChoiceChip(label: const Text('采购入库'), selected: _typeFilter == 'PURCHASE_RECEIPT', onSelected: (_) { setState(() { _typeFilter = 'PURCHASE_RECEIPT'; _page_ = 1; }); _load(); }),
        ChoiceChip(label: const Text('其他入库'), selected: _typeFilter == 'OTHER_IN', onSelected: (_) { setState(() { _typeFilter = 'OTHER_IN'; _page_ = 1; }); _load(); }),
        OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh_rounded, size: 18), label: const Text('刷新')),
      ],
    );
  }

  Widget _buildList(InboundDocumentPage page) {
    return ListView.separated(
      itemCount: page.inbounds.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final doc = page.inbounds[i];
        return _InboundTile(
          doc: doc,
          canReverse: _canWrite && doc.status == 'POSTED',
          canReadCost: _canReadCost,
          onReverse: () => _confirmReverse(doc),
        );
      },
    );
  }

  Future<void> _confirmReverse(InboundDocumentRecord doc) async {
    final reasonController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('冲销入库单'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('将冲销 ${doc.typeLabel}：${doc.warehouseName}'),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('warehouse-inbound-reverse-reason'),
              controller: reasonController,
              decoration: const InputDecoration(
                labelText: '冲销原因（必填）',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () {
              if (reasonController.text.trim().isEmpty) return;
              Navigator.pop(ctx, true);
            },
            child: const Text('确认冲销')),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.api.reverseInbound(doc.id, reasonController.text.trim());
      _load();
    } catch (e) {
      if (mounted) {
        _showSnack(inventoryErrorMessage(e));
      }
    }
  }

  Future<void> _showCreateDialog() async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => _InboundCreateDialog(
        api: widget.api,
        warehouses: _warehouses,
        canSetCost: _canSetCostOnInbound,
        onCreated: () {
          Navigator.pop(ctx);
          _load();
        },
      ),
    );
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}

class _InboundTile extends StatelessWidget {
  const _InboundTile({
    required this.doc,
    required this.canReverse,
    required this.canReadCost,
    required this.onReverse,
  });
  final InboundDocumentRecord doc;
  final bool canReverse;
  final bool canReadCost;
  final VoidCallback onReverse;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      key: ValueKey('warehouse-inbound-tile-${doc.id}'),
      title: Row(
        children: [
          Text(doc.typeLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(width: 8),
          StatusTag(
            label: doc.status == 'POSTED' ? '已生效' : '已冲销',
            tone: doc.status == 'POSTED' ? StatusTone.success : StatusTone.neutral,
          ),
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${doc.warehouseName} · ${doc.lines.length} 行'),
          if (doc.batchSupplierName != null || doc.batchPurchaseOrderNo != null)
            Text([
              if (doc.batchSupplierName != null) '供应商：${doc.batchSupplierName}',
              if (doc.batchPurchaseOrderNo != null) '采购单号：${doc.batchPurchaseOrderNo}',
            ].join(' · ')),
          if (doc.batchCostStatus == 'PENDING' && canReadCost)
            const Text('成本待定', style: TextStyle(color: Colors.orange)),
        ],
      ),
      trailing: canReverse
          ? OutlinedButton(
              key: ValueKey('warehouse-inbound-reverse-${doc.id}'),
              onPressed: onReverse,
              child: const Text('冲销'))
          : null,
    );
  }
}

class _InboundCreateDialog extends StatefulWidget {
  const _InboundCreateDialog({
    required this.api,
    required this.warehouses,
    required this.canSetCost,
    required this.onCreated,
  });
  final InventoryApi api;
  final List<WarehouseRecord> warehouses;
  final bool canSetCost;
  final VoidCallback onCreated;

  @override
  State<_InboundCreateDialog> createState() => _InboundCreateDialogState();
}

class _InboundCreateDialogState extends State<_InboundCreateDialog> {
  final _formKey = GlobalKey<FormState>();
  String _kind = 'PURCHASE_RECEIPT';
  String? _warehouseId;
  final _supplierController = TextEditingController();
  final _purchaseOrderController = TextEditingController();
  final _productionBatchController = TextEditingController();
  final _sourceLineKeyController = TextEditingController();
  final _productIdController = TextEditingController();
  final _quantityController = TextEditingController();
  final _reasonController = TextEditingController();
  final _costController = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _supplierController.dispose();
    _purchaseOrderController.dispose();
    _productionBatchController.dispose();
    _sourceLineKeyController.dispose();
    _productIdController.dispose();
    _quantityController.dispose();
    _reasonController.dispose();
    _costController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final qty = parseBottleQuantity(_quantityController.text);
      if (qty == null) throw const ApiException(statusCode: 0, code: 'VALIDATION', message: '数量必须为正整数');
      int? costCents;
      if (widget.canSetCost && _costController.text.trim().isNotEmpty) {
        final yuan = double.tryParse(_costController.text.trim());
        if (yuan == null || yuan < 0) {
          throw const ApiException(statusCode: 0, code: 'VALIDATION', message: '成本金额格式错误');
        }
        costCents = (yuan * 100).round();
      }
      await widget.api.createInbound(
        kind: _kind,
        warehouseId: _warehouseId!,
        sourceLineKey: _sourceLineKeyController.text.trim(),
        lines: [
          {
            'productId': _productIdController.text.trim(),
            'quantity': qty,
          }
        ],
        supplierName: _supplierController.text.trim().isEmpty
            ? null
            : _supplierController.text.trim(),
        purchaseOrderNo: _purchaseOrderController.text.trim().isEmpty
            ? null
            : _purchaseOrderController.text.trim(),
        productionBatch: _productionBatchController.text.trim().isEmpty
            ? null
            : _productionBatchController.text.trim(),
        reason: _reasonController.text.trim().isEmpty
            ? null
            : _reasonController.text.trim(),
        purchaseUnitCostCents: costCents,
      );
      widget.onCreated();
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = inventoryErrorMessage(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      key: const ValueKey('warehouse-inbound-create-dialog'),
      title: const Text('新建入库'),
      content: SizedBox(
        width: 520,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  key: const ValueKey('warehouse-inbound-kind-field'),
                  initialValue: _kind,
                  decoration: const InputDecoration(labelText: '入库类型'),
                  items: const [
                    DropdownMenuItem(value: 'OPENING', child: Text('期初')),
                    DropdownMenuItem(value: 'PURCHASE_RECEIPT', child: Text('采购入库')),
                    DropdownMenuItem(value: 'OTHER_IN', child: Text('其他入库')),
                  ],
                  onChanged: (v) => setState(() => _kind = v ?? 'PURCHASE_RECEIPT'),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  key: const ValueKey('warehouse-inbound-warehouse-field'),
                  initialValue: _warehouseId,
                  decoration: const InputDecoration(labelText: '仓库'),
                  items: widget.warehouses
                      .map((w) => DropdownMenuItem(value: w.id, child: Text(w.name)))
                      .toList(),
                  onChanged: (v) => setState(() => _warehouseId = v),
                  validator: (v) => v == null ? '请选择仓库' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('warehouse-inbound-source-key-field'),
                  controller: _sourceLineKeyController,
                  decoration: const InputDecoration(labelText: '业务批次标识', hintText: '用于去重'),
                  validator: (v) => v == null || v.trim().isEmpty ? '请填写业务批次标识' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('warehouse-inbound-product-field'),
                  controller: _productIdController,
                  decoration: const InputDecoration(labelText: '商品ID'),
                  validator: (v) => v == null || v.trim().isEmpty ? '请填写商品ID' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('warehouse-inbound-quantity-field'),
                  controller: _quantityController,
                  decoration: const InputDecoration(labelText: '数量（瓶）'),
                  keyboardType: TextInputType.number,
                  validator: (v) {
                    final qty = parseBottleQuantity(v ?? '');
                    return qty == null ? '数量必须为正整数' : null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('warehouse-inbound-supplier-field'),
                  controller: _supplierController,
                  decoration: const InputDecoration(labelText: '供应商（选填）'),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('warehouse-inbound-po-field'),
                  controller: _purchaseOrderController,
                  decoration: const InputDecoration(labelText: '采购单号（选填，保留前导零）'),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('warehouse-inbound-batch-field'),
                  controller: _productionBatchController,
                  decoration: const InputDecoration(labelText: '生产批次（选填，保留前导零）'),
                ),
                if (widget.canSetCost) ...[
                  const SizedBox(height: 12),
                  TextFormField(
                    key: const ValueKey('warehouse-inbound-cost-field'),
                    controller: _costController,
                    decoration: const InputDecoration(labelText: '采购单价（元，选填）'),
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  ),
                ],
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('warehouse-inbound-reason-field'),
                  controller: _reasonController,
                  decoration: const InputDecoration(labelText: '备注（选填）'),
                  maxLines: 2,
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  StatusTag(label: _error!, tone: StatusTone.danger),
                ],
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: _saving ? null : () => Navigator.pop(context), child: const Text('取消')),
        FilledButton(
          key: const ValueKey('warehouse-inbound-save-button'),
          onPressed: _saving ? null : _save,
          child: Text(_saving ? '提交中...' : '提交')),
      ],
    );
  }
}

// ===========================================================================
// 调拨与在途
// ===========================================================================

class TransferTab extends StatefulWidget {
  const TransferTab({super.key, required this.api, required this.role});
  final InventoryApi api;
  final UserRole role;

  @override
  State<TransferTab> createState() => _TransferTabState();
}

class _TransferTabState extends State<TransferTab> {
  TransferPage? _page;
  bool _loading = true;
  String? _error;
  final int _page_ = 1;
  List<WarehouseRecord> _warehouses = const [];

  bool get _canWrite => canInboundWrite(widget.role);

  @override
  void initState() {
    super.initState();
    _load();
    _loadWarehouses();
  }

  Future<void> _loadWarehouses() async {
    try {
      final wh = await widget.api.listWarehouses(isActive: true);
      if (mounted) setState(() => _warehouses = wh);
    } catch (_) {}
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.listTransfers(page: _page_, pageSize: 50);
      if (!mounted) return;
      setState(() {
        _page = result;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = inventoryErrorMessage(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(title: '正在加载调拨记录');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _page;
    if (page == null || page.transfers.isEmpty) {
      return Column(
        children: [
          if (_canWrite)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: FilledButton.icon(
                key: const ValueKey('warehouse-transfer-create-empty'),
                onPressed: _showCreateDialog,
                icon: const Icon(Icons.add_rounded),
                label: const Text('新建调拨')),
            ),
          const Expanded(child: EmptyState(title: '暂无调拨记录')),
        ],
      );
    }
    return Column(
      children: [
        Row(
          children: [
            OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh_rounded, size: 18), label: const Text('刷新')),
            const Spacer(),
            if (_canWrite)
              FilledButton.icon(
                key: const ValueKey('warehouse-transfer-create-button'),
                onPressed: _showCreateDialog,
                icon: const Icon(Icons.add_rounded),
                label: const Text('新建调拨')),
          ],
        ),
        const SizedBox(height: 8),
        Expanded(
          child: ListView.separated(
            itemCount: page.transfers.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) => _TransferTile(
              transfer: page.transfers[i],
              canWrite: _canWrite,
              onConfirmOutbound: (t) => _confirmOutbound(t),
              onReceive: (t) => _showReceiveDialog(t),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _showCreateDialog() async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => _TransferCreateDialog(
        api: widget.api,
        warehouses: _warehouses,
        onCreated: () {
          Navigator.pop(ctx);
          _load();
        },
      ),
    );
  }

  Future<void> _confirmOutbound(TransferRecord t) async {
    final confirmed = await confirmInventoryAction(
      context,
      title: '确认调出',
      content: '将确认调拨 ${t.fromWarehouseName} → ${t.toWarehouseName} 的商品调出，确认继续？',
      confirmLabel: '确认调出',
      danger: true,
    );
    if (!confirmed) return;
    try {
      final lines = t.lines
          .map((l) => {'productId': l.productId, 'plannedQty': l.plannedQty})
          .toList();
      await widget.api.confirmTransferOutbound(
          transferId: t.id, lines: lines);
      _load();
    } catch (e) {
      if (mounted) _showSnack(inventoryErrorMessage(e));
    }
  }

  Future<void> _showReceiveDialog(TransferRecord t) async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => _TransferReceiveDialog(
        api: widget.api,
        transfer: t,
        onDone: () {
          Navigator.pop(ctx);
          _load();
        },
      ),
    );
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}

class _TransferTile extends StatelessWidget {
  const _TransferTile({
    required this.transfer,
    required this.canWrite,
    required this.onConfirmOutbound,
    required this.onReceive,
  });
  final TransferRecord transfer;
  final bool canWrite;
  final void Function(TransferRecord) onConfirmOutbound;
  final void Function(TransferRecord) onReceive;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      key: ValueKey('warehouse-transfer-tile-${transfer.id}'),
      title: Row(
        children: [
          Expanded(child: Text('${transfer.fromWarehouseName} → ${transfer.toWarehouseName}')),
          StatusTag(label: transfer.statusLabel, tone: _statusTone(transfer.status)),
        ],
      ),
      subtitle: Text('${transfer.lines.length} 行 · ${transfer.lines.map((l) => l.productName).join(', ')}'),
      trailing: canWrite
          ? Wrap(
              children: [
                if (transfer.status == 'DRAFT')
                  OutlinedButton(
                    key: ValueKey('warehouse-transfer-outbound-${transfer.id}'),
                    onPressed: () => onConfirmOutbound(transfer),
                    child: const Text('确认调出')),
                if (transfer.status == 'OUTBOUND' ||
                    transfer.status == 'PARTIALLY_RECEIVED')
                  FilledButton.tonal(
                    key: ValueKey('warehouse-transfer-receive-${transfer.id}'),
                    onPressed: () => onReceive(transfer),
                    child: const Text('确认调入')),
              ],
            )
          : null,
    );
  }

  StatusTone _statusTone(String s) {
    switch (s) {
      case 'RECEIVED':
        return StatusTone.success;
      case 'OUTBOUND':
      case 'PARTIALLY_RECEIVED':
        return StatusTone.warning;
      case 'CANCELLED':
      case 'REVERSED':
        return StatusTone.neutral;
      default:
        return StatusTone.info;
    }
  }
}

class _TransferCreateDialog extends StatefulWidget {
  const _TransferCreateDialog({
    required this.api,
    required this.warehouses,
    required this.onCreated,
  });
  final InventoryApi api;
  final List<WarehouseRecord> warehouses;
  final VoidCallback onCreated;

  @override
  State<_TransferCreateDialog> createState() => _TransferCreateDialogState();
}

class _TransferCreateDialogState extends State<_TransferCreateDialog> {
  final _formKey = GlobalKey<FormState>();
  String? _fromWarehouseId;
  String? _toWarehouseId;
  final _productIdController = TextEditingController();
  final _quantityController = TextEditingController();
  final _reasonController = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _productIdController.dispose();
    _quantityController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_fromWarehouseId == _toWarehouseId) {
      setState(() => _error = '调出和调入仓库不能相同');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final qty = parseBottleQuantity(_quantityController.text);
      if (qty == null) throw const ApiException(statusCode: 0, code: 'VALIDATION', message: '数量必须为正整数');
      await widget.api.createTransfer(
        fromWarehouseId: _fromWarehouseId!,
        toWarehouseId: _toWarehouseId!,
        lines: [
          {'productId': _productIdController.text.trim(), 'plannedQty': qty}
        ],
        reason: _reasonController.text.trim().isEmpty
            ? null
            : _reasonController.text.trim(),
      );
      widget.onCreated();
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = inventoryErrorMessage(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.warehouses
        .map((w) => DropdownMenuItem(value: w.id, child: Text(w.name)))
        .toList();
    return AlertDialog(
      key: const ValueKey('warehouse-transfer-create-dialog'),
      title: const Text('新建调拨'),
      content: SizedBox(
        width: 480,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  key: const ValueKey('warehouse-transfer-from-field'),
                  initialValue: _fromWarehouseId,
                  decoration: const InputDecoration(labelText: '调出仓库'),
                  items: items,
                  onChanged: (v) => setState(() => _fromWarehouseId = v),
                  validator: (v) => v == null ? '请选择调出仓库' : null,
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  key: const ValueKey('warehouse-transfer-to-field'),
                  initialValue: _toWarehouseId,
                  decoration: const InputDecoration(labelText: '调入仓库'),
                  items: items,
                  onChanged: (v) => setState(() => _toWarehouseId = v),
                  validator: (v) => v == null ? '请选择调入仓库' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('warehouse-transfer-product-field'),
                  controller: _productIdController,
                  decoration: const InputDecoration(labelText: '商品ID'),
                  validator: (v) => v == null || v.trim().isEmpty ? '请填写商品ID' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('warehouse-transfer-quantity-field'),
                  controller: _quantityController,
                  decoration: const InputDecoration(labelText: '数量（瓶）'),
                  keyboardType: TextInputType.number,
                  validator: (v) {
                    final qty = parseBottleQuantity(v ?? '');
                    return qty == null ? '数量必须为正整数' : null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('warehouse-transfer-reason-field'),
                  controller: _reasonController,
                  decoration: const InputDecoration(labelText: '备注（选填）'),
                  maxLines: 2,
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  StatusTag(label: _error!, tone: StatusTone.danger),
                ],
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: _saving ? null : () => Navigator.pop(context), child: const Text('取消')),
        FilledButton(
          key: const ValueKey('warehouse-transfer-save-button'),
          onPressed: _saving ? null : _save,
          child: Text(_saving ? '提交中...' : '提交')),
      ],
    );
  }
}

class _TransferReceiveDialog extends StatefulWidget {
  const _TransferReceiveDialog({
    required this.api,
    required this.transfer,
    required this.onDone,
  });
  final InventoryApi api;
  final TransferRecord transfer;
  final VoidCallback onDone;

  @override
  State<_TransferReceiveDialog> createState() => _TransferReceiveDialogState();
}

class _TransferReceiveDialogState extends State<_TransferReceiveDialog> {
  final _formKey = GlobalKey<FormState>();
  final _receiveQtyController = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _receiveQtyController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: '确认调入',
      content: '将确认调入商品到 ${widget.transfer.toWarehouseName}，确认继续？',
      confirmLabel: '确认调入',
    );
    if (!confirmed) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final qty = parseBottleQuantity(_receiveQtyController.text);
      if (qty == null) throw const ApiException(statusCode: 0, code: 'VALIDATION', message: '数量必须为正整数');
      final firstLine = widget.transfer.lines.first;
      await widget.api.receiveTransfer(
        transferId: widget.transfer.id,
        warehouseId: widget.transfer.lines.isNotEmpty
            ? firstLine.productId
            : '',
        lines: [
          {
            'transferLineId': widget.transfer.id,
            'receivedQty': qty,
          }
        ],
      );
      widget.onDone();
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = inventoryErrorMessage(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      key: const ValueKey('warehouse-transfer-receive-dialog'),
      title: const Text('确认调入'),
      content: SizedBox(
        width: 400,
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('调入到：${widget.transfer.toWarehouseName}'),
              const SizedBox(height: 12),
              TextFormField(
                key: const ValueKey('warehouse-transfer-receive-qty-field'),
                controller: _receiveQtyController,
                decoration: const InputDecoration(labelText: '实收数量（瓶）'),
                keyboardType: TextInputType.number,
                validator: (v) {
                  final qty = parseBottleQuantity(v ?? '');
                  return qty == null ? '数量必须为正整数' : null;
                },
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                StatusTag(label: _error!, tone: StatusTone.danger),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: _saving ? null : () => Navigator.pop(context), child: const Text('取消')),
        FilledButton(
          key: const ValueKey('warehouse-transfer-receive-save-button'),
          onPressed: _saving ? null : _save,
          child: Text(_saving ? '提交中...' : '确认调入')),
      ],
    );
  }
}

// ===========================================================================
// 不可售管理
// ===========================================================================

class UnavailableTab extends StatefulWidget {
  const UnavailableTab({super.key, required this.api, required this.role});
  final InventoryApi api;
  final UserRole role;

  @override
  State<UnavailableTab> createState() => _UnavailableTabState();
}

class _UnavailableTabState extends State<UnavailableTab> {
  StockPage? _unavailableStocks;
  bool _loading = true;
  String? _error;

  bool get _canWrite => canInboundWrite(widget.role);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.listStocks(
        pageSize: 100,
        hasUnavailable: true,
      );
      if (!mounted) return;
      setState(() {
        _unavailableStocks = result;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = inventoryErrorMessage(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(title: '正在加载不可售库存');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _unavailableStocks;
    if (page == null || page.stocks.isEmpty) {
      return EmptyState(
        title: '暂无不可售库存',
        action: OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh_rounded), label: const Text('刷新')),
      );
    }
    return Column(
      children: [
        Row(
          children: [
            OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh_rounded, size: 18), label: const Text('刷新')),
          ],
        ),
        const SizedBox(height: 8),
        Expanded(
          child: ListView.separated(
            itemCount: page.stocks.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final s = page.stocks[i];
              return ListTile(
                key: ValueKey('warehouse-unavailable-tile-${s.id}'),
                title: Text('${s.warehouseName} · ${s.productName}'),
                subtitle: Text('不可售：${s.unavailableQty} 瓶'),
                trailing: _canWrite
                    ? Wrap(
                        children: [
                          OutlinedButton(
                            key: ValueKey('warehouse-unavailable-mark-${s.id}'),
                            onPressed: () => _showMarkDialog(s),
                            child: const Text('标记')),
                          TextButton(
                            key: ValueKey('warehouse-unavailable-restore-${s.id}'),
                            onPressed: s.unavailableQty > 0
                                ? () => _showRestoreDialog(s)
                                : null,
                            child: const Text('恢复')),
                        ],
                      )
                    : null,
              );
            },
          ),
        ),
      ],
    );
  }

  Future<void> _showMarkDialog(StockRecord s) async {
    final qtyController = TextEditingController();
    final reasonController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('标记不可售'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('${s.warehouseName} · ${s.productName}'),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('warehouse-unavailable-mark-qty'),
              controller: qtyController,
              decoration: const InputDecoration(labelText: '数量（瓶）', border: OutlineInputBorder()),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('warehouse-unavailable-mark-reason'),
              controller: reasonController,
              decoration: const InputDecoration(labelText: '原因（必填）', border: OutlineInputBorder()),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('确认标记')),
        ],
      ),
    );
    if (confirmed != true) return;
    final qty = parseBottleQuantity(qtyController.text);
    if (qty == null || reasonController.text.trim().isEmpty) {
      if (mounted) _showSnack('数量必须为正整数且原因不能为空');
      return;
    }
    try {
      await widget.api.markUnavailable(
        warehouseId: s.warehouseId,
        productId: s.productId,
        quantity: qty,
        reason: reasonController.text.trim(),
      );
      _load();
    } catch (e) {
      if (mounted) _showSnack(inventoryErrorMessage(e));
    }
  }

  Future<void> _showRestoreDialog(StockRecord s) async {
    final qtyController = TextEditingController();
    final reasonController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('恢复可售'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('${s.warehouseName} · ${s.productName}（当前不可售 ${s.unavailableQty} 瓶）'),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('warehouse-unavailable-restore-qty'),
              controller: qtyController,
              decoration: const InputDecoration(labelText: '恢复数量（瓶）', border: OutlineInputBorder()),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('warehouse-unavailable-restore-reason'),
              controller: reasonController,
              decoration: const InputDecoration(labelText: '原因（必填）', border: OutlineInputBorder()),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('确认恢复')),
        ],
      ),
    );
    if (confirmed != true) return;
    final qty = parseBottleQuantity(qtyController.text);
    if (qty == null || reasonController.text.trim().isEmpty) {
      if (mounted) _showSnack('数量必须为正整数且原因不能为空');
      return;
    }
    try {
      await widget.api.restoreAvailable(
        warehouseId: s.warehouseId,
        productId: s.productId,
        quantity: qty,
        reason: reasonController.text.trim(),
      );
      _load();
    } catch (e) {
      if (mounted) _showSnack(inventoryErrorMessage(e));
    }
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}

// ===========================================================================
// 商品盘点
// ===========================================================================

class StocktakeTab extends StatefulWidget {
  const StocktakeTab({super.key, required this.api, required this.role});
  final InventoryApi api;
  final UserRole role;

  @override
  State<StocktakeTab> createState() => _StocktakeTabState();
}

class _StocktakeTabState extends State<StocktakeTab> {
  StocktakePage? _page;
  bool _loading = true;
  String? _error;
  final int _page_ = 1;
  List<WarehouseRecord> _warehouses = const [];

  bool get _canWrite => canStocktakeWrite(widget.role);

  @override
  void initState() {
    super.initState();
    _load();
    _loadWarehouses();
  }

  Future<void> _loadWarehouses() async {
    try {
      final wh = await widget.api.listWarehouses(isActive: true);
      if (mounted) setState(() => _warehouses = wh);
    } catch (_) {}
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.listStocktakes(page: _page_, pageSize: 50);
      if (!mounted) return;
      setState(() {
        _page = result;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = inventoryErrorMessage(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(title: '正在加载盘点记录');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _page;
    if (page == null || page.stocktakes.isEmpty) {
      return const EmptyState(title: '暂无盘点记录');
    }
    return Column(
      children: [
        Row(
          children: [
            OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh_rounded, size: 18), label: const Text('刷新')),
          ],
        ),
        const SizedBox(height: 8),
        Expanded(
          child: ListView.separated(
            itemCount: page.stocktakes.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final s = page.stocktakes[i];
              return ListTile(
                key: ValueKey('warehouse-stocktake-tile-${s.id}'),
                title: Row(
                  children: [
                    Expanded(child: Text('${s.warehouseName} · ${s.productName}')),
                    StatusTag(label: s.statusLabel, tone: _tone(s.status)),
                  ],
                ),
                subtitle: Text([
                  '系统：${s.systemOnHandQty}',
                  if (s.countedOnHandQty != null) '盘点：${s.countedOnHandQty}',
                  if (s.varianceQty != null) '差异：${s.varianceQty}',
                ].join(' · ')),
                trailing: _canWrite && s.status == 'DRAFT'
                    ? OutlinedButton(
                        key: ValueKey('warehouse-stocktake-submit-${s.id}'),
                        onPressed: () => _showSubmitDialog(s),
                        child: const Text('提交盘点'))
                    : null,
              );
            },
          ),
        ),
        if (_canWrite)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: FilledButton.icon(
              key: const ValueKey('warehouse-stocktake-create-button'),
              onPressed: _showCreateDialog,
              icon: const Icon(Icons.add_rounded),
              label: const Text('新建盘点')),
          ),
      ],
    );
  }

  StatusTone _tone(String s) {
    switch (s) {
      case 'POSTED':
        return StatusTone.success;
      case 'SUBMITTED':
        return StatusTone.warning;
      case 'REJECTED':
      case 'REVERSED':
        return StatusTone.neutral;
      default:
        return StatusTone.info;
    }
  }

  Future<void> _showCreateDialog() async {
    final productIdController = TextEditingController();
    String? warehouseId;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          title: const Text('新建盘点'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: warehouseId,
                decoration: const InputDecoration(labelText: '仓库'),
                items: _warehouses.map((w) => DropdownMenuItem(value: w.id, child: Text(w.name))).toList(),
                onChanged: (v) => setS(() => warehouseId = v),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const ValueKey('warehouse-stocktake-create-product'),
                controller: productIdController,
                decoration: const InputDecoration(labelText: '商品ID', border: OutlineInputBorder()),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
            FilledButton(
              key: const ValueKey('warehouse-stocktake-create-confirm'),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('创建')),
          ],
        ),
      ),
    );
    if (confirmed != true || warehouseId == null) return;
    try {
      await widget.api.createStocktake(
        warehouseId: warehouseId!,
        productId: productIdController.text.trim(),
      );
      _load();
    } catch (e) {
      if (mounted) _showSnack(inventoryErrorMessage(e));
    }
  }

  Future<void> _showSubmitDialog(StocktakeRecord s) async {
    final qtyController = TextEditingController();
    final reasonController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('提交盘点'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('${s.warehouseName} · ${s.productName}（系统 ${s.systemOnHandQty} 瓶）'),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('warehouse-stocktake-submit-qty'),
              controller: qtyController,
              decoration: const InputDecoration(labelText: '盘点数量（瓶，≥0）', border: OutlineInputBorder()),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('warehouse-stocktake-submit-reason'),
              controller: reasonController,
              decoration: const InputDecoration(labelText: '备注（选填）', border: OutlineInputBorder()),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('确认提交')),
        ],
      ),
    );
    if (confirmed != true) return;
    final qty = parseNonNegativeInt(qtyController.text);
    if (qty == null) {
      if (mounted) _showSnack('数量必须为非负整数');
      return;
    }
    try {
      await widget.api.submitStocktake(
        id: s.id,
        countedOnHandQty: qty,
        reason: reasonController.text.trim().isEmpty ? null : reasonController.text.trim(),
      );
      _load();
    } catch (e) {
      if (mounted) _showSnack(inventoryErrorMessage(e));
    }
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}

// ===========================================================================
// 盘点审批
// ===========================================================================

class StocktakeApprovalTab extends StatefulWidget {
  const StocktakeApprovalTab({super.key, required this.api, required this.role});
  final InventoryApi api;
  final UserRole role;

  @override
  State<StocktakeApprovalTab> createState() => _StocktakeApprovalTabState();
}

class _StocktakeApprovalTabState extends State<StocktakeApprovalTab> {
  StocktakePage? _page;
  bool _loading = true;
  String? _error;

  bool get _canApprove => canStocktakeApprove(widget.role);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.listStocktakes(status: 'SUBMITTED', pageSize: 50);
      if (!mounted) return;
      setState(() {
        _page = result;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = inventoryErrorMessage(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_canApprove) {
      return const Center(child: Text('当前角色无盘点审批权限。'));
    }
    if (_loading) return const LoadingState(title: '正在加载待审批盘点');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _page;
    if (page == null || page.stocktakes.isEmpty) {
      return const EmptyState(title: '暂无待审批盘点');
    }
    return Column(
      children: [
        Row(
          children: [
            OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh_rounded, size: 18), label: const Text('刷新')),
            const Spacer(),
            StatusTag(label: '待审 ${page.total} 条', tone: StatusTone.warning),
          ],
        ),
        const SizedBox(height: 8),
        Expanded(
          child: ListView.separated(
            itemCount: page.stocktakes.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final s = page.stocktakes[i];
              return ListTile(
                key: ValueKey('warehouse-approval-tile-${s.id}'),
                title: Text('${s.warehouseName} · ${s.productName}'),
                subtitle: Text([
                  '系统：${s.systemOnHandQty}',
                  if (s.countedOnHandQty != null) '盘点：${s.countedOnHandQty}',
                  if (s.varianceQty != null) '差异：${s.varianceQty}',
                ].join(' · ')),
                trailing: Wrap(
                  children: [
                    FilledButton(
                      key: ValueKey('warehouse-approval-approve-${s.id}'),
                      onPressed: () => _approve(s),
                      child: const Text('批准')),
                    OutlinedButton(
                      key: ValueKey('warehouse-approval-reject-${s.id}'),
                      onPressed: () => _reject(s),
                      child: const Text('驳回')),
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Future<void> _approve(StocktakeRecord s) async {
    final confirmed = await confirmInventoryAction(
      context,
      title: '批准盘点',
      content: '将批准 ${s.warehouseName} · ${s.productName} 的盘点，差异 ${s.varianceQty ?? 0} 瓶将过账。确认继续？',
      confirmLabel: '确认批准',
    );
    if (!confirmed) return;
    try {
      await widget.api.approveStocktake(s.id);
      _load();
    } catch (e) {
      if (mounted) _showSnack(inventoryErrorMessage(e));
    }
  }

  Future<void> _reject(StocktakeRecord s) async {
    final reasonController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('驳回盘点'),
        content: TextField(
          key: const ValueKey('warehouse-approval-reject-reason'),
          controller: reasonController,
          decoration: const InputDecoration(labelText: '驳回原因（必填）', border: OutlineInputBorder()),
          maxLines: 2,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () {
              if (reasonController.text.trim().isEmpty) return;
              Navigator.pop(ctx, true);
            },
            child: const Text('确认驳回')),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.api.rejectStocktake(id: s.id, reason: reasonController.text.trim());
      _load();
    } catch (e) {
      if (mounted) _showSnack(inventoryErrorMessage(e));
    }
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}

// ===========================================================================
// 库存预警
// ===========================================================================

class AlertTab extends StatefulWidget {
  const AlertTab({super.key, required this.api, required this.role});
  final InventoryApi api;
  final UserRole role;

  @override
  State<AlertTab> createState() => _AlertTabState();
}

class _AlertTabState extends State<AlertTab> {
  AlertConfigPage? _page;
  bool _loading = true;
  String? _error;
  final int _page_ = 1;

  bool get _canManage => canManageWarehouse(widget.role);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.listAlertConfigs(page: _page_, pageSize: 50);
      if (!mounted) return;
      setState(() {
        _page = result;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = inventoryErrorMessage(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(title: '正在加载预警配置');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _page;
    if (page == null || page.configs.isEmpty) {
      return const EmptyState(title: '暂无预警配置');
    }
    return Column(
      children: [
        Row(
          children: [
            OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh_rounded, size: 18), label: const Text('刷新')),
          ],
        ),
        const SizedBox(height: 8),
        Expanded(
          child: ListView.separated(
            itemCount: page.configs.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final c = page.configs[i];
              return ListTile(
                key: ValueKey('warehouse-alert-tile-${c.id}'),
                title: Text('${c.warehouseName} · ${c.productName}'),
                subtitle: Text('最低可售：${c.minimumAvailableQty} 瓶'),
                trailing: _canManage
                    ? Switch(
                        key: ValueKey('warehouse-alert-toggle-${c.id}'),
                        value: c.enabled,
                        onChanged: (v) => _toggle(c, v),
                      )
                    : StatusTag(
                        label: c.enabled ? '已启用' : '已停用',
                        tone: c.enabled ? StatusTone.success : StatusTone.neutral),
              );
            },
          ),
        ),
      ],
    );
  }

  Future<void> _toggle(AlertConfigRecord c, bool enabled) async {
    try {
      await widget.api.updateAlertConfig(
        warehouseId: c.id,
        productId: c.id,
        enabled: enabled,
      );
      _load();
    } catch (e) {
      if (mounted) _showSnack(inventoryErrorMessage(e));
    }
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}

// ===========================================================================
// 出入库流水
// ===========================================================================

class MovementTab extends StatefulWidget {
  const MovementTab({super.key, required this.api, required this.role});
  final InventoryApi api;
  final UserRole role;

  @override
  State<MovementTab> createState() => _MovementTabState();
}

class _MovementTabState extends State<MovementTab> {
  MovementPage? _page;
  bool _loading = true;
  String? _error;
  int _page_ = 1;
  String? _typeFilter;

  bool get _canReadCost => canReadInventoryCost(widget.role);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.listMovements(
        page: _page_,
        pageSize: 50,
        movementType: _typeFilter,
      );
      if (!mounted) return;
      setState(() {
        _page = result;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = inventoryErrorMessage(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(title: '正在加载出入库流水');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _page;
    if (page == null || page.movements.isEmpty) {
      return const EmptyState(title: '暂无流水记录');
    }
    return Column(
      children: [
        Wrap(
          spacing: 8,
          children: [
            ChoiceChip(label: const Text('全部'), selected: _typeFilter == null, onSelected: (_) { setState(() { _typeFilter = null; _page_ = 1; }); _load(); }),
            ChoiceChip(label: const Text('入库'), selected: _typeFilter == 'PURCHASE_IN', onSelected: (_) { setState(() { _typeFilter = 'PURCHASE_IN'; _page_ = 1; }); _load(); }),
            ChoiceChip(label: const Text('出库'), selected: _typeFilter == 'SALES_OUT', onSelected: (_) { setState(() { _typeFilter = 'SALES_OUT'; _page_ = 1; }); _load(); }),
            ChoiceChip(label: const Text('调拨'), selected: _typeFilter == 'TRANSFER_OUT', onSelected: (_) { setState(() { _typeFilter = 'TRANSFER_OUT'; _page_ = 1; }); _load(); }),
            OutlinedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh_rounded, size: 18), label: const Text('刷新')),
          ],
        ),
        const SizedBox(height: 8),
        Expanded(
          child: ListView.separated(
            itemCount: page.movements.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final m = page.movements[i];
              return ListTile(
                key: ValueKey('warehouse-movement-tile-${m.id}'),
                title: Row(
                  children: [
                    StatusTag(label: m.movementTypeLabel, tone: m.quantity >= 0 ? StatusTone.success : StatusTone.warning),
                    const SizedBox(width: 8),
                    Expanded(child: Text('${m.warehouseName} · ${m.productName}')),
                  ],
                ),
                subtitle: Text('${m.quantity >= 0 ? '+' : ''}${m.quantity} 瓶${m.businessAt != null ? ' · ${m.businessAt}' : ''}'),
                trailing: _canReadCost && m.inventoryAmountCents != null
                    ? MoneyText(cents: m.inventoryAmountCents!)
                    : null,
              );
            },
          ),
        ),
      ],
    );
  }
}

// ===========================================================================
// 库存报表
// ===========================================================================

class ReportTab extends StatefulWidget {
  const ReportTab({super.key, required this.api, required this.role});
  final InventoryApi api;
  final UserRole role;

  @override
  State<ReportTab> createState() => _ReportTabState();
}

class _ReportTabState extends State<ReportTab> {
  String _selectedReport = 'warehouse-balances';
  ReportResult? _result;
  bool _loading = false;
  String? _error;

  bool get _canReadCost => canReadInventoryCost(widget.role);

  List<String> get _availableReports {
    if (!_canReadCost) {
      // warehouse 不可查看 inventory-valuation 报表
      return InventoryApi.reportTypes.where((t) => t != 'inventory-valuation').toList();
    }
    return InventoryApi.reportTypes;
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.fetchReport(reportType: _selectedReport, pageSize: 50);
      if (!mounted) return;
      setState(() {
        _result = result;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = inventoryErrorMessage(e);
        _loading = false;
      });
    }
  }

  Future<void> _export() async {
    try {
      final file = await widget.api.exportReport(reportType: _selectedReport);
      if (mounted) {
        _showSnack('报表已下载：${file.fileName}');
      }
    } catch (e) {
      if (mounted) _showSnack(inventoryErrorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Wrap(
          spacing: 8,
          children: [
            DropdownButton<String>(
              key: const ValueKey('warehouse-report-type-selector'),
              value: _selectedReport,
              items: _availableReports
                  .map((t) => DropdownMenuItem(value: t, child: Text(InventoryApi.reportLabel(t))))
                  .toList(),
              onChanged: (v) {
                if (v == null) return;
                setState(() => _selectedReport = v);
                _load();
              },
            ),
            OutlinedButton.icon(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh_rounded, size: 18), label: const Text('刷新')),
            FilledButton.tonalIcon(
              key: const ValueKey('warehouse-report-export-button'),
              onPressed: _loading ? null : _export,
              icon: const Icon(Icons.download_rounded, size: 18),
              label: const Text('导出 Excel')),
          ],
        ),
        const SizedBox(height: 8),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _buildBody() {
    if (_loading) return const LoadingState(title: '正在加载报表');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final result = _result;
    if (result == null || result.rows.isEmpty) {
      return const EmptyState(title: '暂无报表数据');
    }
    final desktop = isDesktopWidth(MediaQuery.of(context).size.width);
    if (desktop) {
      return _buildDesktopReport(result);
    }
    return _buildMobileReport(result);
  }

  Widget _buildDesktopReport(ReportResult r) {
    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          key: ValueKey('warehouse-report-table-${r.reportType}'),
          columns: r.columns
              .map((c) => DataColumn(label: Text(c.label)))
              .toList(),
          rows: r.rows.map((row) {
            return DataRow(
              cells: r.columns.map((c) {
                final value = row[c.key];
                return DataCell(Text('$value'));
              }).toList(),
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildMobileReport(ReportResult r) {
    return ListView.separated(
      itemCount: r.rows.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final row = r.rows[i];
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: r.columns.map((c) {
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      Text('${c.label}：', style: const TextStyle(color: Colors.grey, fontSize: 13)),
                      Expanded(child: Text('${row[c.key] ?? '—'}', style: const TextStyle(fontSize: 13))),
                    ],
                  ),
                );
              }).toList(),
            ),
          ),
        );
      },
    );
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}
