import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/inventory_api.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/metric_card.dart';
import 'inventory_workspace_tabs.dart';

class WarehouseManagementPage extends StatefulWidget {
  const WarehouseManagementPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    required this.onOpenDestination,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final ValueChanged<String> onOpenDestination;

  @override
  State<WarehouseManagementPage> createState() =>
      _WarehouseManagementPageState();
}

class _WarehouseManagementPageState extends State<WarehouseManagementPage> {
  late InventoryApi _api;

  @override
  void initState() {
    super.initState();
    _api = InventoryApi(
        apiClient: widget.apiClient, token: widget.token, role: widget.role);
  }

  @override
  void didUpdateWidget(covariant WarehouseManagementPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 角色或 token 变化时清除库存与成本缓存，防止残留。
    if (oldWidget.role != widget.role ||
        oldWidget.token != widget.token ||
        oldWidget.apiClient != widget.apiClient) {
      setState(() {
        _api.clearCache();
        _api = InventoryApi(
            apiClient: widget.apiClient,
            token: widget.token,
            role: widget.role);
      });
    }
  }

  List<_InventoryTab> get _tabs {
    final role = widget.role;
    final list = <_InventoryTab>[
      _InventoryTab(
          id: 'overview',
          label: '库存总览',
          icon: Icons.space_dashboard_rounded,
          builder: (ctx) => _OverviewTab(api: _api, role: role)),
      _InventoryTab(
          id: 'stock',
          label: '商品库存',
          icon: Icons.inventory_2_rounded,
          builder: (ctx) => StockTab(api: _api, role: role)),
      _InventoryTab(
          id: 'inbound',
          label: '入库管理',
          icon: Icons.input_rounded,
          builder: (ctx) => InboundTab(api: _api, role: role)),
      _InventoryTab(
          id: 'transfer',
          label: '调拨与在途',
          icon: Icons.swap_horiz_rounded,
          builder: (ctx) => TransferTab(api: _api, role: role)),
      _InventoryTab(
          id: 'unavailable',
          label: '不可售管理',
          icon: Icons.block_rounded,
          builder: (ctx) => UnavailableTab(api: _api, role: role)),
      _InventoryTab(
          id: 'stocktake',
          label: '商品盘点',
          icon: Icons.fact_check_rounded,
          builder: (ctx) => StocktakeTab(api: _api, role: role)),
      _InventoryTab(
          id: 'approval',
          label: '盘点审批',
          icon: Icons.approval_rounded,
          builder: (ctx) => StocktakeApprovalTab(api: _api, role: role)),
      _InventoryTab(
          id: 'alert',
          label: '库存预警',
          icon: Icons.warning_amber_rounded,
          builder: (ctx) => AlertTab(api: _api, role: role)),
      _InventoryTab(
          id: 'movement',
          label: '出入库流水',
          icon: Icons.receipt_long_rounded,
          builder: (ctx) => MovementTab(api: _api, role: role)),
      _InventoryTab(
          id: 'report',
          label: '库存报表',
          icon: Icons.assessment_rounded,
          builder: (ctx) => ReportTab(api: _api, role: role)),
    ];
    // 茅台逐瓶入口：warehouse/admin/superAdmin/finance 可见
    if (role == UserRole.superAdmin ||
        role == UserRole.admin ||
        role == UserRole.finance ||
        role == UserRole.warehouse) {
      list.add(_InventoryTab(
          id: 'serialized',
          label: '茅台逐瓶',
          icon: Icons.qr_code_scanner_rounded,
          builder: (ctx) => _SerializedEntryTab(
              onOpenDestination: widget.onOpenDestination)));
    }
    return list;
  }

  @override
  Widget build(BuildContext context) {
    if (!canAccessInventory(widget.role)) {
      return const ResponsivePage(
        key: ValueKey('warehouse-management-access-denied'),
        children: [
          FormSection(
            title: '仓库管理',
            children: [
              _InlineNotice(
                  message: '当前角色无权访问仓库管理模块。', tone: StatusTone.danger),
            ],
          ),
        ],
      );
    }

    final tabs = _tabs;
    final desktop = isDesktopWidth(MediaQuery.of(context).size.width);
    final horizontalPadding = desktop ? 24.0 : 12.0;

    return Padding(
      padding: EdgeInsets.fromLTRB(horizontalPadding, 16, horizontalPadding, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildHeader(desktop),
          _buildQuickActions(),
          const SizedBox(height: 8),
          Expanded(
              child: desktop
                  ? _buildDesktopBody(tabs)
                  : _buildMobileBody(tabs)),
        ],
      ),
    );
  }

  Widget _buildHeader(bool desktop) {
    return Row(
      children: [
        Icon(Icons.warehouse_rounded,
            color: Theme.of(context).colorScheme.primary, size: 28),
        const SizedBox(width: 10),
        Expanded(
          child: Text('仓库管理',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w700)),
        ),
        StatusTag(
          label: widget.role.label,
          tone: StatusTone.info,
        ),
      ],
    );
  }

  Widget _buildQuickActions() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          ActionChip(
            key: const ValueKey('warehouse-management-packing-entry'),
            label: const Text('库管打包'),
            avatar: const Icon(Icons.inventory_2_rounded, size: 18),
            onPressed: () => widget.onOpenDestination('warehouse_packing'),
          ),
          if (widget.role == UserRole.superAdmin ||
              widget.role == UserRole.admin ||
              widget.role == UserRole.finance ||
              widget.role == UserRole.warehouse)
            ActionChip(
              key: const ValueKey(
                  'warehouse-management-moutai-entry'),
              label: const Text('茅台逐瓶库存'),
              avatar: const Icon(Icons.qr_code_scanner_rounded, size: 18),
              onPressed: () =>
                  widget.onOpenDestination('moutai_inventory'),
            ),
        ],
      ),
    );
  }

  Widget _buildDesktopBody(List<_InventoryTab> tabs) {
    return DefaultTabController(
      length: tabs.length,
      child: Column(
        children: [
          Material(
            color: Colors.transparent,
            child: TabBar(
              key: const ValueKey('warehouse-management-tabbar'),
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: tabs
                  .map((t) => Tab(
                      icon: Icon(t.icon, size: 18), text: t.label))
                  .toList(),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: TabBarView(
              children: tabs.map((t) => t.builder(context)).toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMobileBody(List<_InventoryTab> tabs) {
    return DefaultTabController(
      length: tabs.length,
      child: Column(
        children: [
          Material(
            color: Colors.transparent,
            child: TabBar(
              key: const ValueKey('warehouse-management-tabbar-mobile'),
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: tabs.map((t) => Tab(text: t.label)).toList(),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: TabBarView(
              children: tabs.map((t) => t.builder(context)).toList(),
            ),
          ),
        ],
      ),
    );
  }
}

class _InventoryTab {
  const _InventoryTab(
      {required this.id,
      required this.label,
      required this.icon,
      required this.builder});
  final String id;
  final String label;
  final IconData icon;
  final WidgetBuilder builder;
}

// ---------------------------------------------------------------------------
// 库存总览
// ---------------------------------------------------------------------------

class _OverviewTab extends StatefulWidget {
  const _OverviewTab({required this.api, required this.role});
  final InventoryApi api;
  final UserRole role;

  @override
  State<_OverviewTab> createState() => _OverviewTabState();
}

class _OverviewTabState extends State<_OverviewTab> {
  InventoryOverview? _overview;
  bool _loading = true;
  String? _error;

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
      final overview = await widget.api.fetchOverview();
      if (!mounted) return;
      setState(() {
        _overview = overview;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = _message(e);
        _loading = false;
      });
    }
  }

  String _message(Object e) {
    if (e is ApiException) return e.message;
    return '加载库存总览失败，请稍后重试。';
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const LoadingState(title: '正在加载库存总览');
    if (_error != null) {
      return ErrorState(title: _error!, onRetry: _load);
    }
    final o = _overview;
    if (o == null) {
      return const EmptyState(title: '暂无库存数据');
    }
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          MetricGrid(
            metrics: [
              MetricData(
                label: '在用仓库',
                value: '${o.warehouseCount}',
                icon: Icons.warehouse_rounded,
              ),
              MetricData(
                label: '商品库存项',
                value: '${o.productStockCount}',
                icon: Icons.inventory_2_rounded,
              ),
              MetricData(
                label: '调拨在途',
                value: '${o.inTransitCount}',
                icon: Icons.swap_horiz_rounded,
                accent: o.inTransitCount > 0 ? Colors.orange : null,
              ),
              MetricData(
                label: '可售为负',
                value: '${o.negativeAvailableCount}',
                icon: Icons.error_outline_rounded,
                accent: o.negativeAvailableCount > 0 ? Colors.red : null,
              ),
              MetricData(
                label: '待审盘点',
                value: '${o.pendingStocktakeCount}',
                icon: Icons.approval_rounded,
                accent: o.pendingStocktakeCount > 0 ? Colors.orange : null,
              ),
              MetricData(
                label: '活跃预警',
                value: '${o.activeAlertCount}',
                icon: Icons.warning_amber_rounded,
                accent: o.activeAlertCount > 0 ? Colors.orange : null,
              ),
            ],
          ),
          const SizedBox(height: 16),
          FormSection(
            title: '使用提示',
            children: [
              _tipRow(Icons.input_rounded, '入库管理',
                  canInboundWrite(widget.role) ? '可录入期初、采购和其他入库' : '仅查看入库记录'),
              _tipRow(Icons.swap_horiz_rounded, '调拨与在途',
                  canInboundWrite(widget.role) ? '可创建调拨、确认调出/调入' : '仅查看调拨记录'),
              _tipRow(Icons.block_rounded, '不可售管理',
                  canInboundWrite(widget.role) ? '可标记/恢复不可售库存' : '仅查看不可售记录'),
              _tipRow(Icons.fact_check_rounded, '商品盘点',
                  canStocktakeWrite(widget.role)
                      ? '可创建和提交盘点'
                      : canStocktakeApprove(widget.role)
                          ? '可审批盘点'
                          : '仅查看盘点记录'),
              if (canReadInventoryCost(widget.role))
                _tipRow(Icons.payments_rounded, '成本与金额',
                    canCostWrite(widget.role) ? '可维护批次成本并查看金额报表' : '可查看成本和金额'),
              if (!canReadInventoryCost(widget.role))
                _tipRow(Icons.visibility_off_rounded, '成本信息',
                    '当前角色不可查看成本，成本列不会显示'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _tipRow(IconData icon, String title, String desc) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
          const SizedBox(width: 10),
          Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(width: 8),
          Expanded(
              child: Text(desc,
                  style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurfaceVariant))),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// 茅台逐瓶入口（跳转）
// ---------------------------------------------------------------------------

class _SerializedEntryTab extends StatelessWidget {
  const _SerializedEntryTab({required this.onOpenDestination});
  final ValueChanged<String> onOpenDestination;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      title: '茅台逐瓶库存',
      children: [
        const _InlineNotice(
          message: '茅台逐瓶库存（物流码、批次、状态管理）请在专属页面操作。',
          tone: StatusTone.info,
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          key: const ValueKey('warehouse-management-open-serialized'),
          onPressed: () => onOpenDestination('moutai_inventory'),
          icon: const Icon(Icons.qr_code_scanner_rounded),
          label: const Text('打开茅台逐瓶库存'),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// 辅助 Widget
// ---------------------------------------------------------------------------

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({required this.message, required this.tone});
  final String message;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = switch (tone) {
      StatusTone.danger => scheme.errorContainer,
      StatusTone.warning => Colors.orange.shade50,
      StatusTone.success => scheme.primaryContainer,
      StatusTone.info => scheme.secondaryContainer,
      StatusTone.neutral => scheme.surfaceContainerHighest,
    };
    final fg = switch (tone) {
      StatusTone.danger => scheme.onErrorContainer,
      StatusTone.warning => Colors.orange.shade900,
      StatusTone.success => scheme.onPrimaryContainer,
      StatusTone.info => scheme.onSecondaryContainer,
      StatusTone.neutral => scheme.onSurface,
    };
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(message, style: TextStyle(color: fg, fontSize: 13)),
    );
  }
}

// ---------------------------------------------------------------------------
// 共享辅助函数
// ---------------------------------------------------------------------------

String inventoryErrorMessage(Object e) {
  if (e is ApiException) {
    return switch (e.code) {
      'PERMISSION_DENIED' || 'FIELD_PERMISSION_DENIED' => '没有此操作权限。',
      'INVENTORY_REQUEST_HASH_MISMATCH' => '请求校验失败，请重试。',
      'INVENTORY_VALIDATION_FAILED' => '数据校验失败：${e.message}',
      'INVENTORY_WAREHOUSE_NOT_FOUND' => '仓库不存在。',
      'INVENTORY_PRODUCT_NOT_FOUND' => '商品不存在。',
      'INVENTORY_STOCK_NOT_FOUND' => '库存记录不存在。',
      'INVENTORY_INBOUND_DOCUMENT_NOT_FOUND' => '入库单不存在。',
      'INVENTORY_TRANSFER_NOT_FOUND' => '调拨单不存在。',
      'INVENTORY_CONCURRENT_UPDATE' => '数据已被其他人更新，请刷新后重试。',
      'INVENTORY_RESERVED_QTY_NEGATIVE' => '操作会导致占用数量为负。',
      'INVENTORY_UNAVAILABLE_QTY_NEGATIVE' => '操作会导致不可售数量为负。',
      'INVENTORY_IN_TRANSIT_QTY_NEGATIVE' => '操作会导致在途数量为负。',
      'INVENTORY_TRACKING_DISABLED' => '该商品未启用库存跟踪。',
      'INVENTORY_COST_FIELD_FORBIDDEN' => '当前角色不可在入库时填写成本。',
      'INVENTORY_COST_REPORT_FORBIDDEN' => '当前角色不可查看库存估值报表。',
      'INVENTORY_WAREHOUSE_HAS_ACTIVE_BUSINESS' => '仓库有活跃业务，无法停用。',
      'INVENTORY_REPORT_EXPORT_LIMIT_EXCEEDED' => '导出行数超限（上限 10 万行）。',
      'LOGISTICS_CODE_DUPLICATE' => '物流码已存在。',
      'NETWORK_ERROR' => '无法连接服务器，请检查网络。',
      _ => e.message,
    };
  }
  return '操作失败，请稍后重试。';
}

/// 二次确认对话框，返回 true 表示用户确认。
Future<bool> confirmInventoryAction(
  BuildContext context, {
  required String title,
  required String content,
  String confirmLabel = '确认',
  String cancelLabel = '取消',
  bool danger = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(content),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: Text(cancelLabel),
        ),
        FilledButton(
          style: danger
              ? FilledButton.styleFrom(
                  backgroundColor: Theme.of(ctx).colorScheme.error)
              : null,
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}

/// 整数瓶数校验：只允许正整数。
int? parseBottleQuantity(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return null;
  if (!RegExp(r'^[1-9][0-9]*$').hasMatch(trimmed)) return null;
  return int.tryParse(trimmed);
}

/// 非负整数校验（盘点数量等允许 0）。
int? parseNonNegativeInt(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return null;
  if (!RegExp(r'^(0|[1-9][0-9]*)$').hasMatch(trimmed)) return null;
  return int.tryParse(trimmed);
}
