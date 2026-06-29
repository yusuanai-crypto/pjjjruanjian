import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/mark_info_button.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class TravelGroupFormPage extends StatefulWidget {
  const TravelGroupFormPage({
    super.key,
    required this.apiClient,
    required this.token,
  });

  final ApiClient apiClient;
  final String token;

  @override
  State<TravelGroupFormPage> createState() => _TravelGroupFormPageState();
}

class _TravelGroupFormPageState extends State<TravelGroupFormPage> {
  final _formKey = GlobalKey<FormState>();

  late BusinessApi _businessApi;
  late final TextEditingController _travelAgencyController;
  late final TextEditingController _licensePlateController;
  late final TextEditingController _guestCountController;
  late final TextEditingController _tastingRoomNoController;
  late final TextEditingController _arrivalTimeController;

  DateTime _visitDate = DateTime.now();
  String _groupType = groupTypes.first;
  String _selectedFilter = '今日';
  bool _loading = true;
  bool _saving = false;
  String? _errorMessage;
  String? _successMessage;
  GuideRecord? _selectedGuide;
  TasterOption? _selectedTaster;
  final Set<String> _markingGroupIds = <String>{};
  List<TravelGroupRecord> _groups = const <TravelGroupRecord>[];
  List<GuideRecord> _guides = const <GuideRecord>[];
  List<TravelAgencyRecord> _travelAgencies = const <TravelAgencyRecord>[];
  List<TasterOption> _tasters = const <TasterOption>[];

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _travelAgencyController = TextEditingController();
    _licensePlateController = TextEditingController();
    _guestCountController = TextEditingController();
    _tastingRoomNoController = TextEditingController();
    _arrivalTimeController = TextEditingController();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant TravelGroupFormPage oldWidget) {
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
    _travelAgencyController.dispose();
    _licensePlateController.dispose();
    _guestCountController.dispose();
    _tastingRoomNoController.dispose();
    _arrivalTimeController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final results = await Future.wait<Object>([
        _businessApi.listTravelGroups(),
        _businessApi.listGuides(isActive: true, limit: 100),
        _businessApi.listTravelAgencies(limit: 100),
        _businessApi.listTasters(),
      ]);
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = results[0] as List<TravelGroupRecord>;
        _guides = results[1] as List<GuideRecord>;
        _travelAgencies = results[2] as List<TravelAgencyRecord>;
        _tasters = results[3] as List<TasterOption>;
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

  Future<void> _saveTravelGroup() async {
    final formValid = _formKey.currentState?.validate() ?? false;
    if (!formValid) {
      setState(() {
        _errorMessage = '请先补全必填信息。';
        _successMessage = null;
      });
      return;
    }
    if (_travelAgencyController.text.trim().isEmpty) {
      setState(() {
        _errorMessage = '请选择旅行社。';
        _successMessage = null;
      });
      return;
    }
    if (_selectedGuide == null) {
      setState(() {
        _errorMessage = '请选择导游。';
        _successMessage = null;
      });
      return;
    }
    if (_selectedTaster == null) {
      setState(() {
        _errorMessage = '请选择品鉴师。';
        _successMessage = null;
      });
      return;
    }

    setState(() {
      _saving = true;
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final created = await _businessApi.createTravelGroup({
        'visitDate': formatDate(_visitDate),
        'travelAgency': _travelAgencyController.text.trim(),
        'licensePlate': _licensePlateController.text.trim(),
        'guideId': _selectedGuide!.id,
        'guestCount': _intFromText(_guestCountController.text),
        'tastingRoomNo': _tastingRoomNoController.text.trim(),
        'tasterId': _selectedTaster!.id,
        'arrivalTime': _arrivalTimeController.text.trim(),
        'groupType': _groupType,
      });
      if (!mounted) {
        return;
      }
      _clearForm();
      await _loadData();
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _successMessage = '旅行团已保存，系统团号：${created.groupNo}';
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

  void _clearForm() {
    _formKey.currentState?.reset();
    _travelAgencyController.clear();
    _licensePlateController.clear();
    _guestCountController.clear();
    _tastingRoomNoController.clear();
    _arrivalTimeController.clear();
    setState(() {
      _visitDate = DateTime.now();
      _groupType = groupTypes.first;
      _selectedGuide = null;
      _selectedTaster = null;
    });
  }

  Future<void> _selectGuide() async {
    final selected = await showDialog<GuideRecord>(
      context: context,
      builder: (context) => _GuidePickerDialog(
        businessApi: _businessApi,
        guides: _guides,
        initialAgency: _travelAgencyController.text.trim(),
      ),
    );
    if (selected == null || !mounted) {
      return;
    }
    setState(() {
      _selectedGuide = selected;
      if (!_guides.any((guide) => guide.id == selected.id)) {
        _guides = [..._guides, selected];
      }
    });
  }

  Future<void> _selectTaster() async {
    final selected = await showDialog<TasterOption>(
      context: context,
      builder: (context) => _TasterPickerDialog(tasters: _tasters),
    );
    if (selected == null || !mounted) {
      return;
    }
    setState(() {
      _selectedTaster = selected;
    });
  }

  bool _isGroupMarked(TravelGroupRecord group) {
    return group.financeMark;
  }

  Future<void> _toggleGroupMark(TravelGroupRecord group) async {
    setState(() {
      _markingGroupIds.add(group.id);
      _errorMessage = null;
      _successMessage = null;
    });
    try {
      final updated = await _businessApi.setTravelGroupFinanceMark(
        group.id,
        !group.financeMark,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = [
          for (final item in _groups)
            if (item.id == updated.id) updated else item,
        ];
        _markingGroupIds.remove(group.id);
        _successMessage = updated.financeMark ? '标记信息已保存。' : '标记信息已取消。';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _markingGroupIds.remove(group.id);
        _errorMessage = _messageForError(error);
      });
    }
  }

  List<TravelGroupRecord> get _visibleGroups {
    if (_selectedFilter == '今日') {
      final today = formatDate(DateTime.now());
      return _groups.where((group) => group.visitDate == today).toList();
    }
    if (_selectedFilter == '未标记') {
      return _groups.where((group) => group.status == 'unmarked').toList();
    }
    if (_selectedFilter == '待总结') {
      return _groups
          .where((group) => group.status == 'pending_summary')
          .toList();
    }
    if (_selectedFilter == '已出单') {
      return _groups.where((group) => group.status == 'ordered').toList();
    }
    return _groups;
  }

  Future<void> _selectTravelAgency() async {
    final selected = await showDialog<TravelAgencyRecord>(
      context: context,
      builder: (context) => _TravelAgencyPickerDialog(
        businessApi: _businessApi,
        agencies: _travelAgencies,
        initialAgency: _travelAgencyController.text.trim(),
      ),
    );
    if (selected == null || !mounted) {
      return;
    }
    setState(() {
      _travelAgencyController.text = selected.name;
      if (!_travelAgencies.any((agency) => agency.id == selected.id)) {
        _travelAgencies = [..._travelAgencies, selected]..sort(
            (left, right) => left.name.toLowerCase().compareTo(
                  right.name.toLowerCase(),
                ),
          );
      }
      _successMessage = null;
      _errorMessage = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        if (_successMessage != null)
          _InlineNotice(message: _successMessage!, tone: StatusTone.success),
        ResponsiveTwoColumn(
          primary: Form(
            key: _formKey,
            child: Column(
              children: [
                FormSection(
                  title: '旅行团基础信息',
                  children: [
                    ResponsiveFormGrid(
                      children: [
                        _DateField(
                          label: '日期',
                          value: _visitDate,
                          onTap: () async {
                            final result = await showDatePicker(
                              context: context,
                              initialDate: _visitDate,
                              firstDate: DateTime(2024),
                              lastDate: DateTime(2030),
                            );
                            if (result != null) {
                              setState(() => _visitDate = result);
                            }
                          },
                        ),
                        _SelectionField(
                          label: '旅行社',
                          value: _travelAgencyController.text.trim().isEmpty
                              ? null
                              : _travelAgencyController.text.trim(),
                          errorText: _travelAgencyController.text.trim().isEmpty
                              ? '必选'
                              : null,
                          onTap: _selectTravelAgency,
                        ),
                        TextFormField(
                          controller: _licensePlateController,
                          decoration: const InputDecoration(labelText: '车牌号'),
                          validator: _requiredValidator('车牌号不能为空'),
                        ),
                        _SelectionField(
                          label: '导游',
                          value: _selectedGuide == null
                              ? null
                              : '${_selectedGuide!.name} · ${_selectedGuide!.phone}',
                          errorText: _selectedGuide == null ? '必选' : null,
                          onTap: _selectGuide,
                        ),
                        TextFormField(
                          controller: _guestCountController,
                          keyboardType: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                          ],
                          decoration: const InputDecoration(labelText: '人数'),
                          validator: _positiveIntValidator('人数必须大于 0'),
                        ),
                        TextFormField(
                          controller: _tastingRoomNoController,
                          decoration: const InputDecoration(labelText: '品鉴馆号'),
                          validator: _requiredValidator('品鉴馆号不能为空'),
                        ),
                        _SelectionField(
                          label: '品鉴师',
                          value: _selectedTaster == null
                              ? null
                              : '${_selectedTaster!.name} · ${_selectedTaster!.username}',
                          errorText: _selectedTaster == null ? '必选' : null,
                          onTap: _selectTaster,
                        ),
                        TextFormField(
                          controller: _arrivalTimeController,
                          decoration: const InputDecoration(labelText: '进店时间'),
                        ),
                        DropdownButtonFormField<String>(
                          initialValue: _groupType,
                          decoration: const InputDecoration(labelText: '团型'),
                          items: [
                            for (final type in groupTypes)
                              DropdownMenuItem(value: type, child: Text(type)),
                          ],
                          onChanged: (value) {
                            if (value != null) {
                              setState(() => _groupType = value);
                            }
                          },
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                FormSection(
                  title: '提交录入',
                  trailing:
                      const StatusTag(label: '系统自动生成团号', tone: StatusTone.info),
                  children: [
                    SectionActions(
                      primaryLabel: _saving ? '保存中...' : '保存旅行团',
                      secondaryLabel: '清空',
                      onPrimaryPressed: _saving ? null : _saveTravelGroup,
                      onSecondaryPressed: () {
                        _clearForm();
                        setState(() {
                          _successMessage = null;
                          _errorMessage = null;
                        });
                      },
                    ),
                  ],
                ),
              ],
            ),
          ),
          secondary: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const AppSearchField(hintText: '搜索团号、旅行社、导游'),
              const SizedBox(height: 12),
              AppFilterBar(
                filters: const ['今日', '未标记', '待总结', '已出单'],
                selected: _selectedFilter,
                onSelected: (value) => setState(() => _selectedFilter = value),
              ),
              const SizedBox(height: 12),
              if (_loading)
                const Center(child: CircularProgressIndicator())
              else
                AppRecordList(
                  items: [
                    for (final group in _visibleGroups)
                      AppRecordItem(
                        title: group.groupNo,
                        subtitle:
                            '${group.travelAgency ?? '未填旅行社'} · ${group.guideName ?? '未填导游'} · ${group.guestCount} 人',
                        meta: [
                          if (group.tastingRoomNo != null) group.tastingRoomNo!,
                          if (group.arrivalTime != null)
                            '${group.arrivalTime} 进店',
                          if (group.salesAmountCents > 0)
                            formatMoneyCents(group.salesAmountCents),
                        ],
                        icon: Icons.directions_bus_rounded,
                        trailing: Wrap(
                          spacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            StatusTag(
                              label: _groupStatusLabel(group.status),
                              tone: _groupStatusTone(group.status),
                            ),
                            MarkInfoButton(
                              marked: _isGroupMarked(group),
                              label: '标记',
                              compact: true,
                              busy: _markingGroupIds.contains(group.id),
                              onPressed: _markingGroupIds.contains(group.id)
                                  ? null
                                  : () => _toggleGroupMark(group),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SelectionField extends StatelessWidget {
  const _SelectionField({
    required this.label,
    required this.value,
    required this.onTap,
    this.errorText,
  });

  final String label;
  final String? value;
  final VoidCallback onTap;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          errorText: errorText,
          suffixIcon: const Icon(Icons.arrow_drop_down_rounded),
        ),
        child: Text(value ?? '请选择'),
      ),
    );
  }
}

class _TravelAgencyPickerDialog extends StatefulWidget {
  const _TravelAgencyPickerDialog({
    required this.businessApi,
    required this.agencies,
    required this.initialAgency,
  });

  final BusinessApi businessApi;
  final List<TravelAgencyRecord> agencies;
  final String initialAgency;

  @override
  State<_TravelAgencyPickerDialog> createState() =>
      _TravelAgencyPickerDialogState();
}

class _TravelAgencyPickerDialogState extends State<_TravelAgencyPickerDialog> {
  late final TextEditingController _searchController;
  late final TextEditingController _newAgencyController;
  bool _creating = false;
  String _agencyQuery = '';
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController();
    _newAgencyController = TextEditingController(text: widget.initialAgency);
  }

  @override
  void dispose() {
    _searchController.dispose();
    _newAgencyController.dispose();
    super.dispose();
  }

  List<TravelAgencyRecord> get _filteredAgencies {
    final query = _agencyQuery.trim().toLowerCase();
    if (query.isEmpty) {
      return widget.agencies;
    }
    return widget.agencies
        .where((agency) => agency.name.toLowerCase().contains(query))
        .toList();
  }

  Future<void> _createAndSelect() async {
    final name = _newAgencyController.text.trim();
    if (name.isEmpty) {
      return;
    }
    setState(() {
      _creating = true;
      _errorMessage = null;
    });
    try {
      final agency = await widget.businessApi.createTravelAgency({
        'name': name,
      });
      if (mounted) {
        Navigator.of(context).pop(agency);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _creating = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final filteredAgencies = _filteredAgencies;
    return AlertDialog(
      title: const Text('选择旅行社'),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _searchController,
                decoration: InputDecoration(
                  labelText: '搜索旅行社',
                  hintText: '输入旅行社名称查询',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _agencyQuery.isEmpty
                      ? null
                      : IconButton(
                          tooltip: '清空搜索',
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _agencyQuery = '');
                          },
                          icon: const Icon(Icons.close_rounded),
                        ),
                ),
                textInputAction: TextInputAction.search,
                onChanged: (value) => setState(() => _agencyQuery = value),
              ),
              const SizedBox(height: 12),
              if (widget.agencies.isEmpty)
                const Text('暂无已录入旅行社，可在下方新建。')
              else if (filteredAgencies.isEmpty)
                const Text('未找到匹配旅行社，可调整关键词或在下方新建。')
              else
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 260),
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final agency in filteredAgencies)
                        ListTile(
                          title: Text(agency.name),
                          subtitle: agency.contactPhone == null
                              ? null
                              : Text(agency.contactPhone!),
                          trailing: const Icon(Icons.check_circle_outline),
                          onTap: () => Navigator.of(context).pop(agency),
                        ),
                    ],
                  ),
                ),
              const Divider(height: 28),
              TextField(
                controller: _newAgencyController,
                decoration: const InputDecoration(labelText: '新建旅行社名称'),
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _createAndSelect(),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: _creating ? null : _createAndSelect,
          icon: _creating
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.add_rounded),
          label: const Text('新建并选择'),
        ),
      ],
    );
  }
}

class _GuidePickerDialog extends StatefulWidget {
  const _GuidePickerDialog({
    required this.businessApi,
    required this.guides,
    required this.initialAgency,
  });

  final BusinessApi businessApi;
  final List<GuideRecord> guides;
  final String initialAgency;

  @override
  State<_GuidePickerDialog> createState() => _GuidePickerDialogState();
}

class _GuidePickerDialogState extends State<_GuidePickerDialog> {
  final _formKey = GlobalKey<FormState>();
  final _searchController = TextEditingController();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  late final TextEditingController _agencyController;
  final _remarksController = TextEditingController();
  bool _creating = false;
  String _guideQuery = '';
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _agencyController = TextEditingController(text: widget.initialAgency);
  }

  @override
  void dispose() {
    _searchController.dispose();
    _nameController.dispose();
    _phoneController.dispose();
    _agencyController.dispose();
    _remarksController.dispose();
    super.dispose();
  }

  Future<void> _createGuide() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() {
      _creating = true;
      _errorMessage = null;
    });
    try {
      final guide = await widget.businessApi.createGuide({
        'name': _nameController.text.trim(),
        'phone': _phoneController.text.trim(),
        'travelAgency': _agencyController.text.trim(),
        'remarks': _remarksController.text.trim(),
      });
      if (mounted) {
        Navigator.of(context).pop(guide);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _creating = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  List<GuideRecord> get _filteredGuides {
    final query = _guideQuery.trim().toLowerCase();
    if (query.isEmpty) {
      return widget.guides;
    }
    return widget.guides.where((guide) {
      return [
        guide.name,
        guide.phone,
        guide.travelAgency,
      ].any((value) => value.toLowerCase().contains(query));
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final filteredGuides = _filteredGuides;
    return AlertDialog(
      title: const Text('选择导游'),
      content: SizedBox(
        width: 560,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _searchController,
                decoration: InputDecoration(
                  labelText: '搜索导游',
                  hintText: '输入导游姓名查询',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _guideQuery.isEmpty
                      ? null
                      : IconButton(
                          tooltip: '清空搜索',
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _guideQuery = '');
                          },
                          icon: const Icon(Icons.close_rounded),
                        ),
                ),
                textInputAction: TextInputAction.search,
                onChanged: (value) => setState(() => _guideQuery = value),
              ),
              const SizedBox(height: 12),
              if (widget.guides.isEmpty)
                const Text('暂无导游，可在下方新建。')
              else if (filteredGuides.isEmpty)
                const Text('未找到匹配导游，可调整关键词或在下方新建。')
              else
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 280),
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final guide in filteredGuides)
                        ListTile(
                          title: Text(guide.name),
                          subtitle:
                              Text('${guide.phone} · ${guide.travelAgency}'),
                          trailing: const Icon(Icons.check_circle_outline),
                          onTap: () => Navigator.of(context).pop(guide),
                        ),
                    ],
                  ),
                ),
              const Divider(height: 28),
              Form(
                key: _formKey,
                child: Column(
                  children: [
                    TextFormField(
                      controller: _nameController,
                      decoration: const InputDecoration(labelText: '导游姓名'),
                      validator: _requiredValidator('导游姓名不能为空'),
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: '导游电话'),
                      validator: _requiredValidator('导游电话不能为空'),
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      controller: _agencyController,
                      decoration: const InputDecoration(labelText: '常用旅行社（选填）'),
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      controller: _remarksController,
                      decoration: const InputDecoration(labelText: '备注'),
                    ),
                  ],
                ),
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: _creating ? null : _createGuide,
          icon: _creating
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.add_rounded),
          label: const Text('新建并选择'),
        ),
      ],
    );
  }
}

class _TasterPickerDialog extends StatelessWidget {
  const _TasterPickerDialog({required this.tasters});

  final List<TasterOption> tasters;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('选择品鉴师'),
      content: SizedBox(
        width: 420,
        child: tasters.isEmpty
            ? const Text('暂无可选品鉴师。')
            : ListView(
                shrinkWrap: true,
                children: [
                  for (final taster in tasters)
                    ListTile(
                      title: Text(taster.name),
                      subtitle: Text(taster.username),
                      onTap: () => Navigator.of(context).pop(taster),
                    ),
                ],
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
      ],
    );
  }
}

class _DateField extends StatelessWidget {
  const _DateField({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final DateTime value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      key: ValueKey(formatDate(value)),
      readOnly: true,
      onTap: onTap,
      initialValue: formatDate(value),
      decoration: InputDecoration(
        labelText: label,
        suffixIcon: const Icon(Icons.calendar_month_rounded),
      ),
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

int _intFromText(String value) {
  return int.tryParse(value.trim()) ?? 0;
}

FormFieldValidator<String> _requiredValidator(String message) {
  return (value) {
    if (value == null || value.trim().isEmpty) {
      return message;
    }
    return null;
  };
}

FormFieldValidator<String> _positiveIntValidator(String message) {
  return (value) {
    final number = int.tryParse((value ?? '').trim()) ?? 0;
    if (number <= 0) {
      return message;
    }
    return null;
  };
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}

String _groupStatusLabel(String status) {
  switch (status) {
    case 'ordered':
      return '已出单';
    case 'pending_summary':
      return '待总结';
    case 'unmarked':
    default:
      return '未标记';
  }
}

StatusTone _groupStatusTone(String status) {
  switch (status) {
    case 'ordered':
      return StatusTone.success;
    case 'pending_summary':
      return StatusTone.warning;
    case 'unmarked':
    default:
      return StatusTone.neutral;
  }
}
