part of '../inventory_workspace_tabs.dart';

class UnavailableTab extends StatefulWidget {
  const UnavailableTab({
    super.key,
    required this.api,
    required this.businessApi,
    required this.role,
    this.onOpenSerialized,
    this.onInventoryFactsChanged,
    this.requestedSelection,
    this.filterRequestRevision = 0,
  });

  final InventoryApi api;
  final BusinessApi businessApi;
  final UserRole role;
  final VoidCallback? onOpenSerialized;
  final VoidCallback? onInventoryFactsChanged;
  final InventorySelectionContext? requestedSelection;
  final int filterRequestRevision;

  @override
  State<UnavailableTab> createState() => _UnavailableTabState();
}

class _UnavailableTabState extends State<UnavailableTab> {
  final _reasonFilter = TextEditingController();
  StockPage? _page;
  List<WarehouseRecord> _warehouses = const [];
  List<ProductOptionRecord> _products = const [];
  StockRecord? _selected;
  String? _warehouseId;
  String? _productId;
  bool _loading = true;
  bool _referencesLoading = true;
  String? _error;
  int _pageNumber = 1;
  int _generation = 0;
  final Set<String> _busy = {};

  bool get _canWrite => canInboundWrite(widget.role);

  @override
  void initState() {
    super.initState();
    _applySelection();
    _loadReferences();
    _load();
  }

  @override
  void didUpdateWidget(covariant UnavailableTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.filterRequestRevision != widget.filterRequestRevision) {
      _applySelection();
      _pageNumber = 1;
      _load();
    }
  }

  @override
  void dispose() {
    _reasonFilter.dispose();
    super.dispose();
  }

  void _applySelection() {
    _warehouseId = widget.requestedSelection?.warehouseId;
    _productId = widget.requestedSelection?.productId;
  }

  Future<void> _loadReferences() async {
    try {
      final values = await Future.wait([
        widget.api.listWarehouses(isActive: true),
        widget.businessApi.listProductOptions(),
      ]);
      if (!mounted) return;
      setState(() {
        _warehouses = values[0] as List<WarehouseRecord>;
        _products = values[1] as List<ProductOptionRecord>;
        _referencesLoading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _referencesLoading = false);
    }
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.api.listStocks(
        page: _pageNumber,
        pageSize: 20,
        warehouseId: _warehouseId,
        productId: _productId,
      );
      if (!mounted || generation != _generation) return;
      StockRecord? selected;
      final selectedId = _selected?.id;
      if (selectedId != null) {
        for (final stock in page.stocks) {
          if (stock.id == selectedId) {
            selected = stock;
            break;
          }
        }
      }
      selected ??= page.stocks.isEmpty ? null : page.stocks.first;
      setState(() {
        _page = page;
        _selected = selected;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = inventoryErrorMessage(error);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        InventoryFilterBar(
          actions: [
            FilledButton(
              key: const ValueKey('unavailable-apply-filters'),
              onPressed: () {
                _pageNumber = 1;
                setState(() {});
                _load();
              },
              child: const Text('查询'),
            ),
            TextButton(
              onPressed: () {
                setState(() {
                  _warehouseId = null;
                  _productId = null;
                  _reasonFilter.clear();
                  _pageNumber = 1;
                });
                _load();
              },
              child: const Text('重置'),
            ),
            IconButton(
              tooltip: '刷新',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
          children: [
            SizedBox(
              width: 190,
              child: DropdownButtonFormField<String?>(
                key: const ValueKey('unavailable-warehouse-filter'),
                initialValue: _warehouseId,
                decoration: const InputDecoration(labelText: '仓库'),
                isExpanded: true,
                items: [
                  const DropdownMenuItem(value: null, child: Text('全部仓库')),
                  if (_warehouseId != null &&
                      !_warehouses.any(
                        (warehouse) => warehouse.id == _warehouseId,
                      ))
                    DropdownMenuItem(
                      value: _warehouseId,
                      child: Text(_warehouseId!),
                    ),
                  ..._warehouses.map(
                    (warehouse) => DropdownMenuItem(
                      value: warehouse.id,
                      child: Text(
                        '${warehouse.code} · ${warehouse.name}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                ],
                onChanged: _referencesLoading
                    ? null
                    : (value) => setState(() => _warehouseId = value),
              ),
            ),
            SizedBox(
              width: 210,
              child: DropdownButtonFormField<String?>(
                key: const ValueKey('unavailable-product-filter'),
                initialValue: _productId,
                decoration: const InputDecoration(labelText: '商品'),
                isExpanded: true,
                items: [
                  const DropdownMenuItem(value: null, child: Text('全部商品')),
                  if (_productId != null &&
                      !_products.any((product) => product.id == _productId))
                    DropdownMenuItem(
                      value: _productId,
                      child: Text(_productId!),
                    ),
                  ..._products.map(
                    (product) => DropdownMenuItem(
                      value: product.id,
                      child: Text(
                        product.name,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                ],
                onChanged: _referencesLoading
                    ? null
                    : (value) => setState(() => _productId = value),
              ),
            ),
            SizedBox(
              width: 220,
              child: TextField(
                key: const ValueKey('unavailable-reason-filter'),
                controller: _reasonFilter,
                decoration: const InputDecoration(
                  labelText: '原因',
                  helperText: '接口暂不支持原因筛选',
                ),
              ),
            ),
          ],
        ),
        if (_reasonFilter.text.trim().isNotEmpty)
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: InventoryInlineNotice(
              message: '后端当前未提供不可售原因查询字段，本页不会只筛选当前分页制造假结果。',
              tone: StatusTone.warning,
            ),
          ),
        const Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: InventoryInlineNotice(
            message: '标记或恢复只改变不可售数量与实际可售，不改变账面现存数量。',
            tone: StatusTone.info,
          ),
        ),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _buildBody() {
    if (_loading) return const LoadingState(title: '正在加载库存状态');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _page;
    if (page == null || page.stocks.isEmpty) {
      return EmptyState(
        title: '没有符合条件的库存项',
        action: OutlinedButton.icon(
          onPressed: _load,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('刷新'),
        ),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 900) {
          return Row(
            children: [
              Expanded(flex: 3, child: _desktopTable(page)),
              const VerticalDivider(width: 1),
              Expanded(flex: 2, child: _detail(_selected)),
            ],
          );
        }
        return _mobileCards(page);
      },
    );
  }

  Widget _desktopTable(StockPage page) {
    return Column(
      children: [
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SingleChildScrollView(
              child: DataTable(
                columns: const [
                  DataColumn(label: Text('仓库')),
                  DataColumn(label: Text('商品')),
                  DataColumn(label: Text('模式')),
                  DataColumn(label: Text('账面现存'), numeric: true),
                  DataColumn(label: Text('不可售'), numeric: true),
                  DataColumn(label: Text('实际可售'), numeric: true),
                  DataColumn(label: Text('状态')),
                ],
                rows: page.stocks.map((stock) {
                  return DataRow(
                    key: ValueKey('unavailable-row-${stock.id}'),
                    selected: stock.id == _selected?.id,
                    onSelectChanged: (_) => setState(() => _selected = stock),
                    cells: [
                      DataCell(Text(stock.warehouseName)),
                      DataCell(Text(stock.productName)),
                      DataCell(Text(_trackingLabel(stock))),
                      DataCell(BottleQuantityText(stock.onHandQty)),
                      DataCell(BottleQuantityText(stock.unavailableQty)),
                      DataCell(BottleQuantityText(stock.availableQty)),
                      DataCell(_status(stock)),
                    ],
                  );
                }).toList(),
              ),
            ),
          ),
        ),
        _pagination(page),
      ],
    );
  }

  Widget _mobileCards(StockPage page) {
    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            itemCount: page.stocks.length,
            itemBuilder: (context, index) {
              final stock = page.stocks[index];
              return Card(
                key: ValueKey('unavailable-card-${stock.id}'),
                child: ListTile(
                  title: Text(stock.productName),
                  subtitle: Text(
                    '${stock.warehouseName} · 不可售 ${stock.unavailableQty} 瓶\n'
                    '账面现存 ${stock.onHandQty} 瓶 · '
                    '实际可售 ${stock.availableQty} 瓶',
                  ),
                  isThreeLine: true,
                  trailing: _status(stock),
                  onTap: () => showModalBottomSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    showDragHandle: true,
                    builder: (context) => SafeArea(
                      child: SizedBox(
                        height: MediaQuery.sizeOf(context).height * .75,
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: _detail(stock),
                        ),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        _pagination(page),
      ],
    );
  }

  Widget _pagination(StockPage page) {
    return InventoryPagination(
      page: page.page,
      totalPages: page.totalPages < 1 ? 1 : page.totalPages,
      onPrevious: page.page > 1
          ? () {
              _pageNumber--;
              _load();
            }
          : null,
      onNext: page.page < page.totalPages
          ? () {
              _pageNumber++;
              _load();
            }
          : null,
    );
  }

  Widget _detail(StockRecord? stock) {
    if (stock == null) return const EmptyState(title: '选择库存项查看详情');
    final serialized =
        stock.inventoryTrackingMode.toLowerCase() == 'serialized';
    return ListView(
      key: ValueKey('unavailable-detail-${stock.id}'),
      padding: const EdgeInsets.all(12),
      children: [
        Text(stock.productName, style: Theme.of(context).textTheme.titleLarge),
        Text('${stock.warehouseCode} · ${stock.warehouseName}'),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            BottleQuantitySummary(label: '账面现存', quantity: stock.onHandQty),
            BottleQuantitySummary(
              label: '不可售',
              quantity: stock.unavailableQty,
              tone: stock.unavailableQty > 0
                  ? StatusTone.warning
                  : StatusTone.success,
            ),
            BottleQuantitySummary(
              label: '实际可售',
              quantity: stock.availableQty,
              tone: stock.availableQty < 0
                  ? StatusTone.danger
                  : StatusTone.success,
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (serialized)
          const InventoryUnavailableCard(
            keyPrefix: 'serialized-unavailable-blocked',
            title: '逐瓶不可售转换等待接口',
            message: '该商品使用 SERIALIZED 模式。当前后端只提供 QUANTITY '
                '商品的不可售汇总转换，不能退化为修改汇总数量。',
          )
        else
          const InventoryInlineNotice(
            message: '执行后账面现存保持不变，仅不可售和实际可售发生变化。',
            tone: StatusTone.info,
          ),
        const SizedBox(height: 12),
        if (serialized && widget.onOpenSerialized != null)
          OutlinedButton.icon(
            key: const ValueKey('unavailable-open-serialized'),
            onPressed: widget.onOpenSerialized,
            icon: const Icon(Icons.qr_code_2_rounded),
            label: const Text('查看茅台逐瓶库存'),
          ),
        if (!serialized && _canWrite)
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton(
                key: ValueKey('warehouse-unavailable-mark-${stock.id}'),
                onPressed: _busy.contains('mark-${stock.id}')
                    ? null
                    : () => _showActionDialog(stock, restore: false),
                child: const Text('标记不可售'),
              ),
              OutlinedButton(
                key: ValueKey('warehouse-unavailable-restore-${stock.id}'),
                onPressed: stock.unavailableQty <= 0 ||
                        _busy.contains('restore-${stock.id}')
                    ? null
                    : () => _showActionDialog(stock, restore: true),
                child: const Text('恢复可售'),
              ),
            ],
          ),
        if (!_canWrite)
          const InventoryInlineNotice(
            message: '当前角色仅可查看，不显示库存数量调整操作。',
            tone: StatusTone.neutral,
          ),
      ],
    );
  }

  Future<void> _showActionDialog(
    StockRecord stock, {
    required bool restore,
  }) async {
    final quantity = TextEditingController();
    final reason = TextEditingController();
    final values = await showDialog<(int, String)>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: Text(restore ? '恢复可售' : '标记不可售'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('${stock.warehouseName} · ${stock.productName}'),
            const SizedBox(height: 12),
            TextField(
              key: ValueKey(
                restore
                    ? 'warehouse-unavailable-restore-qty'
                    : 'warehouse-unavailable-mark-qty',
              ),
              controller: quantity,
              decoration: const InputDecoration(
                labelText: '数量（瓶）',
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            ),
            const SizedBox(height: 12),
            TextField(
              key: ValueKey(
                restore
                    ? 'warehouse-unavailable-restore-reason'
                    : 'warehouse-unavailable-mark-reason',
              ),
              controller: reason,
              decoration: const InputDecoration(
                labelText: '原因（必填）',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () {
              final parsed = parseBottleQuantity(quantity.text);
              final message = reason.text.trim();
              if (parsed == null || message.isEmpty) return;
              if (restore && parsed > stock.unavailableQty) return;
              Navigator.pop(context, (parsed, message));
            },
            child: const Text('下一步'),
          ),
        ],
      ),
    );
    quantity.dispose();
    reason.dispose();
    if (values == null || !mounted) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: restore ? '二次确认恢复可售' : '二次确认标记不可售',
      content: '${restore ? '恢复' : '标记'} ${values.$1} 瓶。'
          '账面现存仍为 ${stock.onHandQty} 瓶，原因：${values.$2}',
      confirmLabel: restore ? '确认恢复' : '确认标记',
      danger: !restore,
    );
    if (!confirmed) return;
    final key = '${restore ? 'restore' : 'mark'}-${stock.id}';
    if (_busy.contains(key)) return;
    setState(() => _busy.add(key));
    try {
      if (restore) {
        await widget.api.restoreAvailable(
          warehouseId: stock.warehouseId,
          productId: stock.productId,
          quantity: values.$1,
          reason: values.$2,
        );
      } else {
        await widget.api.markUnavailable(
          warehouseId: stock.warehouseId,
          productId: stock.productId,
          quantity: values.$1,
          reason: values.$2,
        );
      }
      widget.onInventoryFactsChanged?.call();
      await _load();
    } catch (error) {
      if (mounted) _showSnack(inventoryErrorMessage(error));
      await _load();
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  InventoryStatusTag _status(StockRecord stock) {
    return InventoryStatusTag(
      label: stock.unavailableQty > 0 ? '不可售' : '可售',
      tone: stock.unavailableQty > 0 ? StatusTone.warning : StatusTone.success,
    );
  }

  String _trackingLabel(StockRecord stock) {
    return stock.inventoryTrackingMode.toLowerCase() == 'serialized'
        ? '逐瓶'
        : '数量';
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}
