part of '../inventory_workspace_tabs.dart';

class StocktakeTab extends StatefulWidget {
  const StocktakeTab({
    super.key,
    required this.api,
    required this.businessApi,
    required this.role,
    required this.onOpenSerialized,
    this.createRequestRevision = 0,
    this.requestedSelection,
    this.filterRequestRevision = 0,
  });

  final InventoryApi api;
  final BusinessApi businessApi;
  final UserRole role;
  final VoidCallback onOpenSerialized;
  final int createRequestRevision;
  final InventorySelectionContext? requestedSelection;
  final int filterRequestRevision;

  @override
  State<StocktakeTab> createState() => _StocktakeTabState();
}

class _StocktakeTabState extends State<StocktakeTab> {
  StocktakePage? _page;
  bool _loading = true;
  String? _error;
  int _pageNumber = 1;
  int _requestRevision = 0;
  int _detailRevision = 0;

  List<WarehouseRecord> _warehouses = const [];
  List<ProductOptionRecord> _products = const [];
  bool _optionsLoading = true;
  String? _optionsError;
  int _handledCreateRequestRevision = 0;

  String? _warehouseId;
  String? _productId;
  String? _status;

  String? _selectedId;
  StocktakeRecord? _detail;
  bool _detailLoading = false;
  String? _detailError;
  String? _preparingSubmitId;
  String? _preferredSelectionId;

  bool get _canWrite => canStocktakeWrite(widget.role);

  @override
  void initState() {
    super.initState();
    _warehouseId = widget.requestedSelection?.warehouseId;
    _productId = widget.requestedSelection?.productId;
    _loadOptions();
    _load();
  }

  @override
  void didUpdateWidget(covariant StocktakeTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.createRequestRevision != widget.createRequestRevision) {
      _maybeOpenRequestedCreate();
    }
    if (oldWidget.filterRequestRevision != widget.filterRequestRevision) {
      _warehouseId = widget.requestedSelection?.warehouseId;
      _productId = widget.requestedSelection?.productId;
      _pageNumber = 1;
      _load();
    }
  }

  @override
  void dispose() {
    _requestRevision++;
    _detailRevision++;
    super.dispose();
  }

  Future<void> _loadOptions() async {
    List<WarehouseRecord> warehouses = _warehouses;
    List<ProductOptionRecord> products = _products;
    final errors = <String>[];
    try {
      warehouses = await widget.api.listWarehouses(isActive: true);
    } catch (error) {
      errors.add('仓库：${inventoryErrorMessage(error)}');
    }
    try {
      products = (await widget.businessApi.listProductOptions())
          .where((product) => product.inventoryTrackingMode != 'none')
          .toList();
    } catch (error) {
      errors.add('商品：${inventoryErrorMessage(error)}');
    }
    if (!mounted) return;
    setState(() {
      _warehouses = warehouses;
      _products = products;
      _optionsLoading = false;
      _optionsError = errors.isEmpty ? null : errors.join('；');
    });
    _maybeOpenRequestedCreate();
  }

  void _maybeOpenRequestedCreate() {
    if (!_canWrite ||
        _optionsLoading ||
        widget.createRequestRevision <= _handledCreateRequestRevision) {
      return;
    }
    _handledCreateRequestRevision = widget.createRequestRevision;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _showCreateDialog();
    });
  }

  Future<void> _load() async {
    final revision = ++_requestRevision;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.listStocktakes(
        page: _pageNumber,
        pageSize: 20,
        warehouseId: _warehouseId,
        productId: _productId,
        status: _status,
      );
      if (!mounted || revision != _requestRevision) return;
      final preferred = _preferredSelectionId;
      _preferredSelectionId = null;
      StocktakeRecord? nextSelected;
      if (preferred != null) {
        for (final record in result.stocktakes) {
          if (record.id == preferred) nextSelected = record;
        }
      }
      if (nextSelected == null && _selectedId != null) {
        for (final record in result.stocktakes) {
          if (record.id == _selectedId) nextSelected = record;
        }
      }
      nextSelected ??=
          result.stocktakes.isEmpty ? null : result.stocktakes.first;
      setState(() {
        _page = result;
        _loading = false;
        _selectedId = nextSelected?.id;
        if (_detail?.id != nextSelected?.id) {
          _detail = nextSelected;
          _detailError = null;
        }
      });
      if (nextSelected != null) {
        _loadDetail(nextSelected);
      }
    } catch (error) {
      if (!mounted || revision != _requestRevision) return;
      setState(() {
        _error = inventoryErrorMessage(error);
        _loading = false;
      });
    }
  }

  Future<void> _loadDetail(StocktakeRecord record) async {
    final requestedId = record.id;
    final revision = ++_detailRevision;
    setState(() {
      _selectedId = requestedId;
      _detail = record;
      _detailLoading = true;
      _detailError = null;
    });
    try {
      final detail = await widget.api.getStocktake(requestedId);
      if (!mounted ||
          revision != _detailRevision ||
          _selectedId != requestedId) {
        return;
      }
      setState(() {
        _detail = detail;
        _detailLoading = false;
      });
    } catch (error) {
      if (!mounted ||
          revision != _detailRevision ||
          _selectedId != requestedId) {
        return;
      }
      setState(() {
        _detailError = inventoryErrorMessage(error);
        _detailLoading = false;
      });
    }
  }

  void _resetFilters() {
    setState(() {
      _warehouseId = null;
      _productId = null;
      _status = null;
      _pageNumber = 1;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.requestedSelection != null) ...[
          InventoryInlineNotice(
            key: const ValueKey('warehouse-stocktake-selection-filter'),
            message: '已带入来源库存项：仓库 '
                '${widget.requestedSelection!.warehouseId} · 商品 '
                '${widget.requestedSelection!.productId}',
            tone: StatusTone.info,
          ),
          const SizedBox(height: 8),
        ],
        if (_optionsError != null) ...[
          InventoryInlineNotice(
            message: '筛选选项部分加载失败：$_optionsError',
            tone: StatusTone.warning,
          ),
          const SizedBox(height: 8),
        ],
        _buildFilters(),
        Expanded(child: _buildContent()),
      ],
    );
  }

  Widget _buildFilters() {
    return InventoryFilterBar(
      actions: [
        FilledButton.icon(
          key: const ValueKey('warehouse-stocktake-filter-apply'),
          onPressed: () {
            _pageNumber = 1;
            _load();
          },
          icon: const Icon(Icons.search_rounded, size: 18),
          label: const Text('查询'),
        ),
        OutlinedButton(
          key: const ValueKey('warehouse-stocktake-filter-reset'),
          onPressed: _resetFilters,
          child: const Text('重置'),
        ),
        IconButton(
          tooltip: '刷新',
          onPressed: _load,
          icon: const Icon(Icons.refresh_rounded),
        ),
        if (_canWrite)
          FilledButton.icon(
            key: const ValueKey('warehouse-stocktake-create-button'),
            onPressed: _optionsLoading ? null : _showCreateDialog,
            icon: const Icon(Icons.add_rounded, size: 18),
            label: const Text('新建盘点'),
          ),
      ],
      children: [
        SizedBox(
          width: 210,
          child: DropdownButtonFormField<String?>(
            key: const ValueKey('warehouse-stocktake-filter-warehouse'),
            initialValue: _warehouseId,
            decoration: const InputDecoration(labelText: '仓库'),
            items: [
              const DropdownMenuItem(value: null, child: Text('全部仓库')),
              for (final warehouse in _warehouses)
                DropdownMenuItem(
                  value: warehouse.id,
                  child: Text('${warehouse.code} · ${warehouse.name}'),
                ),
            ],
            onChanged: _optionsLoading
                ? null
                : (value) => setState(() => _warehouseId = value),
          ),
        ),
        SizedBox(
          width: 260,
          child: ProductOptionPickerField(
            key: ValueKey('warehouse-stocktake-filter-product-$_productId'),
            options: _products,
            loading: _optionsLoading,
            loadError: _optionsError,
            productId: _productId,
            snapshotName: null,
            snapshotUnit: null,
            label: '单个商品',
            onChanged: (product) => setState(() => _productId = product.id),
            onRetry: _loadOptions,
          ),
        ),
        SizedBox(
          width: 170,
          child: DropdownButtonFormField<String?>(
            key: const ValueKey('warehouse-stocktake-filter-status'),
            initialValue: _status,
            decoration: const InputDecoration(labelText: '状态'),
            items: const [
              DropdownMenuItem(value: null, child: Text('全部状态')),
              DropdownMenuItem(value: 'DRAFT', child: Text('草稿')),
              DropdownMenuItem(value: 'SUBMITTED', child: Text('待审批')),
              DropdownMenuItem(value: 'APPROVED', child: Text('已批准')),
              DropdownMenuItem(value: 'REJECTED', child: Text('已驳回')),
              DropdownMenuItem(value: 'POSTED', child: Text('已生效')),
              DropdownMenuItem(value: 'REVERSED', child: Text('已冲销')),
            ],
            onChanged: (value) => setState(() => _status = value),
          ),
        ),
      ],
    );
  }

  Widget _buildContent() {
    if (_loading) return const LoadingState(title: '正在加载盘点记录');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _page;
    if (page == null || page.stocktakes.isEmpty) {
      return EmptyState(
        title: _warehouseId != null || _productId != null || _status != null
            ? '当前筛选没有盘点记录'
            : '暂无盘点记录',
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= AppBreakpoints.desktop) {
          return _buildWide(page);
        }
        return _buildCompact(page);
      },
    );
  }

  Widget _buildWide(StocktakePage page) {
    final selected = _detail ??
        page.stocktakes.firstWhere(
          (record) => record.id == _selectedId,
          orElse: () => page.stocktakes.first,
        );
    return Row(
      key: const ValueKey('warehouse-stocktake-wide-layout'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          flex: 5,
          child: Column(
            children: [
              Expanded(
                child: ListView.separated(
                  itemCount: page.stocktakes.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final record = page.stocktakes[index];
                    return _StocktakeRecordCard(
                      record: record,
                      selected: record.id == _selectedId,
                      onTap: () => _loadDetail(record),
                    );
                  },
                ),
              ),
              _buildPagination(page),
            ],
          ),
        ),
        const VerticalDivider(width: 24),
        Expanded(
          flex: 6,
          child: _StocktakeDetailView(
            record: selected,
            loading: _detailLoading,
            error: _detailError,
            onRetry: () => _loadDetail(selected),
            actions: [
              if (_canWrite && selected.status == 'DRAFT')
                _submitButton(selected),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildCompact(StocktakePage page) {
    return Column(
      key: const ValueKey('warehouse-stocktake-mobile-layout'),
      children: [
        Expanded(
          child: ListView.separated(
            itemCount: page.stocktakes.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final record = page.stocktakes[index];
              return _StocktakeRecordCard(
                record: record,
                selected: record.id == _selectedId,
                onTap: () => _openMobileDetail(record),
                trailing: _buildSubmitButton(record),
              );
            },
          ),
        ),
        _buildPagination(page),
      ],
    );
  }

  Widget? _buildSubmitButton(StocktakeRecord record) {
    if (!_canWrite || record.status != 'DRAFT') return null;
    return _submitButton(record);
  }

  Widget _submitButton(StocktakeRecord record) {
    final preparing = _preparingSubmitId == record.id;
    return OutlinedButton.icon(
      key: ValueKey('warehouse-stocktake-submit-${record.id}'),
      onPressed: preparing ? null : () => _showSubmitDialog(record),
      icon: preparing
          ? const SizedBox.square(
              dimension: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.send_rounded, size: 17),
      label: Text(preparing ? '读取库存...' : '填写并提交'),
    );
  }

  Widget _buildPagination(StocktakePage page) {
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

  Future<void> _openMobileDetail(StocktakeRecord record) async {
    await _loadDetail(record);
    if (!mounted || _selectedId != record.id) return;
    final detail = _detail ?? record;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(sheetContext).height * .82,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: _StocktakeDetailView(
              record: detail,
              error: _detailError,
              onRetry: () => _loadDetail(detail),
              actions: [
                if (_canWrite && detail.status == 'DRAFT')
                  OutlinedButton.icon(
                    onPressed: () {
                      Navigator.pop(sheetContext);
                      _showSubmitDialog(detail);
                    },
                    icon: const Icon(Icons.send_rounded),
                    label: const Text('填写并提交'),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _showCreateDialog() async {
    final result = await showDialog<StocktakeCommandResult>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _CreateStocktakeDialog(
        api: widget.api,
        warehouses: _warehouses,
        products: _products,
        initialWarehouseId:
            widget.requestedSelection?.warehouseId ?? _warehouseId,
        initialProductId: widget.requestedSelection?.productId ?? _productId,
        onOpenSerialized: widget.onOpenSerialized,
      ),
    );
    if (result == null || !mounted) return;
    _preferredSelectionId = result.stocktake.id;
    _warehouseId = result.stocktake.warehouseId;
    _productId = result.stocktake.productId;
    _status = null;
    _pageNumber = 1;
    await _load();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('盘点草稿已创建，审批前不会改变库存。')),
      );
    }
  }

  Future<void> _showSubmitDialog(StocktakeRecord record) async {
    if (record.isSerialized) {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          key: const ValueKey('warehouse-stocktake-serialized-blocked'),
          title: const Text('请使用逐瓶盘点'),
          content: const SizedBox(
            width: 520,
            child: InventoryUnavailableCard(
              title: '汇总数量提交已禁用',
              message: 'SERIALIZED 商品必须扫描真实物流码并逐瓶确认可售/不可售状态。'
                  '当前仓库管理工作台尚未接入完整扫描器，不能退化为汇总数量盘点。',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('关闭'),
            ),
            FilledButton.icon(
              onPressed: () {
                Navigator.pop(dialogContext);
                widget.onOpenSerialized();
              },
              icon: const Icon(Icons.qr_code_scanner_rounded),
              label: const Text('打开逐瓶库存'),
            ),
          ],
        ),
      );
      return;
    }

    setState(() => _preparingSubmitId = record.id);
    _StocktakeCountPreview? preview;
    try {
      final detail = await widget.api.getStock(
        warehouseId: record.warehouseId,
        productId: record.productId,
      );
      preview = _StocktakeCountPreview(
        onHandQty: detail.stock.onHandQty,
        unavailableQty: detail.stock.unavailableQty,
        readAt: DateTime.now(),
        hasStockRow: true,
      );
    } on ApiException catch (error) {
      if (error.code == 'INVENTORY_STOCK_NOT_FOUND') {
        preview = _StocktakeCountPreview(
          onHandQty: 0,
          unavailableQty: 0,
          readAt: DateTime.now(),
          hasStockRow: false,
        );
      } else {
        if (mounted) _showSnack(inventoryErrorMessage(error));
      }
    } catch (error) {
      if (mounted) _showSnack(inventoryErrorMessage(error));
    } finally {
      if (mounted) setState(() => _preparingSubmitId = null);
    }
    if (!mounted || preview == null) return;
    final result = await showDialog<StocktakeCommandResult>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _SubmitStocktakeDialog(
        api: widget.api,
        record: record,
        preview: preview!,
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      _preferredSelectionId = result.stocktake.id;
      _detail = result.stocktake;
    });
    await _load();
    if (mounted) {
      _showSnack('盘点已提交待审批；本次提交没有改变库存。');
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }
}

class _StocktakeCountPreview {
  const _StocktakeCountPreview({
    required this.onHandQty,
    required this.unavailableQty,
    required this.readAt,
    required this.hasStockRow,
  });

  final int onHandQty;
  final int unavailableQty;
  final DateTime readAt;
  final bool hasStockRow;
}

class _CreateStocktakeDialog extends StatefulWidget {
  const _CreateStocktakeDialog({
    required this.api,
    required this.warehouses,
    required this.products,
    required this.initialWarehouseId,
    required this.initialProductId,
    required this.onOpenSerialized,
  });

  final InventoryApi api;
  final List<WarehouseRecord> warehouses;
  final List<ProductOptionRecord> products;
  final String? initialWarehouseId;
  final String? initialProductId;
  final VoidCallback onOpenSerialized;

  @override
  State<_CreateStocktakeDialog> createState() => _CreateStocktakeDialogState();
}

class _CreateStocktakeDialogState extends State<_CreateStocktakeDialog> {
  final _formKey = GlobalKey<FormState>();
  String? _warehouseId;
  ProductOptionRecord? _product;
  _StocktakeCountPreview? _preview;
  bool _previewLoading = false;
  String? _previewError;
  bool _saving = false;
  String? _error;
  bool _dirty = false;
  bool _allowPop = false;
  int _previewRevision = 0;

  @override
  void initState() {
    super.initState();
    _warehouseId = widget.initialWarehouseId;
    for (final product in widget.products) {
      if (product.id == widget.initialProductId) _product = product;
    }
    if (_warehouseId != null && _product != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadPreview());
    }
  }

  Future<void> _loadPreview() async {
    final warehouseId = _warehouseId;
    final product = _product;
    if (warehouseId == null || product == null) {
      setState(() {
        _preview = null;
        _previewError = null;
      });
      return;
    }
    final revision = ++_previewRevision;
    setState(() {
      _previewLoading = true;
      _previewError = null;
      _preview = null;
    });
    try {
      final detail = await widget.api.getStock(
        warehouseId: warehouseId,
        productId: product.id,
      );
      if (!mounted || revision != _previewRevision) return;
      setState(() {
        _preview = _StocktakeCountPreview(
          onHandQty: detail.stock.onHandQty,
          unavailableQty: detail.stock.unavailableQty,
          readAt: DateTime.now(),
          hasStockRow: true,
        );
        _previewLoading = false;
      });
    } on ApiException catch (error) {
      if (!mounted || revision != _previewRevision) return;
      if (error.code == 'INVENTORY_STOCK_NOT_FOUND') {
        setState(() {
          _preview = _StocktakeCountPreview(
            onHandQty: 0,
            unavailableQty: 0,
            readAt: DateTime.now(),
            hasStockRow: false,
          );
          _previewLoading = false;
        });
      } else {
        setState(() {
          _previewError = inventoryErrorMessage(error);
          _previewLoading = false;
        });
      }
    } catch (error) {
      if (!mounted || revision != _previewRevision) return;
      setState(() {
        _previewError = inventoryErrorMessage(error);
        _previewLoading = false;
      });
    }
  }

  Future<void> _requestClose() async {
    if (_saving) return;
    if (!_dirty) {
      setState(() => _allowPop = true);
      Navigator.pop(context);
      return;
    }
    final discard = await confirmInventoryAction(
      context,
      title: '放弃未保存的盘点草稿？',
      content: '仓库和商品选择尚未创建为服务端盘点单。',
      confirmLabel: '放弃',
      danger: true,
    );
    if (!discard || !mounted) return;
    setState(() => _allowPop = true);
    Navigator.pop(context);
  }

  Future<void> _create() async {
    if (_saving || !_formKey.currentState!.validate()) return;
    final product = _product!;
    if (product.usesSerializedInventory) return;
    if (_preview == null || _previewLoading) {
      setState(() => _previewError = '请先成功读取当前真实库存。');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await widget.api.createStocktake(
        warehouseId: _warehouseId!,
        productId: product.id,
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
    final preview = _preview;
    final serialized = _product?.usesSerializedInventory == true;
    return PopScope<StocktakeCommandResult>(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _requestClose();
      },
      child: AlertDialog(
        key: const ValueKey('warehouse-stocktake-create-dialog'),
        title: const Text('新建商品盘点'),
        content: SizedBox(
          width: 650,
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const InventoryInlineNotice(
                    message: '一个盘点单只对应一个仓库和一个商品。创建草稿与提交盘点'
                        '都不会立即改变库存，只有审批通过才会过账。',
                    tone: StatusTone.info,
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    key: const ValueKey('warehouse-stocktake-create-warehouse'),
                    initialValue: _warehouseId,
                    decoration: const InputDecoration(labelText: '仓库'),
                    items: [
                      for (final warehouse in widget.warehouses)
                        DropdownMenuItem(
                          value: warehouse.id,
                          child: Text(
                            '${warehouse.code} · ${warehouse.name}',
                          ),
                        ),
                    ],
                    onChanged: _saving
                        ? null
                        : (value) {
                            setState(() {
                              _warehouseId = value;
                              _dirty = true;
                            });
                            _loadPreview();
                          },
                    validator: (value) => value == null ? '请选择仓库' : null,
                  ),
                  const SizedBox(height: 12),
                  ProductOptionPickerField(
                    key: ValueKey(
                      'warehouse-stocktake-create-product-${_product?.id}',
                    ),
                    options: widget.products,
                    loading: false,
                    loadError: null,
                    productId: _product?.id,
                    snapshotName: null,
                    snapshotUnit: null,
                    enabled: !_saving,
                    label: '单个商品',
                    onChanged: (product) {
                      setState(() {
                        _product = product;
                        _dirty = true;
                      });
                      _loadPreview();
                    },
                  ),
                  const SizedBox(height: 12),
                  if (_previewLoading)
                    const LoadingState(title: '正在读取当前真实库存')
                  else if (_previewError != null)
                    ErrorState(
                      title: _previewError!,
                      onRetry: _loadPreview,
                    )
                  else if (preview != null)
                    FormSection(
                      title: '当前库存预览',
                      children: [
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            BottleQuantitySummary(
                              label: '账面现存',
                              quantity: preview.onHandQty,
                            ),
                            BottleQuantitySummary(
                              label: '不可售',
                              quantity: preview.unavailableQty,
                              tone: preview.unavailableQty > 0
                                  ? StatusTone.warning
                                  : StatusTone.neutral,
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '读取时间：${_formatStocktakeDateTime(preview.readAt.toIso8601String())}',
                        ),
                        const SizedBox(height: 4),
                        Text(
                          preview.hasStockRow
                              ? '以上来自当前真实库存详情；提交时服务端会重新冻结正式快照。'
                              : '当前没有该仓商品库存记录；服务端提交时会以 0 瓶生成正式快照。',
                        ),
                      ],
                    ),
                  if (serialized) ...[
                    const SizedBox(height: 12),
                    const InventoryUnavailableCard(
                      keyPrefix: 'warehouse-stocktake-serialized',
                      title: '逐瓶盘点入口',
                      message: '该商品的 inventoryTrackingMode=SERIALIZED。'
                          '必须逐瓶扫描，不能在此创建后填写汇总数量。',
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(
                        key: const ValueKey(
                          'warehouse-stocktake-open-serialized',
                        ),
                        onPressed: () {
                          setState(() => _allowPop = true);
                          Navigator.pop(context);
                          widget.onOpenSerialized();
                        },
                        icon: const Icon(Icons.qr_code_scanner_rounded),
                        label: const Text('打开逐瓶库存'),
                      ),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    InventoryInlineNotice(
                      message: _error!,
                      tone: StatusTone.danger,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _requestClose,
            child: const Text('取消'),
          ),
          FilledButton(
            key: const ValueKey('warehouse-stocktake-create-confirm'),
            onPressed: _saving || serialized ? null : _create,
            child: _saving
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('创建草稿'),
          ),
        ],
      ),
    );
  }
}

class _SubmitStocktakeDialog extends StatefulWidget {
  const _SubmitStocktakeDialog({
    required this.api,
    required this.record,
    required this.preview,
  });

  final InventoryApi api;
  final StocktakeRecord record;
  final _StocktakeCountPreview preview;

  @override
  State<_SubmitStocktakeDialog> createState() => _SubmitStocktakeDialogState();
}

class _SubmitStocktakeDialogState extends State<_SubmitStocktakeDialog> {
  final _formKey = GlobalKey<FormState>();
  final _onHand = TextEditingController();
  final _unavailable = TextEditingController();
  final _reason = TextEditingController();
  bool _saving = false;
  bool _dirty = false;
  bool _allowPop = false;
  String? _error;

  @override
  void dispose() {
    _onHand.dispose();
    _unavailable.dispose();
    _reason.dispose();
    super.dispose();
  }

  int? get _onHandValue => parseNonNegativeInt(_onHand.text);
  int? get _unavailableValue => parseNonNegativeInt(_unavailable.text);

  Future<void> _requestClose() async {
    if (_saving) return;
    if (!_dirty) {
      setState(() => _allowPop = true);
      Navigator.pop(context);
      return;
    }
    final discard = await confirmInventoryAction(
      context,
      title: '放弃未提交的实盘数据？',
      content: '已填写的实盘数量和原因将丢失。',
      confirmLabel: '放弃',
      danger: true,
    );
    if (!discard || !mounted) return;
    setState(() => _allowPop = true);
    Navigator.pop(context);
  }

  Future<void> _submit() async {
    if (_saving || !_formKey.currentState!.validate()) return;
    final onHand = _onHandValue!;
    final unavailable = _unavailableValue!;
    if (unavailable > onHand) {
      setState(() => _error = '实盘不可售不能超过实盘现存。');
      return;
    }
    final confirmed = await confirmInventoryAction(
      context,
      title: '提交盘点等待审批？',
      content: '提交不会立即改变库存。服务端将冻结提交时的账面快照，'
          '只有审批通过后差异才会过账；期间发生出入库会导致快照过期。',
      confirmLabel: '确认提交',
    );
    if (!confirmed || !mounted) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await widget.api.submitStocktake(
        id: widget.record.id,
        reason: _reason.text.trim(),
        countedOnHandQty: onHand,
        countedUnavailableQty: unavailable,
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
    final onHandDiff =
        _onHandValue == null ? null : _onHandValue! - widget.preview.onHandQty;
    final unavailableDiff = _unavailableValue == null
        ? null
        : _unavailableValue! - widget.preview.unavailableQty;
    return PopScope<StocktakeCommandResult>(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _requestClose();
      },
      child: AlertDialog(
        key: const ValueKey('warehouse-stocktake-submit-dialog'),
        title: const Text('填写并提交商品盘点'),
        content: SizedBox(
          width: 620,
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '${widget.record.warehouseName} · '
                    '${widget.record.productName}',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 10),
                  InventoryInlineNotice(
                    message: '当前读取：账面现存 ${widget.preview.onHandQty} 瓶，'
                        '不可售 ${widget.preview.unavailableQty} 瓶，'
                        '${_formatStocktakeDateTime(widget.preview.readAt.toIso8601String())}。'
                        '正式快照以服务端提交响应为准。',
                    tone: StatusTone.info,
                  ),
                  const SizedBox(height: 12),
                  ResponsiveFormGrid(
                    children: [
                      TextFormField(
                        key: const ValueKey(
                          'warehouse-stocktake-submit-qty',
                        ),
                        controller: _onHand,
                        enabled: !_saving,
                        decoration: const InputDecoration(
                          labelText: '实盘现存（瓶）',
                          helperText: '允许 0，不允许负数或小数',
                        ),
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly
                        ],
                        onChanged: (_) => setState(() => _dirty = true),
                        validator: (value) =>
                            parseNonNegativeInt(value ?? '') == null
                                ? '请输入非负整数'
                                : null,
                      ),
                      TextFormField(
                        key: const ValueKey(
                          'warehouse-stocktake-submit-unavailable',
                        ),
                        controller: _unavailable,
                        enabled: !_saving,
                        decoration: const InputDecoration(
                          labelText: '实盘不可售（瓶）',
                          helperText: '允许 0，且不能超过实盘现存',
                        ),
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly
                        ],
                        onChanged: (_) => setState(() => _dirty = true),
                        validator: (value) =>
                            parseNonNegativeInt(value ?? '') == null
                                ? '请输入非负整数'
                                : null,
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  FormSection(
                    title: '差异预览',
                    children: [
                      _StocktakeDetailRow(
                        label: '现存差异',
                        value: _signedBottleQuantity(onHandDiff),
                      ),
                      _StocktakeDetailRow(
                        label: '不可售差异',
                        value: _signedBottleQuantity(unavailableDiff),
                      ),
                      const Text('预览只用于核对，最终差异以服务端返回的冻结快照计算为准。'),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    key: const ValueKey(
                      'warehouse-stocktake-submit-reason',
                    ),
                    controller: _reason,
                    enabled: !_saving,
                    decoration: const InputDecoration(
                      labelText: '盘点/差异原因（必填）',
                    ),
                    maxLines: 3,
                    maxLength: 500,
                    onChanged: (_) => setState(() => _dirty = true),
                    validator: (value) =>
                        (value ?? '').trim().isEmpty ? '请填写盘点或差异原因' : null,
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    InventoryInlineNotice(
                      message: _error!,
                      tone: StatusTone.danger,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _requestClose,
            child: const Text('取消'),
          ),
          FilledButton.icon(
            key: const ValueKey('warehouse-stocktake-submit-confirm'),
            onPressed: _saving ? null : _submit,
            icon: _saving
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.send_rounded, size: 18),
            label: Text(_saving ? '提交中...' : '提交待审批'),
          ),
        ],
      ),
    );
  }
}
