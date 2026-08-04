import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/payment_details_editor.dart';
import '../../shared/widgets/product_option_picker.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';
import '../customers/customer_picker_dialog.dart';

class OrderFormPage extends StatefulWidget {
  const OrderFormPage({
    super.key,
    required this.apiClient,
    required this.token,
    this.role = UserRole.sales,
    this.travelGroupId,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final String? travelGroupId;

  @override
  State<OrderFormPage> createState() => _OrderFormPageState();
}

class _OrderFormPageState extends State<OrderFormPage> {
  late BusinessApi _businessApi;
  late DateTime _orderDate;
  late DateTime _shippingDate;
  String _shippingDateMode = scheduledShippingDateMode;
  bool _shippingDateManuallySpecified = false;
  late final TextEditingController _customerNameController;
  late final TextEditingController _customerPhoneController;
  late final TextEditingController _addressController;
  late final TextEditingController _orderDateController;
  late final TextEditingController _shippingDateController;
  late final TextEditingController _remarkController;
  late final List<String> _provinceOptions;

  CustomerRecord? _selectedCustomer;
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
  List<SalesPaymentMethodRecord> _paymentMethods = const [];
  final List<PaymentDetailDraft> _paymentDetails = [];
  bool _loadingPaymentMethods = true;
  String? _paymentMethodsError;
  bool _paymentDetailsAutoDefault = true;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _orderDate = DateTime.now();
    _shippingDate = _shanghaiToday().add(const Duration(days: 1));
    _customerNameController = TextEditingController();
    _customerPhoneController = TextEditingController();
    _addressController = TextEditingController();
    _orderDateController = TextEditingController(text: formatDate(_orderDate));
    _shippingDateController =
        TextEditingController(text: formatDate(_shippingDate));
    _remarkController = TextEditingController();
    _provinceOptions = administrativeProvinceNames();
    _items = _initialOrderItems();
    _loadProductOptions();
    _loadPaymentMethods();
  }

  @override
  void didUpdateWidget(covariant OrderFormPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadProductOptions();
      _loadPaymentMethods();
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

  Future<void> _loadPaymentMethods() async {
    setState(() {
      _loadingPaymentMethods = true;
      _paymentMethodsError = null;
    });
    try {
      final methods = (await _businessApi.listPaymentMethods())
          .where((method) => method.isActive)
          .toList();
      if (!mounted) return;
      setState(() {
        _paymentMethods = methods;
        _loadingPaymentMethods = false;
        _paymentMethodsError =
            methods.isEmpty ? '暂无启用的收款方式，请联系财务或管理员配置后重试。' : null;
        if (_paymentDetails.isEmpty && methods.isNotEmpty) {
          final defaultMethod = methods.firstWhere(
            (method) => method.isDefault,
            orElse: () => methods.first,
          );
          _paymentDetails.add(
            PaymentDetailDraft(
              paymentMethodId: defaultMethod.id,
              amountCents: _currentTotalAmountCents,
            ),
          );
          _paymentDetailsAutoDefault = true;
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingPaymentMethods = false;
        _paymentMethodsError = _messageForError(error);
      });
    }
  }

  @override
  void dispose() {
    _customerNameController.dispose();
    _customerPhoneController.dispose();
    _addressController.dispose();
    _orderDateController.dispose();
    _shippingDateController.dispose();
    _remarkController.dispose();
    for (final detail in _paymentDetails) {
      detail.dispose();
    }
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

  Future<void> _pickShippingDate() async {
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(1),
      lastDate: DateTime(9999, 12, 31),
      initialDate: _shippingDate,
      locale: const Locale('zh', 'CN'),
    );
    if (picked == null) {
      return;
    }
    setState(() {
      _shippingDate = picked;
      _shippingDateManuallySpecified = true;
      _shippingDateController.text = formatDate(picked);
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

  Future<void> _saveOrder() async {
    setState(() {
      _saving = true;
      _errorMessage = null;
      _successMessage = null;
      _lastSavedOrderNo = null;
    });

    try {
      final result = await _businessApi.createSalesOrder(_buildOrderPayload());
      final order = result.salesOrder;
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
      if (!mounted) {
        return;
      }
      await _showOrderResultDialog(title: '录入成功', message: '录入成功');
    } catch (error) {
      if (!mounted) {
        return;
      }
      final message = _messageForError(error);
      setState(() {
        _saving = false;
        _errorMessage = message;
      });
      if (!mounted) {
        return;
      }
      await _showOrderResultDialog(
        title: '录入失败',
        message: message,
      );
    }
  }

  Future<void> _showOrderResultDialog({
    required String title,
    required String message,
  }) async {
    if (!mounted) {
      return;
    }
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('确定'),
          ),
        ],
      ),
    );
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

  void _restoreDraftPaymentDetails() {
    final rawItems = _localDraft?['items'];
    final rawDetails = _localDraft?['paymentDetails'];
    if (rawItems is! List ||
        rawItems.isEmpty ||
        rawDetails is! List ||
        rawDetails.isEmpty) {
      setState(() {
        _errorMessage = '草稿中没有可恢复的酒品或收款明细。';
        _successMessage = null;
      });
      return;
    }
    final restoredItems = <_OrderItemDraft>[];
    final restored = <PaymentDetailDraft>[];
    try {
      for (var index = 0; index < rawItems.length; index += 1) {
        final raw = rawItems[index];
        if (raw is! Map) {
          throw _OrderFormValidationError('草稿第 ${index + 1} 条酒品明细无效。');
        }
        final productId = _draftStringOrNull(raw['productId']);
        final quantity = raw['quantity'];
        final subtotalCents = raw['subtotalCents'];
        final unit = _draftStringOrNull(raw['unit']);
        if (productId == null ||
            quantity is! num ||
            quantity % 1 != 0 ||
            subtotalCents is! num ||
            subtotalCents % 1 != 0 ||
            !_salesOrderItemUnits.contains(unit)) {
          throw _OrderFormValidationError('草稿第 ${index + 1} 条酒品明细无效。');
        }
        ProductOptionRecord? product;
        for (final option in _productOptions) {
          if (option.id == productId) {
            product = option;
            break;
          }
        }
        restoredItems.add(
          _OrderItemDraft(
            productId: productId,
            snapshotName: product?.name,
            snapshotUnit: product?.unit,
            unit: unit!,
            quantity: quantity.toInt(),
            subtotalCents: subtotalCents.toInt(),
            deliveryType: _deliveryTypeFromDraft(raw['deliveryType']),
            notes: _draftStringOrNull(raw['notes']),
          )..inventoryTrackingMode = product?.inventoryTrackingMode ?? 'none',
        );
      }
      for (var index = 0; index < rawDetails.length; index += 1) {
        final raw = rawDetails[index];
        if (raw is! Map) {
          throw _OrderFormValidationError(
            '草稿第 ${index + 1} 条收款明细无效。',
          );
        }
        final paymentMethodId = '${raw['paymentMethodId'] ?? ''}'.trim();
        final amount = raw['amountCents'];
        if (paymentMethodId.isEmpty || amount is! num || amount % 1 != 0) {
          throw _OrderFormValidationError(
            '草稿第 ${index + 1} 条收款明细无效。',
          );
        }
        restored.add(
          PaymentDetailDraft(
            id: _draftStringOrNull(raw['id']),
            paymentMethodId: paymentMethodId,
            amountCents: amount.toInt(),
          ),
        );
      }
    } catch (error) {
      for (final item in restoredItems) {
        item.dispose();
      }
      for (final detail in restored) {
        detail.dispose();
      }
      setState(() {
        _errorMessage = _messageForError(error);
        _successMessage = null;
      });
      return;
    }
    setState(() {
      _replaceItems(restoredItems);
      for (final detail in _paymentDetails) {
        detail.dispose();
      }
      _paymentDetails
        ..clear()
        ..addAll(restored);
      _paymentDetailsAutoDefault = false;
      _errorMessage = null;
      _successMessage = '已恢复草稿中的酒品与收款明细。';
      _lastSavedOrderNo = null;
    });
  }

  void _clearForm() {
    final now = DateTime.now();
    _customerNameController.clear();
    _customerPhoneController.clear();
    _addressController.clear();
    _remarkController.clear();
    _orderDate = now;
    _orderDateController.text = formatDate(now);
    _shippingDate = _shanghaiToday().add(const Duration(days: 1));
    _shippingDateMode = scheduledShippingDateMode;
    _shippingDateManuallySpecified = false;
    _shippingDateController.text = formatDate(_shippingDate);
    _selectedCustomer = null;
    _province = null;
    _city = null;
    _district = null;
    _replaceItems(_initialOrderItems());
    for (final detail in _paymentDetails) {
      detail.dispose();
    }
    _paymentDetails.clear();
    if (_paymentMethods.isNotEmpty) {
      final defaultMethod = _paymentMethods.firstWhere(
        (method) => method.isDefault,
        orElse: () => _paymentMethods.first,
      );
      _paymentDetails.add(
        PaymentDetailDraft(
          paymentMethodId: defaultMethod.id,
          amountCents: 0,
        ),
      );
    }
    _paymentDetailsAutoDefault = true;
  }

  Map<String, dynamic> _buildOrderPayload({bool validateRequired = true}) {
    final payload = <String, dynamic>{
      'orderType': _orderEntryOrderType,
      'orderDate': formatDate(_orderDate),
      'shippingDateMode': _shippingDateMode,
      if (_shippingDateMode == scheduledShippingDateMode) ...{
        'shippingDate': formatDate(_shippingDate),
        'shippingDateManuallySpecified': _shippingDateManuallySpecified,
      },
    };
    final travelGroupId = widget.travelGroupId?.trim() ?? '';
    if (validateRequired && travelGroupId.isEmpty) {
      throw const _OrderFormValidationError('未提供旅行团，请从旅行团管理页发起订单录入。');
    }
    if (travelGroupId.isNotEmpty) {
      payload['travelGroupId'] = travelGroupId;
    }
    if (validateRequired && _loadingPaymentMethods) {
      throw const _OrderFormValidationError('收款方式正在加载，请稍后再保存。');
    }
    if (validateRequired && _paymentMethodsError != null) {
      throw _OrderFormValidationError(
        '收款方式加载失败：$_paymentMethodsError 请重试后再保存。',
      );
    }
    if (validateRequired && _paymentMethods.isEmpty) {
      throw const _OrderFormValidationError('暂无可用收款方式，不能保存订单。');
    }
    _putNonEmpty(payload, 'remark', _remarkController.text);

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
    final totalAmountCents = itemPayloads.fold<int>(
      0,
      (sum, item) => sum + (item['subtotalCents'] as int? ?? 0),
    );
    if (_paymentDetailsAutoDefault && _paymentDetails.length == 1) {
      _paymentDetails.first.setAmountCents(totalAmountCents);
    }
    final paymentDetails = <Map<String, dynamic>>[];
    for (var index = 0; index < _paymentDetails.length; index += 1) {
      final detail = _paymentDetails[index].toPayload();
      if (detail == null) {
        throw _OrderFormValidationError(
          '第 ${index + 1} 条收款明细的方式或金额无效。',
        );
      }
      paymentDetails.add(detail);
    }
    if (validateRequired && paymentDetails.isEmpty) {
      throw const _OrderFormValidationError('请至少填写一条收款明细。');
    }
    final paymentTotal = paymentDetails.fold<int>(
      0,
      (sum, detail) => sum + (detail['amountCents'] as int),
    );
    if (validateRequired && paymentTotal != totalAmountCents) {
      throw const _OrderFormValidationError('收款明细合计必须严格等于订单总额。');
    }
    payload['paymentDetails'] = paymentDetails;

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
        'unit': item.unit,
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
    setState(() {
      _items.add(_OrderItemDraft.empty());
      _syncAutoDefaultPayment();
    });
  }

  void _deleteItem(int index) {
    setState(() {
      final removed = _items.removeAt(index);
      removed.dispose();
      _syncAutoDefaultPayment();
    });
  }

  void _updateItemDeliveryType(int index, DeliveryType deliveryType) {
    setState(() => _items[index].deliveryType = deliveryType);
  }

  void _updateItemProduct(int index, ProductOptionRecord product) {
    setState(() {
      _items[index].selectProduct(product);
      _syncAutoDefaultPayment();
    });
  }

  int get _currentTotalAmountCents => _items.fold<int>(
        0,
        (sum, item) => sum + item.subtotalCents,
      );

  void _syncAutoDefaultPayment() {
    if (_paymentDetailsAutoDefault && _paymentDetails.length == 1) {
      _paymentDetails.first.setAmountCents(_currentTotalAmountCents);
    }
  }

  void _handleItemsChanged() {
    setState(_syncAutoDefaultPayment);
  }

  void _addPaymentDetail() {
    if (_paymentMethods.isEmpty) return;
    setState(() {
      _paymentDetailsAutoDefault = false;
      _paymentDetails.add(
        PaymentDetailDraft(
          paymentMethodId: _paymentMethods.first.id,
          amountCents: 0,
        ),
      );
    });
  }

  void _removePaymentDetail(int index) {
    setState(() {
      _paymentDetailsAutoDefault = false;
      _paymentDetails.removeAt(index).dispose();
    });
  }

  void _movePaymentDetail(int fromIndex, int toIndex) {
    if (fromIndex == toIndex ||
        fromIndex < 0 ||
        fromIndex >= _paymentDetails.length ||
        toIndex < 0 ||
        toIndex >= _paymentDetails.length) {
      return;
    }
    setState(() {
      _paymentDetailsAutoDefault = false;
      final detail = _paymentDetails.removeAt(fromIndex);
      _paymentDetails.insert(toIndex, detail);
    });
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
    if ((widget.travelGroupId?.trim() ?? '').isEmpty) {
      return ResponsivePage(
        children: [
          Container(
            key: const ValueKey('order-form-missing-travel-group'),
            child: const _InlineNotice(
              message: '未提供旅行团，请从旅行团管理页选择旅行团后再录入订单。',
              tone: StatusTone.warning,
            ),
          ),
        ],
      );
    }

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
                  SegmentedButton<String>(
                    key: const ValueKey('order-shipping-date-mode'),
                    segments: const [
                      ButtonSegment(
                        value: scheduledShippingDateMode,
                        label: Text(
                          '选择发货日期',
                          key: ValueKey('shipping-mode-scheduled'),
                        ),
                        icon: Icon(Icons.event_rounded),
                      ),
                      ButtonSegment(
                        value: pendingCustomerNoticeShippingDateMode,
                        label: Text(
                          '待客人通知',
                          key: ValueKey('shipping-mode-pending-notice'),
                        ),
                        icon: Icon(Icons.notifications_active_outlined),
                      ),
                    ],
                    selected: {_shippingDateMode},
                    onSelectionChanged: (selection) {
                      setState(() => _shippingDateMode = selection.first);
                    },
                  ),
                  const SizedBox(height: 12),
                  if (_shippingDateMode == scheduledShippingDateMode)
                    TextField(
                      key: const ValueKey('order-shipping-date-field'),
                      controller: _shippingDateController,
                      readOnly: true,
                      onTap: _pickShippingDate,
                      decoration: const InputDecoration(
                        labelText: '发货日期 *',
                        suffixIcon: Icon(Icons.local_shipping_rounded),
                      ),
                    )
                  else
                    const InputDecorator(
                      key: ValueKey('order-shipping-pending-notice'),
                      decoration: InputDecoration(
                        labelText: '发货安排',
                        prefixIcon: Icon(Icons.notifications_none_rounded),
                      ),
                      child: Text('待客人通知'),
                    ),
                  if (_shippingDateMode == scheduledShippingDateMode &&
                      formatDate(_shippingDate) ==
                          formatDate(_shanghaiToday())) ...[
                    const SizedBox(height: 10),
                    const _InlineNotice(
                      message: '该订单计划当天发货，请确认仓库可及时处理。',
                      tone: StatusTone.warning,
                    ),
                  ],
                  const SizedBox(height: 12),
                  _OrderItemsEditor(
                    items: _items,
                    productOptions: _productOptions,
                    loadingProductOptions: _loadingProductOptions,
                    productOptionsError: _productOptionsError,
                    onRetryProductOptions: _loadProductOptions,
                    onAdd: _addItem,
                    onDelete: _deleteItem,
                    onChanged: _handleItemsChanged,
                    onDeliveryTypeChanged: _updateItemDeliveryType,
                    onProductChanged: _updateItemProduct,
                  ),
                  const SizedBox(height: 12),
                  PaymentDetailsEditor(
                    methods: _paymentMethods,
                    details: _paymentDetails,
                    totalAmountCents: totalAmountCents,
                    loading: _loadingPaymentMethods,
                    errorMessage: _paymentMethodsError,
                    onRetry: _loadPaymentMethods,
                    onAdd: _addPaymentDetail,
                    onRemove: _removePaymentDetail,
                    onMove: _movePaymentDetail,
                    onChanged: () {
                      setState(() => _paymentDetailsAutoDefault = false);
                    },
                  ),
                  if (_localDraft != null)
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton.icon(
                        key: const ValueKey(
                          'payment-details-restore-draft-button',
                        ),
                        onPressed: _restoreDraftPaymentDetails,
                        icon: const Icon(Icons.restore_rounded),
                        label: const Text('恢复草稿明细'),
                      ),
                    ),
                  const SizedBox(height: 12),
                  ResponsiveFormGrid(
                    children: [
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
                    onPrimaryPressed: _saving ||
                            _loadingPaymentMethods ||
                            _paymentMethodsError != null ||
                            _paymentMethods.isEmpty
                        ? null
                        : _saveOrder,
                    onSecondaryPressed: _saving ? null : _saveLocalDraft,
                  ),
                ],
              ),
            ],
          ),
          secondary: _OrderSummary(
            orderDate: _orderDate,
            shippingDateMode: _shippingDateMode,
            shippingDate: _shippingDate,
            customerName: _customerNameController.text,
            customerPhone: _customerPhoneController.text,
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
  });

  final IconData icon;
  final String title;
  final String subtitle;

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
        final compact = constraints.maxWidth < 800;
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
          decoration: const InputDecoration(
            labelText: '数量',
          ),
        );
        final unitField = DropdownButtonFormField<String>(
          key: ValueKey('order-item-unit-$index'),
          initialValue: item.unit,
          isExpanded: true,
          decoration: const InputDecoration(labelText: '规格'),
          items: [
            for (final unit in _salesOrderItemUnits)
              DropdownMenuItem(value: unit, child: Text(unit)),
          ],
          onChanged: (value) {
            if (value != null) {
              item.unit = value;
              onChanged();
            }
          },
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
                    Expanded(child: unitField),
                  ],
                ),
                const SizedBox(height: 8),
                subtotalField,
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
              Expanded(
                flex: 3,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    productField,
                  ],
                ),
              ),
              const SizedBox(width: 10),
              SizedBox(width: 86, child: quantityField),
              const SizedBox(width: 10),
              SizedBox(width: 92, child: unitField),
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
    required this.shippingDateMode,
    required this.shippingDate,
    required this.customerName,
    required this.customerPhone,
    required this.totalAmountCents,
    required this.localDraft,
    required this.lastSavedOrderNo,
  });

  final DateTime orderDate;
  final String shippingDateMode;
  final DateTime shippingDate;
  final String customerName;
  final String customerPhone;
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
          label: '发货日期',
          value: shippingDateMode == pendingCustomerNoticeShippingDateMode
              ? '待客人通知'
              : formatDate(shippingDate),
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
    required this.unit,
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
      unit: _defaultSalesOrderItemUnit,
      quantity: 1,
      subtotalCents: 0,
      deliveryType: DeliveryType.shipping,
    );
  }

  String? productId;
  String? snapshotName;
  String? snapshotUnit;
  String unit;
  final TextEditingController quantityController;
  final TextEditingController subtotalController;
  final TextEditingController notesController;
  DeliveryType deliveryType;
  String inventoryTrackingMode = 'none';

  void selectProduct(ProductOptionRecord product) {
    if (productId != product.id) {
      quantityController.text = '1';
    }
    productId = product.id;
    snapshotName = product.name;
    snapshotUnit = product.unit;
    inventoryTrackingMode = product.inventoryTrackingMode;
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
const _defaultSalesOrderItemUnit = '瓶';
const _salesOrderItemUnits = <String>['瓶', '盒'];

DateTime _shanghaiToday() {
  final shanghaiNow = DateTime.now().toUtc().add(const Duration(hours: 8));
  return DateTime(shanghaiNow.year, shanghaiNow.month, shanghaiNow.day);
}

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

String? _draftStringOrNull(Object? value) {
  final text = '${value ?? ''}'.trim();
  return text.isEmpty ? null : text;
}

DeliveryType _deliveryTypeFromDraft(Object? value) {
  final normalized = '${value ?? ''}'.trim();
  for (final type in DeliveryType.values) {
    if (type.value == normalized) {
      return type;
    }
  }
  return DeliveryType.shipping;
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
    if (error.code == 'TRAVEL_GROUP_FRONT_DESK_INFO_INCOMPLETE') {
      const labels = <String, String>{
        'licensePlate': '车牌号',
        'guestCount': '人数',
        'cigaretteFeeCents': '香烟费用',
        'tastingRoomNo': '品鉴馆号',
        'tasterId': '品鉴师',
        'arrivalTime': '进店时间',
        'groupType': '团型',
      };
      final missing =
          error.missingFields.map((field) => labels[field] ?? field).join('、');
      return missing.isEmpty
          ? '该旅行团前台信息尚未补齐，请先联系前台处理。'
          : '该旅行团前台信息尚未补齐：$missing，请先联系前台处理。';
    }
    final message = error.message.trim();
    if (message.isEmpty) {
      return '订单保存失败，请稍后重试。';
    }
    if (_containsSensitiveInternalDetails(message)) {
      return '服务暂时无法处理该订单，请稍后重试或联系管理员。';
    }
    return message;
  }
  return '订单保存失败，请稍后重试。';
}

bool _containsSensitiveInternalDetails(String message) {
  final normalized = message.toLowerCase();
  return normalized.contains('prisma') ||
      normalized.contains('stack trace') ||
      normalized.contains('node_modules') ||
      normalized.contains('sqlstate') ||
      normalized.contains(' at /') ||
      normalized.contains(r' at c:\');
}
