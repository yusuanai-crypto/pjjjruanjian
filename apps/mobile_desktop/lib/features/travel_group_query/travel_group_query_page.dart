import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import '../travel_group_detail/travel_group_detail_panel.dart';
import '../travel_groups/tasting_items_editor.dart';

const _allFilter = '__all__';
const _markedFilter = 'marked';
const _unmarkedFilter = 'unmarked';

const _pendingFilters = <String, String>{
  _allFilter: '全部',
  'pending_front_desk': '待前台',
  'pending_taster': '待品鉴师',
  'pending_finance': '待财务',
  'abnormal': '异常',
};

const _financeFilters = <String, String>{
  _allFilter: '全部',
  _markedFilter: '已标记',
  _unmarkedFilter: '未标记',
};

const _editableStatuses = <String>{'unmarked', 'pending_summary', 'ordered'};

class TravelGroupQueryPage extends StatefulWidget {
  const TravelGroupQueryPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<TravelGroupQueryPage> createState() => _TravelGroupQueryPageState();
}

class _TravelGroupQueryPageState extends State<TravelGroupQueryPage> {
  late BusinessApi _businessApi;
  late final TextEditingController _keywordController;

  DateTime _start = DateTime.now().subtract(const Duration(days: 30));
  DateTime _end = DateTime.now();
  String _keyword = '';
  String _groupTypeFilter = _allFilter;
  String _guideFilter = _allFilter;
  String _tasterFilter = _allFilter;
  String _financeFilter = _allFilter;
  String _pendingFilter = _allFilter;
  String? _selectedId;

  bool _loading = true;
  String? _errorMessage;
  List<TravelGroupRecord> _groups = const <TravelGroupRecord>[];
  List<GuideRecord> _guides = const <GuideRecord>[];
  List<TasterOption> _tasters = const <TasterOption>[];
  final Set<String> _markingIds = <String>{};
  final Set<String> _summarizingIds = <String>{};

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _keywordController = TextEditingController();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant TravelGroupQueryPage oldWidget) {
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
    _keywordController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final results = await Future.wait<Object>([
        _businessApi.listTravelGroups(
          limit: 200,
          start: _start,
          end: _end,
          keyword: _keyword,
          groupType: _optionalFilter(_groupTypeFilter),
          guideId: _optionalFilter(_guideFilter),
          tasterId: _optionalFilter(_tasterFilter),
          financeMark: _financeMarkFilterValue(),
          pendingStatus: _optionalFilter(_pendingFilter),
        ),
        _businessApi.listGuides(isActive: true, limit: 200),
        _businessApi.listTasters(),
      ]);

      if (!mounted) {
        return;
      }

      final groups = results[0] as List<TravelGroupRecord>;
      final guides = results[1] as List<GuideRecord>;
      final tasters = results[2] as List<TasterOption>;

      setState(() {
        _groups = groups;
        _guides = guides;
        _tasters = tasters;
        if (_guideFilter != _allFilter &&
            !guides.any((guide) => guide.id == _guideFilter)) {
          _guideFilter = _allFilter;
        }
        if (_tasterFilter != _allFilter &&
            !tasters.any((taster) => taster.id == _tasterFilter)) {
          _tasterFilter = _allFilter;
        }
        _selectedId = _selectedIdFor(groups);
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

  String? _selectedIdFor(List<TravelGroupRecord> groups) {
    if (groups.isEmpty) {
      return null;
    }
    if (_selectedId != null && groups.any((group) => group.id == _selectedId)) {
      return _selectedId;
    }
    return groups.first.id;
  }

  TravelGroupRecord? _selectedRecord() {
    if (_groups.isEmpty) {
      return null;
    }
    if (_selectedId != null) {
      for (final group in _groups) {
        if (group.id == _selectedId) {
          return group;
        }
      }
    }
    return _groups.first;
  }

  bool? _financeMarkFilterValue() {
    switch (_financeFilter) {
      case _markedFilter:
        return true;
      case _unmarkedFilter:
        return false;
      default:
        return null;
    }
  }

  Future<void> _toggleFinanceMark(TravelGroupRecord group) async {
    setState(() {
      _markingIds.add(group.id);
      _errorMessage = null;
    });

    try {
      final updated = await _businessApi.setTravelGroupFinanceMark(
        group.id,
        !group.financeMark,
      );
      if (!mounted) {
        return;
      }
      _replaceGroup(updated);
      setState(() {
        _markingIds.remove(group.id);
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _markingIds.remove(group.id);
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _submitSummary(TravelGroupRecord group) async {
    final summary = await showDialog<String>(
      context: context,
      builder: (context) => _TasterSummaryDialog(group: group),
    );
    if (summary == null) {
      return;
    }

    setState(() {
      _summarizingIds.add(group.id);
      _errorMessage = null;
    });

    try {
      final updated =
          await _businessApi.submitTravelGroupTasterSummary(group.id, summary);
      if (!mounted) {
        return;
      }
      _replaceGroup(updated);
      setState(() {
        _summarizingIds.remove(group.id);
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _summarizingIds.remove(group.id);
        _errorMessage = _messageForError(error);
      });
    }
  }

  void _replaceGroup(TravelGroupRecord updated) {
    setState(() {
      _groups = [
        for (final group in _groups)
          if (group.id == updated.id) updated else group,
      ];
      _selectedId = updated.id;
    });
  }

  Future<void> _editTravelGroup(TravelGroupRecord group) async {
    final updated = await showDialog<TravelGroupRecord>(
      context: context,
      builder: (context) => _TravelGroupEditDialog(
        businessApi: _businessApi,
        group: group,
        role: widget.role,
        guides: _guides,
        tasters: _tasters,
      ),
    );
    if (updated == null || !mounted) {
      return;
    }
    _replaceGroup(updated);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('旅行团信息已保存。')),
    );
  }

  void _setFilter(VoidCallback change) {
    setState(change);
    _loadData();
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selectedRecord();

    return ResponsivePage(
      children: [
        _TravelGroupQueryFilters(
          start: _start,
          end: _end,
          keywordController: _keywordController,
          groupTypeFilter: _groupTypeFilter,
          guideFilter: _guideFilter,
          tasterFilter: _tasterFilter,
          financeFilter: _financeFilter,
          pendingFilter: _pendingFilter,
          guides: _guides,
          tasters: _tasters,
          resultCount: _groups.length,
          onKeywordChanged: (value) => _keyword = value,
          onSearch: () {
            setState(() => _keyword = _keywordController.text.trim());
            _loadData();
          },
          onDateRangeChanged: (range) => _setFilter(() {
            _start = range.start;
            _end = range.end;
          }),
          onGroupTypeChanged: (value) =>
              _setFilter(() => _groupTypeFilter = value),
          onGuideChanged: (value) => _setFilter(() => _guideFilter = value),
          onTasterChanged: (value) => _setFilter(() => _tasterFilter = value),
          onFinanceChanged: (value) => _setFilter(() => _financeFilter = value),
          onPendingChanged: (value) => _setFilter(() => _pendingFilter = value),
          onRefresh: _loadData,
        ),
        if (_loading)
          const LoadingState(title: '正在加载旅行团')
        else if (_errorMessage != null)
          ErrorState(title: _errorMessage!, onRetry: _loadData)
        else if (_groups.isEmpty)
          EmptyState(
            title: '没有匹配的旅行团',
            action: OutlinedButton.icon(
              onPressed: _loadData,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('刷新'),
            ),
          )
        else ...[
          MetricGrid(
            metrics: [
              MetricData(
                label: '旅行团数',
                value: '${_groups.length}',
                icon: Icons.directions_bus_rounded,
              ),
              MetricData(
                label: '接待人数',
                value:
                    '${_groups.fold<int>(0, (sum, item) => sum + item.guestCount)}',
                icon: Icons.groups_rounded,
              ),
              MetricData(
                label: '已标记',
                value: '${_groups.where((group) => group.financeMark).length}',
                icon: Icons.bookmark_added_rounded,
              ),
              MetricData(
                label: '待处理',
                value:
                    '${_groups.where((group) => group.pendingStatus != null).length}',
                icon: Icons.pending_actions_rounded,
              ),
            ],
          ),
          ResponsiveTwoColumn(
            primary: _TravelGroupList(
              groups: _groups,
              selectedId: _selectedId,
              onSelect: (group) => setState(() => _selectedId = group.id),
            ),
            secondary: selected == null
                ? const EmptyState(title: '请选择旅行团')
                : TravelGroupDetailPanel(
                    group: selected,
                    role: widget.role,
                    marking: _markingIds.contains(selected.id),
                    summarizing: _summarizingIds.contains(selected.id),
                    onEdit: _canEdit(widget.role)
                        ? () => _editTravelGroup(selected)
                        : null,
                    onFinanceMark: _canMark(widget.role)
                        ? () => _toggleFinanceMark(selected)
                        : null,
                    onSummary: _canSubmitSummary(widget.role)
                        ? () => _submitSummary(selected)
                        : null,
                  ),
          ),
        ],
      ],
    );
  }
}

class _TravelGroupQueryFilters extends StatelessWidget {
  const _TravelGroupQueryFilters({
    required this.start,
    required this.end,
    required this.keywordController,
    required this.groupTypeFilter,
    required this.guideFilter,
    required this.tasterFilter,
    required this.financeFilter,
    required this.pendingFilter,
    required this.guides,
    required this.tasters,
    required this.resultCount,
    required this.onKeywordChanged,
    required this.onSearch,
    required this.onDateRangeChanged,
    required this.onGroupTypeChanged,
    required this.onGuideChanged,
    required this.onTasterChanged,
    required this.onFinanceChanged,
    required this.onPendingChanged,
    required this.onRefresh,
  });

  final DateTime start;
  final DateTime end;
  final TextEditingController keywordController;
  final String groupTypeFilter;
  final String guideFilter;
  final String tasterFilter;
  final String financeFilter;
  final String pendingFilter;
  final List<GuideRecord> guides;
  final List<TasterOption> tasters;
  final int resultCount;
  final ValueChanged<String> onKeywordChanged;
  final VoidCallback onSearch;
  final ValueChanged<DateTimeRange> onDateRangeChanged;
  final ValueChanged<String> onGroupTypeChanged;
  final ValueChanged<String> onGuideChanged;
  final ValueChanged<String> onTasterChanged;
  final ValueChanged<String> onFinanceChanged;
  final ValueChanged<String> onPendingChanged;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      title: '旅行团查询',
      trailing: StatusTag(label: '$resultCount 个旅行团', tone: StatusTone.info),
      children: [
        ResponsiveFormGrid(
          children: [
            AppSearchField(
              controller: keywordController,
              hintText: '搜索团号、旅行社、导游、品鉴师',
              onChanged: onKeywordChanged,
            ),
            AppDateRangeButton(
              start: start,
              end: end,
              onChanged: onDateRangeChanged,
            ),
            _StringDropdown(
              label: '团型',
              value: groupTypeFilter,
              items: [
                const MapEntry(_allFilter, '全部'),
                for (final type in groupTypes) MapEntry(type, type),
              ],
              onChanged: onGroupTypeChanged,
            ),
            _StringDropdown(
              label: '导游',
              value: guideFilter,
              items: [
                const MapEntry(_allFilter, '全部'),
                for (final guide in guides)
                  MapEntry(guide.id, '${guide.name} · ${guide.travelAgency}'),
              ],
              onChanged: onGuideChanged,
            ),
            _StringDropdown(
              label: '品鉴师',
              value: tasterFilter,
              items: [
                const MapEntry(_allFilter, '全部'),
                for (final taster in tasters)
                  MapEntry(taster.id, _tasterLabel(taster)),
              ],
              onChanged: onTasterChanged,
            ),
            _StringDropdown(
              label: '财务标记',
              value: financeFilter,
              items: _financeFilters.entries.toList(),
              onChanged: onFinanceChanged,
            ),
            _StringDropdown(
              label: '待处理状态',
              value: pendingFilter,
              items: _pendingFilters.entries.toList(),
              onChanged: onPendingChanged,
            ),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          alignment: WrapAlignment.end,
          spacing: 10,
          runSpacing: 10,
          children: [
            OutlinedButton.icon(
              onPressed: onRefresh,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('刷新'),
            ),
            FilledButton.icon(
              onPressed: onSearch,
              icon: const Icon(Icons.search_rounded),
              label: const Text('查询'),
            ),
          ],
        ),
      ],
    );
  }
}

class _TravelGroupList extends StatelessWidget {
  const _TravelGroupList({
    required this.groups,
    required this.selectedId,
    required this.onSelect,
  });

  final List<TravelGroupRecord> groups;
  final String? selectedId;
  final ValueChanged<TravelGroupRecord> onSelect;

  @override
  Widget build(BuildContext context) {
    return AppRecordList(
      items: [
        for (final group in groups)
          AppRecordItem(
            title: group.groupNo,
            subtitle:
                '${_display(group.travelAgency)} · ${_display(group.guideName)} · ${group.guestCount} 人',
            meta: [
              if (group.visitDate.isNotEmpty) group.visitDate,
              _display(group.groupType),
              _display(group.tasterName),
            ],
            icon: selectedId == group.id
                ? Icons.radio_button_checked_rounded
                : Icons.directions_bus_rounded,
            trailing: StatusTag(
              label: group.pendingStatus == null
                  ? _groupStatusLabel(group.status)
                  : _pendingStatusLabel(group.pendingStatus),
              tone: group.pendingStatus == null
                  ? _groupStatusTone(group.status)
                  : _pendingStatusTone(group.pendingStatus),
            ),
            onTap: () => onSelect(group),
          ),
      ],
    );
  }
}

class _StringDropdown extends StatelessWidget {
  const _StringDropdown({
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  final String label;
  final String value;
  final List<MapEntry<String, String>> items;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final values = items.map((item) => item.key).toSet();
    final safeValue = values.contains(value) ? value : _allFilter;
    return DropdownButtonFormField<String>(
      key: ValueKey('$label-$safeValue-${items.length}'),
      initialValue: safeValue,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final item in items)
          DropdownMenuItem(
            value: item.key,
            child: Text(item.value, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (next) {
        if (next != null) {
          onChanged(next);
        }
      },
    );
  }
}

class _TasterSummaryDialog extends StatefulWidget {
  const _TasterSummaryDialog({required this.group});

  final TravelGroupRecord group;

  @override
  State<_TasterSummaryDialog> createState() => _TasterSummaryDialogState();
}

class _TasterSummaryDialogState extends State<_TasterSummaryDialog> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.group.tasterSummary ?? '');
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final canSubmit = _controller.text.trim().isNotEmpty;
    return AlertDialog(
      title: Text('${widget.group.groupNo} 品鉴总结'),
      content: SizedBox(
        width: 420,
        child: TextField(
          controller: _controller,
          autofocus: true,
          maxLines: 5,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            labelText: '总结内容',
            alignLabelWithHint: true,
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: canSubmit
              ? () => Navigator.of(context).pop(_controller.text.trim())
              : null,
          icon: const Icon(Icons.check_rounded),
          label: const Text('保存'),
        ),
      ],
    );
  }
}

class _TravelGroupEditDialog extends StatefulWidget {
  const _TravelGroupEditDialog({
    required this.businessApi,
    required this.group,
    required this.role,
    required this.guides,
    required this.tasters,
  });

  final BusinessApi businessApi;
  final TravelGroupRecord group;
  final UserRole role;
  final List<GuideRecord> guides;
  final List<TasterOption> tasters;

  @override
  State<_TravelGroupEditDialog> createState() => _TravelGroupEditDialogState();
}

class _TravelGroupEditDialogState extends State<_TravelGroupEditDialog> {
  final _formKey = GlobalKey<FormState>();
  final _tastingItemsKey = GlobalKey<TastingItemsEditorState>();

  late DateTime _visitDate;
  late String _selectedGuideId;
  late String _selectedTasterId;
  String? _groupType;
  late String _status;
  late bool _guideInfoSent;
  late bool _travelAgencyInfoSent;
  bool _guideTouched = false;
  bool _tasterTouched = false;
  bool _saving = false;
  String? _errorMessage;

  late final TextEditingController _groupNoController;
  late final TextEditingController _travelAgencyController;
  late final TextEditingController _licensePlateController;
  late final TextEditingController _guestCountController;
  late final TextEditingController _tastingRoomNoController;
  late final TextEditingController _arrivalTimeController;
  late final TextEditingController _departureTimeController;
  late final TextEditingController _remarksController;
  late final TextEditingController _wineDetailsController;
  late final TextEditingController _tasterSummaryController;
  late final TextEditingController _salesAmountController;
  late final TextEditingController _paidDepositController;
  late final TextEditingController _cashOnDeliveryController;
  late final TextEditingController _liquorCostDeductionController;
  late final TextEditingController _orderAmountController;
  late final TextEditingController _pointsController;
  late final TextEditingController _returnedPointsController;
  late final TextEditingController _unreturnedPointsController;
  late final List<TastingItemDraft> _initialTastingItems;
  late List<Map<String, dynamic>> _tastingItems;

  bool get _isAdmin => widget.role == UserRole.admin;
  bool get _isFrontDesk => widget.role == UserRole.frontDesk;
  bool get _isSales => widget.role == UserRole.sales;
  bool get _isTaster => widget.role == UserRole.taster;
  bool get _isFinance => widget.role == UserRole.finance;

  bool get _canEditGroupNo => _isAdmin;
  bool get _canEditFrontDeskFields => _isAdmin || _isFrontDesk;
  bool get _canEditGuestCount =>
      _isAdmin || _isFrontDesk || _isSales || _isTaster;
  bool get _canEditDepartureTime => _isAdmin || _isSales;
  bool get _canEditTastingItems => _isAdmin || _isFrontDesk || _isSales;
  bool get _canEditTasterNotes => _isAdmin || _isTaster;
  bool get _canEditRemarks =>
      _isAdmin || _isFrontDesk || _isSales || _isFinance;
  bool get _canEditFinanceFields => _isAdmin || _isFinance;

  bool get _showBasicSection =>
      _canEditGroupNo || _canEditFrontDeskFields || _canEditGuestCount;
  bool get _showSupplementSection =>
      _canEditDepartureTime ||
      _canEditTastingItems ||
      _canEditTasterNotes ||
      _canEditRemarks;

  @override
  void initState() {
    super.initState();
    final group = widget.group;
    _visitDate = DateTime.tryParse(group.visitDate) ?? DateTime.now();
    _selectedGuideId = group.guideId ?? '';
    _selectedTasterId = group.tasterId ?? '';
    _groupType = _nonEmpty(group.groupType);
    _status =
        _editableStatuses.contains(group.status) ? group.status : 'unmarked';
    _guideInfoSent = group.guideInfoSent;
    _travelAgencyInfoSent = group.travelAgencyInfoSent;

    _groupNoController = TextEditingController(text: group.groupNo);
    _travelAgencyController =
        TextEditingController(text: group.travelAgency ?? '');
    _licensePlateController =
        TextEditingController(text: group.licensePlate ?? '');
    _guestCountController = TextEditingController(text: '${group.guestCount}');
    _tastingRoomNoController =
        TextEditingController(text: group.tastingRoomNo ?? '');
    _arrivalTimeController =
        TextEditingController(text: group.arrivalTime ?? '');
    _departureTimeController =
        TextEditingController(text: group.departureTime ?? '');
    _remarksController = TextEditingController(text: group.remarks ?? '');
    _wineDetailsController =
        TextEditingController(text: group.wineDetails ?? '');
    _tasterSummaryController =
        TextEditingController(text: group.tasterSummary ?? '');
    _salesAmountController =
        TextEditingController(text: _moneyText(group.salesAmountCents));
    _paidDepositController =
        TextEditingController(text: _moneyText(group.paidDepositCents));
    _cashOnDeliveryController =
        TextEditingController(text: _moneyText(group.cashOnDeliveryCents));
    _liquorCostDeductionController =
        TextEditingController(text: _moneyText(group.liquorCostDeductionCents));
    _orderAmountController =
        TextEditingController(text: _moneyText(group.orderAmountCents));
    _pointsController = TextEditingController(text: '${group.points}');
    _returnedPointsController =
        TextEditingController(text: '${group.returnedPoints}');
    _unreturnedPointsController =
        TextEditingController(text: '${group.unreturnedPoints}');
    _initialTastingItems = _tastingDraftsFromGroup(group);
    _tastingItems = _tastingPayloadFromGroup(group);
  }

  @override
  void dispose() {
    _groupNoController.dispose();
    _travelAgencyController.dispose();
    _licensePlateController.dispose();
    _guestCountController.dispose();
    _tastingRoomNoController.dispose();
    _arrivalTimeController.dispose();
    _departureTimeController.dispose();
    _remarksController.dispose();
    _wineDetailsController.dispose();
    _tasterSummaryController.dispose();
    _salesAmountController.dispose();
    _paidDepositController.dispose();
    _cashOnDeliveryController.dispose();
    _liquorCostDeductionController.dispose();
    _orderAmountController.dispose();
    _pointsController.dispose();
    _returnedPointsController.dispose();
    _unreturnedPointsController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final formValid = _formKey.currentState?.validate() ?? false;
    final tastingValid = !_canEditTastingItems ||
        (_tastingItemsKey.currentState?.validate() ?? true);
    if (!formValid || !tastingValid) {
      setState(() => _errorMessage = '请先修正表单中的提示。');
      return;
    }

    setState(() {
      _saving = true;
      _errorMessage = null;
    });

    try {
      final updated = await widget.businessApi.updateTravelGroup(
        widget.group.id,
        _buildPayload(),
      );
      if (mounted) {
        Navigator.of(context).pop(updated);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _errorMessage = _messageForSaveError(error);
      });
    }
  }

  Map<String, dynamic> _buildPayload() {
    final payload = <String, dynamic>{};

    if (_canEditGroupNo) {
      payload['groupNo'] = _groupNoController.text.trim();
    }
    if (_canEditFrontDeskFields) {
      payload['visitDate'] = formatDate(_visitDate);
      payload['travelAgency'] = _travelAgencyController.text.trim();
      payload['licensePlate'] = _licensePlateController.text.trim();
      if (_selectedGuideId.trim().isNotEmpty &&
          (_guideTouched || _selectedGuideId != (widget.group.guideId ?? ''))) {
        payload['guideId'] = _selectedGuideId;
      }
      payload['tastingRoomNo'] = _tastingRoomNoController.text.trim();
      if (_selectedTasterId.trim().isNotEmpty &&
          (_tasterTouched ||
              _selectedTasterId != (widget.group.tasterId ?? ''))) {
        payload['tasterId'] = _selectedTasterId;
      }
      payload['arrivalTime'] = _arrivalTimeController.text.trim();
      if ((_groupType ?? '').trim().isNotEmpty) {
        payload['groupType'] = _groupType!.trim();
      }
    }
    if (_canEditGuestCount) {
      payload['guestCount'] = _intFromText(_guestCountController.text);
    }
    if (_canEditDepartureTime) {
      payload['departureTime'] = _departureTimeController.text.trim();
    }
    if (_canEditRemarks) {
      payload['remarks'] = _remarksController.text.trim();
    }
    if (_canEditTasterNotes) {
      payload['wineDetails'] = _wineDetailsController.text.trim();
      payload['tasterSummary'] = _tasterSummaryController.text.trim();
    }
    if (_canEditTastingItems) {
      payload['tastingItems'] = _tastingItems;
    }
    if (_canEditFinanceFields) {
      payload['status'] = _status;
      payload['salesAmountCents'] =
          _centsFromMoneyText(_salesAmountController.text);
      payload['paidDepositCents'] =
          _centsFromMoneyText(_paidDepositController.text);
      payload['cashOnDeliveryCents'] =
          _centsFromMoneyText(_cashOnDeliveryController.text);
      payload['liquorCostDeductionCents'] =
          _centsFromMoneyText(_liquorCostDeductionController.text);
      payload['orderAmountCents'] =
          _centsFromMoneyText(_orderAmountController.text);
      payload['points'] = _intFromText(_pointsController.text);
      payload['returnedPoints'] = _intFromText(_returnedPointsController.text);
      payload['unreturnedPoints'] =
          _intFromText(_unreturnedPointsController.text);
      payload['guideInfoSent'] = _guideInfoSent;
      payload['travelAgencyInfoSent'] = _travelAgencyInfoSent;
    }

    return payload;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('${widget.group.groupNo} 编辑'),
      content: SizedBox(
        width: 760,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_errorMessage != null) ...[
                  _DialogNotice(message: _errorMessage!),
                  const SizedBox(height: 12),
                ],
                if (_showBasicSection)
                  _DialogSection(
                    title: '基础信息',
                    child: ResponsiveFormGrid(children: _basicFields()),
                  ),
                if (_showBasicSection && _showSupplementSection)
                  const SizedBox(height: 12),
                if (_showSupplementSection)
                  _DialogSection(
                    title: '接待补充',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        ResponsiveFormGrid(children: _supplementFields()),
                        if (_canEditTastingItems) ...[
                          const SizedBox(height: 12),
                          TastingItemsEditor(
                            key: _tastingItemsKey,
                            initialItems: _initialTastingItems,
                            onChanged: (items) => _tastingItems = items,
                          ),
                        ],
                      ],
                    ),
                  ),
                if ((_showBasicSection || _showSupplementSection) &&
                    _canEditFinanceFields)
                  const SizedBox(height: 12),
                if (_canEditFinanceFields)
                  _DialogSection(
                    title: '财务信息',
                    child: ResponsiveFormGrid(children: _financeFields()),
                  ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton.icon(
          onPressed: _saving ? null : _save,
          icon: _saving
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.check_rounded),
          label: Text(_saving ? '保存中...' : '保存修改'),
        ),
      ],
    );
  }

  List<Widget> _basicFields() {
    return [
      if (_canEditGroupNo)
        TextFormField(
          controller: _groupNoController,
          decoration: const InputDecoration(labelText: '团号'),
          validator: _requiredValidator('团号不能为空'),
        ),
      if (_canEditFrontDeskFields)
        _EditDateField(
          label: '日期',
          value: _visitDate,
          onTap: _pickVisitDate,
        ),
      if (_canEditFrontDeskFields)
        TextFormField(
          controller: _travelAgencyController,
          decoration: const InputDecoration(labelText: '旅行社'),
        ),
      if (_canEditFrontDeskFields) _guideDropdown(),
      if (_canEditFrontDeskFields)
        TextFormField(
          controller: _licensePlateController,
          decoration: const InputDecoration(labelText: '车牌号'),
        ),
      if (_canEditGuestCount)
        TextFormField(
          controller: _guestCountController,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: const InputDecoration(labelText: '人数'),
          validator: _positiveIntValidator('人数必须大于 0'),
        ),
      if (_canEditFrontDeskFields)
        TextFormField(
          controller: _tastingRoomNoController,
          decoration: const InputDecoration(labelText: '品鉴馆号'),
        ),
      if (_canEditFrontDeskFields) _tasterDropdown(),
      if (_canEditFrontDeskFields)
        TextFormField(
          controller: _arrivalTimeController,
          decoration: const InputDecoration(labelText: '进店时间'),
        ),
      if (_canEditFrontDeskFields) _groupTypeDropdown(),
    ];
  }

  List<Widget> _supplementFields() {
    return [
      if (_canEditDepartureTime)
        TextFormField(
          controller: _departureTimeController,
          decoration: const InputDecoration(labelText: '离店时间'),
        ),
      if (_canEditTasterNotes)
        TextFormField(
          controller: _wineDetailsController,
          decoration: const InputDecoration(labelText: '品鉴备注'),
        ),
      if (_canEditTasterNotes)
        TextFormField(
          controller: _tasterSummaryController,
          minLines: 1,
          maxLines: 3,
          decoration: const InputDecoration(labelText: '品鉴总结'),
        ),
      if (_canEditRemarks)
        TextFormField(
          controller: _remarksController,
          minLines: 1,
          maxLines: 3,
          decoration: const InputDecoration(labelText: '备注'),
        ),
    ];
  }

  List<Widget> _financeFields() {
    return [
      _statusDropdown(),
      _moneyField(_salesAmountController, '销售金额（元）'),
      _moneyField(_paidDepositController, '已付定金（元）'),
      _moneyField(_cashOnDeliveryController, '货到付款（元）'),
      _moneyField(_liquorCostDeductionController, '酒水成本扣除（元）'),
      _moneyField(_orderAmountController, '订单金额（元）'),
      _intField(_pointsController, '积分'),
      _intField(_returnedPointsController, '已返积分'),
      _intField(_unreturnedPointsController, '未返积分'),
      CheckboxListTile(
        value: _guideInfoSent,
        contentPadding: EdgeInsets.zero,
        title: const Text('已发送导游信息'),
        onChanged: (value) {
          setState(() => _guideInfoSent = value ?? false);
        },
      ),
      CheckboxListTile(
        value: _travelAgencyInfoSent,
        contentPadding: EdgeInsets.zero,
        title: const Text('已发送旅行社信息'),
        onChanged: (value) {
          setState(() => _travelAgencyInfoSent = value ?? false);
        },
      ),
    ];
  }

  Widget _guideDropdown() {
    final items = _guideItems();
    final values = items.map((item) => item.key).toSet();
    final safeValue = values.contains(_selectedGuideId) ? _selectedGuideId : '';
    return DropdownButtonFormField<String>(
      initialValue: safeValue,
      isExpanded: true,
      decoration: const InputDecoration(labelText: '导游'),
      items: [
        const DropdownMenuItem(value: '', child: Text('未选择')),
        for (final item in items)
          DropdownMenuItem(
            value: item.key,
            child: Text(item.value, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (value) {
        setState(() {
          _selectedGuideId = value ?? '';
          _guideTouched = true;
          final guide = _guideById(_selectedGuideId);
          if (guide != null) {
            _travelAgencyController.text = guide.travelAgency;
          }
        });
      },
    );
  }

  Widget _tasterDropdown() {
    final items = _tasterItems();
    final values = items.map((item) => item.key).toSet();
    final safeValue =
        values.contains(_selectedTasterId) ? _selectedTasterId : '';
    return DropdownButtonFormField<String>(
      initialValue: safeValue,
      isExpanded: true,
      decoration: const InputDecoration(labelText: '品鉴师'),
      items: [
        const DropdownMenuItem(value: '', child: Text('未选择')),
        for (final item in items)
          DropdownMenuItem(
            value: item.key,
            child: Text(item.value, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (value) {
        setState(() {
          _selectedTasterId = value ?? '';
          _tasterTouched = true;
        });
      },
    );
  }

  Widget _groupTypeDropdown() {
    final options = [
      for (final type in groupTypes) type,
      if (_groupType != null && !groupTypes.contains(_groupType)) _groupType!,
    ];
    final value =
        _groupType != null && options.contains(_groupType) ? _groupType : null;
    return DropdownButtonFormField<String>(
      initialValue: value,
      isExpanded: true,
      decoration: const InputDecoration(labelText: '团型'),
      items: [
        for (final type in options)
          DropdownMenuItem(value: type, child: Text(type)),
      ],
      onChanged: (value) => setState(() => _groupType = value),
    );
  }

  Widget _statusDropdown() {
    return DropdownButtonFormField<String>(
      initialValue: _status,
      isExpanded: true,
      decoration: const InputDecoration(labelText: '状态'),
      items: const [
        DropdownMenuItem(value: 'unmarked', child: Text('未出单')),
        DropdownMenuItem(value: 'pending_summary', child: Text('待总结')),
        DropdownMenuItem(value: 'ordered', child: Text('已出单')),
      ],
      onChanged: (value) {
        if (value != null) {
          setState(() => _status = value);
        }
      },
    );
  }

  Widget _moneyField(TextEditingController controller, String label) {
    return TextFormField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(
        decimal: true,
        signed: true,
      ),
      decoration: InputDecoration(labelText: label),
      validator: _moneyValidator,
    );
  }

  Widget _intField(TextEditingController controller, String label) {
    return TextFormField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(signed: true),
      decoration: InputDecoration(labelText: label),
      validator: _integerValidator,
    );
  }

  Future<void> _pickVisitDate() async {
    final result = await showDatePicker(
      context: context,
      initialDate: _visitDate,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
    );
    if (result != null) {
      setState(() => _visitDate = result);
    }
  }

  List<MapEntry<String, String>> _guideItems() {
    final items = <String, String>{};
    if ((widget.group.guideId ?? '').isNotEmpty) {
      items[widget.group.guideId!] =
          '${_display(widget.group.guideName)} · ${_display(widget.group.guidePhone)}';
    }
    for (final guide in widget.guides) {
      if (guide.id.trim().isNotEmpty) {
        items[guide.id] =
            '${guide.name} · ${guide.phone} · ${guide.travelAgency}';
      }
    }
    return items.entries.toList();
  }

  List<MapEntry<String, String>> _tasterItems() {
    final items = <String, String>{};
    if ((widget.group.tasterId ?? '').isNotEmpty) {
      items[widget.group.tasterId!] = _display(widget.group.tasterName);
    }
    for (final taster in widget.tasters) {
      if (taster.id.trim().isNotEmpty) {
        items[taster.id] = _tasterLabel(taster);
      }
    }
    return items.entries.toList();
  }

  GuideRecord? _guideById(String id) {
    for (final guide in widget.guides) {
      if (guide.id == id) {
        return guide;
      }
    }
    return null;
  }
}

class _DialogSection extends StatelessWidget {
  const _DialogSection({
    required this.title,
    required this.child,
  });

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              title,
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 10),
            child,
          ],
        ),
      ),
    );
  }
}

class _DialogNotice extends StatelessWidget {
  const _DialogNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return StatusTag(label: message, tone: StatusTone.danger);
  }
}

class _EditDateField extends StatelessWidget {
  const _EditDateField({
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

String? _optionalFilter(String value) {
  return value == _allFilter ? null : value;
}

String _display(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? '-' : text;
}

String _tasterLabel(TasterOption taster) {
  if (taster.username.trim().isEmpty) {
    return taster.name;
  }
  return '${taster.name} · ${taster.username}';
}

String? _nonEmpty(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? null : text;
}

int _intFromText(String value) {
  return int.tryParse(value.trim()) ?? 0;
}

String _moneyText(int cents) {
  final sign = cents < 0 ? '-' : '';
  final absolute = cents.abs();
  final yuan = absolute ~/ 100;
  final fraction = absolute % 100;
  if (fraction == 0) {
    return '$sign$yuan';
  }
  return '$sign$yuan.${fraction.toString().padLeft(2, '0')}';
}

int _centsFromMoneyText(String value) {
  final text = value.trim().replaceAll(',', '');
  if (text.isEmpty) {
    return 0;
  }
  final negative = text.startsWith('-');
  final normalized = negative ? text.substring(1) : text;
  final parts = normalized.split('.');
  final yuanText = parts.first.isEmpty ? '0' : parts.first;
  final yuan = int.tryParse(yuanText) ?? 0;
  final fractionText = parts.length > 1 ? parts[1] : '';
  final centsText = fractionText.padRight(2, '0').substring(0, 2);
  final cents = yuan * 100 + (int.tryParse(centsText) ?? 0);
  return negative ? -cents : cents;
}

List<TastingItemDraft> _tastingDraftsFromGroup(TravelGroupRecord group) {
  return [
    for (final item in group.tastingItems)
      TastingItemDraft(
        productName: item.productName,
        quantity: item.quantity,
        unit: item.unit,
        note: item.note,
      ),
  ];
}

List<Map<String, dynamic>> _tastingPayloadFromGroup(TravelGroupRecord group) {
  return [
    for (var index = 0; index < group.tastingItems.length; index += 1)
      {
        'productName': group.tastingItems[index].productName,
        'quantity': group.tastingItems[index].quantity,
        'unit': group.tastingItems[index].unit,
        'note': group.tastingItems[index].note,
        'sortOrder': index + 1,
      },
  ];
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

String? _integerValidator(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) {
    return null;
  }
  if (int.tryParse(text) == null) {
    return '请输入整数';
  }
  return null;
}

String? _moneyValidator(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) {
    return null;
  }
  if (!RegExp(r'^-?\d+(\.\d{1,2})?$').hasMatch(text)) {
    return '请输入有效金额';
  }
  return null;
}

bool _canEdit(UserRole role) {
  return role == UserRole.admin ||
      role == UserRole.frontDesk ||
      role == UserRole.sales ||
      role == UserRole.taster ||
      role == UserRole.finance;
}

bool _canMark(UserRole role) {
  return role == UserRole.admin || role == UserRole.finance;
}

bool _canSubmitSummary(UserRole role) {
  return role == UserRole.admin || role == UserRole.taster;
}

String _groupStatusLabel(String status) {
  switch (status) {
    case 'ordered':
      return '已出单';
    case 'pending_summary':
      return '待总结';
    case 'unmarked':
    default:
      return '未出单';
  }
}

StatusTone _groupStatusTone(String status) {
  switch (status) {
    case 'ordered':
      return StatusTone.success;
    case 'pending_summary':
      return StatusTone.info;
    case 'unmarked':
    default:
      return StatusTone.neutral;
  }
}

String _pendingStatusLabel(String? status) {
  switch (status) {
    case 'pending_front_desk':
      return '待前台';
    case 'pending_taster':
      return '待品鉴师';
    case 'pending_finance':
      return '待财务';
    case 'abnormal':
      return '异常';
    default:
      return '无待处理';
  }
}

StatusTone _pendingStatusTone(String? status) {
  switch (status) {
    case 'abnormal':
      return StatusTone.danger;
    case 'pending_front_desk':
    case 'pending_finance':
      return StatusTone.warning;
    case 'pending_taster':
      return StatusTone.info;
    default:
      return StatusTone.success;
  }
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '旅行团加载失败，请稍后重试。';
}

String _messageForSaveError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '旅行团保存失败，请稍后重试。';
}
