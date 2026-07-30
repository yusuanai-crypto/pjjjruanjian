part of '../inventory_workspace_tabs.dart';

class TransferTab extends StatefulWidget {
  const TransferTab({
    super.key,
    required this.api,
    required this.businessApi,
    required this.role,
    this.requestedSelection,
    this.requestedFilter,
    this.createRequestRevision = 0,
    this.filterRequestRevision = 0,
    this.onInventoryFactsChanged,
  });

  final InventoryApi api;
  final BusinessApi businessApi;
  final UserRole role;
  final InventorySelectionContext? requestedSelection;
  final String? requestedFilter;
  final int createRequestRevision;
  final int filterRequestRevision;
  final VoidCallback? onInventoryFactsChanged;

  @override
  State<TransferTab> createState() => _TransferTabState();
}

class _TransferTabState extends State<TransferTab> {
  final _productQuery = TextEditingController();
  TransferPage? _page;
  TransferRecord? _selected;
  List<WarehouseRecord> _warehouses = const [];
  List<ProductOptionRecord> _products = const [];
  String? _fromWarehouseId;
  String? _toWarehouseId;
  String? _status;
  String? _productId;
  DateTime? _dateFrom;
  DateTime? _dateTo;
  bool _loading = true;
  bool _referencesLoading = true;
  String? _error;
  int _pageNumber = 1;
  int _requestGeneration = 0;
  final Set<String> _busyActions = <String>{};

  bool get _canWrite => canInboundWrite(widget.role);

  @override
  void initState() {
    super.initState();
    _applyRequestedSelection();
    _loadReferences();
    _load();
    if (widget.createRequestRevision > 0) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _showCreateDialog());
    }
  }

  @override
  void didUpdateWidget(covariant TransferTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.filterRequestRevision != widget.filterRequestRevision) {
      _applyRequestedSelection();
      _pageNumber = 1;
      _load();
    }
    if (oldWidget.createRequestRevision != widget.createRequestRevision) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showCreateDialog();
      });
    }
  }

  @override
  void dispose() {
    _productQuery.dispose();
    super.dispose();
  }

  void _applyRequestedSelection() {
    _productId = widget.requestedSelection?.productId;
    _status = switch (widget.requestedFilter) {
      'in_transit' || 'transfer_timeout' => 'OUTBOUND',
      _ => _status,
    };
  }

  Future<void> _loadReferences() async {
    setState(() => _referencesLoading = true);
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
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _referencesLoading = false;
        _error = inventoryErrorMessage(error);
      });
    }
  }

  Future<void> _load({String? selectId}) async {
    final generation = ++_requestGeneration;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.api.listTransfers(
        page: _pageNumber,
        fromWarehouseId: _fromWarehouseId,
        toWarehouseId: _toWarehouseId,
        productId: _productId,
        status: _status,
        dateFrom: _dateFrom,
        dateTo: _dateTo,
      );
      if (!mounted || generation != _requestGeneration) return;
      TransferRecord? selected;
      final wantedId = selectId ?? _selected?.id;
      if (wantedId != null) {
        for (final transfer in page.transfers) {
          if (transfer.id == wantedId) {
            selected = transfer;
            break;
          }
        }
      }
      selected ??= page.transfers.isEmpty ? null : page.transfers.first;
      setState(() {
        _page = page;
        _selected = selected;
        _loading = false;
      });
      if (selected != null) _loadDetail(selected.id);
    } catch (error) {
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _loading = false;
        _error = inventoryErrorMessage(error);
      });
    }
  }

  Future<void> _loadDetail(String id) async {
    try {
      final detail = await widget.api.getTransfer(id);
      if (!mounted || _selected?.id != id) return;
      setState(() => _selected = detail);
    } catch (error) {
      if (mounted) _showSnack(inventoryErrorMessage(error));
    }
  }

  void _resetFilters() {
    setState(() {
      _fromWarehouseId = null;
      _toWarehouseId = null;
      _status = null;
      _productId = null;
      _dateFrom = null;
      _dateTo = null;
      _pageNumber = 1;
      _productQuery.clear();
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        InventoryFilterBar(
          actions: [
            FilledButton(
              key: const ValueKey('transfer-apply-filters'),
              onPressed: () {
                _pageNumber = 1;
                _load();
              },
              child: const Text('查询'),
            ),
            TextButton(onPressed: _resetFilters, child: const Text('重置')),
            IconButton(
              tooltip: '刷新',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh_rounded),
            ),
            if (_canWrite)
              FilledButton.icon(
                key: const ValueKey('transfer-create'),
                onPressed: _referencesLoading ? null : _showCreateDialog,
                icon: const Icon(Icons.add_rounded),
                label: const Text('新建调拨'),
              ),
          ],
          children: [
            _warehouseFilter(
              key: const ValueKey('transfer-from-filter'),
              value: _fromWarehouseId,
              label: '来源仓',
              onChanged: (value) => setState(() => _fromWarehouseId = value),
            ),
            _warehouseFilter(
              key: const ValueKey('transfer-to-filter'),
              value: _toWarehouseId,
              label: '目标仓',
              onChanged: (value) => setState(() => _toWarehouseId = value),
            ),
            SizedBox(
              width: 160,
              child: DropdownButtonFormField<String?>(
                key: const ValueKey('transfer-status-filter'),
                initialValue: _status,
                decoration: const InputDecoration(labelText: '状态'),
                items: const [
                  DropdownMenuItem(value: null, child: Text('全部状态')),
                  DropdownMenuItem(value: 'DRAFT', child: Text('待调出')),
                  DropdownMenuItem(value: 'OUTBOUND', child: Text('在途')),
                  DropdownMenuItem(
                    value: 'PARTIALLY_RECEIVED',
                    child: Text('部分收货'),
                  ),
                  DropdownMenuItem(value: 'RECEIVED', child: Text('已收货')),
                  DropdownMenuItem(value: 'REVERSED', child: Text('已冲销')),
                ],
                onChanged: (value) => setState(() => _status = value),
              ),
            ),
            SizedBox(
              width: 220,
              child: DropdownButtonFormField<String?>(
                key: const ValueKey('transfer-product-filter'),
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
                      child:
                          Text(product.name, overflow: TextOverflow.ellipsis),
                    ),
                  ),
                ],
                onChanged: (value) => setState(() => _productId = value),
              ),
            ),
            OutlinedButton.icon(
              key: const ValueKey('transfer-date-filter'),
              onPressed: _pickDateRange,
              icon: const Icon(Icons.date_range_outlined, size: 18),
              label: Text(
                _dateFrom == null
                    ? '业务日期'
                    : '${_dateLabel(_dateFrom)} 至 ${_dateLabel(_dateTo)}',
              ),
            ),
          ],
        ),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _warehouseFilter({
    required Key key,
    required String? value,
    required String label,
    required ValueChanged<String?> onChanged,
  }) {
    return SizedBox(
      width: 180,
      child: DropdownButtonFormField<String?>(
        key: key,
        initialValue: value,
        decoration: InputDecoration(labelText: label),
        isExpanded: true,
        items: [
          const DropdownMenuItem(value: null, child: Text('全部仓库')),
          if (value != null &&
              !_warehouses.any((warehouse) => warehouse.id == value))
            DropdownMenuItem(value: value, child: Text(value)),
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
        onChanged: onChanged,
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const LoadingState(title: '正在加载调拨单');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _page;
    if (page == null || page.transfers.isEmpty) {
      return EmptyState(
        title: '没有符合条件的调拨单',
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
              SizedBox(width: 430, child: _buildList(page, compact: false)),
              const VerticalDivider(width: 1),
              Expanded(child: _buildDetail(_selected)),
            ],
          );
        }
        return _buildList(page, compact: true);
      },
    );
  }

  Widget _buildList(TransferPage page, {required bool compact}) {
    return Column(
      children: [
        Expanded(
          child: ListView.separated(
            itemCount: page.transfers.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final transfer = page.transfers[index];
              return Card(
                color: !compact && transfer.id == _selected?.id
                    ? Theme.of(context).colorScheme.secondaryContainer
                    : null,
                child: ListTile(
                  key: ValueKey('transfer-card-${transfer.id}'),
                  title: Text(
                    transfer.transferNo.isEmpty
                        ? transfer.id
                        : transfer.transferNo,
                  ),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${transfer.fromWarehouseName} → '
                        '${transfer.toWarehouseName}',
                      ),
                      Text(
                        '计划 ${transfer.plannedQty} 瓶 · '
                        '在途 ${transfer.remainingInTransitQty} 瓶',
                      ),
                      if (transfer.hasDifference)
                        const InventoryStatusTag(
                          label: '存在差异',
                          tone: StatusTone.danger,
                        ),
                    ],
                  ),
                  trailing: InventoryStatusTag(
                    label: transfer.statusLabel,
                    tone: _transferTone(transfer),
                  ),
                  onTap: () {
                    if (compact) {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => Scaffold(
                            appBar: AppBar(title: const Text('调拨详情')),
                            body: Padding(
                              padding: const EdgeInsets.all(16),
                              child: _buildDetail(transfer),
                            ),
                          ),
                        ),
                      );
                    } else {
                      setState(() => _selected = transfer);
                      _loadDetail(transfer.id);
                    }
                  },
                ),
              );
            },
          ),
        ),
        InventoryPagination(
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
        ),
      ],
    );
  }

  Widget _buildDetail(TransferRecord? transfer) {
    if (transfer == null) {
      return const EmptyState(title: '选择一张调拨单查看详情');
    }
    final canOutbound = _canWrite && transfer.status == 'DRAFT';
    final canReceive = _canWrite &&
        (transfer.status == 'OUTBOUND' ||
            transfer.status == 'PARTIALLY_RECEIVED');
    return ListView(
      key: ValueKey('transfer-detail-${transfer.id}'),
      padding: const EdgeInsets.all(12),
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 12,
          runSpacing: 8,
          children: [
            Text(
              transfer.transferNo,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            InventoryStatusTag(
              label: transfer.statusLabel,
              tone: _transferTone(transfer),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _TransferProgress(transfer: transfer),
        const SizedBox(height: 12),
        const InventoryInlineNotice(
          message: '调出和收货均由后端库存事件更新余额；页面不会直接修改库存。',
          tone: StatusTone.info,
        ),
        const SizedBox(height: 12),
        Text('${transfer.fromWarehouseName} → ${transfer.toWarehouseName}'),
        Text('创建时间：${_displayTime(transfer.createdAt)}'),
        if ((transfer.notes ?? '').isNotEmpty) Text('备注：${transfer.notes}'),
        const Divider(height: 24),
        Text('商品明细', style: Theme.of(context).textTheme.titleMedium),
        ...transfer.lines.map(
          (line) => ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(line.productName),
            subtitle: Text(
              '${line.isSerialized ? '逐瓶' : '数量'} · '
              '计划 ${line.plannedQty} 瓶 · 调出 ${line.outboundQty} 瓶 · '
              '收货 ${line.receivedQty} 瓶 · 差异 ${line.differenceQty} 瓶',
            ),
            trailing: line.remainingInTransitQty > 0
                ? Text('在途 ${line.remainingInTransitQty} 瓶')
                : const Icon(Icons.check_circle_outline_rounded),
          ),
        ),
        if (transfer.receipts.isNotEmpty) ...[
          const Divider(height: 24),
          Text('收货记录', style: Theme.of(context).textTheme.titleMedium),
          ...transfer.receipts.map(
            (receipt) => ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(receipt.receiptNo),
              subtitle: Text(
                '${receipt.confirmedBy?.name ?? '—'} · '
                '${_displayTime(receipt.confirmedAt)}'
                '${receipt.notes == null ? '' : ' · ${receipt.notes}'}',
              ),
              trailing: Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  InventoryStatusTag(
                    label: receipt.isReversed ? '已冲销' : receipt.status,
                    tone: receipt.isReversed
                        ? StatusTone.danger
                        : StatusTone.success,
                  ),
                  if (_canWrite && !receipt.isReversed)
                    TextButton(
                      onPressed: _isBusy('receipt-${receipt.id}')
                          ? null
                          : () => _reverseReceipt(transfer, receipt),
                      child: const Text('冲销收货'),
                    ),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (canOutbound)
              FilledButton(
                key: const ValueKey('transfer-confirm-outbound'),
                onPressed: _isBusy('outbound-${transfer.id}')
                    ? null
                    : () => _outbound(transfer),
                child: const Text('确认调出'),
              ),
            if (canReceive)
              FilledButton(
                key: const ValueKey('transfer-receive'),
                onPressed: _isBusy('receive-${transfer.id}')
                    ? null
                    : () => _showReceiptDialog(transfer),
                child: const Text('确认收货'),
              ),
            if (_canWrite && transfer.outboundAt != null)
              OutlinedButton(
                key: const ValueKey('transfer-reverse-outbound'),
                onPressed: _isBusy('reverse-${transfer.id}')
                    ? null
                    : () => _reverseOutbound(transfer),
                child: const Text('冲销调出'),
              ),
          ],
        ),
      ],
    );
  }

  Future<void> _pickDateRange() async {
    final now = DateTime.now();
    final range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 1),
      initialDateRange: _dateFrom == null || _dateTo == null
          ? null
          : DateTimeRange(start: _dateFrom!, end: _dateTo!),
    );
    if (range != null) {
      setState(() {
        _dateFrom = range.start;
        _dateTo = range.end;
      });
    }
  }

  Future<void> _showCreateDialog() async {
    final createdId = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _CreateTransferDialog(
        api: widget.api,
        businessApi: widget.businessApi,
        warehouses: _warehouses,
        products: _products,
      ),
    );
    if (createdId != null) {
      _pageNumber = 1;
      await _load(selectId: createdId);
    }
  }

  Future<void> _outbound(TransferRecord transfer) async {
    final confirmed = await confirmInventoryAction(
      context,
      title: '确认调出',
      content: '确认将 ${transfer.plannedQty} 瓶从'
          ' ${transfer.fromWarehouseName} 调出？生效后将进入在途。',
      confirmLabel: '确认调出',
    );
    if (!confirmed) return;
    await _runAction('outbound-${transfer.id}', () async {
      await widget.api.confirmTransferOutbound(transferId: transfer.id);
    }, transfer.id);
  }

  Future<void> _showReceiptDialog(TransferRecord transfer) async {
    final lines = await showDialog<List<Map<String, dynamic>>>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _ReceiveTransferDialog(
        transfer: transfer,
        businessApi: widget.businessApi,
      ),
    );
    if (lines == null || !mounted) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: '确认收货',
      content: '收货将按实际数量和差异更新真实在途状态，是否继续？',
      confirmLabel: '确认收货',
    );
    if (!confirmed) return;
    await _runAction('receive-${transfer.id}', () async {
      await widget.api.receiveTransfer(
        transferId: transfer.id,
        lines: lines,
      );
    }, transfer.id);
  }

  Future<void> _reverseReceipt(
    TransferRecord transfer,
    TransferReceiptRecord receipt,
  ) async {
    final reason = await _reasonDialog('冲销收货原因');
    if (reason == null || !mounted) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: '二次确认冲销收货',
      content: '将冲销收货单 ${receipt.receiptNo}，原因：$reason',
      confirmLabel: '确认冲销',
      danger: true,
    );
    if (!confirmed) return;
    await _runAction('receipt-${receipt.id}', () async {
      await widget.api.reverseTransferReceipt(
        receiptId: receipt.id,
        reason: reason,
      );
    }, transfer.id);
  }

  Future<void> _reverseOutbound(TransferRecord transfer) async {
    final reason = await _reasonDialog('冲销调出原因');
    if (reason == null || !mounted) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: '二次确认冲销调出',
      content: '后端会校验是否仍可冲销。原因：$reason',
      confirmLabel: '确认冲销',
      danger: true,
    );
    if (!confirmed) return;
    await _runAction('reverse-${transfer.id}', () async {
      await widget.api.reverseTransferOutbound(
        transferId: transfer.id,
        reason: reason,
      );
    }, transfer.id);
  }

  Future<String?> _reasonDialog(String title) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          key: const ValueKey('transfer-reversal-reason'),
          controller: controller,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: '原因（必填）',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () {
              final value = controller.text.trim();
              if (value.isNotEmpty) Navigator.pop(context, value);
            },
            child: const Text('下一步'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  Future<void> _runAction(
    String key,
    Future<void> Function() action,
    String transferId,
  ) async {
    if (_busyActions.contains(key)) return;
    setState(() => _busyActions.add(key));
    try {
      await action();
      widget.onInventoryFactsChanged?.call();
      await _load(selectId: transferId);
    } catch (error) {
      _showSnack(inventoryErrorMessage(error));
      await _load(selectId: transferId);
    } finally {
      if (mounted) setState(() => _busyActions.remove(key));
    }
  }

  bool _isBusy(String key) => _busyActions.contains(key);

  void _showSnack(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}

class _TransferProgress extends StatelessWidget {
  const _TransferProgress({required this.transfer});

  final TransferRecord transfer;

  @override
  Widget build(BuildContext context) {
    final outbound = transfer.outboundAt != null;
    final received = transfer.status == 'RECEIVED';
    return Row(
      children: [
        _node(
          context,
          '调出',
          outbound,
          outbound
              ? '${transfer.outboundBy?.name ?? '—'}\n'
                  '${_displayTime(transfer.outboundAt)}\n'
                  '${transfer.outboundQty} 瓶'
              : '待处理',
        ),
        _connector(context, outbound),
        _node(
          context,
          '运输中',
          outbound && !received,
          '${transfer.remainingInTransitQty} 瓶在途',
        ),
        _connector(context, received),
        _node(
          context,
          '收货',
          received,
          '${transfer.receivedQty} 瓶'
              '${transfer.hasDifference ? '\n差异 ${transfer.differenceQty} 瓶' : ''}',
        ),
      ],
    );
  }

  Widget _node(
    BuildContext context,
    String title,
    bool active,
    String description,
  ) {
    return Expanded(
      child: Column(
        children: [
          Icon(
            active ? Icons.check_circle_rounded : Icons.circle_outlined,
            color: active ? Theme.of(context).colorScheme.primary : null,
          ),
          Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
          Text(description, textAlign: TextAlign.center),
        ],
      ),
    );
  }

  Widget _connector(BuildContext context, bool active) {
    return Expanded(
      child: Divider(
        color: active ? Theme.of(context).colorScheme.primary : null,
        thickness: 2,
      ),
    );
  }
}

class _CreateTransferDialog extends StatefulWidget {
  const _CreateTransferDialog({
    required this.api,
    required this.businessApi,
    required this.warehouses,
    required this.products,
  });

  final InventoryApi api;
  final BusinessApi businessApi;
  final List<WarehouseRecord> warehouses;
  final List<ProductOptionRecord> products;

  @override
  State<_CreateTransferDialog> createState() => _CreateTransferDialogState();
}

class _CreateTransferDialogState extends State<_CreateTransferDialog> {
  final _formKey = GlobalKey<FormState>();
  final _quantity = TextEditingController();
  final _notes = TextEditingController();
  String? _fromWarehouseId;
  String? _toWarehouseId;
  ProductOptionRecord? _product;
  List<SerializedUnitSelection> _units = const [];
  bool _submitting = false;

  @override
  void dispose() {
    _quantity.dispose();
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final serialized = _product?.usesSerializedInventory == true;
    return PopScope(
      canPop: !_submitting,
      child: AlertDialog(
        title: const Text('新建调拨'),
        content: SizedBox(
          width: 620,
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    key: const ValueKey('transfer-create-from'),
                    initialValue: _fromWarehouseId,
                    decoration: const InputDecoration(labelText: '来源仓'),
                    items: widget.warehouses
                        .map(
                          (warehouse) => DropdownMenuItem(
                            value: warehouse.id,
                            child:
                                Text('${warehouse.code} · ${warehouse.name}'),
                          ),
                        )
                        .toList(),
                    onChanged: _submitting
                        ? null
                        : (value) => setState(() {
                              _fromWarehouseId = value;
                              _units = const [];
                            }),
                    validator: (value) => value == null ? '请选择来源仓' : null,
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    key: const ValueKey('transfer-create-to'),
                    initialValue: _toWarehouseId,
                    decoration: const InputDecoration(labelText: '目标仓'),
                    items: widget.warehouses
                        .map(
                          (warehouse) => DropdownMenuItem(
                            value: warehouse.id,
                            child:
                                Text('${warehouse.code} · ${warehouse.name}'),
                          ),
                        )
                        .toList(),
                    onChanged: _submitting
                        ? null
                        : (value) => setState(() => _toWarehouseId = value),
                    validator: (value) {
                      if (value == null) return '请选择目标仓';
                      if (value == _fromWarehouseId) return '来源仓与目标仓不能相同';
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  ProductOptionPickerField(
                    options: widget.products,
                    loading: false,
                    loadError: null,
                    productId: _product?.id,
                    snapshotName: _product?.name,
                    snapshotUnit: _product?.unit,
                    enabled: !_submitting,
                    onChanged: (product) => setState(() {
                      _product = product;
                      _units = const [];
                      _quantity.clear();
                    }),
                  ),
                  const SizedBox(height: 12),
                  if (serialized)
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        OutlinedButton.icon(
                          key: const ValueKey('transfer-pick-serialized'),
                          onPressed: _fromWarehouseId == null || _submitting
                              ? null
                              : _pickSerialized,
                          icon: const Icon(Icons.qr_code_scanner_rounded),
                          label: Text('选择逐瓶库存（已选 ${_units.length} 瓶）'),
                        ),
                        const SizedBox(height: 8),
                        InventoryInlineNotice(
                          message: _fromWarehouseId == null
                              ? '请先选择来源仓；逐瓶列表只请求该仓库与当前商品。'
                              : '物流码始终按字符串保留；不会退化为汇总数量调拨。',
                          tone: StatusTone.info,
                        ),
                        if (_units.isNotEmpty)
                          Wrap(
                            spacing: 6,
                            children: _units
                                .map((unit) =>
                                    Chip(label: Text(unit.logisticsCode)))
                                .toList(),
                          ),
                      ],
                    )
                  else
                    TextFormField(
                      key: const ValueKey('transfer-create-quantity'),
                      controller: _quantity,
                      decoration: const InputDecoration(labelText: '数量（瓶）'),
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      validator: (value) =>
                          parseBottleQuantity(value ?? '') == null
                              ? '数量必须为正整数'
                              : null,
                    ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _notes,
                    decoration: const InputDecoration(labelText: '备注'),
                    maxLines: 2,
                  ),
                ],
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: _submitting ? null : () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            key: const ValueKey('transfer-create-submit'),
            onPressed: _submitting ? null : _submit,
            child: Text(_submitting ? '提交中…' : '创建调拨单'),
          ),
        ],
      ),
    );
  }

  Future<void> _pickSerialized() async {
    final product = _product;
    final warehouseId = _fromWarehouseId;
    if (product == null || warehouseId == null) return;
    final result = await showDialog<List<SerializedUnitSelection>>(
      context: context,
      builder: (context) => SerializedInventoryPickerDialog(
        businessApi: widget.businessApi,
        productId: product.id,
        warehouseId: warehouseId,
        initialUnits: _units,
      ),
    );
    if (result != null) setState(() => _units = result);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final product = _product;
    if (product == null) return;
    if (product.usesSerializedInventory && _units.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('逐瓶商品必须选择至少一瓶真实库存')),
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      final quantity = product.usesSerializedInventory
          ? _units.length
          : parseBottleQuantity(_quantity.text)!;
      final result = await widget.api.createTransfer(
        fromWarehouseId: _fromWarehouseId!,
        toWarehouseId: _toWarehouseId!,
        notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
        lines: [
          {
            'sourceLineKey': 'line-${DateTime.now().microsecondsSinceEpoch}',
            'productId': product.id,
            'plannedQty': quantity,
            if (product.usesSerializedInventory)
              'unitIds': _units.map((unit) => unit.id).toList(),
          },
        ],
      );
      if (mounted) Navigator.pop(context, result.transferId);
    } catch (error) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(inventoryErrorMessage(error))),
      );
    }
  }
}

class _ReceiveTransferDialog extends StatefulWidget {
  const _ReceiveTransferDialog({
    required this.transfer,
    required this.businessApi,
  });

  final TransferRecord transfer;
  final BusinessApi businessApi;

  @override
  State<_ReceiveTransferDialog> createState() => _ReceiveTransferDialogState();
}

class _ReceiveTransferDialogState extends State<_ReceiveTransferDialog> {
  late final List<_ReceiptLineDraft> _drafts;
  bool _loadingUnits = false;
  String? _unitError;
  Map<String, SerializedInventoryUnitRecord> _unitsById = const {};

  @override
  void initState() {
    super.initState();
    _drafts = widget.transfer.lines
        .where((line) => line.remainingInTransitQty > 0)
        .map(_ReceiptLineDraft.new)
        .toList();
    if (_drafts.any((draft) => draft.line.isSerialized)) {
      _loadSerializedUnits();
    }
  }

  @override
  void dispose() {
    for (final draft in _drafts) {
      draft.dispose();
    }
    super.dispose();
  }

  Future<void> _loadSerializedUnits() async {
    setState(() {
      _loadingUnits = true;
      _unitError = null;
    });
    try {
      final wanted =
          _drafts.expand((draft) => draft.line.serializedUnitIds).toSet();
      final found = <String, SerializedInventoryUnitRecord>{};
      var page = 1;
      while (wanted.difference(found.keys.toSet()).isNotEmpty && page <= 5) {
        final result = await widget.businessApi.listSerializedInventory(
          page: page,
          pageSize: 100,
          warehouseId: widget.transfer.fromWarehouseId,
          status: 'OUTBOUND',
          includeCost: false,
        );
        for (final unit in result.units) {
          if (wanted.contains(unit.id)) found[unit.id] = unit;
        }
        if (page >= result.totalPages) break;
        page++;
      }
      if (!mounted) return;
      setState(() {
        _unitsById = found;
        _loadingUnits = false;
        if (found.length < wanted.length) {
          _unitError = '部分在途逐瓶明细未由接口返回，无法安全收货，请刷新后重试。';
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingUnits = false;
        _unitError = inventoryErrorMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('调拨收货'),
      content: SizedBox(
        width: 720,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const InventoryInlineNotice(
                message: '填写实际收到、其中损坏/不可售和差异数量；差异必须填写备注。',
                tone: StatusTone.info,
              ),
              if (_loadingUnits)
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: LoadingState(title: '正在加载真实在途瓶码'),
                ),
              if (_unitError != null)
                InventoryInlineNotice(
                  message: _unitError!,
                  tone: StatusTone.danger,
                ),
              ..._drafts.map(_buildDraft),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          key: const ValueKey('transfer-receive-next'),
          onPressed: _loadingUnits || _unitError != null ? null : _submit,
          child: const Text('下一步'),
        ),
      ],
    );
  }

  Widget _buildDraft(_ReceiptLineDraft draft) {
    if (draft.line.isSerialized) {
      return Card(
        margin: const EdgeInsets.only(top: 12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '${draft.line.productName} · 在途 '
                '${draft.line.remainingInTransitQty} 瓶',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              ...draft.line.serializedUnitIds.map((id) {
                final unit = _unitsById[id];
                return DropdownButtonFormField<String>(
                  key: ValueKey('transfer-receive-unit-$id'),
                  initialValue: draft.unitActions[id] ?? 'RECEIVED',
                  decoration: InputDecoration(
                    labelText: unit?.logisticsCode ?? '瓶码详情未返回',
                    helperText: unit == null
                        ? id
                        : '${unit.moutaiName} · ${unit.factoryDate ?? '—'} · '
                            '${unit.productionBatch ?? '—'} · '
                            '${unit.batchSerialNo ?? '—'}',
                  ),
                  items: const [
                    DropdownMenuItem(value: 'RECEIVED', child: Text('正常收货')),
                    DropdownMenuItem(
                      value: 'UNAVAILABLE',
                      child: Text('收货并标记损坏/不可售'),
                    ),
                    DropdownMenuItem(
                      value: 'DIFFERENCE',
                      child: Text('差异关闭（未收到）'),
                    ),
                    DropdownMenuItem(value: 'NONE', child: Text('本次不处理')),
                  ],
                  onChanged: unit == null
                      ? null
                      : (value) => setState(
                            () => draft.unitActions[id] = value ?? 'NONE',
                          ),
                );
              }),
              TextField(
                controller: draft.notes,
                decoration: const InputDecoration(labelText: '差异备注'),
              ),
            ],
          ),
        ),
      );
    }
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${draft.line.productName} · 计划/在途 '
              '${draft.line.remainingInTransitQty} 瓶',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _numberField(draft.received, '实际收到'),
                _numberField(draft.unavailable, '其中不可售'),
                _numberField(draft.difference, '差异'),
              ],
            ),
            TextField(
              controller: draft.notes,
              decoration: const InputDecoration(labelText: '差异备注'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _numberField(TextEditingController controller, String label) {
    return SizedBox(
      width: 150,
      child: TextField(
        controller: controller,
        decoration: InputDecoration(labelText: '$label（瓶）'),
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      ),
    );
  }

  void _submit() {
    final payload = <Map<String, dynamic>>[];
    for (final draft in _drafts) {
      if (draft.line.isSerialized) {
        final receivedIds = draft.unitActions.entries
            .where(
              (entry) =>
                  entry.value == 'RECEIVED' || entry.value == 'UNAVAILABLE',
            )
            .map((entry) => entry.key)
            .toList();
        final unavailableIds = draft.unitActions.entries
            .where((entry) => entry.value == 'UNAVAILABLE')
            .map((entry) => entry.key)
            .toList();
        final differenceIds = draft.unitActions.entries
            .where((entry) => entry.value == 'DIFFERENCE')
            .map((entry) => entry.key)
            .toList();
        if (receivedIds.isEmpty && differenceIds.isEmpty) continue;
        if (differenceIds.isNotEmpty && draft.notes.text.trim().isEmpty) {
          _snack('逐瓶差异必须填写备注');
          return;
        }
        payload.add({
          'transferLineId': draft.line.id,
          'receivedQty': receivedIds.length,
          'unavailableQty': unavailableIds.length,
          'differenceQty': differenceIds.length,
          'unitIds': receivedIds,
          'unavailableUnitIds': unavailableIds,
          'differenceUnitIds': differenceIds,
          if (draft.notes.text.trim().isNotEmpty)
            'notes': draft.notes.text.trim(),
        });
        continue;
      }
      final received = parseNonNegativeInt(draft.received.text);
      final unavailable = parseNonNegativeInt(draft.unavailable.text);
      final difference = parseNonNegativeInt(draft.difference.text);
      if (received == null || unavailable == null || difference == null) {
        _snack('数量必须为非负整数');
        return;
      }
      if (unavailable > received) {
        _snack('不可售数量不能超过实际收到数量');
        return;
      }
      if (received + difference == 0) continue;
      if (received + difference > draft.line.remainingInTransitQty) {
        _snack('收货与差异合计不能超过在途数量');
        return;
      }
      if (difference > 0 && draft.notes.text.trim().isEmpty) {
        _snack('存在差异时必须填写备注');
        return;
      }
      payload.add({
        'transferLineId': draft.line.id,
        'receivedQty': received,
        'unavailableQty': unavailable,
        'differenceQty': difference,
        if (draft.notes.text.trim().isNotEmpty)
          'notes': draft.notes.text.trim(),
      });
    }
    if (payload.isEmpty) {
      _snack('至少处理一条在途明细');
      return;
    }
    Navigator.pop(context, payload);
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}

class _ReceiptLineDraft {
  _ReceiptLineDraft(this.line) {
    for (final id in line.serializedUnitIds) {
      unitActions[id] = 'RECEIVED';
    }
  }

  final TransferLine line;
  final received = TextEditingController(text: '0');
  final unavailable = TextEditingController(text: '0');
  final difference = TextEditingController(text: '0');
  final notes = TextEditingController();
  final Map<String, String> unitActions = {};

  void dispose() {
    received.dispose();
    unavailable.dispose();
    difference.dispose();
    notes.dispose();
  }
}

StatusTone _transferTone(TransferRecord transfer) {
  if (transfer.hasDifference) return StatusTone.danger;
  return switch (transfer.status) {
    'DRAFT' => StatusTone.warning,
    'OUTBOUND' || 'PARTIALLY_RECEIVED' => StatusTone.info,
    'RECEIVED' => StatusTone.success,
    'REVERSED' || 'CANCELLED' => StatusTone.danger,
    _ => StatusTone.neutral,
  };
}

String _dateLabel(DateTime? value) {
  if (value == null) return '—';
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  return '${value.year}-$month-$day';
}

String _displayTime(String? value) {
  if (value == null || value.isEmpty) return '—';
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
  final local = parsed.toLocal();
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return '${_dateLabel(local)} $hour:$minute';
}
