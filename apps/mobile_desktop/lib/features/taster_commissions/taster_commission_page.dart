import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

class TasterCommissionPage extends StatefulWidget {
  const TasterCommissionPage({
    super.key,
    required this.apiClient,
    required this.token,
  });

  final ApiClient apiClient;
  final String token;

  @override
  State<TasterCommissionPage> createState() => _TasterCommissionPageState();
}

class _TasterCommissionPageState extends State<TasterCommissionPage> {
  late BusinessApi _businessApi;
  DateTime _start = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _end = DateTime.now();
  bool _loading = true;
  String? _errorMessage;
  List<CommissionRecord> _records = const <CommissionRecord>[];

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _loadRecords();
  }

  @override
  void didUpdateWidget(covariant TasterCommissionPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadRecords();
    }
  }

  Future<void> _loadRecords() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final records = await _businessApi.listMyCommissionRecords(
        start: _start,
        end: _end,
        limit: 50,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _records = records;
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
    return ResponsivePage(
      children: [
        FormSection(
          title: '我的提成筛选',
          trailing: StatusTag(
            label: _loading ? '加载中' : '${_records.length} 条',
            tone: _loading ? StatusTone.warning : StatusTone.info,
          ),
          children: [
            Wrap(
              spacing: 12,
              runSpacing: 12,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                AppDateRangeButton(
                  key: const ValueKey('taster-commission-date-range'),
                  start: _start,
                  end: _end,
                  onChanged: (range) {
                    setState(() {
                      _start = range.start;
                      _end = range.end;
                    });
                    _loadRecords();
                  },
                ),
                FilledButton.icon(
                  key: const ValueKey('taster-commission-refresh-button'),
                  onPressed: _loading ? null : _loadRecords,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('刷新'),
                ),
              ],
            ),
          ],
        ),
        FormSection(
          title: '我的提成明细',
          children: [
            if (_errorMessage != null) ...[
              _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
              const SizedBox(height: 12),
            ],
            if (_loading && _records.isEmpty)
              const _SectionState(message: '正在加载本人提成', loading: true)
            else if (_records.isEmpty)
              const _SectionState(message: '当前日期范围暂无本人提成记录')
            else
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: DataTable(
                  columns: const [
                    DataColumn(label: Text('旅行团')),
                    DataColumn(label: Text('订单')),
                    DataColumn(label: Text('提成金额')),
                    DataColumn(label: Text('确认状态')),
                    DataColumn(label: Text('确认人')),
                    DataColumn(label: Text('确认时间')),
                  ],
                  rows: [
                    for (final record in _records)
                      DataRow(
                        cells: [
                          DataCell(Text(_travelGroupLabel(record))),
                          DataCell(Text(_salesOrderLabel(record))),
                          DataCell(Text(formatMoneyCents(record.amountCents))),
                          DataCell(_confirmationTag(record)),
                          DataCell(Text(_userName(record.confirmedBy))),
                          DataCell(Text(_dateTimeLabel(record.confirmedAt))),
                        ],
                      ),
                  ],
                ),
              ),
          ],
        ),
      ],
    );
  }
}

Widget _confirmationTag(CommissionRecord record) {
  return StatusTag(
    label: record.isConfirmed ? '已确认' : '待确认',
    tone: record.isConfirmed ? StatusTone.success : StatusTone.warning,
  );
}

String _travelGroupLabel(CommissionRecord record) {
  return _fieldValue(record.travelGroup?.groupNo ?? record.travelGroupId);
}

String _salesOrderLabel(CommissionRecord record) {
  return _fieldValue(record.salesOrderNo ?? record.salesOrder?.orderNo);
}

String _userName(Stage7UserSummaryRecord? user) {
  return _fieldValue(user?.name ?? user?.username ?? user?.id);
}

String _fieldValue(String? value) {
  final normalized = value?.trim();
  if (normalized == null || normalized.isEmpty) {
    return '-';
  }
  return normalized;
}

String _dateTimeLabel(String? value) {
  final text = value?.trim();
  if (text == null || text.isEmpty) {
    return '-';
  }
  return text.replaceFirst('T', ' ').replaceFirst(RegExp(r'\.\d{3}Z$'), '');
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '加载本人提成失败，请稍后重试。';
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 28),
        child: loading
            ? Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(),
                  const SizedBox(height: 12),
                  Text(message),
                ],
              )
            : Text(
                message,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
      ),
    );
  }
}
