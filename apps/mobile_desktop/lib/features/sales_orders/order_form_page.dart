import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class OrderFormPage extends StatefulWidget {
  const OrderFormPage({
    super.key,
    required this.apiClient,
    required this.token,
  });

  final ApiClient apiClient;
  final String token;

  @override
  State<OrderFormPage> createState() => _OrderFormPageState();
}

class _OrderFormPageState extends State<OrderFormPage> {
  late BusinessApi _businessApi;
  late DateTime _orderDate;
  late final TextEditingController _customerNameController;
  late final TextEditingController _customerPhoneController;
  late final TextEditingController _addressController;
  late final TextEditingController _orderDateController;
  late final TextEditingController _cashOnDeliveryAmountController;
  late final TextEditingController _remarkController;
  late final List<String> _provinceOptions;

  String _orderType = _orderTypeOptions.first.value;
  String? _province;
  String? _city;
  String? _district;
  bool _saving = false;
  String? _errorMessage;
  String? _successMessage;
  Map<String, dynamic>? _localDraft;
  late List<_OrderItemDraft> _items;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _orderDate = DateTime.now();
    _customerNameController = TextEditingController();
    _customerPhoneController = TextEditingController();
    _addressController = TextEditingController();
    _orderDateController = TextEditingController(text: formatDate(_orderDate));
    _cashOnDeliveryAmountController = TextEditingController();
    _remarkController = TextEditingController();
    _provinceOptions = administrativeProvinceNames();
    _items = _initialOrderItems();
  }

  @override
  void didUpdateWidget(covariant OrderFormPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
    }
  }

  @override
  void dispose() {
    _customerNameController.dispose();
    _customerPhoneController.dispose();
    _addressController.dispose();
    _orderDateController.dispose();
    _cashOnDeliveryAmountController.dispose();
    _remarkController.dispose();
    super.dispose();
  }

  Future<void> _pickOrderDate() async {
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
      initialDate: _orderDate,
      locale: const Locale('zh', 'CN'),
    );
    if (picked == null) {
      return;
    }

    setState(() {
      _orderDate = picked;
      _orderDateController.text = formatDate(picked);
    });
  }

  Future<void> _selectExistingCustomer() async {
    final selected = await showDialog<_CustomerRecord>(
      context: context,
      builder: (context) =>
          const _CustomerPickerDialog(customers: _existingCustomers),
    );

    if (selected == null) {
      return;
    }

    setState(() {
      _customerNameController.text = selected.name;
      _customerPhoneController.text = selected.phone;
      _province = selected.province;
      _city = selected.city;
      _district = selected.district;
      _addressController.text = selected.address;
    });
  }

  Future<void> _saveOrder() async {
    setState(() {
      _saving = true;
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final order = await _businessApi.createSalesOrder(_buildOrderPayload());
      if (!mounted) {
        return;
      }
      _clearForm();
      setState(() {
        _saving = false;
        _localDraft = null;
        _successMessage = '订单 ${order.orderNo} 已保存到数据库。';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  void _saveLocalDraft() {
    try {
      setState(() {
        _localDraft = _buildOrderPayload(validateRequired: false);
        _errorMessage = null;
        _successMessage = '订单草稿已暂存在本页，保存前不会写入后端。';
      });
    } catch (error) {
      setState(() {
        _errorMessage = _messageForError(error);
        _successMessage = null;
      });
    }
  }

  void _clearForm() {
    final now = DateTime.now();
    _customerNameController.clear();
    _customerPhoneController.clear();
    _addressController.clear();
    _cashOnDeliveryAmountController.clear();
    _remarkController.clear();
    _orderDate = now;
    _orderDateController.text = formatDate(now);
    _orderType = _orderTypeOptions.first.value;
    _province = null;
    _city = null;
    _district = null;
    _items = _initialOrderItems();
  }

  Map<String, dynamic> _buildOrderPayload({bool validateRequired = true}) {
    final customerName = _customerNameController.text.trim();
    if (validateRequired && customerName.isEmpty) {
      throw const _OrderFormValidationError('请填写客户姓名。');
    }

    return {
      'orderType': _orderType,
      'customerName': customerName,
      'customerPhone': _customerPhoneController.text.trim(),
      'province': _province,
      'city': _city,
      'district': _district,
      'address': _addressController.text.trim(),
      'orderDate': formatDate(_orderDate),
      'cashOnDeliveryAmountCents':
          _moneyCentsFromText(_cashOnDeliveryAmountController.text),
      'remark': _remarkController.text.trim(),
      'items': [
        for (final item in _items)
          {
            'productName': item.name,
            'quantity': item.quantity,
            'unitPriceCents': item.unitPriceCents,
            'deliveryType': item.deliveryType.value,
          },
      ],
    };
  }

  void _updateItemDeliveryType(int index, DeliveryType deliveryType) {
    setState(() {
      _items = [
        for (var itemIndex = 0; itemIndex < _items.length; itemIndex += 1)
          itemIndex == index
              ? _items[itemIndex].copyWith(deliveryType: deliveryType)
              : _items[itemIndex],
      ];
    });
  }

  @override
  Widget build(BuildContext context) {
    final cityOptions = administrativeCitiesForProvince(_province);
    final districtOptions = administrativeDistrictsForCity(_province, _city);
    final totalAmountCents = _items.fold<int>(
      0,
      (sum, item) => sum + item.quantity * item.unitPriceCents,
    );

    return ResponsivePage(
      children: [
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        if (_successMessage != null)
          _InlineNotice(message: _successMessage!, tone: StatusTone.success),
        ResponsiveTwoColumn(
          primary: Column(
            children: [
              FormSection(
                title: '客户信息',
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: OutlinedButton.icon(
                      onPressed: _selectExistingCustomer,
                      icon: const Icon(Icons.person_search_rounded),
                      label: const Text('选择历史客户'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  ResponsiveFormGrid(
                    children: [
                      TextField(
                          controller: _customerNameController,
                          onChanged: (_) => setState(() {}),
                          decoration: const InputDecoration(labelText: '客户姓名')),
                      TextField(
                        controller: _customerPhoneController,
                        onChanged: (_) => setState(() {}),
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(labelText: '电话'),
                      ),
                      DropdownButtonFormField<String>(
                        key: ValueKey('province-$_province'),
                        initialValue: _province,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: '省份'),
                        items: [
                          for (final province in _provinceOptions)
                            DropdownMenuItem(
                                value: province, child: Text(province)),
                        ],
                        onChanged: (value) {
                          setState(() {
                            _province = value;
                            _city = null;
                            _district = null;
                          });
                        },
                      ),
                      DropdownButtonFormField<String>(
                        key: ValueKey('city-${_province ?? ''}-${_city ?? ''}'),
                        initialValue: _city,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: '市'),
                        items: [
                          for (final city in cityOptions)
                            DropdownMenuItem(value: city, child: Text(city)),
                        ],
                        onChanged: cityOptions.isEmpty
                            ? null
                            : (value) {
                                setState(() {
                                  _city = value;
                                  _district = null;
                                });
                              },
                      ),
                      DropdownButtonFormField<String>(
                        key: ValueKey(
                            'district-${_province ?? ''}-${_city ?? ''}-${_district ?? ''}'),
                        initialValue: _district,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: '区县'),
                        items: [
                          for (final district in districtOptions)
                            DropdownMenuItem(
                                value: district, child: Text(district)),
                        ],
                        onChanged: districtOptions.isEmpty
                            ? null
                            : (value) => setState(() => _district = value),
                      ),
                      TextField(
                          controller: _addressController,
                          onChanged: (_) => setState(() {}),
                          decoration:
                              const InputDecoration(labelText: '具体详细地址')),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 16),
              FormSection(
                title: '订单信息',
                children: [
                  ResponsiveFormGrid(
                    children: [
                      DropdownButtonFormField<String>(
                        initialValue: _orderType,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: '订单类型'),
                        items: [
                          for (final type in _orderTypeOptions)
                            DropdownMenuItem(
                                value: type.value, child: Text(type.label)),
                        ],
                        onChanged: (value) {
                          if (value != null) {
                            setState(() => _orderType = value);
                          }
                        },
                      ),
                      TextField(
                        controller: _orderDateController,
                        readOnly: true,
                        onTap: _pickOrderDate,
                        decoration: const InputDecoration(
                          labelText: '订单日期',
                          suffixIcon: Icon(Icons.calendar_today_rounded),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _OrderItemsEditor(
                    items: _items,
                    onDeliveryTypeChanged: _updateItemDeliveryType,
                  ),
                  const SizedBox(height: 12),
                  ResponsiveFormGrid(
                    children: [
                      TextField(
                        controller: _cashOnDeliveryAmountController,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        decoration: const InputDecoration(
                          labelText: '货到付款金额',
                          prefixText: '¥ ',
                        ),
                      ),
                      TextField(
                        controller: _remarkController,
                        decoration: const InputDecoration(labelText: '备注'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  SectionActions(
                    primaryLabel: _saving ? '保存中...' : '保存订单',
                    secondaryLabel: _localDraft == null ? '暂存本页' : '更新草稿',
                    onPrimaryPressed: _saving ? null : _saveOrder,
                    onSecondaryPressed: _saving ? null : _saveLocalDraft,
                  ),
                ],
              ),
            ],
          ),
          secondary: _OrderSummary(
            orderDate: _orderDate,
            orderTypeLabel: _orderTypeLabel(_orderType),
            customerName: _customerNameController.text,
            customerPhone: _customerPhoneController.text,
            totalAmountCents: totalAmountCents,
            localDraft: _localDraft,
          ),
        ),
      ],
    );
  }
}

class _CustomerPickerDialog extends StatefulWidget {
  const _CustomerPickerDialog({required this.customers});

  final List<_CustomerRecord> customers;

  @override
  State<_CustomerPickerDialog> createState() => _CustomerPickerDialogState();
}

class _CustomerPickerDialogState extends State<_CustomerPickerDialog> {
  late final TextEditingController _searchController;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<_CustomerRecord> get _visibleCustomers {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) {
      return widget.customers;
    }
    return widget.customers.where((customer) {
      return [
        customer.name,
        customer.phone,
        customer.province,
        customer.city,
        customer.district,
        customer.address,
      ].any((value) => value.toLowerCase().contains(query));
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final visibleCustomers = _visibleCustomers;
    return AlertDialog(
      title: const Text('选择历史客户'),
      content: SizedBox(
        width: 460,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _searchController,
              onChanged: (value) => setState(() => _query = value),
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: IconButton(
                  tooltip: '清空',
                  onPressed: () {
                    _searchController.clear();
                    setState(() => _query = '');
                  },
                  icon: const Icon(Icons.close_rounded),
                ),
                hintText: '搜索姓名、电话、地址',
              ),
            ),
            const SizedBox(height: 12),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 360),
              child: visibleCustomers.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 28),
                      child: Center(child: Text('没有匹配的历史客户')),
                    )
                  : ListView.separated(
                      shrinkWrap: true,
                      itemCount: visibleCustomers.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final customer = visibleCustomers[index];
                        return ListTile(
                          leading: const Icon(Icons.person_search_rounded),
                          title: Text('${customer.name} · ${customer.phone}'),
                          subtitle: Text(
                            '${customer.province}${customer.city}${customer.district} ${customer.address}',
                          ),
                          trailing: customer.marked
                              ? const StatusTag(
                                  label: '已标记',
                                  tone: StatusTone.success,
                                )
                              : null,
                          onTap: () => Navigator.of(context).pop(customer),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OrderItemsEditor extends StatelessWidget {
  const _OrderItemsEditor({
    required this.items,
    required this.onDeliveryTypeChanged,
  });

  final List<_OrderItemDraft> items;
  final void Function(int index, DeliveryType deliveryType)
      onDeliveryTypeChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '酒品明细',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                TextButton.icon(
                  onPressed: null,
                  icon: const Icon(Icons.add_rounded),
                  label: const Text('添加待后续'),
                ),
              ],
            ),
            const Divider(),
            for (var index = 0; index < items.length; index += 1)
              _ItemRow(
                item: items[index],
                onDeliveryTypeChanged: (deliveryType) =>
                    onDeliveryTypeChanged(index, deliveryType),
              ),
          ],
        ),
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({
    required this.item,
    required this.onDeliveryTypeChanged,
  });

  final _OrderItemDraft item;
  final ValueChanged<DeliveryType> onDeliveryTypeChanged;

  @override
  Widget build(BuildContext context) {
    final nameBlock = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(item.name, style: const TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 2),
        Text('数量 x${item.quantity}',
            style: Theme.of(context).textTheme.bodySmall),
      ],
    );
    final deliveryField = DropdownButtonFormField<DeliveryType>(
      initialValue: item.deliveryType,
      isExpanded: true,
      decoration: const InputDecoration(labelText: '配送方式'),
      items: [
        for (final type in DeliveryType.values)
          DropdownMenuItem(value: type, child: Text(type.label)),
      ],
      onChanged: (value) {
        if (value != null) {
          onDeliveryTypeChanged(value);
        }
      },
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final total = MoneyText(cents: item.unitPriceCents * item.quantity);
        if (constraints.maxWidth < 580) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: nameBlock),
                    total,
                  ],
                ),
                const SizedBox(height: 8),
                deliveryField,
              ],
            ),
          );
        }

        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Expanded(child: nameBlock),
              SizedBox(width: 152, child: deliveryField),
              const SizedBox(width: 16),
              SizedBox(
                  width: 104,
                  child: Align(alignment: Alignment.centerRight, child: total)),
            ],
          ),
        );
      },
    );
  }
}

class _OrderSummary extends StatelessWidget {
  const _OrderSummary({
    required this.orderDate,
    required this.orderTypeLabel,
    required this.customerName,
    required this.customerPhone,
    required this.totalAmountCents,
    required this.localDraft,
  });

  final DateTime orderDate;
  final String orderTypeLabel;
  final String customerName;
  final String customerPhone;
  final int totalAmountCents;
  final Map<String, dynamic>? localDraft;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      title: '订单核对',
      children: [
        Row(
          children: [
            const Expanded(child: Text('订单日期')),
            Text(formatDate(orderDate)),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            const Expanded(child: Text('订单类型')),
            Text(orderTypeLabel),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            const Expanded(child: Text('客户')),
            Text(
              customerName.trim().isEmpty
                  ? '未选择客户'
                  : '$customerName ${customerPhone.trim()}',
            ),
          ],
        ),
        const Divider(height: 24),
        Row(
          children: [
            const Expanded(child: Text('订单合计')),
            MoneyText(cents: totalAmountCents, prominent: true),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            const StatusTag(label: '逐项配送', tone: StatusTone.info),
            const StatusTag(label: '待打包', tone: StatusTone.warning),
            if (localDraft != null)
              const StatusTag(label: '本页草稿', tone: StatusTone.success),
          ],
        ),
      ],
    );
  }
}

class _CustomerRecord {
  const _CustomerRecord({
    required this.name,
    required this.phone,
    required this.province,
    required this.city,
    required this.district,
    required this.address,
    required this.marked,
  });

  final String name;
  final String phone;
  final String province;
  final String city;
  final String district;
  final String address;
  final bool marked;
}

class _OrderTypeOption {
  const _OrderTypeOption(this.value, this.label);

  final String value;
  final String label;
}

class _OrderItemDraft {
  const _OrderItemDraft({
    required this.name,
    required this.quantity,
    required this.unitPriceCents,
    required this.deliveryType,
  });

  final String name;
  final int quantity;
  final int unitPriceCents;
  final DeliveryType deliveryType;

  _OrderItemDraft copyWith({DeliveryType? deliveryType}) {
    return _OrderItemDraft(
      name: name,
      quantity: quantity,
      unitPriceCents: unitPriceCents,
      deliveryType: deliveryType ?? this.deliveryType,
    );
  }
}

class _OrderFormValidationError implements Exception {
  const _OrderFormValidationError(this.message);

  final String message;
}

const _orderTypeOptions = <_OrderTypeOption>[
  _OrderTypeOption('travel_group', '旅行团订单'),
  _OrderTypeOption('buyback', '回购订单'),
  _OrderTypeOption('external', '外销订单'),
  _OrderTypeOption('internal', '内购订单'),
  _OrderTypeOption('after_sales', '售后订单'),
];

List<_OrderItemDraft> _initialOrderItems() {
  return const [
    _OrderItemDraft(
      name: '酱香珍藏 53°',
      quantity: 2,
      unitPriceCents: 129900,
      deliveryType: DeliveryType.shipping,
    ),
    _OrderItemDraft(
      name: '年份礼盒',
      quantity: 1,
      unitPriceCents: 388000,
      deliveryType: DeliveryType.selfPickup,
    ),
  ];
}

const _existingCustomers = <_CustomerRecord>[
  _CustomerRecord(
    name: '王女士',
    phone: '13800006621',
    province: '贵州省',
    city: '贵阳市',
    district: '观山湖区',
    address: '示例收货地址 18 号',
    marked: true,
  ),
  _CustomerRecord(
    name: '陈先生',
    phone: '13900001024',
    province: '四川省',
    city: '成都市',
    district: '锦江区',
    address: '示例收货地址 26 号',
    marked: false,
  ),
  _CustomerRecord(
    name: '周女士',
    phone: '13700000044',
    province: '重庆市',
    city: '重庆市',
    district: '渝中区',
    address: '示例收货地址 8 号',
    marked: false,
  ),
];

String _orderTypeLabel(String value) {
  for (final option in _orderTypeOptions) {
    if (option.value == value) {
      return option.label;
    }
  }
  return _orderTypeOptions.first.label;
}

int _moneyCentsFromText(String value) {
  final text = value.trim();
  if (text.isEmpty) {
    return 0;
  }
  final normalized = text.replaceAll(',', '');
  final amount = double.tryParse(normalized);
  if (amount == null || amount <= 0) {
    return 0;
  }
  return (amount * 100).round();
}

String _messageForError(Object error) {
  if (error is _OrderFormValidationError) {
    return error.message;
  }
  if (error is ApiException) {
    return error.message;
  }
  return '订单保存失败，请稍后重试。';
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({
    required this.message,
    required this.tone,
  });

  final String message;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: StatusTag(label: message, tone: tone),
    );
  }
}
