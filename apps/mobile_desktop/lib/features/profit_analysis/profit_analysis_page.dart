import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';
import 'daily_loss_profit_panel.dart';

typedef TravelGroupProfitFileSaver = Future<String> Function(
  DownloadedFile downloadedFile,
);

const _defaultPreset = 'this_month';
const _customPreset = 'custom';
const _defaultPageSize = 50;

const _presetOptions = <_ProfitPreset>[
  _ProfitPreset('本年', 'this_year'),
  _ProfitPreset('本月', 'this_month'),
  _ProfitPreset('上个月', 'last_month'),
  _ProfitPreset('近10天', 'last_10_days'),
  _ProfitPreset('昨日', 'yesterday'),
  _ProfitPreset('今日', 'today'),
];

const _statusOptions = <_SelectOption>[
  _SelectOption('全部状态', 'all'),
  _SelectOption('完整', 'complete'),
  _SelectOption('估算', 'estimated'),
  _SelectOption('成本不完整', 'incomplete'),
  _SelectOption('无有效销售', 'no_sales'),
];

const _sortOptions = <_SelectOption>[
  _SelectOption('到店日期', 'visitDate'),
  _SelectOption('有效销售额', 'effectiveSalesAmountCents'),
  _SelectOption('预估利润', 'estimatedProfitCents'),
  _SelectOption('利润率', 'estimatedProfitRate'),
];

class ProfitAnalysisPage extends StatefulWidget {
  const ProfitAnalysisPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    this.dailyLossProfitFileSaver,
    this.travelGroupProfitFileSaver,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final DailyLossProfitFileSaver? dailyLossProfitFileSaver;
  final TravelGroupProfitFileSaver? travelGroupProfitFileSaver;

  @override
  State<ProfitAnalysisPage> createState() => _ProfitAnalysisPageState();
}

class _ProfitAnalysisPageState extends State<ProfitAnalysisPage> {
  final TextEditingController _searchController = TextEditingController();
  Timer? _searchDebounce;
  String _preset = _defaultPreset;
  late DateTime _dateFrom;
  late DateTime _dateTo;
  String _status = 'all';
  String _sortBy = 'visitDate';
  String _sortDirection = 'desc';
  int _page = 1;
  ProfitAnalysisResponse? _response;
  bool _loading = false;
  bool _exporting = false;
  String? _errorMessage;
  int _requestSerial = 0;
  String _selectedModule = 'travel_group';
  bool _dailyLossModuleInitialized = false;

  bool get _isAllowed => canViewProfitAnalysis(widget.role);

  @override
  void initState() {
    super.initState();
    final range = _rangeForPreset(_preset, DateTime.now());
    _dateFrom = range.start;
    _dateTo = range.end;
    if (_isAllowed) {
      _loading = true;
      _load(markLoading: false);
    }
  }

  @override
  void didUpdateWidget(covariant ProfitAnalysisPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient == widget.apiClient &&
        oldWidget.token == widget.token &&
        oldWidget.role == widget.role) {
      return;
    }
    _requestSerial += 1;
    if (!_isAllowed) {
      setState(() {
        _response = null;
        _loading = false;
        _errorMessage = null;
      });
      return;
    }
    _page = 1;
    _load();
  }

  @override
  void dispose() {
    _requestSerial += 1;
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_isAllowed) {
      return const ResponsivePage(
        key: ValueKey('profit-analysis-locked'),
        children: [
          _ProfitStateCard(
            icon: Icons.lock_outline_rounded,
            title: '无权访问利润分析',
            message: '当前角色不能查看旅行团利润，也不会发起利润分析请求。',
          ),
        ],
      );
    }

    final response = _response;
    return ResponsivePage(
      key: const ValueKey('profit-analysis-page'),
      maxWidth: 1480,
      children: [
        _buildModuleSwitcher(),
        if (_selectedModule == 'travel_group') ...[
          _buildToolbar(),
          if (_loading && response != null)
            const LinearProgressIndicator(
              key: ValueKey('profit-analysis-refreshing'),
            ),
          if (_loading && response == null)
            const _ProfitStateCard(
              key: ValueKey('profit-analysis-loading'),
              icon: Icons.hourglass_top_rounded,
              title: '正在加载利润分析',
              message: '正在按旅行团汇总销售、成本、费用、提成和返点。',
              showProgress: true,
            )
          else if (_errorMessage != null && response == null)
            _ProfitStateCard(
              key: const ValueKey('profit-analysis-error'),
              icon: Icons.error_outline_rounded,
              title: '利润分析加载失败',
              message: _errorMessage!,
              actionLabel: '重试',
              onAction: _load,
            )
          else if (response != null) ...[
            if (_errorMessage != null)
              _InlineError(
                key: const ValueKey('profit-analysis-inline-error'),
                message: _errorMessage!,
                onRetry: _load,
              ),
            _buildMetrics(response.summary),
            if (response.summary.incompleteGroupCount > 0)
              _IncompleteSummaryNotice(summary: response.summary),
            if (response.items.isEmpty)
              const _ProfitStateCard(
                key: ValueKey('profit-analysis-empty'),
                icon: Icons.inbox_outlined,
                title: '暂无旅行团利润数据',
                message: '当前日期和筛选条件下没有匹配的旅行团。',
              )
            else
              _buildResults(response.items),
            _buildPagination(response.pagination),
          ],
        ],
        if (_dailyLossModuleInitialized)
          Visibility(
            visible: _selectedModule == 'daily_loss',
            maintainState: true,
            child: DailyLossProfitPanel(
              apiClient: widget.apiClient,
              token: widget.token,
              fileSaver: widget.dailyLossProfitFileSaver,
            ),
          ),
      ],
    );
  }

  Widget _buildModuleSwitcher() {
    return Card(
      key: const ValueKey('profit-analysis-module-switcher'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Align(
          alignment: Alignment.centerLeft,
          child: SegmentedButton<String>(
            segments: const [
              ButtonSegment(
                value: 'travel_group',
                icon: Icon(Icons.directions_bus_rounded),
                label: Text(
                  '旅行团利润',
                  key: ValueKey('profit-analysis-travel-module'),
                ),
              ),
              ButtonSegment(
                value: 'daily_loss',
                icon: Icon(Icons.remove_circle_outline_rounded),
                label: Text(
                  '每日损耗利润',
                  key: ValueKey('profit-analysis-daily-loss-module'),
                ),
              ),
            ],
            selected: {_selectedModule},
            showSelectedIcon: false,
            onSelectionChanged: (selection) {
              final selected = selection.first;
              if (selected == _selectedModule) {
                return;
              }
              setState(() {
                _selectedModule = selected;
                if (selected == 'daily_loss') {
                  _dailyLossModuleInitialized = true;
                }
              });
            },
          ),
        ),
      ),
    );
  }

  Widget _buildToolbar() {
    return Card(
      key: const ValueKey('profit-analysis-toolbar'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '利润分析',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                FilledButton.icon(
                  key: const ValueKey('profit-analysis-export-button'),
                  onPressed: _exporting ? null : _export,
                  icon: _exporting
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.download_rounded),
                  label: Text(_exporting ? '导出中' : '导出 Excel'),
                ),
                const SizedBox(width: 6),
                IconButton(
                  key: const ValueKey('profit-analysis-refresh-button'),
                  tooltip: '刷新',
                  onPressed: _loading ? null : _load,
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
                  key: const ValueKey('profit-analysis-date-range'),
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
              ],
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                final narrow = constraints.maxWidth < 760;
                final search = AppSearchField(
                  key: const ValueKey('profit-analysis-search'),
                  controller: _searchController,
                  hintText: '搜索团号、旅行社、导游或品鉴师',
                  onChanged: _onSearchChanged,
                );
                final filters = Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    SizedBox(
                      width: narrow ? constraints.maxWidth : 180,
                      child: DropdownButtonFormField<String>(
                        key: const ValueKey('profit-analysis-status-filter'),
                        initialValue: _status,
                        decoration: const InputDecoration(labelText: '状态'),
                        items: _statusOptions
                            .map(
                              (option) => DropdownMenuItem(
                                value: option.value,
                                child: Text(option.label),
                              ),
                            )
                            .toList(),
                        onChanged: (value) {
                          if (value == null || value == _status) {
                            return;
                          }
                          setState(() {
                            _status = value;
                            _page = 1;
                          });
                          _load();
                        },
                      ),
                    ),
                    SizedBox(
                      width: narrow ? constraints.maxWidth : 190,
                      child: DropdownButtonFormField<String>(
                        key: const ValueKey('profit-analysis-sort-filter'),
                        initialValue: _sortBy,
                        decoration: const InputDecoration(labelText: '排序'),
                        items: _sortOptions
                            .map(
                              (option) => DropdownMenuItem(
                                value: option.value,
                                child: Text(option.label),
                              ),
                            )
                            .toList(),
                        onChanged: (value) {
                          if (value == null || value == _sortBy) {
                            return;
                          }
                          setState(() {
                            _sortBy = value;
                            _page = 1;
                          });
                          _load();
                        },
                      ),
                    ),
                    IconButton.outlined(
                      key: const ValueKey('profit-analysis-sort-direction'),
                      tooltip: _sortDirection == 'desc' ? '当前降序' : '当前升序',
                      onPressed: () {
                        setState(() {
                          _sortDirection =
                              _sortDirection == 'desc' ? 'asc' : 'desc';
                          _page = 1;
                        });
                        _load();
                      },
                      icon: Icon(
                        _sortDirection == 'desc'
                            ? Icons.south_rounded
                            : Icons.north_rounded,
                      ),
                    ),
                  ],
                );
                if (narrow) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      search,
                      const SizedBox(height: 10),
                      filters,
                    ],
                  );
                }
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: search),
                    const SizedBox(width: 12),
                    filters,
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMetrics(ProfitAnalysisSummary summary) {
    final profit = summary.estimatedProfitCents;
    final scheme = Theme.of(context).colorScheme;
    final profitAccent = (profit ?? summary.knownEstimatedProfitCents) < 0
        ? scheme.error
        : scheme.primary;
    return MetricGrid(
      key: const ValueKey('profit-analysis-metrics'),
      metrics: [
        MetricData(
          label: '旅行团数',
          value: '${summary.groupCount}',
          icon: Icons.directions_bus_rounded,
        ),
        MetricData(
          label: '有效销售额',
          value: formatMoneyCents(summary.effectiveSalesAmountCents),
          icon: Icons.point_of_sale_rounded,
        ),
        MetricData(
          label: '税费合计',
          value: _formatNullableMoney(summary.taxFeeCents),
          icon: Icons.receipt_long_rounded,
        ),
        MetricData(
          label: '手续费合计',
          value: _formatNullableMoney(summary.paymentServiceFeeCents),
          icon: Icons.account_balance_wallet_outlined,
        ),
        MetricData(
          label: '可核算团数',
          value: '${summary.calculableGroupCount}',
          icon: Icons.check_circle_outline_rounded,
        ),
        MetricData(
          label: '预估利润',
          value: profit == null
              ? '${formatMoneyCents(summary.knownEstimatedProfitCents)}（已知）'
              : formatMoneyCents(profit),
          icon: Icons.trending_up_rounded,
          accent: profitAccent,
        ),
        MetricData(
          label: '预估利润率',
          value: _formatRate(summary.estimatedProfitRate),
          icon: Icons.percent_rounded,
          accent: profitAccent,
        ),
        MetricData(
          label: '成本不完整团数',
          value: '${summary.incompleteGroupCount}',
          icon: Icons.warning_amber_rounded,
          accent: summary.incompleteGroupCount > 0 ? scheme.error : null,
        ),
      ],
    );
  }

  Widget _buildResults(List<TravelGroupProfitRecord> items) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 980) {
          return _buildDesktopTable(items);
        }
        return _buildNarrowCards(items);
      },
    );
  }

  Widget _buildDesktopTable(List<TravelGroupProfitRecord> items) {
    return Card(
      key: const ValueKey('profit-analysis-table-card'),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          key: const ValueKey('profit-analysis-table'),
          showCheckboxColumn: false,
          columns: const [
            DataColumn(label: Text('到店日期')),
            DataColumn(label: Text('团号')),
            DataColumn(label: Text('旅行社')),
            DataColumn(label: Text('品鉴师')),
            DataColumn(label: Text('有效销售额'), numeric: true),
            DataColumn(label: Text('税费'), numeric: true),
            DataColumn(label: Text('手续费'), numeric: true),
            DataColumn(label: Text('总费用'), numeric: true),
            DataColumn(label: Text('预估利润'), numeric: true),
            DataColumn(label: Text('利润率'), numeric: true),
            DataColumn(label: Text('状态')),
          ],
          rows: [
            for (final item in items)
              DataRow(
                key: ValueKey('profit-analysis-row-${item.travelGroupId}'),
                onSelectChanged: (_) => _showDetail(item),
                cells: [
                  DataCell(Text(_display(item.visitDate))),
                  DataCell(Text(_display(item.groupNo))),
                  DataCell(
                    SizedBox(
                      width: 150,
                      child: Text(
                        _display(item.travelAgency),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                  DataCell(Text(_display(item.tasterName))),
                  DataCell(Text(formatMoneyCents(
                    item.effectiveSalesAmountCents,
                  ))),
                  DataCell(Text(_formatNullableMoney(item.taxFeeCents))),
                  DataCell(
                    Text(_formatNullableMoney(item.paymentServiceFeeCents)),
                  ),
                  DataCell(Text(formatMoneyCents(item.totalExpenseCents))),
                  DataCell(_ProfitText(item: item)),
                  DataCell(Text(_formatRate(item.estimatedProfitRate))),
                  DataCell(_StatusCell(item: item)),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildNarrowCards(List<TravelGroupProfitRecord> items) {
    return Column(
      key: const ValueKey('profit-analysis-card-list'),
      children: [
        for (final item in items) ...[
          Card(
            key: ValueKey('profit-analysis-card-${item.travelGroupId}'),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => _showDetail(item),
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
                                _display(item.groupNo),
                                style: Theme.of(context)
                                    .textTheme
                                    .titleMedium
                                    ?.copyWith(fontWeight: FontWeight.w800),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                '${_display(item.visitDate)} · ${_display(item.travelAgency)}',
                              ),
                              Text('品鉴师：${_display(item.tasterName)}'),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        _StatusCell(item: item),
                      ],
                    ),
                    const Divider(height: 22),
                    Wrap(
                      spacing: 20,
                      runSpacing: 10,
                      children: [
                        _LabeledValue(
                          label: '有效销售额',
                          value:
                              formatMoneyCents(item.effectiveSalesAmountCents),
                        ),
                        _LabeledValue(
                          label: '税费',
                          value: _formatNullableMoney(item.taxFeeCents),
                        ),
                        _LabeledValue(
                          label: '手续费',
                          value: _formatNullableMoney(
                            item.paymentServiceFeeCents,
                          ),
                        ),
                        _LabeledValue(
                          label: '总费用',
                          value: formatMoneyCents(item.totalExpenseCents),
                        ),
                        _LabeledValue(
                          label: '预估利润',
                          value: _profitLabel(item.estimatedProfitCents),
                          valueColor: _profitColor(
                            context,
                            item.estimatedProfitCents,
                          ),
                        ),
                        _LabeledValue(
                          label: '利润率',
                          value: _formatRate(item.estimatedProfitRate),
                        ),
                      ],
                    ),
                    if (item.hasWarning(
                      'REFUND_COST_REVERSAL_UNAVAILABLE',
                    )) ...[
                      const SizedBox(height: 10),
                      Text(
                        '退款成本未冲回，利润为估算',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ],
                ),
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
      key: const ValueKey('profit-analysis-pagination'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            Expanded(
              child: Text(
                '共 ${pagination.total} 个旅行团 · '
                '第 ${pagination.page}/${pagination.totalPages} 页',
              ),
            ),
            IconButton(
              key: const ValueKey('profit-analysis-previous-page'),
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
              key: const ValueKey('profit-analysis-next-page'),
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
    if (!_isAllowed) {
      return;
    }
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
      ).getTravelGroupProfits(
        preset: _preset,
        dateFrom: _dateFrom,
        dateTo: _dateTo,
        query: _searchController.text,
        status: _status == 'all' ? null : _status,
        sortBy: _sortBy,
        sortDirection: _sortDirection,
        page: _page,
        pageSize: _defaultPageSize,
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
    if (_exporting || !_isAllowed) {
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
      ).exportTravelGroupProfits(
        preset: _preset,
        dateFrom: _dateFrom,
        dateTo: _dateTo,
        query: _searchController.text,
        status: _status == 'all' ? null : _status,
        sortBy: _sortBy,
        sortDirection: _sortDirection,
      );
      final savedPath =
          await (widget.travelGroupProfitFileSaver?.call(downloadedFile) ??
              _saveTravelGroupProfitExportFile(downloadedFile));
      if (!mounted) {
        return;
      }
      setState(() => _exporting = false);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(content: Text('旅行团利润已导出：$savedPath')),
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

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) {
        return;
      }
      setState(() => _page = 1);
      _load();
    });
  }

  void _applyPreset(String label) {
    final option = _presetOptions.firstWhere(
      (item) => item.label == label,
      orElse: () => _presetOptions[1],
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

  Future<void> _showDetail(TravelGroupProfitRecord item) {
    return showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        key: ValueKey('profit-analysis-detail-${item.travelGroupId}'),
        title: Text('${_display(item.groupNo)} 费用明细'),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${_display(item.visitDate)} · ${_display(item.travelAgency)}'
                  ' · 品鉴师 ${_display(item.tasterName)}',
                ),
                const SizedBox(height: 12),
                _DetailLine(
                  label: '有效销售额',
                  value: formatMoneyCents(item.effectiveSalesAmountCents),
                ),
                _DetailLine(
                  label: '已确认退款',
                  value: formatMoneyCents(item.confirmedRefundAmountCents),
                ),
                _DetailLine(
                  label: '待确认退款',
                  value: formatMoneyCents(item.pendingRefundAmountCents),
                ),
                const Divider(),
                _DetailLine(
                  label: '商品实际成本（汇总）',
                  value: formatMoneyCents(item.actualProductCostCents),
                ),
                _DetailLine(
                  label: '物流费',
                  value: formatMoneyCents(item.logisticsFeeCents),
                ),
                _DetailLine(
                  label: '停车费',
                  value: formatMoneyCents(item.parkingFeeCents),
                ),
                _DetailLine(
                  label: '香烟费用',
                  value: item.cigaretteFeeCents == null
                      ? '未填写'
                      : formatMoneyCents(item.cigaretteFeeCents!),
                ),
                _DetailLine(
                  label: '销售提成',
                  value: _employeeCommissionDisplay(
                    item,
                    target: 'sales',
                    calculated: item.salesCommissionCalculated,
                    cents: item.salesCommissionCents,
                  ),
                ),
                _DetailLine(
                  label: '组长提成',
                  value: _employeeCommissionDisplay(
                    item,
                    target: 'leader',
                    calculated: item.leaderCommissionCalculated,
                    cents: item.leaderCommissionCents,
                  ),
                ),
                _DetailLine(
                  label: '外联提成',
                  value: _employeeCommissionDisplay(
                    item,
                    target: 'outreach',
                    calculated: item.outreachCommissionCalculated,
                    cents: item.outreachCommissionCents,
                  ),
                ),
                _DetailLine(
                  label: '品鉴师提成（汇总）',
                  value: formatMoneyCents(item.tasterCommissionCents),
                ),
                _DetailLine(
                  label: '旅行社日返',
                  value: formatMoneyCents(item.dailyAgencyRebateCents),
                ),
                _DetailLine(
                  label: '旅行社月返',
                  value: formatMoneyCents(item.monthlyAgencyRebateCents),
                ),
                _DetailLine(
                  label: '税费',
                  value: _formatNullableMoney(item.taxFeeCents),
                ),
                _DetailLine(
                  label: '付款手续费',
                  value: _formatNullableMoney(
                    item.paymentServiceFeeCents,
                  ),
                ),
                if (item.paymentMethodFeeBreakdown.isNotEmpty)
                  _PaymentMethodFeeBreakdown(
                    rows: item.paymentMethodFeeBreakdown,
                  ),
                const Divider(),
                _DetailLine(
                  label: '总费用',
                  value: formatMoneyCents(item.totalExpenseCents),
                  emphasized: true,
                ),
                _DetailLine(
                  label: '预估利润',
                  value: _profitLabel(item.estimatedProfitCents),
                  valueColor: _profitColor(context, item.estimatedProfitCents),
                  emphasized: true,
                ),
                _DetailLine(
                  label: '利润率',
                  value: _formatRate(item.estimatedProfitRate),
                  emphasized: true,
                ),
                const SizedBox(height: 8),
                _StatusCell(item: item),
                if (item.warnings.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    '核算提示',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 6),
                  for (final warning in item.warnings)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 5),
                      child: Text(
                        '• ${_warningText(warning)}',
                        key: ValueKey(
                          'profit-analysis-warning-${warning.code}',
                        ),
                      ),
                    ),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
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

class _StatusCell extends StatelessWidget {
  const _StatusCell({required this.item});

  final TravelGroupProfitRecord item;

  @override
  Widget build(BuildContext context) {
    final status = _statusPresentation(item.calculationStatus);
    final refundEstimate = item.hasWarning('REFUND_COST_REVERSAL_UNAVAILABLE');
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        StatusTag(label: status.label, tone: status.tone),
        if (refundEstimate)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              '退款成本未冲回',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: Theme.of(context).colorScheme.error,
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
      ],
    );
  }
}

class _ProfitText extends StatelessWidget {
  const _ProfitText({required this.item});

  final TravelGroupProfitRecord item;

  @override
  Widget build(BuildContext context) {
    return Text(
      _profitLabel(item.estimatedProfitCents),
      style: TextStyle(
        color: _profitColor(context, item.estimatedProfitCents),
        fontWeight: FontWeight.w800,
      ),
    );
  }
}

class _LabeledValue extends StatelessWidget {
  const _LabeledValue({
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
      width: 150,
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

class _DetailLine extends StatelessWidget {
  const _DetailLine({
    required this.label,
    required this.value,
    this.valueColor,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final Color? valueColor;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final style = emphasized
        ? Theme.of(context)
            .textTheme
            .bodyLarge
            ?.copyWith(fontWeight: FontWeight.w800)
        : Theme.of(context).textTheme.bodyMedium;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          const SizedBox(width: 12),
          Text(
            value,
            style: style?.copyWith(color: valueColor),
            textAlign: TextAlign.end,
          ),
        ],
      ),
    );
  }
}

class _PaymentMethodFeeBreakdown extends StatelessWidget {
  const _PaymentMethodFeeBreakdown({required this.rows});

  final List<PaymentMethodFeeBreakdownRecord> rows;

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      key: const ValueKey('profit-analysis-payment-fee-breakdown'),
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(bottom: 8),
      title: const Text('付款方式手续费明细'),
      subtitle: Text('${rows.length} 组历史费率'),
      children: [
        for (var index = 0; index < rows.length; index += 1)
          Card(
            key: ValueKey('profit-analysis-payment-fee-row-$index'),
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _DetailLine(
                    label: '付款方式',
                    value: _displayPaymentMethod(rows[index]),
                    emphasized: true,
                  ),
                  _DetailLine(
                    label: '费率',
                    value: _formatServiceFeeRate(
                      rows[index].serviceFeeRateSnapshot,
                    ),
                  ),
                  _DetailLine(
                    label: '原付款金额',
                    value: _formatNullableMoney(
                      rows[index].originalPaymentAmountCents,
                    ),
                  ),
                  _DetailLine(
                    label: '当天退款扣减',
                    value: formatMoneyCents(
                      rows[index].sameDayRefundAmountCents,
                    ),
                  ),
                  _DetailLine(
                    label: '手续费基数',
                    value: _formatNullableMoney(
                      rows[index].serviceFeeBaseAmountCents,
                    ),
                  ),
                  _DetailLine(
                    label: '手续费',
                    value: _formatNullableMoney(
                      rows[index].serviceFeeCents,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _IncompleteSummaryNotice extends StatelessWidget {
  const _IncompleteSummaryNotice({required this.summary});

  final ProfitAnalysisSummary summary;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      key: const ValueKey('profit-analysis-incomplete-summary'),
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
                '总预估利润未包含 ${summary.incompleteGroupCount} 个成本不完整旅行团。'
                '当前仅显示已知团利润 '
                '${formatMoneyCents(summary.knownEstimatedProfitCents)}，'
                '不能视为完整总利润。',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProfitStateCard extends StatelessWidget {
  const _ProfitStateCard({
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

class _InlineError extends StatelessWidget {
  const _InlineError({
    super.key,
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

class _ProfitPreset {
  const _ProfitPreset(this.label, this.value);

  final String label;
  final String value;
}

class _SelectOption {
  const _SelectOption(this.label, this.value);

  final String label;
  final String value;
}

class _StatusPresentation {
  const _StatusPresentation(this.label, this.tone);

  final String label;
  final StatusTone tone;
}

_StatusPresentation _statusPresentation(String status) {
  switch (status) {
    case 'complete':
      return const _StatusPresentation('完整', StatusTone.success);
    case 'estimated':
      return const _StatusPresentation('估算', StatusTone.warning);
    case 'no_sales':
      return const _StatusPresentation('无有效销售', StatusTone.neutral);
    case 'incomplete':
    default:
      return const _StatusPresentation(
        '成本不完整/无法估算',
        StatusTone.danger,
      );
  }
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
      final firstOfThisMonth = DateTime(today.year, today.month);
      final lastOfLastMonth =
          firstOfThisMonth.subtract(const Duration(days: 1));
      return DateTimeRange(
        start: DateTime(lastOfLastMonth.year, lastOfLastMonth.month),
        end: lastOfLastMonth,
      );
    case 'this_year':
      return DateTimeRange(start: DateTime(today.year), end: today);
    case 'this_month':
    default:
      return DateTimeRange(
        start: DateTime(today.year, today.month),
        end: today,
      );
  }
}

DateTime _dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

String _formatRate(double? rate) {
  if (rate == null) {
    return '—';
  }
  return '${(rate * 100).toStringAsFixed(1)}%';
}

String _formatNullableMoney(int? cents) {
  return cents == null ? '—' : formatMoneyCents(cents);
}

String _formatServiceFeeRate(String? rate) {
  final parsed = double.tryParse(rate?.trim() ?? '');
  if (parsed == null) {
    return '—';
  }
  final fixed = (parsed * 100).toStringAsFixed(4);
  final normalized =
      fixed.replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
  return '$normalized%';
}

String _displayPaymentMethod(PaymentMethodFeeBreakdownRecord row) {
  final name = row.paymentMethodNameSnapshot.trim();
  if (name.isNotEmpty) {
    return name;
  }
  return row.paymentMethodId?.trim().isNotEmpty == true
      ? row.paymentMethodId!.trim()
      : '未命名付款方式';
}

String _profitLabel(int? cents) {
  if (cents == null) {
    return '无法估算';
  }
  if (cents < 0) {
    return '亏损 ${formatMoneyCents(cents)}';
  }
  if (cents > 0) {
    return '盈利 ${formatMoneyCents(cents)}';
  }
  return '持平 ${formatMoneyCents(0)}';
}

Color? _profitColor(BuildContext context, int? cents) {
  if (cents == null) {
    return Theme.of(context).colorScheme.onSurfaceVariant;
  }
  return cents < 0
      ? Theme.of(context).colorScheme.error
      : Theme.of(context).colorScheme.primary;
}

String _warningText(AnalyticsWarning warning) {
  switch (warning.code) {
    case 'SALES_COMMISSION_NOT_CALCULATED_MISSING_SALES_USER':
      return '未计算：订单缺少销售人员。';
    case 'OUTREACH_COMMISSION_NOT_CALCULATED_MISSING_OUTREACH_USER':
      return '未计算：订单缺少外联人员。';
    case 'LEADER_COMMISSION_NOT_CALCULATED_MISSING_LEADER':
      return '未计算：订单缺少组长配置。';
    case 'SALES_COMMISSION_NOT_CALCULATED_MISSING_RULE':
      return '销售提成未计算：订单日期缺少适用规则。';
    case 'OUTREACH_COMMISSION_NOT_CALCULATED_MISSING_RULE':
      return '外联提成未计算：订单日期缺少适用规则。';
    case 'LEADER_COMMISSION_NOT_CALCULATED_MISSING_RULE':
      return '组长提成未计算：订单日期缺少适用规则。';
    case 'REFUND_COST_REVERSAL_UNAVAILABLE':
      return '退款成本未冲回，利润为估算。';
    case 'PENDING_REFUND_CONFIRMATION':
      return '存在待财务确认退款，当前销售额尚未扣除。';
    case 'FINANCE_SUMMARY_MISSING':
      return '财务汇总缺失，返点使用兼容数据估算。';
    case 'ACTUAL_COST_COVERAGE_PARTIAL':
    case 'ACTUAL_COST_COVERAGE_UNAVAILABLE':
      return '商品实际成本快照不完整，无法估算利润。';
    case 'PAYMENT_SERVICE_FEE_SNAPSHOT_MISSING':
      return '手续费快照缺失，请财务补齐费率并重新标记订单';
    default:
      return warning.message.isEmpty ? warning.code : warning.message;
  }
}

String _employeeCommissionDisplay(
  TravelGroupProfitRecord item, {
  required String target,
  required bool calculated,
  required int cents,
}) {
  if (calculated) {
    return formatMoneyCents(cents);
  }
  final missingPersonCodes = <String, String>{
    'sales': 'SALES_COMMISSION_NOT_CALCULATED_MISSING_SALES_USER',
    'outreach': 'OUTREACH_COMMISSION_NOT_CALCULATED_MISSING_OUTREACH_USER',
    'leader': 'LEADER_COMMISSION_NOT_CALCULATED_MISSING_LEADER',
  };
  final labels = <String, String>{
    'sales': '销售人员',
    'outreach': '外联人员',
    'leader': '组长配置',
  };
  if (item.hasWarning(missingPersonCodes[target] ?? '')) {
    return '未计算：订单缺少${labels[target]}';
  }
  return '未计算：订单日期缺少适用提成规则';
}

String _display(String value) => value.trim().isEmpty ? '—' : value.trim();

String _friendlyError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '请求失败，请稍后重试。';
}

Future<String> _saveTravelGroupProfitExportFile(
  DownloadedFile downloadedFile,
) async {
  final directory = await getApplicationDocumentsDirectory();
  final exportDirectory = Directory(
    '${directory.path}${Platform.pathSeparator}exports',
  );
  await exportDirectory.create(recursive: true);
  final fileName = _safeTravelGroupProfitExportFileName(
    downloadedFile.fileName,
  );
  var target = File(
    '${exportDirectory.path}${Platform.pathSeparator}$fileName',
  );
  if (await target.exists()) {
    final dot = fileName.lastIndexOf('.');
    final stem = dot > 0 ? fileName.substring(0, dot) : fileName;
    final extension = dot > 0 ? fileName.substring(dot) : '';
    for (var suffix = 2;; suffix += 1) {
      target = File(
        '${exportDirectory.path}${Platform.pathSeparator}'
        '$stem-$suffix$extension',
      );
      if (!await target.exists()) {
        break;
      }
    }
  }
  await target.writeAsBytes(downloadedFile.bytes, flush: true);
  return target.path;
}

String _safeTravelGroupProfitExportFileName(String? value) {
  final source = (value ?? '').trim();
  final sanitized =
      source.replaceAll(RegExp(r'[<>:"/\\|?*\x00-\x1F]'), '_').trim();
  if (sanitized.isEmpty) {
    return 'travel-group-profits.xlsx';
  }
  return sanitized.toLowerCase().endsWith('.xlsx')
      ? sanitized
      : '$sanitized.xlsx';
}
