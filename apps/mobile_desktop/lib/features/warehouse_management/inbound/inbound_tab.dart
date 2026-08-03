part of '../inventory_workspace_tabs.dart';

// ===========================================================================
// 入库管理
// ===========================================================================

class InboundTab extends StatefulWidget {
  const InboundTab({
    super.key,
    required this.api,
    required this.businessApi,
    required this.role,
    required this.onOpenSerialized,
    required this.onInventoryFactsChanged,
    this.onOpenProductManagement,
    this.createRequestRevision = 0,
    this.requestedFilter,
    this.filterRequestRevision = 0,
    this.requestedSelection,
  });

  final InventoryApi api;
  final BusinessApi businessApi;
  final UserRole role;
  final VoidCallback onOpenSerialized;
  final VoidCallback onInventoryFactsChanged;
  final VoidCallback? onOpenProductManagement;
  final int createRequestRevision;
  final String? requestedFilter;
  final int filterRequestRevision;
  final InventorySelectionContext? requestedSelection;

  @override
  State<InboundTab> createState() => _InboundTabState();
}

class _InboundTabState extends State<InboundTab> {
  final _purchaseOrderController = TextEditingController();
  final _supplierController = TextEditingController();

  InboundDocumentPage? _page;
  bool _loading = true;
  bool _refreshing = false;
  bool _loadingMore = false;
  String? _error;
  String? _warehouseId;
  String? _productId;
  String? _type;
  String? _status;
  DateTime? _dateFrom;
  DateTime? _dateTo;
  int _pageNumber = 1;
  int _requestGeneration = 0;

  List<WarehouseRecord> _warehouses = const [];
  bool _warehousesLoading = true;
  String? _warehousesError;
  List<ProductOptionRecord> _products = const [];
  bool _productsLoading = true;
  String? _productsError;

  String? _selectedDocumentId;
  InboundDocumentRecord? _detail;
  bool _detailLoading = false;
  String? _detailError;
  int _detailGeneration = 0;

  int _handledCreateRequestRevision = 0;
  String? _externalFilterNotice;

  bool get _canWrite => canInboundWrite(widget.role);
  bool get _canReadCost => canReadInventoryCost(widget.role);
  bool get _canMaintainCost => canCostWrite(widget.role);
  bool get _canSetCostOnInbound =>
      widget.role == UserRole.superAdmin || widget.role == UserRole.admin;
  bool get _canManageProductInventoryMode =>
      widget.role == UserRole.superAdmin || widget.role == UserRole.admin;

  bool get _hasActiveFilters =>
      _warehouseId != null ||
      _productId != null ||
      _type != null ||
      _status != null ||
      _purchaseOrderController.text.trim().isNotEmpty ||
      _supplierController.text.trim().isNotEmpty ||
      _dateFrom != null ||
      _dateTo != null ||
      widget.requestedSelection != null;

  @override
  void initState() {
    super.initState();
    _applyRequestedContext();
    _loadWarehouses();
    _loadProducts();
    _load(resetPage: true);
  }

  @override
  void didUpdateWidget(covariant InboundTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.api != widget.api ||
        oldWidget.businessApi != widget.businessApi ||
        oldWidget.role != widget.role) {
      _clearActorData();
      _loadWarehouses();
      _loadProducts();
      _load(resetPage: true);
      return;
    }
    if (oldWidget.createRequestRevision != widget.createRequestRevision) {
      _maybeOpenRequestedCreate();
    }
    if (oldWidget.filterRequestRevision != widget.filterRequestRevision) {
      setState(_applyRequestedContext);
      _load(resetPage: true);
    }
  }

  @override
  void dispose() {
    _purchaseOrderController.dispose();
    _supplierController.dispose();
    super.dispose();
  }

  void _clearActorData() {
    _requestGeneration++;
    _detailGeneration++;
    _page = null;
    _detail = null;
    _selectedDocumentId = null;
    _warehouses = const [];
    _products = const [];
    _warehousesLoading = true;
    _productsLoading = true;
    _warehousesError = null;
    _productsError = null;
  }

  void _applyRequestedContext() {
    final selection = widget.requestedSelection;
    if (selection != null) {
      _warehouseId = selection.warehouseId;
      _productId = selection.productId;
    }
    _externalFilterNotice = widget.requestedFilter == 'pending_cost'
        ? '已带入“待补成本”意图；当前后端入库列表没有待补成本筛选参数，'
            '页面不会只过滤当前页来伪造结果。'
        : null;
  }

  Future<void> _loadWarehouses() async {
    setState(() {
      _warehousesLoading = true;
      _warehousesError = null;
    });
    try {
      final records = await widget.api.listWarehouses(isActive: true);
      if (!mounted) return;
      setState(() {
        _warehouses = records;
        _warehousesLoading = false;
      });
      _maybeOpenRequestedCreate();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _warehousesLoading = false;
        _warehousesError = inventoryErrorMessage(error);
      });
      _maybeOpenRequestedCreate();
    }
  }

  Future<void> _loadProducts() async {
    setState(() {
      _productsLoading = true;
      _productsError = null;
    });
    try {
      final records = await widget.businessApi.listProductOptions();
      if (!mounted) return;
      setState(() {
        _products = records;
        _productsLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _productsLoading = false;
        _productsError = inventoryErrorMessage(error);
      });
    }
  }

  void _maybeOpenRequestedCreate() {
    if (!_canWrite ||
        _warehousesLoading ||
        widget.createRequestRevision <= _handledCreateRequestRevision) {
      return;
    }
    _handledCreateRequestRevision = widget.createRequestRevision;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _showCreateEditor();
    });
  }

  Future<void> _load({
    required bool resetPage,
    bool keepData = false,
    String? focusDocumentId,
  }) async {
    final generation = ++_requestGeneration;
    final targetPage = resetPage ? 1 : _pageNumber;
    setState(() {
      _pageNumber = targetPage;
      _error = null;
      if (_page == null || !keepData) {
        _loading = true;
      } else {
        _refreshing = true;
      }
    });
    try {
      final result = await widget.api.listInbounds(
        page: targetPage,
        pageSize: 20,
        warehouseId: _warehouseId,
        productId: _productId,
        type: _type,
        status: _status,
        batch: _textOrNull(_purchaseOrderController.text),
        dateFrom: _dateFrom == null
            ? null
            : DateTime(_dateFrom!.year, _dateFrom!.month, _dateFrom!.day),
        dateTo: _dateTo == null
            ? null
            : DateTime(
                _dateTo!.year,
                _dateTo!.month,
                _dateTo!.day,
                23,
                59,
                59,
                999,
              ),
      );
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _page = result;
        _pageNumber = result.page;
        _loading = false;
        _refreshing = false;
        if (focusDocumentId != null) {
          _selectedDocumentId = focusDocumentId;
        } else if (_selectedDocumentId != null &&
            !result.inbounds
                .any((document) => document.id == _selectedDocumentId)) {
          _selectedDocumentId = null;
          _detail = null;
        }
      });
      if (focusDocumentId != null) {
        await _loadDetail(focusDocumentId);
      }
    } catch (error) {
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _error = inventoryErrorMessage(error);
        _loading = false;
        _refreshing = false;
      });
    }
  }

  Future<void> _loadMore() async {
    final current = _page;
    if (current == null || _loadingMore || current.page >= current.totalPages) {
      return;
    }
    final generation = ++_requestGeneration;
    setState(() => _loadingMore = true);
    try {
      final next = await widget.api.listInbounds(
        page: current.page + 1,
        pageSize: current.pageSize,
        warehouseId: _warehouseId,
        productId: _productId,
        type: _type,
        status: _status,
        batch: _textOrNull(_purchaseOrderController.text),
        dateFrom: _dateFrom,
        dateTo: _dateTo == null
            ? null
            : DateTime(
                _dateTo!.year,
                _dateTo!.month,
                _dateTo!.day,
                23,
                59,
                59,
                999,
              ),
      );
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _page = InboundDocumentPage(
          inbounds: [...current.inbounds, ...next.inbounds],
          page: next.page,
          pageSize: next.pageSize,
          total: next.total,
          totalPages: next.totalPages,
        );
        _pageNumber = next.page;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted || generation != _requestGeneration) return;
      setState(() => _loadingMore = false);
      _showSnack(inventoryErrorMessage(error));
    }
  }

  Future<void> _loadDetail(String documentId) async {
    final generation = ++_detailGeneration;
    setState(() {
      _selectedDocumentId = documentId;
      _detailLoading = true;
      _detailError = null;
    });
    try {
      final detail = await widget.api.getInbound(documentId);
      if (!mounted || generation != _detailGeneration) return;
      setState(() {
        _detail = detail;
        _detailLoading = false;
      });
    } catch (error) {
      if (!mounted || generation != _detailGeneration) return;
      setState(() {
        _detailError = inventoryErrorMessage(error);
        _detailLoading = false;
      });
    }
  }

  Future<void> _selectDate({required bool isFrom}) async {
    final current = isFrom ? _dateFrom : _dateTo;
    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? DateTime.now(),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (isFrom) {
        _dateFrom = picked;
        if (_dateTo != null && _dateTo!.isBefore(picked)) {
          _dateTo = picked;
        }
      } else {
        _dateTo = picked;
        if (_dateFrom != null && _dateFrom!.isAfter(picked)) {
          _dateFrom = picked;
        }
      }
    });
  }

  void _resetFilters() {
    setState(() {
      _warehouseId = null;
      _productId = null;
      _type = null;
      _status = null;
      _dateFrom = null;
      _dateTo = null;
      _purchaseOrderController.clear();
      _supplierController.clear();
      _externalFilterNotice = null;
    });
    _load(resetPage: true);
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = isDesktopWidth(constraints.maxWidth);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildFilters(),
            if (_supplierController.text.trim().isNotEmpty) ...[
              const InventoryInlineNotice(
                key: ValueKey('warehouse-inbound-supplier-blocked'),
                message: '当前后端入库列表没有供应商筛选参数。已保留输入，'
                    '但不会过滤当前页或遍历分页伪造结果；等待接口支持。',
                tone: StatusTone.warning,
              ),
              const SizedBox(height: 8),
            ],
            if (_externalFilterNotice != null) ...[
              InventoryInlineNotice(
                key: const ValueKey('warehouse-inbound-filter-blocked'),
                message: _externalFilterNotice!,
                tone: StatusTone.warning,
              ),
              const SizedBox(height: 8),
            ],
            if (_refreshing) const LinearProgressIndicator(minHeight: 2),
            Expanded(child: _buildBody(wide)),
            if (wide && _page != null && _page!.totalPages > 1)
              InventoryPagination(
                page: _page!.page,
                totalPages: _page!.totalPages,
                onPrevious: _page!.page > 1
                    ? () {
                        _pageNumber = _page!.page - 1;
                        _load(resetPage: false);
                      }
                    : null,
                onNext: _page!.page < _page!.totalPages
                    ? () {
                        _pageNumber = _page!.page + 1;
                        _load(resetPage: false);
                      }
                    : null,
              ),
          ],
        );
      },
    );
  }

  Widget _buildFilters() {
    return InventoryFilterBar(
      actions: [
        FilledButton.icon(
          key: const ValueKey('warehouse-inbound-apply-filters'),
          onPressed: () => _load(resetPage: true),
          icon: const Icon(Icons.search_rounded, size: 18),
          label: const Text('筛选'),
        ),
        OutlinedButton.icon(
          key: const ValueKey('warehouse-inbound-reset-filters'),
          onPressed: _hasActiveFilters ? _resetFilters : null,
          icon: const Icon(Icons.restart_alt_rounded, size: 18),
          label: const Text('重置'),
        ),
        IconButton(
          key: const ValueKey('warehouse-inbound-refresh'),
          tooltip: '刷新',
          onPressed: _refreshing
              ? null
              : () => _load(resetPage: false, keepData: true),
          icon: const Icon(Icons.refresh_rounded),
        ),
        if (_canWrite)
          FilledButton.icon(
            key: const ValueKey('warehouse-inbound-create-button'),
            onPressed: _showCreateEditor,
            icon: const Icon(Icons.add_rounded),
            label: const Text('新建入库'),
          ),
      ],
      children: [
        SizedBox(
          width: 180,
          child: DropdownButtonFormField<String?>(
            key: const ValueKey('warehouse-inbound-warehouse-filter'),
            initialValue: _warehouses.any(
              (warehouse) => warehouse.id == _warehouseId,
            )
                ? _warehouseId
                : null,
            decoration: InputDecoration(
              labelText: '仓库',
              helperText: _warehousesLoading
                  ? '加载中'
                  : _warehousesError == null
                      ? null
                      : '加载失败',
            ),
            items: [
              const DropdownMenuItem(value: null, child: Text('全部仓库')),
              ..._warehouses.map(
                (warehouse) => DropdownMenuItem(
                  value: warehouse.id,
                  child: Text(warehouse.name, overflow: TextOverflow.ellipsis),
                ),
              ),
            ],
            onChanged: _warehousesLoading
                ? null
                : (value) => setState(() => _warehouseId = value),
          ),
        ),
        SizedBox(
          width: 210,
          child: DropdownButtonFormField<String?>(
            key: const ValueKey('warehouse-inbound-product-filter'),
            initialValue: _products.any((product) => product.id == _productId)
                ? _productId
                : null,
            decoration: InputDecoration(
              labelText: '商品名称',
              helperText: _productsLoading
                  ? '加载中'
                  : _productsError == null
                      ? null
                      : '加载失败',
            ),
            items: [
              const DropdownMenuItem(value: null, child: Text('全部商品')),
              ..._products.map(
                (product) => DropdownMenuItem(
                  value: product.id,
                  child: Text(product.name, overflow: TextOverflow.ellipsis),
                ),
              ),
            ],
            onChanged: _productsLoading
                ? null
                : (value) => setState(() => _productId = value),
          ),
        ),
        SizedBox(
          width: 150,
          child: DropdownButtonFormField<String?>(
            key: const ValueKey('warehouse-inbound-type-filter'),
            initialValue: _type,
            decoration: const InputDecoration(labelText: '入库类型'),
            items: const [
              DropdownMenuItem(value: null, child: Text('全部类型')),
              DropdownMenuItem(value: 'OPENING', child: Text('期初库存')),
              DropdownMenuItem(
                value: 'PURCHASE_RECEIPT',
                child: Text('采购入库'),
              ),
              DropdownMenuItem(value: 'OTHER_IN', child: Text('其他入库')),
            ],
            onChanged: (value) => setState(() => _type = value),
          ),
        ),
        SizedBox(
          width: 140,
          child: DropdownButtonFormField<String?>(
            key: const ValueKey('warehouse-inbound-status-filter'),
            initialValue: _status,
            decoration: const InputDecoration(labelText: '状态'),
            items: const [
              DropdownMenuItem(value: null, child: Text('全部状态')),
              DropdownMenuItem(value: 'POSTED', child: Text('已生效')),
              DropdownMenuItem(value: 'REVERSED', child: Text('已冲销')),
            ],
            onChanged: (value) => setState(() => _status = value),
          ),
        ),
        SizedBox(
          width: 210,
          child: TextField(
            key: const ValueKey('warehouse-inbound-po-filter'),
            controller: _purchaseOrderController,
            decoration: const InputDecoration(
              labelText: '采购单号',
              helperText: '服务端同时匹配生产批次',
            ),
            onSubmitted: (_) => _load(resetPage: true),
          ),
        ),
        SizedBox(
          width: 190,
          child: TextField(
            key: const ValueKey('warehouse-inbound-supplier-filter'),
            controller: _supplierController,
            decoration: const InputDecoration(labelText: '供应商'),
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => _load(resetPage: true),
          ),
        ),
        OutlinedButton.icon(
          key: const ValueKey('warehouse-inbound-date-from-filter'),
          onPressed: () => _selectDate(isFrom: true),
          icon: const Icon(Icons.calendar_today_outlined, size: 18),
          label: Text(
            _dateFrom == null ? '开始日期' : _formatInboundDay(_dateFrom!),
          ),
        ),
        OutlinedButton.icon(
          key: const ValueKey('warehouse-inbound-date-to-filter'),
          onPressed: () => _selectDate(isFrom: false),
          icon: const Icon(Icons.event_outlined, size: 18),
          label: Text(_dateTo == null ? '结束日期' : _formatInboundDay(_dateTo!)),
        ),
      ],
    );
  }

  Widget _buildBody(bool wide) {
    if (_loading) {
      return const LoadingState(title: '正在加载入库单');
    }
    if (_error != null && _page == null) {
      return ErrorState(
        title: _error!,
        onRetry: () => _load(resetPage: false),
      );
    }
    final records = _page?.inbounds ?? const <InboundDocumentRecord>[];
    if (records.isEmpty) {
      return EmptyState(
        title: _hasActiveFilters ? '没有符合筛选条件的入库单' : '暂无入库记录',
        action: _hasActiveFilters
            ? OutlinedButton.icon(
                key: const ValueKey('warehouse-inbound-clear-empty-filter'),
                onPressed: _resetFilters,
                icon: const Icon(Icons.filter_alt_off_rounded),
                label: const Text('清除筛选'),
              )
            : _canWrite
                ? FilledButton.icon(
                    key: const ValueKey('warehouse-inbound-create-empty'),
                    onPressed: _showCreateEditor,
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('新建入库'),
                  )
                : null,
      );
    }
    if (wide) {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: _buildDesktopTable(records)),
          if (_selectedDocumentId != null) ...[
            const SizedBox(width: 12),
            SizedBox(width: 390, child: _buildDetailPanel()),
          ],
        ],
      );
    }
    return _buildMobileList(records);
  }

  Widget _buildDesktopTable(List<InboundDocumentRecord> records) {
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: Scrollbar(
        thumbVisibility: true,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SingleChildScrollView(
            child: DataTable(
              key: const ValueKey('warehouse-inbound-desktop-table'),
              showCheckboxColumn: false,
              columns: [
                const DataColumn(label: Text('入库单号')),
                const DataColumn(label: Text('类型')),
                const DataColumn(label: Text('仓库')),
                const DataColumn(label: Text('商品/数量')),
                const DataColumn(label: Text('供应商')),
                const DataColumn(label: Text('采购单号')),
                const DataColumn(label: Text('状态')),
                if (_canReadCost) const DataColumn(label: Text('成本')),
                const DataColumn(label: Text('经办人')),
                const DataColumn(label: Text('业务时间')),
              ],
              rows: [
                for (final document in records)
                  DataRow(
                    key: ValueKey('warehouse-inbound-row-${document.id}'),
                    selected: document.id == _selectedDocumentId,
                    onSelectChanged: (_) => _loadDetail(document.id),
                    cells: [
                      DataCell(
                        Text(
                          _displayDocumentNo(document),
                          key: ValueKey(
                            'warehouse-inbound-select-${document.id}',
                          ),
                        ),
                        onTap: () => _loadDetail(document.id),
                      ),
                      DataCell(Text(document.typeLabel)),
                      DataCell(Text(document.warehouseName)),
                      DataCell(
                        Text(
                          '${document.productKinds} 种 / '
                          '${document.totalQuantity} 瓶',
                        ),
                      ),
                      DataCell(Text(document.batchSupplierName ?? '—')),
                      DataCell(Text(document.batchPurchaseOrderNo ?? '—')),
                      DataCell(_inboundStatus(document)),
                      if (_canReadCost) DataCell(_costSummary(document)),
                      DataCell(Text(document.postedBy.name ?? '—')),
                      DataCell(Text(_formatInboundDate(document.businessAt))),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMobileList(List<InboundDocumentRecord> records) {
    final page = _page!;
    return RefreshIndicator(
      onRefresh: () => _load(resetPage: true, keepData: true),
      child: ListView(
        key: const ValueKey('warehouse-inbound-mobile-list'),
        children: [
          for (final document in records)
            Card(
              key: ValueKey('warehouse-inbound-card-${document.id}'),
              child: InkWell(
                onTap: () => _showMobileDetail(document.id),
                borderRadius: BorderRadius.circular(12),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              _displayDocumentNo(document),
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          _inboundStatus(document),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text('${document.typeLabel} · ${document.warehouseName}'),
                      const SizedBox(height: 4),
                      Text(
                        '${document.productKinds} 种商品 · '
                        '${document.totalQuantity} 瓶',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      if ((document.batchPurchaseOrderNo ?? '').isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text('采购单号：${document.batchPurchaseOrderNo}'),
                      ],
                      const SizedBox(height: 6),
                      Text(
                        '业务时间：${_formatInboundDate(document.businessAt)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          if (page.page < page.totalPages)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: OutlinedButton.icon(
                key: const ValueKey('warehouse-inbound-load-more'),
                onPressed: _loadingMore ? null : _loadMore,
                icon: _loadingMore
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.expand_more_rounded),
                label: Text(_loadingMore ? '加载中...' : '加载更多'),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildDetailPanel() {
    if (_detailLoading) {
      return const LoadingState(title: '正在加载入库详情');
    }
    if (_detailError != null) {
      return ErrorState(
        title: _detailError!,
        onRetry: _selectedDocumentId == null
            ? null
            : () => _loadDetail(_selectedDocumentId!),
      );
    }
    final detail = _detail;
    if (detail == null) {
      return const EmptyState(title: '选择入库单查看详情');
    }
    return _InboundDetailView(
      document: detail,
      canReadCost: _canReadCost,
      canMaintainCost: _canMaintainCost,
      canReverse: _canWrite && detail.status == 'POSTED',
      onReverse: () => _requestReverse(detail),
      onMaintainCost: _requestCostUpdate,
    );
  }

  Future<void> _showMobileDetail(String documentId) async {
    final future = widget.api.getInbound(documentId);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) => SizedBox(
        height: MediaQuery.sizeOf(sheetContext).height * 0.88,
        child: FutureBuilder<InboundDocumentRecord>(
          future: future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const LoadingState(title: '正在加载入库详情');
            }
            if (snapshot.hasError || !snapshot.hasData) {
              return ErrorState(
                title: snapshot.hasError
                    ? inventoryErrorMessage(snapshot.error!)
                    : '入库详情不可用',
                onRetry: () {
                  Navigator.pop(sheetContext);
                  _showMobileDetail(documentId);
                },
              );
            }
            final document = snapshot.data!;
            return _InboundDetailView(
              document: document,
              canReadCost: _canReadCost,
              canMaintainCost: _canMaintainCost,
              canReverse: _canWrite && document.status == 'POSTED',
              onReverse: () async {
                Navigator.pop(sheetContext);
                await _requestReverse(document);
              },
              onMaintainCost: (line) async {
                Navigator.pop(sheetContext);
                await _requestCostUpdate(line);
              },
            );
          },
        ),
      ),
    );
  }

  Future<void> _requestReverse(InboundDocumentRecord document) async {
    final reason = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => const _InboundReasonDialog(),
    );
    if (reason == null || !mounted) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: '确认冲销入库单？',
      content: '入库单 ${_displayDocumentNo(document)} 已经生效。'
          '冲销会创建反向库存流水，原单不会删除。原因：$reason',
      confirmLabel: '确认冲销',
      danger: true,
    );
    if (!confirmed || !mounted) return;
    try {
      await widget.api.reverseInbound(document.id, reason);
      widget.onInventoryFactsChanged();
      _showSnack('入库单已冲销，原单和反向流水均已保留。');
      await _load(
        resetPage: true,
        keepData: true,
        focusDocumentId: document.id,
      );
    } catch (error) {
      if (mounted) _showSnack(inventoryErrorMessage(error));
    }
  }

  Future<void> _requestCostUpdate(InboundDocumentLine line) async {
    final batch = line.batch;
    if (batch == null || batch.id.isEmpty) return;
    final cents = await showDialog<int>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => _InboundCostInputDialog(
        productName: line.productName,
        productionBatch: batch.productionBatch,
        costStatus: batch.costStatus,
        initialCents: batch.purchaseUnitCostCents,
      ),
    );
    if (cents == null || !mounted) return;
    try {
      await widget.api.updateBatchCost(
        batchId: batch.id,
        purchaseUnitCostCents: cents,
      );
      widget.onInventoryFactsChanged();
      _showSnack('批次成本已更新，相关库存与报表缓存已失效。');
      await _load(
        resetPage: false,
        keepData: true,
        focusDocumentId: _selectedDocumentId,
      );
    } catch (error) {
      if (mounted) _showSnack(inventoryErrorMessage(error));
    }
  }

  Future<void> _showCreateEditor() async {
    if (_warehousesError != null || _warehouses.isEmpty) {
      _showSnack(
        _warehousesError == null ? '暂无启用仓库，无法创建入库单。' : '仓库选项加载失败，请重试。',
      );
      return;
    }
    if (_productsLoading) {
      _showSnack('商品选项正在加载，请稍后重试。');
      return;
    }
    if (_productsError != null) {
      _showSnack('商品选项加载失败，正在重试。');
      _loadProducts();
      return;
    }
    final editor = _InboundCreateEditor(
      api: widget.api,
      warehouses: _warehouses,
      productOptions: _products,
      productsLoading: _productsLoading,
      productsError: _productsError,
      onRetryProducts: _loadProducts,
      canSetCost: _canSetCostOnInbound,
      canManageProductInventoryMode: _canManageProductInventoryMode,
      initialWarehouseId:
          _warehouseId ?? widget.requestedSelection?.warehouseId,
      initialProductId: _productId ?? widget.requestedSelection?.productId,
      onOpenSerialized: widget.onOpenSerialized,
      onOpenProductManagement: widget.onOpenProductManagement,
    );
    final mobile = MediaQuery.sizeOf(context).width < AppBreakpoints.tablet;
    final result = mobile
        ? await showModalBottomSheet<InventoryCommandResult>(
            context: context,
            isScrollControlled: true,
            useSafeArea: true,
            isDismissible: false,
            enableDrag: false,
            builder: (context) => InventoryKeyboardSafeSheet(
              heightFactor: .94,
              child: editor,
            ),
          )
        : await showDialog<InventoryCommandResult>(
            context: context,
            barrierDismissible: false,
            builder: (context) {
              final availableHeight = MediaQuery.sizeOf(context).height - 64;
              final dialogHeight =
                  availableHeight.clamp(360.0, 760.0).toDouble();
              return Dialog(
                child: SizedBox(
                  width: 820,
                  height: dialogHeight,
                  child: editor,
                ),
              );
            },
          );
    if (result == null || !mounted) return;
    widget.onInventoryFactsChanged();
    _showSnack(
      result.replayed ? '该入库请求已处理，正在定位原单据。' : '入库已生效，正在定位新单据。',
    );
    await _load(
      resetPage: true,
      keepData: true,
      focusDocumentId: result.documentId,
    );
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}

class _InboundReasonDialog extends StatefulWidget {
  const _InboundReasonDialog();

  @override
  State<_InboundReasonDialog> createState() => _InboundReasonDialogState();
}

class _InboundReasonDialogState extends State<_InboundReasonDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('填写冲销原因'),
      content: TextField(
        key: const ValueKey('warehouse-inbound-reverse-reason'),
        controller: _controller,
        autofocus: true,
        maxLines: 3,
        decoration: const InputDecoration(
          labelText: '冲销原因（必填）',
          border: OutlineInputBorder(),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          key: const ValueKey('warehouse-inbound-reverse-next'),
          onPressed: () {
            final value = _controller.text.trim();
            if (value.isEmpty) return;
            Navigator.pop(context, value);
          },
          child: const Text('下一步'),
        ),
      ],
    );
  }
}

class _InboundCostInputDialog extends StatefulWidget {
  const _InboundCostInputDialog({
    required this.productName,
    required this.productionBatch,
    required this.costStatus,
    required this.initialCents,
  });

  final String productName;
  final String? productionBatch;
  final String? costStatus;
  final int? initialCents;

  @override
  State<_InboundCostInputDialog> createState() =>
      _InboundCostInputDialogState();
}

class _InboundCostInputDialogState extends State<_InboundCostInputDialog> {
  late final TextEditingController _controller;
  String? _fieldError;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text:
          widget.initialCents == null ? '' : _centsInput(widget.initialCents!),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      key: const ValueKey('warehouse-inbound-cost-dialog'),
      title: Text(
        widget.costStatus == 'pending' ? '补录批次成本' : '维护批次成本',
      ),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${widget.productName} · 批次 '
              '${widget.productionBatch ?? '—'}',
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('warehouse-inbound-cost-input'),
              controller: _controller,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [
                TextInputFormatter.withFunction((oldValue, newValue) {
                  return RegExp(r'^\d*(?:\.\d{0,2})?$').hasMatch(newValue.text)
                      ? newValue
                      : oldValue;
                }),
              ],
              decoration: InputDecoration(
                labelText: '采购单价（元）',
                helperText: '只允许非负金额，最多两位小数',
                errorText: _fieldError,
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          key: const ValueKey('warehouse-inbound-cost-save'),
          onPressed: () {
            final value = parseNonNegativeYuanCents(_controller.text);
            if (value == null) {
              setState(() => _fieldError = '请输入非负金额，最多两位小数');
              return;
            }
            Navigator.pop(context, value);
          },
          child: const Text('确认'),
        ),
      ],
    );
  }
}

class _InboundDetailView extends StatelessWidget {
  const _InboundDetailView({
    required this.document,
    required this.canReadCost,
    required this.canMaintainCost,
    required this.canReverse,
    required this.onReverse,
    required this.onMaintainCost,
  });

  final InboundDocumentRecord document;
  final bool canReadCost;
  final bool canMaintainCost;
  final bool canReverse;
  final Future<void> Function() onReverse;
  final Future<void> Function(InboundDocumentLine line) onMaintainCost;

  @override
  Widget build(BuildContext context) {
    InboundDocumentLine? costLine;
    if (canMaintainCost) {
      for (final line in document.lines) {
        if (line.batch != null && line.batch!.id.isNotEmpty) {
          costLine = line;
          break;
        }
      }
    }
    return Material(
      key: ValueKey('warehouse-inbound-detail-${document.id}'),
      color: Theme.of(context).colorScheme.surface,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  _displayDocumentNo(document),
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              _inboundStatus(document),
            ],
          ),
          const SizedBox(height: 12),
          if (canReverse || costLine != null) ...[
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (costLine != null)
                  OutlinedButton.icon(
                    key: ValueKey(
                      'warehouse-inbound-maintain-cost-'
                      '${costLine.batch!.id}',
                    ),
                    onPressed: () => onMaintainCost(costLine!),
                    icon: const Icon(Icons.currency_yuan_rounded, size: 18),
                    label: Text(
                      costLine.batch!.costStatus == 'pending'
                          ? '补录批次成本'
                          : '维护成本',
                    ),
                  ),
                if (canReverse)
                  FilledButton.icon(
                    key: ValueKey(
                      'warehouse-inbound-reverse-${document.id}',
                    ),
                    style: FilledButton.styleFrom(
                      backgroundColor: Theme.of(context).colorScheme.error,
                    ),
                    onPressed: onReverse,
                    icon: const Icon(Icons.undo_rounded),
                    label: const Text('冲销入库单'),
                  ),
              ],
            ),
            const SizedBox(height: 12),
          ],
          FormSection(
            title: '基本信息',
            children: [
              _detailRow('类型', document.typeLabel),
              _detailRow(
                '仓库',
                '${document.warehouseCode.isEmpty ? '' : '${document.warehouseCode} · '}'
                    '${document.warehouseName}',
              ),
              _detailRow('业务时间', _formatInboundDate(document.businessAt)),
              _detailRow('经办人', document.postedBy.name ?? '—'),
              _detailRow('生效时间', _formatInboundDate(document.postedAt)),
              if (document.reversedAt != null)
                _detailRow('冲销时间', _formatInboundDate(document.reversedAt)),
              _detailRow('备注', document.reason ?? '—'),
            ],
          ),
          FormSection(
            title: '商品明细',
            children: [
              for (final line in document.lines)
                _InboundLineCard(
                  line: line,
                  canReadCost: canReadCost,
                ),
            ],
          ),
          if (document.attachments.isNotEmpty)
            FormSection(
              title: '附件元数据',
              children: [
                for (final attachment in document.attachments)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.attach_file_rounded),
                    title: Text(attachment.fileName),
                    subtitle: Text(
                      '${attachment.contentType} · ${attachment.sizeBytes} 字节',
                    ),
                  ),
                const InventoryInlineNotice(
                  message: '当前后端只提供安全附件元数据，没有真实文件下载能力。',
                  tone: StatusTone.warning,
                ),
              ],
            ),
          FormSection(
            title: '审计与不可变规则',
            children: [
              _detailRow('来源类型', document.sourceType),
              _detailRow('来源键', document.sourceKey),
              _detailRow('创建时间', _formatInboundDate(document.createdAt)),
              _detailRow('最近修改', _formatInboundDate(document.updatedAt)),
              const SizedBox(height: 8),
              const InventoryInlineNotice(
                message: '已生效入库单不能直接改数量或删除；纠错只能创建冲销流水。',
                tone: StatusTone.info,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _InboundLineCard extends StatelessWidget {
  const _InboundLineCard({
    required this.line,
    required this.canReadCost,
  });

  final InboundDocumentLine line;
  final bool canReadCost;

  @override
  Widget build(BuildContext context) {
    final batch = line.batch;
    return Card.outlined(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    line.productName,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
                Text('${line.quantity} 瓶'),
              ],
            ),
            const SizedBox(height: 8),
            _detailRow(
              '库存状态',
              line.condition == 'unavailable' ? '不可售' : '可售',
            ),
            if (batch != null) ...[
              _detailRow('供应商', batch.supplierName ?? '—'),
              _detailRow('采购单号', batch.purchaseOrderNo ?? '—'),
              _detailRow('生产批次', batch.productionBatch ?? '—'),
              _detailRow('生产日期', batch.productionDate ?? '—'),
              _detailRow('批次现存', '${batch.remainingQty} 瓶'),
              _detailRow('批次不可售', '${batch.unavailableQty} 瓶'),
              if (canReadCost) ...[
                _detailRow(
                  '成本状态',
                  batch.costStatus == 'complete' ? '已补齐' : '待补成本',
                ),
                _detailRow(
                  '采购单价',
                  batch.purchaseUnitCostCents == null
                      ? '暂未提供'
                      : formatMoneyCents(batch.purchaseUnitCostCents!),
                ),
                _detailRow(
                  '入库金额',
                  line.inventoryAmountCents == null
                      ? '暂未提供'
                      : formatMoneyCents(line.inventoryAmountCents!),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

class _InboundCreateEditor extends StatefulWidget {
  const _InboundCreateEditor({
    required this.api,
    required this.warehouses,
    required this.productOptions,
    required this.productsLoading,
    required this.productsError,
    required this.onRetryProducts,
    required this.canSetCost,
    required this.canManageProductInventoryMode,
    required this.onOpenSerialized,
    required this.onOpenProductManagement,
    this.initialWarehouseId,
    this.initialProductId,
  });

  final InventoryApi api;
  final List<WarehouseRecord> warehouses;
  final List<ProductOptionRecord> productOptions;
  final bool productsLoading;
  final String? productsError;
  final VoidCallback onRetryProducts;
  final bool canSetCost;
  final bool canManageProductInventoryMode;
  final VoidCallback onOpenSerialized;
  final VoidCallback? onOpenProductManagement;
  final String? initialWarehouseId;
  final String? initialProductId;

  @override
  State<_InboundCreateEditor> createState() => _InboundCreateEditorState();
}

class _InboundCreateEditorState extends State<_InboundCreateEditor> {
  final _formKey = GlobalKey<FormState>();
  final _supplierController = TextEditingController();
  final _purchaseOrderController = TextEditingController();
  final _productionBatchController = TextEditingController();
  final _quantityController = TextEditingController();
  final _notesController = TextEditingController();
  final _costController = TextEditingController();

  String _kind = 'PURCHASE_RECEIPT';
  String? _warehouseId;
  String? _productId;
  String? _productName;
  String? _productUnit;
  DateTime _businessDate = DateTime.now();
  DateTime? _productionDate;
  bool _saving = false;
  bool _dirty = false;
  bool _allowPop = false;
  String? _error;
  late final String _sourceLineKey;

  List<ProductOptionRecord> get _quantityProducts => widget.productOptions
      .where((product) => product.inventoryTrackingMode == 'quantity')
      .toList();

  String get _quantityProductEmptyDetail {
    if (widget.productOptions.isEmpty) {
      return '系统当前没有任何启用商品。';
    }
    if (widget.productOptions.every(
      (product) => product.inventoryTrackingMode == 'serialized',
    )) {
      return '当前启用商品全部为逐瓶库存商品，普通入库不会展示这些商品。';
    }
    return '系统存在启用商品，但它们尚未启用普通数量库存。';
  }

  void _openProductManagement() {
    if (widget.onOpenProductManagement == null) return;
    setState(() => _allowPop = true);
    Navigator.of(context).pop();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      widget.onOpenProductManagement?.call();
    });
  }

  @override
  void initState() {
    super.initState();
    _sourceLineKey =
        'flutter-inbound-line-${DateTime.now().microsecondsSinceEpoch}';
    _warehouseId = widget.warehouses.any(
      (warehouse) => warehouse.id == widget.initialWarehouseId,
    )
        ? widget.initialWarehouseId
        : null;
    ProductOptionRecord? initial;
    for (final product in widget.productOptions) {
      if (product.id == widget.initialProductId &&
          product.inventoryTrackingMode == 'quantity') {
        initial = product;
        break;
      }
    }
    if (initial != null) {
      _productId = initial.id;
      _productName = initial.name;
      _productUnit = initial.unit;
    }
  }

  @override
  void dispose() {
    _supplierController.dispose();
    _purchaseOrderController.dispose();
    _productionBatchController.dispose();
    _quantityController.dispose();
    _notesController.dispose();
    _costController.dispose();
    super.dispose();
  }

  void _markDirty() {
    if (!_dirty) setState(() => _dirty = true);
  }

  Future<void> _requestClose() async {
    if (_saving) return;
    if (_dirty) {
      final discard = await confirmInventoryAction(
        context,
        title: '放弃未保存的入库单？',
        content: '当前填写内容尚未提交，关闭后将丢失。',
        confirmLabel: '放弃并关闭',
        danger: true,
      );
      if (!discard || !mounted) return;
    }
    setState(() => _allowPop = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.pop(context);
    });
  }

  Future<void> _openSerializedInbound() async {
    if (_saving) return;
    if (_dirty) {
      final discard = await confirmInventoryAction(
        context,
        title: '放弃当前普通入库单？',
        content: '打开逐瓶入库将关闭当前表单，尚未提交的内容会丢失。',
        confirmLabel: '放弃并打开逐瓶入库',
        danger: true,
      );
      if (!discard || !mounted) return;
    }
    setState(() {
      _allowPop = true;
      _dirty = false;
    });
    Navigator.pop(context);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      widget.onOpenSerialized();
    });
  }

  Future<void> _pickBusinessDate() async {
    final value = await showDatePicker(
      context: context,
      initialDate: _businessDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (value == null || !mounted) return;
    setState(() {
      _businessDate = value;
      _dirty = true;
    });
  }

  Future<void> _pickProductionDate() async {
    final value = await showDatePicker(
      context: context,
      initialDate: _productionDate ?? _businessDate,
      firstDate: DateTime(1900),
      lastDate: DateTime(2100),
    );
    if (value == null || !mounted) return;
    setState(() {
      _productionDate = value;
      _dirty = true;
    });
  }

  Future<void> _save() async {
    if (_saving || !_formKey.currentState!.validate()) return;
    final quantity = parseBottleQuantity(_quantityController.text);
    if (quantity == null || _warehouseId == null || _productId == null) return;
    int? costCents;
    if (widget.canSetCost && _costController.text.trim().isNotEmpty) {
      costCents = parseNonNegativeYuanCents(_costController.text);
      if (costCents == null) {
        setState(() => _error = '采购单价必须是非负金额，且最多两位小数。');
        return;
      }
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final confirmed = await confirmInventoryAction(
      context,
      title: '确认入库生效？',
      content: '本次提交会立即生成已生效入库单：'
          '$_productName，$quantity 瓶，仓库 ${_warehouseName(_warehouseId!)}。'
          '生效后不能直接改数量或删除。',
      confirmLabel: '确认入库并生效',
    );
    if (!mounted) return;
    if (!confirmed) {
      setState(() => _saving = false);
      return;
    }
    try {
      final result = await widget.api.createInbound(
        kind: _kind,
        warehouseId: _warehouseId!,
        productId: _productId!,
        quantity: quantity,
        sourceLineKey: _sourceLineKey,
        businessAt: _businessDate,
        supplierName: _textOrNull(_supplierController.text),
        purchaseOrderNo: _textOrNull(_purchaseOrderController.text),
        productionBatch: _textOrNull(_productionBatchController.text),
        productionDate: _productionDate,
        notes: _textOrNull(_notesController.text),
        purchaseUnitCostCents: costCents,
      );
      if (!mounted) return;
      setState(() {
        _allowPop = true;
        _dirty = false;
      });
      Navigator.pop(context, result);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = inventoryErrorMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<InventoryCommandResult>(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _requestClose();
      },
      child: InventoryKeyboardScope(
        onEscape: _saving
            ? null
            : () {
                _requestClose();
              },
        child: Material(
          key: const ValueKey('warehouse-inbound-create-dialog'),
          color: Theme.of(context).colorScheme.surface,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 8, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '新建入库',
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                    IconButton(
                      key: const ValueKey('warehouse-inbound-create-close'),
                      tooltip: '关闭',
                      onPressed: _saving ? null : _requestClose,
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: Form(
                  key: _formKey,
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        FormSection(
                          title: '基本信息',
                          children: [
                            ResponsiveFormGrid(
                              children: [
                                DropdownButtonFormField<String>(
                                  key: const ValueKey(
                                    'warehouse-inbound-kind-field',
                                  ),
                                  initialValue: _kind,
                                  decoration:
                                      const InputDecoration(labelText: '入库类型'),
                                  items: const [
                                    DropdownMenuItem(
                                      value: 'OPENING',
                                      child: Text('期初库存'),
                                    ),
                                    DropdownMenuItem(
                                      value: 'PURCHASE_RECEIPT',
                                      child: Text('采购入库'),
                                    ),
                                    DropdownMenuItem(
                                      value: 'OTHER_IN',
                                      child: Text('其他入库'),
                                    ),
                                  ],
                                  onChanged: _saving
                                      ? null
                                      : (value) => setState(() {
                                            _kind = value ?? 'PURCHASE_RECEIPT';
                                            _dirty = true;
                                          }),
                                ),
                                DropdownButtonFormField<String>(
                                  key: const ValueKey(
                                    'warehouse-inbound-warehouse-field',
                                  ),
                                  initialValue: _warehouseId,
                                  decoration:
                                      const InputDecoration(labelText: '仓库'),
                                  items: widget.warehouses
                                      .map(
                                        (warehouse) => DropdownMenuItem(
                                          value: warehouse.id,
                                          child: Text(warehouse.name),
                                        ),
                                      )
                                      .toList(),
                                  onChanged: _saving
                                      ? null
                                      : (value) => setState(() {
                                            _warehouseId = value;
                                            _dirty = true;
                                          }),
                                  validator: (value) =>
                                      value == null ? '请选择仓库' : null,
                                ),
                                OutlinedButton.icon(
                                  key: const ValueKey(
                                    'warehouse-inbound-business-date-field',
                                  ),
                                  onPressed: _saving ? null : _pickBusinessDate,
                                  icon:
                                      const Icon(Icons.calendar_today_outlined),
                                  label: Text(
                                    '业务日期：'
                                    '${_formatInboundDay(_businessDate)}',
                                  ),
                                ),
                                TextFormField(
                                  key: const ValueKey(
                                    'warehouse-inbound-supplier-field',
                                  ),
                                  controller: _supplierController,
                                  enabled: !_saving,
                                  onChanged: (_) => _markDirty(),
                                  decoration: const InputDecoration(
                                    labelText: '供应商（选填）',
                                  ),
                                ),
                                TextFormField(
                                  key: const ValueKey(
                                    'warehouse-inbound-po-field',
                                  ),
                                  controller: _purchaseOrderController,
                                  enabled: !_saving,
                                  onChanged: (_) => _markDirty(),
                                  decoration: const InputDecoration(
                                    labelText: '采购单号（选填）',
                                    helperText: '按字符串保存，保留前导零',
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              key: const ValueKey(
                                'warehouse-inbound-reason-field',
                              ),
                              controller: _notesController,
                              enabled: !_saving,
                              onChanged: (_) => _markDirty(),
                              maxLines: 2,
                              decoration:
                                  const InputDecoration(labelText: '备注（选填）'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        FormSection(
                          title: '商品明细',
                          children: [
                            const InventoryInlineNotice(
                              key: ValueKey(
                                  'warehouse-inbound-single-line-limit'),
                              message: '当前后端每张入库单只支持 1 条商品明细。'
                                  '页面不会拆成多个隐式请求制造半成功；多明细需等待接口升级。',
                              tone: StatusTone.warning,
                            ),
                            const SizedBox(height: 12),
                            ProductOptionPickerField(
                              key: const ValueKey(
                                'warehouse-inbound-product-field',
                              ),
                              options: _quantityProducts,
                              loading: widget.productsLoading,
                              loadError: widget.productsError,
                              onRetry: widget.onRetryProducts,
                              productId: _productId,
                              snapshotName: _productName,
                              snapshotUnit: _productUnit,
                              enabled: !_saving,
                              label: '普通数量商品',
                              emptyMessage: '暂无已启用普通数量库存的商品，请先在商品管理中启用数量库存。',
                              onChanged: (product) => setState(() {
                                _productId = product.id;
                                _productName = product.name;
                                _productUnit = product.unit;
                                _dirty = true;
                              }),
                            ),
                            if (!widget.productsLoading &&
                                widget.productsError == null &&
                                _quantityProducts.isEmpty) ...[
                              const SizedBox(height: 10),
                              InventoryInlineNotice(
                                key: const ValueKey(
                                  'warehouse-inbound-quantity-empty-state',
                                ),
                                message: _quantityProductEmptyDetail,
                                tone: StatusTone.warning,
                              ),
                              const SizedBox(height: 6),
                              if (widget.canManageProductInventoryMode &&
                                  widget.onOpenProductManagement != null)
                                Align(
                                  alignment: Alignment.centerLeft,
                                  child: TextButton.icon(
                                    key: const ValueKey(
                                      'warehouse-inbound-open-product-management',
                                    ),
                                    onPressed:
                                        _saving ? null : _openProductManagement,
                                    icon: const Icon(
                                      Icons.inventory_2_outlined,
                                    ),
                                    label: const Text('前往商品管理启用数量库存'),
                                  ),
                                )
                              else
                                const InventoryInlineNotice(
                                  key: ValueKey(
                                    'warehouse-inbound-contact-admin',
                                  ),
                                  message: '请联系管理员在商品管理中启用普通数量库存。',
                                  tone: StatusTone.info,
                                ),
                            ],
                            const SizedBox(height: 10),
                            InventoryInlineNotice(
                              message: widget.productOptions.any(
                                (product) =>
                                    product.inventoryTrackingMode ==
                                    'serialized',
                              )
                                  ? '逐瓶商品不会出现在普通入库选择器中，'
                                      '请进入茅台逐瓶库存使用真实逐瓶入库流程。'
                                  : '这里只允许 inventoryTrackingMode=QUANTITY '
                                      '的商品。',
                              tone: StatusTone.info,
                            ),
                            Align(
                              alignment: Alignment.centerLeft,
                              child: TextButton.icon(
                                key: const ValueKey(
                                  'warehouse-inbound-open-serialized',
                                ),
                                onPressed:
                                    _saving ? null : _openSerializedInbound,
                                icon: const Icon(Icons.qr_code_rounded),
                                label: const Text('打开茅台逐瓶入库'),
                              ),
                            ),
                            ResponsiveFormGrid(
                              children: [
                                TextFormField(
                                  key: const ValueKey(
                                    'warehouse-inbound-quantity-field',
                                  ),
                                  controller: _quantityController,
                                  enabled: !_saving,
                                  onChanged: (_) => _markDirty(),
                                  keyboardType: TextInputType.number,
                                  inputFormatters: [
                                    FilteringTextInputFormatter.digitsOnly,
                                  ],
                                  decoration: const InputDecoration(
                                    labelText: '数量（瓶）',
                                  ),
                                  validator: (value) =>
                                      parseBottleQuantity(value ?? '') == null
                                          ? '数量必须为正整数'
                                          : null,
                                ),
                                TextFormField(
                                  key: const ValueKey(
                                    'warehouse-inbound-batch-field',
                                  ),
                                  controller: _productionBatchController,
                                  enabled: !_saving,
                                  onChanged: (_) => _markDirty(),
                                  decoration: const InputDecoration(
                                    labelText: '生产批次（选填）',
                                    helperText: '按字符串保存，保留前导零',
                                  ),
                                ),
                                OutlinedButton.icon(
                                  key: const ValueKey(
                                    'warehouse-inbound-production-date-field',
                                  ),
                                  onPressed:
                                      _saving ? null : _pickProductionDate,
                                  icon: const Icon(Icons.event_outlined),
                                  label: Text(
                                    _productionDate == null
                                        ? '选择生产日期'
                                        : '生产日期：'
                                            '${_formatInboundDay(_productionDate!)}',
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                        if (widget.canSetCost) ...[
                          const SizedBox(height: 12),
                          FormSection(
                            title: '成本信息',
                            children: [
                              TextFormField(
                                key: const ValueKey(
                                  'warehouse-inbound-cost-field',
                                ),
                                controller: _costController,
                                enabled: !_saving,
                                onChanged: (_) => _markDirty(),
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                  decimal: true,
                                ),
                                inputFormatters: [
                                  TextInputFormatter.withFunction(
                                    (oldValue, newValue) {
                                      return RegExp(
                                        r'^\d*(?:\.\d{0,2})?$',
                                      ).hasMatch(newValue.text)
                                          ? newValue
                                          : oldValue;
                                    },
                                  ),
                                ],
                                decoration: const InputDecoration(
                                  labelText: '采购单价（元，选填）',
                                  helperText: '服务端以整数分保存；非负且最多两位小数',
                                ),
                                validator: (value) {
                                  if ((value ?? '').trim().isEmpty) return null;
                                  return parseNonNegativeYuanCents(value!) ==
                                          null
                                      ? '请输入非负金额，最多两位小数'
                                      : null;
                                },
                              ),
                            ],
                          ),
                        ],
                        if (_error != null) ...[
                          const SizedBox(height: 12),
                          InventoryInlineNotice(
                            key: const ValueKey(
                              'warehouse-inbound-submit-error',
                            ),
                            message: _error!,
                            tone: StatusTone.danger,
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: _saving ? null : _requestClose,
                      child: const Text('取消'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton.icon(
                      key: const ValueKey('warehouse-inbound-save-button'),
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const Icon(Icons.hourglass_top_rounded)
                          : const Icon(Icons.check_rounded),
                      label: Text(_saving ? '提交中...' : '确认入库并生效'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _warehouseName(String warehouseId) {
    return widget.warehouses
        .firstWhere((warehouse) => warehouse.id == warehouseId)
        .name;
  }
}

Widget _inboundStatus(InboundDocumentRecord document) {
  if (document.status == 'POSTED') {
    return const InventoryStatusTag(
      label: '已生效',
      tone: StatusTone.success,
      icon: Icons.check_circle_outline_rounded,
    );
  }
  if (document.status == 'REVERSED') {
    return const InventoryStatusTag(
      label: '已冲销',
      tone: StatusTone.neutral,
      icon: Icons.undo_rounded,
    );
  }
  return InventoryStatusTag(
    label: '未知状态（${document.status}）',
    tone: StatusTone.warning,
  );
}

Widget _costSummary(InboundDocumentRecord document) {
  final lines = document.lines;
  if (lines.any((line) => line.batch?.costStatus == 'pending')) {
    return const InventoryStatusTag(
      label: '待补成本',
      tone: StatusTone.warning,
      icon: Icons.currency_yuan_rounded,
    );
  }
  if (lines.isEmpty || lines.any((line) => line.inventoryAmountCents == null)) {
    return const Text('暂未提供');
  }
  final cents = lines.fold<int>(
    0,
    (total, line) => total + line.inventoryAmountCents!,
  );
  return Text(formatMoneyCents(cents));
}

Widget _detailRow(String label, String value) {
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 88,
          child: Text(
            label,
            style: const TextStyle(color: Colors.black54),
          ),
        ),
        Expanded(child: SelectableText(value)),
      ],
    ),
  );
}

String _displayDocumentNo(InboundDocumentRecord document) {
  return document.documentNo.isEmpty ? document.id : document.documentNo;
}

String _formatInboundDate(String? raw) {
  if (raw == null || raw.isEmpty) return '—';
  final value = DateTime.tryParse(raw)?.toLocal();
  if (value == null) return raw;
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  final hour = value.hour.toString().padLeft(2, '0');
  final minute = value.minute.toString().padLeft(2, '0');
  return '${value.year}-$month-$day $hour:$minute';
}

String _formatInboundDay(DateTime value) {
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  return '${value.year}-$month-$day';
}

String? _textOrNull(String value) {
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

String _centsInput(int cents) {
  final yuan = cents ~/ 100;
  final fraction = (cents % 100).toString().padLeft(2, '0');
  return '$yuan.$fraction';
}
