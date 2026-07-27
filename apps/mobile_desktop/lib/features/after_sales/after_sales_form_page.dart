import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../core/business/inventory_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';

typedef AfterSalesRefundProofFilePicker = Future<List<ApiMultipartFile>>
    Function();

class AfterSalesFormPage extends StatefulWidget {
  const AfterSalesFormPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    this.filePicker,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final AfterSalesRefundProofFilePicker? filePicker;

  @override
  State<AfterSalesFormPage> createState() => _AfterSalesFormPageState();
}

class _AfterSalesFormPageState extends State<AfterSalesFormPage> {
  late BusinessApi _businessApi;
  late InventoryApi _inventoryApi;
  final TextEditingController _queryController = TextEditingController();
  final GlobalKey<FormState> _afterSalesFormKey = GlobalKey<FormState>();
  final TextEditingController _descriptionController = TextEditingController();
  final TextEditingController _resolutionController = TextEditingController();
  final TextEditingController _refundAmountController =
      TextEditingController(text: '0');
  final TextEditingController _notesController = TextEditingController();
  final List<_AfterSalesDraftItem> _draftItems = <_AfterSalesDraftItem>[];
  String? _draftProductId;

  bool _loading = false;
  bool _searched = false;
  bool _historyLoading = false;
  bool _savingAfterSales = false;
  bool _statusUpdating = false;
  bool _todoLoading = false;
  bool _unfinishedLoading = false;
  String? _errorMessage;
  String? _historyErrorMessage;
  String? _formErrorMessage;
  String? _statusErrorMessage;
  String? _todoErrorMessage;
  String? _unfinishedErrorMessage;
  String? _createdAfterSalesNo;
  List<SalesOrderRecord> _orders = const <SalesOrderRecord>[];
  List<AfterSalesOrderRecord> _afterSalesHistory =
      const <AfterSalesOrderRecord>[];
  List<AfterSalesOrderRecord> _roleTodos = const <AfterSalesOrderRecord>[];
  List<AfterSalesOrderRecord> _unfinishedOrders =
      const <AfterSalesOrderRecord>[];
  final Set<String> _warehouseConfirmingIds = <String>{};
  final Set<String> _financeUploadingIds = <String>{};
  SalesOrderRecord? _selectedOrder;
  AfterSalesOrderRecord? _selectedAfterSales;
  String _issueType = _issueTypeOptions.first.value;
  String _actionType = _actionTypeOptions.first.value;
  String _status = _afterSalesStatusOptions.first.value;

  bool get _canManageAfterSales =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.afterSales;

  bool get _isWarehouseWorkflow => widget.role == UserRole.warehouse;

  bool get _isFinanceWorkflow => widget.role == UserRole.finance;

  bool get _usesTodoWorkflow => _isWarehouseWorkflow || _isFinanceWorkflow;

  bool get _usesUnfinishedWorkflow => _canManageAfterSales;

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
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadInitialWorkflow());
  }

  @override
  void didUpdateWidget(covariant AfterSalesFormPage oldWidget) {
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
    }
    if (oldWidget.role != widget.role ||
        oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      WidgetsBinding.instance
          .addPostFrameCallback((_) => _loadInitialWorkflow());
    }
  }

  void _loadInitialWorkflow() {
    if (!mounted) {
      return;
    }
    if (_usesTodoWorkflow) {
      _loadRoleTodos();
      return;
    }
    if (_usesUnfinishedWorkflow) {
      _loadUnfinishedOrders();
    }
  }

  @override
  void dispose() {
    _queryController.dispose();
    _descriptionController.dispose();
    _resolutionController.dispose();
    _refundAmountController.dispose();
    _notesController.dispose();
    for (final item in _draftItems) {
      item.dispose();
    }
    super.dispose();
  }

  Future<void> _searchOrders() async {
    final query = _queryController.text.trim();
    if (query.isEmpty) {
      setState(() {
        _searched = true;
        _orders = const <SalesOrderRecord>[];
        _selectedOrder = null;
        _afterSalesHistory = const <AfterSalesOrderRecord>[];
        _selectedAfterSales = null;
        _historyErrorMessage = null;
        _formErrorMessage = null;
        _statusErrorMessage = null;
        _createdAfterSalesNo = null;
        _errorMessage = null;
      });
      return;
    }

    setState(() {
      _loading = true;
      _searched = true;
      _errorMessage = null;
    });

    try {
      final orders = await _businessApi.listSalesOrders(
        query: query,
        limit: 50,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _orders = orders;
        if (!orders.any((order) => order.id == _selectedOrder?.id)) {
          _selectedOrder = null;
          _afterSalesHistory = const <AfterSalesOrderRecord>[];
          _selectedAfterSales = null;
          _historyErrorMessage = null;
          _formErrorMessage = null;
          _statusErrorMessage = null;
          _createdAfterSalesNo = null;
        }
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _selectOrder(SalesOrderRecord order) async {
    setState(() {
      _selectedOrder = order;
      _selectedAfterSales = null;
      _createdAfterSalesNo = null;
      _formErrorMessage = null;
      _statusErrorMessage = null;
    });
    _resetAfterSalesDraft();
    await _loadAfterSalesHistory();
  }

  void _resetAfterSalesDraft() {
    _afterSalesFormKey.currentState?.reset();
    _descriptionController.clear();
    _resolutionController.clear();
    _refundAmountController.text = '0';
    _notesController.clear();
    for (final item in _draftItems) {
      item.dispose();
    }
    _draftItems.clear();
    _draftProductId = null;
    setState(() {
      _issueType = _issueTypeOptions.first.value;
      _actionType = _actionTypeOptions.first.value;
      _status = _afterSalesStatusOptions.first.value;
    });
  }

  int _afterSalesQuantityFor(String sourceSalesOrderItemId) {
    var quantity = 0;
    for (final order in _afterSalesHistory) {
      for (final item in order.items) {
        if (item.sourceSalesOrderItemId == sourceSalesOrderItemId) {
          quantity += item.quantity;
        }
      }
    }
    return quantity;
  }

  int _remainingQuantityFor(SalesOrderItemRecord sourceItem) {
    return sourceItem.quantity - _afterSalesQuantityFor(sourceItem.id ?? '');
  }

  void _addDraftItem(String? sourceSalesOrderItemId) {
    final order = _selectedOrder;
    if (order == null || sourceSalesOrderItemId == null) {
      return;
    }
    SalesOrderItemRecord? sourceItem;
    for (final item in order.items) {
      if (item.id == sourceSalesOrderItemId) {
        sourceItem = item;
        break;
      }
    }
    if (sourceItem == null ||
        _draftItems.any(
          (item) => item.sourceItem.id == sourceSalesOrderItemId,
        )) {
      return;
    }
    final selectedSourceItem = sourceItem;
    final remaining = _remainingQuantityFor(selectedSourceItem);
    if (remaining <= 0) {
      setState(() => _formErrorMessage = '该商品已无可售后数量。');
      return;
    }
    setState(() {
      _draftItems.add(_AfterSalesDraftItem(selectedSourceItem));
      _draftProductId = null;
      _formErrorMessage = null;
      _syncRefundAmount();
    });
  }

  void _removeDraftItem(_AfterSalesDraftItem item) {
    setState(() {
      _draftItems.remove(item);
      item.dispose();
      _syncRefundAmount();
    });
  }

  void _syncRefundAmount() {
    final total = _draftItems.fold<int>(
      0,
      (sum, item) => sum + (item.totalPriceCents ?? 0),
    );
    _refundAmountController.text = (total / 100).toStringAsFixed(2);
  }

  Future<void> _loadAfterSalesHistory({
    String? preserveSelectedId,
    AfterSalesOrderRecord? fallbackSelected,
  }) async {
    final order = _selectedOrder;
    if (order == null) {
      setState(() {
        _afterSalesHistory = const <AfterSalesOrderRecord>[];
        _selectedAfterSales = null;
        _historyErrorMessage = null;
      });
      return;
    }

    setState(() {
      _historyLoading = true;
      _historyErrorMessage = null;
    });
    try {
      final history = await _businessApi.listAfterSalesOrders(
        salesOrderId: order.id,
        limit: 50,
      );
      if (!mounted) {
        return;
      }
      final selectedId = preserveSelectedId ?? _selectedAfterSales?.id;
      setState(() {
        _afterSalesHistory = history;
        _selectedAfterSales =
            _selectedAfterSalesFrom(history, selectedId) ?? fallbackSelected;
        _historyLoading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _afterSalesHistory = const <AfterSalesOrderRecord>[];
        _selectedAfterSales = fallbackSelected;
        _historyLoading = false;
        _historyErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _saveAfterSalesOrder() async {
    final order = _selectedOrder;
    if (!_canManageAfterSales) {
      setState(() => _formErrorMessage = '当前角色只能查看售后记录。');
      return;
    }
    if (order == null || _savingAfterSales) {
      return;
    }
    if (!(_afterSalesFormKey.currentState?.validate() ?? false)) {
      return;
    }
    if (_actionType != 'record_only' && _draftItems.isEmpty) {
      setState(() => _formErrorMessage = '当前售后类型必须至少添加一项原订单商品。');
      return;
    }
    final submittedItems = <Map<String, dynamic>>[];
    for (final item in _draftItems) {
      final quantity = item.quantity;
      final totalPriceCents = item.totalPriceCents;
      final remaining = _remainingQuantityFor(item.sourceItem);
      if (quantity == null || quantity <= 0 || quantity > remaining) {
        setState(
          () => _formErrorMessage =
              '${item.sourceItem.productName} 的本次数量必须为 1 至 $remaining。',
        );
        return;
      }
      if (totalPriceCents == null || totalPriceCents < 0) {
        setState(
          () =>
              _formErrorMessage = '${item.sourceItem.productName} 的本次总价格格式不正确。',
        );
        return;
      }
      submittedItems.add({
        'sourceSalesOrderItemId': item.sourceItem.id,
        'quantity': quantity,
        'totalPriceCents': totalPriceCents,
      });
    }
    _syncRefundAmount();
    final refundAmountCents =
        _refundYuanToCents(_refundAmountController.text.trim());
    if (refundAmountCents == null) {
      setState(() => _formErrorMessage = '退款金额格式不正确，请输入最多两位小数的元金额。');
      return;
    }

    setState(() {
      _savingAfterSales = true;
      _formErrorMessage = null;
      _createdAfterSalesNo = null;
    });
    try {
      final created = await _businessApi.createAfterSalesOrder({
        'sourceSalesOrderId': order.id,
        'issueType': _issueType,
        'actionType': _actionType,
        'description': _descriptionController.text.trim(),
        'resolution': _resolutionController.text.trim(),
        'refundAmountCents': refundAmountCents,
        'status': _status,
        'notes': _notesController.text.trim(),
        'items': submittedItems,
      });
      if (!mounted) {
        return;
      }
      setState(() {
        _createdAfterSalesNo = created.afterSalesNo;
        _selectedAfterSales = created;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '售后单 ${created.afterSalesNo} 已创建。'
            '积分表已标记售后影响，退款将在财务确认后正式扣减。',
          ),
        ),
      );
      _resetAfterSalesDraft();
      await _loadAfterSalesHistory(preserveSelectedId: created.id);
      await _refreshSelectedOrder();
      await _loadUnfinishedOrders();
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _formErrorMessage = _messageForError(error);
      });
    } finally {
      if (mounted) {
        setState(() => _savingAfterSales = false);
      }
    }
  }

  void _selectAfterSales(AfterSalesOrderRecord record) {
    setState(() {
      _selectedAfterSales = record;
      _statusErrorMessage = null;
    });
  }

  Future<void> _updateAfterSalesStatus(String status) async {
    final record = _selectedAfterSales;
    if (!_canManageAfterSales) {
      setState(() => _statusErrorMessage = '当前角色只能查看售后记录。');
      return;
    }
    if (record == null || _statusUpdating) {
      return;
    }
    if (status == 'completed' &&
        (record.resolution?.trim().isNotEmpty != true) &&
        (record.notes?.trim().isNotEmpty != true)) {
      setState(() {
        _statusErrorMessage = '已完成状态需要处理方案或备注。';
      });
      return;
    }

    setState(() {
      _statusUpdating = true;
      _statusErrorMessage = null;
    });
    try {
      final updated = await _businessApi.updateAfterSalesOrderStatus(
        record.id,
        {'status': status},
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _selectedAfterSales = updated;
        _unfinishedOrders = status == 'completed'
            ? _unfinishedOrders.where((item) => item.id != updated.id).toList()
            : [
                for (final item in _unfinishedOrders)
                  if (item.id == updated.id) updated else item,
              ];
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${updated.afterSalesNo} 已更新为 ${_afterSalesStatusLabel(updated.status)}。',
          ),
        ),
      );
      await _loadAfterSalesHistory(preserveSelectedId: updated.id);
      await _refreshSelectedOrder();
      await _loadUnfinishedOrders();
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _statusErrorMessage = _messageForError(error);
      });
    } finally {
      if (mounted) {
        setState(() => _statusUpdating = false);
      }
    }
  }

  Future<void> _refreshSelectedOrder() async {
    final order = _selectedOrder;
    if (order == null) {
      return;
    }
    try {
      final updated = await _businessApi.getSalesOrder(order.id);
      if (!mounted) {
        return;
      }
      setState(() {
        _selectedOrder = updated;
        _orders = [
          for (final item in _orders)
            if (item.id == updated.id) updated else item,
        ];
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _statusErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _loadUnfinishedOrders() async {
    if (!_usesUnfinishedWorkflow) {
      return;
    }
    setState(() {
      _unfinishedLoading = true;
      _unfinishedErrorMessage = null;
    });
    try {
      final records = await _businessApi.listAfterSalesOrders(
        unfinished: true,
        limit: 200,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _unfinishedOrders =
            records.where((record) => record.status != 'completed').toList();
        _unfinishedLoading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _unfinishedOrders = const <AfterSalesOrderRecord>[];
        _unfinishedLoading = false;
        _unfinishedErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _selectUnfinishedOrder(
    AfterSalesOrderRecord record,
  ) async {
    try {
      final order = record.salesOrder ??
          await _businessApi.getSalesOrder(record.salesOrderId);
      if (!mounted) {
        return;
      }
      setState(() {
        _selectedOrder = order;
        _selectedAfterSales = record;
        _createdAfterSalesNo = null;
        _formErrorMessage = null;
        _statusErrorMessage = null;
        _unfinishedErrorMessage = null;
        if (!_orders.any((item) => item.id == order.id)) {
          _orders = [order, ..._orders];
        }
      });
      _resetAfterSalesDraft();
      await _loadAfterSalesHistory(
        preserveSelectedId: record.id,
        fallbackSelected: record,
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _unfinishedErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _loadRoleTodos() async {
    if (!_usesTodoWorkflow) {
      return;
    }
    setState(() {
      _todoLoading = true;
      _todoErrorMessage = null;
    });
    try {
      final records = await _businessApi.listAfterSalesOrders(
        status: _isFinanceWorkflow ? 'waiting_refund' : null,
        financeConfirmed: _isFinanceWorkflow ? false : null,
        limit: 100,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _roleTodos = records.where((record) {
          if (_isWarehouseWorkflow) {
            return record.status == 'waiting_receive' ||
                record.status == 'waiting_resend';
          }
          return record.status == 'waiting_refund' &&
              !record.financeConfirmed &&
              record.refundAmountCents > 0;
        }).toList();
        _todoLoading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _roleTodos = const <AfterSalesOrderRecord>[];
        _todoLoading = false;
        _todoErrorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _confirmWarehouseTodo(AfterSalesOrderRecord record) async {
    if (_warehouseConfirmingIds.contains(record.id)) {
      return;
    }
    setState(() {
      _warehouseConfirmingIds.add(record.id);
      _todoErrorMessage = null;
    });
    try {
      final updated = await _businessApi.confirmAfterSalesWarehouse(record.id);
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${updated.afterSalesNo} 仓库已确认')),
      );
      await _loadRoleTodos();
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _todoErrorMessage = _messageForError(error);
      });
    } finally {
      if (mounted) {
        setState(() {
          _warehouseConfirmingIds.remove(record.id);
        });
      }
    }
  }

  Future<void> _confirmFinanceRefundTodo(AfterSalesOrderRecord record) async {
    if (_financeUploadingIds.contains(record.id)) {
      return;
    }
    try {
      final picker = widget.filePicker;
      final files = picker == null
          ? await _pickRefundProofFilesFromDevice()
          : await picker();
      if (!mounted || files.isEmpty) {
        return;
      }
      setState(() {
        _financeUploadingIds.add(record.id);
        _todoErrorMessage = null;
      });
      final updated = await _businessApi.confirmAfterSalesFinanceRefund(
        record.id,
        files: files,
      );
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${updated.afterSalesNo} 已退款')),
      );
      await _loadRoleTodos();
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _todoErrorMessage = _messageForError(error);
      });
    } finally {
      if (mounted) {
        setState(() {
          _financeUploadingIds.remove(record.id);
        });
      }
    }
  }

  Future<List<ApiMultipartFile>> _pickRefundProofFilesFromDevice() async {
    final result = await FilePicker.pickFiles(
      allowMultiple: true,
      type: FileType.custom,
      allowedExtensions: const [
        'jpg',
        'jpeg',
        'png',
        'gif',
        'webp',
        'bmp',
        'tif',
        'tiff',
        'avif',
        'pdf',
      ],
    );
    return result?.files.map(ApiMultipartFile.fromPlatformFile).toList() ??
        const <ApiMultipartFile>[];
  }

  @override
  Widget build(BuildContext context) {
    if (_isWarehouseWorkflow) {
      return _buildWarehouseWorkflow();
    }
    if (_isFinanceWorkflow) {
      return _buildFinanceWorkflow();
    }
    return _buildAfterSalesWorkflow();
  }

  Widget _buildAfterSalesWorkflow() {
    return ResponsivePage(
      children: [
        if (_usesUnfinishedWorkflow) ...[
          FormSection(
            title: '未完成售后单',
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                StatusTag(
                  label: _unfinishedLoading
                      ? '加载中'
                      : '${_unfinishedOrders.length} 笔',
                  tone:
                      _unfinishedLoading ? StatusTone.warning : StatusTone.info,
                ),
                const SizedBox(width: 8),
                IconButton(
                  key: const ValueKey('after-sales-unfinished-refresh-button'),
                  tooltip: '刷新未完成售后单',
                  onPressed: _unfinishedLoading ? null : _loadUnfinishedOrders,
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
            children: [
              _buildUnfinishedOrders(),
            ],
          ),
          const SizedBox(height: 16),
        ],
        ResponsiveTwoColumn(
          primary: FormSection(
            title: '订单定位',
            trailing: StatusTag(
              label: _loading ? '搜索中' : '${_orders.length} 笔',
              tone: _loading ? StatusTone.warning : StatusTone.info,
            ),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: TextField(
                      key: const ValueKey('after-sales-order-search-field'),
                      controller: _queryController,
                      onSubmitted: (_) => _searchOrders(),
                      decoration: const InputDecoration(
                        prefixIcon: Icon(Icons.search_rounded),
                        hintText: '按姓名、电话、订单号搜索',
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  FilledButton.icon(
                    key: const ValueKey('after-sales-order-search-button'),
                    onPressed: _loading ? null : _searchOrders,
                    icon: const Icon(Icons.search_rounded),
                    label: const Text('搜索'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _buildSearchResults(),
            ],
          ),
          secondary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              FormSection(
                title: '关联订单信息',
                trailing: _selectedOrder == null
                    ? null
                    : StatusTag(
                        label: _statusLabel(_selectedOrder!.status),
                        tone: _statusTone(_selectedOrder!.status),
                      ),
                children: [
                  _buildSelectedOrder(),
                ],
              ),
              if (_selectedOrder != null) ...[
                if (_canManageAfterSales) ...[
                  const SizedBox(height: 16),
                  FormSection(
                    title: '创建售后单',
                    trailing: _createdAfterSalesNo == null
                        ? null
                        : StatusTag(
                            label: _createdAfterSalesNo!,
                            tone: StatusTone.success,
                          ),
                    children: [
                      _buildAfterSalesForm(),
                    ],
                  ),
                ],
                const SizedBox(height: 16),
                FormSection(
                  title: '售后历史',
                  trailing: StatusTag(
                    label: _historyLoading
                        ? '刷新中'
                        : '${_afterSalesHistory.length} 笔',
                    tone:
                        _historyLoading ? StatusTone.warning : StatusTone.info,
                  ),
                  children: [
                    _buildAfterSalesHistory(),
                  ],
                ),
                if (_selectedAfterSales != null) ...[
                  const SizedBox(height: 16),
                  FormSection(
                    title: '售后详情',
                    trailing: StatusTag(
                      label:
                          _afterSalesStatusLabel(_selectedAfterSales!.status),
                      tone: _afterSalesStatusTone(_selectedAfterSales!.status),
                    ),
                    children: [
                      _buildAfterSalesDetail(_selectedAfterSales!),
                    ],
                  ),
                ],
                if (_selectedAfterSales != null &&
                    _canManageAfterSales &&
                    _isWarehouseWorkflow == false) ...[
                  const SizedBox(height: 16),
                  _AfterSalesReceiptSection(
                    key: ValueKey(
                      'after-sales-receipt-section-${_selectedAfterSales!.id}',
                    ),
                    afterSalesOrder: _selectedAfterSales!,
                    inventoryApi: _inventoryApi,
                    businessApi: _businessApi,
                    onSubmitted: () {
                      _loadAfterSalesHistory(
                        preserveSelectedId: _selectedAfterSales?.id,
                      );
                    },
                  ),
                ],
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildUnfinishedOrders() {
    if (_unfinishedLoading) {
      return const LoadingState(title: '正在加载未完成售后单');
    }
    if (_unfinishedErrorMessage != null) {
      return ErrorState(
        title: _unfinishedErrorMessage!,
        onRetry: _loadUnfinishedOrders,
      );
    }
    if (_unfinishedOrders.isEmpty) {
      return const EmptyState(title: '暂无未完成售后单');
    }

    return AppRecordList(
      compact: true,
      items: [
        for (final record in _unfinishedOrders)
          AppRecordItem(
            title: record.afterSalesNo,
            subtitle:
                '关联订单 ${record.salesOrder?.orderNo ?? record.salesOrderId}',
            meta: [
              '客户 ${record.salesOrder?.customerName ?? record.customer?.name ?? '未填写'}',
              '问题 ${_issueTypeLabel(record.issueType)}',
              '处理 ${_actionTypeLabel(record.actionType)}',
              '状态 ${_afterSalesStatusLabel(record.status)}',
              '退款 ${formatMoneyCents(record.refundAmountCents)}',
              '创建 ${_dateTimeLabel(record.createdAt)}',
            ],
            icon: Icons.pending_actions_rounded,
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => _selectUnfinishedOrder(record),
          ),
      ],
    );
  }

  Widget _buildWarehouseWorkflow() {
    return ResponsivePage(
      children: [
        FormSection(
          title: '仓库售后待办',
          trailing: StatusTag(
            label: _todoLoading ? '刷新中' : '${_roleTodos.length} 笔',
            tone: _todoLoading ? StatusTone.warning : StatusTone.info,
          ),
          children: [
            _buildRoleTodoList(),
          ],
        ),
      ],
    );
  }

  Widget _buildFinanceWorkflow() {
    return ResponsivePage(
      children: [
        FormSection(
          title: '财务退款待办',
          trailing: StatusTag(
            label: _todoLoading ? '刷新中' : '${_roleTodos.length} 笔',
            tone: _todoLoading ? StatusTone.warning : StatusTone.info,
          ),
          children: [
            _buildRoleTodoList(),
          ],
        ),
      ],
    );
  }

  Widget _buildRoleTodoList() {
    if (_todoLoading) {
      return LoadingState(
          title: _isWarehouseWorkflow ? '正在加载仓库待办' : '正在加载退款待办');
    }
    if (_todoErrorMessage != null) {
      return ErrorState(title: _todoErrorMessage!, onRetry: _loadRoleTodos);
    }
    if (_roleTodos.isEmpty) {
      return EmptyState(title: _isWarehouseWorkflow ? '暂无待确认售后单' : '暂无待退款售后单');
    }

    return AppRecordList(
      items: [
        for (final record in _roleTodos)
          AppRecordItem(
            title: record.afterSalesNo,
            subtitle: record.salesOrder?.orderNo ?? record.description,
            meta: [
              _issueTypeLabel(record.issueType),
              _actionTypeLabel(record.actionType),
              _afterSalesStatusLabel(record.status),
              '退款 ${formatMoneyCents(record.refundAmountCents)}',
              if (record.salesOrder?.customerName.trim().isNotEmpty == true)
                record.salesOrder!.customerName,
            ],
            icon: _isWarehouseWorkflow
                ? Icons.inventory_2_rounded
                : Icons.account_balance_wallet_rounded,
            trailing: _isWarehouseWorkflow
                ? FilledButton.icon(
                    key: ValueKey('after-sales-warehouse-confirm-${record.id}'),
                    onPressed: _warehouseConfirmingIds.contains(record.id)
                        ? null
                        : () => _confirmWarehouseTodo(record),
                    icon: const Icon(Icons.check_rounded),
                    label: Text(
                        record.status == 'waiting_receive' ? '已收货' : '已补发'),
                  )
                : FilledButton.icon(
                    key: ValueKey(
                        'after-sales-finance-refund-confirm-${record.id}'),
                    onPressed: _financeUploadingIds.contains(record.id)
                        ? null
                        : () => _confirmFinanceRefundTodo(record),
                    icon: const Icon(Icons.upload_file_rounded),
                    label: const Text('已退款'),
                  ),
            onTap: () => _selectAfterSales(record),
          ),
      ],
    );
  }

  Widget _buildSearchResults() {
    if (_loading) {
      return const LoadingState(title: '正在搜索订单');
    }
    if (_errorMessage != null) {
      return ErrorState(title: _errorMessage!, onRetry: _searchOrders);
    }
    if (!_searched) {
      return const EmptyState(title: '输入客户姓名、电话或订单号搜索');
    }
    if (_orders.isEmpty) {
      return const EmptyState(title: '未找到匹配订单');
    }

    return AppRecordList(
      items: [
        for (final order in _orders)
          AppRecordItem(
            title: order.orderNo,
            subtitle:
                '${order.customerName} · ${_fieldValue(order.customerPhone)}',
            meta: [
              '订单金额 ${formatMoneyCents(order.totalAmountCents)}',
              '发货日期 ${_fieldValue(order.shippingDate)}',
              _deliverySummaryLabel(order.deliverySummary),
              if (canViewFinanceMark(widget.role)) _customerMarkLabel(order),
              if (order.travelGroup?.groupNo != null)
                '旅行团 ${order.travelGroup!.groupNo}',
            ],
            icon: Icons.receipt_long_rounded,
            trailing: StatusTag(
              label: _statusLabel(order.status),
              tone: _statusTone(order.status),
            ),
            onTap: () => _selectOrder(order),
          ),
      ],
    );
  }

  Widget _buildSelectedOrder() {
    final order = _selectedOrder;
    if (order == null) {
      return const EmptyState(title: '请选择一笔订单');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _InfoLine(label: '关联订单', value: order.orderNo),
        _InfoLine(
          label: '发货日期',
          value: _fieldValue(order.shippingDate),
        ),
        _InfoLine(label: '客户', value: order.customerName),
        _InfoLine(label: '电话', value: _fieldValue(order.customerPhone)),
        _InfoLine(label: '地址', value: _orderAddress(order)),
        _InfoLine(
          label: '旅行团',
          value: order.travelGroup?.groupNo ??
              order.travelGroup?.travelAgency ??
              '未关联',
        ),
        _InfoLine(
            label: '配送', value: _deliverySummaryLabel(order.deliverySummary)),
        _InfoLine(label: '物流单号', value: _fieldValue(order.logisticsNo)),
        Row(
          children: [
            const Expanded(child: Text('订单金额')),
            MoneyText(cents: order.totalAmountCents),
          ],
        ),
        const SizedBox(height: 12),
        const Divider(height: 1),
        const SizedBox(height: 12),
        Text(
          '订单明细',
          style: Theme.of(context)
              .textTheme
              .titleSmall
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        if (order.items.isEmpty)
          Text('暂无明细', style: Theme.of(context).textTheme.bodySmall)
        else
          for (final item in order.items)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${item.productName} x${item.quantity} · ${formatMoneyCents(item.subtotalCents)} · ${_deliveryTypeLabel(item.deliveryType)}',
                  ),
                  Text(
                    '应退: ${item.quantity} 瓶',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
      ],
    );
  }

  Widget _buildAfterSalesForm() {
    return Form(
      key: _afterSalesFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ResponsiveFormGrid(
            children: [
              DropdownButtonFormField<String>(
                key: const ValueKey('after-sales-issue-type-field'),
                initialValue: _issueType,
                isExpanded: true,
                decoration: const InputDecoration(labelText: '问题类型'),
                items: [
                  for (final option in _issueTypeOptions)
                    DropdownMenuItem(
                      value: option.value,
                      child: Text(option.label),
                    ),
                ],
                validator: _requiredValidator,
                onChanged: _savingAfterSales
                    ? null
                    : (value) {
                        if (value == null) {
                          return;
                        }
                        setState(() => _issueType = value);
                      },
              ),
              DropdownButtonFormField<String>(
                key: const ValueKey('after-sales-action-type-field'),
                initialValue: _actionType,
                isExpanded: true,
                decoration: const InputDecoration(labelText: '处理类型'),
                items: [
                  for (final option in _actionTypeOptions)
                    DropdownMenuItem(
                      value: option.value,
                      child: Text(option.label),
                    ),
                ],
                validator: _requiredValidator,
                onChanged: _savingAfterSales
                    ? null
                    : (value) {
                        if (value == null) {
                          return;
                        }
                        setState(() => _actionType = value);
                      },
              ),
              DropdownButtonFormField<String>(
                key: const ValueKey('after-sales-status-field'),
                initialValue: _status,
                isExpanded: true,
                decoration: const InputDecoration(labelText: '售后状态'),
                items: [
                  for (final option in _afterSalesStatusOptions)
                    DropdownMenuItem(
                      value: option.value,
                      child: Text(option.label),
                    ),
                ],
                validator: _requiredValidator,
                onChanged: _savingAfterSales
                    ? null
                    : (value) {
                        if (value == null) {
                          return;
                        }
                        setState(() => _status = value);
                      },
              ),
              TextFormField(
                key: const ValueKey('after-sales-refund-amount-field'),
                controller: _refundAmountController,
                readOnly: true,
                decoration: const InputDecoration(
                  labelText: '退款总额（由明细自动合计）',
                  suffixText: '元',
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _buildAfterSalesItemEditor(),
          const SizedBox(height: 12),
          TextFormField(
            key: const ValueKey('after-sales-description-field'),
            controller: _descriptionController,
            enabled: !_savingAfterSales,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: '问题描述'),
            validator: _requiredValidator,
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const ValueKey('after-sales-resolution-field'),
            controller: _resolutionController,
            enabled: !_savingAfterSales,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: '处理方案'),
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const ValueKey('after-sales-notes-field'),
            controller: _notesController,
            enabled: !_savingAfterSales,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: '备注'),
          ),
          if (_formErrorMessage != null) ...[
            const SizedBox(height: 12),
            Text(
              _formErrorMessage!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 16),
          SectionActions(
            primaryLabel: _savingAfterSales ? '保存中' : '创建售后单',
            onPrimaryPressed: _savingAfterSales ? null : _saveAfterSalesOrder,
            secondaryLabel: '刷新历史',
            onSecondaryPressed: _historyLoading ? null : _loadAfterSalesHistory,
          ),
        ],
      ),
    );
  }

  Widget _buildAfterSalesItemEditor() {
    final order = _selectedOrder;
    final availableItems = (order?.items ?? const <SalesOrderItemRecord>[])
        .where(
          (item) =>
              item.id != null &&
              _remainingQuantityFor(item) > 0 &&
              !_draftItems.any(
                (draft) => draft.sourceItem.id == item.id,
              ),
        )
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '售后酒品明细',
          style: Theme.of(context)
              .textTheme
              .titleSmall
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          key: ValueKey(
            'after-sales-source-item-picker-${_draftItems.length}',
          ),
          initialValue: _draftProductId,
          isExpanded: true,
          decoration: const InputDecoration(
            labelText: '从原订单添加商品',
            helperText: '仅显示原订单中仍有可售后数量的酒品',
          ),
          items: [
            for (final item in availableItems)
              DropdownMenuItem(
                value: item.id,
                child: Text(
                  '${item.productName}（可售后 ${_remainingQuantityFor(item)}）',
                ),
              ),
          ],
          onChanged: _savingAfterSales || availableItems.isEmpty
              ? null
              : (value) {
                  setState(() => _draftProductId = value);
                  _addDraftItem(value);
                },
        ),
        const SizedBox(height: 10),
        if (_draftItems.isEmpty)
          Text(
            _actionType == 'record_only' ? '仅记录类型可以不添加商品。' : '请添加本次售后的原订单商品。',
            style: Theme.of(context).textTheme.bodySmall,
          )
        else
          for (final item in _draftItems) _buildAfterSalesDraftItemCard(item),
      ],
    );
  }

  Widget _buildAfterSalesDraftItemCard(_AfterSalesDraftItem item) {
    final source = item.sourceItem;
    final usedQuantity = _afterSalesQuantityFor(source.id ?? '');
    final remaining = _remainingQuantityFor(source);
    return Card(
      key: ValueKey('after-sales-draft-item-${source.id}'),
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
                    source.productName,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  tooltip: '删除',
                  onPressed:
                      _savingAfterSales ? null : () => _removeDraftItem(item),
                  icon: const Icon(Icons.delete_outline),
                ),
              ],
            ),
            Wrap(
              spacing: 16,
              runSpacing: 6,
              children: [
                Text('应退: ${source.quantity} 瓶'),
                Text('原订单数量：${source.quantity}'),
                Text('已售后数量：$usedQuantity'),
                Text('本次可售后数量：$remaining'),
                Text(
                  '原成交单价参考：${formatMoneyCents(source.unitPriceCents)}',
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    key: ValueKey('after-sales-item-quantity-${source.id}'),
                    controller: item.quantityController,
                    enabled: !_savingAfterSales,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: '本次数量'),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    key: ValueKey('after-sales-item-total-${source.id}'),
                    controller: item.totalPriceController,
                    enabled: !_savingAfterSales,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: '本次总价格',
                      suffixText: '元',
                    ),
                    onChanged: (_) {
                      setState(_syncRefundAmount);
                    },
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAfterSalesHistory() {
    if (_historyLoading) {
      return const LoadingState(title: '正在刷新售后历史');
    }
    if (_historyErrorMessage != null) {
      return ErrorState(
        title: _historyErrorMessage!,
        onRetry: _loadAfterSalesHistory,
      );
    }
    if (_afterSalesHistory.isEmpty) {
      return const EmptyState(title: '暂无售后历史');
    }

    return AppRecordList(
      compact: true,
      items: [
        for (final record in _afterSalesHistory)
          AppRecordItem(
            title: record.afterSalesNo,
            subtitle: record.description,
            meta: [
              _issueTypeLabel(record.issueType),
              _actionTypeLabel(record.actionType),
              '退款 ${formatMoneyCents(record.refundAmountCents)}',
              record.financeConfirmed ? '财务已确认' : '财务未确认',
              if (record.createdAt != null) _dateTimeLabel(record.createdAt),
            ],
            icon: Icons.support_agent_rounded,
            trailing: StatusTag(
              label: _afterSalesStatusLabel(record.status),
              tone: _afterSalesStatusTone(record.status),
            ),
            onTap: () => _selectAfterSales(record),
          ),
      ],
    );
  }

  Widget _buildAfterSalesDetail(AfterSalesOrderRecord record) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _InfoLine(label: '售后单号', value: record.afterSalesNo),
        _InfoLine(label: '状态', value: _afterSalesStatusLabel(record.status)),
        _InfoLine(label: '问题类型', value: _issueTypeLabel(record.issueType)),
        _InfoLine(label: '处理类型', value: _actionTypeLabel(record.actionType)),
        _InfoLine(
          label: '退款金额',
          value: formatMoneyCents(record.refundAmountCents),
        ),
        _InfoLine(
          label: '财务确认',
          value: record.financeConfirmed
              ? '已确认 ${_dateTimeLabel(record.financeConfirmedAt)}'
              : '未确认',
        ),
        _InfoLine(
          label: '退款截图',
          value: record.refundProofAttachments.isEmpty
              ? '未上传'
              : '${record.refundProofAttachments.length} 张',
        ),
        _InfoLine(
          label: '仓库确认',
          value: record.warehouseConfirmedAt == null
              ? '未确认'
              : '已确认 ${_dateTimeLabel(record.warehouseConfirmedAt)}',
        ),
        _InfoLine(label: '创建时间', value: _dateTimeLabel(record.createdAt)),
        _InfoLine(label: '问题描述', value: record.description),
        _InfoLine(label: '处理方案', value: _fieldValue(record.resolution)),
        _InfoLine(label: '备注', value: _fieldValue(record.notes)),
        if (_canManageAfterSales) ...[
          const SizedBox(height: 8),
          Text(
            '状态流转',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final option in _afterSalesStatusOptions)
                _AfterSalesStatusButton(
                  key: ValueKey('after-sales-status-button-${option.value}'),
                  label: option.value == 'completed' ? '确认完成' : option.label,
                  selected: record.status == option.value,
                  updating: _statusUpdating,
                  onPressed: option.value == 'completed' &&
                          !_canCompleteAfterSales(record)
                      ? null
                      : () => _updateAfterSalesStatus(option.value),
                ),
            ],
          ),
          if (_statusErrorMessage != null) ...[
            const SizedBox(height: 12),
            Text(
              _statusErrorMessage!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ],
    );
  }

  String? _requiredValidator(String? value) {
    if ((value ?? '').trim().isEmpty) {
      return '必填';
    }
    return null;
  }
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 72,
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _AfterSalesStatusButton extends StatelessWidget {
  const _AfterSalesStatusButton({
    super.key,
    required this.label,
    required this.selected,
    required this.updating,
    required this.onPressed,
  });

  final String label;
  final bool selected;
  final bool updating;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    if (selected) {
      return FilledButton.icon(
        onPressed: updating ? null : onPressed,
        icon: const Icon(Icons.check_rounded),
        label: Text(label),
      );
    }
    return OutlinedButton(
      onPressed: updating ? null : onPressed,
      child: Text(label),
    );
  }
}

class _AfterSalesDraftItem {
  _AfterSalesDraftItem(this.sourceItem)
      : quantityController = TextEditingController(text: '1'),
        totalPriceController = TextEditingController(
          text: (sourceItem.unitPriceCents / 100).toStringAsFixed(2),
        );

  final SalesOrderItemRecord sourceItem;
  final TextEditingController quantityController;
  final TextEditingController totalPriceController;

  int? get quantity => int.tryParse(quantityController.text.trim());

  int? get totalPriceCents =>
      _refundYuanToCents(totalPriceController.text.trim());

  void dispose() {
    quantityController.dispose();
    totalPriceController.dispose();
  }
}

class _AfterSalesReceiptSection extends StatefulWidget {
  const _AfterSalesReceiptSection({
    super.key,
    required this.afterSalesOrder,
    required this.inventoryApi,
    required this.businessApi,
    required this.onSubmitted,
  });

  final AfterSalesOrderRecord afterSalesOrder;
  final InventoryApi inventoryApi;
  final BusinessApi businessApi;
  final VoidCallback onSubmitted;

  @override
  State<_AfterSalesReceiptSection> createState() =>
      _AfterSalesReceiptSectionState();
}

class _AfterSalesReceiptSectionState extends State<_AfterSalesReceiptSection> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _quantityController =
      TextEditingController(text: '0');
  final TextEditingController _noteController = TextEditingController();

  List<WarehouseRecord> _warehouses = const <WarehouseRecord>[];
  String? _warehouseId;
  String _condition = _receiptConditionOptions.first.value;
  bool _loading = false;
  bool _submitting = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadWarehouses());
  }

  @override
  void dispose() {
    _quantityController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _loadWarehouses() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final warehouses =
          await widget.inventoryApi.listWarehouses(isActive: true);
      if (!mounted) {
        return;
      }
      setState(() {
        _warehouses = warehouses;
        _warehouseId = _warehouseId ??
            warehouses
                .firstWhere(
                  (warehouse) => warehouse.isDefault,
                  orElse: () => warehouses.isEmpty
                      ? const WarehouseRecord(
                          id: '',
                          code: '',
                          name: '',
                          address: '',
                          managerName: null,
                          isActive: true,
                          isDefault: false,
                        )
                      : warehouses.first,
                )
                .id;
        if (_warehouseId?.isEmpty ?? true) {
          _warehouseId = warehouses.isEmpty ? null : warehouses.first.id;
        }
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _warehouses = const <WarehouseRecord>[];
        _loading = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _submitReceipt() async {
    if (_submitting) {
      return;
    }
    final warehouseId = _warehouseId;
    if (warehouseId == null || warehouseId.isEmpty) {
      setState(() => _errorMessage = '请选择收货仓库。');
      return;
    }
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final quantity = int.tryParse(_quantityController.text.trim());
    if (quantity == null || quantity <= 0) {
      setState(() => _errorMessage = '实际收到数量必须是正整数。');
      return;
    }

    setState(() {
      _submitting = true;
      _errorMessage = null;
    });
    try {
      await widget.businessApi.createAfterSalesReceipt(
        widget.afterSalesOrder.id,
        {
          'warehouseId': warehouseId,
          'quantity': quantity,
          'condition': _condition,
          if (_noteController.text.trim().isNotEmpty)
            'note': _noteController.text.trim(),
        },
      );
      if (!mounted) {
        return;
      }
      _quantityController.text = '0';
      _noteController.clear();
      setState(() {
        _submitting = false;
        _errorMessage = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('售后收货已提交。')),
      );
      widget.onSubmitted();
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _submitting = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const FormSection(
        title: '实际收货',
        children: [LoadingState(title: '正在加载收货仓库')],
      );
    }
    return FormSection(
      title: '实际收货',
      trailing: StatusTag(
        label: '${widget.afterSalesOrder.receipts.length} 笔记录',
        tone: StatusTone.info,
      ),
      children: [
        if (widget.afterSalesOrder.receipts.isNotEmpty) ...[
          for (final receipt in widget.afterSalesOrder.receipts)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                '${receipt.warehouseName ?? '未分配仓库'} · '
                '${receipt.productName} · '
                '数量 ${receipt.quantity} · '
                '状态 ${_receiptConditionLabel(receipt.condition)}'
                '${receipt.note != null && receipt.note!.isNotEmpty ? ' · ${receipt.note}' : ''}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          const SizedBox(height: 8),
          const Divider(height: 1),
          const SizedBox(height: 12),
        ],
        Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              DropdownButtonFormField<String>(
                key: const ValueKey('after-sales-receipt-warehouse'),
                initialValue: _warehouseId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: '收货仓库'),
                items: [
                  for (final warehouse in _warehouses)
                    DropdownMenuItem(
                      value: warehouse.id,
                      child: Text(warehouse.name),
                    ),
                ],
                onChanged: _submitting
                    ? null
                    : (value) {
                        if (value != null) {
                          setState(() => _warehouseId = value);
                        }
                      },
                validator: (value) =>
                    (value == null || value.isEmpty) ? '请选择收货仓库' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const ValueKey('after-sales-received-qty'),
                controller: _quantityController,
                enabled: !_submitting,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: '实际收到数量',
                  suffixText: '瓶',
                ),
                validator: (value) {
                  final parsed = int.tryParse((value ?? '').trim());
                  if (parsed == null || parsed <= 0) {
                    return '请输入正整数';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                key: const ValueKey('after-sales-receipt-condition'),
                initialValue: _condition,
                isExpanded: true,
                decoration: const InputDecoration(labelText: '商品状态'),
                items: [
                  for (final option in _receiptConditionOptions)
                    DropdownMenuItem(
                      value: option.value,
                      child: Text(option.label),
                    ),
                ],
                onChanged: _submitting
                    ? null
                    : (value) {
                        if (value != null) {
                          setState(() => _condition = value);
                        }
                      },
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const ValueKey('after-sales-receipt-note'),
                controller: _noteController,
                enabled: !_submitting,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(labelText: '收货备注'),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                Text(
                  _errorMessage!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 16),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.icon(
                  key: const ValueKey('after-sales-receipt-submit'),
                  onPressed: _submitting ? null : _submitReceipt,
                  icon: _submitting
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.inbox_rounded),
                  label: Text(_submitting ? '提交中...' : '提交收货'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Option {
  const _Option(this.value, this.label);

  final String value;
  final String label;
}

const _receiptConditionOptions = [
  _Option('SALEABLE', '可售'),
  _Option('UNAVAILABLE', '不可售'),
  _Option('ABNORMAL', '异常'),
];

String _receiptConditionLabel(String value) {
  return _labelFor(_receiptConditionOptions, value);
}

const _issueTypeOptions = [
  _Option('quality_issue', '质量问题'),
  _Option('logistics_damage', '物流破损'),
  _Option('wrong_item', '错发商品'),
  _Option('missing_item', '少发漏发'),
  _Option('customer_return', '客户退货'),
  _Option('invoice_issue', '发票问题'),
  _Option('other', '其他'),
];

const _actionTypeOptions = [
  _Option('record_only', '仅记录'),
  _Option('refund', '部分退款'),
  _Option('return_refund', '退货退款'),
  _Option('resend', '补发'),
  _Option('exchange', '换货'),
  _Option('cancel_order', '取消订单'),
];

const _afterSalesStatusOptions = [
  _Option('negotiating', '协商中'),
  _Option('waiting_receive', '待收货'),
  _Option('waiting_resend', '待补发'),
  _Option('waiting_refund', '待退款'),
  _Option('completed', '已完成'),
];

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}

String _fieldValue(String? value) {
  final normalized = value?.trim();
  if (normalized == null || normalized.isEmpty) {
    return '未填写';
  }
  return normalized;
}

String _dateTimeLabel(String? value) {
  final text = value?.trim();
  if (text == null || text.isEmpty) {
    return '未填写';
  }
  return text.replaceFirst('T', ' ').replaceFirst(RegExp(r'\.\d{3}Z$'), '');
}

AfterSalesOrderRecord? _selectedAfterSalesFrom(
  List<AfterSalesOrderRecord> records,
  String? selectedId,
) {
  if (selectedId == null) {
    return null;
  }
  for (final record in records) {
    if (record.id == selectedId) {
      return record;
    }
  }
  return null;
}

int? _refundYuanToCents(String value) {
  if (value.isEmpty || value.endsWith('.')) {
    return null;
  }
  final parts = value.split('.');
  if (parts.isEmpty || parts.length > 2 || parts.first.isEmpty) {
    return null;
  }
  final yuan = int.tryParse(parts.first);
  if (yuan == null || yuan < 0) {
    return null;
  }
  final fraction = parts.length == 1 ? '' : parts[1];
  if (fraction.length > 2 || !RegExp(r'^\d*$').hasMatch(fraction)) {
    return null;
  }
  final cents = fraction.isEmpty ? 0 : int.tryParse(fraction.padRight(2, '0'));
  if (cents == null) {
    return null;
  }
  return yuan * 100 + cents;
}

String _orderAddress(SalesOrderRecord order) {
  final snapshotAddress = order.address?.trim();
  if (snapshotAddress != null && snapshotAddress.isNotEmpty) {
    return snapshotAddress;
  }
  final parts = [
    order.province,
    order.city,
    order.district,
    order.address,
  ]
      .map((part) => part?.trim())
      .where((part) => part != null && part.isNotEmpty)
      .cast<String>()
      .toList();
  if (parts.isEmpty) {
    return '未填写';
  }
  return parts.join('');
}

String _customerMarkLabel(SalesOrderRecord order) {
  return (order.customer?.financeMark ?? false) ? '客户已标记' : '客户未标记';
}

String _deliverySummaryLabel(String? deliverySummary) {
  switch (deliverySummary) {
    case 'shipping':
      return '邮寄';
    case 'self_pickup':
      return '自带';
    case 'mixed':
      return '自带+邮寄';
    default:
      return '未填写配送';
  }
}

String _deliveryTypeLabel(String deliveryType) {
  switch (deliveryType) {
    case 'shipping':
      return '邮寄';
    case 'self_pickup':
      return '自带';
    default:
      return deliveryType;
  }
}

String _statusLabel(String status) {
  switch (status) {
    case 'valid':
      return '有效';
    case 'partial_refund':
      return '部分退款';
    case 'refunded':
      return '已退款';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

StatusTone _statusTone(String status) {
  switch (status) {
    case 'valid':
      return StatusTone.success;
    case 'partial_refund':
      return StatusTone.warning;
    case 'refunded':
    case 'cancelled':
      return StatusTone.danger;
    default:
      return StatusTone.info;
  }
}

String _issueTypeLabel(String issueType) {
  return _labelFor(_issueTypeOptions, issueType);
}

String _actionTypeLabel(String actionType) {
  return _labelFor(_actionTypeOptions, actionType);
}

String _afterSalesStatusLabel(String status) {
  return _labelFor(_afterSalesStatusOptions, status);
}

bool _canCompleteAfterSales(AfterSalesOrderRecord record) {
  if ((record.status == 'waiting_receive' ||
          record.status == 'waiting_resend') &&
      record.warehouseConfirmedAt == null) {
    return false;
  }
  if (record.refundAmountCents > 0) {
    return record.financeConfirmed && record.refundProofAttachments.isNotEmpty;
  }
  return true;
}

StatusTone _afterSalesStatusTone(String status) {
  switch (status) {
    case 'completed':
      return StatusTone.success;
    case 'waiting_refund':
    case 'waiting_resend':
    case 'waiting_receive':
      return StatusTone.warning;
    case 'negotiating':
      return StatusTone.info;
    default:
      return StatusTone.info;
  }
}

String _labelFor(List<_Option> options, String value) {
  for (final option in options) {
    if (option.value == value) {
      return option.label;
    }
  }
  return value;
}
