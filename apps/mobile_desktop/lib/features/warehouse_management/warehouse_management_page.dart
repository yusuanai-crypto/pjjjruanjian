import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../core/business/inventory_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';
import '../warehouse/warehouse_packing_page.dart';
import 'compatibility/inventory_compatibility_entries.dart';
import 'inventory_workspace_tabs.dart';
import 'navigation/warehouse_secondary_navigation.dart';
import 'overview/inventory_overview_page.dart';
import 'returns/customer_returns_tab.dart';
import 'shared/inventory_workspace_shared.dart';
import 'warehouse_settings_page.dart';

export 'shared/inventory_workspace_shared.dart'
    show
        confirmInventoryAction,
        inventoryErrorMessage,
        parseBottleQuantity,
        parseNonNegativeInt,
        parseNonNegativeYuanCents;

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
  InventoryApi? _api;
  BusinessApi? _businessApi;
  String _selectedModuleId = 'overview';
  Set<String> _visitedModuleIds = {'overview'};
  int _actorRevision = 0;
  String? _stockFilterRequest;
  int _stockFilterRevision = 0;
  final Map<String, String?> _moduleFilterRequests = {};
  final Map<String, int> _moduleFilterRevisions = {};
  final Map<String, InventorySelectionContext> _moduleSelectionRequests = {};
  final Map<String, int> _createRequestRevisions = {};
  bool _warehouseSettingsDirty = false;

  @override
  void initState() {
    super.initState();
    _api = _createApiIfAllowed();
    _businessApi = _createBusinessApiIfAllowed();
  }

  @override
  void didUpdateWidget(covariant WarehouseManagementPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    final actorChanged = oldWidget.role != widget.role ||
        oldWidget.token != widget.token ||
        oldWidget.apiClient != widget.apiClient;
    if (!actorChanged) return;

    // 清空旧身份拥有的数量与成本缓存，并用新的组件 key 销毁所有模块状态。
    _api?.clearCache();
    _api = _createApiIfAllowed();
    _businessApi = _createBusinessApiIfAllowed();
    _actorRevision++;
    _selectedModuleId = 'overview';
    _visitedModuleIds = {'overview'};
    _stockFilterRequest = null;
    _stockFilterRevision = 0;
    _moduleFilterRequests.clear();
    _moduleFilterRevisions.clear();
    _moduleSelectionRequests.clear();
    _createRequestRevisions.clear();
    _warehouseSettingsDirty = false;
  }

  @override
  void dispose() {
    _api?.clearCache();
    super.dispose();
  }

  InventoryApi? _createApiIfAllowed() {
    if (!canAccessInventory(widget.role)) return null;
    return InventoryApi(
      apiClient: widget.apiClient,
      token: widget.token,
      role: widget.role,
    );
  }

  BusinessApi? _createBusinessApiIfAllowed() {
    if (!canAccessInventory(widget.role)) return null;
    return BusinessApi(apiClient: widget.apiClient, token: widget.token);
  }

  bool get _canUseOperationalEntries {
    return widget.role == UserRole.superAdmin ||
        widget.role == UserRole.admin ||
        widget.role == UserRole.warehouse;
  }

  bool get _canUseSerializedInventory {
    return widget.role == UserRole.superAdmin ||
        widget.role == UserRole.admin ||
        widget.role == UserRole.finance ||
        widget.role == UserRole.warehouse;
  }

  List<_WarehouseModuleGroup> get _moduleGroups {
    final api = _api!;
    final role = widget.role;
    return [
      _WarehouseModuleGroup(
        id: 'workbench',
        label: '工作台',
        modules: [
          _WarehouseModule(
            id: 'overview',
            label: '库存总览',
            icon: Icons.space_dashboard_rounded,
            description: '查看仓库、库存、在途、预警和待审批概况。',
            builder: () => InventoryOverviewPage(
              api: api,
              role: role,
              onNavigate: _handleOverviewNavigation,
            ),
          ),
          _WarehouseModule(
            id: 'stock',
            label: '商品库存',
            icon: Icons.inventory_2_rounded,
            description: '按仓库查看数量、状态；成本字段严格按角色控制。',
            builder: () => StockTab(
              api: api,
              role: role,
              onNavigate: _handleStockNavigation,
              onOpenSerialized: () =>
                  widget.onOpenDestination('moutai_inventory'),
              requestedFilter: _stockFilterRequest,
              filterRequestRevision: _stockFilterRevision,
            ),
          ),
          _WarehouseModule(
            id: 'alert',
            label: '库存预警',
            icon: Icons.warning_amber_rounded,
            description: '查看负库存和低库存等需要处理的异常。',
            builder: () => AlertTab(
              api: api,
              businessApi: _businessApi!,
              role: role,
              onNavigate: _handleAlertNavigation,
            ),
          ),
        ],
      ),
      _WarehouseModuleGroup(
        id: 'daily',
        label: '日常作业',
        modules: [
          _WarehouseModule(
            id: 'inbound',
            label: '入库',
            icon: Icons.input_rounded,
            description: '查看入库记录；有权限的角色可创建并生效入库。',
            builder: () => InboundTab(
              api: api,
              businessApi: _businessApi!,
              role: role,
              onOpenSerialized: () =>
                  widget.onOpenDestination('moutai_inventory'),
              onInventoryFactsChanged: _invalidateInventoryFacts,
              createRequestRevision: _createRequestRevisions['inbound'] ?? 0,
              requestedFilter: _moduleFilterRequests['inbound'],
              filterRequestRevision: _moduleFilterRevisions['inbound'] ?? 0,
              requestedSelection: _moduleSelectionRequests['inbound'],
            ),
          ),
          if (_canUseOperationalEntries)
            _WarehouseModule(
              id: 'fulfillment',
              label: '销售出库与配货',
              icon: Icons.local_shipping_outlined,
              description: '嵌入现有库管打包工作台，共用真实订单、逐瓶选择和出库动作。',
              builder: () => WarehousePackingPage(
                apiClient: widget.apiClient,
                token: widget.token,
                role: widget.role,
                embedded: true,
                onInventoryFactsChanged: _invalidateInventoryFacts,
              ),
            ),
          _WarehouseModule(
            id: 'transfer',
            label: '调拨与在途',
            icon: Icons.swap_horiz_rounded,
            description: '查看调拨流程；仓库角色可执行调出和调入确认。',
            builder: () => TransferTab(
              api: api,
              businessApi: _businessApi!,
              role: role,
              createRequestRevision: _createRequestRevisions['transfer'] ?? 0,
              requestedFilter: _moduleFilterRequests['transfer'],
              filterRequestRevision: _moduleFilterRevisions['transfer'] ?? 0,
              requestedSelection: _moduleSelectionRequests['transfer'],
              onInventoryFactsChanged: _invalidateInventoryFacts,
            ),
          ),
          _WarehouseModule(
            id: 'returns',
            label: '顾客退货',
            icon: Icons.assignment_return_rounded,
            description: '登记库管实际收货并查看返库进度；财务退款仍在财务页面处理。',
            builder: () => CustomerReturnsTab(
              api: api,
              businessApi: _businessApi!,
              role: role,
              onInventoryFactsChanged: _invalidateInventoryFacts,
            ),
          ),
          _WarehouseModule(
            id: 'unavailable',
            label: '不可售',
            icon: Icons.block_rounded,
            description: '查看不可售库存；有权限的角色可执行转换和恢复。',
            builder: () => UnavailableTab(
              api: api,
              businessApi: _businessApi!,
              role: role,
              onOpenSerialized: () =>
                  widget.onOpenDestination('moutai_inventory'),
              onInventoryFactsChanged: _invalidateInventoryFacts,
              requestedSelection: _moduleSelectionRequests['unavailable'],
              filterRequestRevision: _moduleFilterRevisions['unavailable'] ?? 0,
            ),
          ),
        ],
      ),
      _WarehouseModuleGroup(
        id: 'traceability',
        label: '盘点与追溯',
        modules: [
          _WarehouseModule(
            id: 'stocktake',
            label: '商品盘点',
            icon: Icons.fact_check_rounded,
            description: '查看盘点单；仓库角色可创建并提交盘点。',
            builder: () => StocktakeTab(
              api: api,
              businessApi: _businessApi!,
              role: role,
              onOpenSerialized: () =>
                  widget.onOpenDestination('moutai_inventory'),
              createRequestRevision: _createRequestRevisions['stocktake'] ?? 0,
              requestedSelection: _moduleSelectionRequests['stocktake'],
              filterRequestRevision: _moduleFilterRevisions['stocktake'] ?? 0,
            ),
          ),
          if (canStocktakeApprove(role))
            _WarehouseModule(
              id: 'approval',
              label: '盘点审批',
              icon: Icons.approval_rounded,
              description: '审批待处理盘点；boss 的唯一仓库管理写操作。',
              builder: () => StocktakeApprovalTab(
                api: api,
                businessApi: _businessApi!,
                role: role,
                onInventoryFactsChanged: _invalidateInventoryFacts,
              ),
            ),
          _WarehouseModule(
            id: 'movement',
            label: '流水',
            icon: Icons.receipt_long_rounded,
            description: '按真实库存流水追溯数量变化。',
            builder: () => MovementTab(
              api: api,
              businessApi: _businessApi!,
              role: role,
              requestedSelection: _moduleSelectionRequests['movement'],
              filterRequestRevision: _moduleFilterRevisions['movement'] ?? 0,
            ),
          ),
          _WarehouseModule(
            id: 'report',
            label: '报表',
            icon: Icons.assessment_rounded,
            description: '查看和导出角色有权访问的库存报表。',
            builder: () => ReportTab(
              api: api,
              businessApi: _businessApi!,
              role: role,
            ),
          ),
        ],
      ),
      if (canManageWarehouse(role) || _canUseSerializedInventory)
        _WarehouseModuleGroup(
          id: 'settings',
          label: '基础设置',
          modules: [
            if (canManageWarehouse(role))
              _WarehouseModule(
                id: 'warehouse_settings',
                label: '仓库设置',
                icon: Icons.settings_outlined,
                description: '维护仓库资料、默认仓库和启用状态，不提供物理删除。',
                builder: () => WarehouseSettingsPage(
                  api: api,
                  role: role,
                  onDirtyChanged: (dirty) => _warehouseSettingsDirty = dirty,
                ),
              ),
            if (_canUseSerializedInventory)
              _WarehouseModule(
                id: 'serialized',
                label: '茅台逐瓶库存',
                icon: Icons.qr_code_scanner_rounded,
                description: '跳转到现有逐瓶库存页面，保留兼容入口。',
                builder: () => SerializedInventoryCompatibilityEntry(
                  onOpenDestination: widget.onOpenDestination,
                ),
              ),
          ],
        ),
    ];
  }

  Future<void> _selectModule(String moduleId) async {
    if (_selectedModuleId == moduleId) return;
    if (_selectedModuleId == 'warehouse_settings' && _warehouseSettingsDirty) {
      final discard = await confirmInventoryAction(
        context,
        title: '放弃未保存修改？',
        content: '仓库资料尚未保存，切换模块将丢失这些修改。',
        confirmLabel: '放弃并切换',
        danger: true,
      );
      if (!discard || !mounted) return;
      _warehouseSettingsDirty = false;
    }
    setState(() {
      _selectedModuleId = moduleId;
      _visitedModuleIds = {..._visitedModuleIds, moduleId};
    });
  }

  void _handleOverviewNavigation(
    WarehouseOverviewNavigationRequest request,
  ) {
    final modules =
        _moduleGroups.expand((group) => group.modules).map((item) => item.id);
    if (!modules.contains(request.moduleId)) return;
    setState(() {
      _selectedModuleId = request.moduleId;
      _visitedModuleIds = {..._visitedModuleIds, request.moduleId};
      if (request.moduleId == 'stock' && request.filter != null) {
        _stockFilterRequest = request.filter;
        _stockFilterRevision++;
      }
      if (request.filter != null) {
        _moduleFilterRequests[request.moduleId] = request.filter;
        _moduleFilterRevisions[request.moduleId] =
            (_moduleFilterRevisions[request.moduleId] ?? 0) + 1;
      }
      if (request.action == 'create') {
        _createRequestRevisions[request.moduleId] =
            (_createRequestRevisions[request.moduleId] ?? 0) + 1;
      }
    });
  }

  void _handleStockNavigation(WarehouseStockNavigationRequest request) {
    final modules =
        _moduleGroups.expand((group) => group.modules).map((item) => item.id);
    if (!modules.contains(request.moduleId)) return;
    setState(() {
      _selectedModuleId = request.moduleId;
      _visitedModuleIds = {..._visitedModuleIds, request.moduleId};
      _moduleSelectionRequests[request.moduleId] = InventorySelectionContext(
        warehouseId: request.warehouseId,
        productId: request.productId,
      );
      _moduleFilterRevisions[request.moduleId] =
          (_moduleFilterRevisions[request.moduleId] ?? 0) + 1;
      if (request.action == 'create') {
        _createRequestRevisions[request.moduleId] =
            (_createRequestRevisions[request.moduleId] ?? 0) + 1;
      }
    });
  }

  void _handleAlertNavigation(WarehouseAlertNavigationRequest request) {
    final modules =
        _moduleGroups.expand((group) => group.modules).map((item) => item.id);
    if (!modules.contains(request.moduleId)) return;
    setState(() {
      _selectedModuleId = request.moduleId;
      _visitedModuleIds = {..._visitedModuleIds, request.moduleId};
    });
  }

  void _invalidateInventoryFacts() {
    _api?.clearCache();
    if (!mounted) return;
    setState(() {
      _visitedModuleIds = {..._visitedModuleIds}..removeAll({
          'overview',
          'stock',
          'alert',
          'movement',
          'report',
        });
    });
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
              InventoryInlineNotice(
                message: '当前角色无权访问仓库管理模块。',
                tone: StatusTone.danger,
              ),
            ],
          ),
        ],
      );
    }

    final groups = _moduleGroups;
    final modules = groups.expand((group) => group.modules).toList();
    if (!modules.any((module) => module.id == _selectedModuleId)) {
      _selectedModuleId = modules.first.id;
      _visitedModuleIds = {_selectedModuleId};
    }
    final navigationGroups = [
      for (final group in groups)
        WarehouseNavigationGroup(
          id: group.id,
          label: group.label,
          items: [
            for (final module in group.modules)
              WarehouseNavigationItem(
                id: module.id,
                label: module.label,
                icon: module.icon,
              ),
          ],
        ),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        // AppShell 宽屏本身已有 244px 一级导航。只有剩余内容区足够同时容纳
        // 二级导航和 1024px 桌面工作台时才继续显示左侧二级导航，避免常见
        // 1366px Windows 窗口被两级侧栏压成窄表格。
        final wide = constraints.maxWidth >= AppBreakpoints.desktop + 256;
        final padding = wide ? 24.0 : 12.0;
        return Padding(
          padding: EdgeInsets.fromLTRB(padding, 16, padding, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildHeader(),
              const SizedBox(height: 12),
              if (wide)
                Expanded(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      WarehouseSecondaryNavigation(
                        groups: navigationGroups,
                        selectedId: _selectedModuleId,
                        onSelected: _selectModule,
                        wide: true,
                      ),
                      const SizedBox(width: 16),
                      Expanded(child: _buildModuleStack(groups, modules)),
                    ],
                  ),
                )
              else ...[
                WarehouseSecondaryNavigation(
                  groups: navigationGroups,
                  selectedId: _selectedModuleId,
                  onSelected: _selectModule,
                  wide: false,
                ),
                const SizedBox(height: 12),
                Expanded(child: _buildModuleStack(groups, modules)),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _buildHeader() {
    return Row(
      children: [
        Icon(
          Icons.warehouse_rounded,
          color: Theme.of(context).colorScheme.primary,
          size: 28,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            '仓库管理',
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
        StatusTag(label: widget.role.label, tone: StatusTone.info),
      ],
    );
  }

  Widget _buildModuleStack(
    List<_WarehouseModuleGroup> groups,
    List<_WarehouseModule> modules,
  ) {
    return IndexedStack(
      key: ValueKey('warehouse-module-stack-$_actorRevision'),
      index: modules.indexWhere((module) => module.id == _selectedModuleId),
      children: [
        for (final module in modules)
          _visitedModuleIds.contains(module.id)
              ? InventoryPageScaffold(
                  key: ValueKey(
                    'warehouse-module-content-${module.id}-$_actorRevision',
                  ),
                  groupLabel: groups
                      .firstWhere((group) => group.modules.contains(module))
                      .label,
                  title: module.label,
                  description: module.description,
                  child: module.builder(),
                )
              : SizedBox(
                  key: ValueKey(
                    'warehouse-module-placeholder-${module.id}-$_actorRevision',
                  ),
                ),
      ],
    );
  }
}

class _WarehouseModuleGroup {
  const _WarehouseModuleGroup({
    required this.id,
    required this.label,
    required this.modules,
  });

  final String id;
  final String label;
  final List<_WarehouseModule> modules;
}

class _WarehouseModule {
  const _WarehouseModule({
    required this.id,
    required this.label,
    required this.icon,
    required this.description,
    required this.builder,
  });

  final String id;
  final String label;
  final IconData icon;
  final String description;
  final Widget Function() builder;
}
