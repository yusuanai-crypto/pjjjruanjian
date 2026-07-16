import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class ProductManagementPage extends StatefulWidget {
  const ProductManagementPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    required this.onOpenDestination,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final ValueChanged<String> onOpenDestination;

  @override
  State<ProductManagementPage> createState() => _ProductManagementPageState();
}

class _ProductManagementPageState extends State<ProductManagementPage> {
  late BusinessApi _businessApi;
  final _searchController = TextEditingController();

  bool _loading = true;
  bool _loadingDetail = false;
  String? _errorMessage;
  String? _detailErrorMessage;
  bool? _activeFilter;
  List<ProductRecord> _products = const [];
  ProductRecord? _selectedProduct;
  final Map<String, List<ProductActualCostRecord>> _costsByProduct = {};
  List<SalesDeductionRuleRecord> _salesDeductionRules = const [];
  List<AgencyDeductionRuleRecord> _agencyDeductionRules = const [];

  bool get _canManage =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _loadProducts();
  }

  @override
  void didUpdateWidget(covariant ProductManagementPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.role != widget.role) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadProducts();
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadProducts({String? preferredProductId}) async {
    if (!_canManage) {
      setState(() {
        _loading = false;
        _products = const [];
        _selectedProduct = null;
        _costsByProduct.clear();
      });
      return;
    }
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      final page = await _businessApi.listProducts(
        pageSize: 100,
        keyword: _searchController.text.trim(),
        isActive: _activeFilter,
      );
      final histories = await Future.wait(
        page.products.map(
          (product) => _businessApi.listProductActualCosts(product.id),
        ),
      );
      if (!mounted) return;
      _costsByProduct
        ..clear()
        ..addEntries([
          for (var index = 0; index < page.products.length; index++)
            MapEntry(page.products[index].id, histories[index]),
        ]);
      final selected = _selectProduct(
        page.products,
        preferredProductId ?? _selectedProduct?.id,
      );
      setState(() {
        _products = page.products;
        _selectedProduct = selected;
        _loading = false;
      });
      await _loadRuleSummaries(selected);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _products = const [];
        _selectedProduct = null;
        _costsByProduct.clear();
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _loadRuleSummaries(ProductRecord? product) async {
    if (product == null) {
      setState(() {
        _salesDeductionRules = const [];
        _agencyDeductionRules = const [];
        _loadingDetail = false;
      });
      return;
    }
    setState(() {
      _loadingDetail = true;
      _detailErrorMessage = null;
    });
    try {
      final results = await Future.wait<dynamic>([
        _businessApi.listSalesDeductionRules(
          limit: 200,
          productId: product.id,
        ),
        _businessApi.listAgencyDeductionRules(
          limit: 200,
          productId: product.id,
        ),
      ]);
      if (!mounted || _selectedProduct?.id != product.id) return;
      setState(() {
        _salesDeductionRules = results[0] as List<SalesDeductionRuleRecord>;
        _agencyDeductionRules = results[1] as List<AgencyDeductionRuleRecord>;
        _loadingDetail = false;
      });
    } catch (error) {
      if (!mounted || _selectedProduct?.id != product.id) return;
      setState(() {
        _loadingDetail = false;
        _detailErrorMessage = _messageForError(error);
      });
    }
  }

  void _select(ProductRecord product) {
    setState(() => _selectedProduct = product);
    _loadRuleSummaries(product);
  }

  Future<void> _openProductEditor({ProductRecord? product}) async {
    final saved = await showDialog<ProductRecord>(
      context: context,
      builder: (context) => _ProductEditorDialog(
        businessApi: _businessApi,
        product: product,
      ),
    );
    if (saved != null) {
      await _loadProducts(preferredProductId: saved.id);
    }
  }

  Future<void> _changeProductStatus(ProductRecord product) async {
    final nextActive = !product.isActive;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(nextActive ? '启用商品' : '停用商品'),
        content:
            Text(nextActive ? '启用后可在新订单和新规则中选择该商品。' : '停用后不可用于新业务，历史记录仍会正常显示。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('取消'),
          ),
          FilledButton(
            key: const ValueKey('product-status-confirm-button'),
            onPressed: () => Navigator.pop(context, true),
            child: Text(nextActive ? '确认启用' : '确认停用'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final saved = await _businessApi.setProductActive(product.id, nextActive);
      if (!mounted) return;
      _showMessage(nextActive ? '商品已启用。' : '商品已停用，历史记录不受影响。');
      await _loadProducts(preferredProductId: saved.id);
    } catch (error) {
      if (mounted) _showMessage(_messageForError(error), isError: true);
    }
  }

  Future<void> _openCostEditor({ProductActualCostRecord? cost}) async {
    final product = _selectedProduct;
    if (product == null) return;
    final saved = await showDialog<ProductActualCostRecord>(
      context: context,
      builder: (context) => _ActualCostEditorDialog(
        businessApi: _businessApi,
        product: product,
        cost: cost,
      ),
    );
    if (saved != null) {
      _showMessage(cost == null ? '实际成本已新增。' : '实际成本已更新。');
      await _loadProducts(preferredProductId: product.id);
    }
  }

  Future<void> _changeCostStatus(ProductActualCostRecord cost) async {
    final nextActive = !cost.isActive;
    try {
      await _businessApi.setProductActualCostActive(cost.id, nextActive);
      if (!mounted) return;
      _showMessage(nextActive ? '成本记录已启用。' : '成本记录已停用。');
      await _loadProducts(preferredProductId: _selectedProduct?.id);
    } catch (error) {
      if (mounted) _showMessage(_messageForError(error), isError: true);
    }
  }

  void _showMessage(String message, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? Theme.of(context).colorScheme.error : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_canManage) {
      return const ResponsivePage(
        key: ValueKey('product-management-access-denied'),
        children: [
          _InlineNotice(
            message: '当前角色不可访问商品管理及成本信息。',
            tone: StatusTone.danger,
          ),
        ],
      );
    }
    return ResponsivePage(
      maxWidth: 1500,
      children: [
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        if (_loading) const LinearProgressIndicator(),
        ResponsiveTwoColumn(
          primaryFlex: 1,
          secondaryFlex: 2,
          primary: _buildListSection(),
          secondary: _selectedProduct == null
              ? const FormSection(
                  title: '商品详情',
                  children: [_SectionState(message: '请选择或新增商品。')],
                )
              : _buildWorkspace(_selectedProduct!),
        ),
      ],
    );
  }

  Widget _buildListSection() {
    return FormSection(
      title: '商品列表',
      trailing:
          StatusTag(label: '${_products.length} 项', tone: StatusTone.info),
      children: [
        TextField(
          key: const ValueKey('product-search-field'),
          controller: _searchController,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: '搜索商品名称或单位',
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: IconButton(
              tooltip: '清空',
              onPressed: () {
                _searchController.clear();
                _loadProducts();
              },
              icon: const Icon(Icons.close_rounded),
            ),
          ),
          onSubmitted: (_) => _loadProducts(),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<bool?>(
          key: const ValueKey('product-active-filter'),
          initialValue: _activeFilter,
          decoration: const InputDecoration(labelText: '启用状态'),
          items: const [
            DropdownMenuItem(value: null, child: Text('全部商品')),
            DropdownMenuItem(value: true, child: Text('仅启用')),
            DropdownMenuItem(value: false, child: Text('仅停用')),
          ],
          onChanged: (value) {
            setState(() => _activeFilter = value);
            _loadProducts();
          },
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          alignment: WrapAlignment.end,
          children: [
            OutlinedButton.icon(
              onPressed: _loading ? null : _loadProducts,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('刷新'),
            ),
            FilledButton.icon(
              key: const ValueKey('product-add-button'),
              onPressed: _loading ? null : () => _openProductEditor(),
              icon: const Icon(Icons.add_rounded),
              label: const Text('新增商品'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (!_loading && _products.isEmpty)
          const _SectionState(message: '暂无匹配商品。')
        else
          for (final product in _products)
            _ProductCard(
              key: ValueKey('product-card-${product.id}'),
              product: product,
              currentCost:
                  _currentCost(_costsByProduct[product.id] ?? const []),
              selected: product.id == _selectedProduct?.id,
              onTap: () => _select(product),
            ),
      ],
    );
  }

  Widget _buildWorkspace(ProductRecord product) {
    final costs =
        _costsByProduct[product.id] ?? const <ProductActualCostRecord>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildBasicSection(product, costs),
        const SizedBox(height: 16),
        _buildActualCostsSection(costs),
        const SizedBox(height: 16),
        _buildDeductionSummarySection(),
      ],
    );
  }

  Widget _buildBasicSection(
    ProductRecord product,
    List<ProductActualCostRecord> costs,
  ) {
    final current = _currentCost(costs);
    return FormSection(
      title: '基础信息',
      trailing: StatusTag(
        label: product.isActive ? '已启用' : '已停用',
        tone: product.isActive ? StatusTone.success : StatusTone.warning,
      ),
      children: [
        ResponsiveFormGrid(
          minItemWidth: 190,
          children: [
            _InfoLine(label: '商品名称', value: product.name),
            _InfoLine(label: '单位', value: product.unit),
            _InfoLine(
              label: '当前实际成本',
              value: current == null
                  ? '暂无有效成本'
                  : formatMoneyCents(current.costCents),
            ),
            _InfoLine(label: '最近修改', value: _dateTimeLabel(product.updatedAt)),
            _InfoLine(label: '备注', value: _display(product.notes)),
          ],
        ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          alignment: WrapAlignment.end,
          children: [
            OutlinedButton.icon(
              key: const ValueKey('product-edit-button'),
              onPressed: () => _openProductEditor(product: product),
              icon: const Icon(Icons.edit_rounded),
              label: const Text('编辑'),
            ),
            FilledButton.tonalIcon(
              key: const ValueKey('product-status-button'),
              onPressed: () => _changeProductStatus(product),
              icon: Icon(product.isActive
                  ? Icons.pause_circle_outline_rounded
                  : Icons.play_circle_outline_rounded),
              label: Text(product.isActive ? '停用' : '启用'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildActualCostsSection(List<ProductActualCostRecord> costs) {
    return FormSection(
      title: '实际成本历史',
      trailing: FilledButton.icon(
        key: const ValueKey('product-actual-cost-add-button'),
        onPressed: () => _openCostEditor(),
        icon: const Icon(Icons.add_rounded),
        label: const Text('新增成本'),
      ),
      children: [
        const _InlineNotice(
          message: '实际成本用于订单成本和毛利快照；更新不会追溯重算历史订单。',
          tone: StatusTone.info,
        ),
        const SizedBox(height: 12),
        if (costs.isEmpty)
          const _SectionState(message: '暂无实际成本记录。')
        else
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columns: const [
                DataColumn(label: Text('成本')),
                DataColumn(label: Text('生效区间')),
                DataColumn(label: Text('状态')),
                DataColumn(label: Text('备注')),
                DataColumn(label: Text('操作')),
              ],
              rows: [
                for (final cost in costs)
                  DataRow(cells: [
                    DataCell(MoneyText(cents: cost.costCents)),
                    DataCell(Text(
                        _dateRangeLabel(cost.effectiveFrom, cost.effectiveTo))),
                    DataCell(StatusTag(
                      label: cost.isActive ? '启用' : '停用',
                      tone: cost.isActive
                          ? StatusTone.success
                          : StatusTone.warning,
                    )),
                    DataCell(Text(_display(cost.notes))),
                    DataCell(Wrap(
                      spacing: 4,
                      children: [
                        TextButton(
                          key: ValueKey('product-actual-cost-edit-${cost.id}'),
                          onPressed: () => _openCostEditor(cost: cost),
                          child: const Text('编辑'),
                        ),
                        TextButton(
                          key:
                              ValueKey('product-actual-cost-status-${cost.id}'),
                          onPressed: () => _changeCostStatus(cost),
                          child: Text(cost.isActive ? '停用' : '启用'),
                        ),
                      ],
                    )),
                  ]),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildDeductionSummarySection() {
    final activeSales =
        _salesDeductionRules.where((rule) => rule.isActive).length;
    final activeAgency =
        _agencyDeductionRules.where((rule) => rule.isActive).length;
    return FormSection(
      title: '扣减成本规则',
      trailing: _loadingDetail
          ? const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : null,
      children: [
        if (_detailErrorMessage != null) ...[
          _InlineNotice(message: _detailErrorMessage!, tone: StatusTone.danger),
          const SizedBox(height: 12),
        ],
        const _InlineNotice(
          message: '销售扣单成本、旅行社扣酒成本与商品实际成本分开维护，不参与订单毛利计算。',
          tone: StatusTone.warning,
        ),
        const SizedBox(height: 12),
        ResponsiveFormGrid(
          minItemWidth: 220,
          children: [
            _InfoLine(
              label: '销售扣单成本',
              value: '${_salesDeductionRules.length} 条（启用 $activeSales 条）',
            ),
            _InfoLine(
              label: '旅行社扣酒成本',
              value: '${_agencyDeductionRules.length} 条（启用 $activeAgency 条）',
            ),
          ],
        ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          alignment: WrapAlignment.end,
          children: [
            OutlinedButton.icon(
              onPressed: () => widget.onOpenDestination('commission_rules'),
              icon: const Icon(Icons.rule_folder_rounded),
              label: const Text('打开销售扣单规则'),
            ),
            OutlinedButton.icon(
              onPressed: () =>
                  widget.onOpenDestination('travel_agency_management'),
              icon: const Icon(Icons.apartment_rounded),
              label: const Text('打开旅行社扣酒规则'),
            ),
          ],
        ),
      ],
    );
  }
}

class _ProductEditorDialog extends StatefulWidget {
  const _ProductEditorDialog(
      {required this.businessApi, required this.product});

  final BusinessApi businessApi;
  final ProductRecord? product;

  @override
  State<_ProductEditorDialog> createState() => _ProductEditorDialogState();
}

class _ProductEditorDialogState extends State<_ProductEditorDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _unitController;
  late final TextEditingController _notesController;
  bool _saving = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.product?.name ?? '');
    _unitController = TextEditingController(text: widget.product?.unit ?? '');
    _notesController = TextEditingController(text: widget.product?.notes ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    _unitController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _saving = true;
      _errorMessage = null;
    });
    try {
      final body = <String, dynamic>{
        'name': _nameController.text.trim(),
        'unit': _unitController.text.trim(),
        'notes': _notesController.text.trim().isEmpty
            ? null
            : _notesController.text.trim(),
      };
      final product = widget.product == null
          ? await widget.businessApi.createProduct(body)
          : await widget.businessApi.updateProduct(widget.product!.id, body);
      if (mounted) Navigator.pop(context, product);
    } catch (error) {
      if (mounted) {
        setState(() {
          _saving = false;
          _errorMessage = _messageForError(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.product == null ? '新增商品' : '编辑商品'),
      content: SizedBox(
        width: 520,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_errorMessage != null) ...[
                  _InlineNotice(
                      message: _errorMessage!, tone: StatusTone.danger),
                  const SizedBox(height: 12),
                ],
                TextFormField(
                  key: const ValueKey('product-name-field'),
                  controller: _nameController,
                  decoration: const InputDecoration(labelText: '商品名称 *'),
                  maxLength: 160,
                  validator: _requiredValidator,
                ),
                TextFormField(
                  key: const ValueKey('product-unit-field'),
                  controller: _unitController,
                  decoration: const InputDecoration(labelText: '单位 *'),
                  maxLength: 20,
                  validator: _requiredValidator,
                ),
                TextFormField(
                  key: const ValueKey('product-notes-field'),
                  controller: _notesController,
                  decoration: const InputDecoration(labelText: '备注'),
                  minLines: 2,
                  maxLines: 4,
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          key: const ValueKey('product-save-button'),
          onPressed: _saving ? null : _save,
          child: Text(_saving ? '保存中...' : '保存'),
        ),
      ],
    );
  }
}

class _ActualCostEditorDialog extends StatefulWidget {
  const _ActualCostEditorDialog({
    required this.businessApi,
    required this.product,
    required this.cost,
  });

  final BusinessApi businessApi;
  final ProductRecord product;
  final ProductActualCostRecord? cost;

  @override
  State<_ActualCostEditorDialog> createState() =>
      _ActualCostEditorDialogState();
}

class _ActualCostEditorDialogState extends State<_ActualCostEditorDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _yuanController;
  late final TextEditingController _fromController;
  late final TextEditingController _toController;
  late final TextEditingController _notesController;
  bool _saving = false;
  bool _isActive = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    final cost = widget.cost;
    _yuanController = TextEditingController(
      text: cost == null ? '' : _yuanText(cost.costCents),
    );
    _fromController = TextEditingController(
      text: cost?.effectiveFrom ?? formatDate(DateTime.now()),
    );
    _toController = TextEditingController(text: cost?.effectiveTo ?? '');
    _notesController = TextEditingController(text: cost?.notes ?? '');
    _isActive = cost?.isActive ?? true;
  }

  @override
  void dispose() {
    _yuanController.dispose();
    _fromController.dispose();
    _toController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _saving = true;
      _errorMessage = null;
    });
    final body = <String, dynamic>{
      'costCents': _parseYuanToCents(_yuanController.text),
      'effectiveFrom': _fromController.text.trim(),
      'effectiveTo':
          _toController.text.trim().isEmpty ? null : _toController.text.trim(),
      'notes': _notesController.text.trim().isEmpty
          ? null
          : _notesController.text.trim(),
    };
    if (widget.cost == null) body['isActive'] = _isActive;
    try {
      final saved = widget.cost == null
          ? await widget.businessApi
              .createProductActualCost(widget.product.id, body)
          : await widget.businessApi
              .updateProductActualCost(widget.cost!.id, body);
      if (mounted) Navigator.pop(context, saved);
    } catch (error) {
      if (mounted) {
        setState(() {
          _saving = false;
          _errorMessage = _messageForError(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.cost == null ? '新增实际成本' : '编辑实际成本'),
      content: SizedBox(
        width: 560,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('${widget.product.name} / ${widget.product.unit}'),
                const SizedBox(height: 12),
                if (_errorMessage != null) ...[
                  _InlineNotice(
                      message: _errorMessage!, tone: StatusTone.danger),
                  const SizedBox(height: 12),
                ],
                TextFormField(
                  key: const ValueKey('product-actual-cost-yuan-field'),
                  controller: _yuanController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(
                        RegExp(r'^\d*\.?\d{0,2}$')),
                  ],
                  decoration: const InputDecoration(
                    labelText: '实际成本（元） *',
                    prefixText: '¥ ',
                    helperText: '最多两位小数，提交时转换为整数分。',
                  ),
                  validator: _moneyValidator,
                ),
                TextFormField(
                  key: const ValueKey('product-actual-cost-from-field'),
                  controller: _fromController,
                  decoration: const InputDecoration(
                    labelText: '生效日 *',
                    hintText: 'YYYY-MM-DD',
                  ),
                  validator: (value) => _dateValidator(value, required: true),
                ),
                TextFormField(
                  key: const ValueKey('product-actual-cost-to-field'),
                  controller: _toController,
                  decoration: const InputDecoration(
                    labelText: '失效日',
                    hintText: 'YYYY-MM-DD（可留空）',
                  ),
                  validator: (value) {
                    final dateError = _dateValidator(value, required: false);
                    if (dateError != null) return dateError;
                    final from = _fromController.text.trim();
                    final to = value?.trim() ?? '';
                    if (to.isNotEmpty &&
                        from.isNotEmpty &&
                        to.compareTo(from) < 0) {
                      return '失效日不能早于生效日';
                    }
                    return null;
                  },
                ),
                TextFormField(
                  key: const ValueKey('product-actual-cost-notes-field'),
                  controller: _notesController,
                  decoration: const InputDecoration(labelText: '备注'),
                  minLines: 2,
                  maxLines: 4,
                ),
                if (widget.cost == null)
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    value: _isActive,
                    title: const Text('创建后立即启用'),
                    onChanged: (value) => setState(() => _isActive = value),
                  ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          key: const ValueKey('product-actual-cost-save-button'),
          onPressed: _saving ? null : _save,
          child: Text(_saving ? '保存中...' : '保存'),
        ),
      ],
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({
    super.key,
    required this.product,
    required this.currentCost,
    required this.selected,
    required this.onTap,
  });

  final ProductRecord product;
  final ProductActualCostRecord? currentCost;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: selected ? scheme.primaryContainer.withValues(alpha: 0.45) : null,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      product.name,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                  ),
                  StatusTag(
                    label: product.isActive ? '启用' : '停用',
                    tone: product.isActive
                        ? StatusTone.success
                        : StatusTone.warning,
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text('单位：${product.unit}'),
              Text(
                  '当前实际成本：${currentCost == null ? '暂无' : formatMoneyCents(currentCost!.costCents)}'),
              Text('最近修改：${_dateTimeLabel(product.updatedAt)}'),
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelMedium),
        const SizedBox(height: 4),
        Text(value, style: Theme.of(context).textTheme.bodyLarge),
      ],
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({required this.message, required this.tone});
  final String message;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      StatusTone.danger => Theme.of(context).colorScheme.error,
      StatusTone.warning => const Color(0xFF8A5B00),
      StatusTone.success => const Color(0xFF176349),
      StatusTone.info => Theme.of(context).colorScheme.primary,
      StatusTone.neutral => Theme.of(context).colorScheme.onSurfaceVariant,
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        border: Border.all(color: color.withValues(alpha: 0.35)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(message, style: TextStyle(color: color)),
      ),
    );
  }
}

class _SectionState extends StatelessWidget {
  const _SectionState({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 20),
      child: Center(child: Text(message)),
    );
  }
}

ProductRecord? _selectProduct(List<ProductRecord> products, String? id) {
  if (products.isEmpty) return null;
  for (final product in products) {
    if (product.id == id) return product;
  }
  return products.first;
}

ProductActualCostRecord? _currentCost(List<ProductActualCostRecord> costs) {
  final today = formatDate(DateTime.now());
  final effective = costs.where((cost) {
    return cost.isActive &&
        cost.effectiveFrom.compareTo(today) <= 0 &&
        (cost.effectiveTo == null || cost.effectiveTo!.compareTo(today) >= 0);
  }).toList()
    ..sort((left, right) => right.effectiveFrom.compareTo(left.effectiveFrom));
  return effective.isEmpty ? null : effective.first;
}

String _dateRangeLabel(String from, String? to) => '$from 至 ${to ?? '长期'}';

String _dateTimeLabel(String? value) {
  if (value == null || value.isEmpty) return '-';
  final parsed = DateTime.tryParse(value)?.toLocal();
  if (parsed == null) return value;
  String two(int number) => number.toString().padLeft(2, '0');
  return '${parsed.year}-${two(parsed.month)}-${two(parsed.day)} '
      '${two(parsed.hour)}:${two(parsed.minute)}';
}

String _display(String? value) =>
    value == null || value.trim().isEmpty ? '-' : value.trim();

String? _requiredValidator(String? value) {
  if (value == null || value.trim().isEmpty) return '此项必填';
  return null;
}

String? _moneyValidator(String? value) {
  final text = value?.trim() ?? '';
  if (text.isEmpty) return '请输入实际成本';
  if (!RegExp(r'^\d+(\.\d{1,2})?$').hasMatch(text)) {
    return '请输入非负金额，最多两位小数';
  }
  final cents = _parseYuanToCents(text);
  if (cents > 2147483647) return '金额超出系统支持范围';
  return null;
}

int _parseYuanToCents(String value) {
  final parts = value.trim().split('.');
  final yuan = int.parse(parts.first);
  final fraction = parts.length == 1 ? '' : parts[1];
  final fen = fraction.isEmpty ? 0 : int.parse(fraction.padRight(2, '0'));
  return yuan * 100 + fen;
}

String _yuanText(int cents) {
  final yuan = cents ~/ 100;
  final fen = (cents % 100).toString().padLeft(2, '0');
  return '$yuan.$fen';
}

String? _dateValidator(String? value, {required bool required}) {
  final text = value?.trim() ?? '';
  if (text.isEmpty) return required ? '请输入日期' : null;
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text)) {
    return '日期格式应为 YYYY-MM-DD';
  }
  final parsed = DateTime.tryParse(text);
  if (parsed == null || formatDate(parsed) != text) return '请输入有效日期';
  return null;
}

String _messageForError(Object error) {
  if (error is ApiException) {
    switch (error.code) {
      case 'PRODUCT_ACTUAL_COST_RANGE_OVERLAP':
        return '启用的实际成本生效区间不能重叠，请调整起止日期或先停用冲突记录。';
      case 'PRODUCT_NAME_EXISTS':
        return '商品名称已存在，请使用唯一名称。';
      case 'PRODUCT_INACTIVE':
        return '该商品已停用，不能用于新业务。';
      case 'PERMISSION_DENIED':
        return '仅管理员和财务可访问商品与成本管理。';
      default:
        return error.message;
    }
  }
  return error.toString();
}
