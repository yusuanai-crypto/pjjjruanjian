part of '../inventory_workspace_tabs.dart';

class StocktakeApprovalTab extends StatefulWidget {
  const StocktakeApprovalTab({
    super.key,
    required this.api,
    required this.businessApi,
    required this.role,
    required this.onInventoryFactsChanged,
  });

  final InventoryApi api;
  final BusinessApi businessApi;
  final UserRole role;
  final VoidCallback onInventoryFactsChanged;

  @override
  State<StocktakeApprovalTab> createState() => _StocktakeApprovalTabState();
}

class _StocktakeApprovalTabState extends State<StocktakeApprovalTab> {
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

  String? _warehouseId;
  String? _productId;
  String? _status = 'SUBMITTED';

  String? _selectedId;
  StocktakeRecord? _detail;
  bool _detailLoading = false;
  String? _detailError;
  String? _actionBusyId;
  String? _actionNotice;
  String? _preferredSelectionId;

  bool get _canApprove => canStocktakeApprove(widget.role);
  bool get _canReverse => canStocktakeReverse(widget.role);

  @override
  void initState() {
    super.initState();
    if (_canApprove) {
      _loadOptions();
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
      if (nextSelected != null) _loadDetail(nextSelected);
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

  @override
  Widget build(BuildContext context) {
    if (!_canApprove) {
      return const InventoryUnavailableCard(
        keyPrefix: 'warehouse-stocktake-approval-denied',
        title: '无盘点审批权限',
        message: '仅 boss、admin 和 super_admin 可进入盘点审批。'
            'warehouse 与 finance 不会构建审批写操作。',
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_optionsError != null) ...[
          InventoryInlineNotice(
            message: '筛选选项部分加载失败：$_optionsError',
            tone: StatusTone.warning,
          ),
          const SizedBox(height: 8),
        ],
        _buildFilters(),
        const InventoryInlineNotice(
          key: ValueKey('warehouse-approval-filter-blocked'),
          message: '提交人和日期的服务端筛选参数尚未提供；控件保持不可用，'
              '不会把当前分页结果冒充全量筛选。',
          tone: StatusTone.warning,
        ),
        const SizedBox(height: 8),
        Expanded(child: _buildContent()),
      ],
    );
  }

  Widget _buildFilters() {
    return InventoryFilterBar(
      actions: [
        FilledButton.icon(
          key: const ValueKey('warehouse-approval-filter-apply'),
          onPressed: () {
            _pageNumber = 1;
            _actionNotice = null;
            _load();
          },
          icon: const Icon(Icons.search_rounded, size: 18),
          label: const Text('查询'),
        ),
        OutlinedButton(
          key: const ValueKey('warehouse-approval-filter-reset'),
          onPressed: () {
            setState(() {
              _warehouseId = null;
              _productId = null;
              _status = 'SUBMITTED';
              _pageNumber = 1;
              _actionNotice = null;
            });
            _load();
          },
          child: const Text('重置'),
        ),
        IconButton(
          tooltip: '刷新',
          onPressed: _load,
          icon: const Icon(Icons.refresh_rounded),
        ),
      ],
      children: [
        SizedBox(
          width: 205,
          child: DropdownButtonFormField<String?>(
            key: const ValueKey('warehouse-approval-filter-warehouse'),
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
          width: 245,
          child: ProductOptionPickerField(
            key: ValueKey('warehouse-approval-filter-product-$_productId'),
            options: _products,
            loading: _optionsLoading,
            loadError: _optionsError,
            productId: _productId,
            snapshotName: null,
            snapshotUnit: null,
            label: '商品',
            onChanged: (product) => setState(() => _productId = product.id),
            onRetry: _loadOptions,
          ),
        ),
        SizedBox(
          width: 160,
          child: DropdownButtonFormField<String?>(
            key: const ValueKey('warehouse-approval-filter-status'),
            initialValue: _status,
            decoration: const InputDecoration(labelText: '状态'),
            items: const [
              DropdownMenuItem(value: 'SUBMITTED', child: Text('待审批优先')),
              DropdownMenuItem(value: 'POSTED', child: Text('已生效')),
              DropdownMenuItem(value: 'REJECTED', child: Text('已驳回')),
              DropdownMenuItem(value: 'REVERSED', child: Text('已冲销')),
              DropdownMenuItem(value: 'APPROVED', child: Text('已批准')),
              DropdownMenuItem(value: null, child: Text('全部状态')),
            ],
            onChanged: (value) => setState(() => _status = value),
          ),
        ),
        const SizedBox(
          width: 185,
          child: TextField(
            enabled: false,
            decoration: InputDecoration(labelText: '提交人（等待接口）'),
          ),
        ),
        const SizedBox(
          width: 190,
          child: TextField(
            enabled: false,
            decoration: InputDecoration(labelText: '日期范围（等待接口）'),
          ),
        ),
      ],
    );
  }

  Widget _buildContent() {
    if (_loading) return const LoadingState(title: '正在加载盘点审批记录');
    if (_error != null) return ErrorState(title: _error!, onRetry: _load);
    final page = _page;
    if (page == null || page.stocktakes.isEmpty) {
      return EmptyState(
        title: _status == 'SUBMITTED' ? '暂无待审批盘点' : '当前筛选没有审批记录',
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
      key: const ValueKey('warehouse-approval-wide-layout'),
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
                    return KeyedSubtree(
                      key: ValueKey('warehouse-approval-tile-${record.id}'),
                      child: _StocktakeRecordCard(
                        record: record,
                        selected: record.id == _selectedId,
                        onTap: () => _loadDetail(record),
                      ),
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
            notice: _actionNotice,
            actions: _buildDetailActions(selected),
          ),
        ),
      ],
    );
  }

  Widget _buildCompact(StocktakePage page) {
    return Column(
      key: const ValueKey('warehouse-approval-mobile-layout'),
      children: [
        Expanded(
          child: ListView.separated(
            itemCount: page.stocktakes.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final record = page.stocktakes[index];
              return KeyedSubtree(
                key: ValueKey('warehouse-approval-tile-${record.id}'),
                child: _StocktakeRecordCard(
                  record: record,
                  selected: record.id == _selectedId,
                  onTap: () => _openMobileDetail(record),
                  trailing: _buildCardActions(record),
                ),
              );
            },
          ),
        ),
        _buildPagination(page),
      ],
    );
  }

  Widget? _buildCardActions(StocktakeRecord record) {
    final actions = _buildDetailActions(record);
    if (actions.isEmpty) return null;
    return Wrap(spacing: 8, runSpacing: 8, children: actions);
  }

  List<Widget> _buildDetailActions(StocktakeRecord record) {
    final busy = _actionBusyId == record.id;
    return [
      if (record.status == 'SUBMITTED')
        FilledButton.icon(
          key: ValueKey('warehouse-approval-approve-${record.id}'),
          onPressed: busy ? null : () => _approve(record),
          icon: busy
              ? const SizedBox.square(
                  dimension: 15,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.check_rounded, size: 18),
          label: Text(busy ? '处理中...' : '批准并过账'),
        ),
      if (record.status == 'SUBMITTED')
        OutlinedButton.icon(
          key: ValueKey('warehouse-approval-reject-${record.id}'),
          onPressed: busy ? null : () => _reject(record),
          icon: const Icon(Icons.close_rounded, size: 18),
          label: const Text('驳回'),
        ),
      if (record.status == 'POSTED' && _canReverse)
        OutlinedButton.icon(
          key: ValueKey('warehouse-approval-reverse-${record.id}'),
          onPressed: busy ? null : () => _reverse(record),
          icon: const Icon(Icons.undo_rounded, size: 18),
          label: const Text('冲销'),
        ),
    ];
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
          height: MediaQuery.sizeOf(sheetContext).height * .84,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: _StocktakeDetailView(
              record: detail,
              error: _detailError,
              onRetry: () => _loadDetail(detail),
              notice: _actionNotice,
              actions: [
                for (final action in _buildMobileActions(
                  detail,
                  onBeforeAction: () => Navigator.pop(sheetContext),
                ))
                  action,
              ],
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _buildMobileActions(
    StocktakeRecord record, {
    required VoidCallback onBeforeAction,
  }) {
    return [
      if (record.status == 'SUBMITTED')
        FilledButton.icon(
          onPressed: () {
            onBeforeAction();
            _approve(record);
          },
          icon: const Icon(Icons.check_rounded),
          label: const Text('批准并过账'),
        ),
      if (record.status == 'SUBMITTED')
        OutlinedButton.icon(
          onPressed: () {
            onBeforeAction();
            _reject(record);
          },
          icon: const Icon(Icons.close_rounded),
          label: const Text('驳回'),
        ),
      if (record.status == 'POSTED' && _canReverse)
        OutlinedButton.icon(
          onPressed: () {
            onBeforeAction();
            _reverse(record);
          },
          icon: const Icon(Icons.undo_rounded),
          label: const Text('冲销'),
        ),
    ];
  }

  Future<void> _approve(StocktakeRecord record) async {
    if (_actionBusyId != null) return;
    final line = record.line;
    final confirmed = await confirmInventoryAction(
      context,
      title: '批准盘点并立即过账？',
      content: '账面现存 ${line?.snapshotOnHandQty ?? 0} 瓶，'
          '实盘 ${line?.countedOnHandQty ?? 0} 瓶，'
          '现存差异 ${_signedBottleQuantity(line?.onHandDifferenceQty)}；'
          '不可售差异 ${_signedBottleQuantity(line?.unavailableDifferenceQty)}。'
          '批准成功后服务端会在同一事务中复核快照并改变库存。',
      confirmLabel: '确认批准并过账',
    );
    if (!confirmed || !mounted) return;
    setState(() {
      _actionBusyId = record.id;
      _actionNotice = null;
    });
    try {
      final result = await widget.api.approveStocktake(record.id);
      if (!mounted) return;
      widget.onInventoryFactsChanged();
      setState(() {
        _detail = result.stocktake;
        _preferredSelectionId = result.stocktake.id;
        _actionNotice = result.replayed ? '该批准命令已处理，已重新读取真实结果。' : null;
      });
      await _load();
      if (mounted) _showSnack('盘点已批准并由服务端完成过账。');
    } catch (error) {
      if (!mounted) return;
      setState(() => _actionNotice = inventoryErrorMessage(error));
      await _loadDetail(record);
    } finally {
      if (mounted) setState(() => _actionBusyId = null);
    }
  }

  Future<void> _reject(StocktakeRecord record) async {
    final result = await showDialog<StocktakeCommandResult>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _StocktakeReasonCommandDialog(
        title: '驳回盘点',
        label: '驳回原因（必填）',
        confirmLabel: '确认驳回',
        confirmMessage: '驳回不会改变库存；原盘点单将只读，'
            '如需继续请发起新的盘点。',
        fieldKey: const ValueKey('warehouse-approval-reject-reason'),
        confirmKey: const ValueKey('warehouse-approval-reject-confirm'),
        danger: true,
        onSubmit: (reason) =>
            widget.api.rejectStocktake(id: record.id, reason: reason),
        onError: (error) => _handleCommandError(record, error),
      ),
    );
    if (result == null || !mounted) return;
    _preferredSelectionId = result.stocktake.id;
    _detail = result.stocktake;
    await _load();
    if (mounted) _showSnack('盘点已驳回，库存没有发生变化。');
  }

  Future<void> _reverse(StocktakeRecord record) async {
    if (!_canReverse) return;
    final result = await showDialog<StocktakeCommandResult>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _StocktakeReasonCommandDialog(
        title: '冲销已生效盘点',
        label: '冲销原因（必填）',
        confirmLabel: '确认冲销',
        confirmMessage: '冲销会通过服务端反向库存事实恢复盘点前状态，'
            '不会删除原盘点记录。确认继续？',
        fieldKey: const ValueKey('warehouse-approval-reverse-reason'),
        confirmKey: const ValueKey('warehouse-approval-reverse-confirm'),
        danger: true,
        onSubmit: (reason) =>
            widget.api.reverseStocktake(id: record.id, reason: reason),
        onError: (error) => _handleCommandError(record, error),
      ),
    );
    if (result == null || !mounted) return;
    widget.onInventoryFactsChanged();
    _preferredSelectionId = result.stocktake.id;
    _detail = result.stocktake;
    await _load();
    if (mounted) _showSnack('盘点已冲销，已重新拉取库存事实。');
  }

  void _handleCommandError(StocktakeRecord record, Object error) {
    if (!mounted) return;
    setState(() => _actionNotice = inventoryErrorMessage(error));
    _loadDetail(record);
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }
}

class _StocktakeReasonCommandDialog extends StatefulWidget {
  const _StocktakeReasonCommandDialog({
    required this.title,
    required this.label,
    required this.confirmLabel,
    required this.confirmMessage,
    required this.fieldKey,
    required this.confirmKey,
    required this.danger,
    required this.onSubmit,
    required this.onError,
  });

  final String title;
  final String label;
  final String confirmLabel;
  final String confirmMessage;
  final Key fieldKey;
  final Key confirmKey;
  final bool danger;
  final Future<StocktakeCommandResult> Function(String reason) onSubmit;
  final ValueChanged<Object> onError;

  @override
  State<_StocktakeReasonCommandDialog> createState() =>
      _StocktakeReasonCommandDialogState();
}

class _StocktakeReasonCommandDialogState
    extends State<_StocktakeReasonCommandDialog> {
  final _formKey = GlobalKey<FormState>();
  final _reason = TextEditingController();
  bool _saving = false;
  bool _allowPop = false;
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _requestClose() async {
    if (_saving) return;
    if (_reason.text.trim().isEmpty) {
      setState(() => _allowPop = true);
      Navigator.pop(context);
      return;
    }
    final discard = await confirmInventoryAction(
      context,
      title: '放弃已填写的原因？',
      content: '当前操作尚未提交。',
      confirmLabel: '放弃',
      danger: true,
    );
    if (!discard || !mounted) return;
    setState(() => _allowPop = true);
    Navigator.pop(context);
  }

  Future<void> _submit() async {
    if (_saving || !_formKey.currentState!.validate()) return;
    final confirmed = await confirmInventoryAction(
      context,
      title: widget.title,
      content: widget.confirmMessage,
      confirmLabel: widget.confirmLabel,
      danger: widget.danger,
    );
    if (!confirmed || !mounted) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await widget.onSubmit(_reason.text.trim());
      if (!mounted) return;
      setState(() => _allowPop = true);
      Navigator.pop(context, result);
    } catch (error) {
      widget.onError(error);
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = inventoryErrorMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<StocktakeCommandResult>(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _requestClose();
      },
      child: AlertDialog(
        title: Text(widget.title),
        content: SizedBox(
          width: 520,
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  key: widget.fieldKey,
                  controller: _reason,
                  enabled: !_saving,
                  decoration: InputDecoration(labelText: widget.label),
                  maxLines: 3,
                  maxLength: 500,
                  validator: (value) =>
                      (value ?? '').trim().isEmpty ? '必须填写原因' : null,
                ),
                if (_error != null)
                  InventoryInlineNotice(
                    message: _error!,
                    tone: StatusTone.danger,
                  ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _requestClose,
            child: const Text('取消'),
          ),
          FilledButton(
            key: widget.confirmKey,
            style: widget.danger
                ? FilledButton.styleFrom(
                    backgroundColor: Theme.of(context).colorScheme.error,
                  )
                : null,
            onPressed: _saving ? null : _submit,
            child: _saving
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(widget.confirmLabel),
          ),
        ],
      ),
    );
  }
}
