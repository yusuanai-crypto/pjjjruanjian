import 'dart:io';

import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

typedef DailyLossProfitFileSaver = Future<String> Function(
  DownloadedFile downloadedFile,
);

const _defaultPreset = 'today';
const _customPreset = 'custom';
const _pageSize = 50;
const _presetOptions = <_DailyLossPreset>[
  _DailyLossPreset('今日', 'today'),
  _DailyLossPreset('昨日', 'yesterday'),
  _DailyLossPreset('近10天', 'last_10_days'),
  _DailyLossPreset('本月', 'this_month'),
];

class DailyLossProfitPanel extends StatefulWidget {
  const DailyLossProfitPanel({
    super.key,
    required this.apiClient,
    required this.token,
    this.fileSaver,
  });

  final ApiClient apiClient;
  final String token;
  final DailyLossProfitFileSaver? fileSaver;

  @override
  State<DailyLossProfitPanel> createState() => _DailyLossProfitPanelState();
}

class _DailyLossProfitPanelState extends State<DailyLossProfitPanel> {
  String _preset = _defaultPreset;
  late DateTime _dateFrom;
  late DateTime _dateTo;
  int _page = 1;
  DailyLossProfitResponse? _response;
  bool _loading = false;
  bool _exporting = false;
  String? _errorMessage;
  int _requestSerial = 0;

  @override
  void initState() {
    super.initState();
    final today = _dateOnly(DateTime.now());
    _dateFrom = today;
    _dateTo = today;
    _loading = true;
    _load(markLoading: false);
  }

  @override
  void didUpdateWidget(covariant DailyLossProfitPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient == widget.apiClient &&
        oldWidget.token == widget.token) {
      return;
    }
    _requestSerial += 1;
    _page = 1;
    _load();
  }

  @override
  void dispose() {
    _requestSerial += 1;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final response = _response;
    return Column(
      key: const ValueKey('daily-loss-profit-panel'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _buildToolbar(),
        if (_loading && response != null)
          const LinearProgressIndicator(
            key: ValueKey('daily-loss-profit-refreshing'),
          ),
        if (_loading && response == null)
          const _DailyLossStateCard(
            key: ValueKey('daily-loss-profit-loading'),
            icon: Icons.hourglass_top_rounded,
            title: '正在加载每日损耗利润',
            message: '正在按日期、商品、品鉴馆号和操作员汇总损耗。',
            showProgress: true,
          )
        else if (_errorMessage != null && response == null)
          _DailyLossStateCard(
            key: const ValueKey('daily-loss-profit-error'),
            icon: Icons.error_outline_rounded,
            title: '每日损耗利润加载失败',
            message: _errorMessage!,
            actionLabel: '重试',
            onAction: _load,
          )
        else if (response != null) ...[
          if (_errorMessage != null)
            _DailyLossInlineError(
              message: _errorMessage!,
              onRetry: _load,
            ),
          _buildMetrics(response.summary),
          if (response.summary.incompleteRowCount > 0)
            _DailyLossIncompleteNotice(summary: response.summary),
          if (response.items.isEmpty)
            const _DailyLossStateCard(
              key: ValueKey('daily-loss-profit-empty'),
              icon: Icons.inbox_outlined,
              title: '暂无每日损耗数据',
              message: '当前日期范围内没有已记录损耗的旅行团。',
            )
          else
            _buildResults(response.items),
          _buildPagination(response.pagination),
        ],
      ],
    );
  }

  Widget _buildToolbar() {
    return Card(
      key: const ValueKey('daily-loss-profit-toolbar'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '每日损耗利润',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                AppDateRangeButton(
                  key: const ValueKey('daily-loss-profit-date-range'),
                  start: _dateFrom,
                  end: _dateTo,
                  onChanged: (range) {
                    setState(() {
                      _preset = _customPreset;
                      _dateFrom = _dateOnly(range.start);
                      _dateTo = _dateOnly(range.end);
                      _page = 1;
                    });
                    _load();
                  },
                ),
                AppFilterBar(
                  filters:
                      _presetOptions.map((option) => option.label).toList(),
                  selected: _presetLabel,
                  onSelected: _applyPreset,
                ),
                OutlinedButton.icon(
                  key: const ValueKey(
                    'daily-loss-profit-refresh-button',
                  ),
                  onPressed: _loading ? null : _load,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('刷新'),
                ),
                FilledButton.icon(
                  key: const ValueKey(
                    'daily-loss-profit-export-button',
                  ),
                  onPressed: _exporting ? null : _export,
                  icon: _exporting
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                      : const Icon(Icons.download_rounded),
                  label: Text(_exporting ? '导出中' : '导出 Excel'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMetrics(DailyLossProfitSummary summary) {
    final estimated = summary.estimatedProfitLossCents;
    final scheme = Theme.of(context).colorScheme;
    return MetricGrid(
      key: const ValueKey('daily-loss-profit-metrics'),
      metrics: [
        MetricData(
          label: '损耗总数量',
          value: '${summary.totalLossQuantity}',
          icon: Icons.remove_circle_outline_rounded,
        ),
        MetricData(
          label: '预计利润损失',
          value: estimated == null
              ? '${formatMoneyCents(summary.knownEstimatedProfitLossCents)}'
                  '（已知）'
              : formatMoneyCents(estimated),
          icon: Icons.trending_down_rounded,
          accent: summary.totalLossQuantity > 0 ? scheme.error : null,
        ),
        MetricData(
          label: '可核算数量',
          value: '${summary.calculableLossQuantity}',
          icon: Icons.check_circle_outline_rounded,
        ),
        MetricData(
          label: '未核算数量',
          value: '${summary.unpricedLossQuantity}',
          icon: Icons.warning_amber_rounded,
          accent: summary.unpricedLossQuantity > 0 ? scheme.error : null,
        ),
      ],
    );
  }

  Widget _buildResults(List<DailyLossProfitRecord> items) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 920) {
          return _buildDesktopTable(items);
        }
        return _buildNarrowCards(items);
      },
    );
  }

  Widget _buildDesktopTable(List<DailyLossProfitRecord> items) {
    return Card(
      key: const ValueKey('daily-loss-profit-table-card'),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          key: const ValueKey('daily-loss-profit-table'),
          columns: const [
            DataColumn(label: Text('日期')),
            DataColumn(label: Text('商品')),
            DataColumn(label: Text('品鉴馆号')),
            DataColumn(label: Text('操作员')),
            DataColumn(label: Text('损耗数量'), numeric: true),
            DataColumn(label: Text('单位')),
            DataColumn(label: Text('预计利润损失'), numeric: true),
            DataColumn(label: Text('核算状态')),
          ],
          rows: [
            for (var index = 0; index < items.length; index += 1)
              DataRow(
                key: ValueKey('daily-loss-profit-row-$index'),
                cells: [
                  DataCell(Text(_display(items[index].date))),
                  DataCell(Text(_display(items[index].productName))),
                  DataCell(Text(_display(items[index].tastingRoomNo))),
                  DataCell(Text(_display(items[index].operatorName))),
                  DataCell(Text('${items[index].lossQuantity}')),
                  DataCell(Text(_display(items[index].unit))),
                  DataCell(
                    Text(
                      _lossMoneyLabel(
                        items[index].estimatedProfitLossCents,
                      ),
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  DataCell(_CoverageStatus(item: items[index])),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildNarrowCards(List<DailyLossProfitRecord> items) {
    return Column(
      key: const ValueKey('daily-loss-profit-card-list'),
      children: [
        for (var index = 0; index < items.length; index += 1) ...[
          Card(
            key: ValueKey('daily-loss-profit-card-$index'),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _display(items[index].productName),
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(
                                    fontWeight: FontWeight.w800,
                                  ),
                            ),
                            const SizedBox(height: 3),
                            Text(_display(items[index].date)),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      _CoverageStatus(item: items[index]),
                    ],
                  ),
                  const Divider(height: 22),
                  Wrap(
                    spacing: 18,
                    runSpacing: 10,
                    children: [
                      _DailyLossLabeledValue(
                        label: '品鉴馆号',
                        value: _display(items[index].tastingRoomNo),
                      ),
                      _DailyLossLabeledValue(
                        label: '操作员',
                        value: _display(items[index].operatorName),
                      ),
                      _DailyLossLabeledValue(
                        label: '损耗数量',
                        value: '${items[index].lossQuantity} '
                            '${_display(items[index].unit)}',
                      ),
                      _DailyLossLabeledValue(
                        label: '预计利润损失',
                        value: _lossMoneyLabel(
                          items[index].estimatedProfitLossCents,
                        ),
                        valueColor:
                            items[index].estimatedProfitLossCents == null
                                ? Theme.of(context).colorScheme.onSurfaceVariant
                                : Theme.of(context).colorScheme.error,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }

  Widget _buildPagination(ProfitAnalysisPagination pagination) {
    if (pagination.total == 0) {
      return const SizedBox.shrink();
    }
    return Card(
      key: const ValueKey('daily-loss-profit-pagination'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            Expanded(
              child: Text(
                '共 ${pagination.total} 条汇总 · '
                '第 ${pagination.page}/${pagination.totalPages} 页',
              ),
            ),
            IconButton(
              key: const ValueKey(
                'daily-loss-profit-previous-page',
              ),
              tooltip: '上一页',
              onPressed: _loading || pagination.page <= 1
                  ? null
                  : () {
                      setState(() => _page -= 1);
                      _load();
                    },
              icon: const Icon(Icons.chevron_left_rounded),
            ),
            IconButton(
              key: const ValueKey('daily-loss-profit-next-page'),
              tooltip: '下一页',
              onPressed: _loading || pagination.page >= pagination.totalPages
                  ? null
                  : () {
                      setState(() => _page += 1);
                      _load();
                    },
              icon: const Icon(Icons.chevron_right_rounded),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _load({bool markLoading = true}) async {
    final requestId = ++_requestSerial;
    if (markLoading && mounted) {
      setState(() {
        _loading = true;
        _errorMessage = null;
      });
    } else {
      _errorMessage = null;
    }
    try {
      final response = await BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      ).getDailyLossProfits(
        preset: _preset,
        dateFrom: _dateFrom,
        dateTo: _dateTo,
        page: _page,
        pageSize: _pageSize,
      );
      if (!mounted || requestId != _requestSerial) {
        return;
      }
      setState(() {
        _response = response;
        _loading = false;
        _errorMessage = null;
      });
    } catch (error) {
      if (!mounted || requestId != _requestSerial) {
        return;
      }
      setState(() {
        _loading = false;
        _errorMessage = _friendlyError(error);
      });
    }
  }

  Future<void> _export() async {
    if (_exporting) {
      return;
    }
    setState(() {
      _exporting = true;
      _errorMessage = null;
    });
    try {
      final downloadedFile = await BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      ).exportDailyLossProfits(
        preset: _preset,
        dateFrom: _dateFrom,
        dateTo: _dateTo,
      );
      final savedPath = await (widget.fileSaver?.call(downloadedFile) ??
          _saveExportFile(downloadedFile));
      if (!mounted) {
        return;
      }
      setState(() => _exporting = false);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(content: Text('每日损耗利润已导出：$savedPath')),
        );
    } catch (error) {
      if (!mounted) {
        return;
      }
      final message = _friendlyError(error);
      setState(() {
        _exporting = false;
        _errorMessage = message;
      });
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(message)));
    }
  }

  void _applyPreset(String label) {
    final option = _presetOptions.firstWhere(
      (item) => item.label == label,
    );
    final range = _rangeForPreset(option.value, DateTime.now());
    setState(() {
      _preset = option.value;
      _dateFrom = range.start;
      _dateTo = range.end;
      _page = 1;
    });
    _load();
  }

  String get _presetLabel {
    for (final option in _presetOptions) {
      if (option.value == _preset) {
        return option.label;
      }
    }
    return '';
  }
}

class _CoverageStatus extends StatelessWidget {
  const _CoverageStatus({required this.item});

  final DailyLossProfitRecord item;

  @override
  Widget build(BuildContext context) {
    final available = item.costCoverageStatus == 'available';
    return StatusTag(
      label: available ? '已核算' : '成本未配置',
      tone: available ? StatusTone.success : StatusTone.danger,
    );
  }
}

class _DailyLossIncompleteNotice extends StatelessWidget {
  const _DailyLossIncompleteNotice({required this.summary});

  final DailyLossProfitSummary summary;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      key: const ValueKey('daily-loss-profit-incomplete-warning'),
      color: scheme.errorContainer.withValues(alpha: 0.45),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.warning_amber_rounded, color: scheme.error),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                '有 ${summary.incompleteRowCount} 条汇总缺少成本，'
                '共 ${summary.unpricedLossQuantity} 件/瓶未核算。'
                '当前预计利润损失仅包含已知金额 '
                '${formatMoneyCents(summary.knownEstimatedProfitLossCents)}。',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DailyLossLabeledValue extends StatelessWidget {
  const _DailyLossLabeledValue({
    required this.label,
    required this.value,
    this.valueColor,
  });

  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 145,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              color: valueColor,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _DailyLossStateCard extends StatelessWidget {
  const _DailyLossStateCard({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.showProgress = false,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final bool showProgress;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Icon(icon, size: 38),
            const SizedBox(height: 10),
            Text(
              title,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w800),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(message, textAlign: TextAlign.center),
            if (showProgress) ...[
              const SizedBox(height: 14),
              const CircularProgressIndicator(),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 14),
              FilledButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}

class _DailyLossInlineError extends StatelessWidget {
  const _DailyLossInlineError({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const Icon(Icons.error_outline_rounded),
            const SizedBox(width: 10),
            Expanded(child: Text(message)),
            TextButton(onPressed: onRetry, child: const Text('重试')),
          ],
        ),
      ),
    );
  }
}

class _DailyLossPreset {
  const _DailyLossPreset(this.label, this.value);

  final String label;
  final String value;
}

Future<String> _saveExportFile(DownloadedFile downloadedFile) async {
  final directory = await getApplicationDocumentsDirectory();
  final exportDirectory = Directory(
    '${directory.path}${Platform.pathSeparator}exports',
  );
  await exportDirectory.create(recursive: true);
  final target = await _nextExportFile(
    exportDirectory,
    _safeExportFileName(downloadedFile.fileName),
  );
  await target.writeAsBytes(downloadedFile.bytes, flush: true);
  return target.path;
}

String _safeExportFileName(String? value) {
  final source = (value ?? '').trim();
  final sanitized =
      source.replaceAll(RegExp(r'[<>:"/\\|?*\x00-\x1F]'), '_').trim();
  if (sanitized.isEmpty) {
    return 'daily-loss-profit.xlsx';
  }
  return sanitized.toLowerCase().endsWith('.xlsx')
      ? sanitized
      : '$sanitized.xlsx';
}

Future<File> _nextExportFile(
  Directory directory,
  String fileName,
) async {
  var candidate = File(
    '${directory.path}${Platform.pathSeparator}$fileName',
  );
  if (!await candidate.exists()) {
    return candidate;
  }
  final dot = fileName.lastIndexOf('.');
  final stem = dot > 0 ? fileName.substring(0, dot) : fileName;
  final extension = dot > 0 ? fileName.substring(dot) : '';
  for (var suffix = 2;; suffix += 1) {
    candidate = File(
      '${directory.path}${Platform.pathSeparator}'
      '$stem-$suffix$extension',
    );
    if (!await candidate.exists()) {
      return candidate;
    }
  }
}

DateTimeRange _rangeForPreset(String preset, DateTime now) {
  final today = _dateOnly(now);
  switch (preset) {
    case 'yesterday':
      final yesterday = today.subtract(const Duration(days: 1));
      return DateTimeRange(start: yesterday, end: yesterday);
    case 'last_10_days':
      return DateTimeRange(
        start: today.subtract(const Duration(days: 9)),
        end: today,
      );
    case 'this_month':
      return DateTimeRange(
        start: DateTime(today.year, today.month),
        end: today,
      );
    case 'today':
    default:
      return DateTimeRange(start: today, end: today);
  }
}

DateTime _dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

String _lossMoneyLabel(int? cents) =>
    cents == null ? '—' : formatMoneyCents(cents);

String _display(String value) => value.trim().isEmpty ? '—' : value.trim();

String _friendlyError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '请求失败，请稍后重试。';
}
