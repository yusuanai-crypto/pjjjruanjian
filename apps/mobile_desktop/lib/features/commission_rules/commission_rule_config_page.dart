import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/product_option_picker.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class CommissionRuleConfigPage extends StatefulWidget {
  const CommissionRuleConfigPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<CommissionRuleConfigPage> createState() =>
      _CommissionRuleConfigPageState();
}

class _CommissionRuleConfigPageState extends State<CommissionRuleConfigPage>
    with SingleTickerProviderStateMixin {
  late BusinessApi _businessApi;
  late TabController _tabController;

  bool _loading = true;
  String? _errorMessage;
  String? _successMessage;
  String? _recalculationMessage;
  StatusTone _recalculationTone = StatusTone.info;
  _RuleKind _activeKind = _RuleKind.commission;
  _RuleKind? _lastImportKind;
  Stage7RuleImportResult? _lastImportResult;

  List<CommissionRuleRecord> _commissionRules = const <CommissionRuleRecord>[];
  List<SalesDeductionRuleRecord> _salesDeductionRules =
      const <SalesDeductionRuleRecord>[];
  List<AgencyDeductionRuleRecord> _agencyDeductionRules =
      const <AgencyDeductionRuleRecord>[];
  List<AgencyRebateRuleRecord> _agencyRebateRules =
      const <AgencyRebateRuleRecord>[];

  bool get _canRead =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance ||
      widget.role == UserRole.boss;

  bool get _canWrite =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _tabController = TabController(length: _RuleKind.values.length, vsync: this)
      ..addListener(_handleTabChanged);
    if (_canRead) {
      _loadRules();
    } else {
      _loading = false;
    }
  }

  @override
  void didUpdateWidget(covariant CommissionRuleConfigPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      if (_canRead) {
        _loadRules();
      }
    }
  }

  @override
  void dispose() {
    _tabController
      ..removeListener(_handleTabChanged)
      ..dispose();
    super.dispose();
  }

  void _handleTabChanged() {
    if (!_tabController.indexIsChanging &&
        _activeKind.index != _tabController.index) {
      setState(() => _activeKind = _RuleKind.values[_tabController.index]);
    }
  }

  Future<void> _loadRules() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final results = await Future.wait<dynamic>([
        _businessApi.listCommissionRules(limit: 200),
        _businessApi.listSalesDeductionRules(limit: 200),
        _businessApi.listAgencyDeductionRules(limit: 200),
        _businessApi.listAgencyRebateRules(limit: 200),
      ]);
      if (!mounted) {
        return;
      }
      setState(() {
        _commissionRules = results[0] as List<CommissionRuleRecord>;
        _salesDeductionRules = results[1] as List<SalesDeductionRuleRecord>;
        _agencyDeductionRules = results[2] as List<AgencyDeductionRuleRecord>;
        _agencyRebateRules = results[3] as List<AgencyRebateRuleRecord>;
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

  @override
  Widget build(BuildContext context) {
    if (!_canRead) {
      return const ResponsivePage(
        children: [
          _InlineNotice(
            message: '当前角色不可访问第 7 阶段规则配置。',
            tone: StatusTone.danger,
          ),
        ],
      );
    }

    return ResponsivePage(
      children: [
        FormSection(
          title: '第 7 阶段规则配置',
          trailing: StatusTag(
            label: _canWrite ? '可维护' : '只读',
            tone: _canWrite ? StatusTone.success : StatusTone.info,
          ),
          children: [
            TabBar(
              key: const ValueKey('stage7-rule-tabs'),
              controller: _tabController,
              isScrollable: true,
              tabs: [
                for (final kind in _RuleKind.values)
                  Tab(
                    key: ValueKey('stage7-rule-tab-${kind.name}'),
                    text: kind.label,
                  ),
              ],
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                OutlinedButton.icon(
                  key: const ValueKey('stage7-rule-refresh-button'),
                  onPressed: _loading ? null : _loadRules,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('刷新'),
                ),
                if (_canWrite)
                  FilledButton.icon(
                    key: const ValueKey('stage7-rule-add-button'),
                    onPressed: _loading
                        ? null
                        : () => _openEditor(_activeKind, record: null),
                    icon: const Icon(Icons.add_rounded),
                    label: Text('新增${_activeKind.shortLabel}'),
                  ),
                if (_canWrite && _activeKind.importSupported)
                  OutlinedButton.icon(
                    key: const ValueKey('stage7-rule-import-button'),
                    onPressed: _loading ? null : () => _openImport(_activeKind),
                    icon: const Icon(Icons.upload_file_rounded),
                    label: const Text('批量导入'),
                  ),
              ],
            ),
          ],
        ),
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        if (_successMessage != null)
          _InlineNotice(message: _successMessage!, tone: StatusTone.success),
        if (_recalculationMessage != null)
          _InlineNotice(
            message: _recalculationMessage!,
            tone: _recalculationTone,
          ),
        if (_lastImportResult != null && _lastImportKind != null)
          _ImportResultSection(
            kind: _lastImportKind!,
            result: _lastImportResult!,
          ),
        if (_loading)
          const FormSection(
            title: '规则列表',
            children: [
              _SectionState(message: '正在加载规则...', loading: true),
            ],
          )
        else
          _buildActiveRuleSection(),
      ],
    );
  }

  Widget _buildActiveRuleSection() {
    switch (_activeKind) {
      case _RuleKind.commission:
        return _buildCommissionRules();
      case _RuleKind.salesDeduction:
        return _buildSalesDeductionRules();
      case _RuleKind.agencyDeduction:
        return _buildAgencyDeductionRules();
      case _RuleKind.agencyRebate:
        return _buildAgencyRebateRules();
    }
  }

  Widget _buildCommissionRules() {
    if (_commissionRules.isEmpty) {
      return _emptySection(_RuleKind.commission);
    }
    return FormSection(
      title: '员工提成规则',
      trailing: StatusTag(
          label: '${_commissionRules.length} 条', tone: StatusTone.info),
      children: [
        _table(
          columns: const [
            DataColumn(label: Text('规则名称')),
            DataColumn(label: Text('对象')),
            DataColumn(label: Text('比例')),
            DataColumn(label: Text('生效日期')),
            DataColumn(label: Text('状态')),
            DataColumn(label: Text('备注')),
            DataColumn(label: Text('操作')),
          ],
          rows: [
            for (final rule in _commissionRules)
              DataRow(cells: [
                DataCell(Text(rule.ruleName)),
                DataCell(Text(_targetTypeLabel(rule.targetType))),
                DataCell(Text(rule.rate)),
                DataCell(Text(
                    _dateRangeLabel(rule.effectiveFrom, rule.effectiveTo))),
                DataCell(_activeTag(rule.isActive)),
                DataCell(_compactText(rule.notes)),
                DataCell(_actions(_RuleKind.commission, rule, rule.isActive)),
              ]),
          ],
        ),
      ],
    );
  }

  Widget _buildSalesDeductionRules() {
    if (_salesDeductionRules.isEmpty) {
      return _emptySection(_RuleKind.salesDeduction);
    }
    return FormSection(
      title: '销售扣单成本规则',
      trailing: StatusTag(
          label: '${_salesDeductionRules.length} 条', tone: StatusTone.info),
      children: [
        _table(
          columns: const [
            DataColumn(label: Text('酒品')),
            DataColumn(label: Text('扣单成本')),
            DataColumn(label: Text('生效日期')),
            DataColumn(label: Text('状态')),
            DataColumn(label: Text('备注')),
            DataColumn(label: Text('操作')),
          ],
          rows: [
            for (final rule in _salesDeductionRules)
              DataRow(cells: [
                DataCell(Text(rule.productName)),
                DataCell(Text(formatMoneyCents(rule.deductionCostCents))),
                DataCell(Text(
                    _dateRangeLabel(rule.effectiveFrom, rule.effectiveTo))),
                DataCell(_activeTag(rule.isActive)),
                DataCell(_compactText(rule.notes)),
                DataCell(
                    _actions(_RuleKind.salesDeduction, rule, rule.isActive)),
              ]),
          ],
        ),
      ],
    );
  }

  Widget _buildAgencyDeductionRules() {
    if (_agencyDeductionRules.isEmpty) {
      return _emptySection(_RuleKind.agencyDeduction);
    }
    return FormSection(
      title: '旅行社扣酒成本规则',
      trailing: StatusTag(
          label: '${_agencyDeductionRules.length} 条', tone: StatusTone.info),
      children: [
        _table(
          columns: const [
            DataColumn(label: Text('旅行社')),
            DataColumn(label: Text('酒品')),
            DataColumn(label: Text('扣酒成本')),
            DataColumn(label: Text('生效日期')),
            DataColumn(label: Text('状态')),
            DataColumn(label: Text('备注')),
            DataColumn(label: Text('操作')),
          ],
          rows: [
            for (final rule in _agencyDeductionRules)
              DataRow(cells: [
                DataCell(Text(_agencyLabel(rule.agencyId, rule.agencyName))),
                DataCell(Text(rule.productName)),
                DataCell(Text(formatMoneyCents(rule.deductionCostCents))),
                DataCell(Text(
                    _dateRangeLabel(rule.effectiveFrom, rule.effectiveTo))),
                DataCell(_activeTag(rule.isActive)),
                DataCell(_compactText(rule.notes)),
                DataCell(
                    _actions(_RuleKind.agencyDeduction, rule, rule.isActive)),
              ]),
          ],
        ),
      ],
    );
  }

  Widget _buildAgencyRebateRules() {
    if (_agencyRebateRules.isEmpty) {
      return _emptySection(_RuleKind.agencyRebate);
    }
    return FormSection(
      title: '旅行社返点比例规则',
      trailing: StatusTag(
          label: '${_agencyRebateRules.length} 条', tone: StatusTone.info),
      children: [
        _table(
          columns: const [
            DataColumn(label: Text('旅行社')),
            DataColumn(label: Text('日返')),
            DataColumn(label: Text('月返')),
            DataColumn(label: Text('合计')),
            DataColumn(label: Text('生效日期')),
            DataColumn(label: Text('状态')),
            DataColumn(label: Text('备注')),
            DataColumn(label: Text('操作')),
          ],
          rows: [
            for (final rule in _agencyRebateRules)
              DataRow(cells: [
                DataCell(Text(_agencyLabel(rule.agencyId, rule.agencyName))),
                DataCell(Text(rule.dailyRebateRate)),
                DataCell(Text(rule.monthlyRebateRate)),
                DataCell(Text(rule.totalRebateRate ?? '-')),
                DataCell(Text(
                    _dateRangeLabel(rule.effectiveFrom, rule.effectiveTo))),
                DataCell(_activeTag(rule.isActive)),
                DataCell(_compactText(rule.notes)),
                DataCell(_actions(_RuleKind.agencyRebate, rule, rule.isActive)),
              ]),
          ],
        ),
      ],
    );
  }

  Widget _emptySection(_RuleKind kind) {
    return FormSection(
      title: kind.label,
      trailing: const StatusTag(label: '0 条', tone: StatusTone.warning),
      children: [
        _SectionState(message: '暂无${kind.shortLabel}。'),
      ],
    );
  }

  Widget _table({
    required List<DataColumn> columns,
    required List<DataRow> rows,
  }) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(columns: columns, rows: rows),
    );
  }

  Widget _actions(_RuleKind kind, Object record, bool isActive) {
    if (!_canWrite) {
      return const StatusTag(label: '只读', tone: StatusTone.neutral);
    }
    final id = _recordId(record);
    return Wrap(
      spacing: 6,
      children: [
        TextButton.icon(
          key: ValueKey('stage7-rule-edit-${kind.name}-$id'),
          onPressed: () => _openEditor(kind, record: record),
          icon: const Icon(Icons.edit_rounded),
          label: const Text('编辑'),
        ),
        if (isActive)
          TextButton.icon(
            key: ValueKey('stage7-rule-disable-${kind.name}-$id'),
            onPressed: () => _disableRule(kind, record),
            icon: const Icon(Icons.block_rounded),
            label: const Text('停用'),
          ),
      ],
    );
  }

  Future<void> _openEditor(_RuleKind kind, {Object? record}) async {
    final saved = await showDialog<Object>(
      context: context,
      builder: (context) => _RuleEditorDialog(
        businessApi: _businessApi,
        kind: kind,
        record: record,
      ),
    );
    if (saved != null) {
      final recalculation = _recordRecalculation(saved);
      final hasProblem = recalculation != null &&
          (recalculation.failureCount > 0 ||
              recalculation.warnings.any(
                (warning) => warning.code.startsWith('missing_'),
              ));
      setState(() {
        _successMessage = hasProblem ? null : '规则已保存，相关订单重算已完成。';
        _errorMessage = null;
        _recalculationMessage =
            recalculation == null ? null : _recalculationSummary(recalculation);
        _recalculationTone = hasProblem
            ? StatusTone.danger
            : recalculation?.warnings.isNotEmpty == true
                ? StatusTone.warning
                : StatusTone.info;
      });
      await _loadRules();
    }
  }

  Future<void> _disableRule(_RuleKind kind, Object record) async {
    try {
      final saved =
          await _updateRule(kind, _recordId(record), {'isActive': false});
      if (!mounted) {
        return;
      }
      setState(() {
        _successMessage = '规则已停用。';
        _errorMessage = null;
        final recalculation = _recordRecalculation(saved);
        _recalculationMessage =
            recalculation == null ? null : _recalculationSummary(recalculation);
        _recalculationTone = recalculation?.failureCount == 0 &&
                recalculation?.warnings.isEmpty == true
            ? StatusTone.info
            : StatusTone.warning;
      });
      await _loadRules();
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _errorMessage = _messageForError(error));
    }
  }

  Future<void> _openImport(_RuleKind kind) async {
    final result = await showDialog<Stage7RuleImportResult>(
      context: context,
      builder: (context) => _RuleImportDialog(
        businessApi: _businessApi,
        kind: kind,
      ),
    );
    if (result == null) {
      return;
    }
    setState(() {
      _lastImportKind = kind;
      _lastImportResult = result;
      _successMessage =
          '导入完成：成功 ${result.successCount} 条，失败 ${result.failureCount} 条。';
      _errorMessage = result.failureCount > 0 ? '部分规则导入失败，请查看逐行原因。' : null;
    });
    await _loadRules();
  }

  Future<Object> _updateRule(
    _RuleKind kind,
    String id,
    Map<String, dynamic> body,
  ) {
    switch (kind) {
      case _RuleKind.commission:
        return _businessApi.updateCommissionRule(id, body);
      case _RuleKind.salesDeduction:
        return _businessApi.updateSalesDeductionRule(id, body);
      case _RuleKind.agencyDeduction:
        return _businessApi.updateAgencyDeductionRule(id, body);
      case _RuleKind.agencyRebate:
        return _businessApi.updateAgencyRebateRule(id, body);
    }
  }
}

class _RuleEditorDialog extends StatefulWidget {
  const _RuleEditorDialog({
    required this.businessApi,
    required this.kind,
    required this.record,
  });

  final BusinessApi businessApi;
  final _RuleKind kind;
  final Object? record;

  @override
  State<_RuleEditorDialog> createState() => _RuleEditorDialogState();
}

class _RuleEditorDialogState extends State<_RuleEditorDialog> {
  final _formKey = GlobalKey<FormState>();
  final _ruleNameController = TextEditingController();
  final _agencyNameController = TextEditingController();
  final _rateController = TextEditingController();
  final _dailyRateController = TextEditingController();
  final _monthlyRateController = TextEditingController();
  final _totalRateController = TextEditingController();
  final _costController = TextEditingController();
  final _effectiveFromController = TextEditingController();
  final _effectiveToController = TextEditingController();
  final _notesController = TextEditingController();

  String _targetType = 'sales_commission';
  String? _productId;
  String? _productSnapshotName;
  String? _selectedAgencyId;
  List<ProductOptionRecord> _productOptions = const [];
  List<TravelAgencyRecord> _agencyOptions = const [];
  bool _loadingProductOptions = false;
  bool _loadingAgencyOptions = false;
  String? _productOptionsError;
  String? _agencyOptionsError;
  String? _historicalAgencyBindingMessage;
  bool _isActive = true;
  bool _saving = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _fillFromRecord();
    _loadSelectionOptions();
  }

  @override
  void dispose() {
    _ruleNameController.dispose();
    _agencyNameController.dispose();
    _rateController.dispose();
    _dailyRateController.dispose();
    _monthlyRateController.dispose();
    _totalRateController.dispose();
    _costController.dispose();
    _effectiveFromController.dispose();
    _effectiveToController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  void _loadSelectionOptions() {
    if (widget.kind == _RuleKind.salesDeduction ||
        widget.kind == _RuleKind.agencyDeduction) {
      _loadProductOptions();
    }
    if (widget.kind == _RuleKind.agencyDeduction ||
        widget.kind == _RuleKind.agencyRebate) {
      _loadAgencyOptions();
    }
  }

  Future<void> _loadProductOptions() async {
    setState(() {
      _loadingProductOptions = true;
      _productOptionsError = null;
    });
    try {
      final options = await widget.businessApi.listProductOptions();
      if (!mounted) return;
      setState(() {
        _productOptions = options;
        _loadingProductOptions = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingProductOptions = false;
        _productOptionsError = _messageForError(error);
      });
    }
  }

  Future<void> _loadAgencyOptions() async {
    setState(() {
      _loadingAgencyOptions = true;
      _agencyOptionsError = null;
    });
    try {
      final options = await widget.businessApi.listTravelAgencies(limit: 100);
      if (!mounted) return;
      setState(() {
        _agencyOptions = options;
        _loadingAgencyOptions = false;
        _bindHistoricalAgencyIfUnique(options);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingAgencyOptions = false;
        _agencyOptionsError = _messageForError(error);
      });
    }
  }

  void _fillFromRecord() {
    final record = widget.record;
    switch (widget.kind) {
      case _RuleKind.commission:
        if (record is CommissionRuleRecord) {
          _ruleNameController.text = record.ruleName;
          _targetType =
              record.targetType.isEmpty ? _targetType : record.targetType;
          _rateController.text = record.rate;
          _effectiveFromController.text = record.effectiveFrom;
          _effectiveToController.text = record.effectiveTo ?? '';
          _notesController.text = record.notes ?? '';
          _isActive = record.isActive;
        }
        break;
      case _RuleKind.salesDeduction:
        if (record is SalesDeductionRuleRecord) {
          _productId = record.productId;
          _productSnapshotName = record.productName;
          _costController.text = _centsToYuanText(record.deductionCostCents);
          _effectiveFromController.text = record.effectiveFrom;
          _effectiveToController.text = record.effectiveTo ?? '';
          _notesController.text = record.notes ?? '';
          _isActive = record.isActive;
        }
        break;
      case _RuleKind.agencyDeduction:
        if (record is AgencyDeductionRuleRecord) {
          _agencyNameController.text = record.agencyName ?? '';
          _selectedAgencyId = record.agencyId;
          _productId = record.productId;
          _productSnapshotName = record.productName;
          _costController.text = _centsToYuanText(record.deductionCostCents);
          _effectiveFromController.text = record.effectiveFrom;
          _effectiveToController.text = record.effectiveTo ?? '';
          _notesController.text = record.notes ?? '';
          _isActive = record.isActive;
        }
        break;
      case _RuleKind.agencyRebate:
        if (record is AgencyRebateRuleRecord) {
          _agencyNameController.text = record.agencyName ?? '';
          _selectedAgencyId = record.agencyId;
          _dailyRateController.text = record.dailyRebateRate;
          _monthlyRateController.text = record.monthlyRebateRate;
          _totalRateController.text = record.totalRebateRate ?? '';
          _effectiveFromController.text = record.effectiveFrom;
          _effectiveToController.text = record.effectiveTo ?? '';
          _notesController.text = record.notes ?? '';
          _isActive = record.isActive;
        }
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.record != null;
    return AlertDialog(
      title: Text('${editing ? '编辑' : '新增'}${widget.kind.shortLabel}'),
      content: SizedBox(
        width: 620,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_errorMessage != null)
                  _InlineNotice(
                      message: _errorMessage!, tone: StatusTone.danger),
                ..._fieldsForKind(),
                SwitchListTile(
                  key: const ValueKey('stage7-rule-active-switch'),
                  contentPadding: EdgeInsets.zero,
                  value: _isActive,
                  title: const Text('启用规则'),
                  subtitle: const Text('关闭后规则停用，历史计算快照不被覆盖。'),
                  onChanged: _saving
                      ? null
                      : (value) => setState(() => _isActive = value),
                ),
                TextFormField(
                  key: const ValueKey('stage7-rule-effective-from-field'),
                  controller: _effectiveFromController,
                  decoration: const InputDecoration(
                    labelText: '生效开始日期',
                    hintText: 'YYYY-MM-DD',
                  ),
                  validator: _requiredValidator('请填写生效开始日期'),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('stage7-rule-effective-to-field'),
                  controller: _effectiveToController,
                  decoration: const InputDecoration(
                    labelText: '生效结束日期',
                    hintText: '留空表示长期有效',
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('stage7-rule-notes-field'),
                  controller: _notesController,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: '备注'),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('stage7-rule-save-button'),
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.check_rounded),
          label: Text(_saving ? '保存中' : '保存'),
        ),
      ],
    );
  }

  List<Widget> _fieldsForKind() {
    switch (widget.kind) {
      case _RuleKind.commission:
        return [
          TextFormField(
            key: const ValueKey('stage7-rule-name-field'),
            controller: _ruleNameController,
            decoration: const InputDecoration(labelText: '规则名称'),
            validator: _requiredValidator('请填写规则名称'),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            key: const ValueKey('stage7-rule-target-type-field'),
            initialValue: _targetType,
            decoration: const InputDecoration(labelText: '提成对象'),
            items: const [
              DropdownMenuItem(value: 'sales_commission', child: Text('销售')),
              DropdownMenuItem(value: 'outreach_commission', child: Text('外联')),
              DropdownMenuItem(value: 'leader_commission', child: Text('组长')),
            ],
            onChanged: _saving
                ? null
                : (value) => setState(() => _targetType = value ?? _targetType),
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const ValueKey('stage7-rule-rate-field'),
            controller: _rateController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: '提成比例',
              hintText: '例如 0.0200',
            ),
            validator: _requiredValidator('请填写提成比例'),
          ),
          const SizedBox(height: 12),
        ];
      case _RuleKind.salesDeduction:
        return [
          _productField(),
          const SizedBox(height: 12),
          _costField('扣单成本（元）'),
          const SizedBox(height: 12),
        ];
      case _RuleKind.agencyDeduction:
        return [
          _agencySelectionField(),
          const SizedBox(height: 12),
          _productField(),
          const SizedBox(height: 12),
          _costField('扣酒成本（元）'),
          const SizedBox(height: 12),
        ];
      case _RuleKind.agencyRebate:
        return [
          _agencySelectionField(),
          const SizedBox(height: 12),
          TextFormField(
            key: const ValueKey('stage7-rule-daily-rate-field'),
            controller: _dailyRateController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: '日返比例',
              hintText: '例如 0.0300',
            ),
            validator: _requiredValidator('请填写日返比例'),
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const ValueKey('stage7-rule-monthly-rate-field'),
            controller: _monthlyRateController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: '月返比例',
              hintText: '例如 0.0200',
            ),
            validator: _requiredValidator('请填写月返比例'),
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const ValueKey('stage7-rule-total-rate-field'),
            controller: _totalRateController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: '合计比例',
              hintText: '可留空，由后端规则决定',
            ),
          ),
          const SizedBox(height: 12),
        ];
    }
  }

  Widget _productField() {
    return ProductOptionPickerField(
      key: const ValueKey('stage7-rule-product-field'),
      options: _productOptions,
      loading: _loadingProductOptions,
      loadError: _productOptionsError,
      productId: _productId,
      snapshotName: _productSnapshotName,
      snapshotUnit: null,
      onRetry: _loadProductOptions,
      onChanged: (product) => setState(() {
        _productId = product.id;
        _productSnapshotName = product.name;
      }),
    );
  }

  Widget _agencySelectionField() {
    final hasHistoricalAgency = (_selectedAgencyId ?? '').isNotEmpty &&
        !_agencyOptions.any((agency) => agency.id == _selectedAgencyId);
    final hasUnboundHistoricalAgency = widget.record != null &&
        (_selectedAgencyId ?? '').isEmpty &&
        _agencyNameController.text.trim().isNotEmpty;
    return DropdownButtonFormField<String>(
      key: const ValueKey('stage7-rule-agency-field'),
      initialValue: hasHistoricalAgency ? null : _selectedAgencyId,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: '旅行社',
        helperText: _loadingAgencyOptions
            ? '正在加载旅行社...'
            : _agencyOptionsError != null
                ? '旅行社加载失败：$_agencyOptionsError'
                : _historicalAgencyBindingMessage ??
                    (hasHistoricalAgency || hasUnboundHistoricalAgency
                        ? '历史规则未能唯一绑定旅行社主档，请重新选择后再保存。'
                        : _selectedAgencyName == null
                            ? null
                            : '旅行社名称快照：$_selectedAgencyName'),
      ),
      items: [
        for (final agency in _agencyOptions)
          DropdownMenuItem(value: agency.id, child: Text(agency.name)),
      ],
      onChanged: _loadingAgencyOptions
          ? null
          : (value) => setState(() {
                _selectedAgencyId = value;
                _agencyNameController.text = _selectedAgencyName ?? '';
                _historicalAgencyBindingMessage = null;
              }),
      validator: (_) {
        if (_loadingAgencyOptions) return '请等待旅行社加载完成';
        if (_agencyOptionsError != null) return '旅行社选项加载失败';
        if ((_selectedAgencyId ?? '').isEmpty ||
            hasHistoricalAgency ||
            _selectedAgencyName == null) {
          return '必须选择有效的旅行社主档后才能保存';
        }
        return null;
      },
    );
  }

  String? get _selectedAgencyName {
    for (final agency in _agencyOptions) {
      if (agency.id == _selectedAgencyId) {
        return agency.name;
      }
    }
    return null;
  }

  void _bindHistoricalAgencyIfUnique(List<TravelAgencyRecord> options) {
    if (widget.record == null) {
      return;
    }
    final selectedId = (_selectedAgencyId ?? '').trim();
    if (selectedId.isNotEmpty &&
        options.any((agency) => agency.id == selectedId)) {
      _agencyNameController.text =
          options.firstWhere((agency) => agency.id == selectedId).name;
      return;
    }
    final historicalName = _agencyNameController.text.trim();
    if (historicalName.isEmpty) {
      _selectedAgencyId = null;
      _historicalAgencyBindingMessage = '历史规则没有旅行社 ID 或名称，请重新选择旅行社主档。';
      return;
    }
    final normalizedName = _normalizeAgencyName(historicalName);
    final matches = options
        .where(
          (agency) => _normalizeAgencyName(agency.name) == normalizedName,
        )
        .toList();
    if (matches.length == 1) {
      _selectedAgencyId = matches.single.id;
      _agencyNameController.text = matches.single.name;
      _historicalAgencyBindingMessage =
          '已按历史名称“$historicalName”唯一匹配旅行社主档，请核对后保存完成绑定。';
      return;
    }
    _selectedAgencyId = null;
    _historicalAgencyBindingMessage = matches.isEmpty
        ? '历史名称“$historicalName”未匹配到旅行社主档，请重新选择。'
        : '历史名称“$historicalName”匹配到多个旅行社主档，请重新选择，系统不会猜测。';
  }

  Widget _costField(String label) {
    return TextFormField(
      key: const ValueKey('stage7-rule-cost-field'),
      controller: _costController,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(labelText: label, hintText: '例如 12.50'),
      validator: (value) {
        if ((value ?? '').trim().isEmpty) {
          return '请填写成本金额';
        }
        if (_parseMoneyCents(value) == null) {
          return '金额格式不正确';
        }
        return null;
      },
    );
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() {
      _saving = true;
      _errorMessage = null;
    });

    try {
      final body = _bodyForKind();
      final id = widget.record == null ? null : _recordId(widget.record!);
      final Object saved;
      if (id == null) {
        saved = await _createRule(body);
      } else {
        saved = await _updateRule(id, body);
      }
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(saved);
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

  Map<String, dynamic> _bodyForKind() {
    final body = <String, dynamic>{
      'effectiveFrom': _effectiveFromController.text.trim(),
      'effectiveTo': _nullableText(_effectiveToController.text),
      'isActive': _isActive,
      'notes': _nullableText(_notesController.text),
    };
    switch (widget.kind) {
      case _RuleKind.commission:
        body
          ..['ruleName'] = _ruleNameController.text.trim()
          ..['targetType'] = _targetType
          ..['rate'] = _rateController.text.trim();
        break;
      case _RuleKind.salesDeduction:
        body
          ..['productId'] = _productId
          ..['deductionCostCents'] = _parseMoneyCents(_costController.text);
        break;
      case _RuleKind.agencyDeduction:
        body
          ..['agencyId'] = _selectedAgencyId
          ..['productId'] = _productId
          ..['deductionCostCents'] = _parseMoneyCents(_costController.text);
        break;
      case _RuleKind.agencyRebate:
        body
          ..['agencyId'] = _selectedAgencyId
          ..['agencyName'] = _selectedAgencyName
          ..['dailyRebateRate'] = _dailyRateController.text.trim()
          ..['monthlyRebateRate'] = _monthlyRateController.text.trim()
          ..['totalRebateRate'] = _nullableText(_totalRateController.text);
        break;
    }
    return body;
  }

  Future<Object> _createRule(Map<String, dynamic> body) {
    switch (widget.kind) {
      case _RuleKind.commission:
        return widget.businessApi.createCommissionRule(body);
      case _RuleKind.salesDeduction:
        return widget.businessApi.createSalesDeductionRule(body);
      case _RuleKind.agencyDeduction:
        return widget.businessApi.createAgencyDeductionRule(body);
      case _RuleKind.agencyRebate:
        return widget.businessApi.createAgencyRebateRule(body);
    }
  }

  Future<Object> _updateRule(String id, Map<String, dynamic> body) {
    switch (widget.kind) {
      case _RuleKind.commission:
        return widget.businessApi.updateCommissionRule(id, body);
      case _RuleKind.salesDeduction:
        return widget.businessApi.updateSalesDeductionRule(id, body);
      case _RuleKind.agencyDeduction:
        return widget.businessApi.updateAgencyDeductionRule(id, body);
      case _RuleKind.agencyRebate:
        return widget.businessApi.updateAgencyRebateRule(id, body);
    }
  }
}

CommissionRecalculationResult? _recordRecalculation(Object record) {
  if (record is CommissionRuleRecord) return record.recalculation;
  if (record is AgencyDeductionRuleRecord) return record.recalculation;
  if (record is AgencyRebateRuleRecord) return record.recalculation;
  return null;
}

String _recalculationSummary(CommissionRecalculationResult result) {
  final lines = <String>[
    '提成重算结果：订单 ${result.orderCount} 单，生成 ${result.generatedCount} 条，'
        '更新 ${result.updatedCount} 条，跳过 ${result.skippedCount} 单，'
        '失败 ${result.failureCount} 单。',
  ];
  for (final warning in result.warnings) {
    lines.add('告警 ${warning.code}：${warning.message}');
  }
  return lines.join('\n');
}

class _RuleImportDialog extends StatefulWidget {
  const _RuleImportDialog({
    required this.businessApi,
    required this.kind,
  });

  final BusinessApi businessApi;
  final _RuleKind kind;

  @override
  State<_RuleImportDialog> createState() => _RuleImportDialogState();
}

class _RuleImportDialogState extends State<_RuleImportDialog> {
  final _jsonController = TextEditingController();
  bool _importing = false;
  bool _loadingAgencyOptions = false;
  String? _errorMessage;
  String? _agencyOptionsError;
  List<TravelAgencyRecord> _agencyOptions = const [];
  List<String> _rowValidationErrors = const [];

  @override
  void initState() {
    super.initState();
    _jsonController.text = widget.kind.importExample;
    if (widget.kind == _RuleKind.agencyRebate) {
      _loadAgencyOptions();
    }
  }

  @override
  void dispose() {
    _jsonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('批量导入${widget.kind.shortLabel}'),
      content: SizedBox(
        width: 680,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_errorMessage != null)
              _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
            if (_rowValidationErrors.isNotEmpty) ...[
              const SizedBox(height: 8),
              for (final error in _rowValidationErrors)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(
                    error,
                    key: ValueKey('stage7-rule-import-row-error-$error'),
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
            ],
            Text(
              '请粘贴结构化 JSON 数组，或 { "rules": [...] }。后端会逐行返回成功和失败原因。',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('stage7-rule-import-json-field'),
              controller: _jsonController,
              minLines: 10,
              maxLines: 16,
              decoration: const InputDecoration(
                labelText: 'JSON 规则数据',
                alignLabelWithHint: true,
              ),
              style: const TextStyle(fontFamily: 'monospace'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _importing ? null : () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('stage7-rule-import-submit-button'),
          onPressed: _importing || _loadingAgencyOptions ? null : _submit,
          icon: _importing
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.upload_file_rounded),
          label: Text(_importing ? '导入中' : '导入'),
        ),
      ],
    );
  }

  Future<void> _loadAgencyOptions() async {
    setState(() {
      _loadingAgencyOptions = true;
      _agencyOptionsError = null;
    });
    try {
      final options = await widget.businessApi.listTravelAgencies(limit: 500);
      if (!mounted) return;
      setState(() {
        _agencyOptions = options;
        _loadingAgencyOptions = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingAgencyOptions = false;
        _agencyOptionsError = _messageForError(error);
      });
    }
  }

  Future<void> _submit() async {
    final rules = _parseRules();
    if (rules == null) {
      return;
    }
    setState(() {
      _importing = true;
      _errorMessage = null;
      _rowValidationErrors = const [];
    });
    try {
      final result = await _importRules(rules);
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(result);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _importing = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  List<Map<String, dynamic>>? _parseRules() {
    try {
      final decoded = jsonDecode(_jsonController.text.trim());
      final rawRules = decoded is Map ? decoded['rules'] : decoded;
      if (rawRules is! List) {
        setState(() => _errorMessage = 'JSON 必须是数组，或包含 rules 数组。');
        return null;
      }
      final rules = rawRules
          .whereType<Map>()
          .map((item) => item.map((key, value) => MapEntry('$key', value)))
          .toList();
      if (rules.length != rawRules.length || rules.isEmpty) {
        setState(() => _errorMessage = '每一行规则都必须是对象，且至少包含一行。');
        return null;
      }
      if (widget.kind == _RuleKind.salesDeduction ||
          widget.kind == _RuleKind.agencyDeduction) {
        for (final rule in rules) {
          if ('${rule['productId'] ?? ''}'.trim().isEmpty) {
            setState(() => _errorMessage = '扣减成本导入必须提供 productId，不接受商品名称文本。');
            return null;
          }
          rule
            ..remove('productName')
            ..remove('unit')
            ..remove('actualUnitCostCents')
            ..remove('actualCostSubtotalCents');
        }
      }
      if (widget.kind == _RuleKind.agencyDeduction &&
          rules.any((rule) => '${rule['agencyId'] ?? ''}'.trim().isEmpty)) {
        setState(() => _errorMessage = '旅行社扣酒导入必须提供 agencyId。');
        return null;
      }
      if (widget.kind == _RuleKind.agencyRebate) {
        if (_agencyOptionsError != null) {
          setState(() {
            _errorMessage = '无法校验旅行社主档：$_agencyOptionsError';
            _rowValidationErrors = const [];
          });
          return null;
        }
        final agenciesById = {
          for (final agency in _agencyOptions) agency.id: agency,
        };
        final rowErrors = <String>[];
        for (var index = 0; index < rules.length; index += 1) {
          final agencyId = '${rules[index]['agencyId'] ?? ''}'.trim();
          if (agencyId.isEmpty) {
            rowErrors.add('第 ${index + 1} 行：缺少 agencyId，日返/月返规则不能导入。');
            continue;
          }
          final agency = agenciesById[agencyId];
          if (agency == null) {
            rowErrors.add(
              '第 ${index + 1} 行：旅行社 ID“$agencyId”无效，未找到对应主档。',
            );
            continue;
          }
          rules[index]['agencyName'] = agency.name;
        }
        if (rowErrors.isNotEmpty) {
          setState(() {
            _errorMessage = '日返/月返导入校验失败，共 ${rowErrors.length} 行需要修正。';
            _rowValidationErrors = rowErrors;
          });
          return null;
        }
      }
      return rules;
    } on FormatException catch (error) {
      setState(() => _errorMessage = 'JSON 格式错误：${error.message}');
      return null;
    }
  }

  Future<Stage7RuleImportResult> _importRules(
    List<Map<String, dynamic>> rules,
  ) {
    switch (widget.kind) {
      case _RuleKind.salesDeduction:
        return widget.businessApi.importSalesDeductionRules(rules);
      case _RuleKind.agencyDeduction:
        return widget.businessApi.importAgencyDeductionRules(rules);
      case _RuleKind.agencyRebate:
        return widget.businessApi.importAgencyRebateRules(rules);
      case _RuleKind.commission:
        throw const ApiException(
          statusCode: 400,
          code: 'IMPORT_UNSUPPORTED',
          message: '员工提成规则暂不支持批量导入。',
        );
    }
  }
}

class _ImportResultSection extends StatelessWidget {
  const _ImportResultSection({
    required this.kind,
    required this.result,
  });

  final _RuleKind kind;
  final Stage7RuleImportResult result;

  @override
  Widget build(BuildContext context) {
    final failures = result.results.where((item) => !item.success).toList();
    return FormSection(
      title: '${kind.shortLabel}导入结果',
      trailing: StatusTag(
        label: '成功 ${result.successCount} / 失败 ${result.failureCount}',
        tone:
            result.failureCount == 0 ? StatusTone.success : StatusTone.warning,
      ),
      children: [
        Text('总行数：${result.totalCount}'),
        if (failures.isNotEmpty) ...[
          const SizedBox(height: 10),
          for (final failure in failures.take(6))
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.error_outline_rounded),
              title: Text(
                  '第 ${failure.rowNumber} 行：${failure.errorCode ?? 'ERROR'}'),
              subtitle: Text(failure.errorMessage ?? '导入失败'),
            ),
        ],
      ],
    );
  }
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
    return StatusTag(label: message, tone: tone);
  }
}

class _SectionState extends StatelessWidget {
  const _SectionState({
    required this.message,
    this.loading = false,
  });

  final String message;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (loading)
            const SizedBox.square(
              dimension: 28,
              child: CircularProgressIndicator(strokeWidth: 2.4),
            )
          else
            Icon(
              Icons.rule_folder_rounded,
              size: 34,
              color: Theme.of(context).colorScheme.primary,
            ),
          const SizedBox(height: 12),
          Text(
            message,
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

enum _RuleKind {
  commission,
  salesDeduction,
  agencyDeduction,
  agencyRebate,
}

extension _RuleKindMeta on _RuleKind {
  String get label {
    switch (this) {
      case _RuleKind.commission:
        return '员工提成';
      case _RuleKind.salesDeduction:
        return '销售扣单';
      case _RuleKind.agencyDeduction:
        return '旅行社扣酒';
      case _RuleKind.agencyRebate:
        return '旅行社返点';
    }
  }

  String get shortLabel {
    switch (this) {
      case _RuleKind.commission:
        return '员工提成规则';
      case _RuleKind.salesDeduction:
        return '销售扣单规则';
      case _RuleKind.agencyDeduction:
        return '旅行社扣酒规则';
      case _RuleKind.agencyRebate:
        return '旅行社返点规则';
    }
  }

  bool get importSupported => this != _RuleKind.commission;

  String get importExample {
    switch (this) {
      case _RuleKind.salesDeduction:
        return const JsonEncoder.withIndent('  ').convert([
          {
            'productId': 'replace-with-active-product-id',
            'deductionCostCents': 1200,
            'effectiveFrom': '2026-07-01',
            'notes': 'stage7 smoke import',
          }
        ]);
      case _RuleKind.agencyDeduction:
        return const JsonEncoder.withIndent('  ').convert([
          {
            'agencyId': 'replace-with-travel-agency-id',
            'productId': 'replace-with-active-product-id',
            'deductionCostCents': 800,
            'effectiveFrom': '2026-07-01',
            'notes': 'stage7 smoke import',
          }
        ]);
      case _RuleKind.agencyRebate:
        return const JsonEncoder.withIndent('  ').convert([
          {
            'agencyId': 'replace-with-travel-agency-id',
            'dailyRebateRate': '0.0300',
            'monthlyRebateRate': '0.0200',
            'effectiveFrom': '2026-07-01',
            'notes': 'stage7 smoke import',
          }
        ]);
      case _RuleKind.commission:
        return '[]';
    }
  }
}

String _recordId(Object record) {
  if (record is CommissionRuleRecord) {
    return record.id;
  }
  if (record is SalesDeductionRuleRecord) {
    return record.id;
  }
  if (record is AgencyDeductionRuleRecord) {
    return record.id;
  }
  if (record is AgencyRebateRuleRecord) {
    return record.id;
  }
  return '';
}

String _dateRangeLabel(String from, String? to) {
  return to == null || to.isEmpty ? '$from 起' : '$from 至 $to';
}

String _agencyLabel(String? agencyId, String? agencyName) {
  final name = agencyName == null || agencyName.isEmpty ? '未填名称' : agencyName;
  final id = agencyId == null || agencyId.isEmpty ? null : agencyId;
  return id == null ? name : '$name ($id)';
}

String _targetTypeLabel(String value) {
  switch (value) {
    case 'sales_commission':
      return '销售';
    case 'outreach_commission':
      return '外联';
    case 'leader_commission':
      return '组长';
    default:
      return value;
  }
}

Widget _activeTag(bool isActive) {
  return StatusTag(
    label: isActive ? '启用' : '停用',
    tone: isActive ? StatusTone.success : StatusTone.neutral,
  );
}

Widget _compactText(String? value) {
  return ConstrainedBox(
    constraints: const BoxConstraints(maxWidth: 180),
    child: Text(
      value == null || value.isEmpty ? '-' : value,
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    ),
  );
}

String? Function(String?) _requiredValidator(String message) {
  return (value) {
    if ((value ?? '').trim().isEmpty) {
      return message;
    }
    return null;
  };
}

String? _nullableText(String value) {
  final text = value.trim();
  return text.isEmpty ? null : text;
}

String _normalizeAgencyName(String value) {
  return value.trim().replaceAll(RegExp(r'\s+'), '').toLowerCase();
}

int? _parseMoneyCents(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) {
    return null;
  }
  final amount = double.tryParse(text);
  if (amount == null) {
    return null;
  }
  return (amount * 100).round();
}

String _centsToYuanText(int cents) {
  return (cents / 100).toStringAsFixed(2);
}

String _messageForError(Object error) {
  if (error is ApiException) {
    final code = error.code.trim();
    if (code.isNotEmpty && code != 'HTTP_ERROR') {
      return '$code：${error.message}';
    }
    return error.message;
  }
  return '操作失败，请稍后重试。';
}
