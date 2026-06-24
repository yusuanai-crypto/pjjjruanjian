import 'package:flutter/material.dart';
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
  late BusinessApi _businessApi;
  late final TextEditingController _groupNoController;
  late final TextEditingController _travelAgencyController;
  late final TextEditingController _licensePlateController;
  late final TextEditingController _guideNameController;
  late final TextEditingController _guidePhoneController;
  late final TextEditingController _guestCountController;
  late final TextEditingController _tastingRoomNoController;
  late final TextEditingController _tasterNameController;
  late final TextEditingController _arrivalTimeController;

  DateTime _visitDate = DateTime.now();
  String _groupType = groupTypes.first;
  String _selectedFilter = '今日';
  bool _loading = true;
  bool _saving = false;
  String? _errorMessage;
  String? _successMessage;
  final Set<String> _markingGroupIds = <String>{};
  List<TravelGroupRecord> _groups = const <TravelGroupRecord>[];

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _groupNoController = TextEditingController(text: _nextGroupNo());
    _travelAgencyController = TextEditingController();
    _licensePlateController = TextEditingController();
    _guideNameController = TextEditingController();
    _guidePhoneController = TextEditingController();
    _guestCountController = TextEditingController();
    _tastingRoomNoController = TextEditingController();
    _tasterNameController = TextEditingController();
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
    _groupNoController.dispose();
    _travelAgencyController.dispose();
    _licensePlateController.dispose();
    _guideNameController.dispose();
    _guidePhoneController.dispose();
    _guestCountController.dispose();
    _tastingRoomNoController.dispose();
    _tasterNameController.dispose();
    _arrivalTimeController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final groups = await _businessApi.listTravelGroups();
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = groups;
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
    setState(() {
      _saving = true;
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      await _businessApi.createTravelGroup({
        'groupNo': _groupNoController.text.trim(),
        'visitDate': formatDate(_visitDate),
        'travelAgency': _travelAgencyController.text.trim(),
        'licensePlate': _licensePlateController.text.trim(),
        'guideName': _guideNameController.text.trim(),
        'guidePhone': _guidePhoneController.text.trim(),
        'guestCount': _intFromText(_guestCountController.text),
        'tastingRoomNo': _tastingRoomNoController.text.trim(),
        'tasterName': _tasterNameController.text.trim(),
        'arrivalTime': _arrivalTimeController.text.trim(),
        'groupType': _groupType,
      });
      _clearForm(generateNewGroupNo: true);
      await _loadData();
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _successMessage = '旅行团已保存到数据库。';
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

  void _clearForm({bool generateNewGroupNo = false}) {
    _groupNoController.text = generateNewGroupNo ? _nextGroupNo() : '';
    _travelAgencyController.clear();
    _licensePlateController.clear();
    _guideNameController.clear();
    _guidePhoneController.clear();
    _guestCountController.clear();
    _tastingRoomNoController.clear();
    _tasterNameController.clear();
    _arrivalTimeController.clear();
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

  @override
  Widget build(BuildContext context) {
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
                title: '旅行团基础信息',
                children: [
                  ResponsiveFormGrid(
                    children: [
                      TextField(
                        controller: _groupNoController,
                        decoration: const InputDecoration(labelText: '团号'),
                      ),
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
                      TextField(
                        controller: _travelAgencyController,
                        decoration: const InputDecoration(labelText: '旅行社'),
                      ),
                      TextField(
                        controller: _licensePlateController,
                        decoration: const InputDecoration(labelText: '车牌号'),
                      ),
                      TextField(
                        controller: _guideNameController,
                        decoration: const InputDecoration(labelText: '导游'),
                      ),
                      TextField(
                        controller: _guidePhoneController,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(labelText: '导游电话'),
                      ),
                      TextField(
                        controller: _guestCountController,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: '人数'),
                      ),
                      TextField(
                        controller: _tastingRoomNoController,
                        decoration: const InputDecoration(labelText: '品鉴馆馆号'),
                      ),
                      TextField(
                        controller: _tasterNameController,
                        decoration: const InputDecoration(labelText: '品鉴师'),
                      ),
                      TextField(
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
                    const StatusTag(label: '销售补充离店信息', tone: StatusTone.info),
                children: [
                  SectionActions(
                    primaryLabel: _saving ? '保存中...' : '保存旅行团',
                    secondaryLabel: '清空',
                    onPrimaryPressed: _saving ? null : _saveTravelGroup,
                    onSecondaryPressed: () {
                      setState(() {
                        _clearForm();
                        _successMessage = null;
                        _errorMessage = null;
                      });
                    },
                  ),
                ],
              ),
            ],
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

String _nextGroupNo() {
  final now = DateTime.now();
  return 'GZ-${now.month.toString().padLeft(2, '0')}${now.day.toString().padLeft(2, '0')}-${now.millisecondsSinceEpoch % 1000}';
}

int _intFromText(String value) {
  return int.tryParse(value.trim()) ?? 0;
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
