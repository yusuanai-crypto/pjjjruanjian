import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../core/business/inventory_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/serialized_inventory_picker_dialog.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import '../warehouse_management/shared/inventory_workspace_shared.dart';

class WarehousePackingPage extends StatefulWidget {
  const WarehousePackingPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    this.embedded = false,
    this.onInventoryFactsChanged,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final bool embedded;
  final VoidCallback? onInventoryFactsChanged;

  @override
  State<WarehousePackingPage> createState() => _WarehousePackingPageState();
}

class _WarehousePackingPageState extends State<WarehousePackingPage> {
  late BusinessApi _businessApi;
  late InventoryApi _inventoryApi;
  late final TextEditingController _queryController;
  late final TextEditingController _packageCountController;
  late final TextEditingController _warehouseRemarkController;

  String _workbenchStatus = _fulfillmentWaiting;
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
  int _identityRevision = 0;
  int _ordersRequestGeneration = 0;
  DateTime? _dateFrom;
  DateTime? _dateTo;
  Map<String, String> _productTrackingModes = const {};
  final Map<String, List<SerializedUnitSelection>> _serializedSelections = {};

  bool get _canEditPacking =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.warehouse;

  bool get _canAccessWorkbench =>
      _canEditPacking || widget.role == UserRole.boss;

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
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_canAccessWorkbench) return;
      _loadProductTrackingModes();
      _loadOrders();
    });
  }

  @override
  void didUpdateWidget(covariant WarehousePackingPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.role != widget.role) {
      _inventoryApi.clearCache();
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _inventoryApi = InventoryApi(
        apiClient: widget.apiClient,
        token: widget.token,
        role: widget.role,
      );
      _identityRevision++;
      _ordersRequestGeneration++;
      _orders = const <SalesOrderRecord>[];
      _selectedOrder = null;
      _formErrorMessage = null;
      _errorMessage = null;
      _saving = false;
      _changingWarehouse = false;
      _queryController.clear();
      _workbenchStatus = _fulfillmentWaiting;
      _logisticsMethodFilter = _allLogisticsMethodFilter;
      _dateFrom = null;
      _dateTo = null;
      _fillDraft(null);
      _productTrackingModes = const {};
      if (_canAccessWorkbench) {
        _loadProductTrackingModes();
        _loadOrders();
      } else {
        setState(() => _loading = false);
      }
    }
  }

  @override
  void dispose() {
    _ordersRequestGeneration++;
    _inventoryApi.clearCache();
    _queryController.dispose();
    _packageCountController.dispose();
    _warehouseRemarkController.dispose();
    super.dispose();
  }

  Future<void> _loadOrders({
    String? preserveSelectedId,
    SalesOrderRecord? selectedFallback,
  }) async {
    final identityRevision = _identityRevision;
    final requestGeneration = ++_ordersRequestGeneration;
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final orders = await _businessApi.listWarehouseOrders(
        limit: 100,
        start: _dateFrom,
        end: _dateTo,
        query: _queryController.text.trim(),
        packingStatus: _packingStatusForQuery,
        logisticsMethod: _selectedLogisticsMethodFilter,
      );
      if (!mounted ||
          identityRevision != _identityRevision ||
          requestGeneration != _ordersRequestGeneration) {
        return;
      }

      final visibleOrders = orders
          .where((order) => _matchesWorkbenchStatus(order, _workbenchStatus))
          .toList();
      final selected = _selectedFrom(
        visibleOrders,
        preserveSelectedId ?? _selectedOrder?.id,
        fallback: selectedFallback,
      );
      setState(() {
        _orders = visibleOrders;
        _selectedOrder = selected;
        _loading = false;
        _formErrorMessage = null;
      });
      _fillDraft(selected);
    } catch (error) {
      if (!mounted ||
          identityRevision != _identityRevision ||
          requestGeneration != _ordersRequestGeneration) {
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

  Future<void> _loadProductTrackingModes() async {
    final revision = _identityRevision;
    try {
      final options = await _businessApi.listProductOptions();
      if (!mounted || revision != _identityRevision) return;
      setState(() {
        _productTrackingModes = {
          for (final option in options)
            option.id: option.inventoryTrackingMode.toLowerCase(),
        };
      });
    } catch (_) {
      // 商品选项失败不阻断真实订单队列；逐瓶选择区会显示明确的接口状态。
    }
  }

  String? get _packingStatusForQuery {
    return switch (_workbenchStatus) {
      _fulfillmentWaiting => PackingStatus.pending.value,
      _fulfillmentPacking => PackingStatus.packing.value,
      _fulfillmentPacked => PackingStatus.packed.value,
      _fulfillmentAbnormal => PackingStatus.abnormal.value,
      _ => null,
    };
  }

  Future<void> _selectOrder(SalesOrderRecord order) async {
    setState(() {
      _selectedOrder = order;
      _formErrorMessage = null;
      _fillDraft(order);
    });
    if (widget.embedded &&
        (context.size?.width ?? MediaQuery.sizeOf(context).width) >=
            _packingWideBreakpoint) {
      return;
    }
    await _showPackingEditor();
  }

  Future<void> _changeFulfillmentWarehouse() async {
    final identityRevision = _identityRevision;
    final order = _selectedOrder;
    if (order == null || _changingWarehouse) {
      return;
    }
    if (order.packingStatus == PackingStatus.packed.value) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('订单已打包出库，不能再更换履约仓。')),
      );
      return;
    }
    List<WarehouseRecord> warehouses;
    try {
      warehouses = await _inventoryApi.listWarehouses(isActive: true);
    } catch (error) {
      if (!mounted || identityRevision != _identityRevision) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageForError(error))),
      );
      return;
    }
    if (!mounted || identityRevision != _identityRevision) {
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

    if (identityRevision != _identityRevision || selectedWarehouseId == null) {
      return;
    }
    if (selectedWarehouseId.id == order.fulfillmentWarehouseId) {
      return;
    }
    if (!mounted || identityRevision != _identityRevision) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('确认更换履约仓'),
        content: Text(
          '将 ${order.orderNo} 的履约仓更换为 ${selectedWarehouseId.name}？'
          '后端将重新计算订单占用和库存摘要。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            key: const ValueKey('warehouse-packing-confirm-warehouse'),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认更换'),
          ),
        ],
      ),
    );
    if (confirmed != true ||
        !mounted ||
        identityRevision != _identityRevision) {
      return;
    }

    setState(() => _changingWarehouse = true);
    try {
      final updated = await _businessApi.changeWarehouseOrderFulfillment(
        order.id,
        selectedWarehouseId.id,
      );
      if (!mounted || identityRevision != _identityRevision) {
        return;
      }
      setState(() {
        _replaceOrder(updated);
        _selectedOrder = updated;
      });
      _fillDraft(updated);
      widget.onInventoryFactsChanged?.call();
      await _loadOrders(
        preserveSelectedId: updated.id,
        selectedFallback: updated,
      );
      if (!mounted || identityRevision != _identityRevision) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${updated.orderNo} 履约仓库已切换为 ${updated.fulfillmentWarehouseName ?? selectedWarehouseId.name}。',
          ),
        ),
      );
    } catch (error) {
      if (!mounted || identityRevision != _identityRevision) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageForError(error))),
      );
    } finally {
      if (mounted && identityRevision == _identityRevision) {
        setState(() => _changingWarehouse = false);
      }
    }
  }

  Future<bool> _savePacking({
    VoidCallback? closeEditor,
    VoidCallback? refreshEditor,
  }) async {
    final identityRevision = _identityRevision;
    void updateFormState(VoidCallback fn) {
      if (!mounted || identityRevision != _identityRevision) {
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
    final serializedAssignments = <Map<String, dynamic>>[];
    for (final item in order.items) {
      if (!_isSerializedItem(item)) continue;
      final fulfillment = item.fulfillment;
      final lineKey = item.inventoryLineKey;
      if (fulfillment == null || lineKey == null || lineKey.isEmpty) {
        updateFormState(
          () => _formErrorMessage = '逐瓶配货行缺少后端履约标识，功能暂不可用，请刷新后重试。',
        );
        return false;
      }
      final selected = _serializedSelections[lineKey] ?? const [];
      final required = fulfillment.requestedQty - fulfillment.outboundQty;
      if (selected.length < required) {
        updateFormState(
          () => _formErrorMessage =
              '${item.productName} 缺货待配：需要 $required 瓶，当前已选 ${selected.length} 瓶。',
        );
        return false;
      }
      if (selected.length > required) {
        updateFormState(
          () =>
              _formErrorMessage = '${item.productName} 已选瓶数超过剩余需求 $required 瓶。',
        );
        return false;
      }
      serializedAssignments.add({
        'inventoryLineKey': lineKey,
        'unitIds': selected.map((unit) => unit.id).toList(),
      });
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('确认已打包并出库'),
        content: Text(
          '确认 ${order.orderNo} 已完成打包？普通商品和已选择的逐瓶商品'
          '将由后端库存事件正式出库，页面不会直接修改库存数量。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            key: const ValueKey('warehouse-packing-confirm-packed'),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('确认已打包'),
          ),
        ],
      ),
    );
    if (confirmed != true ||
        !mounted ||
        identityRevision != _identityRevision) {
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
          if (serializedAssignments.isNotEmpty)
            'serializedAssignments': serializedAssignments,
        },
      );
      if (!mounted || identityRevision != _identityRevision) {
        return false;
      }

      closeEditor?.call();
      setState(() {
        _replaceOrder(updated);
        _selectedOrder = updated;
        _formErrorMessage = null;
      });
      _fillDraft(updated);
      widget.onInventoryFactsChanged?.call();
      await _loadOrders(
        preserveSelectedId: updated.id,
        selectedFallback: updated,
      );
      if (mounted && identityRevision == _identityRevision) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${updated.orderNo} 打包信息已保存。')),
        );
      }
      return true;
    } catch (error) {
      if (!mounted || identityRevision != _identityRevision) {
        return false;
      }
      final message = _messageForError(error);
      await _loadOrders(
        preserveSelectedId: order.id,
        selectedFallback: order,
      );
      if (!mounted || identityRevision != _identityRevision) return false;
      updateFormState(() {
        _formErrorMessage = message;
      });
      return false;
    } finally {
      if (mounted && identityRevision == _identityRevision) {
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
    _serializedSelections.clear();
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
    for (final item in order.items) {
      final lineKey = item.inventoryLineKey;
      final units = item.fulfillment?.units ?? item.serializedUnits;
      if (lineKey == null || units.isEmpty) continue;
      _serializedSelections[lineKey] =
          units.map(SerializedUnitSelection.fromOrder).toList(growable: false);
    }
  }

  String? get _selectedLogisticsMethodFilter =>
      _logisticsMethodFilter == _allLogisticsMethodFilter
          ? null
          : _logisticsMethodFilter;

  @override
  Widget build(BuildContext context) {
    if (!_canAccessWorkbench) {
      return const ErrorState(title: '当前角色不能进入全量销售出库与配货工作台。');
    }
    if (widget.embedded) {
      return LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= _packingWideBreakpoint;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildWorkspaceHeader(),
              const SizedBox(height: 12),
              _buildFilters(),
              const SizedBox(height: 12),
              Expanded(
                child: wide
                    ? Row(
                        children: [
                          SizedBox(
                            width: 430,
                            child: _buildOrderQueue(fillAvailable: true),
                          ),
                          const VerticalDivider(width: 1),
                          Expanded(
                            child: SingleChildScrollView(
                              padding: const EdgeInsets.only(left: 12),
                              child: _buildPackingEditorContent(
                                onCancel: null,
                                closeEditor: () {},
                                refreshEditor: () {
                                  if (mounted) setState(() {});
                                },
                              ),
                            ),
                          ),
                        ],
                      )
                    : _buildOrderQueue(fillAvailable: true),
              ),
            ],
          );
        },
      );
    }
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
                    '当前队列：${_fulfillmentStatusLabel(_workbenchStatus)} · '
                    '${_logisticsMethodFilterLabel(_logisticsMethodFilter)}',
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildFilters(),
        const SizedBox(height: 12),
        _buildOrderQueue(),
      ],
    );
  }

  Widget _buildFilters() {
    final foreground = Theme.of(context).colorScheme.onSurface;
    return FormSection(
      title: '筛选订单',
      trailing: StatusTag(
        label: _fulfillmentStatusLabel(_workbenchStatus),
        tone: _fulfillmentTone(_workbenchStatus),
      ),
      children: [
        ResponsiveFormGrid(
          minItemWidth: 220,
          children: [
            TextField(
              key: const ValueKey('warehouse-packing-search-field'),
              controller: _queryController,
              decoration: InputDecoration(
                labelText: '订单号 / 客户',
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
            _DropdownField<String>(
              key: const ValueKey('warehouse-logistics-method-filter'),
              label: '配送方式',
              value: _logisticsMethodFilter,
              items: const [_allLogisticsMethodFilter, ...logisticsMethods],
              itemLabel: _logisticsMethodFilterLabel,
              onChanged: (value) {
                if (value != null) {
                  setState(() => _logisticsMethodFilter = value);
                  _loadOrders();
                }
              },
            ),
            OutlinedButton.icon(
              key: const ValueKey('warehouse-packing-date-filter'),
              onPressed: _pickOrderDateRange,
              icon: const Icon(Icons.date_range_outlined),
              label: Text(
                _dateFrom == null
                    ? '订单日期'
                    : '${_packingDateLabel(_dateFrom)} 至 '
                        '${_packingDateLabel(_dateTo)}',
              ),
            ),
            FilledButton.icon(
              key: const ValueKey('warehouse-packing-search-button'),
              onPressed: _loading ? null : _loadOrders,
              icon: const Icon(Icons.search_rounded),
              label: const Text('查询'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        const Text(
          '仓库与商品筛选：当前订单接口尚未提供服务端筛选字段；'
          '本页不会只筛选最多 100 条返回结果制造完整列表假象。'
          '部分配货/缺货待配标签来自真实履约字段，但这两类筛选目前也只覆盖接口返回队列。',
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final status in _fulfillmentStatuses)
              FilterChip(
                key: ValueKey('warehouse-packing-filter-$status'),
                selected: _workbenchStatus == status,
                labelStyle: TextStyle(
                  color: WidgetStateColor.resolveWith((_) => foreground),
                ),
                checkmarkColor: foreground,
                label: Text(_fulfillmentStatusLabel(status)),
                onSelected: (_) {
                  setState(() => _workbenchStatus = status);
                  _loadOrders();
                },
              ),
          ],
        ),
      ],
    );
  }

  Future<void> _pickOrderDateRange() async {
    final now = DateTime.now();
    final value = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 1),
      initialDateRange: _dateFrom == null || _dateTo == null
          ? null
          : DateTimeRange(start: _dateFrom!, end: _dateTo!),
    );
    if (value == null) return;
    setState(() {
      _dateFrom = value.start;
      _dateTo = value.end;
    });
    _loadOrders();
  }

  Widget _buildOrderQueue({bool fillAvailable = false}) {
    if (_loading) {
      return const LoadingState(title: '正在加载邮寄订单');
    }
    if (_errorMessage != null) {
      return ErrorState(title: _errorMessage!, onRetry: _loadOrders);
    }
    if (_orders.isEmpty) {
      return EmptyState(
        title: '${_fulfillmentStatusLabel(_workbenchStatus)}暂无邮寄订单',
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
      fillAvailable: fillAvailable,
    );
  }

  Future<void> _showPackingEditor() async {
    if (!mounted) {
      return;
    }

    final availableWidth =
        context.size?.width ?? MediaQuery.sizeOf(context).width;
    if (isDesktopWidth(availableWidth)) {
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

            return InventoryKeyboardSafeSheet(
              heightFactor: .92,
              onEscape: _saving ? null : closeEditor,
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
                child: _buildPackingEditorContent(
                  showHeader: true,
                  onCancel: _saving ? null : closeEditor,
                  closeEditor: closeEditor,
                  refreshEditor: refreshEditor,
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

            return PopScope<void>(
              canPop: !_saving,
              child: InventoryKeyboardScope(
                onEscape: _saving ? null : closeEditor,
                child: AlertDialog(
                  title: Row(
                    children: [
                      const Expanded(child: Text('订单核对/打包处理')),
                      if (_selectedOrder != null)
                        StatusTag(
                          label: _packingStatusLabel(
                              _selectedOrder!.packingStatus),
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
          title: '商品需求与配货',
          trailing: StatusTag(
            label: _fulfillmentStatusLabel(_fulfillmentStatus(order)),
            tone: _fulfillmentTone(_fulfillmentStatus(order)),
          ),
          children: [
            for (final item in order.items)
              _buildFulfillmentLine(item, order, refreshEditor),
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
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
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

  Widget _buildFulfillmentLine(
    SalesOrderItemRecord item,
    SalesOrderRecord order,
    VoidCallback refreshEditor,
  ) {
    final fulfillment = item.fulfillment;
    final serialized = _isSerializedItem(item);
    final lineKey = item.inventoryLineKey;
    final selected = lineKey == null
        ? const <SerializedUnitSelection>[]
        : _serializedSelections[lineKey] ?? const [];
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              spacing: 8,
              runSpacing: 8,
              children: [
                Text(
                  '${item.productName} · 需求 '
                  '${fulfillment?.requestedQty ?? item.quantity} 瓶',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                StatusTag(
                  label: serialized ? '逐瓶配货' : '普通商品自动出库',
                  tone: serialized ? StatusTone.info : StatusTone.neutral,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 16,
              runSpacing: 6,
              children: [
                Text('已占用：${fulfillment == null ? '暂未提供' : '暂未提供'}'),
                Text('已分配：${fulfillment?.assignedQty ?? 0} 瓶'),
                Text('已出库：${fulfillment?.outboundQty ?? 0} 瓶'),
                Text('待配：${fulfillment?.unassignedQty ?? '暂未提供'}'
                    '${fulfillment == null ? '' : ' 瓶'}'),
              ],
            ),
            if (fulfillment == null)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('订单接口未返回该商品的履约数量字段，不能在客户端猜算。'),
              ),
            if (!serialized)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('无需手工调整库存；确认已打包后由后端库存事件出库。'),
              ),
            if (serialized) ...[
              const SizedBox(height: 8),
              if (order.fulfillmentWarehouseId == null ||
                  item.productId == null ||
                  lineKey == null ||
                  fulfillment == null)
                const StatusTag(
                  label: '逐瓶配货信息不完整，等待接口',
                  tone: StatusTone.danger,
                )
              else
                OutlinedButton.icon(
                  key: ValueKey('warehouse-packing-pick-units-$lineKey'),
                  onPressed: !_canEditPacking || _saving
                      ? null
                      : () => _pickSerializedUnits(
                            order: order,
                            item: item,
                            refreshEditor: refreshEditor,
                          ),
                  icon: const Icon(Icons.qr_code_scanner_rounded),
                  label: Text(
                    '选择物流码（已选 ${selected.length} / '
                    '${fulfillment.requestedQty - fulfillment.outboundQty} 瓶）',
                  ),
                ),
              if (selected.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final unit in selected)
                        Text(
                          '${unit.moutaiName} · ${unit.factoryDate} · '
                          '${unit.productionBatch} · ${unit.batchSerialNo} · '
                          '物流码 ${unit.logisticsCode}',
                        ),
                    ],
                  ),
                ),
              if (fulfillment != null &&
                  selected.length <
                      fulfillment.requestedQty - fulfillment.outboundQty)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: StatusTag(
                    label: '缺货待配：不会创建假物流码',
                    tone: StatusTone.warning,
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _pickSerializedUnits({
    required SalesOrderRecord order,
    required SalesOrderItemRecord item,
    required VoidCallback refreshEditor,
  }) async {
    final identityRevision = _identityRevision;
    final warehouseId = order.fulfillmentWarehouseId;
    final productId = item.productId;
    final lineKey = item.inventoryLineKey;
    final fulfillment = item.fulfillment;
    if (warehouseId == null ||
        productId == null ||
        lineKey == null ||
        fulfillment == null) {
      return;
    }
    final current = _serializedSelections[lineKey] ?? const [];
    final selected = await showDialog<List<SerializedUnitSelection>>(
      context: context,
      builder: (context) => SerializedInventoryPickerDialog(
        businessApi: _businessApi,
        productId: productId,
        warehouseId: warehouseId,
        initialUnits: current,
      ),
    );
    if (selected == null || !mounted || identityRevision != _identityRevision) {
      return;
    }
    final maximum = fulfillment.requestedQty - fulfillment.outboundQty;
    if (selected.length > maximum) {
      setState(() => _formErrorMessage = '已选瓶数不能超过剩余需求 $maximum 瓶。');
      refreshEditor();
      return;
    }
    setState(() {
      _serializedSelections[lineKey] = selected;
      _formErrorMessage = null;
    });
    refreshEditor();
  }

  bool _isSerializedItem(SalesOrderItemRecord item) {
    final productId = item.productId;
    if (productId != null && _productTrackingModes[productId] == 'serialized') {
      return true;
    }
    return item.fulfillment?.units.isNotEmpty == true ||
        item.serializedUnits.isNotEmpty;
  }
}

class _WarehouseOrderList extends StatelessWidget {
  const _WarehouseOrderList({
    required this.orders,
    required this.selectedId,
    required this.onSelected,
    this.fillAvailable = false,
  });

  final List<SalesOrderRecord> orders;
  final String? selectedId;
  final ValueChanged<SalesOrderRecord> onSelected;
  final bool fillAvailable;

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
          if (fillAvailable)
            Expanded(child: _list(context))
          else
            _list(context),
        ],
      ),
    );
  }

  Widget _list(BuildContext context) {
    return ListView.separated(
      shrinkWrap: !fillAvailable,
      physics: fillAvailable
          ? const AlwaysScrollableScrollPhysics()
          : const NeverScrollableScrollPhysics(),
      itemCount: orders.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final order = orders[index];
        final selected = selectedId == order.id;
        final fulfillmentStatus = _fulfillmentStatus(order);
        final abnormal = fulfillmentStatus == _fulfillmentAbnormal;
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
              : Theme.of(context).colorScheme.primary.withValues(alpha: 0.08),
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
                label: _fulfillmentStatusLabel(fulfillmentStatus),
                tone: _fulfillmentTone(fulfillmentStatus),
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
                Text(
                  '履约仓 ${_display(order.fulfillmentWarehouseName)}',
                ),
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
    final fulfillment = order.items
        .map((item) => item.fulfillment)
        .whereType<SalesOrderItemFulfillmentRecord>()
        .toList();
    final pendingQuantity = fulfillment.isEmpty
        ? null
        : fulfillment.fold<int>(
            0,
            (total, value) => total + value.unassignedQty,
          );
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
              label: '配送方式',
              value: _display(order.logisticsMethod),
            ),
            _InfoRow(
              label: '履约仓库',
              value: warehouseLabel,
            ),
            _InfoRow(
              label: '待配数量',
              value: pendingQuantity == null ? '暂未提供' : '$pendingQuantity 瓶',
            ),
            const _InfoRow(label: '已占用', value: '暂未提供'),
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
const _packingWideBreakpoint = 900.0;
const _fulfillmentWaiting = 'pending';
const _fulfillmentPartial = 'partial';
const _fulfillmentShortage = 'shortage';
const _fulfillmentPacking = 'packing';
const _fulfillmentPacked = 'packed';
const _fulfillmentAbnormal = 'abnormal';
const _fulfillmentStatuses = [
  _fulfillmentWaiting,
  _fulfillmentPartial,
  _fulfillmentShortage,
  _fulfillmentPacking,
  _fulfillmentPacked,
  _fulfillmentAbnormal,
];

String _fulfillmentStatus(SalesOrderRecord order) {
  if (order.packingStatus == PackingStatus.packed.value) {
    return _fulfillmentPacked;
  }
  if (order.packingStatus == PackingStatus.abnormal.value) {
    return _fulfillmentAbnormal;
  }
  if (order.packingStatus == PackingStatus.packing.value) {
    return _fulfillmentPacking;
  }
  if (order.shippingRiskWarnings.any(
    (warning) => warning.code == 'INVENTORY_SHORTAGE',
  )) {
    return _fulfillmentShortage;
  }
  final fulfillment = order.items
      .map((item) => item.fulfillment)
      .whereType<SalesOrderItemFulfillmentRecord>();
  final hasPartial = fulfillment.any(
    (value) =>
        value.unassignedQty > 0 &&
        (value.assignedQty > 0 || value.outboundQty > 0),
  );
  return hasPartial ? _fulfillmentPartial : _fulfillmentWaiting;
}

bool _matchesWorkbenchStatus(SalesOrderRecord order, String status) {
  return _fulfillmentStatus(order) == status;
}

String _fulfillmentStatusLabel(String status) {
  return switch (status) {
    _fulfillmentPartial => '部分配货',
    _fulfillmentShortage => '缺货待配',
    _fulfillmentPacking => '打包中',
    _fulfillmentPacked => '已打包',
    _fulfillmentAbnormal => '异常',
    _ => '待配货',
  };
}

StatusTone _fulfillmentTone(String status) {
  return switch (status) {
    _fulfillmentPartial || _fulfillmentPacking => StatusTone.info,
    _fulfillmentPacked => StatusTone.success,
    _fulfillmentShortage => StatusTone.warning,
    _fulfillmentAbnormal => StatusTone.danger,
    _ => StatusTone.warning,
  };
}

String _packingDateLabel(DateTime? value) {
  if (value == null) return '—';
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  return '${value.year}-$month-$day';
}

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
  return inventoryDisplayText(value);
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
    return switch (error.code) {
      'SALES_ORDER_ALREADY_OUTBOUND' => '订单已经出库，请刷新查看最新状态。',
      'INVENTORY_UNIT_UNAVAILABLE' => '所选瓶码已被并发占用、不属于当前履约仓，或资料/成本不完整，请重新选择。',
      'SERIALIZED_ASSIGNMENT_EXCEEDS_REQUESTED' => '已选瓶数超过订单未分配需求。',
      'SERIALIZED_ASSIGNMENT_LINE_DUPLICATE' => '同一订单商品不能重复提交逐瓶配货。',
      'SERIALIZED_ASSIGNMENT_UNIT_DUPLICATE' => '同一物流码不能重复选择。',
      'INVENTORY_CONCURRENT_UPDATE' => '库存状态已变化，已重新拉取真实订单状态。',
      'INVENTORY_INSUFFICIENT_AVAILABLE' => '当前履约仓库存不足，订单保持缺货待配。',
      'PERMISSION_DENIED' || 'FIELD_PERMISSION_DENIED' => '当前角色没有此操作权限。',
      _ => inventoryErrorMessage(error),
    };
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
