import 'dart:io';

import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';

const _defaultPreset = 'this_month';
const _customPreset = 'custom';

const _presetOptions = <_PresetOption>[
  _PresetOption(label: '本年', value: 'this_year'),
  _PresetOption(label: '本月', value: 'this_month'),
  _PresetOption(label: '上个月', value: 'last_month'),
  _PresetOption(label: '近 10 天', value: 'last_10_days'),
  _PresetOption(label: '昨日', value: 'yesterday'),
  _PresetOption(label: '今日', value: 'today'),
];

const _rankingLimit = 50;

const _rankingSortOptions = <_RankingSortOption>[
  _RankingSortOption(label: '净销售额', sortBy: 'netSalesAmountCents'),
  _RankingSortOption(label: '接待团数', sortBy: 'totalGroupCount'),
  _RankingSortOption(label: '接待人数', sortBy: 'totalGuestCount'),
  _RankingSortOption(label: '团均', sortBy: 'averageSalesPerGroupCents'),
  _RankingSortOption(label: '人均', sortBy: 'averageSalesPerGuestCents'),
  _RankingSortOption(label: '打蛋率', sortBy: 'noOrderRate'),
];

const _salesPerformanceSortOptions = <_RankingSortOption>[
  _RankingSortOption(label: '总销售额', sortBy: 'netSalesAmountCents'),
  _RankingSortOption(label: '出单销售额', sortBy: 'grossSalesAmountCents'),
  _RankingSortOption(label: '退单销售额', sortBy: 'refundAmountCents'),
  _RankingSortOption(label: '出单数', sortBy: 'orderCount'),
  _RankingSortOption(label: '单均销售额', sortBy: 'averageSalesPerOrderCents'),
  _RankingSortOption(label: '销售人员', sortBy: 'salesUserName'),
];

const _trendMetrics = <_TrendMetricOption>[
  _TrendMetricOption(
    label: '销售额趋势',
    metric: 'net_sales',
    icon: Icons.show_chart_rounded,
    accent: Color(0xFF226D68),
  ),
  _TrendMetricOption(
    label: '接待团数趋势',
    metric: 'groups',
    icon: Icons.directions_bus_rounded,
    accent: Color(0xFF7D5A2E),
  ),
  _TrendMetricOption(
    label: '打蛋率趋势',
    metric: 'no_order_rate',
    icon: Icons.pie_chart_rounded,
    accent: Color(0xFF8A5A83),
  ),
];

class AnalyticsPage extends StatefulWidget {
  const AnalyticsPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    this.documentsDirectoryProvider,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final Future<Directory> Function()? documentsDirectoryProvider;

  @override
  State<AnalyticsPage> createState() => _AnalyticsPageState();
}

class _AnalyticsPageState extends State<AnalyticsPage> {
  String _preset = _defaultPreset;
  late DateTime _start;
  late DateTime _end;
  AnalyticsOverview? _overview;
  bool _loading = false;
  String? _errorMessage;
  int _requestSerial = 0;
  List<TasterRankingRecord> _rankings = const [];
  bool _rankingsLoading = false;
  String? _rankingsErrorMessage;
  int _rankingsRequestSerial = 0;
  _RankingSortOption _rankingSort = _rankingSortOptions.first;
  Map<String, List<AnalyticsTrendPoint>> _trends = const {};
  bool _trendsLoading = false;
  String? _trendsErrorMessage;
  int _trendsRequestSerial = 0;
  bool _exportingOverview = false;
  bool _exportingRankings = false;
  List<SalesPerformanceRecord> _salesPerformance = const [];
  bool _salesPerformanceLoading = false;
  String? _salesPerformanceErrorMessage;
  int _salesPerformanceRequestSerial = 0;
  _RankingSortOption _salesPerformanceSort =
      _salesPerformanceSortOptions.first;
  String _salesPerformanceSortDirection = 'desc';
  bool _exportingSalesPerformance = false;

  bool get _canViewAnalytics =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.boss ||
      widget.role == UserRole.finance ||
      widget.role == UserRole.warehouse ||
      widget.role == UserRole.afterSales;

  bool get _canExportAnalytics => _canViewAnalytics;

  bool get _canViewSalesPerformance =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.boss;

  @override
  void initState() {
    super.initState();
    final initialRange = _rangeForPreset(_preset, DateTime.now());
    _start = initialRange.start;
    _end = initialRange.end;
    if (_canViewAnalytics) {
      _loading = true;
      _rankingsLoading = true;
      _trendsLoading = true;
      _salesPerformanceLoading = _canViewSalesPerformance;
      _loadAnalytics(markLoading: false);
    }
  }

  @override
  void didUpdateWidget(covariant AnalyticsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    final credentialsChanged = oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.role != widget.role;
    if (!credentialsChanged) {
      return;
    }

    if (!_canViewAnalytics) {
      setState(() {
        _overview = null;
        _loading = false;
        _errorMessage = null;
        _rankings = const [];
        _rankingsLoading = false;
        _rankingsErrorMessage = null;
        _trends = const {};
        _trendsLoading = false;
        _trendsErrorMessage = null;
        _exportingOverview = false;
        _exportingRankings = false;
        _salesPerformanceRequestSerial += 1;
        _salesPerformance = const [];
        _salesPerformanceLoading = false;
        _salesPerformanceErrorMessage = null;
        _exportingSalesPerformance = false;
      });
      return;
    }

    if (!_canViewSalesPerformance) {
      _salesPerformanceRequestSerial += 1;
      _salesPerformance = const [];
      _salesPerformanceLoading = false;
      _salesPerformanceErrorMessage = null;
      _exportingSalesPerformance = false;
    }
    _loadAnalytics();
  }

  @override
  Widget build(BuildContext context) {
    if (!_canViewAnalytics) {
      return const ResponsivePage(
        children: [
          _StateCard(
            icon: Icons.lock_outline_rounded,
            title: '无权限查看数据分析',
            message: '当前角色不能访问公司级数据分析。',
          ),
        ],
      );
    }

    final overview = _overview;
    return ResponsivePage(
      children: [
        _buildToolbar(context),
        if (_loading && overview != null) const LinearProgressIndicator(),
        if (_loading && overview == null)
          const _StateCard(
            key: ValueKey('analytics-overview-loading'),
            icon: Icons.hourglass_top_rounded,
            title: '正在加载数据分析',
            message: '正在读取第 8 阶段统计概览。',
            showProgress: true,
          )
        else if (_errorMessage != null && overview == null)
          _StateCard(
            key: const ValueKey('analytics-overview-error'),
            icon: Icons.error_outline_rounded,
            title: '数据分析加载失败',
            message: _errorMessage!,
            actionLabel: '重试',
            onAction: _loadOverview,
          )
        else if (overview == null)
          const _StateCard(
            key: ValueKey('analytics-overview-empty'),
            icon: Icons.inbox_outlined,
            title: '暂无统计数据',
            message: '当前日期范围暂无可展示的统计数据。',
          )
        else ...[
          if (_errorMessage != null)
            _InlineError(message: _errorMessage!, onRetry: _loadOverview),
          if (_isOverviewEmpty(overview))
            const _StateCard(
              key: ValueKey('analytics-overview-empty'),
              icon: Icons.inbox_outlined,
              title: '暂无统计数据',
              message: '当前日期范围暂无可展示的统计数据。',
            ),
          MetricGrid(
            key: const ValueKey('analytics-overview-metrics-section'),
            metrics: _metricsFor(overview, _openMetricSource),
          ),
          if (_canViewSalesPerformance) _buildSalesPerformanceSection(),
          _buildTrendsSection(),
          if (_warningItems(overview).isNotEmpty)
            _WarningsSection(items: _warningItems(overview)),
          _buildTasterRankingsSection(),
        ],
      ],
    );
  }

  Widget _buildToolbar(BuildContext context) {
    final selectedLabel = _labelForPreset(_preset);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '数据分析概览',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                IconButton(
                  key: const ValueKey('analytics-overview-refresh-button'),
                  tooltip: '刷新',
                  onPressed: _loading ||
                          _rankingsLoading ||
                          _trendsLoading ||
                          _salesPerformanceLoading
                      ? null
                      : _loadAnalytics,
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                AppDateRangeButton(
                  key: const ValueKey('analytics-overview-date-range-button'),
                  start: _start,
                  end: _end,
                  onChanged: (range) {
                    setState(() {
                      _preset = _customPreset;
                      _start = _dateOnly(range.start);
                      _end = _dateOnly(range.end);
                    });
                    _loadAnalytics();
                  },
                ),
                AppFilterBar(
                  filters:
                      _presetOptions.map((option) => option.label).toList(),
                  selected: selectedLabel,
                  onSelected: _applyPresetLabel,
                ),
                if (_canExportAnalytics)
                  OutlinedButton.icon(
                    key: const ValueKey('analytics-overview-export-button'),
                    onPressed:
                        _exportingOverview ? null : _exportAnalyticsOverview,
                    icon: _exportingOverview
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.download_rounded),
                    label: Text(_exportingOverview ? '导出中' : '导出经营看板'),
                  ),
                if (_canExportAnalytics)
                  OutlinedButton.icon(
                    key: const ValueKey('analytics-rankings-export-button'),
                    onPressed:
                        _exportingRankings ? null : _exportTasterRankings,
                    icon: _exportingRankings
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.download_rounded),
                    label: Text(_exportingRankings ? '导出中' : '导出品鉴师排名'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _loadOverview({bool markLoading = true}) async {
    if (!_canViewAnalytics) {
      return;
    }

    final requestId = ++_requestSerial;
    if (markLoading) {
      setState(() {
        _loading = true;
        _errorMessage = null;
      });
    } else {
      _errorMessage = null;
    }

    try {
      final overview = await BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      ).getAnalyticsOverview(
        preset: _preset,
        dateFrom: _start,
        dateTo: _end,
      );
      if (!mounted || requestId != _requestSerial) {
        return;
      }
      setState(() {
        _overview = overview;
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

  Future<void> _loadTasterRankings({bool markLoading = true}) async {
    if (!_canViewAnalytics) {
      return;
    }

    final requestId = ++_rankingsRequestSerial;
    if (markLoading) {
      setState(() {
        _rankingsLoading = true;
        _rankingsErrorMessage = null;
      });
    } else {
      _rankingsErrorMessage = null;
    }

    try {
      final rankings = await BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      ).listTasterRankings(
        preset: _preset,
        dateFrom: _start,
        dateTo: _end,
        sortBy: _rankingSort.sortBy,
        sortDirection: 'desc',
        limit: _rankingLimit,
      );
      if (!mounted || requestId != _rankingsRequestSerial) {
        return;
      }
      setState(() {
        _rankings = rankings;
        _rankingsLoading = false;
        _rankingsErrorMessage = null;
      });
    } catch (error) {
      if (!mounted || requestId != _rankingsRequestSerial) {
        return;
      }
      setState(() {
        _rankingsLoading = false;
        _rankingsErrorMessage = _friendlyError(error);
      });
    }
  }

  Future<void> _loadSalesPerformance({bool markLoading = true}) async {
    if (!_canViewSalesPerformance) {
      return;
    }

    final requestId = ++_salesPerformanceRequestSerial;
    if (markLoading) {
      setState(() {
        _salesPerformanceLoading = true;
        _salesPerformanceErrorMessage = null;
      });
    } else {
      _salesPerformanceErrorMessage = null;
    }

    try {
      final records = await BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      ).listSalesPerformance(
        preset: _preset,
        dateFrom: _start,
        dateTo: _end,
        sortBy: _salesPerformanceSort.sortBy,
        sortDirection: _salesPerformanceSortDirection,
      );
      if (!mounted || requestId != _salesPerformanceRequestSerial) {
        return;
      }
      setState(() {
        _salesPerformance = records;
        _salesPerformanceLoading = false;
        _salesPerformanceErrorMessage = null;
      });
    } catch (error) {
      if (!mounted || requestId != _salesPerformanceRequestSerial) {
        return;
      }
      setState(() {
        _salesPerformanceLoading = false;
        _salesPerformanceErrorMessage = _friendlyError(error);
      });
    }
  }

  Widget _buildSalesPerformanceSection() {
    return Card(
      key: const ValueKey('analytics-sales-performance-section'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 12,
              runSpacing: 12,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                SizedBox(
                  width: 220,
                  child: Text(
                    '销售出单情况',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                SizedBox(
                  width: 210,
                  child: DropdownButtonFormField<_RankingSortOption>(
                    key: const ValueKey('analytics-sales-performance-sort'),
                    initialValue: _salesPerformanceSort,
                    decoration: const InputDecoration(
                      labelText: '排序指标',
                      prefixIcon: Icon(Icons.sort_rounded),
                      isDense: true,
                    ),
                    items: _salesPerformanceSortOptions
                        .map(
                          (option) => DropdownMenuItem<_RankingSortOption>(
                            value: option,
                            child: Text(
                              option.label,
                              key: ValueKey(
                                'analytics-sales-sort-${option.sortBy}',
                              ),
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: _salesPerformanceLoading
                        ? null
                        : (option) {
                            if (option == null ||
                                option.sortBy ==
                                    _salesPerformanceSort.sortBy) {
                              return;
                            }
                            setState(() {
                              _salesPerformanceSort = option;
                            });
                            _loadSalesPerformance();
                          },
                  ),
                ),
                Tooltip(
                  message: _salesPerformanceSortDirection == 'desc'
                      ? '当前降序，点击切换升序'
                      : '当前升序，点击切换降序',
                  child: IconButton.outlined(
                    key: const ValueKey(
                      'analytics-sales-performance-sort-direction',
                    ),
                    onPressed: _salesPerformanceLoading
                        ? null
                        : () {
                            setState(() {
                              _salesPerformanceSortDirection =
                                  _salesPerformanceSortDirection == 'desc'
                                      ? 'asc'
                                      : 'desc';
                            });
                            _loadSalesPerformance();
                          },
                    icon: Icon(
                      _salesPerformanceSortDirection == 'desc'
                          ? Icons.arrow_downward_rounded
                          : Icons.arrow_upward_rounded,
                    ),
                  ),
                ),
                OutlinedButton.icon(
                  key: const ValueKey(
                    'analytics-sales-performance-export-button',
                  ),
                  onPressed: _exportingSalesPerformance
                      ? null
                      : _exportSalesPerformance,
                  icon: _exportingSalesPerformance
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.download_rounded),
                  label: Text(
                    _exportingSalesPerformance
                        ? '导出中'
                        : '导出销售出单统计',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (_salesPerformanceLoading && _salesPerformance.isNotEmpty)
              const LinearProgressIndicator(),
            if (_salesPerformanceErrorMessage != null &&
                _salesPerformance.isNotEmpty)
              _InlineError(
                message: _salesPerformanceErrorMessage!,
                onRetry: _loadSalesPerformance,
              ),
            if (_salesPerformanceLoading && _salesPerformance.isEmpty)
              const _EmbeddedState(
                key: ValueKey('analytics-sales-performance-loading'),
                icon: Icons.point_of_sale_rounded,
                title: '正在加载销售出单情况',
                message: '正在按销售人员汇总本期出单与已确认退款。',
                showProgress: true,
              )
            else if (_salesPerformanceErrorMessage != null &&
                _salesPerformance.isEmpty)
              _EmbeddedState(
                key: const ValueKey('analytics-sales-performance-error'),
                icon: Icons.error_outline_rounded,
                title: '销售出单情况加载失败',
                message: _salesPerformanceErrorMessage!,
                actionLabel: '重试',
                onAction: _loadSalesPerformance,
              )
            else if (_salesPerformance.isEmpty)
              const _EmbeddedState(
                key: ValueKey('analytics-sales-performance-empty'),
                icon: Icons.inbox_outlined,
                title: '暂无销售人员数据',
                message: '当前没有可展示的销售人员或出单记录。',
              )
            else
              _SalesPerformanceView(
                records: _salesPerformance,
                onOpenDetail: _openSalesPerformanceDetail,
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _openSalesPerformanceDetail(
    SalesPerformanceRecord record,
  ) async {
    final detailFuture = BusinessApi(
      apiClient: widget.apiClient,
      token: widget.token,
    ).getSalesPerformanceDetail(
      record.salesUserId,
      preset: _preset,
      dateFrom: _start,
      dateTo: _end,
      sortBy: _salesPerformanceSort.sortBy,
      sortDirection: _salesPerformanceSortDirection,
    );
    await showDialog<void>(
      context: context,
      builder: (context) => _SalesPerformanceDetailDialog(
        title: '${_displaySalesUserName(record)} 详情',
        future: detailFuture,
      ),
    );
  }

  Future<void> _exportSalesPerformance() async {
    if (!_canViewSalesPerformance || _exportingSalesPerformance) {
      return;
    }
    setState(() {
      _exportingSalesPerformance = true;
      _salesPerformanceErrorMessage = null;
    });
    try {
      final downloadedFile = await BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      ).exportSalesPerformance(
        preset: _preset,
        dateFrom: _start,
        dateTo: _end,
        sortBy: _salesPerformanceSort.sortBy,
        sortDirection: _salesPerformanceSortDirection,
      );
      final targetFile = await _writeExportFile(
        downloadedFile,
        'analytics-sales-performance',
      );
      if (!mounted) {
        return;
      }
      setState(() => _exportingSalesPerformance = false);
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('销售出单统计已导出：${targetFile.path}')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      final message = _friendlyError(error);
      setState(() {
        _exportingSalesPerformance = false;
        _salesPerformanceErrorMessage = message;
      });
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  Future<void> _loadTrends({bool markLoading = true}) async {
    if (!_canViewAnalytics) {
      return;
    }

    final requestId = ++_trendsRequestSerial;
    if (markLoading) {
      setState(() {
        _trendsLoading = true;
        _trendsErrorMessage = null;
      });
    } else {
      _trendsErrorMessage = null;
    }

    try {
      final api = BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      );
      final granularity = _trendGranularityForRange(_start, _end);
      final results = await Future.wait(
        _trendMetrics.map(
          (option) => api.getAnalyticsTrends(
            preset: _preset,
            dateFrom: _start,
            dateTo: _end,
            granularity: granularity,
            metric: option.metric,
          ),
        ),
      );
      if (!mounted || requestId != _trendsRequestSerial) {
        return;
      }
      setState(() {
        _trends = {
          for (var index = 0; index < _trendMetrics.length; index += 1)
            _trendMetrics[index].metric: results[index],
        };
        _trendsLoading = false;
        _trendsErrorMessage = null;
      });
    } catch (error) {
      if (!mounted || requestId != _trendsRequestSerial) {
        return;
      }
      setState(() {
        _trendsLoading = false;
        _trendsErrorMessage = _friendlyError(error);
      });
    }
  }

  Widget _buildTrendsSection() {
    return Card(
      key: const ValueKey('analytics-trends-section'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '经营趋势',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                StatusTag(
                  label: _trendGranularityForRange(_start, _end) == 'month'
                      ? '按月'
                      : '按日',
                  tone: StatusTone.info,
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (_trendsLoading && _trends.isNotEmpty)
              const LinearProgressIndicator(),
            if (_trendsErrorMessage != null && _trends.isNotEmpty) ...[
              if (_trendsLoading && _trends.isNotEmpty)
                const SizedBox(height: 12),
              _InlineError(
                message: _trendsErrorMessage!,
                onRetry: _loadTrends,
              ),
            ],
            if (_trendsLoading && _trends.isEmpty)
              const _EmbeddedState(
                key: ValueKey('analytics-trends-loading'),
                icon: Icons.show_chart_rounded,
                title: '正在加载经营趋势',
                message: '正在读取销售额、接待团数和打蛋率趋势。',
                showProgress: true,
              )
            else if (_trendsErrorMessage != null && _trends.isEmpty)
              _EmbeddedState(
                key: const ValueKey('analytics-trends-error'),
                icon: Icons.error_outline_rounded,
                title: '经营趋势加载失败',
                message: _trendsErrorMessage!,
                actionLabel: '重试',
                onAction: _loadTrends,
              )
            else
              _TrendGrid(trends: _trends),
          ],
        ),
      ),
    );
  }

  Widget _buildTasterRankingsSection() {
    return Card(
      key: const ValueKey('analytics-taster-rankings-section'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 12,
              runSpacing: 12,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                SizedBox(
                  width: 260,
                  child: Text(
                    '品鉴师排名',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                SizedBox(
                  width: 220,
                  child: DropdownButtonFormField<_RankingSortOption>(
                    key: const ValueKey('analytics-ranking-sort-field'),
                    initialValue: _rankingSort,
                    decoration: const InputDecoration(
                      labelText: '排序',
                      prefixIcon: Icon(Icons.sort_rounded),
                      isDense: true,
                    ),
                    items: _rankingSortOptions
                        .map(
                          (option) => DropdownMenuItem<_RankingSortOption>(
                            value: option,
                            child: Text(
                              option.label,
                              key: ValueKey(
                                'analytics-ranking-sort-${option.sortBy}',
                              ),
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: _rankingsLoading
                        ? null
                        : (option) {
                            if (option == null ||
                                option.sortBy == _rankingSort.sortBy) {
                              return;
                            }
                            setState(() {
                              _rankingSort = option;
                            });
                            _loadTasterRankings();
                          },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (_rankingsLoading && _rankings.isNotEmpty)
              const LinearProgressIndicator(),
            if (_rankingsErrorMessage != null && _rankings.isNotEmpty) ...[
              if (_rankingsLoading && _rankings.isNotEmpty)
                const SizedBox(height: 12),
              _InlineError(
                message: _rankingsErrorMessage!,
                onRetry: _loadTasterRankings,
              ),
            ],
            if (_rankingsLoading && _rankings.isEmpty)
              const _EmbeddedState(
                key: ValueKey('analytics-rankings-loading'),
                icon: Icons.leaderboard_rounded,
                title: '正在加载品鉴师排名',
                message: '正在读取第 8 阶段品鉴师排名统计。',
                showProgress: true,
              )
            else if (_rankingsErrorMessage != null && _rankings.isEmpty)
              _EmbeddedState(
                key: const ValueKey('analytics-rankings-error'),
                icon: Icons.error_outline_rounded,
                title: '品鉴师排名加载失败',
                message: _rankingsErrorMessage!,
                actionLabel: '重试',
                onAction: _loadTasterRankings,
              )
            else if (_rankings.isEmpty)
              const _EmbeddedState(
                key: ValueKey('analytics-rankings-empty'),
                icon: Icons.inbox_outlined,
                title: '暂无品鉴师排名',
                message: '当前日期范围暂无可展示的品鉴师排名数据。',
              )
            else
              _TasterRankingTable(
                rankings: _rankings,
                onOpenDetail: _openTasterDetail,
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _openTasterDetail(TasterRankingRecord record) async {
    final tasterId = record.tasterId?.trim();
    if (tasterId == null || tasterId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('未分配品鉴师暂无独立详情，可从旅行团明细追溯。')),
      );
      return;
    }

    final detailFuture = BusinessApi(
      apiClient: widget.apiClient,
      token: widget.token,
    ).getTasterRankingDetail(
      tasterId,
      preset: _preset,
      dateFrom: _start,
      dateTo: _end,
      sortBy: _rankingSort.sortBy,
      sortDirection: 'desc',
      limit: _rankingLimit,
    );

    await showDialog<void>(
      context: context,
      builder: (context) {
        return _TasterRankingDetailDialog(
          title: '${_displayTasterName(record)} 详情',
          future: detailFuture,
        );
      },
    );
  }

  Future<void> _openMetricSource(_AnalyticsSourceRequest request) async {
    final sourceFuture = _loadMetricSource(request);
    await showDialog<void>(
      context: context,
      builder: (context) {
        return _AnalyticsSourceDialog(
          request: request,
          future: sourceFuture,
        );
      },
    );
  }

  Future<_AnalyticsSourceResult> _loadMetricSource(
    _AnalyticsSourceRequest request,
  ) async {
    final api = BusinessApi(
      apiClient: widget.apiClient,
      token: widget.token,
    );
    switch (request.type) {
      case _AnalyticsSourceType.orders:
        return _AnalyticsSourceResult(
          orders: await api.listAnalyticsSourceOrders(
            preset: _preset,
            dateFrom: _start,
            dateTo: _end,
            source: request.source,
          ),
        );
      case _AnalyticsSourceType.travelGroups:
        return _AnalyticsSourceResult(
          travelGroups: await api.listAnalyticsSourceTravelGroups(
            preset: _preset,
            dateFrom: _start,
            dateTo: _end,
            noEffectiveOrder: request.noEffectiveOrder,
          ),
        );
      case _AnalyticsSourceType.afterSales:
        return _AnalyticsSourceResult(
          afterSalesOrders: await api.listAnalyticsSourceAfterSales(
            preset: _preset,
            dateFrom: _start,
            dateTo: _end,
            source: request.source,
          ),
        );
    }
  }

  Future<void> _exportAnalyticsOverview() async {
    if (!_canExportAnalytics || _exportingOverview) {
      return;
    }

    setState(() {
      _exportingOverview = true;
      _errorMessage = null;
    });

    try {
      final downloadedFile = await BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      ).exportAnalyticsOverview(
        preset: _preset,
        dateFrom: _start,
        dateTo: _end,
      );
      final targetFile = await _writeExportFile(
        downloadedFile,
        'analytics-overview',
      );
      if (!mounted) {
        return;
      }
      setState(() => _exportingOverview = false);
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('经营看板已导出：${targetFile.path}')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      final message = _friendlyError(error);
      setState(() {
        _exportingOverview = false;
        _errorMessage = message;
      });
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  Future<void> _exportTasterRankings() async {
    if (!_canExportAnalytics || _exportingRankings) {
      return;
    }

    setState(() {
      _exportingRankings = true;
      _rankingsErrorMessage = null;
    });

    try {
      final downloadedFile = await BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      ).exportTasterRankings(
        preset: _preset,
        dateFrom: _start,
        dateTo: _end,
        sortBy: _rankingSort.sortBy,
        sortDirection: 'desc',
        limit: _rankingLimit,
      );
      final targetFile = await _writeExportFile(
        downloadedFile,
        'analytics-taster-rankings',
      );
      if (!mounted) {
        return;
      }
      setState(() => _exportingRankings = false);
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('品鉴师排名已导出：${targetFile.path}')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      final message = _friendlyError(error);
      setState(() {
        _exportingRankings = false;
        _rankingsErrorMessage = message;
      });
      ScaffoldMessenger.of(context).hideCurrentSnackBar();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  Future<File> _writeExportFile(
    DownloadedFile downloadedFile,
    String fallbackPrefix,
  ) async {
    final directory = await (widget.documentsDirectoryProvider?.call() ??
        getApplicationDocumentsDirectory());
    final exportDirectory = Directory(
      '${directory.path}${Platform.pathSeparator}exports',
    );
    await exportDirectory.create(recursive: true);
    final targetFile = await _nextExportFile(
      exportDirectory,
      _safeExportFileName(downloadedFile.fileName, fallbackPrefix),
    );
    await targetFile.writeAsBytes(downloadedFile.bytes, flush: true);
    return targetFile;
  }

  void _loadAnalytics({bool markLoading = true}) {
    _loadOverview(markLoading: markLoading);
    _loadTasterRankings(markLoading: markLoading);
    _loadTrends(markLoading: markLoading);
    if (_canViewSalesPerformance) {
      _loadSalesPerformance(markLoading: markLoading);
    }
  }

  void _applyPresetLabel(String label) {
    final option = _presetOptions.firstWhere((item) => item.label == label);
    final range = _rangeForPreset(option.value, DateTime.now());
    setState(() {
      _preset = option.value;
      _start = range.start;
      _end = range.end;
    });
    _loadAnalytics();
  }
}

List<MetricData> _metricsFor(
  AnalyticsOverview overview,
  ValueChanged<_AnalyticsSourceRequest> onOpenSource,
) {
  return [
    MetricData(
      label: '出单销售额',
      value: formatMoneyCents(overview.grossSalesAmountCents),
      icon: Icons.trending_up_rounded,
      accent: const Color(0xFF226D68),
      onTap: () => onOpenSource(
        const _AnalyticsSourceRequest(
          title: '出单销售额订单明细',
          type: _AnalyticsSourceType.orders,
          source: 'sales',
        ),
      ),
    ),
    MetricData(
      label: '退单销售额',
      value: formatMoneyCents(overview.refundAmountCents),
      icon: Icons.assignment_return_rounded,
      accent: const Color(0xFFA23E48),
      onTap: () => onOpenSource(
        const _AnalyticsSourceRequest(
          title: '退单售后退款明细',
          type: _AnalyticsSourceType.afterSales,
          source: 'refund',
        ),
      ),
    ),
    MetricData(
      label: '总销售额',
      value: formatMoneyCents(overview.netSalesAmountCents),
      icon: Icons.account_balance_wallet_rounded,
      accent: const Color(0xFF3F5E8C),
      onTap: () => onOpenSource(
        const _AnalyticsSourceRequest(
          title: '总销售额订单明细',
          type: _AnalyticsSourceType.orders,
          source: 'sales',
        ),
      ),
    ),
    MetricData(
      label: '接待团数',
      value: _formatCount(overview.totalGroupCount),
      icon: Icons.directions_bus_rounded,
      accent: const Color(0xFF7D5A2E),
      onTap: () => onOpenSource(
        const _AnalyticsSourceRequest(
          title: '接待旅行团明细',
          type: _AnalyticsSourceType.travelGroups,
        ),
      ),
    ),
    MetricData(
      label: '接待人数',
      value: _formatCount(overview.totalGuestCount),
      icon: Icons.groups_rounded,
      accent: const Color(0xFF547A3A),
      onTap: () => onOpenSource(
        const _AnalyticsSourceRequest(
          title: '接待人数旅行团明细',
          type: _AnalyticsSourceType.travelGroups,
        ),
      ),
    ),
    MetricData(
      label: '团均销售额',
      value: formatMoneyCents(overview.averageSalesPerGroupCents),
      icon: Icons.stacked_line_chart_rounded,
      accent: const Color(0xFF6C4F8F),
      onTap: () => onOpenSource(
        const _AnalyticsSourceRequest(
          title: '团均销售额订单明细',
          type: _AnalyticsSourceType.orders,
          source: 'group_scoped',
        ),
      ),
    ),
    MetricData(
      label: '人均销售额',
      value: formatMoneyCents(overview.averageSalesPerGuestCents),
      icon: Icons.person_rounded,
      accent: const Color(0xFF895737),
      onTap: () => onOpenSource(
        const _AnalyticsSourceRequest(
          title: '人均销售额订单明细',
          type: _AnalyticsSourceType.orders,
          source: 'group_scoped',
        ),
      ),
    ),
    MetricData(
      label: '打蛋率',
      value: _formatPercent(overview.noOrderRate),
      icon: Icons.pie_chart_rounded,
      accent: const Color(0xFF8A5A83),
      onTap: () => onOpenSource(
        const _AnalyticsSourceRequest(
          title: '无有效订单旅行团明细',
          type: _AnalyticsSourceType.travelGroups,
          noEffectiveOrder: true,
        ),
      ),
    ),
  ];
}

List<AppRecordItem> _warningItems(AnalyticsOverview overview) {
  final warnings = <AnalyticsWarning>[...overview.warnings];
  final hasPendingWarning = warnings.any(
    (warning) =>
        warning.code == 'pending_refund' ||
        warning.code == 'pending_refund_amount',
  );
  if (overview.pendingRefundAmountCents > 0 && !hasPendingWarning) {
    warnings.add(
      AnalyticsWarning(
        code: 'pending_refund',
        message:
            '存在未确认退款 ${formatMoneyCents(overview.pendingRefundAmountCents)}',
        context: null,
      ),
    );
  }

  return warnings
      .map(
        (warning) => AppRecordItem(
          title: _warningTitle(warning),
          subtitle: _warningSubtitle(warning),
          icon: _warningIcon(warning.code),
          trailing: StatusTag(
            label: _warningTagLabel(warning.code),
            tone: _warningTone(warning.code),
          ),
        ),
      )
      .toList();
}

bool _isOverviewEmpty(AnalyticsOverview overview) {
  return overview.grossSalesAmountCents == 0 &&
      overview.refundAmountCents == 0 &&
      overview.netSalesAmountCents == 0 &&
      overview.totalGroupCount == 0 &&
      overview.totalGuestCount == 0 &&
      overview.averageSalesPerGroupCents == 0 &&
      overview.averageSalesPerGuestCents == 0 &&
      overview.noOrderRate == 0;
}

String _warningTitle(AnalyticsWarning warning) {
  switch (warning.code) {
    case 'pending_refund':
    case 'pending_refund_amount':
      return '未确认退款';
    case 'refunded_order_without_confirmed_refund':
      return '退款状态不一致';
    case 'missing_taster':
      return '缺少品鉴师';
    default:
      return warning.code.isEmpty ? '统计预警' : warning.code;
  }
}

String _warningSubtitle(AnalyticsWarning warning) {
  final message = warning.message.trim();
  if (message.isEmpty || message == warning.code) {
    return _warningTitle(warning);
  }
  return message;
}

IconData _warningIcon(String code) {
  switch (code) {
    case 'pending_refund':
    case 'pending_refund_amount':
      return Icons.pending_actions_rounded;
    case 'refunded_order_without_confirmed_refund':
      return Icons.rule_folder_rounded;
    case 'missing_taster':
      return Icons.person_off_rounded;
    default:
      return Icons.warning_amber_rounded;
  }
}

StatusTone _warningTone(String code) {
  switch (code) {
    case 'refunded_order_without_confirmed_refund':
      return StatusTone.danger;
    case 'pending_refund':
    case 'pending_refund_amount':
    case 'missing_taster':
      return StatusTone.warning;
    default:
      return StatusTone.info;
  }
}

String _warningTagLabel(String code) {
  switch (code) {
    case 'refunded_order_without_confirmed_refund':
      return '异常';
    case 'pending_refund':
    case 'pending_refund_amount':
      return '待确认';
    default:
      return '关注';
  }
}

String _friendlyError(Object error) {
  if (error is ApiException) {
    if (error.statusCode == 403 || error.code.toUpperCase() == 'FORBIDDEN') {
      return '无权限访问数据分析，请联系管理员确认角色权限。';
    }
    return error.message;
  }
  return '读取数据分析失败，请稍后重试。';
}

String _labelForPreset(String preset) {
  return _presetOptions
      .firstWhere(
        (option) => option.value == preset,
        orElse: () => const _PresetOption(label: '自定义', value: _customPreset),
      )
      .label;
}

DateTimeRange _rangeForPreset(String preset, DateTime now) {
  final today = _dateOnly(now);
  switch (preset) {
    case 'today':
      return DateTimeRange(start: today, end: today);
    case 'yesterday':
      final yesterday = today.subtract(const Duration(days: 1));
      return DateTimeRange(start: yesterday, end: yesterday);
    case 'last_10_days':
      return DateTimeRange(
        start: today.subtract(const Duration(days: 9)),
        end: today,
      );
    case 'last_month':
      final start = DateTime(today.year, today.month - 1);
      final end = DateTime(today.year, today.month, 0);
      return DateTimeRange(start: start, end: end);
    case 'this_year':
      return DateTimeRange(start: DateTime(today.year), end: today);
    case 'this_month':
    default:
      return DateTimeRange(
          start: DateTime(today.year, today.month), end: today);
  }
}

DateTime _dateOnly(DateTime value) {
  return DateTime(value.year, value.month, value.day);
}

String _formatPercent(double value) {
  return '${(value * 100).toStringAsFixed(1)}%';
}

String _formatCount(int value) {
  final sign = value < 0 ? '-' : '';
  final digits = value.abs().toString();
  final buffer = StringBuffer();
  for (var index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 == 0) {
      buffer.write(',');
    }
    buffer.write(digits[index]);
  }
  return '$sign$buffer';
}

bool _canOpenTasterDetail(TasterRankingRecord record) {
  final tasterId = record.tasterId?.trim();
  return tasterId != null && tasterId.isNotEmpty;
}

bool _isUnassignedTaster(TasterRankingRecord record) {
  final tasterId = record.tasterId?.trim();
  return tasterId == null ||
      tasterId.isEmpty ||
      record.tasterName.trim() == '未分配品鉴师';
}

String _displayTasterName(TasterRankingRecord record) {
  if (_isUnassignedTaster(record)) {
    return '未分配品鉴师';
  }
  return _fallbackText(record.tasterName, '未命名品鉴师');
}

String _displaySalesUserName(SalesPerformanceRecord record) {
  if (record.isUnassigned || record.salesUserId?.trim().isEmpty != false) {
    return '未分配销售';
  }
  return _fallbackText(record.salesUserName, '未命名销售');
}

String _formatAverageSales(int? amountCents) {
  return amountCents == null ? '—' : formatMoneyCents(amountCents);
}

Widget _salesPerformanceStatusTag(SalesPerformanceRecord record) {
  if (record.isUnassigned || record.salesUserId?.trim().isEmpty != false) {
    return const StatusTag(label: '未分配', tone: StatusTone.info);
  }
  if (record.isActive) {
    return const StatusTag(label: '在职', tone: StatusTone.success);
  }
  return const StatusTag(label: '停用', tone: StatusTone.warning);
}

String _fallbackText(String? value, String fallback) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? fallback : text;
}

String _dateText(String? value) {
  final text = value?.trim() ?? '';
  if (text.isEmpty) {
    return '无日期';
  }
  return text.length >= 10 ? text.substring(0, 10) : text;
}

int _hiddenCount(int total) {
  return total > 5 ? total - 5 : 0;
}

int _hiddenCountAfter(int total, int shown) {
  return total > shown ? total - shown : 0;
}

String _trendGranularityForRange(DateTime start, DateTime end) {
  return end.difference(start).inDays > 120 ? 'month' : 'day';
}

List<AnalyticsTrendPoint> _visibleTrendPoints(
  List<AnalyticsTrendPoint> points,
) {
  if (points.length <= 6) {
    return points;
  }
  return points.sublist(points.length - 6);
}

double _trendNumericValue(
  _TrendMetricOption option,
  AnalyticsTrendPoint point,
) {
  switch (option.metric) {
    case 'net_sales':
      return point.netSalesAmountCents != 0
          ? point.netSalesAmountCents.toDouble()
          : point.metricValue;
    case 'groups':
      return point.totalGroupCount != 0
          ? point.totalGroupCount.toDouble()
          : point.metricValue;
    case 'no_order_rate':
      return point.noOrderRate != 0 ? point.noOrderRate : point.metricValue;
    default:
      return point.metricValue;
  }
}

String _trendDisplayValue(_TrendMetricOption option, double value) {
  switch (option.metric) {
    case 'net_sales':
      return formatMoneyCents(value.round());
    case 'groups':
      return _formatCount(value.round());
    case 'no_order_rate':
      return _formatPercent(value);
    default:
      return value.toStringAsFixed(1);
  }
}

String _trendPeriodLabel(AnalyticsTrendPoint point) {
  final start = _dateText(point.periodStart);
  final end = _dateText(point.periodEnd);
  if (start == end || end == '无日期') {
    return start.length >= 10 ? start.substring(5) : start;
  }
  final startLabel = start.length >= 10 ? start.substring(5) : start;
  final endLabel = end.length >= 10 ? end.substring(5) : end;
  return '$startLabel-$endLabel';
}

String _safeExportFileName(String? value, String fallbackPrefix) {
  final fallback = '$fallbackPrefix-${_exportTimestamp(DateTime.now())}.xlsx';
  final text = value?.trim().isEmpty ?? true ? fallback : value!.trim();
  final safe = text.replaceAll(RegExp(r'[<>:"/\\|?*\x00-\x1F]'), '_');
  return safe.toLowerCase().endsWith('.xlsx') ? safe : '$safe.xlsx';
}

String _exportTimestamp(DateTime value) {
  String two(int number) => number.toString().padLeft(2, '0');
  return '${value.year}${two(value.month)}${two(value.day)}-'
      '${two(value.hour)}${two(value.minute)}${two(value.second)}';
}

Future<File> _nextExportFile(Directory directory, String fileName) async {
  final separator = Platform.pathSeparator;
  final first = File('${directory.path}$separator$fileName');
  if (!await first.exists()) {
    return first;
  }

  final dotIndex = fileName.lastIndexOf('.');
  final stem = dotIndex <= 0 ? fileName : fileName.substring(0, dotIndex);
  final extension = dotIndex <= 0 ? '' : fileName.substring(dotIndex);
  for (var index = 1; index < 1000; index += 1) {
    final candidate = File(
      '${directory.path}$separator$stem-$index$extension',
    );
    if (!await candidate.exists()) {
      return candidate;
    }
  }
  return File(
    '${directory.path}$separator$stem-'
    '${DateTime.now().microsecondsSinceEpoch}$extension',
  );
}

class _PresetOption {
  const _PresetOption({required this.label, required this.value});

  final String label;
  final String value;
}

class _RankingSortOption {
  const _RankingSortOption({required this.label, required this.sortBy});

  final String label;
  final String sortBy;
}

class _TrendMetricOption {
  const _TrendMetricOption({
    required this.label,
    required this.metric,
    required this.icon,
    required this.accent,
  });

  final String label;
  final String metric;
  final IconData icon;
  final Color accent;
}

enum _AnalyticsSourceType { orders, travelGroups, afterSales }

class _AnalyticsSourceRequest {
  const _AnalyticsSourceRequest({
    required this.title,
    required this.type,
    this.source,
    this.noEffectiveOrder,
  });

  final String title;
  final _AnalyticsSourceType type;
  final String? source;
  final bool? noEffectiveOrder;
}

class _AnalyticsSourceResult {
  const _AnalyticsSourceResult({
    this.orders = const [],
    this.travelGroups = const [],
    this.afterSalesOrders = const [],
  });

  final List<AnalyticsSourceOrder> orders;
  final List<AnalyticsSourceTravelGroup> travelGroups;
  final List<AnalyticsSourceAfterSales> afterSalesOrders;

  bool get isEmpty =>
      orders.isEmpty && travelGroups.isEmpty && afterSalesOrders.isEmpty;
}

class _TrendGrid extends StatelessWidget {
  const _TrendGrid({required this.trends});

  final Map<String, List<AnalyticsTrendPoint>> trends;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 980 ? 3 : 1;
        const spacing = 12.0;
        final itemWidth =
            (constraints.maxWidth - spacing * (columns - 1)) / columns;
        return Wrap(
          spacing: spacing,
          runSpacing: spacing,
          children: [
            for (final option in _trendMetrics)
              SizedBox(
                width: itemWidth,
                child: _TrendPanel(
                  option: option,
                  points: trends[option.metric] ?? const [],
                ),
              ),
          ],
        );
      },
    );
  }
}

class _TrendPanel extends StatelessWidget {
  const _TrendPanel({required this.option, required this.points});

  final _TrendMetricOption option;
  final List<AnalyticsTrendPoint> points;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final visiblePoints = _visibleTrendPoints(points);
    final latest = points.isEmpty ? null : points.last;
    final values = visiblePoints
        .map((point) => _trendNumericValue(option, point))
        .toList();
    final maxValue = option.metric == 'no_order_rate'
        ? 1.0
        : values.fold<double>(
            0,
            (previous, value) => value > previous ? value : previous,
          );

    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(option.icon, color: option.accent),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    option.label,
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                if (latest != null)
                  Text(
                    _trendDisplayValue(
                      option,
                      _trendNumericValue(option, latest),
                    ),
                    style: Theme.of(context)
                        .textTheme
                        .labelLarge
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            if (visiblePoints.isEmpty)
              const Text('暂无趋势点')
            else
              for (final point in visiblePoints)
                _TrendPointRow(
                  option: option,
                  point: point,
                  maxValue: maxValue,
                ),
          ],
        ),
      ),
    );
  }
}

class _TrendPointRow extends StatelessWidget {
  const _TrendPointRow({
    required this.option,
    required this.point,
    required this.maxValue,
  });

  final _TrendMetricOption option;
  final AnalyticsTrendPoint point;
  final double maxValue;

  @override
  Widget build(BuildContext context) {
    final value = _trendNumericValue(option, point);
    final progress = option.metric == 'no_order_rate'
        ? value.clamp(0, 1).toDouble()
        : maxValue <= 0
            ? 0.0
            : (value / maxValue).clamp(0, 1).toDouble();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          SizedBox(width: 58, child: Text(_trendPeriodLabel(point))),
          const SizedBox(width: 8),
          Expanded(
            child: ClipRRect(
              borderRadius: const BorderRadius.all(Radius.circular(999)),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 8,
                backgroundColor:
                    Theme.of(context).colorScheme.surfaceContainerHighest,
                color: option.accent,
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 92,
            child: Text(
              _trendDisplayValue(option, value),
              textAlign: TextAlign.right,
            ),
          ),
        ],
      ),
    );
  }
}

class _AnalyticsSourceDialog extends StatelessWidget {
  const _AnalyticsSourceDialog({
    required this.request,
    required this.future,
  });

  final _AnalyticsSourceRequest request;
  final Future<_AnalyticsSourceResult> future;

  @override
  Widget build(BuildContext context) {
    final screenSize = MediaQuery.sizeOf(context);
    final contentWidth = screenSize.width < 820 ? screenSize.width - 48 : 760.0;
    final contentHeight =
        screenSize.height < 720 ? screenSize.height - 160 : 560.0;

    return AlertDialog(
      title: Text(request.title),
      content: SizedBox(
        width: contentWidth < 320 ? 320 : contentWidth,
        height: contentHeight < 320 ? 320 : contentHeight,
        child: FutureBuilder<_AnalyticsSourceResult>(
          future: future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const _EmbeddedState(
                icon: Icons.manage_search_rounded,
                title: '正在加载追溯明细',
                message: '正在读取原始订单、旅行团或售后退款记录。',
                showProgress: true,
              );
            }
            if (snapshot.hasError) {
              return _EmbeddedState(
                icon: Icons.error_outline_rounded,
                title: '追溯明细加载失败',
                message: _friendlyError(snapshot.error!),
              );
            }

            final result = snapshot.data;
            if (result == null || result.isEmpty) {
              return const _EmbeddedState(
                icon: Icons.inbox_outlined,
                title: '暂无追溯明细',
                message: '当前筛选范围内暂无对应源记录。',
              );
            }

            return _AnalyticsSourceContent(request: request, result: result);
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('关闭'),
        ),
      ],
    );
  }
}

class _AnalyticsSourceContent extends StatelessWidget {
  const _AnalyticsSourceContent({
    required this.request,
    required this.result,
  });

  final _AnalyticsSourceRequest request;
  final _AnalyticsSourceResult result;

  @override
  Widget build(BuildContext context) {
    const limit = 20;
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (request.type == _AnalyticsSourceType.orders)
            _DetailSection(
              title: '订单明细',
              emptyText: '暂无订单明细',
              rows: result.orders
                  .take(limit)
                  .map(
                    (order) => _DetailLine(
                      title: _fallbackText(order.orderNo, '未命名订单'),
                      subtitle:
                          '${_dateText(order.orderDate)} · ${_fallbackText(order.customerName, '未知客户')} · 净销售额 ${formatMoneyCents(order.netSalesAmountCents)}',
                      trailing: order.refundAmountCents > 0
                          ? StatusTag(
                              label:
                                  '退款 ${formatMoneyCents(order.refundAmountCents)}',
                              tone: StatusTone.warning,
                            )
                          : null,
                    ),
                  )
                  .toList(),
              hiddenCount: _hiddenCountAfter(result.orders.length, limit),
            ),
          if (request.type == _AnalyticsSourceType.travelGroups)
            _DetailSection(
              title: '旅行团明细',
              emptyText: '暂无旅行团明细',
              rows: result.travelGroups
                  .take(limit)
                  .map(
                    (group) => _DetailLine(
                      title: _fallbackText(group.groupNo, '未命名旅行团'),
                      subtitle:
                          '${_dateText(group.visitDate)} · ${_formatCount(group.guestCount)} 人 · ${_fallbackText(group.tasterName, '未分配品鉴师')}',
                      trailing: group.noEffectiveOrder
                          ? const StatusTag(
                              label: '无有效订单',
                              tone: StatusTone.warning,
                            )
                          : StatusTag(
                              label:
                                  '净销售额 ${formatMoneyCents(group.netSalesAmountCents)}',
                              tone: StatusTone.info,
                            ),
                    ),
                  )
                  .toList(),
              hiddenCount: _hiddenCountAfter(result.travelGroups.length, limit),
            ),
          if (request.type == _AnalyticsSourceType.afterSales)
            _DetailSection(
              title: '售后退款明细',
              emptyText: '暂无售后退款明细',
              rows: result.afterSalesOrders
                  .take(limit)
                  .map(
                    (record) => _DetailLine(
                      title: _fallbackText(record.afterSalesNo, '未命名售后单'),
                      subtitle:
                          '${_dateText(record.createdAt)} · 订单 ${_fallbackText(record.salesOrderNo, '未知')} · 退款 ${formatMoneyCents(record.refundAmountCents)}',
                      trailing: StatusTag(
                        label: record.financeConfirmed ? '已确认' : '未确认',
                        tone: record.financeConfirmed
                            ? StatusTone.success
                            : StatusTone.warning,
                      ),
                    ),
                  )
                  .toList(),
              hiddenCount:
                  _hiddenCountAfter(result.afterSalesOrders.length, limit),
            ),
        ],
      ),
    );
  }
}

class _SalesPerformanceView extends StatelessWidget {
  const _SalesPerformanceView({
    required this.records,
    required this.onOpenDetail,
  });

  final List<SalesPerformanceRecord> records;
  final ValueChanged<SalesPerformanceRecord> onOpenDetail;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 680) {
          return Column(
            key: const ValueKey('analytics-sales-performance-mobile-cards'),
            children: records
                .map(
                  (record) => _SalesPerformanceCard(
                    record: record,
                    onOpenDetail: () => onOpenDetail(record),
                  ),
                )
                .toList(),
          );
        }
        return SingleChildScrollView(
          key: const ValueKey('analytics-sales-performance-desktop-table'),
          scrollDirection: Axis.horizontal,
          child: DataTable(
            dataRowMinHeight: 56,
            dataRowMaxHeight: 72,
            columns: const [
              DataColumn(label: Text('销售人员')),
              DataColumn(label: Text('状态')),
              DataColumn(label: Text('出单数')),
              DataColumn(label: Text('出单销售额')),
              DataColumn(label: Text('退单销售额')),
              DataColumn(label: Text('总销售额')),
              DataColumn(label: Text('单均销售额')),
              DataColumn(label: Text('详情')),
            ],
            rows: records
                .map(
                  (record) => DataRow(
                    cells: [
                      DataCell(Text(_displaySalesUserName(record))),
                      DataCell(_salesPerformanceStatusTag(record)),
                      DataCell(Text(_formatCount(record.orderCount))),
                      DataCell(
                        Text(
                          formatMoneyCents(record.grossSalesAmountCents),
                        ),
                      ),
                      DataCell(
                        Text(formatMoneyCents(record.refundAmountCents)),
                      ),
                      DataCell(
                        Text(formatMoneyCents(record.netSalesAmountCents)),
                      ),
                      DataCell(
                        Text(
                          _formatAverageSales(
                            record.averageSalesPerOrderCents,
                          ),
                        ),
                      ),
                      DataCell(
                        TextButton.icon(
                          key: ValueKey(
                            'analytics-sales-detail-'
                            '${record.salesUserId ?? 'unassigned'}',
                          ),
                          onPressed: () => onOpenDetail(record),
                          icon: const Icon(
                            Icons.receipt_long_rounded,
                            size: 18,
                          ),
                          label: const Text('详情'),
                        ),
                      ),
                    ],
                  ),
                )
                .toList(),
          ),
        );
      },
    );
  }
}

class _SalesPerformanceCard extends StatelessWidget {
  const _SalesPerformanceCard({
    required this.record,
    required this.onOpenDetail,
  });

  final SalesPerformanceRecord record;
  final VoidCallback onOpenDetail;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  _displaySalesUserName(record),
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                _salesPerformanceStatusTag(record),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _DetailMetricChip(
                  label: '出单数',
                  value: _formatCount(record.orderCount),
                ),
                _DetailMetricChip(
                  label: '出单销售额',
                  value: formatMoneyCents(record.grossSalesAmountCents),
                ),
                _DetailMetricChip(
                  label: '退单销售额',
                  value: formatMoneyCents(record.refundAmountCents),
                ),
                _DetailMetricChip(
                  label: '总销售额',
                  value: formatMoneyCents(record.netSalesAmountCents),
                ),
                _DetailMetricChip(
                  label: '单均销售额',
                  value: _formatAverageSales(
                    record.averageSalesPerOrderCents,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                key: ValueKey(
                  'analytics-sales-detail-'
                  '${record.salesUserId ?? 'unassigned'}',
                ),
                onPressed: onOpenDetail,
                icon: const Icon(Icons.receipt_long_rounded),
                label: const Text('查看订单贡献'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SalesPerformanceDetailDialog extends StatelessWidget {
  const _SalesPerformanceDetailDialog({
    required this.title,
    required this.future,
  });

  final String title;
  final Future<SalesPerformanceDetail> future;

  @override
  Widget build(BuildContext context) {
    final screenSize = MediaQuery.sizeOf(context);
    final contentWidth = screenSize.width < 900 ? screenSize.width - 48 : 820.0;
    final contentHeight =
        screenSize.height < 760 ? screenSize.height - 160 : 600.0;
    return AlertDialog(
      title: Text(title),
      content: SizedBox(
        width: contentWidth < 300 ? 300 : contentWidth,
        height: contentHeight < 320 ? 320 : contentHeight,
        child: FutureBuilder<SalesPerformanceDetail>(
          future: future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const _EmbeddedState(
                icon: Icons.hourglass_top_rounded,
                title: '正在加载销售详情',
                message: '正在合并本期出单与退款贡献。',
                showProgress: true,
              );
            }
            if (snapshot.hasError) {
              return _EmbeddedState(
                icon: Icons.error_outline_rounded,
                title: '销售详情加载失败',
                message: _friendlyError(snapshot.error!),
              );
            }
            final detail = snapshot.data;
            if (detail == null) {
              return const _EmbeddedState(
                icon: Icons.inbox_outlined,
                title: '暂无销售详情',
                message: '当前日期范围暂无可追溯明细。',
              );
            }
            return _SalesPerformanceDetailContent(detail: detail);
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('关闭'),
        ),
      ],
    );
  }
}

class _SalesPerformanceDetailContent extends StatelessWidget {
  const _SalesPerformanceDetailContent({required this.detail});

  final SalesPerformanceDetail detail;

  @override
  Widget build(BuildContext context) {
    final summary = detail.summary;
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _salesPerformanceStatusTag(summary),
              _DetailMetricChip(
                label: '出单数',
                value: _formatCount(summary.orderCount),
              ),
              _DetailMetricChip(
                label: '出单销售额',
                value: formatMoneyCents(summary.grossSalesAmountCents),
              ),
              _DetailMetricChip(
                label: '退单销售额',
                value: formatMoneyCents(summary.refundAmountCents),
              ),
              _DetailMetricChip(
                label: '总销售额',
                value: formatMoneyCents(summary.netSalesAmountCents),
              ),
              _DetailMetricChip(
                label: '单均销售额',
                value: _formatAverageSales(
                  summary.averageSalesPerOrderCents,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            '订单贡献明细',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          if (detail.orders.isEmpty)
            const Text('当前范围暂无订单或退款贡献。')
          else
            ...detail.orders.map(
              (order) => _DetailLine(
                title: _fallbackText(order.orderNo, '未命名订单'),
                subtitle:
                    '${_dateText(order.orderDate)} · '
                    '${_fallbackText(order.customerName, '未知客户')} · '
                    '出单 ${formatMoneyCents(order.grossSalesAmountCents)} · '
                    '退单 ${formatMoneyCents(order.refundAmountCents)} · '
                    '总销售额 ${formatMoneyCents(order.netSalesAmountCents)}',
                trailing: StatusTag(
                  label: order.contributesToOrderCount
                      ? '计入出单数'
                      : '仅退款贡献',
                  tone: order.contributesToOrderCount
                      ? StatusTone.success
                      : StatusTone.info,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _TasterRankingTable extends StatelessWidget {
  const _TasterRankingTable({
    required this.rankings,
    required this.onOpenDetail,
  });

  final List<TasterRankingRecord> rankings;
  final ValueChanged<TasterRankingRecord> onOpenDetail;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        dataRowMinHeight: 56,
        dataRowMaxHeight: 72,
        columns: const [
          DataColumn(label: Text('排名')),
          DataColumn(label: Text('品鉴师')),
          DataColumn(label: Text('出单销售额')),
          DataColumn(label: Text('退单销售额')),
          DataColumn(label: Text('净销售额')),
          DataColumn(label: Text('团均销售额')),
          DataColumn(label: Text('人均销售额')),
          DataColumn(label: Text('接待团数')),
          DataColumn(label: Text('接待人数')),
          DataColumn(label: Text('打蛋率')),
        ],
        rows: rankings
            .map(
              (record) => DataRow(
                onSelectChanged: _canOpenTasterDetail(record)
                    ? (_) => onOpenDetail(record)
                    : null,
                cells: [
                  DataCell(Text('#${record.rank}')),
                  DataCell(
                    _TasterNameCell(
                      record: record,
                      onOpenDetail: _canOpenTasterDetail(record)
                          ? () => onOpenDetail(record)
                          : null,
                    ),
                  ),
                  DataCell(Text(formatMoneyCents(
                    record.grossSalesAmountCents,
                  ))),
                  DataCell(Text(formatMoneyCents(
                    record.refundAmountCents,
                  ))),
                  DataCell(Text(formatMoneyCents(record.netSalesAmountCents))),
                  DataCell(Text(formatMoneyCents(
                    record.averageSalesPerGroupCents,
                  ))),
                  DataCell(Text(formatMoneyCents(
                    record.averageSalesPerGuestCents,
                  ))),
                  DataCell(Text(_formatCount(record.totalGroupCount))),
                  DataCell(Text(_formatCount(record.totalGuestCount))),
                  DataCell(Text(_formatPercent(record.noOrderRate))),
                ],
              ),
            )
            .toList(),
      ),
    );
  }
}

class _TasterNameCell extends StatelessWidget {
  const _TasterNameCell({
    required this.record,
    required this.onOpenDetail,
  });

  final TasterRankingRecord record;
  final VoidCallback? onOpenDetail;

  @override
  Widget build(BuildContext context) {
    final tasterId = record.tasterId?.trim();
    final displayName = _displayTasterName(record);
    final isUnassigned = _isUnassignedTaster(record);
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 260),
      child: Wrap(
        spacing: 8,
        runSpacing: 4,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (onOpenDetail == null)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.person_off_rounded, size: 18),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    displayName,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            )
          else
            TextButton.icon(
              key: ValueKey('analytics-ranking-detail-$tasterId'),
              onPressed: onOpenDetail,
              icon: const Icon(Icons.person_search_rounded, size: 18),
              label: Text(displayName),
            ),
          if (isUnassigned)
            const StatusTag(label: '未分配', tone: StatusTone.warning)
          else if (record.warnings.isNotEmpty)
            const StatusTag(label: '预警', tone: StatusTone.warning),
        ],
      ),
    );
  }
}

class _TasterRankingDetailDialog extends StatelessWidget {
  const _TasterRankingDetailDialog({
    required this.title,
    required this.future,
  });

  final String title;
  final Future<TasterRankingDetail> future;

  @override
  Widget build(BuildContext context) {
    final screenSize = MediaQuery.sizeOf(context);
    final contentWidth = screenSize.width < 780 ? screenSize.width - 48 : 720.0;
    final contentHeight =
        screenSize.height < 720 ? screenSize.height - 160 : 560.0;

    return AlertDialog(
      title: Text(title),
      content: SizedBox(
        width: contentWidth < 300 ? 300 : contentWidth,
        height: contentHeight < 320 ? 320 : contentHeight,
        child: FutureBuilder<TasterRankingDetail>(
          future: future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const _EmbeddedState(
                icon: Icons.hourglass_top_rounded,
                title: '正在加载品鉴师详情',
                message: '正在读取旅行团、订单和售后退款明细摘要。',
                showProgress: true,
              );
            }
            if (snapshot.hasError) {
              return _EmbeddedState(
                icon: Icons.error_outline_rounded,
                title: '品鉴师详情加载失败',
                message: _friendlyError(snapshot.error!),
              );
            }

            final detail = snapshot.data;
            if (detail == null) {
              return const _EmbeddedState(
                icon: Icons.inbox_outlined,
                title: '暂无品鉴师详情',
                message: '当前日期范围暂无可追溯明细。',
              );
            }

            return _TasterRankingDetailContent(detail: detail);
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('关闭'),
        ),
      ],
    );
  }
}

class _TasterRankingDetailContent extends StatelessWidget {
  const _TasterRankingDetailContent({required this.detail});

  final TasterRankingDetail detail;

  @override
  Widget build(BuildContext context) {
    final summary = detail.summary;
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _DetailMetricChip(
                label: '出单销售额',
                value: formatMoneyCents(summary.grossSalesAmountCents),
              ),
              _DetailMetricChip(
                label: '退单销售额',
                value: formatMoneyCents(summary.refundAmountCents),
              ),
              _DetailMetricChip(
                label: '净销售额',
                value: formatMoneyCents(summary.netSalesAmountCents),
              ),
              _DetailMetricChip(
                label: '团均销售额',
                value: formatMoneyCents(summary.averageSalesPerGroupCents),
              ),
              _DetailMetricChip(
                label: '人均销售额',
                value: formatMoneyCents(summary.averageSalesPerGuestCents),
              ),
              _DetailMetricChip(
                label: '接待团数',
                value: _formatCount(summary.totalGroupCount),
              ),
              _DetailMetricChip(
                label: '接待人数',
                value: _formatCount(summary.totalGuestCount),
              ),
              _DetailMetricChip(
                label: '打蛋率',
                value: _formatPercent(summary.noOrderRate),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _DetailSection(
            title: '旅行团明细摘要',
            emptyText: '暂无旅行团明细',
            rows: _travelGroupRows(detail.travelGroups),
            hiddenCount: _hiddenCount(detail.travelGroups.length),
          ),
          _DetailSection(
            title: '订单明细摘要',
            emptyText: '暂无订单明细',
            rows: _orderRows(detail.orders),
            hiddenCount: _hiddenCount(detail.orders.length),
          ),
          _DetailSection(
            title: '售后退款明细摘要',
            emptyText: '暂无售后退款明细',
            rows: _afterSalesRows(detail.afterSalesOrders),
            hiddenCount: _hiddenCount(detail.afterSalesOrders.length),
          ),
          if (detail.warnings.isNotEmpty)
            _DetailSection(
              title: '预警摘要',
              emptyText: '暂无预警',
              rows: detail.warnings
                  .take(5)
                  .map(
                    (warning) => _DetailLine(
                      title: _warningTitle(warning),
                      subtitle: _warningSubtitle(warning),
                      trailing: StatusTag(
                        label: _warningTagLabel(warning.code),
                        tone: _warningTone(warning.code),
                      ),
                    ),
                  )
                  .toList(),
              hiddenCount: _hiddenCount(detail.warnings.length),
            ),
        ],
      ),
    );
  }

  List<Widget> _travelGroupRows(List<AnalyticsSourceTravelGroup> groups) {
    return groups
        .take(5)
        .map(
          (group) => _DetailLine(
            title: _fallbackText(group.groupNo, '未命名旅行团'),
            subtitle:
                '${_dateText(group.visitDate)} · ${_formatCount(group.guestCount)} 人 · 净销售额 ${formatMoneyCents(group.netSalesAmountCents)}',
            trailing: group.noEffectiveOrder
                ? const StatusTag(label: '无有效订单', tone: StatusTone.warning)
                : null,
          ),
        )
        .toList();
  }

  List<Widget> _orderRows(List<AnalyticsSourceOrder> orders) {
    return orders
        .take(5)
        .map(
          (order) => _DetailLine(
            title: _fallbackText(order.orderNo, '未命名订单'),
            subtitle:
                '${_dateText(order.orderDate)} · ${_fallbackText(order.customerName, '未知客户')} · 净销售额 ${formatMoneyCents(order.netSalesAmountCents)}',
            trailing: order.refundAmountCents > 0
                ? StatusTag(
                    label: '退款 ${formatMoneyCents(order.refundAmountCents)}',
                    tone: StatusTone.warning,
                  )
                : null,
          ),
        )
        .toList();
  }

  List<Widget> _afterSalesRows(List<AnalyticsSourceAfterSales> afterSales) {
    return afterSales
        .take(5)
        .map(
          (record) => _DetailLine(
            title: _fallbackText(record.afterSalesNo, '未命名售后单'),
            subtitle:
                '${_dateText(record.createdAt)} · 订单 ${_fallbackText(record.salesOrderNo, '未知')} · 退款 ${formatMoneyCents(record.refundAmountCents)}',
            trailing: StatusTag(
              label: record.financeConfirmed ? '已确认' : '未确认',
              tone: record.financeConfirmed
                  ? StatusTone.success
                  : StatusTone.warning,
            ),
          ),
        )
        .toList();
  }
}

class _DetailMetricChip extends StatelessWidget {
  const _DetailMetricChip({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.45),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: Theme.of(context).textTheme.labelMedium,
            ),
            const SizedBox(height: 4),
            Text(
              value,
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ),
    );
  }
}

class _DetailSection extends StatelessWidget {
  const _DetailSection({
    required this.title,
    required this.emptyText,
    required this.rows,
    required this.hiddenCount,
  });

  final String title;
  final String emptyText;
  final List<Widget> rows;
  final int hiddenCount;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
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
          const SizedBox(height: 8),
          if (rows.isEmpty)
            Text(emptyText)
          else ...[
            ...rows,
            if (hiddenCount > 0)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  '还有 $hiddenCount 条未展示',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  final String title;
  final String subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: trailing,
    );
  }
}

class _EmbeddedState extends StatelessWidget {
  const _EmbeddedState({
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
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 30),
          const SizedBox(height: 10),
          Text(
            title,
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w800),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 6),
          Text(message, textAlign: TextAlign.center),
          if (showProgress) ...[
            const SizedBox(height: 14),
            const SizedBox(
              width: 180,
              child: LinearProgressIndicator(),
            ),
          ],
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: onAction,
              icon: const Icon(Icons.refresh_rounded),
              label: Text(actionLabel!),
            ),
          ],
        ],
      ),
    );
  }
}

class _WarningsSection extends StatelessWidget {
  const _WarningsSection({required this.items});

  final List<AppRecordItem> items;

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const ValueKey('analytics-overview-warning-list'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '统计预警',
          style: Theme.of(context)
              .textTheme
              .titleMedium
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        AppRecordList(items: items, compact: true),
      ],
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.errorContainer.withValues(alpha: 0.45),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: scheme.error.withValues(alpha: 0.3)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(Icons.error_outline_rounded, color: scheme.error),
            const SizedBox(width: 10),
            Expanded(child: Text(message)),
            TextButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('重试'),
            ),
          ],
        ),
      ),
    );
  }
}

class _StateCard extends StatelessWidget {
  const _StateCard({
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
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 34),
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
              const SizedBox(
                width: 180,
                child: LinearProgressIndicator(),
              ),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: onAction,
                icon: const Icon(Icons.refresh_rounded),
                label: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
