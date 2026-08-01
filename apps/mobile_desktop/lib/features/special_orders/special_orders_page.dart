import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';

Future<SpecialOrderRecord?> showSpecialOrderFormDialog({
  required BuildContext context,
  required BusinessApi api,
  required String orderType,
  required SpecialOrderReferenceData references,
  SpecialOrderRecord? existing,
}) {
  return showDialog<SpecialOrderRecord>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _SpecialOrderForm(
      api: api,
      orderType: orderType,
      references: references,
      existing: existing,
    ),
  );
}

Future<void> showSpecialOrderCommissionDialog({
  required BuildContext context,
  required BusinessApi api,
  required SpecialOrderRecord order,
  required List<SpecialOrderReferenceOption> employees,
}) {
  return showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _SpecialOrderCommissionDialog(
      api: api,
      order: order,
      employees: employees,
    ),
  );
}

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
    final saved = await showSpecialOrderFormDialog(
      context: context,
      api: _api,
      orderType: existing?.orderType ?? _type,
      references: refs,
      existing: existing,
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
            reason: reason.text,
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
                        if (_creator)
                          FilledButton.icon(
                            key: const ValueKey(
                              'special-order-create-button',
                            ),
                            onPressed: () => _openForm(),
                            icon: const Icon(Icons.add),
                            label: const Text('开单'),
                          ),
                        if (_reviewer)
                          OutlinedButton.icon(
                            onPressed: _exporting ? null : _export,
                            icon: const Icon(Icons.download),
                            label: const Text('导出 Excel'),
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
        } else if (action == 'commission') {
          _commissions(order);
        } else {
          _action(
            order,
            action,
            reasonRequired: action == 'reject' ||
                action == 'unapprove' ||
                (action == 'cancel' && order.workflowStatus == 'completed'),
          );
        }
      },
      itemBuilder: (_) => [
        const PopupMenuItem(value: 'details', child: Text('查看详情')),
        const PopupMenuItem(value: 'print', child: Text('A4 打印数据')),
        if (_creator && order.isEditable)
          const PopupMenuItem(value: 'edit', child: Text('修改')),
        if (_reviewer && order.workflowStatus == 'completed')
          const PopupMenuItem(value: 'edit', child: Text('修改订单')),
        if (_reviewer && order.workflowStatus == 'completed')
          const PopupMenuItem(value: 'commission', child: Text('提成信息')),
        if (_reviewer && order.workflowStatus == 'completed')
          const PopupMenuItem(value: 'cancel', child: Text('作废订单')),
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
                if (_reviewer)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.percent),
                      title: const Text('提成信息'),
                      subtitle: const Text('多人提成、非员工提成及退款冲减记录'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => _commissions(order),
                    ),
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

  Future<void> _commissions(SpecialOrderRecord order) async {
    final refs = _references ?? await _api.getSpecialOrderReferenceData();
    if (!mounted) return;
    await showSpecialOrderCommissionDialog(
      context: context,
      api: _api,
      order: order,
      employees: refs.employees,
    );
    if (mounted) await _load();
  }
}

class _SpecialOrderCommissionDialog extends StatefulWidget {
  const _SpecialOrderCommissionDialog({
    required this.api,
    required this.order,
    required this.employees,
  });

  final BusinessApi api;
  final SpecialOrderRecord order;
  final List<SpecialOrderReferenceOption> employees;

  @override
  State<_SpecialOrderCommissionDialog> createState() =>
      _SpecialOrderCommissionDialogState();
}

class _SpecialOrderCommissionDialogState
    extends State<_SpecialOrderCommissionDialog> {
  List<SpecialOrderCommissionRecord> _records = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final records = await widget.api.listSpecialOrderCommissions(
        widget.order.id,
      );
      if (mounted) setState(() => _records = records);
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _edit([SpecialOrderCommissionRecord? existing]) async {
    var recipientType = existing?.recipientType ?? 'employee';
    var targetUserId = existing?.targetUserId ??
        (widget.employees.isEmpty ? null : widget.employees.first.id);
    final recipientName = TextEditingController(
      text: existing?.recipientType == 'other'
          ? existing?.recipientName ?? ''
          : '',
    );
    final rate = TextEditingController(text: existing?.ratePercent ?? '0');
    final note = TextEditingController(text: existing?.note ?? '');
    final formKey = GlobalKey<FormState>();
    var saving = false;
    String? dialogError;
    final saved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(existing == null ? '添加提成对象' : '修改提成信息'),
          content: SizedBox(
            width: 560,
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (dialogError != null)
                    Text(
                      dialogError!,
                      style:
                          TextStyle(color: Theme.of(context).colorScheme.error),
                    ),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(value: 'employee', label: Text('内部员工')),
                      ButtonSegment(value: 'other', label: Text('非员工/其他人员')),
                    ],
                    selected: {recipientType},
                    onSelectionChanged: (value) =>
                        setDialogState(() => recipientType = value.first),
                  ),
                  const SizedBox(height: 12),
                  if (recipientType == 'employee')
                    DropdownButtonFormField<String>(
                      initialValue: targetUserId,
                      decoration: const InputDecoration(
                        labelText: '员工账号',
                        border: OutlineInputBorder(),
                      ),
                      items: [
                        for (final employee in widget.employees)
                          DropdownMenuItem(
                            value: employee.id,
                            child: Text(employee.name),
                          ),
                      ],
                      onChanged: (value) => targetUserId = value,
                      validator: (value) => value == null ? '请选择员工' : null,
                    )
                  else
                    TextFormField(
                      controller: recipientName,
                      decoration: const InputDecoration(
                        labelText: '人员姓名',
                        border: OutlineInputBorder(),
                      ),
                      validator: _requiredText,
                    ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: rate,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: '提成比例（%）',
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (_) => setDialogState(() {}),
                    validator: (value) => RegExp(r'^\d+(?:\.\d{1,2})?$')
                            .hasMatch(value?.trim() ?? '')
                        ? null
                        : '请输入非负比例（最多两位小数）',
                  ),
                  const SizedBox(height: 8),
                  InputDecorator(
                    decoration: const InputDecoration(
                      labelText: '提成金额（自动计算，只读）',
                      border: OutlineInputBorder(),
                    ),
                    child: Text(
                      _money(_commissionPreviewCents(
                        widget.order.totalAmountCents,
                        rate.text,
                      )),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: note,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      labelText: '备注',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      '提成基数：${_money(widget.order.totalAmountCents)}；归属日期：${widget.order.orderDate}',
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed:
                  saving ? null : () => Navigator.pop(dialogContext, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: saving
                  ? null
                  : () async {
                      if (!formKey.currentState!.validate()) return;
                      setDialogState(() {
                        saving = true;
                        dialogError = null;
                      });
                      try {
                        final body = <String, dynamic>{
                          'recipientType': recipientType,
                          if (recipientType == 'employee')
                            'targetUserId': targetUserId
                          else
                            'recipientName': recipientName.text.trim(),
                          'ratePercent': rate.text.trim(),
                          'note': note.text.trim(),
                          'idempotencyKey': _key(
                            existing == null
                                ? 'commission-create'
                                : 'commission-update',
                          ),
                          if (existing != null)
                            'manualVersion': existing.manualVersion,
                        };
                        if (existing == null) {
                          await widget.api.createSpecialOrderCommission(
                            widget.order.id,
                            body,
                          );
                        } else {
                          await widget.api.updateSpecialOrderCommission(
                            widget.order.id,
                            existing.id,
                            body,
                          );
                        }
                        if (dialogContext.mounted) {
                          Navigator.pop(dialogContext, true);
                        }
                      } catch (error) {
                        setDialogState(() {
                          dialogError = _message(error);
                          saving = false;
                        });
                      }
                    },
              child: Text(saving ? '保存中' : '保存'),
            ),
          ],
        ),
      ),
    );
    recipientName.dispose();
    rate.dispose();
    note.dispose();
    if (saved == true) await _load();
  }

  Future<void> _remove(SpecialOrderCommissionRecord record) async {
    try {
      await widget.api.deleteSpecialOrderCommission(
        widget.order.id,
        record.id,
        manualVersion: record.manualVersion,
        reason: '财务删除提成信息',
        idempotencyKey: _key('commission-delete'),
      );
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('提成信息 · ${widget.order.orderNo}'),
      content: SizedBox(
        width: 820,
        height: 520,
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '上单金额 ${_money(widget.order.totalAmountCents)} · 归属日期 ${widget.order.orderDate}',
                  ),
                ),
                FilledButton.icon(
                  onPressed: () => _edit(),
                  icon: const Icon(Icons.add),
                  label: const Text('添加提成'),
                ),
              ],
            ),
            if (_loading) const LinearProgressIndicator(),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(8),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            Expanded(
              child: ListView(
                children: [
                  for (final record in _records)
                    Card(
                      child: ListTile(
                        title: Text(
                          '${record.recipientName} · ${record.ratePercent}%',
                        ),
                        subtitle: Text(
                          '${record.recipientType == 'employee' ? '内部员工' : '非员工/其他人员'} · '
                          '基数 ${_money(record.effectiveBaseAmountCents)} · '
                          '原提成 ${_money(record.originalAmountCents)} · '
                          '冲减 ${_money(record.adjustmentAmountCents)}\n'
                          '有效提成 ${_money(record.effectiveAmountCents)} · '
                          '归属 ${record.attributionDate ?? '-'}',
                        ),
                        trailing: Wrap(
                          spacing: 4,
                          children: [
                            IconButton(
                              tooltip: '修改',
                              onPressed: () => _edit(record),
                              icon: const Icon(Icons.edit_outlined),
                            ),
                            IconButton(
                              tooltip: '删除',
                              onPressed: () => _remove(record),
                              icon: const Icon(Icons.delete_outline),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('关闭'),
        ),
      ],
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
  final _customerName = TextEditingController();
  final _customerPhone = TextEditingController();
  final _customerAddress = TextEditingController();
  final _customerNotes = TextEditingController();
  late SpecialOrderReferenceData _refs;
  late final List<_LineDraft> _lines;
  String? _customerId;
  late final List<_PaymentDraft> _payments;
  late final String _submissionKey;
  // Kept only for rendering legacy draft records through the old helper;
  // new direct-completion forms use the common customer fields below.
  final _sourceRemark = TextEditingController();
  final _externalName = TextEditingController();
  String? _employeeId;
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
    _customerId = order?.customerId;
    _submissionKey = _key(order == null ? 'create' : 'update');
    _remark.text = order?.remark ?? '';
    _customerName.text = order?.customerName ?? '';
    _customerPhone.text = order?.customerPhone ?? '';
    _customerAddress.text = order?.address ?? '';
    _customerNotes.text = order?.customerNotes ?? '';
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
    _payments = (order?.settlement?.payments ?? const [])
        .map(_PaymentDraft.fromJson)
        .toList();
  }

  @override
  void dispose() {
    _remark.dispose();
    _customerName.dispose();
    _customerPhone.dispose();
    _customerAddress.dispose();
    _customerNotes.dispose();
    _sourceRemark.dispose();
    _externalName.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    for (final payment in _payments) {
      payment.dispose();
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

  int get _orderTotalCents => _lines.fold(
        0,
        (sum, line) => sum + _moneyCents(line.totalPrice.text),
      );

  int get _paidTotalCents => _payments.fold(
        0,
        (sum, payment) => sum + _moneyCents(payment.amount.text),
      );

  void _selectCustomer(String? id) {
    final selected = _first(_refs.customers.where((row) => row.id == id));
    setState(() {
      _customerId = id;
      if (selected == null) {
        _customerName.clear();
        _customerPhone.clear();
        _customerAddress.clear();
        _customerNotes.clear();
      } else {
        _customerName.text = selected.name;
        _customerPhone.text = selected.phone ?? '';
        _customerAddress.text = selected.address ?? '';
        _customerNotes.text = selected.notes ?? '';
      }
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_paidTotalCents > _orderTotalCents) {
      setState(() => _error = '已支付金额不能大于商品明细合计。');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final body = <String, dynamic>{
        'orderType': widget.orderType,
        'orderDate': widget.existing?.orderDate ?? _date(DateTime.now()),
        'remark': _remark.text,
        if (_customerId != null) 'customerId': _customerId,
        'customer': {
          'name': _customerName.text.trim(),
          'phone': _customerPhone.text.trim(),
          'address': _customerAddress.text.trim(),
          'notes': _customerNotes.text.trim(),
        },
        'items': [
          for (final line in _lines) line.toJson(widget.orderType),
        ],
        'payments': [for (final payment in _payments) payment.toJson()],
      };
      final saved = widget.existing == null
          ? await widget.api.createSpecialOrder({
              ...body,
              'idempotencyKey': _submissionKey,
            })
          : await widget.api.updateSpecialOrder(widget.existing!.id, {
              ...body,
              'workflowVersion': widget.existing!.workflowVersion,
              'idempotencyKey': _submissionKey,
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
                _customerFields(),
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
                const SizedBox(height: 18),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '支付明细（可混合支付，也可留空记欠款）',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    OutlinedButton.icon(
                      key: const ValueKey('special-order-add-payment'),
                      onPressed: _refs.paymentMethods.isEmpty
                          ? null
                          : () => setState(
                                () => _payments.add(
                                  _PaymentDraft(
                                    paymentMethodId:
                                        _refs.paymentMethods.first.id,
                                  ),
                                ),
                              ),
                      icon: const Icon(Icons.add_card),
                      label: const Text('添加支付'),
                    ),
                  ],
                ),
                for (var index = 0; index < _payments.length; index++)
                  _paymentEditor(index),
                const SizedBox(height: 88),
              ],
            ),
          ),
          bottomNavigationBar: Material(
            elevation: 8,
            child: SafeArea(
              top: false,
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Wrap(
                        spacing: 24,
                        runSpacing: 4,
                        children: [
                          Text('商品合计：${_money(_orderTotalCents)}'),
                          Text('已支付：${_money(_paidTotalCents)}'),
                          Text(
                            '未支付：${_money(_orderTotalCents > _paidTotalCents ? _orderTotalCents - _paidTotalCents : 0)}',
                          ),
                        ],
                      ),
                    ),
                    FilledButton.icon(
                      key: const ValueKey('special-order-save-draft'),
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox.square(
                              dimension: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.check),
                      label: Text(_saving ? '提交中' : '确认开单'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _customerFields() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('客户信息', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: const ValueKey('special-order-customer-field'),
              initialValue: _customerId ?? '__new__',
              decoration: const InputDecoration(
                labelText: '搜索/选择已有客户，或直接新建',
                border: OutlineInputBorder(),
              ),
              items: [
                const DropdownMenuItem(
                  value: '__new__',
                  child: Text('新客户 / 手工填写'),
                ),
                for (final customer in _refs.customers)
                  DropdownMenuItem(
                    value: customer.id,
                    child: Text(
                      '${customer.name}${customer.phone?.isNotEmpty == true ? ' · ${customer.phone}' : ''}',
                    ),
                  ),
              ],
              onChanged: (value) =>
                  _selectCustomer(value == '__new__' ? null : value),
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                final width = constraints.maxWidth < 700
                    ? constraints.maxWidth
                    : (constraints.maxWidth - 12) / 2;
                Widget field(Widget child) =>
                    SizedBox(width: width, child: child);
                return Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    field(
                      TextFormField(
                        key: const ValueKey('special-order-customer-name'),
                        controller: _customerName,
                        decoration: const InputDecoration(
                          labelText: '客户姓名',
                          border: OutlineInputBorder(),
                        ),
                        validator: _requiredText,
                      ),
                    ),
                    field(
                      TextFormField(
                        key: const ValueKey('special-order-customer-phone'),
                        controller: _customerPhone,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(
                          labelText: '手机号',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    field(
                      TextFormField(
                        key: const ValueKey('special-order-customer-address'),
                        controller: _customerAddress,
                        decoration: const InputDecoration(
                          labelText: '地址',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    field(
                      TextFormField(
                        key: const ValueKey('special-order-customer-notes'),
                        controller: _customerNotes,
                        decoration: const InputDecoration(
                          labelText: '客户备注',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _paymentEditor(int index) {
    final payment = _payments[index];
    return Card(
      key: ValueKey('special-order-payment-$index'),
      margin: const EdgeInsets.symmetric(vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                SizedBox(
                  width: 230,
                  child: DropdownButtonFormField<String>(
                    key: ValueKey('special-order-payment-method-$index'),
                    initialValue: payment.paymentMethodId,
                    decoration: const InputDecoration(labelText: '支付方式'),
                    items: [
                      for (final method in _refs.paymentMethods)
                        DropdownMenuItem(
                          value: method.id,
                          child: Text(method.name),
                        ),
                    ],
                    onChanged: (value) =>
                        setState(() => payment.paymentMethodId = value),
                    validator: (value) => value == null ? '请选择支付方式' : null,
                  ),
                ),
                SizedBox(
                  width: 180,
                  child: TextFormField(
                    key: ValueKey('special-order-payment-amount-$index'),
                    controller: payment.amount,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: '金额（元）'),
                    onChanged: (_) => setState(() {}),
                    validator: _positiveMoneyValidator,
                  ),
                ),
                SizedBox(
                  width: 220,
                  child: TextFormField(
                    key: ValueKey('special-order-payment-reference-$index'),
                    controller: payment.referenceNo,
                    decoration: const InputDecoration(labelText: '流水号/凭证号'),
                  ),
                ),
              ],
            ),
            TextFormField(
              key: ValueKey('special-order-payment-remark-$index'),
              controller: payment.remark,
              decoration: const InputDecoration(labelText: '收款备注'),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: IconButton(
                tooltip: '删除支付明细',
                onPressed: () => setState(() {
                  final removed = _payments.removeAt(index);
                  removed.dispose();
                }),
                icon: const Icon(Icons.delete_outline),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ignore: unused_element
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
                key: ValueKey('special-order-product-$index'),
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
                  key: ValueKey('special-order-warehouse-$index'),
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
                key: ValueKey('special-order-quantity-$index'),
                controller: line.quantity,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: '数量'),
                validator: (value) {
                  final parsed = int.tryParse(value?.trim() ?? '');
                  return parsed == null || parsed <= 0 ? '数量必须大于 0' : null;
                },
              ),
              TextFormField(
                key: ValueKey('special-order-total-price-$index'),
                controller: line.totalPrice,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: '总价（元）'),
                onChanged: (_) => setState(() {}),
                validator: _moneyValidator,
              ),
              DropdownButtonFormField<String>(
                key: ValueKey('special-order-delivery-$index'),
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
                TextFormField(
                  key: ValueKey('special-order-item-notes-$index'),
                  controller: line.notes,
                  decoration: const InputDecoration(labelText: '明细备注'),
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
      ..totalPrice.text = _inputMoney(record.subtotalCents)
      ..notes.text = record.notes ?? ''
      ..logisticsCodes.text = record.logisticsCodes.join('\n')
      ..deliveryType = record.deliveryType;
  }

  String? productId;
  String? warehouseId;
  final quantity = TextEditingController(text: '1');
  final totalPrice = TextEditingController(text: '0');
  final notes = TextEditingController();
  final logisticsCodes = TextEditingController();
  String deliveryType = 'shipping';

  Map<String, dynamic> toJson(String orderType) {
    return {
      'productId': productId,
      if (orderType != 'buyback') 'warehouseId': warehouseId,
      'quantity': int.tryParse(quantity.text.trim()),
      'totalPriceCents': _moneyCents(totalPrice.text),
      'deliveryType': deliveryType,
      'inventoryCondition': 'saleable',
      'notes': notes.text.trim(),
      'logisticsCodes': logisticsCodes.text
          .split(RegExp(r'[\r\n,]+'))
          .map((code) => code.trim())
          .where((code) => code.isNotEmpty)
          .toList(),
    };
  }

  void dispose() {
    quantity.dispose();
    totalPrice.dispose();
    notes.dispose();
    logisticsCodes.dispose();
  }
}

class _PaymentDraft {
  _PaymentDraft({this.paymentMethodId});

  factory _PaymentDraft.fromJson(Map<String, dynamic> json) {
    return _PaymentDraft(
      paymentMethodId: _string(json['paymentMethodId']),
    )
      ..amount.text = _inputMoney(_int(json['amountCents']))
      ..referenceNo.text = _string(json['referenceNo']) ?? ''
      ..remark.text = _string(json['remark']) ?? '';
  }

  String? paymentMethodId;
  final amount = TextEditingController();
  final referenceNo = TextEditingController();
  final remark = TextEditingController();

  Map<String, dynamic> toJson() => {
        'paymentMethodId': paymentMethodId,
        'amountCents': _moneyCents(amount.text),
        'referenceNo': referenceNo.text.trim(),
        'remark': remark.text.trim(),
      };

  void dispose() {
    amount.dispose();
    referenceNo.dispose();
    remark.dispose();
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
  final normalized = text.trim();
  final match = RegExp(r'^(\d+)(?:\.(\d{1,2}))?$').firstMatch(normalized);
  if (match == null) return 0;
  final yuan = int.tryParse(match.group(1)!) ?? 0;
  final decimal = match.group(2) ?? '';
  final cents = decimal.isEmpty
      ? 0
      : int.parse(decimal.length == 1 ? '${decimal}0' : decimal);
  return yuan * 100 + cents;
}

String? _moneyValidator(String? text) {
  return RegExp(r'^\d+(?:\.\d{1,2})?$').hasMatch(text?.trim() ?? '')
      ? null
      : '请输入最多两位小数的非负金额';
}

String? _positiveMoneyValidator(String? text) {
  final validation = _moneyValidator(text);
  if (validation != null) return validation;
  return _moneyCents(text ?? '') > 0 ? null : '支付金额必须大于 0';
}

int _commissionPreviewCents(int baseCents, String percentText) {
  final match =
      RegExp(r'^(\d+)(?:\.(\d{1,2}))?$').firstMatch(percentText.trim());
  if (match == null) return 0;
  final whole = int.tryParse(match.group(1)!) ?? 0;
  final decimal = match.group(2) ?? '';
  final hundredths = decimal.isEmpty
      ? 0
      : int.parse(decimal.length == 1 ? '${decimal}0' : decimal);
  final percentHundredths = whole * 100 + hundredths;
  return (baseCents * percentHundredths + 5000) ~/ 10000;
}

String? _requiredText(String? text) =>
    text?.trim().isEmpty == false ? null : '此项必填';

String _money(int cents) => '¥${(cents / 100).toStringAsFixed(2)}';
String _inputMoney(int cents) => (cents / 100).toStringAsFixed(2);
int _int(Object? value) => value is int ? value : int.tryParse('$value') ?? 0;
String? _string(Object? value) {
  final text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

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
