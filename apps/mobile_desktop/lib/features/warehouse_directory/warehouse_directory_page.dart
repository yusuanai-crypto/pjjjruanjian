import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../core/business/inventory_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import '../warehouse_management/navigation/inventory_navigation_handoff.dart';
import '../warehouse_management/shared/inventory_workspace_shared.dart';

class WarehouseDirectoryPage extends StatefulWidget {
  const WarehouseDirectoryPage({
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
  State<WarehouseDirectoryPage> createState() => _WarehouseDirectoryPageState();
}

class _WarehouseDirectoryPageState extends State<WarehouseDirectoryPage> {
  final _warehouseSearch = TextEditingController();
  final _productSearch = TextEditingController();
  InventoryApi? _inventoryApi;
  BusinessApi? _businessApi;
  List<WarehouseRecord> _warehouses = const [];
  WarehouseRecord? _selected;
  WarehouseProductPage? _products;
  bool _loadingWarehouses = false;
  bool _loadingProducts = false;
  bool _includeInactiveProducts = false;
  bool? _activeFilter;
  String? _warehouseError;
  String? _productError;
  final Set<String> _busy = {};
  int _warehouseGeneration = 0;
  int _productGeneration = 0;

  bool get _canRead => canAccessInventory(widget.role);
  bool get _canManage => canManageWarehouse(widget.role);

  @override
  void initState() {
    super.initState();
    _resetApis();
    if (_canRead) _loadWarehouses();
  }

  @override
  void didUpdateWidget(covariant WarehouseDirectoryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient == widget.apiClient &&
        oldWidget.token == widget.token &&
        oldWidget.role == widget.role) {
      return;
    }
    _inventoryApi?.clearCache();
    _warehouseGeneration++;
    _productGeneration++;
    _warehouses = const [];
    _selected = null;
    _products = null;
    _resetApis();
    if (_canRead) _loadWarehouses();
  }

  void _resetApis() {
    _inventoryApi = _canRead
        ? InventoryApi(
            apiClient: widget.apiClient,
            token: widget.token,
            role: widget.role,
          )
        : null;
    _businessApi = _canManage
        ? BusinessApi(apiClient: widget.apiClient, token: widget.token)
        : null;
  }

  @override
  void dispose() {
    _warehouseGeneration++;
    _productGeneration++;
    _inventoryApi?.clearCache();
    _warehouseSearch.dispose();
    _productSearch.dispose();
    super.dispose();
  }

  Future<void> _loadWarehouses({String? selectId}) async {
    final generation = ++_warehouseGeneration;
    setState(() {
      _loadingWarehouses = true;
      _warehouseError = null;
    });
    try {
      final warehouses =
          await _inventoryApi!.listWarehouses(isActive: _activeFilter);
      if (!mounted || generation != _warehouseGeneration) return;
      final wantedId = selectId ?? _selected?.id;
      WarehouseRecord? selected;
      for (final warehouse in warehouses) {
        if (warehouse.id == wantedId) selected = warehouse;
      }
      if (selected == null &&
          warehouses.isNotEmpty &&
          MediaQuery.sizeOf(context).width >= 960) {
        selected = warehouses.first;
      }
      setState(() {
        _warehouses = warehouses;
        _selected = selected;
        _loadingWarehouses = false;
      });
      if (selected == null) {
        setState(() => _products = null);
      } else {
        await _loadProducts();
      }
    } catch (error) {
      if (!mounted || generation != _warehouseGeneration) return;
      setState(() {
        _loadingWarehouses = false;
        _warehouseError = inventoryErrorMessage(error);
      });
    }
  }

  Future<void> _selectWarehouse(WarehouseRecord warehouse) async {
    if (_selected?.id == warehouse.id) return;
    setState(() {
      _selected = warehouse;
      _products = null;
      _productError = null;
    });
    await _loadProducts();
  }

  Future<void> _loadProducts() async {
    final warehouse = _selected;
    if (warehouse == null) return;
    final generation = ++_productGeneration;
    setState(() {
      _loadingProducts = true;
      _productError = null;
    });
    try {
      final page = await _inventoryApi!.listWarehouseProducts(
        warehouseId: warehouse.id,
        pageSize: 100,
        q: _productSearch.text,
        includeInactive: _includeInactiveProducts,
      );
      if (!mounted || generation != _productGeneration) return;
      setState(() {
        _products = page;
        _loadingProducts = false;
      });
    } catch (error) {
      if (!mounted || generation != _productGeneration) return;
      setState(() {
        _loadingProducts = false;
        _productError = inventoryErrorMessage(error);
      });
    }
  }

  Iterable<WarehouseRecord> get _visibleWarehouses {
    final keyword = _warehouseSearch.text.trim().toLowerCase();
    if (keyword.isEmpty) return _warehouses;
    return _warehouses.where((warehouse) =>
        warehouse.code.toLowerCase().contains(keyword) ||
        warehouse.name.toLowerCase().contains(keyword) ||
        (warehouse.managerName ?? '').toLowerCase().contains(keyword));
  }

  List<WarehouseRecord> _childrenOf(String parentId) => _visibleWarehouses
      .where((warehouse) => warehouse.parentWarehouseId == parentId)
      .toList();

  Future<void> _showWarehouseEditor({
    WarehouseRecord? warehouse,
    String? initialParentId,
  }) async {
    if (!_canManage) return;
    final result = await showDialog<WarehouseRecord>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _WarehouseEditorDialog(
        warehouse: warehouse,
        parentWarehouses: _warehouses
            .where((item) =>
                item.parentWarehouseId == null && item.id != warehouse?.id)
            .toList(),
        initialParentId: initialParentId,
        onSave: (value) async {
          if (warehouse == null) {
            return _inventoryApi!.createWarehouse(
              code: value.code,
              name: value.name,
              managerUserId: value.managerUserId,
              isActive: value.isActive,
              parentWarehouseId: value.parentWarehouseId,
            );
          }
          return _inventoryApi!.updateWarehouse(
            warehouseId: warehouse.id,
            code: value.code,
            name: value.name,
            managerUserId: value.managerUserId,
            includeManagerUserId: true,
            isActive: value.isActive,
            parentWarehouseId: value.parentWarehouseId,
            includeParentWarehouseId: true,
          );
        },
      ),
    );
    if (result == null || !mounted) return;
    _inventoryApi!.clearCache();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(warehouse == null ? '仓库已创建。' : '仓库资料已更新。')),
    );
    await _loadWarehouses(selectId: result.id);
  }

  Future<void> _setDefault(WarehouseRecord warehouse) async {
    if (!_canManage || warehouse.parentWarehouseId != null) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: '设置默认仓库',
      content: '将“${warehouse.name}”设为默认履约父仓？原默认仓会自动取消。',
      confirmLabel: '设置默认',
    );
    if (!confirmed || !mounted) return;
    await _runWarehouseAction(
      'default:${warehouse.id}',
      () => _inventoryApi!.updateWarehouse(
        warehouseId: warehouse.id,
        isDefault: true,
      ),
      '默认仓库已更新。',
      warehouse.id,
    );
  }

  Future<void> _toggleWarehouse(WarehouseRecord warehouse) async {
    if (!_canManage) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: warehouse.isActive ? '停用仓库' : '启用仓库',
      content: warehouse.isActive
          ? '停用“${warehouse.name}”后将不能用于新业务；存在库存、占用、在途、未完成单据或盘点时，后端会拒绝。'
          : '重新启用“${warehouse.name}”？',
      confirmLabel: warehouse.isActive ? '确认停用' : '确认启用',
      danger: warehouse.isActive,
    );
    if (!confirmed || !mounted) return;
    await _runWarehouseAction(
      'active:${warehouse.id}',
      () => _inventoryApi!.updateWarehouse(
        warehouseId: warehouse.id,
        isActive: !warehouse.isActive,
      ),
      warehouse.isActive ? '仓库已停用。' : '仓库已启用。',
      warehouse.id,
    );
  }

  Future<void> _deleteWarehouse(WarehouseRecord warehouse) async {
    if (!_canManage) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: '永久删除空仓库',
      content:
          '仅从未产生库存事实、业务单据、逐瓶记录或订单履约关系，且没有子仓的空仓库可以删除。删除“${warehouse.name}”后无法恢复，是否继续？',
      confirmLabel: '永久删除',
      danger: true,
    );
    if (!confirmed || !mounted) return;
    final key = 'delete:${warehouse.id}';
    if (_busy.contains(key)) return;
    setState(() => _busy.add(key));
    try {
      await _inventoryApi!.deleteWarehouse(warehouse.id);
      if (!mounted) return;
      _inventoryApi!.clearCache();
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('空仓库已永久删除。')));
      setState(() => _selected = null);
      await _loadWarehouses();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(inventoryErrorMessage(error))),
      );
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  Future<void> _runWarehouseAction(
    String key,
    Future<WarehouseRecord> Function() action,
    String successMessage,
    String selectId,
  ) async {
    if (_busy.contains(key)) return;
    setState(() => _busy.add(key));
    try {
      await action();
      if (!mounted) return;
      _inventoryApi!.clearCache();
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(successMessage)));
      await _loadWarehouses(selectId: selectId);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(inventoryErrorMessage(error))),
      );
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  Future<void> _showAddProduct() async {
    final warehouse = _selected;
    if (!_canManage || warehouse == null || _businessApi == null) return;
    List<ProductOptionRecord> options;
    try {
      options = (await _businessApi!.listProductOptions())
          .where((item) => item.inventoryTrackingMode != 'none')
          .toList();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(inventoryErrorMessage(error))),
      );
      return;
    }
    if (!mounted) return;
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _AddWarehouseProductDialog(
        warehouse: warehouse,
        products: options,
        onAdd: ({
          required productId,
          required initialQuantity,
          required idempotencyKey,
        }) =>
            _inventoryApi!.addWarehouseProduct(
          warehouseId: warehouse.id,
          productId: productId,
          initialQuantity: initialQuantity,
          idempotencyKey: idempotencyKey,
        ),
      ),
    );
    if (result == null || !mounted) return;
    _inventoryApi!.clearCache();
    await _loadProducts();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          result
              ? '逐瓶商品已按零库存加入，请到逐瓶库存页面录入真实物流码。'
              : '商品已加入仓库；非零期初数量已通过正式单据和流水记账。',
        ),
      ),
    );
    if (result) widget.onOpenDestination('moutai_inventory');
  }

  Future<void> _deactivateProduct(WarehouseProductRecord product) async {
    if (!_canManage || _selected == null) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: '移除仓库商品',
      content:
          '只有本仓现存、占用、不可售、在途均为零，且没有有效逐瓶记录时才能移除“${product.productName}”。历史流水和关联记录仍会保留。',
      confirmLabel: '确认移除',
      danger: true,
    );
    if (!confirmed || !mounted) return;
    final key = 'product:${product.productId}';
    if (_busy.contains(key)) return;
    setState(() => _busy.add(key));
    try {
      await _inventoryApi!.deactivateWarehouseProduct(
        warehouseId: _selected!.id,
        productId: product.productId,
      );
      if (!mounted) return;
      _inventoryApi!.clearCache();
      await _loadProducts();
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('仓库商品已停用。')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(inventoryErrorMessage(error))),
      );
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  void _openInventoryModule(
    WarehouseProductRecord product,
    String moduleId, {
    String? action,
  }) {
    final warehouse = _selected;
    if (warehouse == null) return;
    InventoryNavigationHandoff.put(
      InventoryNavigationRequest(
        moduleId: moduleId,
        warehouseId: warehouse.id,
        productId: product.productId,
        action: action,
      ),
    );
    widget.onOpenDestination('warehouse_management');
  }

  @override
  Widget build(BuildContext context) {
    if (!_canRead) {
      return const Center(
        key: ValueKey('warehouse-directory-access-denied'),
        child: FormSection(
          title: '仓库管理',
          children: [Text('当前角色无权访问仓库管理，且不会发起库存 API 请求。')],
        ),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 960;
        return Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildHeader(),
              const SizedBox(height: 12),
              Expanded(
                child: wide
                    ? Row(
                        key: const ValueKey('warehouse-directory-wide-layout'),
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          SizedBox(width: 320, child: _buildWarehousePane()),
                          const SizedBox(width: 16),
                          Expanded(child: _buildDetailPane(mobile: false)),
                        ],
                      )
                    : _selected == null
                        ? KeyedSubtree(
                            key: const ValueKey(
                                'warehouse-directory-mobile-list'),
                            child: _buildWarehousePane(),
                          )
                        : KeyedSubtree(
                            key: const ValueKey(
                                'warehouse-directory-mobile-detail'),
                            child: _buildDetailPane(mobile: true),
                          ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildHeader() => Row(
        children: [
          const Icon(Icons.account_tree_rounded, size: 28),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('仓库管理', style: Theme.of(context).textTheme.headlineSmall),
                const Text('维护两级仓库档案与仓库商品；数量调整继续使用现有库存流程。'),
              ],
            ),
          ),
          if (_canManage)
            FilledButton.icon(
              key: const ValueKey('warehouse-directory-create-root'),
              onPressed: () => _showWarehouseEditor(),
              icon: const Icon(Icons.add),
              label: const Text('新建父仓'),
            ),
        ],
      );

  Widget _buildWarehousePane() {
    if (_loadingWarehouses && _warehouses.isEmpty) {
      return const LoadingState(title: '正在加载仓库');
    }
    if (_warehouseError != null && _warehouses.isEmpty) {
      return ErrorState(title: _warehouseError!, onRetry: _loadWarehouses);
    }
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              key: const ValueKey('warehouse-directory-search'),
              controller: _warehouseSearch,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                labelText: '搜索编号、名称、负责人',
                prefixIcon: Icon(Icons.search),
              ),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<bool?>(
              key: const ValueKey('warehouse-directory-active-filter'),
              initialValue: _activeFilter,
              decoration: const InputDecoration(labelText: '启用状态'),
              items: const [
                DropdownMenuItem(value: null, child: Text('全部状态')),
                DropdownMenuItem(value: true, child: Text('仅启用')),
                DropdownMenuItem(value: false, child: Text('仅停用')),
              ],
              onChanged: (value) {
                setState(() => _activeFilter = value);
                _loadWarehouses();
              },
            ),
            const SizedBox(height: 8),
            Expanded(child: _buildWarehouseTree()),
          ],
        ),
      ),
    );
  }

  Widget _buildWarehouseTree() {
    final visible = _visibleWarehouses.toList();
    if (visible.isEmpty) {
      return const EmptyState(title: '没有符合条件的仓库');
    }
    final roots = visible
        .where((warehouse) => warehouse.parentWarehouseId == null)
        .toList();
    final orphans = visible
        .where((warehouse) =>
            warehouse.parentWarehouseId != null &&
            !visible.any((item) => item.id == warehouse.parentWarehouseId))
        .toList();
    return ListView(
      children: [
        for (final root in [...roots, ...orphans]) ...[
          _WarehouseTile(
            warehouse: root,
            selected: _selected?.id == root.id,
            depth: root.parentWarehouseId == null ? 0 : 1,
            onTap: () => _selectWarehouse(root),
          ),
          if (root.parentWarehouseId == null)
            for (final child in _childrenOf(root.id))
              _WarehouseTile(
                warehouse: child,
                selected: _selected?.id == child.id,
                depth: 1,
                onTap: () => _selectWarehouse(child),
              ),
        ],
      ],
    );
  }

  Widget _buildDetailPane({required bool mobile}) {
    final warehouse = _selected;
    if (warehouse == null) {
      return const Center(child: EmptyState(title: '请选择仓库'));
    }
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (mobile)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => setState(() => _selected = null),
                  icon: const Icon(Icons.arrow_back),
                  label: const Text('返回仓库列表'),
                ),
              ),
            _buildWarehouseSummary(warehouse),
            const Divider(height: 24),
            _buildProductToolbar(),
            const SizedBox(height: 8),
            Expanded(child: _buildProducts(mobile: mobile)),
          ],
        ),
      ),
    );
  }

  Widget _buildWarehouseSummary(WarehouseRecord warehouse) {
    final isChild = warehouse.parentWarehouseId != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text('${warehouse.name} · ${warehouse.code}',
                style: Theme.of(context).textTheme.titleLarge),
            StatusTag(
              label: isChild ? '子仓' : '父仓',
              tone: isChild ? StatusTone.info : StatusTone.success,
            ),
            StatusTag(
              label: warehouse.isActive ? '已启用' : '已停用',
              tone:
                  warehouse.isActive ? StatusTone.success : StatusTone.neutral,
            ),
            if (warehouse.isDefault)
              const StatusTag(label: '默认履约仓', tone: StatusTone.info),
          ],
        ),
        const SizedBox(height: 8),
        Text('负责人：${warehouse.managerName ?? '未设置'}'),
        if (isChild) Text('所属父仓：${warehouse.parentWarehouseName ?? '-'}'),
        if (!isChild) Text('直属子仓：${warehouse.childWarehouseCount} 个'),
        if (_canManage) ...[
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (!isChild)
                OutlinedButton.icon(
                  key: const ValueKey('warehouse-directory-create-child'),
                  onPressed: () =>
                      _showWarehouseEditor(initialParentId: warehouse.id),
                  icon: const Icon(Icons.add_home_work_outlined),
                  label: const Text('新建子仓'),
                ),
              OutlinedButton.icon(
                key: const ValueKey('warehouse-directory-edit'),
                onPressed: () => _showWarehouseEditor(warehouse: warehouse),
                icon: const Icon(Icons.edit_outlined),
                label: const Text('编辑'),
              ),
              OutlinedButton.icon(
                key: const ValueKey('warehouse-directory-toggle'),
                onPressed: _busy.contains('active:${warehouse.id}')
                    ? null
                    : () => _toggleWarehouse(warehouse),
                icon: Icon(warehouse.isActive
                    ? Icons.pause_circle_outline
                    : Icons.play_circle_outline),
                label: Text(warehouse.isActive ? '停用' : '启用'),
              ),
              if (!isChild && !warehouse.isDefault)
                OutlinedButton.icon(
                  key: const ValueKey('warehouse-directory-set-default'),
                  onPressed: _busy.contains('default:${warehouse.id}')
                      ? null
                      : () => _setDefault(warehouse),
                  icon: const Icon(Icons.star_outline),
                  label: const Text('设为默认'),
                ),
              OutlinedButton.icon(
                key: const ValueKey('warehouse-directory-delete'),
                onPressed: _busy.contains('delete:${warehouse.id}')
                    ? null
                    : () => _deleteWarehouse(warehouse),
                icon: const Icon(Icons.delete_outline),
                label: const Text('删除'),
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildProductToolbar() => Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SizedBox(
            width: 280,
            child: TextField(
              key: const ValueKey('warehouse-directory-product-search'),
              controller: _productSearch,
              onSubmitted: (_) => _loadProducts(),
              decoration: const InputDecoration(
                labelText: '搜索商品名称或 ID',
                prefixIcon: Icon(Icons.search),
              ),
            ),
          ),
          FilterChip(
            key:
                const ValueKey('warehouse-directory-include-inactive-products'),
            selected: _includeInactiveProducts,
            label: const Text('包含已停用商品'),
            onSelected: (value) {
              setState(() => _includeInactiveProducts = value);
              _loadProducts();
            },
          ),
          OutlinedButton.icon(
            onPressed: _loadProducts,
            icon: const Icon(Icons.refresh),
            label: const Text('刷新'),
          ),
          if (_canManage)
            FilledButton.icon(
              key: const ValueKey('warehouse-directory-add-product'),
              onPressed: _showAddProduct,
              icon: const Icon(Icons.playlist_add),
              label: const Text('添加商品'),
            ),
        ],
      );

  Widget _buildProducts({required bool mobile}) {
    if (_loadingProducts && _products == null) {
      return const LoadingState(title: '正在加载仓库商品');
    }
    if (_productError != null && _products == null) {
      return ErrorState(title: _productError!, onRetry: _loadProducts);
    }
    final products = _products?.products ?? const <WarehouseProductRecord>[];
    if (products.isEmpty) {
      return const EmptyState(title: '当前仓库还没有符合条件的商品');
    }
    if (mobile) {
      return ListView.separated(
        itemCount: products.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, index) => _buildProductCard(products[index]),
      );
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SingleChildScrollView(
        primary: false,
        child: DataTable(
          key: const ValueKey('warehouse-directory-product-table'),
          columns: const [
            DataColumn(label: Text('商品')),
            DataColumn(label: Text('库存模式')),
            DataColumn(label: Text('本仓现存')),
            DataColumn(label: Text('本仓占用')),
            DataColumn(label: Text('本仓不可售')),
            DataColumn(label: Text('本仓实际可售')),
            DataColumn(label: Text('含子仓汇总')),
            DataColumn(label: Text('状态')),
            DataColumn(label: Text('最近变动')),
            DataColumn(label: Text('操作')),
          ],
          rows: [for (final product in products) _productRow(product)],
        ),
      ),
    );
  }

  DataRow _productRow(WarehouseProductRecord product) => DataRow(cells: [
        DataCell(Text('${product.productName}\n${product.productId}')),
        DataCell(Text(_trackingModeLabel(product.inventoryTrackingMode))),
        DataCell(Text('${product.localStock.onHandQty} 瓶')),
        DataCell(Text('${product.localStock.reservedQty} 瓶')),
        DataCell(Text('${product.localStock.unavailableQty} 瓶')),
        DataCell(Text('${product.localStock.availableQty} 瓶')),
        DataCell(Text(product.includesChildWarehouses
            ? '${product.inclusiveStock.onHandQty} / 可售 ${product.inclusiveStock.availableQty} 瓶'
            : '—')),
        DataCell(StatusTag(
          label: product.isActive ? '已启用' : '已停用',
          tone: product.isActive ? StatusTone.success : StatusTone.neutral,
        )),
        DataCell(Text(product.lastMovementAt ?? '暂无')),
        DataCell(_productActions(product)),
      ]);

  Widget _buildProductCard(WarehouseProductRecord product) => Card(
        key: ValueKey('warehouse-directory-product-${product.productId}'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(product.productName,
                  style: Theme.of(context).textTheme.titleMedium),
              Text(product.productId),
              const SizedBox(height: 8),
              Text('库存模式：${_trackingModeLabel(product.inventoryTrackingMode)}'),
              Text(
                  '本仓：现存 ${product.localStock.onHandQty} · 占用 ${product.localStock.reservedQty} · 不可售 ${product.localStock.unavailableQty} · 在途 ${product.localStock.inTransitQty} · 实际可售 ${product.localStock.availableQty}'),
              if (product.includesChildWarehouses)
                Text(
                  '含子仓汇总：现存 ${product.inclusiveStock.onHandQty} · 实际可售 ${product.inclusiveStock.availableQty}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              Text(
                  '状态：${product.isActive ? '已启用' : '已停用'} · 最近变动：${product.lastMovementAt ?? '暂无'}'),
              const SizedBox(height: 8),
              _productActions(product),
            ],
          ),
        ),
      );

  Widget _productActions(WarehouseProductRecord product) => Wrap(
        spacing: 4,
        runSpacing: 4,
        children: [
          if (canStocktakeWrite(widget.role))
            TextButton(
              key: ValueKey(
                  'warehouse-directory-stocktake-${product.productId}'),
              onPressed: () =>
                  _openInventoryModule(product, 'stocktake', action: 'create'),
              child: const Text('盘点/调整'),
            ),
          TextButton(
            key: ValueKey('warehouse-directory-movement-${product.productId}'),
            onPressed: () => _openInventoryModule(product, 'movement'),
            child: const Text('库存流水'),
          ),
          if (product.isSerialized)
            TextButton(
              onPressed: () => widget.onOpenDestination('moutai_inventory'),
              child: const Text('逐瓶库存'),
            ),
          if (_canManage && product.isActive)
            TextButton(
              key: ValueKey('warehouse-directory-remove-${product.productId}'),
              onPressed: _busy.contains('product:${product.productId}')
                  ? null
                  : () => _deactivateProduct(product),
              child: const Text('移除'),
            ),
        ],
      );
}

class _WarehouseTile extends StatelessWidget {
  const _WarehouseTile({
    required this.warehouse,
    required this.selected,
    required this.depth,
    required this.onTap,
  });
  final WarehouseRecord warehouse;
  final bool selected;
  final int depth;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(left: depth * 22.0),
        child: ListTile(
          key: ValueKey('warehouse-directory-warehouse-${warehouse.id}'),
          selected: selected,
          onTap: onTap,
          leading: Icon(
              depth == 0 ? Icons.warehouse : Icons.subdirectory_arrow_right),
          title: Text(warehouse.name),
          subtitle: Text(
              '${warehouse.code} · ${warehouse.isActive ? '启用' : '停用'}${warehouse.isDefault ? ' · 默认' : ''}'),
        ),
      );
}

class _WarehouseEditorValue {
  const _WarehouseEditorValue({
    required this.code,
    required this.name,
    required this.managerUserId,
    required this.parentWarehouseId,
    required this.isActive,
  });
  final String code;
  final String name;
  final String? managerUserId;
  final String? parentWarehouseId;
  final bool isActive;
}

class _WarehouseEditorDialog extends StatefulWidget {
  const _WarehouseEditorDialog({
    required this.warehouse,
    required this.parentWarehouses,
    required this.initialParentId,
    required this.onSave,
  });
  final WarehouseRecord? warehouse;
  final List<WarehouseRecord> parentWarehouses;
  final String? initialParentId;
  final Future<WarehouseRecord> Function(_WarehouseEditorValue value) onSave;

  @override
  State<_WarehouseEditorDialog> createState() => _WarehouseEditorDialogState();
}

class _WarehouseEditorDialogState extends State<_WarehouseEditorDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _code;
  late final TextEditingController _name;
  late final TextEditingController _manager;
  String? _parentId;
  late bool _isActive;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _code = TextEditingController(text: widget.warehouse?.code ?? '');
    _name = TextEditingController(text: widget.warehouse?.name ?? '');
    _manager =
        TextEditingController(text: widget.warehouse?.managerUserId ?? '');
    _parentId = widget.initialParentId ?? widget.warehouse?.parentWarehouseId;
    _isActive = widget.warehouse?.isActive ?? true;
  }

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    _manager.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting || !_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final warehouse = await widget.onSave(_WarehouseEditorValue(
        code: _code.text.trim(),
        name: _name.text.trim(),
        managerUserId:
            _manager.text.trim().isEmpty ? null : _manager.text.trim(),
        parentWarehouseId: _parentId,
        isActive: _isActive,
      ));
      if (mounted) Navigator.pop(context, warehouse);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = inventoryErrorMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.warehouse == null ? '新建仓库' : '编辑仓库'),
        content: SizedBox(
          width: 520,
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                TextFormField(
                  key: const ValueKey('warehouse-editor-code'),
                  controller: _code,
                  decoration: const InputDecoration(labelText: '仓库编号 *'),
                  validator: (value) =>
                      value == null || value.trim().isEmpty ? '请填写仓库编号' : null,
                ),
                TextFormField(
                  key: const ValueKey('warehouse-editor-name'),
                  controller: _name,
                  decoration: const InputDecoration(labelText: '仓库名称 *'),
                  validator: (value) =>
                      value == null || value.trim().isEmpty ? '请填写仓库名称' : null,
                ),
                TextFormField(
                  key: const ValueKey('warehouse-editor-manager'),
                  controller: _manager,
                  decoration: const InputDecoration(
                    labelText: '负责人账号 ID',
                    helperText: '留空表示暂不指定负责人',
                  ),
                ),
                DropdownButtonFormField<String?>(
                  key: const ValueKey('warehouse-editor-parent'),
                  initialValue: _parentId,
                  decoration: const InputDecoration(labelText: '所属父仓'),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('无（父仓）')),
                    for (final parent in widget.parentWarehouses)
                      DropdownMenuItem(
                        value: parent.id,
                        child: Text('${parent.name} · ${parent.code}'),
                      ),
                  ],
                  onChanged: (value) => setState(() => _parentId = value),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('启用仓库'),
                  value: _isActive,
                  onChanged: (value) => setState(() => _isActive = value),
                ),
                if (_error != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(_error!,
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error)),
                  ),
              ]),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: _submitting ? null : () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            key: const ValueKey('warehouse-editor-submit'),
            onPressed: _submitting ? null : _submit,
            child: Text(_submitting ? '保存中…' : '保存'),
          ),
        ],
      );
}

typedef _AddProductCallback = Future<WarehouseProductRecord?> Function({
  required String productId,
  required int initialQuantity,
  required String idempotencyKey,
});

class _AddWarehouseProductDialog extends StatefulWidget {
  const _AddWarehouseProductDialog({
    required this.warehouse,
    required this.products,
    required this.onAdd,
  });
  final WarehouseRecord warehouse;
  final List<ProductOptionRecord> products;
  final _AddProductCallback onAdd;

  @override
  State<_AddWarehouseProductDialog> createState() =>
      _AddWarehouseProductDialogState();
}

class _AddWarehouseProductDialogState
    extends State<_AddWarehouseProductDialog> {
  final _quantity = TextEditingController(text: '0');
  late final String _idempotencyKey;
  ProductOptionRecord? _product;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _idempotencyKey =
        'warehouse-product-ui-${DateTime.now().microsecondsSinceEpoch}';
  }

  @override
  void dispose() {
    _quantity.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting || _product == null) return;
    final quantity = int.tryParse(_quantity.text.trim());
    if (quantity == null || quantity < 0) {
      setState(() => _error = '初始数量必须是非负整数。');
      return;
    }
    final serialized = _product!.usesSerializedInventory;
    if (serialized && quantity != 0) {
      setState(() => _error = '逐瓶商品不能只填写汇总数量；请以零库存添加后录入真实物流码。');
      return;
    }
    final confirmed = await confirmInventoryAction(
      context,
      title: '确认添加仓库商品',
      content: serialized
          ? '将“${_product!.name}”以零库存加入“${widget.warehouse.name}”，随后进入逐瓶库存页面录入真实物流码？'
          : '将“${_product!.name}”加入“${widget.warehouse.name}”，并以正式期初库存单据记入 $quantity 瓶？期初操作不能覆盖既有历史。',
      confirmLabel: '确认添加',
    );
    if (!confirmed || !mounted) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.onAdd(
        productId: _product!.id,
        initialQuantity: quantity,
        idempotencyKey: _idempotencyKey,
      );
      if (mounted) Navigator.pop(context, serialized);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = inventoryErrorMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('添加仓库商品'),
        content: SizedBox(
          width: 520,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<ProductOptionRecord>(
              key: const ValueKey('warehouse-product-editor-product'),
              initialValue: _product,
              isExpanded: true,
              decoration: const InputDecoration(labelText: '现有商品 *'),
              items: [
                for (final product in widget.products)
                  DropdownMenuItem(value: product, child: Text(product.label)),
              ],
              onChanged: _submitting
                  ? null
                  : (value) {
                      setState(() {
                        _product = value;
                        if (value?.usesSerializedInventory == true) {
                          _quantity.text = '0';
                        }
                      });
                    },
            ),
            TextField(
              key: const ValueKey('warehouse-product-editor-quantity'),
              controller: _quantity,
              enabled:
                  !_submitting && !(_product?.usesSerializedInventory ?? false),
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: '初始数量（瓶）',
                helperText: _product?.usesSerializedInventory == true
                    ? '逐瓶商品固定为 0；实际数量由真实物流码记录计算。'
                    : '非零数量将调用现有期初库存记账链路。',
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!,
                    style:
                        TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
          ]),
        ),
        actions: [
          TextButton(
            onPressed: _submitting ? null : () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            key: const ValueKey('warehouse-product-editor-submit'),
            onPressed: _submitting || _product == null ? null : _submit,
            child: Text(_submitting ? '提交中…' : '添加'),
          ),
        ],
      );
}

String _trackingModeLabel(String mode) {
  switch (mode.toLowerCase()) {
    case 'serialized':
      return '逐瓶';
    case 'quantity':
      return '普通数量';
    default:
      return '未启用';
  }
}
