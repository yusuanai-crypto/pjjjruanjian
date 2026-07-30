import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';

class SpecialOrdersPage extends StatefulWidget {
  const SpecialOrdersPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<SpecialOrdersPage> createState() => _SpecialOrdersPageState();
}

class _SpecialOrdersPageState extends State<SpecialOrdersPage>
    with SingleTickerProviderStateMixin {
  late final BusinessApi _api;
  late final TabController _tabs;
  final _search = TextEditingController();
  List<SpecialOrderRecord> _orders = const [];
  SpecialOrderReferenceData? _references;
  int _pendingCount = 0;
  bool _pendingOnly = false;
  bool _loading = false;
  bool _exporting = false;
  String? _error;

  bool get _creator => canCreateSpecialOrders(widget.role);
  bool get _reviewer => canReviewSpecialOrders(widget.role);
  String get _type => const ['internal', 'external', 'buyback'][_tabs.index];

  @override
  void initState() {
    super.initState();
    _api = BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _tabs = TabController(length: 3, vsync: this)..addListener(_tabChanged);
    _load();
  }

  @override
  void dispose() {
    _tabs
      ..removeListener(_tabChanged)
      ..dispose();
    _search.dispose();
    super.dispose();
  }

  void _tabChanged() {
    if (!_tabs.indexIsChanging) _load();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final pageFuture = _api.listSpecialOrders(
        orderType: _type,
        workflowStatus: _reviewer && _pendingOnly ? 'pending' : null,
        keyword: _search.text,
      );
      final referenceFuture = _references == null
          ? _api.getSpecialOrderReferenceData()
          : Future.value(_references!);
      final results = await Future.wait([pageFuture, referenceFuture]);
      if (!mounted) return;
      final page = results[0] as SpecialOrderListPage;
      setState(() {
        _orders = page.orders;
        _pendingCount = page.pendingCount;
        _references = results[1] as SpecialOrderReferenceData;
      });
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openForm([SpecialOrderRecord? existing]) async {
    var refs = _references;
    try {
      refs ??= await _api.getSpecialOrderReferenceData();
    } catch (error) {
      _showError(error);
      return;
    }
    if (!mounted) return;
    final saved = await showDialog<SpecialOrderRecord>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _SpecialOrderForm(
        api: _api,
        orderType: existing?.orderType ?? _type,
        references: refs!,
        existing: existing,
      ),
    );
    if (saved != null) await _load();
  }

  Future<void> _action(
    SpecialOrderRecord order,
    String action, {
    bool reasonRequired = false,
  }) async {
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_actionLabel(action)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('确认对 ${order.orderNo} 执行“${_actionLabel(action)}”？'),
            if (action == 'unapprove')
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('将生成库存和财务冲销凭证，不删除原记账流水。'),
              ),
            if (reasonRequired)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: TextField(
                  key: ValueKey('special-order-$action-reason'),
                  controller: reason,
                  maxLength: 500,
                  decoration: const InputDecoration(
                    labelText: '原因（必填）',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () {
              if (reasonRequired && reason.text.trim().isEmpty) return;
              Navigator.pop(dialogContext, true);
            },
            child: const Text('确认'),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      reason.dispose();
      return;
    }
    try {
      final key = _key(action);
      switch (action) {
        case 'submit':
          await _api.submitSpecialOrder(
            order.id,
            workflowVersion: order.workflowVersion,
            idempotencyKey: key,
          );
        case 'withdraw':
          await _api.withdrawSpecialOrder(
            order.id,
            workflowVersion: order.workflowVersion,
            idempotencyKey: key,
          );
        case 'approve':
          await _api.approveSpecialOrder(
            order.id,
            workflowVersion: order.workflowVersion,
            idempotencyKey: key,
          );
        case 'reject':
          await _api.rejectSpecialOrder(
            order.id,
            workflowVersion: order.workflowVersion,
            idempotencyKey: key,
            reason: reason.text,
          );
        case 'unapprove':
          await _api.unapproveSpecialOrder(
            order.id,
            workflowVersion: order.workflowVersion,
            idempotencyKey: key,
            reason: reason.text,
          );
        case 'complete':
          await _api.completeSpecialOrder(
            order.id,
            workflowVersion: order.workflowVersion,
            idempotencyKey: key,
          );
        case 'cancel':
          await _api.cancelSpecialOrder(
            order.id,
            workflowVersion: order.workflowVersion,
            idempotencyKey: key,
          );
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${_actionLabel(action)}成功。')),
        );
      }
      await _load();
    } catch (error) {
      _showError(error);
    } finally {
      reason.dispose();
    }
  }

  Future<void> _payment(SpecialOrderRecord order) async {
    final refs = _references;
    if (refs == null || refs.paymentMethods.isEmpty) {
      _showError('没有可用的付款方式。');
      return;
    }
    final amount = TextEditingController();
    final referenceNo = TextEditingController();
    String methodId = refs.paymentMethods.first.id;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(order.orderType == 'buyback' ? '登记付款' : '登记收款'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: methodId,
                decoration: const InputDecoration(labelText: '付款方式'),
                items: [
                  for (final method in refs.paymentMethods)
                    DropdownMenuItem(
                      value: method.id,
                      child: Text(method.name),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) setDialogState(() => methodId = value);
                },
              ),
              TextField(
                controller: amount,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: '金额（元）'),
              ),
              TextField(
                controller: referenceNo,
                decoration: const InputDecoration(labelText: '流水号（可选）'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('确认登记'),
            ),
          ],
        ),
      ),
    );
    if (confirmed == true) {
      try {
        await _api.recordSpecialOrderPayment(
          order.id,
          workflowVersion: order.workflowVersion,
          idempotencyKey: _key('payment'),
          amountCents: _moneyCents(amount.text),
          paymentMethodId: methodId,
          referenceNo: referenceNo.text,
        );
        await _load();
      } catch (error) {
        _showError(error);
      }
    }
    amount.dispose();
    referenceNo.dispose();
  }

  Future<void> _printData(SpecialOrderRecord order) async {
    try {
      final data = await _api.getSpecialOrderPrintData(order.id);
      final printOrder = _map(data['order']);
      final totals = _map(data['totals']);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('A4 打印数据'),
          content: SizedBox(
            width: 700,
            child: SelectableText(
              [
                '${data['title'] ?? ''}  ${printOrder['orderNo'] ?? ''}',
                '${data['companyRoleLabel'] ?? ''}',
                '业务日期：${printOrder['orderDate'] ?? ''}',
                '交易对象：${_counterparty(order)}',
                '总金额：${_money(_int(totals['totalAmountCents']))}',
                '应收：${_money(_int(totals['receivableTotalCents']))}',
                '应付：${_money(_int(totals['payableTotalCents']))}',
              ].join('\n'),
              key: const ValueKey('special-order-a4-print-data'),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('关闭'),
            ),
          ],
        ),
      );
    } catch (error) {
      _showError(error);
    }
  }

  Future<void> _export() async {
    setState(() => _exporting = true);
    try {
      final file = await _api.downloadSpecialOrdersExcel(
        orderType: _type,
        workflowStatus: _reviewer && _pendingOnly ? 'pending' : null,
        keyword: _search.text,
      );
      final path = await FilePicker.saveFile(
        dialogTitle: '导出特殊订单',
        fileName: file.fileName,
        bytes: file.bytes,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(path == null ? '已取消导出。' : 'Excel 已导出。')),
        );
      }
    } catch (error) {
      _showError(error);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  void _showError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        key: const ValueKey('special-order-error'),
        content: Text(_message(error)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TabBar(
          controller: _tabs,
          tabs: const [
            Tab(text: '内购单'),
            Tab(text: '外销单'),
            Tab(text: '回购单'),
          ],
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                LayoutBuilder(
                  builder: (context, constraints) {
                    final search = TextField(
                      controller: _search,
                      onSubmitted: (_) => _load(),
                      decoration: InputDecoration(
                        labelText: _reviewer ? '搜索全部记录' : '搜索我的订单',
                        prefixIcon: const Icon(Icons.search),
                        border: const OutlineInputBorder(),
                      ),
                    );
                    final buttons = Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        if (_reviewer)
                          FilterChip(
                            key: const ValueKey(
                              'special-order-pending-filter',
                            ),
                            selected: _pendingOnly,
                            label: Text('待审核 $_pendingCount'),
                            onSelected: (value) {
                              setState(() => _pendingOnly = value);
                              _load();
                            },
                          ),
                        OutlinedButton.icon(
                          onPressed: _exporting ? null : _export,
                          icon: const Icon(Icons.download),
                          label: const Text('导出 Excel'),
                        ),
                        if (_creator)
                          FilledButton.icon(
                            key: const ValueKey(
                              'special-order-create-button',
                            ),
                            onPressed: () => _openForm(),
                            icon: const Icon(Icons.add),
                            label: const Text('开单'),
                          ),
                      ],
                    );
                    if (constraints.maxWidth < 700) {
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          search,
                          const SizedBox(height: 8),
                          buttons,
                        ],
                      );
                    }
                    return Row(
                      children: [
                        Expanded(child: search),
                        const SizedBox(width: 12),
                        buttons,
                      ],
                    );
                  },
                ),
                const SizedBox(height: 10),
                if (_loading) const LinearProgressIndicator(),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _load,
                    child: LayoutBuilder(
                      builder: (context, constraints) =>
                          constraints.maxWidth < 760
                              ? _mobileList()
                              : _desktopList(),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _mobileList() {
    if (_orders.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 80),
          Center(child: Text(_reviewer ? '暂无记录' : '暂无我的订单')),
        ],
      );
    }
    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: _orders.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, index) {
        final order = _orders[index];
        return Card(
          child: ListTile(
            onTap: () => _details(order),
            title: Row(
              children: [
                Expanded(child: Text(order.orderNo)),
                _status(order.workflowStatus),
              ],
            ),
            subtitle: Text(
              '${_counterparty(order)} · ${order.orderDate}\n'
              '${_money(order.totalAmountCents)}',
            ),
            trailing: _menu(order),
          ),
        );
      },
    );
  }

  Widget _desktopList() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            columns: const [
              DataColumn(label: Text('单号')),
              DataColumn(label: Text('对象')),
              DataColumn(label: Text('金额')),
              DataColumn(label: Text('状态')),
              DataColumn(label: Text('结算')),
              DataColumn(label: Text('创建人')),
              DataColumn(label: Text('操作')),
            ],
            rows: [
              for (final order in _orders)
                DataRow(cells: [
                  DataCell(Text(order.orderNo)),
                  DataCell(Text(_counterparty(order))),
                  DataCell(Text(_money(order.totalAmountCents))),
                  DataCell(_status(order.workflowStatus)),
                  DataCell(Text(_paymentLabel(
                    order.settlement?.paymentStatus,
                  ))),
                  DataCell(Text(order.createdByName ?? '-')),
                  DataCell(_menu(order)),
                ]),
            ],
          ),
        ),
      ],
    );
  }

  Widget _menu(SpecialOrderRecord order) {
    return PopupMenuButton<String>(
      tooltip: '订单操作',
      onSelected: (action) {
        if (action == 'details') {
          _details(order);
        } else if (action == 'edit') {
          _openForm(order);
        } else if (action == 'print') {
          _printData(order);
        } else if (action == 'payment') {
          _payment(order);
        } else {
          _action(
            order,
            action,
            reasonRequired: action == 'reject' || action == 'unapprove',
          );
        }
      },
      itemBuilder: (_) => [
        const PopupMenuItem(value: 'details', child: Text('查看详情')),
        const PopupMenuItem(value: 'print', child: Text('A4 打印数据')),
        if (_creator && order.isEditable)
          const PopupMenuItem(value: 'edit', child: Text('修改')),
        if (_creator && order.isEditable)
          const PopupMenuItem(value: 'submit', child: Text('提交审核')),
        if (_creator && order.workflowStatus == 'pending')
          const PopupMenuItem(value: 'withdraw', child: Text('撤回')),
        if (_creator && order.isEditable)
          const PopupMenuItem(value: 'cancel', child: Text('取消草稿')),
        if (_reviewer && order.workflowStatus == 'pending')
          const PopupMenuItem(value: 'approve', child: Text('通过')),
        if (_reviewer && order.workflowStatus == 'pending')
          const PopupMenuItem(value: 'reject', child: Text('驳回')),
        if (_reviewer &&
            ['approved', 'completed'].contains(order.workflowStatus))
          const PopupMenuItem(value: 'unapprove', child: Text('反审核')),
        if (_reviewer && order.workflowStatus == 'approved')
          const PopupMenuItem(value: 'complete', child: Text('完成')),
        if (_reviewer &&
            ['approved', 'completed'].contains(order.workflowStatus))
          const PopupMenuItem(value: 'payment', child: Text('登记收/付款')),
      ],
    );
  }

  Future<void> _details(SpecialOrderRecord order) {
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('${_typeLabel(order.orderType)} ${order.orderNo}'),
        content: SizedBox(
          width: 760,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('交易对象：${_counterparty(order)}'),
                Text('金额：${_money(order.totalAmountCents)}'),
                Text(
                  order.orderType == 'buyback'
                      ? '应付：${_money(order.payableTotalCents)}'
                      : '应收：${_money(order.receivableTotalCents)}',
                ),
                const Divider(),
                const Text('商品明细'),
                for (final item in order.items)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(item.productName),
                    subtitle: Text(
                      '${item.warehouseName ?? '-'} · '
                      '${item.deliveryType == 'self_pickup' ? '自提' : '发货'}',
                    ),
                    trailing: Text(
                      '${item.quantity} ${item.unit}\n${_money(item.subtotalCents)}',
                      textAlign: TextAlign.end,
                    ),
                  ),
                const Divider(),
                const Text('审批历史'),
                for (final event in order.workflowEvents)
                  ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      '${_eventLabel(event.eventType)} · '
                      '${event.actorName ?? '-'}',
                    ),
                    subtitle: Text(
                      [event.createdAt, event.reason]
                          .whereType<String>()
                          .join(' · '),
                    ),
                  ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
  }
}

class _SpecialOrderForm extends StatefulWidget {
  const _SpecialOrderForm({
    required this.api,
    required this.orderType,
    required this.references,
    this.existing,
  });

  final BusinessApi api;
  final String orderType;
  final SpecialOrderReferenceData references;
  final SpecialOrderRecord? existing;

  @override
  State<_SpecialOrderForm> createState() => _SpecialOrderFormState();
}

class _SpecialOrderFormState extends State<_SpecialOrderForm> {
  final _formKey = GlobalKey<FormState>();
  final _remark = TextEditingController();
  final _sourceRemark = TextEditingController();
  final _externalName = TextEditingController();
  late SpecialOrderReferenceData _refs;
  late final List<_LineDraft> _lines;
  String? _employeeId;
  String? _customerId;
  String _externalType = 'guide';
  String? _externalId;
  bool _hasOriginal = true;
  String? _sourceOrderId;
  bool _saving = false;
  String? _error;

  String? get _defaultWarehouseId => _refs.defaultWarehouse?.id;

  @override
  void initState() {
    super.initState();
    _refs = widget.references;
    final order = widget.existing;
    _employeeId = order?.internalEmployeeId;
    _customerId = order?.customerId;
    _externalType = order?.externalPartyType ?? 'guide';
    _externalId = order?.externalPartyId;
    _hasOriginal = order?.hasOriginalPurchase ?? true;
    _sourceOrderId = order?.sourceSalesOrderId;
    _remark.text = order?.remark ?? '';
    _sourceRemark.text = order?.sourceRemark ?? '';
    _externalName.text = order?.externalPartyName ?? '';
    _lines = order == null || order.items.isEmpty
        ? [_LineDraft(warehouseId: _defaultWarehouseId)]
        : order.items
            .map(
              (item) => _LineDraft.fromRecord(
                item,
                defaultWarehouseId: _defaultWarehouseId,
              ),
            )
            .toList();
    if (_customerId != null && _hasOriginal) {
      _loadSources(_customerId!);
    }
  }

  @override
  void dispose() {
    _remark.dispose();
    _sourceRemark.dispose();
    _externalName.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  Future<void> _loadSources(String customerId) async {
    try {
      final refs = await widget.api.getSpecialOrderReferenceData(
        customerId: customerId,
      );
      if (!mounted) return;
      setState(() {
        _refs = refs;
        if (!refs.sourceSalesOrders.any((row) => row.id == _sourceOrderId)) {
          _sourceOrderId = refs.sourceSalesOrders.isEmpty
              ? null
              : refs.sourceSalesOrders.first.id;
        }
      });
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final body = <String, dynamic>{
        'orderType': widget.orderType,
        'orderDate': _date(DateTime.now()),
        'remark': _remark.text,
        if (widget.orderType == 'internal') 'internalEmployeeId': _employeeId,
        if (widget.orderType == 'external') ...{
          'externalPartyType': _externalType,
          if (_externalType == 'other')
            'externalPartyName': _externalName.text
          else
            'externalPartyId': _externalId,
        },
        if (widget.orderType == 'buyback') ...{
          'customerId': _customerId,
          'hasOriginalPurchase': _hasOriginal,
          if (_hasOriginal)
            'sourceSalesOrderId': _sourceOrderId
          else
            'sourceRemark': _sourceRemark.text,
        },
        'items': [
          for (final line in _lines) line.toJson(widget.orderType),
        ],
      };
      final saved = widget.existing == null
          ? await widget.api.createSpecialOrder({
              ...body,
              'idempotencyKey': _key('create'),
            })
          : await widget.api.updateSpecialOrder(widget.existing!.id, {
              ...body,
              'workflowVersion': widget.existing!.workflowVersion,
              'idempotencyKey': _key('update'),
            });
      if (mounted) Navigator.pop(context, saved);
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      insetPadding: const EdgeInsets.all(16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 980, maxHeight: 820),
        child: Scaffold(
          appBar: AppBar(
            automaticallyImplyLeading: false,
            title: Text(
              '${widget.existing == null ? '新建' : '修改'}'
              '${_typeLabel(widget.orderType)}',
            ),
            actions: [
              IconButton(
                onPressed: _saving ? null : () => Navigator.pop(context),
                icon: const Icon(Icons.close),
              ),
            ],
          ),
          body: Form(
            key: _formKey,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (_error != null)
                  Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                _counterpartyFields(),
                const SizedBox(height: 12),
                TextField(
                  controller: _remark,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: '整单备注',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '商品明细',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    OutlinedButton.icon(
                      key: const ValueKey('special-order-add-item'),
                      onPressed: () => setState(
                        () => _lines.add(
                          _LineDraft(warehouseId: _defaultWarehouseId),
                        ),
                      ),
                      icon: const Icon(Icons.add),
                      label: const Text('添加商品'),
                    ),
                  ],
                ),
                for (var index = 0; index < _lines.length; index++)
                  _lineEditor(index),
                Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton.icon(
                    key: const ValueKey('special-order-save-draft'),
                    onPressed: _saving ? null : _save,
                    icon: const Icon(Icons.save),
                    label: Text(_saving ? '保存中' : '保存草稿'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _counterpartyFields() {
    if (widget.orderType == 'internal') {
      return DropdownButtonFormField<String>(
        key: const ValueKey('special-order-employee-field'),
        initialValue: _employeeId,
        decoration: const InputDecoration(
          labelText: '内购员工',
          border: OutlineInputBorder(),
        ),
        items: [
          for (final employee in _refs.employees)
            DropdownMenuItem(
              value: employee.id,
              child: Text('${employee.name}（${employee.role ?? '-'}）'),
            ),
        ],
        onChanged: (value) => setState(() => _employeeId = value),
        validator: (value) => value == null ? '请选择内购员工' : null,
      );
    }
    if (widget.orderType == 'external') {
      final parties =
          _externalType == 'guide' ? _refs.guides : _refs.travelAgencies;
      return Column(
        children: [
          DropdownButtonFormField<String>(
            key: const ValueKey('special-order-external-type-field'),
            initialValue: _externalType,
            decoration: const InputDecoration(
              labelText: '外销对象类型',
              border: OutlineInputBorder(),
            ),
            items: const [
              DropdownMenuItem(value: 'guide', child: Text('导游')),
              DropdownMenuItem(
                value: 'travel_agency',
                child: Text('旅行社'),
              ),
              DropdownMenuItem(value: 'other', child: Text('其他')),
            ],
            onChanged: (value) => setState(() {
              _externalType = value ?? 'guide';
              _externalId = null;
            }),
          ),
          const SizedBox(height: 12),
          if (_externalType == 'other')
            TextFormField(
              key: const ValueKey('special-order-external-name-field'),
              controller: _externalName,
              decoration: const InputDecoration(
                labelText: '外销对象名称',
                border: OutlineInputBorder(),
              ),
              validator: _requiredText,
            )
          else
            DropdownButtonFormField<String>(
              key: const ValueKey('special-order-external-party-field'),
              initialValue: _externalId,
              decoration: const InputDecoration(
                labelText: '选择外销对象',
                border: OutlineInputBorder(),
              ),
              items: [
                for (final party in parties)
                  DropdownMenuItem(
                    value: party.id,
                    child: Text(party.name),
                  ),
              ],
              onChanged: (value) => setState(() => _externalId = value),
              validator: (value) => value == null ? '请选择外销对象' : null,
            ),
        ],
      );
    }
    return Column(
      children: [
        DropdownButtonFormField<String>(
          key: const ValueKey('special-order-buyback-customer-field'),
          initialValue: _customerId,
          decoration: const InputDecoration(
            labelText: '回购客户',
            border: OutlineInputBorder(),
          ),
          items: [
            for (final customer in _refs.customers)
              DropdownMenuItem(
                value: customer.id,
                child: Text(customer.name),
              ),
          ],
          onChanged: (value) {
            setState(() {
              _customerId = value;
              _sourceOrderId = null;
            });
            if (value != null) _loadSources(value);
          },
          validator: (value) => value == null ? '请选择回购客户' : null,
        ),
        SwitchListTile(
          key: const ValueKey('special-order-original-purchase-switch'),
          contentPadding: EdgeInsets.zero,
          title: const Text('有原购买订单'),
          value: _hasOriginal,
          onChanged: (value) => setState(() => _hasOriginal = value),
        ),
        if (_hasOriginal)
          DropdownButtonFormField<String>(
            key: const ValueKey('special-order-source-order-field'),
            initialValue: _sourceOrderId,
            decoration: const InputDecoration(
              labelText: '原购买订单',
              border: OutlineInputBorder(),
            ),
            items: [
              for (final order in _refs.sourceSalesOrders)
                DropdownMenuItem(
                  value: order.id,
                  child: Text('${order.orderNo} · ${order.orderDate}'),
                ),
            ],
            onChanged: (value) => setState(() => _sourceOrderId = value),
            validator: (value) => value == null ? '请选择原购买订单' : null,
          )
        else
          TextFormField(
            key: const ValueKey('special-order-source-remark-field'),
            controller: _sourceRemark,
            decoration: const InputDecoration(
              labelText: '无原订单说明',
              border: OutlineInputBorder(),
            ),
            validator: _requiredText,
          ),
        const SizedBox(height: 12),
        InputDecorator(
          key: const ValueKey('special-order-default-warehouse-field'),
          decoration: const InputDecoration(
            labelText: '回购入库仓库（只读）',
            border: OutlineInputBorder(),
          ),
          child: Text(_refs.defaultWarehouse?.name ?? '未配置唯一默认总仓'),
        ),
      ],
    );
  }

  Widget _lineEditor(int index) {
    final line = _lines[index];
    final product = _first(
      _refs.products.where((row) => row.id == line.productId),
    );
    return Card(
      key: ValueKey('special-order-item-$index'),
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: LayoutBuilder(
          builder: (context, constraints) {
            Widget sized(Widget child) => SizedBox(
                  width:
                      constraints.maxWidth < 680 ? constraints.maxWidth : 275,
                  child: child,
                );
            final fields = <Widget>[
              DropdownButtonFormField<String>(
                initialValue: line.productId,
                decoration: const InputDecoration(labelText: '商品'),
                items: [
                  for (final product in _refs.products)
                    DropdownMenuItem(
                      value: product.id,
                      child: Text(product.name),
                    ),
                ],
                onChanged: (value) => setState(() => line.productId = value),
                validator: (value) => value == null ? '请选择商品' : null,
              ),
              if (widget.orderType != 'buyback')
                DropdownButtonFormField<String>(
                  initialValue: line.warehouseId,
                  decoration: const InputDecoration(labelText: '仓库'),
                  items: [
                    for (final warehouse in _refs.warehouses)
                      DropdownMenuItem(
                        value: warehouse.id,
                        child: Text(warehouse.name),
                      ),
                  ],
                  onChanged: (value) =>
                      setState(() => line.warehouseId = value),
                  validator: (value) => value == null ? '请选择仓库' : null,
                ),
              TextFormField(
                controller: line.quantity,
                keyboardType:
                    const TextInputType.numberWithOptions(signed: true),
                decoration: const InputDecoration(labelText: '数量（不可为 0）'),
                validator: (value) {
                  final parsed = int.tryParse(value?.trim() ?? '');
                  return parsed == null || parsed == 0 ? '数量不可为 0' : null;
                },
              ),
              TextFormField(
                controller: line.listPrice,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: '标价（元）'),
                validator: _moneyValidator,
              ),
              TextFormField(
                controller: line.dealPrice,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: '成交价（元）'),
                validator: _moneyValidator,
              ),
              DropdownButtonFormField<String>(
                initialValue: line.deliveryType,
                decoration: const InputDecoration(labelText: '交付方式'),
                items: const [
                  DropdownMenuItem(value: 'shipping', child: Text('发货')),
                  DropdownMenuItem(
                    value: 'self_pickup',
                    child: Text('自提'),
                  ),
                ],
                onChanged: (value) => setState(
                  () => line.deliveryType = value ?? 'shipping',
                ),
              ),
            ];
            return Column(
              children: [
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: fields.map(sized).toList(),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('赠品 / 零价'),
                  value: line.isGift,
                  onChanged: (value) => setState(() {
                    line.isGift = value;
                    if (value) line.dealPrice.text = '0';
                  }),
                ),
                TextFormField(
                  controller: line.priceReason,
                  decoration: const InputDecoration(
                    labelText: '手工改价原因（成交价与标价不同时必填）',
                  ),
                ),
                TextFormField(
                  controller: line.adjustmentReason,
                  decoration: const InputDecoration(
                    labelText: '负数调整原因（数量为负数时必填）',
                  ),
                ),
                if (widget.orderType == 'buyback' &&
                    product?.inventoryTrackingMode == 'serialized')
                  TextFormField(
                    key: ValueKey('special-order-logistics-codes-$index'),
                    controller: line.logisticsCodes,
                    minLines: 2,
                    maxLines: 5,
                    decoration: const InputDecoration(
                      labelText: '逐瓶物流码（每行一个，不创建虚拟码）',
                      border: OutlineInputBorder(),
                    ),
                  ),
                Align(
                  alignment: Alignment.centerRight,
                  child: IconButton(
                    tooltip: '删除明细',
                    onPressed: _lines.length == 1
                        ? null
                        : () => setState(() {
                              final removed = _lines.removeAt(index);
                              removed.dispose();
                            }),
                    icon: const Icon(Icons.delete_outline),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _LineDraft {
  _LineDraft({this.warehouseId});

  factory _LineDraft.fromRecord(
    SpecialOrderItemRecord record, {
    String? defaultWarehouseId,
  }) {
    return _LineDraft(
      warehouseId: record.warehouseId ?? defaultWarehouseId,
    )
      ..productId = record.productId
      ..quantity.text = '${record.quantity}'
      ..listPrice.text = _inputMoney(record.listUnitPriceCents)
      ..dealPrice.text = _inputMoney(record.unitPriceCents)
      ..priceReason.text = record.priceOverrideReason ?? ''
      ..adjustmentReason.text = record.adjustmentReason ?? ''
      ..logisticsCodes.text = record.logisticsCodes.join('\n')
      ..isGift = record.isGift
      ..deliveryType = record.deliveryType;
  }

  String? productId;
  String? warehouseId;
  final quantity = TextEditingController(text: '1');
  final listPrice = TextEditingController(text: '0');
  final dealPrice = TextEditingController(text: '0');
  final priceReason = TextEditingController();
  final adjustmentReason = TextEditingController();
  final logisticsCodes = TextEditingController();
  bool isGift = false;
  String deliveryType = 'shipping';

  Map<String, dynamic> toJson(String orderType) {
    return {
      'productId': productId,
      if (orderType != 'buyback') 'warehouseId': warehouseId,
      'quantity': int.tryParse(quantity.text.trim()),
      'listUnitPriceCents': _moneyCents(listPrice.text),
      'unitPriceCents': isGift ? 0 : _moneyCents(dealPrice.text),
      'isGift': isGift,
      'priceOverrideReason': priceReason.text,
      'adjustmentReason': adjustmentReason.text,
      'deliveryType': deliveryType,
      'inventoryCondition': 'saleable',
      'logisticsCodes': logisticsCodes.text
          .split(RegExp(r'[\r\n,]+'))
          .map((code) => code.trim())
          .where((code) => code.isNotEmpty)
          .toList(),
    };
  }

  void dispose() {
    quantity.dispose();
    listPrice.dispose();
    dealPrice.dispose();
    priceReason.dispose();
    adjustmentReason.dispose();
    logisticsCodes.dispose();
  }
}

Widget _status(String value) {
  final color = switch (value) {
    'approved' || 'completed' => Colors.green,
    'pending' => Colors.orange,
    'rejected' => Colors.red,
    'cancelled' => Colors.grey,
    _ => Colors.blueGrey,
  };
  return Chip(
    visualDensity: VisualDensity.compact,
    label: Text(_statusLabel(value)),
    side: BorderSide(color: color.withValues(alpha: .45)),
    backgroundColor: color.withValues(alpha: .08),
  );
}

String _counterparty(SpecialOrderRecord order) =>
    order.internalEmployeeName ?? order.externalPartyName ?? order.customerName;

String _typeLabel(String value) => switch (value) {
      'internal' => '内购单',
      'external' => '外销单',
      'buyback' => '回购单',
      _ => value,
    };

String _statusLabel(String value) => switch (value) {
      'draft' => '草稿',
      'pending' => '待审核',
      'approved' => '已审核',
      'completed' => '已完成',
      'rejected' => '已驳回',
      'cancelled' => '已取消',
      _ => value,
    };

String _paymentLabel(String? value) => switch (value) {
      'paid' => '已结清',
      'partial' => '部分',
      'unpaid' => '未结清',
      _ => '-',
    };

String _actionLabel(String value) => switch (value) {
      'submit' => '提交审核',
      'withdraw' => '撤回',
      'approve' => '通过',
      'reject' => '驳回',
      'unapprove' => '反审核',
      'complete' => '完成',
      'cancel' => '取消',
      _ => value,
    };

String _eventLabel(String value) => switch (value) {
      'created' => '创建',
      'updated' => '修改',
      'submitted' => '提交',
      'resubmitted' => '重新提交',
      'withdrawn' => '撤回',
      'approved' => '审核通过',
      'auto_approve' => '自动审核',
      'rejected' => '驳回',
      'unapproved' => '反审核',
      'completed' => '完成',
      'cancelled' => '取消',
      'payment_recorded' => '登记收付款',
      _ => value,
    };

String _key(String action) =>
    'flutter:$action:${DateTime.now().microsecondsSinceEpoch}';

String _date(DateTime value) =>
    '${value.year}-${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';

int _moneyCents(String text) {
  final value = double.tryParse(text.trim());
  return value == null || value < 0 ? 0 : (value * 100).round();
}

String? _moneyValidator(String? text) {
  final value = double.tryParse(text?.trim() ?? '');
  return value == null || value < 0 ? '请输入非负金额' : null;
}

String? _requiredText(String? text) =>
    text?.trim().isEmpty == false ? null : '此项必填';

String _money(int cents) => '¥${(cents / 100).toStringAsFixed(2)}';
String _inputMoney(int cents) => (cents / 100).toStringAsFixed(2);
int _int(Object? value) => value is int ? value : int.tryParse('$value') ?? 0;
Map<String, dynamic> _map(Object? value) => value is Map
    ? value.map((key, nested) => MapEntry('$key', nested))
    : <String, dynamic>{};
T? _first<T>(Iterable<T> values) => values.isEmpty ? null : values.first;

String _message(Object error) {
  if (error is ApiException) {
    return error.statusCode == 409
        ? '${error.message} 请刷新订单后重试。'
        : error.message;
  }
  return '$error';
}
