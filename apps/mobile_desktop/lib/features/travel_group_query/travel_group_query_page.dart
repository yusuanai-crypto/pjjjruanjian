import 'package:flutter/material.dart';
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

  void _showEditHint() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('当前查询页已预留编辑入口，字段编辑请在对应录入/补充页面完成。')),
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
                    onEdit: _canEdit(widget.role) ? _showEditHint : null,
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
