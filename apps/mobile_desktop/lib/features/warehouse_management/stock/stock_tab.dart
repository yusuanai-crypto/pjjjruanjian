part of '../inventory_workspace_tabs.dart';

enum _StockStatusFilter {
  normal,
  lowStock,
  shortage,
  unavailable,
  pendingCost,
}

class WarehouseStockNavigationRequest {
  const WarehouseStockNavigationRequest({
    required this.moduleId,
    required this.warehouseId,
    required this.productId,
    this.action,
  });

  final String moduleId;
  final String warehouseId;
  final String productId;
  final String? action;
}

class StockTab extends StatefulWidget {
  const StockTab({
    super.key,
    required this.api,
    required this.role,
    required this.onNavigate,
    required this.onOpenSerialized,
    this.requestedFilter,
    this.filterRequestRevision = 0,
  });

  final InventoryApi api;
  final UserRole role;
  final ValueChanged<WarehouseStockNavigationRequest> onNavigate;
  final VoidCallback onOpenSerialized;
  final String? requestedFilter;
  final int filterRequestRevision;

  @override
  State<StockTab> createState() => _StockTabState();
}

class _StockTabState extends State<StockTab> {
  final _productController = TextEditingController();
  StockPage? _page;
  List<WarehouseRecord> _warehouses = const [];
  StockRecord? _selectedStock;
  String? _warehouseId;
  String? _trackingMode;
  _StockStatusFilter? _statusFilter;
  bool _loading = true;
  bool _loadingMore = false;
  bool _loadingWarehouses = true;
  String? _error;
  String? _warehouseError;
  int _pageNumber = 1;
  int _requestGeneration = 0;

  bool get _canReadCost => canReadInventoryCost(widget.role);

  bool get _hasFilters =>
      _warehouseId != null ||
      _productController.text.trim().isNotEmpty ||
      _trackingMode != null ||
      _statusFilter != null;

  String? get _blockedFilterMessage {
    return switch (_statusFilter) {
      _StockStatusFilter.normal =>
        '当前库存列表接口尚未提供“正常”服务端筛选参数。为避免只过滤当前页造成错误结果，此筛选暂不可用。',
      _StockStatusFilter.pendingCost =>
        '当前库存列表接口尚未提供“待补成本”服务端筛选参数。为避免用当前分页或商品实际成本补算，此筛选暂不可用。',
      _ => null,
    };
  }

  @override
  void initState() {
    super.initState();
    _applyRequestedFilter();
    _loadWarehouses();
    _load();
  }

  @override
  void didUpdateWidget(covariant StockTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.api != widget.api || oldWidget.role != widget.role) {
      _requestGeneration++;
      _page = null;
      _selectedStock = null;
      _pageNumber = 1;
      _loadWarehouses();
      _load();
      return;
    }
    if (oldWidget.filterRequestRevision != widget.filterRequestRevision) {
      setState(() {
        _applyRequestedFilter();
        _pageNumber = 1;
        _selectedStock = null;
      });
      _load();
    }
  }

  @override
  void dispose() {
    _requestGeneration++;
    _productController.dispose();
    super.dispose();
  }

  void _applyRequestedFilter() {
    _statusFilter = switch (widget.requestedFilter) {
      'shortage' => _StockStatusFilter.shortage,
      'low_stock' => _StockStatusFilter.lowStock,
      'unavailable' => _StockStatusFilter.unavailable,
      'pending_cost' => _StockStatusFilter.pendingCost,
      _ => null,
    };
  }

  Future<void> _loadWarehouses() async {
    setState(() {
      _loadingWarehouses = true;
      _warehouseError = null;
    });
    try {
      final warehouses = await widget.api.listWarehouses(isActive: true);
      if (!mounted) return;
      setState(() {
        _warehouses = warehouses;
        _loadingWarehouses = false;
        if (_warehouseId != null &&
            !warehouses.any((item) => item.id == _warehouseId)) {
          _warehouseId = null;
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingWarehouses = false;
        _warehouseError = inventoryErrorMessage(error);
      });
    }
  }

  Future<void> _load({bool append = false}) async {
    final generation = ++_requestGeneration;
    if (_blockedFilterMessage != null) {
      setState(() {
        _page = null;
        _selectedStock = null;
        _loading = false;
        _loadingMore = false;
        _error = null;
      });
      return;
    }

    setState(() {
      if (append) {
        _loadingMore = true;
      } else {
        _loading = true;
      }
      _error = null;
    });
    try {
      final result = await widget.api.listStocks(
        page: _pageNumber,
        pageSize: 20,
        warehouseId: _warehouseId,
        product: _productController.text.trim().isEmpty
            ? null
            : _productController.text.trim(),
        inventoryTrackingMode: _trackingMode,
        hasShortage: _statusFilter == _StockStatusFilter.shortage ? true : null,
        isLowStock: _statusFilter == _StockStatusFilter.lowStock ? true : null,
        hasUnavailable:
            _statusFilter == _StockStatusFilter.unavailable ? true : null,
      );
      if (!mounted || generation != _requestGeneration) return;
      final previous = _page;
      setState(() {
        if (append && previous != null) {
          _page = StockPage(
            stocks: [...previous.stocks, ...result.stocks],
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            totalPages: result.totalPages,
          );
        } else {
          _page = result;
          if (_selectedStock != null &&
              !result.stocks.any((item) => item.id == _selectedStock!.id)) {
            _selectedStock = null;
          }
        }
        _loading = false;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        if (append && _pageNumber > 1) _pageNumber--;
        _error = inventoryErrorMessage(error);
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  void _applyFilterChange(VoidCallback change) {
    setState(() {
      change();
      _pageNumber = 1;
      _selectedStock = null;
    });
    _load();
  }

  void _resetFilters() {
    _productController.clear();
    _applyFilterChange(() {
      _warehouseId = null;
      _trackingMode = null;
      _statusFilter = null;
    });
  }

  Future<void> _openStock(StockRecord stock) async {
    final availableWidth =
        context.size?.width ?? MediaQuery.sizeOf(context).width;
    if (isDesktopWidth(availableWidth)) {
      setState(() => _selectedStock = stock);
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.92,
        minChildSize: 0.55,
        maxChildSize: 0.96,
        builder: (context, controller) => _StockDetailPanel(
          key: ValueKey('warehouse-stock-detail-${stock.id}'),
          api: widget.api,
          role: widget.role,
          stockSummary: stock,
          scrollController: controller,
          onClose: () => Navigator.pop(context),
          onNavigate: (request) {
            Navigator.pop(context);
            widget.onNavigate(request);
          },
          onOpenSerialized: () {
            Navigator.pop(context);
            widget.onOpenSerialized();
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildFilters(),
        if (_warehouseError != null) ...[
          InventoryInlineNotice(
            message: '仓库选项加载失败：$_warehouseError',
            tone: StatusTone.warning,
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              key: const ValueKey('warehouse-stock-warehouse-retry'),
              onPressed: _loadWarehouses,
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: const Text('重试仓库选项'),
            ),
          ),
          const SizedBox(height: 8),
        ],
        if (_error != null && _page != null) ...[
          InventoryInlineNotice(
            message: '刷新失败：$_error',
            tone: StatusTone.warning,
          ),
          const SizedBox(height: 8),
        ],
        if (_loading && _page != null)
          const LinearProgressIndicator(
            key: ValueKey('warehouse-stock-refreshing'),
          ),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _buildFilters() {
    return InventoryFilterBar(
      actions: [
        OutlinedButton.icon(
          key: const ValueKey('warehouse-stock-reset'),
          onPressed: _hasFilters ? _resetFilters : null,
          icon: const Icon(Icons.restart_alt_rounded, size: 18),
          label: const Text('重置'),
        ),
        OutlinedButton.icon(
          key: const ValueKey('warehouse-stock-refresh'),
          onPressed: _loading || _loadingMore ? null : () => _load(),
          icon: const Icon(Icons.refresh_rounded, size: 18),
          label: const Text('刷新'),
        ),
      ],
      children: [
        SizedBox(
          key: const ValueKey('warehouse-stock-warehouse-filter'),
          width: 210,
          child: DropdownButtonFormField<String>(
            key: ValueKey(
              'warehouse-stock-warehouse-filter-value-'
              '${_warehouseId ?? 'all'}',
            ),
            initialValue: _warehouseId ?? '',
            isExpanded: true,
            decoration: InputDecoration(
              labelText: '仓库',
              isDense: true,
              border: const OutlineInputBorder(),
              suffixIcon: _loadingWarehouses
                  ? const Padding(
                      padding: EdgeInsets.all(12),
                      child: SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : null,
            ),
            items: [
              const DropdownMenuItem(value: '', child: Text('全部仓库')),
              for (final warehouse in _warehouses)
                DropdownMenuItem(
                  value: warehouse.id,
                  child: Text('${warehouse.code} · ${warehouse.name}'),
                ),
            ],
            onChanged: _loadingWarehouses
                ? null
                : (value) => _applyFilterChange(
                      () => _warehouseId =
                          value == null || value.isEmpty ? null : value,
                    ),
          ),
        ),
        SizedBox(
          width: 220,
          child: TextField(
            key: const ValueKey('warehouse-stock-search'),
            controller: _productController,
            decoration: const InputDecoration(
              labelText: '商品名称',
              hintText: '输入名称或商品 ID',
              isDense: true,
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.search_rounded, size: 20),
            ),
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _applyFilterChange(() {}),
          ),
        ),
        SizedBox(
          key: const ValueKey('warehouse-stock-mode-filter'),
          width: 190,
          child: DropdownButtonFormField<String>(
            key: ValueKey(
              'warehouse-stock-mode-filter-value-'
              '${_trackingMode ?? 'all'}',
            ),
            initialValue: _trackingMode ?? '',
            decoration: const InputDecoration(
              labelText: '库存模式',
              isDense: true,
              border: OutlineInputBorder(),
            ),
            items: const [
              DropdownMenuItem(value: '', child: Text('全部模式')),
              DropdownMenuItem(value: 'QUANTITY', child: Text('数量库存')),
              DropdownMenuItem(value: 'SERIALIZED', child: Text('逐瓶库存')),
            ],
            onChanged: (value) => _applyFilterChange(
              () =>
                  _trackingMode = value == null || value.isEmpty ? null : value,
            ),
          ),
        ),
        for (final status in _StockStatusFilter.values)
          ChoiceChip(
            key: ValueKey('warehouse-stock-status-${status.name}'),
            label: Text(_statusFilterLabel(status)),
            selected: _statusFilter == status,
            avatar: Icon(_statusFilterIcon(status), size: 16),
            onSelected: (selected) => _applyFilterChange(
              () => _statusFilter = selected ? status : null,
            ),
          ),
      ],
    );
  }

  Widget _buildBody() {
    final blockedMessage = _blockedFilterMessage;
    if (blockedMessage != null) {
      return SingleChildScrollView(
        child: InventoryUnavailableCard(
          keyPrefix: 'warehouse-stock-filter-blocked',
          title: '${_statusFilterLabel(_statusFilter!)}筛选暂不可用',
          message: blockedMessage,
        ),
      );
    }
    if (_loading && _page == null) {
      return const LoadingState(title: '正在加载商品库存');
    }
    if (_error != null && _page == null) {
      return ErrorState(title: _error!, onRetry: _load);
    }
    final page = _page;
    if (page == null || page.stocks.isEmpty) {
      return EmptyState(
        title: _hasFilters ? '当前筛选无结果' : '暂无库存数据',
        action: _hasFilters
            ? OutlinedButton.icon(
                onPressed: _resetFilters,
                icon: const Icon(Icons.filter_alt_off_rounded),
                label: const Text('清除筛选'),
              )
            : OutlinedButton.icon(
                onPressed: _load,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('刷新'),
              ),
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = isDesktopWidth(constraints.maxWidth);
        if (wide) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: _buildDesktopList(page)),
              if (_selectedStock != null) ...[
                const VerticalDivider(width: 16),
                SizedBox(
                  width: 410,
                  child: _StockDetailPanel(
                    key: ValueKey(
                      'warehouse-stock-detail-${_selectedStock!.id}',
                    ),
                    api: widget.api,
                    role: widget.role,
                    stockSummary: _selectedStock!,
                    onClose: () => setState(() => _selectedStock = null),
                    onNavigate: widget.onNavigate,
                    onOpenSerialized: widget.onOpenSerialized,
                  ),
                ),
              ],
            ],
          );
        }
        return _buildMobileList(page);
      },
    );
  }

  Widget _buildDesktopList(StockPage page) {
    return Column(
      children: [
        Expanded(
          child: Scrollbar(
            child: SingleChildScrollView(
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: DataTable(
                  key: const ValueKey('warehouse-stock-table'),
                  showCheckboxColumn: false,
                  columnSpacing: 18,
                  columns: [
                    const DataColumn(label: Text('仓库')),
                    const DataColumn(label: Text('商品')),
                    const DataColumn(label: Text('库存模式')),
                    const DataColumn(label: Text('账面现存'), numeric: true),
                    const DataColumn(label: Text('已占用'), numeric: true),
                    const DataColumn(label: Text('不可售'), numeric: true),
                    const DataColumn(label: Text('实际可售'), numeric: true),
                    const DataColumn(label: Text('短缺'), numeric: true),
                    const DataColumn(label: Text('最低库存'), numeric: true),
                    const DataColumn(label: Text('状态')),
                    const DataColumn(label: Text('最近变动')),
                    if (_canReadCost)
                      const DataColumn(label: Text('库存成本'), numeric: true),
                    if (_canReadCost) const DataColumn(label: Text('成本覆盖')),
                  ],
                  rows: [
                    for (final stock in page.stocks)
                      DataRow(
                        key: ValueKey('warehouse-stock-row-${stock.id}'),
                        selected: _selectedStock?.id == stock.id,
                        onSelectChanged: (_) => _openStock(stock),
                        color: WidgetStateProperty.resolveWith((states) {
                          if (states.contains(WidgetState.selected)) {
                            return Theme.of(context)
                                .colorScheme
                                .primaryContainer
                                .withValues(alpha: 0.45);
                          }
                          if (stock.isNegative) return Colors.red.shade50;
                          if (stock.isLowStock) return Colors.orange.shade50;
                          return null;
                        }),
                        cells: [
                          DataCell(
                            Text(
                              '${stock.warehouseCode} · '
                              '${stock.warehouseName}',
                            ),
                          ),
                          DataCell(
                            SizedBox(
                              width: 180,
                              child: Text(
                                stock.productName,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                          DataCell(
                            InventoryStatusTag(
                              label: _trackingModeLabel(
                                stock.inventoryTrackingMode,
                              ),
                              tone: StatusTone.info,
                              icon: stock.inventoryTrackingMode == 'serialized'
                                  ? Icons.qr_code_2_rounded
                                  : Icons.numbers_rounded,
                            ),
                          ),
                          DataCell(BottleQuantityText(stock.onHandQty)),
                          DataCell(BottleQuantityText(stock.reservedQty)),
                          DataCell(BottleQuantityText(stock.unavailableQty)),
                          DataCell(_emphasizedQuantity(
                            stock.availableQty,
                            danger: stock.availableQty < 0,
                          )),
                          DataCell(_shortageView(stock)),
                          DataCell(
                            stock.minimumAvailableQty == null
                                ? const Text('未配置')
                                : BottleQuantityText(
                                    stock.minimumAvailableQty!,
                                  ),
                          ),
                          DataCell(_StockStatusWrap(stock: stock)),
                          DataCell(Text(_formatInventoryDate(stock.updatedAt))),
                          if (_canReadCost)
                            DataCell(
                              stock.inventoryCostAmountCents == null
                                  ? const Text('暂未提供')
                                  : MoneyText(
                                      cents: stock.inventoryCostAmountCents!,
                                    ),
                            ),
                          if (_canReadCost)
                            DataCell(_CostCoverageTag(stock: stock)),
                        ],
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (page.totalPages > 1)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: InventoryPagination(
              page: page.page,
              totalPages: page.totalPages,
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
            ),
          ),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            '共 ${page.total} 条库存项',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      ],
    );
  }

  Widget _buildMobileList(StockPage page) {
    return Column(
      children: [
        Expanded(
          child: ListView.separated(
            key: const ValueKey('warehouse-stock-card-list'),
            itemCount: page.stocks.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final stock = page.stocks[index];
              return _StockCard(
                stock: stock,
                canReadCost: _canReadCost,
                onOpen: () => _openStock(stock),
              );
            },
          ),
        ),
        if (page.page < page.totalPages)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: OutlinedButton.icon(
              key: const ValueKey('warehouse-stock-load-more'),
              onPressed: _loadingMore
                  ? null
                  : () {
                      _pageNumber++;
                      _load(append: true);
                    },
              icon: _loadingMore
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.expand_more_rounded),
              label: Text(
                _loadingMore
                    ? '正在加载'
                    : '加载更多（${page.stocks.length}/${page.total}）',
              ),
            ),
          ),
      ],
    );
  }
}

class _StockCard extends StatelessWidget {
  const _StockCard({
    required this.stock,
    required this.canReadCost,
    required this.onOpen,
  });

  final StockRecord stock;
  final bool canReadCost;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: ValueKey('warehouse-stock-card-${stock.id}'),
      margin: EdgeInsets.zero,
      child: Column(
        children: [
          InkWell(
            key: ValueKey('warehouse-stock-card-open-${stock.id}'),
            onTap: onOpen,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              stock.productName,
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(fontWeight: FontWeight.w700),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              '${stock.warehouseCode} · '
                              '${stock.warehouseName}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      InventoryStatusTag(
                        label: _trackingModeLabel(
                          stock.inventoryTrackingMode,
                        ),
                        tone: StatusTone.info,
                        icon: stock.inventoryTrackingMode == 'serialized'
                            ? Icons.qr_code_2_rounded
                            : Icons.numbers_rounded,
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '${stock.availableQty} 瓶',
                    key: ValueKey(
                      'warehouse-stock-card-available-${stock.id}',
                    ),
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      color: stock.availableQty < 0
                          ? Theme.of(context).colorScheme.error
                          : null,
                      fontFeatures: const [
                        FontFeature.tabularFigures(),
                      ],
                    ),
                  ),
                  Text(
                    '实际可售',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 8),
                  _StockStatusWrap(stock: stock),
                ],
              ),
            ),
          ),
          const Divider(height: 1),
          ExpansionTile(
            key: ValueKey('warehouse-stock-card-expand-${stock.id}'),
            tilePadding: const EdgeInsets.symmetric(horizontal: 14),
            title: const Text('更多数量与成本'),
            childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
            children: [
              Wrap(
                spacing: 16,
                runSpacing: 8,
                children: [
                  _mobileMetric('账面现存', stock.onHandQty),
                  _mobileMetric('已占用', stock.reservedQty),
                  _mobileMetric('不可售', stock.unavailableQty),
                  _mobileMetric('在途', stock.inTransitQty),
                  _mobileMetric('短缺', stock.shortageQty, danger: true),
                  if (stock.minimumAvailableQty != null)
                    _mobileMetric(
                      '最低库存',
                      stock.minimumAvailableQty!,
                    ),
                ],
              ),
              if (canReadCost) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    const Text('库存成本：'),
                    if (stock.inventoryCostAmountCents == null)
                      const Text('暂未提供')
                    else
                      MoneyText(cents: stock.inventoryCostAmountCents!),
                    const Spacer(),
                    _CostCoverageTag(stock: stock),
                  ],
                ),
              ],
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  '最近变动：${_formatInventoryDate(stock.updatedAt)}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  static Widget _mobileMetric(
    String label,
    int value, {
    bool danger = false,
  }) {
    return SizedBox(
      width: 130,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: Colors.grey)),
          Text(
            '$value 瓶',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: danger && value > 0 ? Colors.red.shade700 : null,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _StockDetailPanel extends StatefulWidget {
  const _StockDetailPanel({
    super.key,
    required this.api,
    required this.role,
    required this.stockSummary,
    required this.onClose,
    required this.onNavigate,
    required this.onOpenSerialized,
    this.scrollController,
  });

  final InventoryApi api;
  final UserRole role;
  final StockRecord stockSummary;
  final VoidCallback onClose;
  final ValueChanged<WarehouseStockNavigationRequest> onNavigate;
  final VoidCallback onOpenSerialized;
  final ScrollController? scrollController;

  @override
  State<_StockDetailPanel> createState() => _StockDetailPanelState();
}

class _StockDetailPanelState extends State<_StockDetailPanel> {
  StockDetailRecord? _detail;
  MovementPage? _movements;
  AlertConfigPage? _alerts;
  bool _detailLoading = true;
  bool _movementsLoading = true;
  bool _alertsLoading = true;
  String? _detailError;
  String? _movementsError;
  String? _alertsError;
  int _requestGeneration = 0;

  bool get _canReadCost => canReadInventoryCost(widget.role);
  bool get _canWriteQuantity => canInboundWrite(widget.role);
  bool get _canOpenSerialized =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance ||
      widget.role == UserRole.warehouse;

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  @override
  void didUpdateWidget(covariant _StockDetailPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.stockSummary.warehouseId != widget.stockSummary.warehouseId ||
        oldWidget.stockSummary.productId != widget.stockSummary.productId ||
        oldWidget.api != widget.api ||
        oldWidget.role != widget.role) {
      _loadAll();
    }
  }

  @override
  void dispose() {
    _requestGeneration++;
    super.dispose();
  }

  void _loadAll() {
    final generation = ++_requestGeneration;
    setState(() {
      _detail = null;
      _movements = null;
      _alerts = null;
      _detailLoading = true;
      _movementsLoading = true;
      _alertsLoading = true;
      _detailError = null;
      _movementsError = null;
      _alertsError = null;
    });
    _loadDetail(generation);
    _loadMovements(generation);
    _loadAlerts(generation);
  }

  Future<void> _loadDetail(int generation) async {
    try {
      final detail = await widget.api.getStock(
        warehouseId: widget.stockSummary.warehouseId,
        productId: widget.stockSummary.productId,
      );
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _detail = detail;
        _detailLoading = false;
      });
    } catch (error) {
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _detailError = inventoryErrorMessage(error);
        _detailLoading = false;
      });
    }
  }

  Future<void> _loadMovements(int generation) async {
    try {
      final movements = await widget.api.listMovements(
        warehouseId: widget.stockSummary.warehouseId,
        productId: widget.stockSummary.productId,
        pageSize: 5,
      );
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _movements = movements;
        _movementsLoading = false;
      });
    } catch (error) {
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _movementsError = inventoryErrorMessage(error);
        _movementsLoading = false;
      });
    }
  }

  Future<void> _loadAlerts(int generation) async {
    try {
      final alerts = await widget.api.listAlertConfigs(
        warehouseId: widget.stockSummary.warehouseId,
        productId: widget.stockSummary.productId,
        pageSize: 5,
      );
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _alerts = alerts;
        _alertsLoading = false;
      });
    } catch (error) {
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _alertsError = inventoryErrorMessage(error);
        _alertsLoading = false;
      });
    }
  }

  void _retryAll() {
    _loadAll();
  }

  @override
  Widget build(BuildContext context) {
    final stock = _detail?.stock ?? widget.stockSummary;
    return Material(
      color: Theme.of(context).colorScheme.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        stock.productName,
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                      Text(
                        '${stock.warehouseCode} · ${stock.warehouseName}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                IconButton(
                  key: const ValueKey('warehouse-stock-detail-close'),
                  tooltip: '关闭详情',
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView(
              controller: widget.scrollController,
              padding: const EdgeInsets.all(12),
              children: [
                _buildStatusAndFormula(stock),
                const SizedBox(height: 12),
                _buildQuickActions(stock),
                if (_canReadCost) ...[
                  const SizedBox(height: 12),
                  _buildCost(stock),
                ],
                const SizedBox(height: 12),
                _buildBatchOrSerialized(stock),
                const SizedBox(height: 12),
                _buildAlerts(),
                const SizedBox(height: 12),
                _buildMovements(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusAndFormula(StockRecord stock) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                InventoryStatusTag(
                  label: _trackingModeLabel(stock.inventoryTrackingMode),
                  tone: StatusTone.info,
                  icon: stock.inventoryTrackingMode == 'serialized'
                      ? Icons.qr_code_2_rounded
                      : Icons.numbers_rounded,
                ),
                const Spacer(),
                Text(
                  '版本 ${stock.version}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
            const SizedBox(height: 10),
            _StockStatusWrap(stock: stock),
            const SizedBox(height: 12),
            Text(
              '数量公式',
              style: Theme.of(context)
                  .textTheme
                  .labelLarge
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(
              '${stock.onHandQty} 瓶 − ${stock.reservedQty} 瓶 − '
              '${stock.unavailableQty} 瓶 = ${stock.availableQty} 瓶',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: stock.availableQty < 0
                    ? Theme.of(context).colorScheme.error
                    : null,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '账面现存 − 已占用 − 不可售 = 实际可售；'
              '短缺 ${stock.shortageQty} 瓶。',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Text(
              '最近变动：${_formatInventoryDate(stock.updatedAt)}'
              '${stock.lastMovementId == null ? '' : ' · 流水 ${stock.lastMovementId}'}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickActions(StockRecord stock) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '快捷操作',
              style: Theme.of(context)
                  .textTheme
                  .labelLarge
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (_canWriteQuantity)
                  _actionButton(
                    '入库',
                    Icons.input_rounded,
                    'inbound',
                    action: 'create',
                  ),
                if (_canWriteQuantity)
                  _actionButton(
                    '调拨',
                    Icons.swap_horiz_rounded,
                    'transfer',
                    action: 'create',
                  ),
                if (_canWriteQuantity)
                  _actionButton(
                    '不可售',
                    Icons.block_rounded,
                    'unavailable',
                  ),
                if (_canWriteQuantity)
                  _actionButton(
                    '盘点',
                    Icons.fact_check_rounded,
                    'stocktake',
                    action: 'create',
                  ),
                _actionButton(
                  '流水',
                  Icons.receipt_long_rounded,
                  'movement',
                ),
                if (stock.inventoryTrackingMode == 'serialized' &&
                    _canOpenSerialized)
                  OutlinedButton.icon(
                    key: const ValueKey(
                      'warehouse-stock-open-serialized',
                    ),
                    onPressed: widget.onOpenSerialized,
                    icon: const Icon(Icons.qr_code_scanner_rounded),
                    label: const Text('打开茅台逐瓶明细'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _actionButton(
    String label,
    IconData icon,
    String moduleId, {
    String? action,
  }) {
    return OutlinedButton.icon(
      key: ValueKey('warehouse-stock-detail-action-$moduleId'),
      onPressed: () => widget.onNavigate(
        WarehouseStockNavigationRequest(
          moduleId: moduleId,
          warehouseId: widget.stockSummary.warehouseId,
          productId: widget.stockSummary.productId,
          action: action,
        ),
      ),
      icon: Icon(icon),
      label: Text(label),
    );
  }

  Widget _buildCost(StockRecord stock) {
    return Card(
      key: const ValueKey('warehouse-stock-detail-cost'),
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text(
                  '库存成本',
                  style: Theme.of(context)
                      .textTheme
                      .labelLarge
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
                const Spacer(),
                _CostCoverageTag(stock: stock),
              ],
            ),
            const SizedBox(height: 8),
            if (stock.inventoryCostAmountCents == null)
              const Text('服务端暂未返回库存成本。')
            else
              MoneyText(cents: stock.inventoryCostAmountCents!),
            const SizedBox(height: 6),
            Text(
              stock.inventoryCostCoveredQty == null
                  ? '覆盖数量暂未提供'
                  : '已覆盖 ${stock.inventoryCostCoveredQty} 瓶 · '
                      '未覆盖 ${stock.inventoryCostUncoveredQty ?? 0} 瓶 · '
                      '成本事实 ${stock.inventoryCostFactQty ?? 0} 瓶',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (stock.inventoryCostWarning != null &&
                stock.inventoryCostWarning!.trim().isNotEmpty) ...[
              const SizedBox(height: 8),
              InventoryInlineNotice(
                key: const ValueKey(
                  'warehouse-stock-cost-server-warning',
                ),
                message: stock.inventoryCostWarning!,
                tone: StatusTone.warning,
              ),
            ],
            if (stock.coverageStatus == 'partial' ||
                stock.coverageStatus == 'none') ...[
              const SizedBox(height: 8),
              const Text(
                '成本覆盖完全以库存服务返回结果为准，不使用当前商品实际成本补算。',
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildBatchOrSerialized(StockRecord stock) {
    if (_detailLoading) {
      return const Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: EdgeInsets.all(18),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }
    if (_detailError != null) {
      return _SectionError(
        title: '库存详情加载失败',
        message: _detailError!,
        onRetry: _retryAll,
      );
    }
    final detail = _detail;
    if (detail == null) return const SizedBox.shrink();
    if (stock.inventoryTrackingMode == 'serialized') {
      return Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '逐瓶状态摘要',
                style: Theme.of(context)
                    .textTheme
                    .labelLarge
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              if (detail.serializedStatusSummary.isEmpty)
                const Text('服务端未返回逐瓶状态记录。')
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final entry in detail.serializedStatusSummary.entries)
                      Chip(
                        label: Text(
                          '${_serializedStatusLabel(entry.key)} '
                          '${entry.value} 瓶',
                        ),
                      ),
                  ],
                ),
            ],
          ),
        ),
      );
    }

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '批次摘要',
              style: Theme.of(context)
                  .textTheme
                  .labelLarge
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            if (detail.batches.isEmpty)
              const Text('暂无批次记录。')
            else
              for (final batch in detail.batches)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      border: Border.all(
                        color: Theme.of(context).dividerColor,
                      ),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            batch.productionBatch?.isNotEmpty == true
                                ? '生产批次 ${batch.productionBatch}'
                                : '批次 ${batch.id}',
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          if (batch.purchaseOrderNo != null)
                            Text('采购单号：${batch.purchaseOrderNo}'),
                          if (batch.supplierName != null)
                            Text('供应商：${batch.supplierName}'),
                          Text(
                            '收货 ${batch.receivedQty} 瓶 · '
                            '剩余 ${batch.remainingQty} 瓶 · '
                            '不可售 ${batch.unavailableQty} 瓶',
                          ),
                          if (_canReadCost &&
                              batch.purchaseUnitCostCents != null)
                            Row(
                              children: [
                                const Text('单位成本：'),
                                MoneyText(
                                  cents: batch.purchaseUnitCostCents!,
                                ),
                              ],
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
          ],
        ),
      ),
    );
  }

  Widget _buildAlerts() {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '预警配置',
              style: Theme.of(context)
                  .textTheme
                  .labelLarge
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            if (_alertsLoading)
              const LinearProgressIndicator()
            else if (_alertsError != null)
              _InlineSectionError(
                message: _alertsError!,
                onRetry: _retryAll,
              )
            else if (_alerts == null || _alerts!.configs.isEmpty)
              const Text('未配置最低库存预警。')
            else
              for (final config in _alerts!.configs)
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '最低可售 ${config.minimumAvailableQty} 瓶',
                      ),
                    ),
                    InventoryStatusTag(
                      label: config.enabled ? '已启用' : '已停用',
                      tone: config.enabled
                          ? StatusTone.success
                          : StatusTone.neutral,
                    ),
                  ],
                ),
          ],
        ),
      ),
    );
  }

  Widget _buildMovements() {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '最近流水',
              style: Theme.of(context)
                  .textTheme
                  .labelLarge
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            if (_movementsLoading)
              const LinearProgressIndicator()
            else if (_movementsError != null)
              _InlineSectionError(
                message: _movementsError!,
                onRetry: _retryAll,
              )
            else if (_movements == null || _movements!.movements.isEmpty)
              const Text('暂无库存流水。')
            else
              for (final movement in _movements!.movements)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          InventoryStatusTag(
                            label: movement.movementTypeLabel,
                            tone: movement.onHandDelta < 0
                                ? StatusTone.warning
                                : StatusTone.info,
                          ),
                          const Spacer(),
                          Text(
                            _formatInventoryDate(movement.businessAt),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        [
                          if (movement.onHandDelta != 0)
                            '现存 ${_signedBottles(movement.onHandDelta)}',
                          if (movement.reservedDelta != 0)
                            '占用 ${_signedBottles(movement.reservedDelta)}',
                          if (movement.unavailableDelta != 0)
                            '不可售 '
                                '${_signedBottles(movement.unavailableDelta)}',
                          if (movement.inTransitDelta != 0)
                            '在途 '
                                '${_signedBottles(movement.inTransitDelta)}',
                        ].join(' · '),
                      ),
                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

class _StockStatusWrap extends StatelessWidget {
  const _StockStatusWrap({required this.stock});

  final StockRecord stock;

  @override
  Widget build(BuildContext context) {
    final tags = <Widget>[];
    if (stock.hasShortage || stock.availableQty < 0) {
      tags.add(
        const InventoryStatusTag(
          label: '短缺',
          tone: StatusTone.danger,
          icon: Icons.remove_circle_outline_rounded,
        ),
      );
    }
    if (stock.isLowStock) {
      tags.add(
        const InventoryStatusTag(
          label: '低库存',
          tone: StatusTone.warning,
        ),
      );
    }
    if (stock.unavailableQty > 0) {
      tags.add(
        const InventoryStatusTag(
          label: '含不可售',
          tone: StatusTone.warning,
          icon: Icons.block_rounded,
        ),
      );
    }
    if (stock.coverageStatus == 'partial' || stock.coverageStatus == 'none') {
      tags.add(
        InventoryStatusTag(
          label: stock.coverageStatus == 'partial' ? '部分覆盖' : '待补成本',
          tone: StatusTone.warning,
          icon: Icons.currency_yuan_rounded,
        ),
      );
    }
    if (tags.isEmpty) {
      tags.add(
        const InventoryStatusTag(
          label: '正常',
          tone: StatusTone.success,
        ),
      );
    }
    return Wrap(spacing: 6, runSpacing: 6, children: tags);
  }
}

class _CostCoverageTag extends StatelessWidget {
  const _CostCoverageTag({required this.stock});

  final StockRecord stock;

  @override
  Widget build(BuildContext context) {
    final (label, tone) = switch (stock.coverageStatus) {
      'full' => ('完整覆盖', StatusTone.success),
      'partial' => ('部分覆盖', StatusTone.warning),
      'none' => ('未覆盖', StatusTone.danger),
      'not_applicable' => ('不适用', StatusTone.neutral),
      _ => ('暂未提供', StatusTone.neutral),
    };
    return InventoryStatusTag(
      label: label,
      tone: tone,
      icon: Icons.currency_yuan_rounded,
    );
  }
}

class _SectionError extends StatelessWidget {
  const _SectionError({
    required this.title,
    required this.message,
    required this.onRetry,
  });

  final String title;
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Text(message),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('重试'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InlineSectionError extends StatelessWidget {
  const _InlineSectionError({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: Text(message)),
        IconButton(
          tooltip: '重试',
          onPressed: onRetry,
          icon: const Icon(Icons.refresh_rounded),
        ),
      ],
    );
  }
}

String _statusFilterLabel(_StockStatusFilter status) {
  return switch (status) {
    _StockStatusFilter.normal => '正常',
    _StockStatusFilter.lowStock => '低库存',
    _StockStatusFilter.shortage => '短缺',
    _StockStatusFilter.unavailable => '不可售',
    _StockStatusFilter.pendingCost => '待补成本',
  };
}

IconData _statusFilterIcon(_StockStatusFilter status) {
  return switch (status) {
    _StockStatusFilter.normal => Icons.check_circle_outline_rounded,
    _StockStatusFilter.lowStock => Icons.warning_amber_rounded,
    _StockStatusFilter.shortage => Icons.remove_circle_outline_rounded,
    _StockStatusFilter.unavailable => Icons.block_rounded,
    _StockStatusFilter.pendingCost => Icons.currency_yuan_rounded,
  };
}

String _trackingModeLabel(String mode) {
  return switch (mode.toLowerCase()) {
    'quantity' => '数量库存',
    'serialized' => '逐瓶库存',
    _ => '未跟踪',
  };
}

String _serializedStatusLabel(String status) {
  return switch (status.toLowerCase()) {
    'pending_cost' => '待补成本',
    'available' => '可售',
    'reserved' => '已占用',
    'allocated' => '旧占用',
    'outbound' => '已出库',
    'unavailable' => '不可售',
    'void' => '已作废',
    _ => status,
  };
}

Widget _emphasizedQuantity(int quantity, {required bool danger}) {
  return Text(
    '$quantity 瓶',
    style: TextStyle(
      fontWeight: FontWeight.w700,
      color: danger ? Colors.red.shade700 : null,
      fontFeatures: const [FontFeature.tabularFigures()],
    ),
  );
}

Widget _shortageView(StockRecord stock) {
  if (stock.shortageQty <= 0) return const BottleQuantityText(0);
  return Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Text(
        '${stock.shortageQty} 瓶',
        style: TextStyle(
          color: Colors.red.shade700,
          fontWeight: FontWeight.w700,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
      const SizedBox(width: 4),
      const StatusTag(label: '短缺', tone: StatusTone.danger),
    ],
  );
}

String _formatInventoryDate(String? raw) {
  if (raw == null || raw.trim().isEmpty) return '暂未提供';
  final value = DateTime.tryParse(raw)?.toLocal();
  if (value == null) return raw;
  String two(int number) => number.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} '
      '${two(value.hour)}:${two(value.minute)}';
}

String _signedBottles(int value) => '${value > 0 ? '+' : ''}$value 瓶';
