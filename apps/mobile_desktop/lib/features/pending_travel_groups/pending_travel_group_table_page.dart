import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import '../travel_group_detail/travel_group_detail_panel.dart';

const _allFilter = '全部';

const _pendingStatusLabels = <String, String>{
  'pending_front_desk': '待前台',
  'pending_sales': '待销售',
  'pending_taster': '待品鉴师',
  'pending_finance': '待财务',
  'abnormal': '异常',
};

class PendingTravelGroupTablePage extends StatefulWidget {
  const PendingTravelGroupTablePage({
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
  State<PendingTravelGroupTablePage> createState() =>
      _PendingTravelGroupTablePageState();
}

class _PendingTravelGroupTablePageState
    extends State<PendingTravelGroupTablePage> {
  late BusinessApi _businessApi;
  late final TextEditingController _searchController;

  DateTime _start = DateTime.now().subtract(const Duration(days: 30));
  DateTime _end = DateTime.now();
  String _statusFilter = _allFilter;
  String _query = '';
  String? _selectedId;
  bool _loading = true;
  String? _errorMessage;
  List<TravelGroupRecord> _groups = const <TravelGroupRecord>[];

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _searchController = TextEditingController();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant PendingTravelGroupTablePage oldWidget) {
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
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final groups = await _businessApi.listPendingTravelGroups(
        limit: 200,
        start: _start,
        end: _end,
        keyword: _query,
        pendingStatus: _pendingStatusValue(_statusFilter),
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = groups;
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
      for (final record in _groups) {
        if (record.id == _selectedId) {
          return record;
        }
      }
    }
    return _groups.first;
  }

  void _selectRecord(TravelGroupRecord record) {
    setState(() => _selectedId = record.id);
  }

  void _openHandlingEntry(TravelGroupRecord record) {
    _selectRecord(record);
    widget.onOpenDestination(_destinationFor(record.pendingStatus));
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selectedRecord();

    return ResponsivePage(
      children: [
        FormSection(
          title: '待处理旅行团',
          trailing:
              StatusTag(label: '${_groups.length} 个团', tone: StatusTone.info),
          children: [
            ResponsiveFormGrid(
              children: [
                AppSearchField(
                  controller: _searchController,
                  hintText: '搜索团号、旅行社、导游、品鉴师',
                  onChanged: (value) => _query = value,
                ),
                AppDateRangeButton(
                  start: _start,
                  end: _end,
                  onChanged: (range) {
                    setState(() {
                      _start = range.start;
                      _end = range.end;
                    });
                    _loadData();
                  },
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
                  onPressed: _loadData,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('刷新'),
                ),
                FilledButton.icon(
                  onPressed: () {
                    setState(() => _query = _searchController.text.trim());
                    _loadData();
                  },
                  icon: const Icon(Icons.search_rounded),
                  label: const Text('查询'),
                ),
              ],
            ),
          ],
        ),
        if (_loading)
          const LoadingState(title: '正在加载待处理旅行团')
        else if (_errorMessage != null)
          ErrorState(title: _errorMessage!, onRetry: _loadData)
        else ...[
          MetricGrid(
            metrics: [
              MetricData(
                label: '待处理团数',
                value: '${_groups.length}',
                icon: Icons.pending_actions_rounded,
              ),
              MetricData(
                label: '待前台',
                value:
                    '${_groups.where((group) => group.pendingStatus == 'pending_front_desk').length}',
                icon: Icons.assignment_ind_rounded,
              ),
              MetricData(
                label: '待销售',
                value:
                    '${_groups.where((group) => group.pendingStatus == 'pending_sales').length}',
                icon: Icons.point_of_sale_rounded,
              ),
              MetricData(
                label: '待品鉴师',
                value:
                    '${_groups.where((group) => group.pendingStatus == 'pending_taster').length}',
                icon: Icons.rate_review_rounded,
              ),
              MetricData(
                label: '待财务',
                value:
                    '${_groups.where((group) => group.pendingStatus == 'pending_finance').length}',
                icon: Icons.bookmark_add_rounded,
              ),
            ],
          ),
          ResponsiveTwoColumn(
            primary: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AppFilterBar(
                  filters: const [
                    _allFilter,
                    '待前台',
                    '待销售',
                    '待品鉴师',
                    '待财务',
                    '异常',
                  ],
                  selected: _statusFilter,
                  onSelected: (value) {
                    setState(() => _statusFilter = value);
                    _loadData();
                  },
                ),
                const SizedBox(height: 12),
                if (_groups.isEmpty)
                  const EmptyState(title: '没有匹配的待处理旅行团')
                else
                  _PendingGroupList(
                    groups: _groups,
                    selectedId: _selectedId,
                    showFinanceMark: canViewFinanceMark(widget.role),
                    onSelect: _selectRecord,
                    onOpen: _openHandlingEntry,
                  ),
              ],
            ),
            secondary: selected == null
                ? const EmptyState(title: '请选择待处理旅行团')
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _HandlingEntryCard(
                        record: selected,
                        showFinanceMark: canViewFinanceMark(widget.role),
                        onOpen: () => _openHandlingEntry(selected),
                      ),
                      const SizedBox(height: 12),
                      TravelGroupDetailPanel(
                        group: selected,
                        role: widget.role,
                        onEdit: _canEdit(widget.role)
                            ? () => _openHandlingEntry(selected)
                            : null,
                        onSummary: _canSubmitSummary(widget.role)
                            ? () => _openHandlingEntry(selected)
                            : null,
                        onFinanceMark: _canMark(widget.role)
                            ? () => _openHandlingEntry(selected)
                            : null,
                      ),
                    ],
                  ),
          ),
        ],
      ],
    );
  }
}

class _PendingGroupList extends StatelessWidget {
  const _PendingGroupList({
    required this.groups,
    required this.selectedId,
    required this.showFinanceMark,
    required this.onSelect,
    required this.onOpen,
  });

  final List<TravelGroupRecord> groups;
  final String? selectedId;
  final bool showFinanceMark;
  final ValueChanged<TravelGroupRecord> onSelect;
  final ValueChanged<TravelGroupRecord> onOpen;

  @override
  Widget build(BuildContext context) {
    return AppRecordList(
      items: [
        for (final record in groups)
          AppRecordItem(
            title: record.groupNo,
            subtitle:
                '${_display(record.travelAgency)} · ${_display(record.guideName)} · ${record.guestCount > 0 ? '${record.guestCount} 人' : '人数未填写'}',
            meta: [
              if (record.visitDate.isNotEmpty) record.visitDate,
              if (_display(record.tasterName) != '-')
                _display(record.tasterName),
              if (record.pendingReasons.isNotEmpty)
                _pendingReasonsText(
                  record.pendingReasons,
                  showFinanceMark: showFinanceMark,
                ),
            ],
            icon: selectedId == record.id
                ? Icons.radio_button_checked_rounded
                : Icons.pending_actions_rounded,
            trailing: Wrap(
              spacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                StatusTag(
                  label: _pendingStatusLabel(record.pendingStatus),
                  tone: _pendingStatusTone(record.pendingStatus),
                ),
                IconButton(
                  tooltip: _handlingLabel(
                    record.pendingStatus,
                    showFinanceMark: showFinanceMark,
                  ),
                  onPressed: () => onOpen(record),
                  icon: const Icon(Icons.open_in_new_rounded),
                ),
              ],
            ),
            onTap: () => onSelect(record),
          ),
      ],
    );
  }
}

class _HandlingEntryCard extends StatelessWidget {
  const _HandlingEntryCard({
    required this.record,
    required this.showFinanceMark,
    required this.onOpen,
  });

  final TravelGroupRecord record;
  final bool showFinanceMark;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      title: '处理入口',
      trailing: StatusTag(
        label: _pendingStatusLabel(record.pendingStatus),
        tone: _pendingStatusTone(record.pendingStatus),
      ),
      children: [
        Text(
          _handlingDescription(
            record.pendingStatus,
            showFinanceMark: showFinanceMark,
          ),
        ),
        if (record.pendingReasons.isNotEmpty) ...[
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final reason in record.pendingReasons)
                StatusTag(
                  label: _pendingReasonLabel(
                    reason,
                    showFinanceMark: showFinanceMark,
                  ),
                  tone: StatusTone.info,
                ),
            ],
          ),
        ],
        const SizedBox(height: 14),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton.icon(
            onPressed: onOpen,
            icon: const Icon(Icons.open_in_new_rounded),
            label: Text(
              _handlingLabel(
                record.pendingStatus,
                showFinanceMark: showFinanceMark,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

String? _pendingStatusValue(String label) {
  if (label == _allFilter) {
    return null;
  }
  for (final entry in _pendingStatusLabels.entries) {
    if (entry.value == label) {
      return entry.key;
    }
  }
  return null;
}

String _pendingStatusLabel(String? status) {
  return _pendingStatusLabels[status] ?? '无待处理';
}

StatusTone _pendingStatusTone(String? status) {
  switch (status) {
    case 'abnormal':
      return StatusTone.danger;
    case 'pending_front_desk':
    case 'pending_finance':
      return StatusTone.warning;
    case 'pending_sales':
      return StatusTone.info;
    case 'pending_taster':
      return StatusTone.info;
    default:
      return StatusTone.success;
  }
}

String _pendingReasonsText(
  List<String> reasons, {
  bool showFinanceMark = true,
}) {
  return reasons
      .map((reason) => _pendingReasonLabel(
            reason,
            showFinanceMark: showFinanceMark,
          ))
      .join('、');
}

String _pendingReasonLabel(String reason, {bool showFinanceMark = true}) {
  switch (reason) {
    case 'missing_taster':
      return '缺少品鉴师';
    case 'missing_license_plate':
      return '缺少车牌号';
    case 'missing_guide_name':
      return '缺少导游姓名';
    case 'missing_guide_phone':
      return '缺少导游手机号';
    case 'missing_travel_agency':
      return '缺少旅行社';
    case 'missing_cigarette_fee':
      return '缺少香烟费用';
    case 'missing_guest_count':
      return '缺少人数';
    case 'missing_tasting_room_no':
      return '缺少品鉴馆号';
    case 'missing_arrival_time':
      return '缺少进店时间';
    case 'missing_group_type':
      return '缺少团型';
    case 'missing_departure_time':
      return '缺少离店时间';
    case 'loss_not_confirmed':
      return '损耗尚未确认';
    case 'invalid_guest_count_zero':
      return '人数为 0';
    case 'no_order_and_missing_taster_summary':
      return '无订单且未总结';
    case 'finance_unmarked_after_day_end':
      return showFinanceMark ? '超过当日未标记' : '超过当日待处理';
    case 'duplicate_group_no':
      return '团号重复';
    case 'departure_before_arrival':
      return '离店早于进店';
    default:
      return reason;
  }
}

String _handlingLabel(String? status, {bool showFinanceMark = true}) {
  switch (status) {
    case 'pending_front_desk':
      return '基础信息编辑';
    case 'pending_sales':
      return '补录损耗与离店';
    case 'pending_taster':
      return '填写总结';
    case 'pending_finance':
      return showFinanceMark ? '财务标记' : '查看详情';
    case 'abnormal':
    default:
      return '查看详情';
  }
}

String _handlingDescription(String? status, {bool showFinanceMark = true}) {
  switch (status) {
    case 'pending_front_desk':
      return '可分次补齐车牌号、人数、香烟费用、品鉴馆号、品鉴师、进店时间和团型。';
    case 'pending_sales':
      return '补录离店时间，并记录损耗明细或确认无损耗。';
    case 'pending_taster':
      return '进入品鉴师总结表单，补充本团接待总结。';
    case 'pending_finance':
      return showFinanceMark ? '进入旅行团详情，完成财务标记。' : '进入旅行团详情查看待处理信息。';
    case 'abnormal':
    default:
      return '进入旅行团详情查看异常原因。';
  }
}

String _destinationFor(String? status) {
  switch (status) {
    case 'pending_sales':
      return 'travel_group_order_notes';
    case 'pending_taster':
      return 'taster_summary';
    case 'pending_front_desk':
    case 'pending_finance':
    case 'abnormal':
    default:
      return 'travel_group_query';
  }
}

String _display(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? '-' : text;
}

bool _canEdit(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.frontDesk ||
      role == UserRole.sales ||
      role == UserRole.taster ||
      role == UserRole.finance;
}

bool _canMark(UserRole role) {
  return canViewFinanceMark(role);
}

bool _canSubmitSummary(UserRole role) {
  return role == UserRole.superAdmin ||
      role == UserRole.admin ||
      role == UserRole.taster;
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '待处理旅行团加载失败，请稍后重试。';
}
