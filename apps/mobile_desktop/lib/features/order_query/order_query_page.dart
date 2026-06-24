import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/mark_info_button.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class OrderQueryPage extends StatefulWidget {
  const OrderQueryPage({
    super.key,
    required this.apiClient,
    required this.token,
  });

  final ApiClient apiClient;
  final String token;

  @override
  State<OrderQueryPage> createState() => _OrderQueryPageState();
}

class _OrderQueryPageState extends State<OrderQueryPage> {
  late BusinessApi _businessApi;
  late final TextEditingController _customerNameController;
  late final TextEditingController _customerPhoneController;
  late final TextEditingController _addressController;
  late final TextEditingController _codController;

  DateTime _start = DateTime(2026, 6, 1);
  DateTime _end = DateTime(2026, 6, 23);
  String _statusFilter = '全部';
  String _deliveryFilter = '全部';
  late List<_OrderRecord> _orders;
  late _OrderRecord _selected;
  bool _editing = false;
  String _editStatus = '有效';
  bool _editOrderMarked = false;
  bool _editCustomerMarked = false;
  bool _editInvoiceIssued = false;
  bool _loading = true;
  String? _errorMessage;
  final Set<String> _markingOrderIds = <String>{};

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _orders = [for (final record in _seedOrderRecords) record];
    _selected = _orders.first;
    _customerNameController = TextEditingController();
    _customerPhoneController = TextEditingController();
    _addressController = TextEditingController();
    _codController = TextEditingController();
    _fillEditDraft(_selected);
    _loadData();
  }

  @override
  void didUpdateWidget(covariant OrderQueryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadData();
    }
  }

  @override
  void dispose() {
    _customerNameController.dispose();
    _customerPhoneController.dispose();
    _addressController.dispose();
    _codController.dispose();
    super.dispose();
  }

  void _fillEditDraft(_OrderRecord record) {
    _customerNameController.text = record.customerName;
    _customerPhoneController.text = record.customerPhone;
    _addressController.text = record.address;
    _codController.text = _yuanText(record.codCents);
    _editStatus = record.status;
    _editOrderMarked = record.orderMarked;
    _editCustomerMarked = record.customerMarked;
    _editInvoiceIssued = record.invoiceIssued;
  }

  void _selectOrder(_OrderRecord record) {
    setState(() {
      _selected = record;
      _editing = false;
      _fillEditDraft(record);
    });
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final orders = await _businessApi.listSalesOrders(limit: 200);
      final records = orders.map(_orderFromSalesOrder).toList();
      if (!mounted) {
        return;
      }
      setState(() {
        if (records.isNotEmpty) {
          _orders = records;
          _selected = _selectedFrom(records, _selected.id);
          _fillEditDraft(_selected);
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

  Future<void> _toggleOrderMark(_OrderRecord record) async {
    setState(() {
      _markingOrderIds.add(record.id);
      _errorMessage = null;
    });
    try {
      final updated = await _businessApi.setSalesOrderFinanceMark(
        record.id,
        !record.orderMarked,
      );
      if (!mounted) {
        return;
      }
      _replaceOrder(_orderFromSalesOrder(updated), keepEditing: _editing);
      setState(() {
        _markingOrderIds.remove(record.id);
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _markingOrderIds.remove(record.id);
        _errorMessage = _messageForError(error);
      });
    }
  }

  void _setInvoiceIssued(bool value) {
    setState(() {
      _editInvoiceIssued = value;
    });
  }

  void _replaceOrder(_OrderRecord updated, {bool keepEditing = false}) {
    setState(() {
      _orders = [
        for (final record in _orders)
          if (record.id == updated.id) updated else record,
      ];
      if (_selected.id == updated.id) {
        _selected = updated;
        _fillEditDraft(updated);
      }
      _editing = keepEditing;
    });
  }

  void _saveEdit() {
    final updated = _selected.copyWith(
      customerName: _customerNameController.text.trim(),
      customerPhone: _customerPhoneController.text.trim(),
      address: _addressController.text.trim(),
      status: _editStatus,
      tone: _toneForStatus(_editStatus),
      codCents: _centsFromText(_codController.text),
      invoiceIssued: _editInvoiceIssued,
    );
    _replaceOrder(updated);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('订单修改已暂存。')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final records = _orders.where((record) {
      final statusMatched =
          _statusFilter == '全部' || record.status == _statusFilter;
      final deliveryMatched =
          _deliveryFilter == '全部' || record.deliveryLabel == _deliveryFilter;
      return statusMatched && deliveryMatched;
    }).toList();

    return ResponsivePage(
      children: [
        if (_errorMessage != null)
          Align(
            alignment: Alignment.centerLeft,
            child: StatusTag(label: _errorMessage!, tone: StatusTone.danger),
          ),
        if (_loading) const LinearProgressIndicator(),
        FormSection(
          title: '订单管理筛选',
          trailing:
              StatusTag(label: '${records.length} 笔订单', tone: StatusTone.info),
          children: [
            ResponsiveFormGrid(
              children: [
                const AppSearchField(hintText: '搜索订单号、客户、电话、旅行团'),
                AppDateRangeButton(
                  start: _start,
                  end: _end,
                  onChanged: (range) => setState(() {
                    _start = range.start;
                    _end = range.end;
                  }),
                ),
                DropdownButtonFormField<String>(
                  initialValue: _deliveryFilter,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: '配送方式'),
                  items: const [
                    DropdownMenuItem(value: '全部', child: Text('全部')),
                    DropdownMenuItem(value: '邮寄', child: Text('邮寄')),
                    DropdownMenuItem(value: '自带', child: Text('自带')),
                    DropdownMenuItem(value: '混合', child: Text('混合')),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _deliveryFilter = value);
                    }
                  },
                ),
              ],
            ),
          ],
        ),
        MetricGrid(
          metrics: [
            MetricData(
                label: '订单数',
                value: '${records.length}',
                icon: Icons.receipt_long_rounded),
            MetricData(
                label: '订单金额',
                value: formatMoneyCents(records.fold<int>(
                    0, (sum, item) => sum + item.amountCents)),
                icon: Icons.payments_rounded),
            MetricData(
                label: '待打包',
                value:
                    '${records.where((item) => item.status == '待打包').length}',
                icon: Icons.inventory_2_rounded),
            MetricData(
                label: '已标记',
                value: '${records.where((item) => item.orderMarked).length}',
                icon: Icons.bookmark_added_rounded),
          ],
        ),
        ResponsiveTwoColumn(
          primary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppFilterBar(
                filters: const ['全部', '有效', '待打包', '已退单'],
                selected: _statusFilter,
                onSelected: (value) => setState(() => _statusFilter = value),
              ),
              const SizedBox(height: 12),
              AppRecordList(
                items: [
                  for (final record in records)
                    AppRecordItem(
                      title: record.orderNo,
                      subtitle:
                          '${record.customerName} · ${record.customerPhone}',
                      meta: [
                        record.groupNo,
                        record.deliveryLabel,
                        record.invoiceIssued ? '已开发票' : '未开发票',
                      ],
                      icon: Icons.receipt_long_rounded,
                      trailing: Wrap(
                        spacing: 8,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          MoneyText(cents: record.amountCents),
                          MarkInfoButton(
                            marked: record.orderMarked,
                            label: '标记',
                            compact: true,
                            busy: _markingOrderIds.contains(record.id),
                            onPressed: _markingOrderIds.contains(record.id)
                                ? null
                                : () => _toggleOrderMark(record),
                          ),
                        ],
                      ),
                      onTap: () => _selectOrder(record),
                    ),
                ],
              ),
            ],
          ),
          secondary: _OrderManagementPanel(
            record: _selected,
            editing: _editing,
            customerNameController: _customerNameController,
            customerPhoneController: _customerPhoneController,
            addressController: _addressController,
            codController: _codController,
            editStatus: _editStatus,
            editOrderMarked: _editOrderMarked,
            editCustomerMarked: _editCustomerMarked,
            editInvoiceIssued: _editInvoiceIssued,
            onEdit: () => setState(() => _editing = true),
            onCancelEdit: () => setState(() {
              _editing = false;
              _fillEditDraft(_selected);
            }),
            onSaveEdit: _saveEdit,
            onStatusChanged: (value) => setState(() => _editStatus = value),
            onOrderMarkedChanged: () => _toggleOrderMark(_selected),
            onCustomerMarkedChanged: () {},
            onInvoiceChanged: _setInvoiceIssued,
          ),
        ),
      ],
    );
  }
}

_OrderRecord _selectedFrom(List<_OrderRecord> records, String selectedId) {
  for (final record in records) {
    if (record.id == selectedId) {
      return record;
    }
  }
  return records.first;
}

_OrderRecord _orderFromSalesOrder(SalesOrderRecord order) {
  final deliveryTypes = order.items.map((item) => item.deliveryType).toSet();
  final deliveryLabel = deliveryTypes.length > 1
      ? '混合'
      : _deliveryLabelForType(
          deliveryTypes.isEmpty ? 'shipping' : deliveryTypes.first);
  final statusLabel = _statusLabelForOrderStatus(order.status);
  return _OrderRecord(
    id: order.id,
    orderNo: order.orderNo,
    customerName: order.customerName,
    customerPhone: order.customerPhone ?? '',
    customerMarked: order.financeMark,
    groupNo: order.travelGroup?.groupNo ?? '散客',
    address: order.address ?? '',
    deliveryLabel: deliveryLabel,
    status: statusLabel,
    tone: _toneForOrderStatus(order.status),
    amountCents: order.totalAmountCents,
    codCents: order.cashOnDeliveryAmountCents,
    invoiceIssued: false,
    orderMarked: order.financeMark,
    items: order.items
        .map(
          (item) => _OrderItem(
            name: item.productName,
            quantity: item.quantity,
            deliveryLabel: _deliveryLabelForType(item.deliveryType),
          ),
        )
        .toList(),
  );
}

String _deliveryLabelForType(String deliveryType) {
  switch (deliveryType) {
    case 'self_pickup':
      return '自提';
    case 'shipping':
    default:
      return '邮寄';
  }
}

String _statusLabelForOrderStatus(String status) {
  switch (status) {
    case 'partial_refund':
      return '部分退款';
    case 'refunded':
      return '已退款';
    case 'cancelled':
      return '已取消';
    case 'valid':
    default:
      return '有效';
  }
}

StatusTone _toneForOrderStatus(String status) {
  switch (status) {
    case 'refunded':
    case 'cancelled':
      return StatusTone.danger;
    case 'partial_refund':
      return StatusTone.warning;
    case 'valid':
    default:
      return StatusTone.success;
  }
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}

class _OrderManagementPanel extends StatelessWidget {
  const _OrderManagementPanel({
    required this.record,
    required this.editing,
    required this.customerNameController,
    required this.customerPhoneController,
    required this.addressController,
    required this.codController,
    required this.editStatus,
    required this.editOrderMarked,
    required this.editCustomerMarked,
    required this.editInvoiceIssued,
    required this.onEdit,
    required this.onCancelEdit,
    required this.onSaveEdit,
    required this.onStatusChanged,
    required this.onOrderMarkedChanged,
    required this.onCustomerMarkedChanged,
    required this.onInvoiceChanged,
  });

  final _OrderRecord record;
  final bool editing;
  final TextEditingController customerNameController;
  final TextEditingController customerPhoneController;
  final TextEditingController addressController;
  final TextEditingController codController;
  final String editStatus;
  final bool editOrderMarked;
  final bool editCustomerMarked;
  final bool editInvoiceIssued;
  final VoidCallback onEdit;
  final VoidCallback onCancelEdit;
  final VoidCallback onSaveEdit;
  final ValueChanged<String> onStatusChanged;
  final VoidCallback onOrderMarkedChanged;
  final VoidCallback onCustomerMarkedChanged;
  final ValueChanged<bool> onInvoiceChanged;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      title: editing ? '编辑订单' : '订单详情',
      trailing: StatusTag(label: record.status, tone: record.tone),
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            MarkInfoButton(
              marked: record.orderMarked,
              label: '订单标记',
              onPressed: editing ? null : onOrderMarkedChanged,
            ),
            MarkInfoButton(
              marked: record.customerMarked,
              label: '客户标记',
              onPressed: null,
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (editing)
          _OrderEditFields(
            customerNameController: customerNameController,
            customerPhoneController: customerPhoneController,
            addressController: addressController,
            codController: codController,
            editStatus: editStatus,
            editInvoiceIssued: editInvoiceIssued,
            onStatusChanged: onStatusChanged,
            onInvoiceChanged: onInvoiceChanged,
          )
        else
          _OrderReadOnlyDetail(record: record),
        const Divider(height: 24),
        Text('酒品明细',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        for (final item in record.items)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Expanded(child: Text(item.name)),
                Text('x${item.quantity}'),
                const SizedBox(width: 12),
                StatusTag(label: item.deliveryLabel, tone: StatusTone.neutral),
              ],
            ),
          ),
        const Divider(height: 24),
        Row(
          children: [
            const Expanded(child: Text('订单金额')),
            MoneyText(cents: record.amountCents, prominent: true),
          ],
        ),
        const SizedBox(height: 14),
        if (editing)
          SectionActions(
            primaryLabel: '保存修改',
            secondaryLabel: '取消',
            onPrimaryPressed: onSaveEdit,
            onSecondaryPressed: onCancelEdit,
          )
        else
          Wrap(
            alignment: WrapAlignment.end,
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                onPressed: () => _showOrderQrDialog(context, record),
                icon: const Icon(Icons.qr_code_2_rounded),
                label: const Text('生成二维码'),
              ),
              FilledButton.icon(
                onPressed: onEdit,
                icon: const Icon(Icons.edit_rounded),
                label: const Text('编辑订单'),
              ),
            ],
          ),
      ],
    );
  }
}

void _showOrderQrDialog(BuildContext context, _OrderRecord record) {
  final payload = _orderQrPayload(record);
  showDialog<void>(
    context: context,
    builder: (context) {
      return AlertDialog(
        title: const Text('订单二维码'),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _OrderQrPreview(record: record, payload: payload),
                const SizedBox(height: 14),
                Text(
                  '二维码内容',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                SelectableText(
                  payload,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('关闭'),
          ),
        ],
      );
    },
  );
}

class _OrderQrPreview extends StatelessWidget {
  const _OrderQrPreview({required this.record, required this.payload});

  final _OrderRecord record;
  final String payload;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 180,
              child: AspectRatio(
                aspectRatio: 1,
                child: _GeneratedQrMatrix(seed: payload, color: scheme.primary),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              record.orderNo,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 4),
            Text(
              '${record.customerName} · ${record.customerPhone}',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 4),
            MoneyText(cents: record.amountCents, prominent: true),
          ],
        ),
      ),
    );
  }
}

class _GeneratedQrMatrix extends StatelessWidget {
  const _GeneratedQrMatrix({required this.seed, required this.color});

  final String seed;
  final Color color;

  @override
  Widget build(BuildContext context) {
    const size = 17;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: GridView.builder(
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: size,
          ),
          itemCount: size * size,
          itemBuilder: (context, index) {
            final row = index ~/ size;
            final col = index % size;
            final active = _isQrCellActive(seed, row, col, size);
            return Padding(
              padding: const EdgeInsets.all(0.8),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: active ? color : Colors.transparent,
                  borderRadius: const BorderRadius.all(Radius.circular(1)),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _OrderEditFields extends StatelessWidget {
  const _OrderEditFields({
    required this.customerNameController,
    required this.customerPhoneController,
    required this.addressController,
    required this.codController,
    required this.editStatus,
    required this.editInvoiceIssued,
    required this.onStatusChanged,
    required this.onInvoiceChanged,
  });

  final TextEditingController customerNameController;
  final TextEditingController customerPhoneController;
  final TextEditingController addressController;
  final TextEditingController codController;
  final String editStatus;
  final bool editInvoiceIssued;
  final ValueChanged<String> onStatusChanged;
  final ValueChanged<bool> onInvoiceChanged;

  @override
  Widget build(BuildContext context) {
    return ResponsiveFormGrid(
      children: [
        TextField(
          controller: customerNameController,
          decoration: const InputDecoration(labelText: '客户姓名'),
        ),
        TextField(
          controller: customerPhoneController,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(labelText: '电话'),
        ),
        DropdownButtonFormField<String>(
          key: ValueKey(editStatus),
          initialValue: editStatus,
          isExpanded: true,
          decoration: const InputDecoration(labelText: '订单状态'),
          items: const [
            DropdownMenuItem(value: '有效', child: Text('有效')),
            DropdownMenuItem(value: '待打包', child: Text('待打包')),
            DropdownMenuItem(value: '已退单', child: Text('已退单')),
          ],
          onChanged: (value) {
            if (value != null) {
              onStatusChanged(value);
            }
          },
        ),
        TextField(
          controller: codController,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(
            labelText: '货到付款',
            prefixText: '¥ ',
          ),
        ),
        TextField(
          controller: addressController,
          decoration: const InputDecoration(labelText: '收货地址'),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('订单已开发票'),
          value: editInvoiceIssued,
          onChanged: onInvoiceChanged,
        ),
      ],
    );
  }
}

class _OrderReadOnlyDetail extends StatelessWidget {
  const _OrderReadOnlyDetail({required this.record});

  final _OrderRecord record;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _InfoRow(label: '订单号', value: record.orderNo),
        _InfoRow(
            label: '客户',
            value: '${record.customerName} · ${record.customerPhone}'),
        _InfoRow(label: '旅行团', value: record.groupNo),
        _InfoRow(label: '收货地址', value: record.address),
        _InfoRow(label: '货到付款', value: formatMoneyCents(record.codCents)),
        _InfoRow(label: '发票状态', value: record.invoiceIssued ? '已开发票' : '未开发票'),
      ],
    );
  }
}

String _orderQrPayload(_OrderRecord record) {
  return [
    '订单号: ${record.orderNo}',
    '客户: ${record.customerName}',
    '电话: ${record.customerPhone}',
    '旅行团: ${record.groupNo}',
    '配送: ${record.deliveryLabel}',
    '订单状态: ${record.status}',
    '订单金额: ${formatMoneyCents(record.amountCents)}',
    '货到付款: ${formatMoneyCents(record.codCents)}',
    '发票状态: ${record.invoiceIssued ? '已开发票' : '未开发票'}',
    '酒品明细: ${record.itemSummary}',
  ].join('\n');
}

bool _isQrCellActive(String seed, int row, int col, int size) {
  final finderValue = _finderCellValue(row, col, size);
  if (finderValue != null) {
    return finderValue;
  }

  var hash = seed.length + row * 37 + col * 17;
  for (final unit in seed.codeUnits) {
    hash = (hash * 33 + unit + row + col) & 0x7fffffff;
  }
  return hash % 7 == 0 || hash % 11 < 4;
}

bool? _finderCellValue(int row, int col, int size) {
  final inTopLeft = row < 7 && col < 7;
  final inTopRight = row < 7 && col >= size - 7;
  final inBottomLeft = row >= size - 7 && col < 7;
  if (!inTopLeft && !inTopRight && !inBottomLeft) {
    return null;
  }

  final localRow = row < 7 ? row : row - (size - 7);
  final localCol = col < 7 ? col : col - (size - 7);
  final onOuter =
      localRow == 0 || localRow == 6 || localCol == 0 || localCol == 6;
  final inCenter =
      localRow >= 2 && localRow <= 4 && localCol >= 2 && localCol <= 4;
  return onOuter || inCenter;
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
              width: 76,
              child: Text(label, style: Theme.of(context).textTheme.bodySmall)),
          Expanded(
              child: Text(value,
                  style: const TextStyle(fontWeight: FontWeight.w700))),
        ],
      ),
    );
  }
}

class _OrderRecord {
  const _OrderRecord({
    required this.id,
    required this.orderNo,
    required this.customerName,
    required this.customerPhone,
    required this.customerMarked,
    required this.groupNo,
    required this.address,
    required this.deliveryLabel,
    required this.status,
    required this.tone,
    required this.amountCents,
    required this.codCents,
    required this.invoiceIssued,
    required this.orderMarked,
    required this.items,
  });

  final String id;
  final String orderNo;
  final String customerName;
  final String customerPhone;
  final bool customerMarked;
  final String groupNo;
  final String address;
  final String deliveryLabel;
  final String status;
  final StatusTone tone;
  final int amountCents;
  final int codCents;
  final bool invoiceIssued;
  final bool orderMarked;
  final List<_OrderItem> items;

  _OrderRecord copyWith({
    String? customerName,
    String? customerPhone,
    bool? customerMarked,
    String? address,
    String? status,
    StatusTone? tone,
    int? codCents,
    bool? invoiceIssued,
    bool? orderMarked,
  }) {
    return _OrderRecord(
      id: id,
      orderNo: orderNo,
      customerName: customerName ?? this.customerName,
      customerPhone: customerPhone ?? this.customerPhone,
      customerMarked: customerMarked ?? this.customerMarked,
      groupNo: groupNo,
      address: address ?? this.address,
      deliveryLabel: deliveryLabel,
      status: status ?? this.status,
      tone: tone ?? this.tone,
      amountCents: amountCents,
      codCents: codCents ?? this.codCents,
      invoiceIssued: invoiceIssued ?? this.invoiceIssued,
      orderMarked: orderMarked ?? this.orderMarked,
      items: items,
    );
  }

  String get itemSummary =>
      items.map((item) => '${item.name} x${item.quantity}').join('、');
}

class _OrderItem {
  const _OrderItem({
    required this.name,
    required this.quantity,
    required this.deliveryLabel,
  });

  final String name;
  final int quantity;
  final String deliveryLabel;
}

const _seedOrderRecords = <_OrderRecord>[
  _OrderRecord(
    id: 'SO-20260622-031',
    orderNo: 'SO-20260622-031',
    customerName: '王女士',
    customerPhone: '138****6621',
    customerMarked: true,
    groupNo: 'GZ-0622-018',
    address: '贵州省贵阳市观山湖区示例收货地址',
    deliveryLabel: '混合',
    status: '待打包',
    tone: StatusTone.warning,
    amountCents: 647800,
    codCents: 150000,
    invoiceIssued: true,
    orderMarked: true,
    items: [
      _OrderItem(name: '酱香珍藏 53°', quantity: 2, deliveryLabel: '邮寄'),
      _OrderItem(name: '年份礼盒', quantity: 1, deliveryLabel: '自带'),
    ],
  ),
  _OrderRecord(
    id: 'SO-20260622-024',
    orderNo: 'SO-20260622-024',
    customerName: '陈先生',
    customerPhone: '139****1024',
    customerMarked: false,
    groupNo: 'GZ-0622-016',
    address: '四川省成都市锦江区示例收货地址',
    deliveryLabel: '邮寄',
    status: '有效',
    tone: StatusTone.success,
    amountCents: 1299000,
    codCents: 0,
    invoiceIssued: false,
    orderMarked: false,
    items: [
      _OrderItem(name: '酱酒礼盒', quantity: 3, deliveryLabel: '邮寄'),
    ],
  ),
  _OrderRecord(
    id: 'SO-20260621-044',
    orderNo: 'SO-20260621-044',
    customerName: '周女士',
    customerPhone: '137****0044',
    customerMarked: false,
    groupNo: '散客',
    address: '重庆市渝中区示例收货地址',
    deliveryLabel: '自带',
    status: '已退单',
    tone: StatusTone.danger,
    amountCents: -68000,
    codCents: 0,
    invoiceIssued: false,
    orderMarked: false,
    items: [
      _OrderItem(name: '散瓶组合', quantity: 1, deliveryLabel: '自带'),
    ],
  ),
];

StatusTone _toneForStatus(String status) {
  switch (status) {
    case '待打包':
      return StatusTone.warning;
    case '已退单':
      return StatusTone.danger;
    case '有效':
    default:
      return StatusTone.success;
  }
}

int _centsFromText(String value) {
  final normalized = value.replaceAll(',', '').replaceAll('¥', '').trim();
  if (normalized.isEmpty) {
    return 0;
  }
  final amount = double.tryParse(normalized) ?? 0;
  return (amount * 100).round();
}

String _yuanText(int cents) {
  if (cents == 0) {
    return '';
  }
  return (cents / 100).toStringAsFixed(2);
}
