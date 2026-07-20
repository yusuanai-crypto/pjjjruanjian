import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/product_option_picker.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';
import '../customers/customer_picker_dialog.dart';
import '../travel_groups/travel_group_picker_dialog.dart';

class OrderFormPage extends StatefulWidget {
  const OrderFormPage({
    super.key,
    required this.apiClient,
    required this.token,
    this.role = UserRole.sales,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

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

  CustomerRecord? _selectedCustomer;
  TravelGroupRecord? _selectedTravelGroup;
  String? _province;
  String? _city;
  String? _district;
  bool _saving = false;
  String? _errorMessage;
  String? _successMessage;
  String? _lastSavedOrderNo;
  Map<String, dynamic>? _localDraft;
  late List<_OrderItemDraft> _items;
  List<ProductOptionRecord> _productOptions = const [];
  bool _loadingProductOptions = true;
  String? _productOptionsError;

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
    _loadProductOptions();
  }

  @override
  void didUpdateWidget(covariant OrderFormPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadProductOptions();
    }
  }

  Future<void> _loadProductOptions() async {
    setState(() {
      _loadingProductOptions = true;
      _productOptionsError = null;
    });
    try {
      final options = await _businessApi.listProductOptions();
      if (!mounted) return;
      setState(() {
        _productOptions = options;
        _loadingProductOptions = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _productOptions = const [];
        _loadingProductOptions = false;
        _productOptionsError = _messageForError(error);
      });
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
    _disposeItems();
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

  Future<void> _selectCustomer() async {
    final selected = await showDialog<CustomerRecord>(
      context: context,
      builder: (context) => CustomerPickerDialog(
        businessApi: _businessApi,
        initialQuery: _customerNameController.text.trim(),
        showFinanceMark: canViewFinanceMark(widget.role),
      ),
    );

    if (selected == null) {
      return;
    }
    _applyCustomer(selected);
  }

  Future<void> _selectTravelGroup() async {
    final selected = await showDialog<TravelGroupRecord>(
      context: context,
      builder: (context) => TravelGroupPickerDialog(
        businessApi: _businessApi,
        initialQuery: _selectedTravelGroup?.groupNo,
        showFinanceMark: canViewFinanceMark(widget.role),
      ),
    );

    if (selected == null) {
      return;
    }
    setState(() => _selectedTravelGroup = selected);
  }

  Future<void> _saveOrder() async {
    setState(() {
      _saving = true;
      _errorMessage = null;
      _successMessage = null;
      _lastSavedOrderNo = null;
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
        _lastSavedOrderNo = order.orderNo;
        _successMessage = '系统单号 ${order.orderNo} 已保存。';
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
        _lastSavedOrderNo = null;
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
    _selectedCustomer = null;
    _selectedTravelGroup = null;
    _province = null;
    _city = null;
    _district = null;
    _replaceItems(_initialOrderItems());
  }

  Map<String, dynamic> _buildOrderPayload({bool validateRequired = true}) {
    final payload = <String, dynamic>{
      'orderType': _orderEntryOrderType,
      'orderDate': formatDate(_orderDate),
    };
    final travelGroupId = _selectedTravelGroup?.id.trim() ?? '';
    if (validateRequired && travelGroupId.isEmpty) {
      throw const _OrderFormValidationError('请选择旅行团。');
    }
    if (travelGroupId.isNotEmpty) {
      payload['travelGroupId'] = travelGroupId;
    }
    _putNonEmpty(payload, 'remark', _remarkController.text);

    final cashOnDeliveryAmountCents =
        _moneyCentsOrNull(_cashOnDeliveryAmountController.text);
    if (cashOnDeliveryAmountCents == null) {
      throw const _OrderFormValidationError('货到付款金额必须为有效的非负金额。');
    }
    payload['cashOnDeliveryAmountCents'] = cashOnDeliveryAmountCents;

    final customerPayload = _customerPayload(validateRequired);
    if (_selectedCustomer != null) {
      payload['customerId'] = _selectedCustomer!.id;
    } else if (customerPayload != null) {
      payload['customer'] = customerPayload;
    }

    final itemPayloads = _itemPayloads(validateRequired: validateRequired);
    if (validateRequired && itemPayloads.isEmpty) {
      throw const _OrderFormValidationError('请至少填写一条订单明细。');
    }
    payload['items'] = itemPayloads;

    return payload;
  }

  Map<String, dynamic>? _customerPayload(bool validateRequired) {
    if (_selectedCustomer != null) {
      return null;
    }

    final customerName = _customerNameController.text.trim();
    if (validateRequired && customerName.isEmpty) {
      throw const _OrderFormValidationError('请选择或新建客户。');
    }
    if (customerName.isEmpty) {
      return null;
    }

    final payload = <String, dynamic>{'name': customerName};
    _putNonEmpty(payload, 'phone', _customerPhoneController.text);
    _putNonEmpty(payload, 'province', _province);
    _putNonEmpty(payload, 'city', _city);
    _putNonEmpty(payload, 'district', _district);
    _putNonEmpty(payload, 'address', _addressController.text);
    return payload;
  }

  List<Map<String, dynamic>> _itemPayloads({required bool validateRequired}) {
    final payloads = <Map<String, dynamic>>[];
    for (var index = 0; index < _items.length; index += 1) {
      final item = _items[index];
      if (!validateRequired && item.isBlank) {
        continue;
      }

      if (validateRequired && item.productId == null) {
        throw _OrderFormValidationError('第 ${index + 1} 条明细请选择启用商品。');
      }
      if (validateRequired && item.quantity <= 0) {
        throw _OrderFormValidationError('第 ${index + 1} 条明细数量必须大于 0。');
      }
      final subtotalCents = item.subtotalCentsOrNull;
      if (subtotalCents == null) {
        throw _OrderFormValidationError(
          '第 ${index + 1} 条明细总价格必须为有效的非负金额。',
        );
      }
      if (!validateRequired && item.productId == null) {
        continue;
      }

      final itemPayload = <String, dynamic>{
        'productId': item.productId,
        'quantity': item.quantity,
        'unitPriceCents': item.unitPriceCentsForPayload,
        'subtotalCents': subtotalCents,
        'deliveryType': item.deliveryType.value,
        'sortOrder': payloads.length + 1,
      };
      _putNonEmpty(itemPayload, 'notes', item.notes);
      payloads.add(itemPayload);
    }
    return payloads;
  }

  void _applyCustomer(CustomerRecord customer) {
    setState(() {
      _selectedCustomer = customer;
      _customerNameController.text = customer.name;
      _customerPhoneController.text = customer.phone ?? '';
      _province = customer.province;
      _city = customer.city;
      _district = customer.district;
      _addressController.text = customer.address ?? '';
    });
  }

  void _markCustomerEdited() {
    setState(() => _selectedCustomer = null);
  }

  void _addItem() {
    setState(() => _items.add(_OrderItemDraft.empty()));
  }

  void _deleteItem(int index) {
    setState(() {
      final removed = _items.removeAt(index);
      removed.dispose();
    });
  }

  void _updateItemDeliveryType(int index, DeliveryType deliveryType) {
    setState(() => _items[index].deliveryType = deliveryType);
  }

  void _updateItemProduct(int index, ProductOptionRecord product) {
    setState(() => _items[index].selectProduct(product));
  }

  void _disposeItems() {
    for (final item in _items) {
      item.dispose();
    }
  }

  void _replaceItems(List<_OrderItemDraft> items) {
    _disposeItems();
    _items = items;
  }

  @override
  Widget build(BuildContext context) {
    final cityOptions = _optionsWithCurrent(
      administrativeCitiesForProvince(_province),
      _city,
    );
    final districtOptions = _optionsWithCurrent(
      administrativeDistrictsForCity(_province, _city),
      _district,
    );
    final provinceOptions = _optionsWithCurrent(_provinceOptions, _province);
    final totalAmountCents = _items.fold<int>(
      0,
      (sum, item) => sum + item.subtotalCents,
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
                trailing: _selectedCustomer == null ||
                        !canViewFinanceMark(widget.role)
                    ? null
                    : StatusTag(
                        label:
                            _selectedCustomer!.financeMark ? '客户已标记' : '客户未标记',
                        tone: _selectedCustomer!.financeMark
                            ? StatusTone.success
                            : StatusTone.neutral,
                      ),
                children: [
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      OutlinedButton.icon(
                        key: const ValueKey('select-customer-button'),
                        onPressed: _selectCustomer,
                        icon: const Icon(Icons.person_search_rounded),
                        label: const Text('选择/新建客户'),
                      ),
                      if (_selectedCustomer != null)
                        TextButton.icon(
                          key: const ValueKey('clear-selected-customer-button'),
                          onPressed: _markCustomerEdited,
                          icon: const Icon(Icons.edit_rounded),
                          label: const Text('改为新客户资料'),
                        ),
                    ],
                  ),
                  if (_selectedCustomer != null) ...[
                    const SizedBox(height: 12),
                    _SelectionSummary(
                      icon: Icons.person_rounded,
                      title: '已选择：${_selectedCustomer!.name}',
                      subtitle: _customerSummary(_selectedCustomer!),
                    ),
                  ],
                  const SizedBox(height: 12),
                  ResponsiveFormGrid(
                    children: [
                      TextField(
                        key: const ValueKey('order-customer-name-field'),
                        controller: _customerNameController,
                        onChanged: (_) => _markCustomerEdited(),
                        decoration: const InputDecoration(labelText: '客户姓名'),
                      ),
                      TextField(
                        key: const ValueKey('order-customer-phone-field'),
                        controller: _customerPhoneController,
                        onChanged: (_) => _markCustomerEdited(),
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(labelText: '电话'),
                      ),
                      DropdownButtonFormField<String>(
                        key: ValueKey('province-${_province ?? ''}'),
                        initialValue: _province,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: '省份'),
                        items: [
                          for (final province in provinceOptions)
                            DropdownMenuItem(
                              value: province,
                              child: Text(province),
                            ),
                        ],
                        onChanged: (value) {
                          setState(() {
                            _province = value;
                            _city = null;
                            _district = null;
                            _selectedCustomer = null;
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
                                  _selectedCustomer = null;
                                });
                              },
                      ),
                      DropdownButtonFormField<String>(
                        key: ValueKey(
                          'district-${_province ?? ''}-${_city ?? ''}-${_district ?? ''}',
                        ),
                        initialValue: _district,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: '区县'),
                        items: [
                          for (final district in districtOptions)
                            DropdownMenuItem(
                              value: district,
                              child: Text(district),
                            ),
                        ],
                        onChanged: districtOptions.isEmpty
                            ? null
                            : (value) {
                                setState(() {
                                  _district = value;
                                  _selectedCustomer = null;
                                });
                              },
                      ),
                      TextField(
                        key: const ValueKey('order-address-field'),
                        controller: _addressController,
                        onChanged: (_) => _markCustomerEdited(),
                        decoration: const InputDecoration(labelText: '具体详细地址'),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 16),
              FormSection(
                title: '订单信息',
                children: [
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      OutlinedButton.icon(
                        key: const ValueKey('select-travel-group-button'),
                        onPressed: _selectTravelGroup,
                        icon: const Icon(Icons.directions_bus_rounded),
                        label: const Text('选择旅行团'),
                      ),
                      if (_selectedTravelGroup != null)
                        TextButton.icon(
                          key: const ValueKey('clear-selected-travel-group-button'),
                          onPressed: () =>
                              setState(() => _selectedTravelGroup = null),
                          icon: const Icon(Icons.close_rounded),
                          label: const Text('清空旅行团'),
                        ),
                    ],
                  ),
                  if (_selectedTravelGroup != null) ...[
                    const SizedBox(height: 12),
                    _SelectionSummary(
                      icon: Icons.directions_bus_rounded,
                      title: '已选择：${_selectedTravelGroup!.groupNo}',
                      subtitle: _travelGroupSummary(_selectedTravelGroup!),
                    ),
                  ],
                  const SizedBox(height: 12),
                  TextField(
                    key: const ValueKey('order-date-field'),
                    controller: _orderDateController,
                    readOnly: true,
                    onTap: _pickOrderDate,
                    decoration: const InputDecoration(
                      labelText: '订单日期',
                      suffixIcon: Icon(Icons.calendar_today_rounded),
                    ),
                  ),
                  const SizedBox(height: 12),
                  _OrderItemsEditor(
                    items: _items,
                    productOptions: _productOptions,
                    loadingProductOptions: _loadingProductOptions,
                    productOptionsError: _productOptionsError,
                    onRetryProductOptions: _loadProductOptions,
                    onAdd: _addItem,
                    onDelete: _deleteItem,
                    onChanged: () => setState(() {}),
                    onDeliveryTypeChanged: _updateItemDeliveryType,
                    onProductChanged: _updateItemProduct,
                  ),
                  const SizedBox(height: 12),
                  ResponsiveFormGrid(
                    children: [
                      TextField(
                        controller: _cashOnDeliveryAmountController,
                        onChanged: (_) => setState(() {}),
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: '货到付款金额',
                          prefixText: '¥ ',
                        ),
                      ),
                      TextField(
                        controller: _remarkController,
                        onChanged: (_) => setState(() {}),
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
            customerName: _customerNameController.text,
            customerPhone: _customerPhoneController.text,
            travelGroup: _selectedTravelGroup,
            totalAmountCents: totalAmountCents,
            localDraft: _localDraft,
            lastSavedOrderNo: _lastSavedOrderNo,
          ),
        ),
      ],
    );
  }
}

class _SelectionSummary extends StatelessWidget {
  const _SelectionSummary({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(icon),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  Text(subtitle),
                ],
              ),
            ),
            if (trailing != null) ...[
              const SizedBox(width: 10),
              trailing!,
            ],
          ],
        ),
      ),
    );
  }
}

class _OrderItemsEditor extends StatelessWidget {
  const _OrderItemsEditor({
    required this.items,
    required this.productOptions,
    required this.loadingProductOptions,
    required this.productOptionsError,
    required this.onRetryProductOptions,
    required this.onAdd,
    required this.onDelete,
    required this.onChanged,
    required this.onDeliveryTypeChanged,
    required this.onProductChanged,
  });

  final List<_OrderItemDraft> items;
  final List<ProductOptionRecord> productOptions;
  final bool loadingProductOptions;
  final String? productOptionsError;
  final VoidCallback onRetryProductOptions;
  final VoidCallback onAdd;
  final ValueChanged<int> onDelete;
  final VoidCallback onChanged;
  final void Function(int index, DeliveryType deliveryType)
      onDeliveryTypeChanged;
  final void Function(int index, ProductOptionRecord product) onProductChanged;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
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
                  key: const ValueKey('order-item-add-button'),
                  onPressed: onAdd,
                  icon: const Icon(Icons.add_rounded),
                  label: const Text('添加明细'),
                ),
              ],
            ),
            const Divider(),
            if (items.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text('暂无订单明细，保存前至少添加一条。'),
              )
            else
              for (var index = 0; index < items.length; index += 1) ...[
                _ItemRow(
                  index: index,
                  item: items[index],
                  onChanged: onChanged,
                  onDelete: () => onDelete(index),
                  onDeliveryTypeChanged: (deliveryType) =>
                      onDeliveryTypeChanged(index, deliveryType),
                  productOptions: productOptions,
                  loadingProductOptions: loadingProductOptions,
                  productOptionsError: productOptionsError,
                  onRetryProductOptions: onRetryProductOptions,
                  onProductChanged: (product) =>
                      onProductChanged(index, product),
                ),
                if (index != items.length - 1) const Divider(height: 20),
              ],
          ],
        ),
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({
    required this.index,
    required this.item,
    required this.onChanged,
    required this.onDelete,
    required this.onDeliveryTypeChanged,
    required this.productOptions,
    required this.loadingProductOptions,
    required this.productOptionsError,
    required this.onRetryProductOptions,
    required this.onProductChanged,
  });

  final int index;
  final _OrderItemDraft item;
  final VoidCallback onChanged;
  final VoidCallback onDelete;
  final ValueChanged<DeliveryType> onDeliveryTypeChanged;
  final List<ProductOptionRecord> productOptions;
  final bool loadingProductOptions;
  final String? productOptionsError;
  final VoidCallback onRetryProductOptions;
  final ValueChanged<ProductOptionRecord> onProductChanged;

  @override
  Widget build(BuildContext context) {
    final deliveryField = DropdownButtonFormField<DeliveryType>(
      key: ValueKey('order-item-delivery-$index'),
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
    final deleteButton = IconButton(
      key: ValueKey('order-item-delete-$index'),
      tooltip: '删除明细',
      onPressed: onDelete,
      icon: const Icon(Icons.delete_outline_rounded),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 680;
        final productField = ProductOptionPickerField(
          key: ValueKey('order-item-product-$index'),
          options: productOptions,
          loading: loadingProductOptions,
          loadError: productOptionsError,
          productId: item.productId,
          snapshotName: item.snapshotName,
          snapshotUnit: item.snapshotUnit,
          onRetry: onRetryProductOptions,
          onChanged: (product) {
            onProductChanged(product);
            onChanged();
          },
        );
        final quantityField = TextField(
          key: ValueKey('order-item-quantity-$index'),
          controller: item.quantityController,
          onChanged: (_) => onChanged(),
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(labelText: '数量'),
        );
        final subtotalField = TextField(
          key: ValueKey('order-item-subtotal-$index'),
          controller: item.subtotalController,
          onChanged: (_) => onChanged(),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
          ],
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(
            labelText: '总价格',
            prefixText: '¥ ',
          ),
        );
        final notesField = TextField(
          key: ValueKey('order-item-notes-$index'),
          controller: item.notesController,
          onChanged: (_) => onChanged(),
          decoration: const InputDecoration(labelText: '明细备注'),
        );
        final subtotal = MoneyText(cents: item.subtotalCents);

        if (compact) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '明细 ${index + 1}',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                    ),
                    subtotal,
                    deleteButton,
                  ],
                ),
                const SizedBox(height: 8),
                productField,
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: quantityField),
                    const SizedBox(width: 10),
                    Expanded(child: subtotalField),
                  ],
                ),
                const SizedBox(height: 8),
                deliveryField,
                const SizedBox(height: 8),
                notesField,
              ],
            ),
          );
        }

        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(flex: 3, child: productField),
              const SizedBox(width: 10),
              SizedBox(width: 86, child: quantityField),
              const SizedBox(width: 10),
              SizedBox(width: 118, child: subtotalField),
              const SizedBox(width: 10),
              SizedBox(width: 136, child: deliveryField),
              const SizedBox(width: 10),
              Expanded(flex: 2, child: notesField),
              const SizedBox(width: 10),
              SizedBox(
                width: 96,
                child: Padding(
                  padding: const EdgeInsets.only(top: 18),
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: subtotal,
                  ),
                ),
              ),
              deleteButton,
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
    required this.customerName,
    required this.customerPhone,
    required this.travelGroup,
    required this.totalAmountCents,
    required this.localDraft,
    required this.lastSavedOrderNo,
  });

  final DateTime orderDate;
  final String customerName;
  final String customerPhone;
  final TravelGroupRecord? travelGroup;
  final int totalAmountCents;
  final Map<String, dynamic>? localDraft;
  final String? lastSavedOrderNo;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      title: '订单核对',
      children: [
        if (lastSavedOrderNo != null) ...[
          _SummaryLine(label: '系统单号', value: lastSavedOrderNo!),
          const SizedBox(height: 10),
        ],
        _SummaryLine(label: '订单日期', value: formatDate(orderDate)),
        const SizedBox(height: 10),
        _SummaryLine(
          label: '旅行团',
          value: travelGroup?.groupNo ?? '未选择旅行团',
        ),
        const SizedBox(height: 10),
        _SummaryLine(
          label: '客户',
          value: customerName.trim().isEmpty
              ? '未选择客户'
              : '$customerName ${customerPhone.trim()}',
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
            const StatusTag(label: '后端生成系统单号', tone: StatusTone.info),
            if (localDraft != null)
              const StatusTag(label: '本页草稿', tone: StatusTone.success),
          ],
        ),
      ],
    );
  }
}

class _SummaryLine extends StatelessWidget {
  const _SummaryLine({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: Text(label)),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _OrderItemDraft {
  _OrderItemDraft({
    required this.productId,
    required this.snapshotName,
    required this.snapshotUnit,
    required int quantity,
    required int subtotalCents,
    required this.deliveryType,
    String? notes,
  })  : quantityController = TextEditingController(
          text: quantity > 0 ? '$quantity' : '',
        ),
        subtotalController = TextEditingController(
          text: _moneyTextFromCents(subtotalCents),
        ),
        notesController = TextEditingController(text: notes ?? '');

  factory _OrderItemDraft.empty() {
    return _OrderItemDraft(
      productId: null,
      snapshotName: null,
      snapshotUnit: null,
      quantity: 1,
      subtotalCents: 0,
      deliveryType: DeliveryType.shipping,
    );
  }

  String? productId;
  String? snapshotName;
  String? snapshotUnit;
  final TextEditingController quantityController;
  final TextEditingController subtotalController;
  final TextEditingController notesController;
  DeliveryType deliveryType;

  void selectProduct(ProductOptionRecord product) {
    productId = product.id;
    snapshotName = product.name;
    snapshotUnit = product.unit;
  }

  int get quantity => int.tryParse(quantityController.text.trim()) ?? 0;

  int? get subtotalCentsOrNull => _moneyCentsOrNull(subtotalController.text);

  int get subtotalCents => subtotalCentsOrNull ?? 0;

  int get unitPriceCentsForPayload {
    final subtotal = subtotalCents;
    final quantityValue = quantity;
    if (subtotal <= 0 || quantityValue <= 0) {
      return 0;
    }
    return (subtotal / quantityValue).round();
  }

  String get notes => notesController.text.trim();

  bool get isBlank {
    return productId == null &&
        quantityController.text.trim().isEmpty &&
        subtotalController.text.trim().isEmpty &&
        notes.isEmpty;
  }

  void dispose() {
    quantityController.dispose();
    subtotalController.dispose();
    notesController.dispose();
  }
}

class _OrderFormValidationError implements Exception {
  const _OrderFormValidationError(this.message);

  final String message;
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

const _orderEntryOrderType = 'travel_group';

List<_OrderItemDraft> _initialOrderItems() {
  return [
    _OrderItemDraft.empty(),
  ];
}

String _customerSummary(CustomerRecord customer) {
  final phone = customer.phone?.trim();
  final address = [
    customer.province,
    customer.city,
    customer.district,
    customer.address,
  ].whereType<String>().where((part) => part.trim().isNotEmpty).join('');
  final parts = <String>[
    if (phone != null && phone.isNotEmpty) phone,
    if (address.isNotEmpty) address,
  ];
  return parts.isEmpty ? '客户资料已回填到表单' : parts.join(' · ');
}

String _travelGroupSummary(TravelGroupRecord group) {
  final parts = [
    group.visitDate,
    group.travelAgency,
    group.guideName,
  ].whereType<String>().where((part) => part.trim().isNotEmpty).toList();
  return parts.isEmpty ? '旅行团订单' : parts.join(' 路 ');
}

List<String> _optionsWithCurrent(List<String> options, String? current) {
  final text = current?.trim() ?? '';
  if (text.isEmpty || options.contains(text)) {
    return options;
  }
  return [text, ...options];
}

void _putNonEmpty(Map<String, dynamic> body, String key, String? value) {
  final text = value?.trim() ?? '';
  if (text.isNotEmpty) {
    body[key] = text;
  }
}

int? _moneyCentsOrNull(String value) {
  final text = value.trim();
  if (text.isEmpty) {
    return 0;
  }
  final normalized = text.replaceAll(',', '');
  final amount = double.tryParse(normalized);
  if (amount == null || amount < 0) {
    return null;
  }
  return (amount * 100).round();
}

String _moneyTextFromCents(int cents) {
  if (cents <= 0) {
    return '';
  }
  if (cents % 100 == 0) {
    return '${cents ~/ 100}';
  }
  return (cents / 100).toStringAsFixed(2);
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
