import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/product_option_picker.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

const _agencyDeductionModeEffectiveSalesRate = 'effective_sales_rate';
const _agencyDeductionModeManualProductReference = 'manual_product_reference';
const _defaultAgencyDeductionRate = '0.3000';

class TravelAgencyManagementPage extends StatefulWidget {
  const TravelAgencyManagementPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<TravelAgencyManagementPage> createState() =>
      _TravelAgencyManagementPageState();
}

class _TravelAgencyManagementPageState
    extends State<TravelAgencyManagementPage> {
  late BusinessApi _businessApi;
  final _searchController = TextEditingController();

  bool _loadingAgencies = true;
  bool _loadingRules = false;
  String? _errorMessage;
  String? _ruleErrorMessage;
  List<TravelAgencyRecord> _agencies = const <TravelAgencyRecord>[];
  TravelAgencyRecord? _selectedAgency;
  List<AgencyRebateRuleRecord> _rebateRules = const <AgencyRebateRuleRecord>[];
  List<AgencyDeductionRuleRecord> _deductionRules =
      const <AgencyDeductionRuleRecord>[];

  bool get _canManage =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.finance;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _loadAgencies();
  }

  @override
  void didUpdateWidget(covariant TravelAgencyManagementPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.role != widget.role) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadAgencies();
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadAgencies({String? preferredAgencyId}) async {
    if (!_canManage) {
      setState(() {
        _loadingAgencies = false;
        _agencies = const <TravelAgencyRecord>[];
        _selectedAgency = null;
      });
      return;
    }

    setState(() {
      _loadingAgencies = true;
      _errorMessage = null;
    });

    try {
      final agencies = await _businessApi.listTravelAgencies(
        keyword: _searchController.text.trim(),
        limit: 100,
      );
      if (!mounted) {
        return;
      }
      final selected = _selectAgencyFromList(
        agencies,
        preferredAgencyId ?? _selectedAgency?.id,
      );
      setState(() {
        _agencies = agencies;
        _selectedAgency = selected;
        _loadingAgencies = false;
      });
      await _loadRulesForAgency(selected);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loadingAgencies = false;
        _agencies = const <TravelAgencyRecord>[];
        _selectedAgency = null;
        _rebateRules = const <AgencyRebateRuleRecord>[];
        _deductionRules = const <AgencyDeductionRuleRecord>[];
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _loadRulesForAgency(TravelAgencyRecord? agency) async {
    if (agency == null) {
      setState(() {
        _rebateRules = const <AgencyRebateRuleRecord>[];
        _deductionRules = const <AgencyDeductionRuleRecord>[];
        _ruleErrorMessage = null;
        _loadingRules = false;
      });
      return;
    }

    setState(() {
      _loadingRules = true;
      _ruleErrorMessage = null;
    });

    try {
      final results = await Future.wait<dynamic>([
        _businessApi.listAgencyRebateRules(agencyId: agency.id, limit: 200),
        _businessApi.listAgencyRebateRules(
          agencyName: agency.name,
          limit: 200,
        ),
        _businessApi.listAgencyDeductionRules(agencyId: agency.id, limit: 200),
        _businessApi.listAgencyDeductionRules(
          agencyName: agency.name,
          limit: 200,
        ),
      ]);
      if (!mounted) {
        return;
      }
      setState(() {
        _rebateRules = _mergeById<AgencyRebateRuleRecord>(
          [
            ...results[0] as List<AgencyRebateRuleRecord>,
            ...results[1] as List<AgencyRebateRuleRecord>,
          ],
          (rule) => rule.id,
        );
        _deductionRules = _mergeById<AgencyDeductionRuleRecord>(
          [
            ...results[2] as List<AgencyDeductionRuleRecord>,
            ...results[3] as List<AgencyDeductionRuleRecord>,
          ],
          (rule) => rule.id,
        );
        _loadingRules = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loadingRules = false;
        _ruleErrorMessage = _messageForError(error);
      });
    }
  }

  void _selectAgency(TravelAgencyRecord agency) {
    setState(() => _selectedAgency = agency);
    _loadRulesForAgency(agency);
  }

  Future<void> _openAgencyDialog({TravelAgencyRecord? agency}) async {
    final saved = await showDialog<TravelAgencyRecord>(
      context: context,
      builder: (context) => _AgencyEditorDialog(
        businessApi: _businessApi,
        agency: agency,
      ),
    );
    if (saved == null) {
      return;
    }
    await _loadAgencies(preferredAgencyId: saved.id);
  }

  Future<void> _openRebateDialog({AgencyRebateRuleRecord? rule}) async {
    final agency = _selectedAgency;
    if (agency == null) {
      return;
    }
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => _RebateRuleDialog(
        businessApi: _businessApi,
        agency: agency,
        rule: rule,
      ),
    );
    if (saved == true) {
      await _loadRulesForAgency(agency);
    }
  }

  Future<void> _openRebateBatchImportDialog() async {
    await _openBatchImportDialog(_TravelAgencyRuleImportKind.rebate);
  }

  Future<void> _openDeductionDialog({AgencyDeductionRuleRecord? rule}) async {
    final agency = _selectedAgency;
    if (agency == null) {
      return;
    }
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => _DeductionRuleDialog(
        businessApi: _businessApi,
        agency: agency,
        rule: rule,
      ),
    );
    if (saved == true) {
      await _loadRulesForAgency(agency);
    }
  }

  Future<void> _openDeductionBatchImportDialog() async {
    await _openBatchImportDialog(_TravelAgencyRuleImportKind.deduction);
  }

  Future<void> _openBatchImportDialog(_TravelAgencyRuleImportKind kind) async {
    final agency = _selectedAgency;
    if (agency == null) {
      return;
    }
    final result = await showDialog<Stage7RuleImportResult>(
      context: context,
      builder: (context) => _TravelAgencyRuleImportDialog(
        businessApi: _businessApi,
        agency: agency,
        kind: kind,
      ),
    );
    if (result == null) {
      return;
    }
    await _loadRulesForAgency(agency);
    if (!mounted) {
      return;
    }
    await showDialog<void>(
      context: context,
      builder: (context) => _TravelAgencyRuleImportResultDialog(
        kind: kind,
        result: result,
      ),
    );
  }

  Future<void> _disableRebateRule(AgencyRebateRuleRecord rule) async {
    final agency = _selectedAgency;
    if (agency == null) {
      return;
    }
    await _runRuleAction(
      () => _businessApi.updateAgencyRebateRule(rule.id, {'isActive': false}),
      agency,
    );
  }

  Future<void> _disableDeductionRule(AgencyDeductionRuleRecord rule) async {
    final agency = _selectedAgency;
    if (agency == null) {
      return;
    }
    await _runRuleAction(
      () =>
          _businessApi.updateAgencyDeductionRule(rule.id, {'isActive': false}),
      agency,
    );
  }

  Future<void> _runRuleAction(
    Future<Object> Function() action,
    TravelAgencyRecord agency,
  ) async {
    setState(() => _ruleErrorMessage = null);
    try {
      await action();
      await _loadRulesForAgency(agency);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _ruleErrorMessage = _messageForError(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_canManage) {
      return const ResponsivePage(
        children: [
          _InlineNotice(
            message: '当前角色不可访问旅行社管理。',
            tone: StatusTone.danger,
          ),
        ],
      );
    }

    final selected = _selectedAgency;
    return ResponsivePage(
      maxWidth: 1480,
      children: [
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        if (_loadingAgencies) const LinearProgressIndicator(),
        ResponsiveTwoColumn(
          primaryFlex: 1,
          secondaryFlex: 2,
          primary: _buildAgencyListSection(),
          secondary: selected == null
              ? const FormSection(
                  title: '旅行社详情',
                  children: [
                    _SectionState(message: '请选择或新增旅行社。'),
                  ],
                )
              : _buildAgencyWorkspace(selected),
        ),
      ],
    );
  }

  Widget _buildAgencyListSection() {
    return FormSection(
      title: '旅行社',
      trailing:
          StatusTag(label: '${_agencies.length} 家', tone: StatusTone.info),
      children: [
        TextField(
          key: const ValueKey('travel-agency-search-field'),
          controller: _searchController,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: '搜索旅行社、联系人、电话',
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: IconButton(
              tooltip: '清空',
              onPressed: () {
                _searchController.clear();
                _loadAgencies();
              },
              icon: const Icon(Icons.close_rounded),
            ),
          ),
          onSubmitted: (_) => _loadAgencies(),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          alignment: WrapAlignment.end,
          children: [
            OutlinedButton.icon(
              onPressed: _loadingAgencies ? null : _loadAgencies,
              icon: const Icon(Icons.search_rounded),
              label: const Text('搜索'),
            ),
            FilledButton.icon(
              key: const ValueKey('travel-agency-add-button'),
              onPressed: _loadingAgencies ? null : () => _openAgencyDialog(),
              icon: const Icon(Icons.add_rounded),
              label: const Text('新增旅行社'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (!_loadingAgencies && _agencies.isEmpty)
          const _SectionState(message: '暂无匹配旅行社。')
        else
          for (final agency in _agencies)
            _AgencyListTile(
              agency: agency,
              selected: agency.id == _selectedAgency?.id,
              onTap: () => _selectAgency(agency),
            ),
      ],
    );
  }

  Widget _buildAgencyWorkspace(TravelAgencyRecord agency) {
    final currentRebates = _rebateRules.where(_isEffectiveRule).toList();
    final currentDeductions = _deductionRules.where(_isEffectiveRule).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FormSection(
          title: agency.name,
          trailing: OutlinedButton.icon(
            key: const ValueKey('travel-agency-edit-button'),
            onPressed: () => _openAgencyDialog(agency: agency),
            icon: const Icon(Icons.edit_rounded),
            label: const Text('编辑基础信息'),
          ),
          children: [
            ResponsiveFormGrid(
              minItemWidth: 220,
              children: [
                _InfoLine(label: '联系人', value: _display(agency.contactName)),
                _InfoLine(label: '电话', value: _display(agency.contactPhone)),
                _InfoLine(label: '备注', value: _display(agency.notes)),
                _InfoLine(
                    label: '更新时间', value: _dateTimeLabel(agency.updatedAt)),
              ],
            ),
          ],
        ),
        const SizedBox(height: 16),
        FormSection(
          title: '当前生效规则',
          trailing: _loadingRules
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : StatusTag(
                  label:
                      '${currentRebates.length + currentDeductions.length} 条',
                  tone: StatusTone.info,
                ),
          children: [
            if (_ruleErrorMessage != null) ...[
              _InlineNotice(
                  message: _ruleErrorMessage!, tone: StatusTone.danger),
              const SizedBox(height: 12),
            ],
            Wrap(
              spacing: 10,
              runSpacing: 10,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                for (final rule in currentRebates)
                  StatusTag(
                    label:
                        '日返 ${_ratePercent(rule.dailyRebateRate)} / 月返 ${_ratePercent(rule.monthlyRebateRate)}',
                    tone: StatusTone.success,
                  ),
                if (currentRebates.isEmpty)
                  const StatusTag(label: '暂无生效返点规则', tone: StatusTone.warning),
                StatusTag(
                  label: '生效扣酒 ${currentDeductions.length} 条',
                  tone: currentDeductions.isEmpty
                      ? StatusTone.warning
                      : StatusTone.info,
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 16),
        _buildRebateRulesSection(),
        const SizedBox(height: 16),
        _buildDeductionRulesSection(),
      ],
    );
  }

  Widget _buildRebateRulesSection() {
    return FormSection(
      title: '日返 / 月返规则',
      trailing: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          OutlinedButton.icon(
            key: const ValueKey('travel-agency-rebate-batch-add-button'),
            onPressed: _loadingRules ? null : _openRebateBatchImportDialog,
            icon: const Icon(Icons.upload_file_rounded),
            label: const Text('批量增加'),
          ),
          FilledButton.icon(
            key: const ValueKey('travel-agency-rebate-add-button'),
            onPressed: _loadingRules ? null : () => _openRebateDialog(),
            icon: const Icon(Icons.add_rounded),
            label: const Text('新增返点规则'),
          ),
        ],
      ),
      children: [
        if (_loadingRules && _rebateRules.isEmpty)
          const _SectionState(message: '正在加载返点规则...', loading: true)
        else if (_rebateRules.isEmpty)
          const _SectionState(message: '暂无返点规则。')
        else
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columns: const [
                DataColumn(label: Text('日返比例')),
                DataColumn(label: Text('月返比例')),
                DataColumn(label: Text('合计比例')),
                DataColumn(label: Text('生效日期')),
                DataColumn(label: Text('状态')),
                DataColumn(label: Text('备注')),
                DataColumn(label: Text('操作')),
              ],
              rows: [
                for (final rule in _rebateRules)
                  DataRow(
                    cells: [
                      DataCell(Text(_ratePercent(rule.dailyRebateRate))),
                      DataCell(Text(_ratePercent(rule.monthlyRebateRate))),
                      DataCell(Text(_ratePercent(rule.totalRebateRate))),
                      DataCell(Text(_dateRangeLabel(
                        rule.effectiveFrom,
                        rule.effectiveTo,
                      ))),
                      DataCell(_ruleStatusTag(rule)),
                      DataCell(_compactText(rule.notes)),
                      DataCell(_ruleActions(
                        editKey:
                            ValueKey('travel-agency-rebate-edit-${rule.id}'),
                        disableKey:
                            ValueKey('travel-agency-rebate-disable-${rule.id}'),
                        isActive: rule.isActive,
                        onEdit: () => _openRebateDialog(rule: rule),
                        onDisable: () => _disableRebateRule(rule),
                      )),
                    ],
                  ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildDeductionRulesSection() {
    return FormSection(
      title: '扣酒成本规则',
      trailing: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          OutlinedButton.icon(
            key: const ValueKey('travel-agency-deduction-batch-add-button'),
            onPressed: _loadingRules ? null : _openDeductionBatchImportDialog,
            icon: const Icon(Icons.upload_file_rounded),
            label: const Text('批量增加'),
          ),
          FilledButton.icon(
            key: const ValueKey('travel-agency-deduction-add-button'),
            onPressed: _loadingRules ? null : () => _openDeductionDialog(),
            icon: const Icon(Icons.add_rounded),
            label: const Text('新增扣酒规则'),
          ),
        ],
      ),
      children: [
        if (_loadingRules && _deductionRules.isEmpty)
          const _SectionState(message: '正在加载扣酒规则...', loading: true)
        else if (_deductionRules.isEmpty)
          const _SectionState(message: '暂无扣酒成本规则。')
        else
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columns: const [
                DataColumn(label: Text('计算方式')),
                DataColumn(label: Text('商品')),
                DataColumn(label: Text('参考扣酒成本')),
                DataColumn(label: Text('生效日期')),
                DataColumn(label: Text('状态')),
                DataColumn(label: Text('备注')),
                DataColumn(label: Text('操作')),
              ],
              rows: [
                for (final rule in _deductionRules)
                  DataRow(
                    cells: [
                      DataCell(Text(_agencyDeductionModeLabel(rule))),
                      DataCell(Text(_deductionProductLabel(rule))),
                      DataCell(_deductionCostCell(rule)),
                      DataCell(Text(_dateRangeLabel(
                        rule.effectiveFrom,
                        rule.effectiveTo,
                      ))),
                      DataCell(_ruleStatusTag(rule)),
                      DataCell(_compactText(rule.notes)),
                      DataCell(_ruleActions(
                        editKey:
                            ValueKey('travel-agency-deduction-edit-${rule.id}'),
                        disableKey: ValueKey(
                          'travel-agency-deduction-disable-${rule.id}',
                        ),
                        isActive: rule.isActive,
                        onEdit: () => _openDeductionDialog(rule: rule),
                        onDisable: () => _disableDeductionRule(rule),
                      )),
                    ],
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _AgencyEditorDialog extends StatefulWidget {
  const _AgencyEditorDialog({
    required this.businessApi,
    required this.agency,
  });

  final BusinessApi businessApi;
  final TravelAgencyRecord? agency;

  @override
  State<_AgencyEditorDialog> createState() => _AgencyEditorDialogState();
}

class _AgencyEditorDialogState extends State<_AgencyEditorDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _contactNameController;
  late final TextEditingController _contactPhoneController;
  late final TextEditingController _notesController;
  bool _saving = false;
  String? _errorMessage;

  bool get _editing => widget.agency != null;

  @override
  void initState() {
    super.initState();
    final agency = widget.agency;
    _nameController = TextEditingController(text: agency?.name ?? '');
    _contactNameController =
        TextEditingController(text: agency?.contactName ?? '');
    _contactPhoneController =
        TextEditingController(text: agency?.contactPhone ?? '');
    _notesController = TextEditingController(text: agency?.notes ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    _contactNameController.dispose();
    _contactPhoneController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_editing ? '编辑旅行社' : '新增旅行社'),
      content: SizedBox(
        width: 520,
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_errorMessage != null) ...[
                _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
                const SizedBox(height: 12),
              ],
              TextFormField(
                key: const ValueKey('travel-agency-name-field'),
                controller: _nameController,
                decoration: const InputDecoration(labelText: '旅行社名称'),
                validator: _requiredValidator('请填写旅行社名称'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const ValueKey('travel-agency-contact-name-field'),
                controller: _contactNameController,
                decoration: const InputDecoration(labelText: '联系人'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const ValueKey('travel-agency-contact-phone-field'),
                controller: _contactPhoneController,
                decoration: const InputDecoration(labelText: '电话'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const ValueKey('travel-agency-notes-field'),
                controller: _notesController,
                maxLines: 3,
                decoration: const InputDecoration(labelText: '备注'),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('travel-agency-save-button'),
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

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() {
      _saving = true;
      _errorMessage = null;
    });
    try {
      final body = <String, dynamic>{
        'name': _nameController.text.trim(),
        'contactName': _nullableText(_contactNameController.text),
        'contactPhone': _nullableText(_contactPhoneController.text),
        'notes': _nullableText(_notesController.text),
      };
      final agency = widget.agency == null
          ? await widget.businessApi.createTravelAgency(body)
          : await widget.businessApi.updateTravelAgency(
              widget.agency!.id,
              body,
            );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(agency);
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
}

class _RebateRuleDialog extends StatefulWidget {
  const _RebateRuleDialog({
    required this.businessApi,
    required this.agency,
    required this.rule,
  });

  final BusinessApi businessApi;
  final TravelAgencyRecord agency;
  final AgencyRebateRuleRecord? rule;

  @override
  State<_RebateRuleDialog> createState() => _RebateRuleDialogState();
}

class _RebateRuleDialogState extends State<_RebateRuleDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _dailyRateController;
  late final TextEditingController _monthlyRateController;
  late final TextEditingController _totalRateController;
  late final TextEditingController _effectiveFromController;
  late final TextEditingController _effectiveToController;
  late final TextEditingController _notesController;
  late bool _isActive;
  bool _saving = false;
  String? _errorMessage;

  bool get _editing => widget.rule != null;

  @override
  void initState() {
    super.initState();
    final rule = widget.rule;
    _dailyRateController =
        TextEditingController(text: rule?.dailyRebateRate ?? '');
    _monthlyRateController =
        TextEditingController(text: rule?.monthlyRebateRate ?? '');
    _totalRateController =
        TextEditingController(text: rule?.totalRebateRate ?? '');
    _effectiveFromController =
        TextEditingController(text: rule?.effectiveFrom ?? _todayText());
    _effectiveToController =
        TextEditingController(text: rule?.effectiveTo ?? '');
    _notesController = TextEditingController(text: rule?.notes ?? '');
    _isActive = rule?.isActive ?? true;
  }

  @override
  void dispose() {
    _dailyRateController.dispose();
    _monthlyRateController.dispose();
    _totalRateController.dispose();
    _effectiveFromController.dispose();
    _effectiveToController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_editing ? '编辑返点规则' : '新增返点规则'),
      content: SizedBox(
        width: 560,
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_errorMessage != null) ...[
                _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
                const SizedBox(height: 12),
              ],
              Text(widget.agency.name,
                  style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 12),
              ResponsiveFormGrid(
                minItemWidth: 180,
                children: [
                  TextFormField(
                    key: const ValueKey('travel-agency-daily-rate-field'),
                    controller: _dailyRateController,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: '日返比例',
                      hintText: '例如 0.0300',
                    ),
                    validator: _decimalValidator('请填写日返比例'),
                  ),
                  TextFormField(
                    key: const ValueKey('travel-agency-monthly-rate-field'),
                    controller: _monthlyRateController,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: '月返比例',
                      hintText: '例如 0.0200',
                    ),
                    validator: _decimalValidator('请填写月返比例'),
                  ),
                  TextFormField(
                    key: const ValueKey('travel-agency-total-rate-field'),
                    controller: _totalRateController,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: '合计比例（可选）',
                    ),
                    validator: _optionalDecimalValidator,
                  ),
                  TextFormField(
                    key: const ValueKey('travel-agency-rebate-from-field'),
                    controller: _effectiveFromController,
                    decoration: const InputDecoration(labelText: '生效日期'),
                    validator: _requiredValidator('请填写生效日期'),
                  ),
                  TextFormField(
                    key: const ValueKey('travel-agency-rebate-to-field'),
                    controller: _effectiveToController,
                    decoration: const InputDecoration(labelText: '失效日期（可选）'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('启用规则'),
                value: _isActive,
                onChanged: _saving
                    ? null
                    : (value) => setState(() => _isActive = value),
              ),
              TextFormField(
                key: const ValueKey('travel-agency-rebate-notes-field'),
                controller: _notesController,
                maxLines: 2,
                decoration: const InputDecoration(labelText: '备注'),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('travel-agency-rebate-save-button'),
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

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() {
      _saving = true;
      _errorMessage = null;
    });
    try {
      final body = <String, dynamic>{
        'agencyId': widget.agency.id,
        'agencyName': widget.agency.name,
        'dailyRebateRate': _dailyRateController.text.trim(),
        'monthlyRebateRate': _monthlyRateController.text.trim(),
        'totalRebateRate': _nullableText(_totalRateController.text),
        'effectiveFrom': _effectiveFromController.text.trim(),
        'effectiveTo': _nullableText(_effectiveToController.text),
        'isActive': _isActive,
        'notes': _nullableText(_notesController.text),
      };
      if (widget.rule == null) {
        await widget.businessApi.createAgencyRebateRule(body);
      } else {
        await widget.businessApi.updateAgencyRebateRule(widget.rule!.id, body);
      }
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
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
}

class _DeductionRuleDialog extends StatefulWidget {
  const _DeductionRuleDialog({
    required this.businessApi,
    required this.agency,
    required this.rule,
  });

  final BusinessApi businessApi;
  final TravelAgencyRecord agency;
  final AgencyDeductionRuleRecord? rule;

  @override
  State<_DeductionRuleDialog> createState() => _DeductionRuleDialogState();
}

class _DeductionRuleDialogState extends State<_DeductionRuleDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _costController;
  late final TextEditingController _effectiveFromController;
  late final TextEditingController _effectiveToController;
  late final TextEditingController _notesController;
  late String _calculationMode;
  late bool _isActive;
  bool _saving = false;
  String? _errorMessage;
  String? _productId;
  String? _productSnapshotName;
  List<ProductOptionRecord> _productOptions = const [];
  bool _loadingProductOptions = true;
  String? _productOptionsError;

  bool get _editing => widget.rule != null;
  bool get _isManualReferenceMode =>
      _calculationMode == _agencyDeductionModeManualProductReference;

  @override
  void initState() {
    super.initState();
    final rule = widget.rule;
    _calculationMode =
        rule?.calculationMode ?? _agencyDeductionModeManualProductReference;
    _productId = rule?.productId;
    _productSnapshotName = rule?.productName;
    _costController = TextEditingController(
        text: _moneyInputText(rule?.deductionCostCents ?? 0));
    _effectiveFromController =
        TextEditingController(text: rule?.effectiveFrom ?? _todayText());
    _effectiveToController =
        TextEditingController(text: rule?.effectiveTo ?? '');
    _notesController = TextEditingController(text: rule?.notes ?? '');
    _isActive = rule?.isActive ?? true;
    _loadProductOptions();
  }

  @override
  void dispose() {
    _costController.dispose();
    _effectiveFromController.dispose();
    _effectiveToController.dispose();
    _notesController.dispose();
    super.dispose();
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

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_editing ? '编辑扣酒规则' : '新增扣酒规则'),
      content: SizedBox(
        width: 560,
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_errorMessage != null) ...[
                _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
                const SizedBox(height: 12),
              ],
              Text(widget.agency.name,
                  style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                key: const ValueKey('travel-agency-deduction-mode-field'),
                segments: const [
                  ButtonSegment<String>(
                    value: _agencyDeductionModeEffectiveSalesRate,
                    icon: Icon(Icons.percent_rounded),
                    label: Text('有效销售额 × 30%'),
                  ),
                  ButtonSegment<String>(
                    value: _agencyDeductionModeManualProductReference,
                    icon: Icon(Icons.inventory_2_rounded),
                    label: Text('商品参考，人工录入'),
                  ),
                ],
                selected: {_calculationMode},
                onSelectionChanged: _saving
                    ? null
                    : (values) => setState(() {
                          _calculationMode = values.first;
                        }),
              ),
              const SizedBox(height: 12),
              ResponsiveFormGrid(
                minItemWidth: 180,
                children: [
                  if (_isManualReferenceMode) ...[
                    ProductOptionPickerField(
                      key: const ValueKey(
                          'travel-agency-deduction-product-field'),
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
                    ),
                    TextFormField(
                      key: const ValueKey('travel-agency-deduction-cost-field'),
                      controller: _costController,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                        labelText: '参考扣酒成本（元）',
                        prefixText: '￥ ',
                      ),
                      validator: (value) {
                        if (_parseMoneyCents(value) == null) {
                          return '请填写正确金额';
                        }
                        return null;
                      },
                    ),
                  ],
                  TextFormField(
                    key: const ValueKey('travel-agency-deduction-from-field'),
                    controller: _effectiveFromController,
                    decoration: const InputDecoration(labelText: '生效日期'),
                    validator: _requiredValidator('请填写生效日期'),
                  ),
                  TextFormField(
                    key: const ValueKey('travel-agency-deduction-to-field'),
                    controller: _effectiveToController,
                    decoration: const InputDecoration(labelText: '失效日期（可选）'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('启用规则'),
                value: _isActive,
                onChanged: _saving
                    ? null
                    : (value) => setState(() => _isActive = value),
              ),
              TextFormField(
                key: const ValueKey('travel-agency-deduction-notes-field'),
                controller: _notesController,
                maxLines: 2,
                decoration: const InputDecoration(labelText: '备注'),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          key: const ValueKey('travel-agency-deduction-save-button'),
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

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final costCents =
        _isManualReferenceMode ? _parseMoneyCents(_costController.text) : 0;
    if (_isManualReferenceMode) {
      if ((_productId ?? '').trim().isEmpty) {
        setState(() => _errorMessage = '请选择商品');
        return;
      }
      if (costCents == null) {
        return;
      }
    }
    setState(() {
      _saving = true;
      _errorMessage = null;
    });
    try {
      final body = <String, dynamic>{
        'agencyId': widget.agency.id,
        'calculationMode': _calculationMode,
        'effectiveFrom': _effectiveFromController.text.trim(),
        'effectiveTo': _nullableText(_effectiveToController.text),
        'isActive': _isActive,
        'notes': _nullableText(_notesController.text),
      };
      if (_isManualReferenceMode) {
        body
          ..['productId'] = _productId
          ..['deductionCostCents'] = costCents;
      } else {
        body['deductionRate'] = _defaultAgencyDeductionRate;
      }
      if (widget.rule == null) {
        await widget.businessApi.createAgencyDeductionRule(body);
      } else {
        await widget.businessApi
            .updateAgencyDeductionRule(widget.rule!.id, body);
      }
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
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
}

enum _TravelAgencyRuleImportKind {
  rebate,
  deduction;

  String get label {
    switch (this) {
      case _TravelAgencyRuleImportKind.rebate:
        return '日返 / 月返规则';
      case _TravelAgencyRuleImportKind.deduction:
        return '扣酒成本规则';
    }
  }
}

class _TravelAgencyRuleImportDialog extends StatefulWidget {
  const _TravelAgencyRuleImportDialog({
    required this.businessApi,
    required this.agency,
    required this.kind,
  });

  final BusinessApi businessApi;
  final TravelAgencyRecord agency;
  final _TravelAgencyRuleImportKind kind;

  @override
  State<_TravelAgencyRuleImportDialog> createState() =>
      _TravelAgencyRuleImportDialogState();
}

class _TravelAgencyRuleImportDialogState
    extends State<_TravelAgencyRuleImportDialog> {
  final _jsonController = TextEditingController();
  bool _importing = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _jsonController.text = _importExample(widget.kind);
  }

  @override
  void dispose() {
    _jsonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('批量增加${widget.kind.label}'),
      content: SizedBox(
        width: 680,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.agency.name,
                style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            if (_errorMessage != null) ...[
              _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
              const SizedBox(height: 8),
            ],
            Text(
              '粘贴 JSON 数组，或 { "rules": [...] }。系统会自动补当前旅行社。',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('travel-agency-rule-import-json-field'),
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
          key: const ValueKey('travel-agency-rule-import-submit-button'),
          onPressed: _importing ? null : _submit,
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

  Future<void> _submit() async {
    final rules = _parseRules();
    if (rules == null) {
      return;
    }
    setState(() {
      _importing = true;
      _errorMessage = null;
    });
    try {
      final result = widget.kind == _TravelAgencyRuleImportKind.rebate
          ? await widget.businessApi.importAgencyRebateRules(rules)
          : await widget.businessApi.importAgencyDeductionRules(rules);
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
      for (final rule in rules) {
        rule
          ..['agencyId'] = widget.agency.id
          ..['agencyName'] = widget.agency.name;
        if (widget.kind == _TravelAgencyRuleImportKind.deduction) {
          final mode = _normalizeDeductionMode(rule['calculationMode']);
          rule['calculationMode'] = mode;
          if (mode == _agencyDeductionModeEffectiveSalesRate) {
            rule
              ..['deductionRate'] =
                  '${rule['deductionRate'] ?? _defaultAgencyDeductionRate}'
              ..remove('productId')
              ..remove('productName')
              ..remove('unit')
              ..remove('deductionCostCents');
          } else {
            if ('${rule['productId'] ?? ''}'.trim().isEmpty) {
              setState(() => _errorMessage = '商品参考模式必须提供 productId。');
              return null;
            }
            rule
              ..remove('productName')
              ..remove('unit')
              ..remove('actualUnitCostCents')
              ..remove('actualCostSubtotalCents');
          }
        }
      }
      return rules;
    } on FormatException catch (error) {
      setState(() => _errorMessage = 'JSON 格式错误：${error.message}');
      return null;
    }
  }
}

class _TravelAgencyRuleImportResultDialog extends StatelessWidget {
  const _TravelAgencyRuleImportResultDialog({
    required this.kind,
    required this.result,
  });

  final _TravelAgencyRuleImportKind kind;
  final Stage7RuleImportResult result;

  @override
  Widget build(BuildContext context) {
    final failures = result.results.where((item) => !item.success).toList();
    return AlertDialog(
      title: Text('${kind.label}导入结果'),
      content: SizedBox(
        width: 560,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            StatusTag(
              label: '成功 ${result.successCount} / 失败 ${result.failureCount}',
              tone: result.failureCount == 0
                  ? StatusTone.success
                  : StatusTone.warning,
            ),
            const SizedBox(height: 12),
            Text('总行数：${result.totalCount}'),
            if (failures.isNotEmpty) ...[
              const SizedBox(height: 12),
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
        ),
      ),
      actions: [
        FilledButton(
          key: const ValueKey('travel-agency-rule-import-result-close-button'),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('知道了'),
        ),
      ],
    );
  }
}

class _AgencyListTile extends StatelessWidget {
  const _AgencyListTile({
    required this.agency,
    required this.selected,
    required this.onTap,
  });

  final TravelAgencyRecord agency;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      selected: selected,
      selectedTileColor:
          Theme.of(context).colorScheme.primary.withValues(alpha: 0.07),
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      leading: CircleAvatar(
        child: Text(_initial(agency.name)),
      ),
      title: Text(
        agency.name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w800),
      ),
      subtitle: Text(
        [
          _display(agency.contactName),
          _display(agency.contactPhone),
        ].where((item) => item != '-').join(' · '),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: selected
          ? const Icon(Icons.radio_button_checked_rounded)
          : const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    );
  }
}

Widget _ruleActions({
  required Key editKey,
  required Key disableKey,
  required bool isActive,
  required VoidCallback onEdit,
  required VoidCallback onDisable,
}) {
  return Wrap(
    spacing: 6,
    children: [
      TextButton.icon(
        key: editKey,
        onPressed: onEdit,
        icon: const Icon(Icons.edit_rounded),
        label: const Text('编辑'),
      ),
      if (isActive)
        TextButton.icon(
          key: disableKey,
          onPressed: onDisable,
          icon: const Icon(Icons.block_rounded),
          label: const Text('停用'),
        ),
    ],
  );
}

Widget _ruleStatusTag(dynamic rule) {
  if (!rule.isActive) {
    return const StatusTag(label: '停用', tone: StatusTone.neutral);
  }
  if (_isEffectiveRule(rule)) {
    return const StatusTag(label: '当前生效', tone: StatusTone.success);
  }
  return const StatusTag(label: '未生效', tone: StatusTone.warning);
}

String _agencyDeductionModeLabel(AgencyDeductionRuleRecord rule) {
  if (rule.calculationMode == _agencyDeductionModeEffectiveSalesRate) {
    return '有效销售额 × 30%';
  }
  return '商品参考，人工录入';
}

String _deductionProductLabel(AgencyDeductionRuleRecord rule) {
  if (rule.calculationMode == _agencyDeductionModeEffectiveSalesRate) {
    return '-';
  }
  return _display(rule.productName);
}

Widget _deductionCostCell(AgencyDeductionRuleRecord rule) {
  if (rule.calculationMode == _agencyDeductionModeEffectiveSalesRate) {
    return Text('有效销售额 × ${_ratePercent(rule.deductionRate)}');
  }
  return MoneyText(cents: rule.deductionCostCents);
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
        Text(label, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 4),
        SelectableText(
          value,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
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
    return Align(
      alignment: Alignment.centerLeft,
      child: StatusTag(label: message, tone: tone),
    );
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
      child: Center(
        child: loading
            ? Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox.square(
                    dimension: 24,
                    child: CircularProgressIndicator(strokeWidth: 2.4),
                  ),
                  const SizedBox(height: 12),
                  Text(message),
                ],
              )
            : Text(message, textAlign: TextAlign.center),
      ),
    );
  }
}

TravelAgencyRecord? _selectAgencyFromList(
  List<TravelAgencyRecord> agencies,
  String? preferredId,
) {
  if (agencies.isEmpty) {
    return null;
  }
  for (final agency in agencies) {
    if (agency.id == preferredId) {
      return agency;
    }
  }
  return agencies.first;
}

List<T> _mergeById<T>(List<T> records, String Function(T record) idFor) {
  final seen = <String>{};
  final merged = <T>[];
  for (final record in records) {
    final id = idFor(record);
    if (seen.add(id)) {
      merged.add(record);
    }
  }
  return merged;
}

bool _isEffectiveRule(dynamic rule) {
  if (!rule.isActive) {
    return false;
  }
  final today = _dateOnly(DateTime.now());
  final from = DateTime.tryParse(rule.effectiveFrom);
  final toText = rule.effectiveTo as String?;
  final to =
      toText == null || toText.isEmpty ? null : DateTime.tryParse(toText);
  if (from != null && _dateOnly(from).isAfter(today)) {
    return false;
  }
  if (to != null && _dateOnly(to).isBefore(today)) {
    return false;
  }
  return true;
}

DateTime _dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

String _dateRangeLabel(String from, String? to) {
  return to == null || to.isEmpty ? '$from 起' : '$from 至 $to';
}

Widget _compactText(String? value) {
  return ConstrainedBox(
    constraints: const BoxConstraints(maxWidth: 180),
    child: Text(
      _display(value),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    ),
  );
}

String _ratePercent(String? value) {
  final rate = double.tryParse((value ?? '').trim());
  if (rate == null) {
    return '-';
  }
  return '${(rate * 100).toStringAsFixed(2)}%';
}

String _display(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? '-' : text;
}

String _dateTimeLabel(String? value) {
  final text = value?.trim();
  if (text == null || text.isEmpty) {
    return '-';
  }
  return text.replaceFirst('T', ' ').replaceFirst(RegExp(r'\.\d{3}Z$'), '');
}

String _initial(String value) {
  final text = value.trim();
  return text.isEmpty ? '?' : text.characters.first;
}

String? _nullableText(String value) {
  final text = value.trim();
  return text.isEmpty ? null : text;
}

String _todayText() {
  final now = DateTime.now();
  String two(int value) => value.toString().padLeft(2, '0');
  return '${now.year}-${two(now.month)}-${two(now.day)}';
}

String? Function(String?) _requiredValidator(String message) {
  return (value) {
    if ((value ?? '').trim().isEmpty) {
      return message;
    }
    return null;
  };
}

String? Function(String?) _decimalValidator(String message) {
  return (value) {
    final text = (value ?? '').trim();
    if (text.isEmpty) {
      return message;
    }
    final number = double.tryParse(text);
    if (number == null || number < 0) {
      return '请填写正确比例';
    }
    return null;
  };
}

String? _optionalDecimalValidator(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) {
    return null;
  }
  final number = double.tryParse(text);
  if (number == null || number < 0) {
    return '请填写正确比例';
  }
  return null;
}

int? _parseMoneyCents(String? value) {
  final text = (value ?? '').replaceAll(',', '').trim();
  if (text.isEmpty) {
    return null;
  }
  final amount = double.tryParse(text);
  if (amount == null || amount < 0) {
    return null;
  }
  return (amount * 100).round();
}

String _moneyInputText(int cents) {
  if (cents <= 0) {
    return '';
  }
  if (cents % 100 == 0) {
    return '${cents ~/ 100}';
  }
  return (cents / 100).toStringAsFixed(2);
}

String _normalizeDeductionMode(Object? value) {
  final text = '${value ?? ''}'.trim();
  if (text == _agencyDeductionModeEffectiveSalesRate) {
    return _agencyDeductionModeEffectiveSalesRate;
  }
  return _agencyDeductionModeManualProductReference;
}

String _importExample(_TravelAgencyRuleImportKind kind) {
  switch (kind) {
    case _TravelAgencyRuleImportKind.rebate:
      return const JsonEncoder.withIndent('  ').convert([
        {
          'dailyRebateRate': '0.0300',
          'monthlyRebateRate': '0.0200',
          'effectiveFrom': '2026-07-01',
          'notes': 'batch import',
        }
      ]);
    case _TravelAgencyRuleImportKind.deduction:
      return const JsonEncoder.withIndent('  ').convert([
        {
          'calculationMode': 'effective_sales_rate',
          'effectiveFrom': '2026-07-01',
          'notes': 'effective sales amount * 30%',
        },
        {
          'calculationMode': 'manual_product_reference',
          'productId': 'replace-with-active-product-id',
          'deductionCostCents': 800,
          'effectiveFrom': '2026-07-01',
          'notes': 'manual input reference',
        }
      ]);
  }
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
