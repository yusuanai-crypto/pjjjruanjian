import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../core/business/inventory_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';

class WarehousePackingPage extends StatefulWidget {
  const WarehousePackingPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<WarehousePackingPage> createState() => _WarehousePackingPageState();
}

class _WarehousePackingPageState extends State<WarehousePackingPage> {
  late BusinessApi _businessApi;
  late InventoryApi _inventoryApi;
  late final TextEditingController _queryController;
  late final TextEditingController _packageCountController;
  late final TextEditingController _warehouseRemarkController;

  PackingStatus _filter = PackingStatus.pending;
  String _logisticsMethodFilter = _allLogisticsMethodFilter;
  String _logisticsMethod = logisticsMethods.first;
  bool _hasPackingMark = false;

  List<SalesOrderRecord> _orders = const <SalesOrderRecord>[];
  SalesOrderRecord? _selectedOrder;
  bool _loading = true;
  bool _saving = false;
  bool _changingWarehouse = false;
  String? _errorMessage;
  String? _formErrorMessage;

  bool get _canEditPacking =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.warehouse;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _inventoryApi = InventoryApi(
      apiClient: widget.apiClient,
      token: widget.token,
      role: widget.role,
    );
    _queryController = TextEditingController();
    _packageCountController = TextEditingController(text: '0');
    _warehouseRemarkController = TextEditingController();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadOrders());
  }

  @override
  void didUpdateWidget(covariant WarehousePackingPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _inventoryApi = InventoryApi(
        apiClient: widget.apiClient,
        token: widget.token,
        role: widget.role,
      );
      _loadOrders();
    }
  }

  @override
  void dispose() {
    _queryController.dispose();
    _packageCountController.dispose();
    _warehouseRemarkController.dispose();
    super.dispose();
  }

  Future<void> _loadOrders({
    String? preserveSelectedId,
    SalesOrderRecord? selectedFallback,
  }) async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final orders = await _businessApi.listWarehouseOrders(
        limit: 100,
        query: _queryController.text.trim(),
        packingStatus: _filter.value,
        logisticsMethod: _selectedLogisticsMethodFilter,
      );
      if (!mounted) {
        return;
      }

      final selected = _selectedFrom(
        orders,
        preserveSelectedId ?? _selectedOrder?.id,
        fallback: selectedFallback,
      );
      setState(() {
        _orders = orders;
        _selectedOrder = selected;
        _loading = false;
        _formErrorMessage = null;
      });
      _fillDraft(selected);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _orders = const <SalesOrderRecord>[];
        _selectedOrder = null;
        _loading = false;
        _errorMessage = _messageForError(error);
      });
      _fillDraft(null);
    }
  }

  Future<void> _selectOrder(SalesOrderRecord order) async {
    setState(() {
      _selectedOrder = order;
      _formErrorMessage = null;
      _fillDraft(order);
    });
    await _showPackingEditor();
  }

  Future<void> _changeFulfillmentWarehouse() async {
    final order = _selectedOrder;
    if (order == null || _changingWarehouse) {
      return;
    }
    List<WarehouseRecord> warehouses;
    try {
      warehouses = await _inventoryApi.listWarehouses(isActive: true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageForError(error))),
      );
      return;
    }
    if (!mounted) {
      return;
    }

    final selectedWarehouseId = await showDialog<WarehouseRecord>(
      context: context,
      builder: (dialogContext) {
        return _WarehousePickerDialog(
          warehouses: warehouses,
          currentWarehouseId: order.fulfillmentWarehouseId,
        );
      },
    );

    if (selectedWarehouseId == null) {
      return;
    }
    if (selectedWarehouseId.id == order.fulfillmentWarehouseId) {
      return;
    }

    setState(() => _changingWarehouse = true);
    try {
      final updated = await _businessApi.changeWarehouseOrderFulfillment(
        order.id,
        selectedWarehouseId.id,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _replaceOrder(updated);
        _selectedOrder = updated;
      });
      _fillDraft(updated);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${updated.orderNo} 履约仓库已切换为 ${updated.fulfillmentWarehouseName ?? selectedWarehouseId.name}。',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageForError(error))),
      );
    } finally {
      if (mounted) {
        setState(() => _changingWarehouse = false);
      }
    }
  }

  Future<bool> _savePacking({
    VoidCallback? closeEditor,
    VoidCallback? refreshEditor,
  }) async {
    void updateFormState(VoidCallback fn) {
      if (!mounted) {
        return;
      }
      setState(fn);
      refreshEditor?.call();
    }

    final order = _selectedOrder;
    if (!_canEditPacking) {
      updateFormState(() => _formErrorMessage = '当前角色只能查看打包信息。');
      return false;
    }
    if (order == null || _saving) {
      return false;
    }

    final packageCount = _packageCountOrNull(_packageCountController.text);
    if (packageCount == null) {
      updateFormState(() => _formErrorMessage = '打包件数必须是 0 或正整数。');
      return false;
    }

    updateFormState(() {
      _saving = true;
      _formErrorMessage = null;
    });

    try {
      final updated = await _businessApi.updateWarehouseOrderPacking(
        order.id,
        {
          'logisticsMethod': _logisticsMethod.trim(),
          'packingStatus': PackingStatus.packed.value,
          'packageCount': packageCount,
          'warehouseRemark': _warehouseRemarkController.text.trim(),
          'hasPackingMark': _hasPackingMark,
        },
      );
      if (!mounted) {
        return false;
      }

      closeEditor?.call();
      setState(() {
        _replaceOrder(updated);
        _selectedOrder = updated;
        _formErrorMessage = null;
      });
      _fillDraft(updated);
      await _loadOrders(
        preserveSelectedId: updated.id,
        selectedFallback: updated,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${updated.orderNo} 打包信息已保存。')),
        );
      }
      return true;
    } catch (error) {
      if (!mounted) {
        return false;
      }
      updateFormState(() {
        _formErrorMessage = _messageForError(error);
      });
      return false;
    } finally {
      if (mounted) {
        setState(() => _saving = false);
        refreshEditor?.call();
      }
    }
  }

  void _replaceOrder(SalesOrderRecord updated) {
    _orders = [
      for (final order in _orders)
        if (order.id == updated.id) updated else order,
    ];
  }

  void _fillDraft(SalesOrderRecord? order) {
    if (order == null) {
      _logisticsMethod = logisticsMethods.first;
      _hasPackingMark = false;
      _packageCountController.text = '0';
      _warehouseRemarkController.clear();
      return;
    }

    final logisticsMethod = order.logisticsMethod?.trim();
    _logisticsMethod = logisticsMethod == null || logisticsMethod.isEmpty
        ? logisticsMethods.first
        : logisticsMethod;
    _hasPackingMark = order.hasPackingMark;
    _packageCountController.text = '${order.packageCount}';
    _warehouseRemarkController.text = order.warehouseRemark ?? '';
  }

  String? get _selectedLogisticsMethodFilter =>
      _logisticsMethodFilter == _allLogisticsMethodFilter
          ? null
          : _logisticsMethodFilter;

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      maxWidth: 1360,
      children: [
        _buildWorkspaceHeader(),
        _buildListPane(),
      ],
    );
  }

  Widget _buildWorkspaceHeader() {
    final order = _selectedOrder;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 16,
          runSpacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: Theme.of(context)
                    .colorScheme
                    .primary
                    .withValues(alpha: 0.09),
                borderRadius: const BorderRadius.all(Radius.circular(8)),
              ),
              child: const Padding(
                padding: EdgeInsets.all(10),
                child: Icon(Icons.inventory_2_rounded),
              ),
            ),
            SizedBox(
              width: 260,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '库管打包工作台',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '当前队列：${_packingStatusLabel(_filter.value)} · ${_logisticsMethodFilterLabel(_logisticsMethodFilter)}',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ),
                ],
              ),
            ),
            StatusTag(
              label: _loading ? '加载中' : '${_orders.length} 笔邮寄订单',
              tone: _loading ? StatusTone.warning : StatusTone.info,
            ),
            if (order != null)
              StatusTag(
                label: '已选 ${order.orderNo}',
                tone: _packingTone(order.packingStatus),
              ),
            if (!_canEditPacking)
              const StatusTag(label: '只读', tone: StatusTone.info),
            OutlinedButton.icon(
              onPressed: _loading ? null : _loadOrders,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('刷新队列'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildListPane() {
    final filterForegroundColor = Theme.of(context).colorScheme.onSurface;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FormSection(
          title: '筛选订单',
          trailing: StatusTag(
            label: _packingStatusLabel(_filter.value),
            tone: _packingTone(_filter.value),
          ),
          children: [
            ResponsiveFormGrid(
              minItemWidth: 220,
              children: [
                TextField(
                  key: const ValueKey('warehouse-packing-search-field'),
                  controller: _queryController,
                  decoration: InputDecoration(
                    hintText: '搜索订单号、客户、电话、地址',
                    prefixIcon: const Icon(Icons.search_rounded),
                    suffixIcon: IconButton(
                      tooltip: '清空',
                      onPressed: () {
                        _queryController.clear();
                        _loadOrders();
                      },
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ),
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _loadOrders(),
                ),
                FilledButton.icon(
                  key: const ValueKey('warehouse-packing-search-button'),
                  onPressed: _loading ? null : _loadOrders,
                  icon: const Icon(Icons.search_rounded),
                  label: const Text('查询'),
                ),
                _DropdownField<String>(
                  key: const ValueKey('warehouse-logistics-method-filter'),
                  label: '物流方式',
                  value: _logisticsMethodFilter,
                  items: const [
                    _allLogisticsMethodFilter,
                    ...logisticsMethods,
                  ],
                  itemLabel: _logisticsMethodFilterLabel,
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _logisticsMethodFilter = value);
                      _loadOrders();
                    }
                  },
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final status in PackingStatus.values)
                  FilterChip(
                    key: ValueKey('warehouse-packing-filter-${status.value}'),
                    selected: _filter == status,
                    labelStyle: TextStyle(
                      color: WidgetStateColor.resolveWith(
                        (_) => filterForegroundColor,
                      ),
                    ),
                    checkmarkColor: filterForegroundColor,
                    label: Text(_packingStatusLabel(status.value)),
                    onSelected: (_) {
                      setState(() => _filter = status);
                      _loadOrders();
                    },
                  ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 12),
        _buildOrderQueue(),
      ],
    );
  }

  Widget _buildOrderQueue() {
    if (_loading) {
      return const LoadingState(title: '正在加载邮寄订单');
    }
    if (_errorMessage != null) {
      return ErrorState(title: _errorMessage!, onRetry: _loadOrders);
    }
    if (_orders.isEmpty) {
      return EmptyState(
        title: '${_packingStatusLabel(_filter.value)}暂无邮寄订单',
        action: OutlinedButton.icon(
          onPressed: _loadOrders,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('刷新'),
        ),
      );
    }

    return _WarehouseOrderList(
      orders: _orders,
      selectedId: _selectedOrder?.id,
      onSelected: _selectOrder,
    );
  }

  Future<void> _showPackingEditor() async {
    if (!mounted) {
      return;
    }

    if (isDesktopWidth(MediaQuery.of(context).size.width)) {
      await _showPackingDialog();
    } else {
      await _showPackingBottomSheet();
    }
  }

  Future<void> _showPackingBottomSheet() async {
    var editorOpen = true;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (editorContext, setEditorState) {
            void refreshEditor() {
              if (editorOpen) {
                setEditorState(() {});
              }
            }

            void closeEditor() {
              if (!editorOpen) {
                return;
              }
              editorOpen = false;
              Navigator.of(editorContext).pop();
            }

            return SafeArea(
              child: Padding(
                padding: EdgeInsets.only(
                  bottom: MediaQuery.of(editorContext).viewInsets.bottom,
                ),
                child: SizedBox(
                  height: MediaQuery.of(editorContext).size.height * 0.92,
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
                    child: _buildPackingEditorContent(
                      showHeader: true,
                      onCancel: _saving ? null : closeEditor,
                      closeEditor: closeEditor,
                      refreshEditor: refreshEditor,
                    ),
                  ),
                ),
              ),
            );
          },
        );
      },
    ).whenComplete(() {
      editorOpen = false;
    });
  }

  Future<void> _showPackingDialog() async {
    var editorOpen = true;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (editorContext, setEditorState) {
            void refreshEditor() {
              if (editorOpen) {
                setEditorState(() {});
              }
            }

            void closeEditor() {
              if (!editorOpen) {
                return;
              }
              editorOpen = false;
              Navigator.of(editorContext).pop();
            }

            return AlertDialog(
              title: Row(
                children: [
                  const Expanded(child: Text('订单核对/打包处理')),
                  if (_selectedOrder != null)
                    StatusTag(
                      label: _packingStatusLabel(_selectedOrder!.packingStatus),
                      tone: _packingTone(_selectedOrder!.packingStatus),
                    ),
                ],
              ),
              content: SizedBox(
                width: 680,
                child: SingleChildScrollView(
                  child: _buildPackingEditorContent(
                    onCancel: _saving ? null : closeEditor,
                    closeEditor: closeEditor,
                    refreshEditor: refreshEditor,
                  ),
                ),
              ),
            );
          },
        );
      },
    ).whenComplete(() {
      editorOpen = false;
    });
  }

  Widget _buildPackingEditorContent({
    required VoidCallback? onCancel,
    required VoidCallback closeEditor,
    required VoidCallback refreshEditor,
    bool showHeader = false,
  }) {
    final order = _selectedOrder;
    if (order == null) {
      return const FormSection(
        title: '订单核对',
        children: [
          _InlineState(
            icon: Icons.touch_app_rounded,
            title: '请选择一笔邮寄订单',
          ),
        ],
      );
    }

    void updateDraft(VoidCallback fn) {
      setState(fn);
      refreshEditor();
    }

    return Column(
      key: const ValueKey('warehouse-packing-editor'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (showHeader) ...[
          Row(
            children: [
              Expanded(
                child: Text(
                  '订单核对/打包处理',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              IconButton(
                tooltip: '取消',
                onPressed: onCancel,
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
          const SizedBox(height: 12),
        ],
        FormSection(
          title: '订单核对',
          trailing: StatusTag(
            label: _packingStatusLabel(order.packingStatus),
            tone: _packingTone(order.packingStatus),
          ),
          children: [
            _SelectedOrderSummary(
              order: order,
              canEdit: _canEditPacking,
              changingWarehouse: _changingWarehouse,
              onChangeWarehouse: _canEditPacking && !_saving
                  ? _changeFulfillmentWarehouse
                  : null,
            ),
          ],
        ),
        const SizedBox(height: 12),
        FormSection(
          title: '打包处理',
          trailing: StatusTag(
            label: _packingStatusLabel(order.packingStatus),
            tone: _packingTone(order.packingStatus),
          ),
          children: [
            if (_formErrorMessage != null) ...[
              Align(
                alignment: Alignment.centerLeft,
                child: StatusTag(
                  label: _formErrorMessage!,
                  tone: StatusTone.danger,
                ),
              ),
              const SizedBox(height: 12),
            ],
            ResponsiveFormGrid(
              minItemWidth: 220,
              children: [
                _DropdownField<String>(
                  key: const ValueKey('warehouse-logistics-method-field'),
                  label: '物流方式',
                  value: _logisticsMethod,
                  items: [
                    ...logisticsMethods,
                    if (_logisticsMethod.trim().isNotEmpty &&
                        !logisticsMethods.contains(_logisticsMethod))
                      _logisticsMethod,
                  ],
                  itemLabel: (value) => value,
                  onChanged: _canEditPacking
                      ? (value) {
                          if (value != null) {
                            updateDraft(() => _logisticsMethod = value);
                          }
                        }
                      : null,
                ),
                TextField(
                  key: const ValueKey('warehouse-package-count-field'),
                  controller: _packageCountController,
                  readOnly: !_canEditPacking,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: '打包件数'),
                ),
                SwitchListTile(
                  key: const ValueKey('warehouse-has-packing-mark-field'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('是否有标记'),
                  subtitle: Text(_hasPackingMark ? '是' : '否'),
                  value: _hasPackingMark,
                  onChanged: _canEditPacking
                      ? (value) {
                          updateDraft(() => _hasPackingMark = value);
                        }
                      : null,
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('warehouse-remark-field'),
              controller: _warehouseRemarkController,
              readOnly: !_canEditPacking,
              minLines: 3,
              maxLines: 5,
              decoration: const InputDecoration(labelText: '库管备注'),
            ),
            const SizedBox(height: 14),
            _PackingActionBar(
              saving: _saving,
              canEdit: _canEditPacking,
              onCancel: onCancel,
              onSave: _saving
                  ? null
                  : () => _savePacking(
                        closeEditor: closeEditor,
                        refreshEditor: refreshEditor,
                      ),
            ),
          ],
        ),
      ],
    );
  }
}

class _WarehouseOrderList extends StatelessWidget {
  const _WarehouseOrderList({
    required this.orders,
    required this.selectedId,
    required this.onSelected,
  });

  final List<SalesOrderRecord> orders;
  final String? selectedId;
  final ValueChanged<SalesOrderRecord> onSelected;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '订单队列',
                    style: textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                StatusTag(label: '${orders.length} 笔', tone: StatusTone.info),
              ],
            ),
          ),
          const Divider(height: 1),
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: orders.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final order = orders[index];
              final selected = selectedId == order.id;
              final abnormal =
                  order.packingStatus == PackingStatus.abnormal.value;
              return ListTile(
                key: ValueKey('warehouse-order-${order.id}'),
                selected: selected,
                tileColor: abnormal
                    ? Theme.of(context)
                        .colorScheme
                        .errorContainer
                        .withValues(alpha: 0.28)
                    : null,
                selectedTileColor: abnormal
                    ? Theme.of(context)
                        .colorScheme
                        .errorContainer
                        .withValues(alpha: 0.42)
                    : Theme.of(context)
                        .colorScheme
                        .primary
                        .withValues(alpha: 0.08),
                leading: CircleAvatar(
                  backgroundColor: abnormal
                      ? Theme.of(context).colorScheme.errorContainer
                      : Theme.of(context)
                          .colorScheme
                          .primary
                          .withValues(alpha: selected ? 0.18 : 0.08),
                  child: Icon(
                    abnormal
                        ? Icons.report_problem_rounded
                        : Icons.inventory_2_rounded,
                    color: abnormal
                        ? Theme.of(context).colorScheme.error
                        : Theme.of(context).colorScheme.primary,
                    size: 20,
                  ),
                ),
                title: Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      order.orderNo,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    StatusTag(
                      label: _packingStatusLabel(order.packingStatus),
                      tone: _packingTone(order.packingStatus),
                    ),
                    StatusTag(
                      label: _logisticsNoLabel(order),
                      tone: _logisticsNoTone(order),
                    ),
                  ],
                ),
                subtitle: Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      Text('客户 ${_display(order.customerName)}'),
                      Text('电话 ${_display(order.customerPhone)}'),
                      Text('地址 ${_orderAddress(order)}'),
                      Text('明细 ${_itemSummary(order)}'),
                      Text('发货 ${_display(order.shippingDate)}'),
                      Text('物流单号 ${_display(order.logisticsNo)}'),
                      Text('件数 ${order.packageCount}'),
                    ],
                  ),
                ),
                trailing: selected
                    ? const Icon(Icons.check_circle_rounded)
                    : const Icon(Icons.chevron_right_rounded),
                onTap: () => onSelected(order),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _PackingActionBar extends StatelessWidget {
  const _PackingActionBar({
    required this.saving,
    required this.canEdit,
    required this.onCancel,
    required this.onSave,
  });

  final bool saving;
  final bool canEdit;
  final VoidCallback? onCancel;
  final VoidCallback? onSave;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      alignment: WrapAlignment.end,
      spacing: 10,
      runSpacing: 10,
      children: [
        TextButton(
          onPressed: onCancel,
          child: const Text('取消'),
        ),
        if (canEdit)
          FilledButton.icon(
            key: const ValueKey('warehouse-packing-save-button'),
            onPressed: onSave,
            icon: saving
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.save_rounded),
            label: Text(saving ? '保存中...' : '保存打包'),
          ),
      ],
    );
  }
}

class _InlineState extends StatelessWidget {
  const _InlineState({
    required this.icon,
    required this.title,
  });

  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 34,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _SelectedOrderSummary extends StatelessWidget {
  const _SelectedOrderSummary({
    required this.order,
    this.canEdit = false,
    this.changingWarehouse = false,
    this.onChangeWarehouse,
  });

  final SalesOrderRecord order;
  final bool canEdit;
  final bool changingWarehouse;
  final VoidCallback? onChangeWarehouse;

  @override
  Widget build(BuildContext context) {
    final warehouseName = order.fulfillmentWarehouseName?.trim();
    final warehouseLabel = (warehouseName == null || warehouseName.isEmpty)
        ? '待分配'
        : warehouseName;
    final pendingPackages = order.packageCount > 0
        ? '${order.packageCount} 件'
        : '待配';
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).dividerColor),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _InfoRow(label: '订单号', value: order.orderNo),
            _InfoRow(
              label: '发货日期',
              value: _display(order.shippingDate),
            ),
            _InfoRow(label: '客户', value: _display(order.customerName)),
            _InfoRow(label: '电话', value: _display(order.customerPhone)),
            _InfoRow(label: '地址', value: _orderAddress(order)),
            _InfoRow(label: '明细', value: _itemSummary(order)),
            _InfoRow(
              label: '物流单号',
              value: _display(order.logisticsNo),
            ),
            _InfoRow(
              label: '履约仓库',
              value: warehouseLabel,
            ),
            _InfoRow(
              label: '待配数量',
              value: pendingPackages,
            ),
            if (onChangeWarehouse != null) ...[
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  key: const ValueKey('warehouse-packing-change-warehouse'),
                  onPressed: changingWarehouse ? null : onChangeWarehouse,
                  icon: changingWarehouse
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.swap_horiz_rounded),
                  label: Text(changingWarehouse ? '切换中...' : '换仓'),
                ),
              ),
            ],
            if (order.shippingRiskWarnings.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final warning in order.shippingRiskWarnings)
                      StatusTag(
                        label: warning.message,
                        tone: StatusTone.warning,
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

class _WarehousePickerDialog extends StatelessWidget {
  const _WarehousePickerDialog({
    required this.warehouses,
    this.currentWarehouseId,
  });

  final List<WarehouseRecord> warehouses;
  final String? currentWarehouseId;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('选择履约仓库'),
      content: SizedBox(
        width: 360,
        child: warehouses.isEmpty
            ? const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('暂无可用仓库'),
              )
            : ListView.separated(
                shrinkWrap: true,
                itemCount: warehouses.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final warehouse = warehouses[index];
                  final selected = warehouse.id == currentWarehouseId;
                  return ListTile(
                    key: ValueKey(
                      'warehouse-packing-change-warehouse-option-${warehouse.id}',
                    ),
                    title: Text(warehouse.name),
                    subtitle: Text(
                      warehouse.code.isEmpty
                          ? warehouse.address
                          : '${warehouse.code} · ${warehouse.address}',
                    ),
                    trailing: selected
                        ? const Icon(Icons.check_circle_rounded)
                        : null,
                    onTap: () => Navigator.of(context).pop(warehouse),
                  );
                },
              ),
      ),
      actions: [
        TextButton(
          key: const ValueKey(
            'warehouse-packing-change-warehouse-cancel',
          ),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
      ],
    );
  }
}

class _DropdownField<T> extends StatelessWidget {
  const _DropdownField({
    super.key,
    required this.label,
    required this.value,
    required this.items,
    required this.itemLabel,
    required this.onChanged,
  });

  final String label;
  final T value;
  final List<T> items;
  final String Function(T value) itemLabel;
  final ValueChanged<T?>? onChanged;

  @override
  Widget build(BuildContext context) {
    return InputDecorator(
      decoration: InputDecoration(labelText: label),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<T>(
          value: value,
          isExpanded: true,
          items: [
            for (final item in items)
              DropdownMenuItem<T>(
                value: item,
                child: Text(itemLabel(item)),
              ),
          ],
          onChanged: onChanged,
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 72,
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

const _allLogisticsMethodFilter = '__all_logistics_methods__';

SalesOrderRecord? _selectedFrom(
  List<SalesOrderRecord> orders,
  String? id, {
  SalesOrderRecord? fallback,
}) {
  if (id != null) {
    for (final order in orders) {
      if (order.id == id) {
        return order;
      }
    }
  }
  if (fallback != null) {
    return fallback;
  }
  return orders.isEmpty ? null : orders.first;
}

StatusTone _packingTone(String value) {
  switch (value) {
    case 'packing':
      return StatusTone.info;
    case 'packed':
      return StatusTone.success;
    case 'abnormal':
      return StatusTone.danger;
    case 'pending':
    default:
      return StatusTone.warning;
  }
}

String _packingStatusLabel(String value) {
  switch (value) {
    case 'packing':
      return '打包中';
    case 'packed':
      return '已打包';
    case 'abnormal':
      return '异常';
    case 'pending':
    default:
      return '待打包';
  }
}

String _deliveryTypeLabel(String value) {
  switch (value) {
    case 'self_pickup':
      return '自带';
    case 'shipping':
      return '邮寄';
    default:
      return value;
  }
}

String _orderAddress(SalesOrderRecord order) {
  final parts = [
    order.province,
    order.city,
    order.district,
    order.address,
  ].whereType<String>().where((part) => part.trim().isNotEmpty).toList();
  return parts.isEmpty ? '未填写地址' : parts.join('');
}

String _itemSummary(SalesOrderRecord order) {
  if (order.items.isEmpty) {
    return '无订单明细';
  }
  final items = [...order.items]
    ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
  return items.map((item) {
    final heading =
        '${item.productName} x${item.quantity} · ${_deliveryTypeLabel(item.deliveryType)}';
    if (item.serializedUnits.isEmpty) return heading;
    final units = item.serializedUnits.map(
      (unit) => '${unit.moutaiName ?? item.productName} / '
          '物流码 ${unit.logisticsCode ?? '-'} / '
          '出厂日期 ${unit.factoryDate ?? '-'} / '
          '生产批次 ${unit.productionBatch ?? '-'} / '
          '批次序号 ${unit.batchSerialNo ?? '-'}',
    );
    return '$heading\n${units.join('\n')}';
  }).join('\n');
}

String _display(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? '未填写' : text;
}

int? _packageCountOrNull(String value) {
  final text = value.trim();
  if (text.isEmpty) {
    return 0;
  }
  final parsed = int.tryParse(text);
  if (parsed == null || parsed < 0) {
    return null;
  }
  return parsed;
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}

String _logisticsMethodFilterLabel(String value) {
  if (value == _allLogisticsMethodFilter) {
    return '全部物流方式';
  }
  return value;
}

String _logisticsNoLabel(SalesOrderRecord order) {
  final logisticsNo = order.logisticsNo?.trim() ?? '';
  return logisticsNo.isEmpty ? '物流单号待补' : '物流单号已补';
}

StatusTone _logisticsNoTone(SalesOrderRecord order) {
  final logisticsNo = order.logisticsNo?.trim() ?? '';
  return logisticsNo.isEmpty ? StatusTone.warning : StatusTone.success;
}
