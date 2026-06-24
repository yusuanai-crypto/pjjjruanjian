import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';

class PendingTravelGroupTablePage extends StatefulWidget {
  const PendingTravelGroupTablePage({
    super.key,
    required this.apiClient,
    required this.token,
  });

  final ApiClient apiClient;
  final String token;

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
  String _statusFilter = '全部';
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

  List<TravelGroupRecord> get _visibleGroups {
    final query = _query.trim().toLowerCase();
    return _groups.where((group) {
      if (_statusFilter != '全部' &&
          _statusLabel(group.status) != _statusFilter) {
        return false;
      }
      if (query.isEmpty) {
        return true;
      }
      return [
        group.groupNo,
        group.travelAgency,
        group.guideName,
        group.guidePhone,
        group.tasterName,
        group.tastingRoomNo,
        group.groupType,
        group.remarks,
      ].whereType<String>().any((value) => value.toLowerCase().contains(query));
    }).toList();
  }

  TravelGroupRecord? _selectedRecord(List<TravelGroupRecord> records) {
    if (records.isEmpty) {
      return null;
    }
    if (_selectedId != null) {
      for (final record in records) {
        if (record.id == _selectedId) {
          return record;
        }
      }
    }
    return records.first;
  }

  @override
  Widget build(BuildContext context) {
    final records = _visibleGroups;
    final selected = _selectedRecord(records);

    return ResponsivePage(
      children: [
        FormSection(
          title: '待处理旅行团筛选',
          trailing:
              StatusTag(label: '${records.length} 个团', tone: StatusTone.info),
          children: [
            ResponsiveFormGrid(
              children: [
                AppSearchField(
                  controller: _searchController,
                  hintText: '搜索团号、旅行社、导游、品鉴师',
                  onChanged: (value) => setState(() => _query = value),
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
                value: '${records.length}',
                icon: Icons.pending_actions_rounded,
              ),
              MetricData(
                label: '接待人数',
                value:
                    '${records.fold<int>(0, (sum, item) => sum + item.guestCount)}',
                icon: Icons.groups_rounded,
              ),
              MetricData(
                label: '订单金额',
                value: formatMoneyCents(records.fold<int>(
                    0, (sum, item) => sum + item.orderAmountCents)),
                icon: Icons.receipt_long_rounded,
              ),
              MetricData(
                label: '待收金额',
                value: formatMoneyCents(records.fold<int>(
                    0, (sum, item) => sum + item.cashOnDeliveryCents)),
                icon: Icons.local_atm_rounded,
              ),
            ],
          ),
          ResponsiveTwoColumn(
            primary: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AppFilterBar(
                  filters: const ['全部', '待处理', '待总结', '已出单'],
                  selected: _statusFilter,
                  onSelected: (value) => setState(() => _statusFilter = value),
                ),
                const SizedBox(height: 12),
                if (records.isEmpty)
                  const EmptyState(title: '没有匹配的待处理旅行团')
                else
                  AppRecordList(
                    items: [
                      for (final record in records)
                        AppRecordItem(
                          title: record.groupNo,
                          subtitle:
                              '${_display(record.travelAgency)} · ${_display(record.guideName)} · ${record.guestCount} 人',
                          meta: [
                            if (record.visitDate.isNotEmpty) record.visitDate,
                            if (_display(record.tasterName) != '-') _display(record.tasterName),
                          ],
                          icon: Icons.pending_actions_rounded,
                          trailing: StatusTag(
                            label: _statusLabel(record.status),
                            tone: _statusTone(record.status),
                          ),
                          onTap: () => setState(() => _selectedId = record.id),
                        ),
                    ],
                  ),
              ],
            ),
            secondary: selected == null
                ? const EmptyState(title: '请选择待处理旅行团')
                : _PendingGroupDetail(record: selected),
          ),
        ],
      ],
    );
  }
}

class _PendingGroupDetail extends StatelessWidget {
  const _PendingGroupDetail({required this.record});

  final TravelGroupRecord record;

  @override
  Widget build(BuildContext context) {
    return FormSection(
      title: '待处理明细',
      trailing: StatusTag(
        label: _statusLabel(record.status),
        tone: _statusTone(record.status),
      ),
      children: [
        _InfoRow(label: '团号', value: record.groupNo),
        _InfoRow(label: '日期', value: record.visitDate),
        _InfoRow(label: '旅行社', value: record.travelAgency),
        _InfoRow(label: '导游', value: record.guideName),
        _InfoRow(label: '导游电话', value: record.guidePhone),
        _InfoRow(label: '品鉴师', value: record.tasterName),
        _InfoRow(label: '品鉴馆', value: record.tastingRoomNo),
        _InfoRow(label: '团型', value: record.groupType),
        const Divider(height: 24),
        _InfoRow(label: '人数', value: '${record.guestCount} 人'),
        Row(
          children: [
            const Expanded(child: Text('订单金额')),
            MoneyText(cents: record.orderAmountCents, prominent: true),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            const Expanded(child: Text('货到付款')),
            MoneyText(cents: record.cashOnDeliveryCents, prominent: true),
          ],
        ),
        const Divider(height: 24),
        _InfoRow(label: '进店时间', value: record.arrivalTime),
        _InfoRow(label: '离店时间', value: record.departureTime),
        _InfoRow(label: '备注', value: record.remarks),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
              width: 76,
              child: Text(label, style: Theme.of(context).textTheme.bodySmall)),
          Expanded(
              child: Text(_display(value),
                  style: const TextStyle(fontWeight: FontWeight.w700))),
        ],
      ),
    );
  }
}

String _display(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? '-' : text;
}

String _statusLabel(String status) {
  switch (status) {
    case 'pending_summary':
      return '待总结';
    case 'ordered':
      return '已出单';
    case 'unmarked':
    default:
      return '待处理';
  }
}

StatusTone _statusTone(String status) {
  switch (status) {
    case 'pending_summary':
      return StatusTone.info;
    case 'ordered':
      return StatusTone.success;
    case 'unmarked':
    default:
      return StatusTone.warning;
  }
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '待处理旅行团加载失败，请稍后重试。';
}
