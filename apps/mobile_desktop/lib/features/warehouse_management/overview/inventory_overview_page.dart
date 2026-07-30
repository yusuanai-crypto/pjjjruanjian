import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../../core/auth/role_access.dart';
import '../../../core/business/inventory_api.dart';
import '../../../shared/widgets/form_section.dart';
import '../../../shared/widgets/metric_card.dart';
import '../../../shared/widgets/state_views.dart';
import '../../../shared/widgets/status_tag.dart';
import '../shared/inventory_workspace_shared.dart';

class WarehouseOverviewNavigationRequest {
  const WarehouseOverviewNavigationRequest(
    this.moduleId, {
    this.filter,
    this.action,
  });

  final String moduleId;
  final String? filter;
  final String? action;
}

class InventoryOverviewPage extends StatefulWidget {
  const InventoryOverviewPage({
    super.key,
    required this.api,
    required this.role,
    required this.onNavigate,
  });

  final InventoryApi api;
  final UserRole role;
  final ValueChanged<WarehouseOverviewNavigationRequest> onNavigate;

  @override
  State<InventoryOverviewPage> createState() => _InventoryOverviewPageState();
}

class _InventoryOverviewPageState extends State<InventoryOverviewPage> {
  static const _unsupportedMessage = '后端暂未提供可靠聚合字段';

  List<WarehouseRecord> _warehouses = const [];
  String? _selectedWarehouseId;
  bool _warehouseLoading = true;
  String? _warehouseError;
  int _loadRevision = 0;

  final Map<String, _OverviewValue> _values = {
    'warehouses': const _OverviewValue.loading(),
    'stockItems': const _OverviewValue.loading(),
    'onHand': const _OverviewValue.unavailable(_unsupportedMessage),
    'reserved': const _OverviewValue.unavailable(_unsupportedMessage),
    'unavailable': const _OverviewValue.unavailable(_unsupportedMessage),
    'shortage': const _OverviewValue.loading(),
    'alerts': const _OverviewValue.unavailable('后端暂未提供活跃预警查询接口'),
    'stocktakes': const _OverviewValue.loading(),
    'transfers': const _OverviewValue.loading(),
    'lowStock': const _OverviewValue.loading(),
    'fulfillment': const _OverviewValue.unavailable('后端暂未提供待配货聚合字段'),
    'pendingCost': const _OverviewValue.unavailable('后端暂未提供待补成本聚合字段'),
    'overdueTransfer': const _OverviewValue.unavailable('后端暂未提供调拨超时聚合字段'),
  };

  bool _movementsLoading = true;
  String? _movementsError;
  List<MovementRecord> _movements = const [];

  @override
  void initState() {
    super.initState();
    _loadWarehouses();
    _reloadScopedSections();
  }

  Future<void> _loadWarehouses() async {
    setState(() {
      _warehouseLoading = true;
      _warehouseError = null;
      _values['warehouses'] = const _OverviewValue.loading();
    });
    try {
      final pages = await Future.wait([
        widget.api.listWarehousePage(pageSize: 100),
        widget.api.listWarehousePage(isActive: true, pageSize: 1),
      ]);
      final firstPage = pages[0];
      final activePage = pages[1];
      final warehouses = <WarehouseRecord>[...firstPage.warehouses];
      for (var page = 2; page <= firstPage.totalPages; page++) {
        final next = await widget.api.listWarehousePage(
          page: page,
          pageSize: 100,
        );
        warehouses.addAll(next.warehouses);
      }
      if (!mounted) return;
      setState(() {
        _warehouses = warehouses;
        _warehouseLoading = false;
        _values['warehouses'] = _OverviewValue.ready(activePage.total);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _warehouseLoading = false;
        _warehouseError = inventoryErrorMessage(error);
        _values['warehouses'] =
            _OverviewValue.failed(inventoryErrorMessage(error));
      });
    }
  }

  void _reloadScopedSections() {
    final revision = ++_loadRevision;
    final warehouseId = _selectedWarehouseId;
    _loadCount(
      'stockItems',
      widget.api
          .listStocks(pageSize: 1, warehouseId: warehouseId)
          .then((page) => page.total),
      revision,
    );
    _loadCount(
      'shortage',
      widget.api
          .listStocks(
            pageSize: 1,
            warehouseId: warehouseId,
            hasShortage: true,
          )
          .then((page) => page.total),
      revision,
    );
    _loadCount(
      'lowStock',
      widget.api
          .listStocks(
            pageSize: 1,
            warehouseId: warehouseId,
            isLowStock: true,
          )
          .then((page) => page.total),
      revision,
    );
    _loadCount(
      'stocktakes',
      widget.api
          .listStocktakes(
            pageSize: 1,
            warehouseId: warehouseId,
            status: 'SUBMITTED',
          )
          .then((page) => page.total),
      revision,
    );
    _loadInTransitCount(warehouseId, revision);
    _loadMovements(warehouseId, revision);
  }

  Future<void> _loadCount(
    String key,
    Future<int> request,
    int revision,
  ) async {
    setState(() => _values[key] = const _OverviewValue.loading());
    try {
      final value = await request;
      if (!mounted || revision != _loadRevision) return;
      setState(() => _values[key] = _OverviewValue.ready(value));
    } catch (error) {
      if (!mounted || revision != _loadRevision) return;
      setState(() {
        _values[key] = _OverviewValue.failed(inventoryErrorMessage(error));
      });
    }
  }

  Future<void> _loadInTransitCount(String? warehouseId, int revision) async {
    setState(() => _values['transfers'] = const _OverviewValue.loading());
    try {
      final requests = <Future<TransferPage>>[];
      for (final status in const ['OUTBOUND', 'PARTIALLY_RECEIVED']) {
        if (warehouseId == null) {
          requests.add(widget.api.listTransfers(pageSize: 1, status: status));
        } else {
          requests.add(widget.api.listTransfers(
            pageSize: 1,
            status: status,
            fromWarehouseId: warehouseId,
          ));
          requests.add(widget.api.listTransfers(
            pageSize: 1,
            status: status,
            toWarehouseId: warehouseId,
          ));
        }
      }
      final pages = await Future.wait(requests);
      if (!mounted || revision != _loadRevision) return;
      setState(() {
        _values['transfers'] = _OverviewValue.ready(
            pages.fold(0, (sum, page) => sum + page.total));
      });
    } catch (error) {
      if (!mounted || revision != _loadRevision) return;
      setState(() {
        _values['transfers'] =
            _OverviewValue.failed(inventoryErrorMessage(error));
      });
    }
  }

  Future<void> _loadMovements(String? warehouseId, int revision) async {
    setState(() {
      _movementsLoading = true;
      _movementsError = null;
    });
    try {
      final page = await widget.api.listMovements(
        pageSize: 8,
        warehouseId: warehouseId,
      );
      if (!mounted || revision != _loadRevision) return;
      setState(() {
        _movements = page.movements;
        _movementsLoading = false;
      });
    } catch (error) {
      if (!mounted || revision != _loadRevision) return;
      setState(() {
        _movementsLoading = false;
        _movementsError = inventoryErrorMessage(error);
      });
    }
  }

  void _selectWarehouse(String? warehouseId) {
    if (_selectedWarehouseId == warehouseId) return;
    setState(() {
      _selectedWarehouseId = warehouseId;
      if (warehouseId != null) {
        final selected =
            _warehouses.where((warehouse) => warehouse.id == warehouseId);
        _values['warehouses'] = _OverviewValue.ready(
          selected.isNotEmpty && selected.first.isActive ? 1 : 0,
        );
      }
    });
    if (warehouseId == null) _loadWarehouses();
    _reloadScopedSections();
  }

  void _retryMetric(String key) {
    if (key == 'warehouses') {
      _loadWarehouses();
      return;
    }
    _reloadScopedSections();
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      key: const ValueKey('warehouse-overview-scroll'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildWarehouseFilter(),
          const SizedBox(height: 12),
          _buildMetrics(),
          const SizedBox(height: 16),
          _buildNeedsAttention(),
          const SizedBox(height: 16),
          _buildQuickActions(),
          const SizedBox(height: 16),
          _buildRecentMovements(),
        ],
      ),
    );
  }

  Widget _buildWarehouseFilter() {
    if (_warehouseLoading && _warehouses.isEmpty) {
      return const LoadingState(title: '正在加载可用仓库');
    }
    if (_warehouseError != null && _warehouses.isEmpty) {
      return ErrorState(title: _warehouseError!, onRetry: _loadWarehouses);
    }
    final selected = _warehouses.where(
      (item) => item.id == _selectedWarehouseId,
    );
    final current = _selectedWarehouseId == null
        ? '全部仓库'
        : selected.isEmpty
            ? '所选仓库'
            : selected.first.name;
    return FormSection(
      title: '当前筛选仓库',
      children: [
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                key: const ValueKey('warehouse-overview-selector'),
                initialValue: _selectedWarehouseId ?? '',
                decoration: const InputDecoration(
                  labelText: '仓库范围',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                items: [
                  const DropdownMenuItem(value: '', child: Text('全部仓库')),
                  for (final warehouse in _warehouses)
                    DropdownMenuItem(
                      value: warehouse.id,
                      child: Text('${warehouse.code} · ${warehouse.name}'),
                    ),
                ],
                onChanged: (value) => _selectWarehouse(
                  value == null || value.isEmpty ? null : value,
                ),
              ),
            ),
            const SizedBox(width: 10),
            IconButton(
              key: const ValueKey('warehouse-overview-refresh'),
              tooltip: '刷新总览',
              onPressed: () {
                _loadWarehouses();
                _reloadScopedSections();
              },
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          '当前展示：$current。数量统一按瓶展示；未提供的聚合不会用分页列表推算。',
        ),
      ],
    );
  }

  Widget _buildMetrics() {
    return MetricGrid(
      metrics: [
        _metric('warehouses', '在用仓库数', Icons.warehouse_rounded),
        _metric('stockItems', '商品库存项', Icons.inventory_2_rounded),
        _metric('onHand', '账面现存总瓶数', Icons.shelves),
        _metric('reserved', '已占用总瓶数', Icons.lock_clock_rounded),
        _metric('unavailable', '不可售总瓶数', Icons.block_rounded),
        _metric(
          'shortage',
          '短缺商品数',
          Icons.remove_shopping_cart_outlined,
          warning: true,
        ),
        _metric(
          'alerts',
          '活跃预警数',
          Icons.warning_amber_rounded,
          warning: true,
        ),
        _metric(
          'stocktakes',
          '待审批盘点数',
          Icons.approval_rounded,
          warning: true,
        ),
        _metric(
          'transfers',
          '调拨在途数',
          Icons.swap_horiz_rounded,
          warning: true,
        ),
      ],
    );
  }

  MetricData _metric(
    String key,
    String label,
    IconData icon, {
    bool warning = false,
  }) {
    final value = _values[key]!;
    return MetricData(
      label: label,
      value: value.label(
        isBottleQuantity: {'onHand', 'reserved', 'unavailable'}.contains(key),
      ),
      icon: icon,
      accent: warning && (value.value ?? 0) > 0 ? Colors.orange : null,
      onTap: value.error == null ? null : () => _retryMetric(key),
    );
  }

  Widget _buildNeedsAttention() {
    final items = [
      const _AttentionItem(
        keyName: 'shortage',
        label: '缺货',
        icon: Icons.remove_shopping_cart_outlined,
        moduleId: 'stock',
        filter: 'shortage',
      ),
      const _AttentionItem(
        keyName: 'lowStock',
        label: '低库存',
        icon: Icons.warning_amber_rounded,
        moduleId: 'stock',
        filter: 'low_stock',
      ),
      const _AttentionItem(
        keyName: 'fulfillment',
        label: '待配货',
        icon: Icons.local_shipping_outlined,
        moduleId: 'fulfillment',
      ),
      if (canReadInventoryCost(widget.role))
        const _AttentionItem(
          keyName: 'pendingCost',
          label: '待补成本',
          icon: Icons.price_check_rounded,
          moduleId: 'inbound',
          filter: 'pending_cost',
        ),
      const _AttentionItem(
        keyName: 'overdueTransfer',
        label: '调拨超时',
        icon: Icons.timer_off_outlined,
        moduleId: 'transfer',
        filter: 'overdue',
      ),
      const _AttentionItem(
        keyName: 'stocktakes',
        label: '待审盘点',
        icon: Icons.approval_rounded,
        moduleId: 'approval',
        filter: 'submitted',
      ),
    ];
    return FormSection(
      title: '需要处理',
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 900
                ? 3
                : constraints.maxWidth >= 560
                    ? 2
                    : 1;
            const spacing = 10.0;
            final width =
                (constraints.maxWidth - spacing * (columns - 1)) / columns;
            return Wrap(
              spacing: spacing,
              runSpacing: spacing,
              children: [
                for (final item in items)
                  SizedBox(width: width, child: _attentionCard(item)),
              ],
            );
          },
        ),
      ],
    );
  }

  Widget _attentionCard(_AttentionItem item) {
    final value = _values[item.keyName]!;
    final canNavigate = _moduleAvailable(item.moduleId);
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        key: ValueKey('warehouse-overview-attention-${item.keyName}'),
        leading: Icon(item.icon),
        title: Text(item.label),
        subtitle: Text(value.detailLabel),
        trailing: canNavigate ? const Icon(Icons.chevron_right_rounded) : null,
        onTap: canNavigate
            ? () => widget.onNavigate(
                  WarehouseOverviewNavigationRequest(
                    item.moduleId,
                    filter: item.filter,
                  ),
                )
            : null,
      ),
    );
  }

  bool _moduleAvailable(String moduleId) {
    if (moduleId == 'fulfillment') {
      return widget.role == UserRole.superAdmin ||
          widget.role == UserRole.admin ||
          widget.role == UserRole.warehouse;
    }
    if (moduleId == 'approval') return canStocktakeApprove(widget.role);
    return true;
  }

  Widget _buildQuickActions() {
    final canOperate = canInboundWrite(widget.role);
    return FormSection(
      title: '快捷操作',
      children: [
        if (!canOperate)
          const InventoryInlineNotice(
            message: '当前角色没有库存数量写操作权限。',
            tone: StatusTone.neutral,
          )
        else
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              FilledButton.icon(
                key: const ValueKey('warehouse-overview-create-inbound'),
                onPressed: () => widget.onNavigate(
                  const WarehouseOverviewNavigationRequest(
                    'inbound',
                    action: 'create',
                  ),
                ),
                icon: const Icon(Icons.input_rounded),
                label: const Text('新建入库'),
              ),
              FilledButton.tonalIcon(
                key: const ValueKey('warehouse-overview-create-transfer'),
                onPressed: () => widget.onNavigate(
                  const WarehouseOverviewNavigationRequest(
                    'transfer',
                    action: 'create',
                  ),
                ),
                icon: const Icon(Icons.swap_horiz_rounded),
                label: const Text('新建调拨'),
              ),
              FilledButton.tonalIcon(
                key: const ValueKey('warehouse-overview-create-stocktake'),
                onPressed: () => widget.onNavigate(
                  const WarehouseOverviewNavigationRequest(
                    'stocktake',
                    action: 'create',
                  ),
                ),
                icon: const Icon(Icons.fact_check_rounded),
                label: const Text('新建盘点'),
              ),
              OutlinedButton.icon(
                key: const ValueKey('warehouse-overview-open-fulfillment'),
                onPressed: () => widget.onNavigate(
                  const WarehouseOverviewNavigationRequest('fulfillment'),
                ),
                icon: const Icon(Icons.local_shipping_outlined),
                label: const Text('打开库管配货'),
              ),
            ],
          ),
      ],
    );
  }

  Widget _buildRecentMovements() {
    return FormSection(
      title: '最近库存动态',
      children: [
        if (_movementsLoading)
          const LoadingState(title: '正在加载最近库存动态')
        else if (_movementsError != null)
          ErrorState(
            title: _movementsError!,
            onRetry: () => _loadMovements(_selectedWarehouseId, _loadRevision),
          )
        else if (_movements.isEmpty)
          const EmptyState(title: '暂无库存动态')
        else
          for (final movement in _movements)
            ListTile(
              key: ValueKey('warehouse-overview-movement-${movement.id}'),
              contentPadding: EdgeInsets.zero,
              leading: InventoryStatusTag(
                label: movement.movementTypeLabel,
                tone: movement.quantity < 0
                    ? StatusTone.warning
                    : StatusTone.success,
              ),
              title:
                  Text('${movement.warehouseName} · ${movement.productName}'),
              subtitle: Text(_movementDeltaText(movement)),
              trailing: const Icon(Icons.chevron_right_rounded),
              onTap: () => widget.onNavigate(
                const WarehouseOverviewNavigationRequest('movement'),
              ),
            ),
      ],
    );
  }

  String _movementDeltaText(MovementRecord movement) {
    String delta(String label, int value) =>
        value == 0 ? '' : '$label ${value > 0 ? '+' : ''}$value 瓶';
    final parts = [
      delta('现存', movement.onHandDelta),
      delta('占用', movement.reservedDelta),
      delta('不可售', movement.unavailableDelta),
      delta('在途', movement.inTransitDelta),
    ].where((item) => item.isNotEmpty).toList();
    if (movement.businessAt != null) parts.add(movement.businessAt!);
    return parts.isEmpty ? '数量未变化' : parts.join(' · ');
  }
}

class _OverviewValue {
  const _OverviewValue._({
    this.value,
    this.loading = false,
    this.error,
    this.unavailable,
  });

  const _OverviewValue.loading() : this._(loading: true);
  const _OverviewValue.ready(int value) : this._(value: value);
  const _OverviewValue.failed(String error) : this._(error: error);
  const _OverviewValue.unavailable(String reason) : this._(unavailable: reason);

  final int? value;
  final bool loading;
  final String? error;
  final String? unavailable;

  String label({bool isBottleQuantity = false}) {
    if (loading) return '加载中';
    if (error != null) return '加载失败 · 重试';
    if (unavailable != null) return '暂未提供';
    return isBottleQuantity ? '$value 瓶' : '$value';
  }

  String get detailLabel {
    if (loading) return '加载中';
    if (error != null) return '加载失败，点击重试';
    if (unavailable != null) return '暂未提供';
    return '$value 项';
  }
}

class _AttentionItem {
  const _AttentionItem({
    required this.keyName,
    required this.label,
    required this.icon,
    required this.moduleId,
    this.filter,
  });

  final String keyName;
  final String label;
  final IconData icon;
  final String moduleId;
  final String? filter;
}
