import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/money_text.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class TravelGroupFinanceSupplementPage extends StatefulWidget {
  const TravelGroupFinanceSupplementPage({
    super.key,
    required this.apiClient,
    required this.token,
    this.documentsDirectoryProvider,
  });

  final ApiClient apiClient;
  final String token;
  final Future<Directory> Function()? documentsDirectoryProvider;

  @override
  State<TravelGroupFinanceSupplementPage> createState() =>
      _TravelGroupFinanceSupplementPageState();
}

class _TravelGroupFinanceSupplementPageState
    extends State<TravelGroupFinanceSupplementPage> {
  late BusinessApi _businessApi;
  late final TextEditingController _agencyFilterController;
  late final TextEditingController _guideFilterController;
  late final TextEditingController _unreturnedPointsFilterController;

  List<TravelGroupFinanceSummaryRecord> _summaries =
      const <TravelGroupFinanceSummaryRecord>[];
  final Set<String> _selectedTravelGroupIds = <String>{};
  final Set<String> _guideImageReadyIds = <String>{};
  final Set<String> _travelAgencyImageReadyIds = <String>{};
  final Set<String> _imageExportingKeys = <String>{};
  final Set<String> _rebateUpdatingKeys = <String>{};
  final Set<String> _sentUpdatingKeys = <String>{};

  String _agencyQuery = '';
  String _guideQuery = '';
  DateTimeRange? _dateRange;
  String _tasterFilter = _allFilter;
  String _unreturnedPointsQuery = '';
  String _guideInfoSentFilter = _allFilter;
  String _travelAgencyInfoSentFilter = _allFilter;
  String _statusFilter = _allFilter;
  bool _loading = true;
  String? _errorMessage;
  String? _successMessage;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _agencyFilterController = TextEditingController();
    _guideFilterController = TextEditingController();
    _unreturnedPointsFilterController = TextEditingController();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant TravelGroupFinanceSupplementPage oldWidget) {
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
    _agencyFilterController.dispose();
    _guideFilterController.dispose();
    _unreturnedPointsFilterController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final summaries = await _businessApi.listTravelGroupFinanceSummaries(
        limit: 200,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _summaries = summaries;
        _selectedTravelGroupIds.removeWhere(
          (id) => summaries.every((summary) => summary.travelGroupId != id),
        );
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

  List<TravelGroupFinanceSummaryRecord> get _visibleSummaries {
    final agencyQuery = _agencyQuery.trim().toLowerCase();
    final guideQuery = _guideQuery.trim().toLowerCase();
    final unreturnedPointsFilter = int.tryParse(_unreturnedPointsQuery.trim());

    return _summaries.where((summary) {
      final group = summary.travelGroup;
      if (_dateRange != null) {
        final date = _dateFromText(group?.visitDate ?? '');
        if (date == null ||
            date.isBefore(_dateRange!.start) ||
            date.isAfter(_dateRange!.end)) {
          return false;
        }
      }
      if (agencyQuery.isNotEmpty &&
          !_text(group?.travelAgency).toLowerCase().contains(agencyQuery)) {
        return false;
      }
      if (guideQuery.isNotEmpty &&
          !_text(group?.guideName).toLowerCase().contains(guideQuery)) {
        return false;
      }
      if (_tasterFilter != _allFilter &&
          _text(group?.tasterName) != _tasterFilter) {
        return false;
      }
      if (unreturnedPointsFilter != null &&
          summary.unpaidRebateCents != unreturnedPointsFilter) {
        return false;
      }
      if (!_matchesSentFilter(summary.guideInfoSent, _guideInfoSentFilter)) {
        return false;
      }
      if (!_matchesSentFilter(
        summary.travelAgencyInfoSent,
        _travelAgencyInfoSentFilter,
      )) {
        return false;
      }
      if (_statusFilter != _allFilter &&
          _summaryStatus(summary) != _statusFilter) {
        return false;
      }
      return true;
    }).toList();
  }

  int get _visibleOrderAmountCents {
    return _visibleSummaries.fold<int>(
      0,
      (sum, summary) => sum + summary.totalAgencyNetAmountCents,
    );
  }

  int get _visibleReturnedAmountCents {
    return _visibleSummaries.fold<int>(
      0,
      (sum, summary) => sum + summary.paidRebateCents,
    );
  }

  List<String> get _tasterOptions {
    final options = _summaries
        .map((summary) => _text(summary.travelGroup?.tasterName).trim())
        .where((name) => name.isNotEmpty)
        .toSet()
        .toList();
    options.sort();
    return options;
  }

  DateTime get _datePickerInitialDate {
    final dates = _summaries
        .map((summary) => _dateFromText(summary.travelGroup?.visitDate ?? ''))
        .whereType<DateTime>()
        .toList();
    if (dates.isEmpty) {
      return DateTime.now();
    }
    dates.sort();
    return dates.last;
  }

  void _clearFilters() {
    setState(() {
      _agencyFilterController.clear();
      _guideFilterController.clear();
      _unreturnedPointsFilterController.clear();
      _agencyQuery = '';
      _guideQuery = '';
      _dateRange = null;
      _tasterFilter = _allFilter;
      _unreturnedPointsQuery = '';
      _guideInfoSentFilter = _allFilter;
      _travelAgencyInfoSentFilter = _allFilter;
      _statusFilter = _allFilter;
    });
  }

  void _toggleSelection(String travelGroupId, bool selected) {
    setState(() {
      if (selected) {
        _selectedTravelGroupIds.add(travelGroupId);
      } else {
        _selectedTravelGroupIds.remove(travelGroupId);
      }
    });
  }

  void _toggleVisibleSelection(bool selected) {
    setState(() {
      final ids = _visibleSummaries.map((summary) => summary.travelGroupId);
      if (selected) {
        _selectedTravelGroupIds.addAll(ids);
      } else {
        _selectedTravelGroupIds.removeAll(ids);
      }
    });
  }

  Future<void> _setDailyRebatePaid(
    TravelGroupFinanceSummaryRecord summary,
    bool isPaid,
  ) {
    return _runSummaryAction(
      busyKey: '${summary.travelGroupId}:dailyRebatePaid',
      action: () => _businessApi.setDailyRebatePaid(
        summary.travelGroupId,
        isPaid,
      ),
      successMessage: isPaid ? '已标记日返积分已返' : '已取消日返积分已返',
      busySet: _rebateUpdatingKeys,
    );
  }

  Future<void> _setMonthlyRebatePaid(
    TravelGroupFinanceSummaryRecord summary,
    bool isPaid,
  ) {
    return _runSummaryAction(
      busyKey: '${summary.travelGroupId}:monthlyRebatePaid',
      action: () => _businessApi.setMonthlyRebatePaid(
        summary.travelGroupId,
        isPaid,
      ),
      successMessage: isPaid ? '已标记月返积分已返' : '已取消月返积分已返',
      busySet: _rebateUpdatingKeys,
    );
  }

  Future<void> _setGuideInfoSent(
    TravelGroupFinanceSummaryRecord summary,
    bool value,
  ) {
    if (value && !_guideImageReadyIds.contains(summary.travelGroupId)) {
      return Future<void>.value();
    }
    return _runSummaryAction(
      busyKey: '${summary.travelGroupId}:guideInfoSent',
      action: () => _businessApi.updateTravelGroupFinanceSummary(
        summary.travelGroupId,
        {'guideInfoSent': value},
      ),
      successMessage: value ? '已标记导游信息已发送' : '已取消导游信息发送标记',
      busySet: _sentUpdatingKeys,
    );
  }

  Future<void> _setTravelAgencyInfoSent(
    TravelGroupFinanceSummaryRecord summary,
    bool value,
  ) {
    if (value && !_travelAgencyImageReadyIds.contains(summary.travelGroupId)) {
      return Future<void>.value();
    }
    return _runSummaryAction(
      busyKey: '${summary.travelGroupId}:travelAgencyInfoSent',
      action: () => _businessApi.updateTravelGroupFinanceSummary(
        summary.travelGroupId,
        {'travelAgencyInfoSent': value},
      ),
      successMessage: value ? '已标记旅行社信息已发送' : '已取消旅行社信息发送标记',
      busySet: _sentUpdatingKeys,
    );
  }

  Future<void> _runSummaryAction({
    required String busyKey,
    required Future<TravelGroupFinanceSummaryRecord> Function() action,
    required String successMessage,
    required Set<String> busySet,
  }) async {
    if (busySet.contains(busyKey)) {
      return;
    }
    setState(() {
      busySet.add(busyKey);
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final updated = await action();
      if (!mounted) {
        return;
      }
      setState(() {
        busySet.remove(busyKey);
        _replaceSummary(updated);
        _successMessage = successMessage;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        busySet.remove(busyKey);
        _errorMessage = _messageForError(error);
      });
    }
  }

  void _replaceSummary(TravelGroupFinanceSummaryRecord updated) {
    _summaries = [
      for (final summary in _summaries)
        summary.travelGroupId == updated.travelGroupId ? updated : summary,
    ];
  }

  Future<void> _exportSelectedImages(_FinanceImageType type) async {
    final selected = _summaries
        .where(
          (summary) => _selectedTravelGroupIds.contains(summary.travelGroupId),
        )
        .toList();
    for (final summary in selected) {
      await _exportImage(summary, type, showSnackBar: false);
    }
    if (!mounted || selected.isEmpty) {
      return;
    }
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('已导出 ${selected.length} 张${type.label}')),
    );
  }

  Future<void> _exportImage(
    TravelGroupFinanceSummaryRecord summary,
    _FinanceImageType type, {
    bool showSnackBar = true,
  }) async {
    final busyKey = '${summary.travelGroupId}:${type.name}';
    if (_imageExportingKeys.contains(busyKey)) {
      return;
    }
    setState(() {
      _imageExportingKeys.add(busyKey);
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final bytes = await _renderImageBytes(summary, type);
      final file = await _writeImageFile(summary, type, bytes);
      if (!mounted) {
        return;
      }
      setState(() {
        _imageExportingKeys.remove(busyKey);
        if (type == _FinanceImageType.guide) {
          _guideImageReadyIds.add(summary.travelGroupId);
        } else {
          _travelAgencyImageReadyIds.add(summary.travelGroupId);
        }
        _successMessage = '${type.label}已导出：${file.path}';
      });
      if (showSnackBar) {
        ScaffoldMessenger.of(context).hideCurrentSnackBar();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${type.label}已导出：${file.path}')),
        );
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _imageExportingKeys.remove(busyKey);
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<Uint8List> _renderImageBytes(
    TravelGroupFinanceSummaryRecord summary,
    _FinanceImageType type,
  ) async {
    final repaintKey = GlobalKey();
    final overlay = Overlay.of(context, rootOverlay: true);
    final entry = OverlayEntry(
      builder: (context) => Positioned(
        left: 0,
        top: 0,
        child: IgnorePointer(
          child: Opacity(
            opacity: 0.01,
            child: Material(
              color: Colors.transparent,
              child: RepaintBoundary(
                key: repaintKey,
                child: _FinanceExportImageCard(
                  summary: summary,
                  type: type,
                ),
              ),
            ),
          ),
        ),
      ),
    );

    overlay.insert(entry);
    await WidgetsBinding.instance.endOfFrame;
    await WidgetsBinding.instance.endOfFrame;
    final boundary =
        repaintKey.currentContext?.findRenderObject() as RenderRepaintBoundary?;
    if (boundary == null) {
      entry.remove();
      throw StateError('无法生成图片。');
    }
    final image = await boundary.toImage(pixelRatio: 2);
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    entry.remove();
    final bytes = byteData?.buffer.asUint8List();
    if (bytes == null || bytes.isEmpty) {
      throw StateError('无法生成图片。');
    }
    return bytes;
  }

  Future<File> _writeImageFile(
    TravelGroupFinanceSummaryRecord summary,
    _FinanceImageType type,
    Uint8List bytes,
  ) async {
    final directory = await (widget.documentsDirectoryProvider?.call() ??
        getApplicationDocumentsDirectory());
    final exportDirectory = Directory(
      '${directory.path}${Platform.pathSeparator}exports'
      '${Platform.pathSeparator}finance-images',
    );
    await exportDirectory.create(recursive: true);
    final targetFile = await _nextExportFile(
      exportDirectory,
      _imageFileName(summary, type),
    );
    await targetFile.writeAsBytes(bytes, flush: true);
    return targetFile;
  }

  String _imageFileName(
    TravelGroupFinanceSummaryRecord summary,
    _FinanceImageType type,
  ) {
    final group = summary.travelGroup;
    final date = _dateOnlyText(group?.visitDate ?? '');
    final safeDate = date.isEmpty ? '未知日期' : date;
    final agency = _text(group?.travelAgency, fallback: '未知旅行社');
    final guide = _text(group?.guideName, fallback: '未知导游');
    return _safeExportFileName('$safeDate-$agency-$guide-${type.label}.png');
  }

  @override
  Widget build(BuildContext context) {
    final visibleSummaries = _visibleSummaries;
    final selectedVisibleCount = visibleSummaries
        .where(
          (summary) => _selectedTravelGroupIds.contains(summary.travelGroupId),
        )
        .length;

    return ResponsivePage(
      maxWidth: 1480,
      children: [
        FormSection(
          title: '筛选条件',
          trailing: StatusTag(
            label: '${visibleSummaries.length} 行',
            tone: StatusTone.info,
          ),
          children: [
            ResponsiveFormGrid(
              children: [
                TextField(
                  key: const ValueKey('finance-filter-agency'),
                  controller: _agencyFilterController,
                  decoration: const InputDecoration(labelText: '旅行社'),
                  onChanged: (value) => setState(() => _agencyQuery = value),
                ),
                TextField(
                  key: const ValueKey('finance-filter-guide'),
                  controller: _guideFilterController,
                  decoration: const InputDecoration(labelText: '导游'),
                  onChanged: (value) => setState(() => _guideQuery = value),
                ),
                _DateRangeFilter(
                  value: _dateRange,
                  initialDate: _datePickerInitialDate,
                  onChanged: (value) => setState(() => _dateRange = value),
                ),
                _FilterDropdown(
                  controlKey: const ValueKey('finance-filter-taster'),
                  label: '品鉴师',
                  value: _tasterFilter,
                  items: [
                    const MapEntry(_allFilter, '全部'),
                    for (final taster in _tasterOptions)
                      MapEntry(taster, taster),
                  ],
                  onChanged: (value) => setState(() => _tasterFilter = value),
                ),
                TextField(
                  key: const ValueKey('finance-filter-unreturned-points'),
                  controller: _unreturnedPointsFilterController,
                  keyboardType: TextInputType.number,
                  inputFormatters: const [_NonNegativeIntegerFormatter()],
                  decoration: const InputDecoration(
                    labelText: '未返积分',
                    hintText: '请输入非负整数',
                  ),
                  onChanged: (value) => setState(
                    () => _unreturnedPointsQuery = value,
                  ),
                ),
                _FilterDropdown(
                  controlKey: const ValueKey('finance-filter-guide-info-sent'),
                  label: '导游信息发送',
                  value: _guideInfoSentFilter,
                  items: _sentFilterItems,
                  onChanged: (value) =>
                      setState(() => _guideInfoSentFilter = value),
                ),
                _FilterDropdown(
                  controlKey: const ValueKey('finance-filter-agency-info-sent'),
                  label: '旅行社信息发送',
                  value: _travelAgencyInfoSentFilter,
                  items: _sentFilterItems,
                  onChanged: (value) =>
                      setState(() => _travelAgencyInfoSentFilter = value),
                ),
                _FilterDropdown(
                  controlKey: const ValueKey('finance-filter-status'),
                  label: '状态',
                  value: _statusFilter,
                  items: const [
                    MapEntry(_allFilter, '全部'),
                    MapEntry(_statusPending, '待返'),
                    MapEntry(_statusComplete, '已完成'),
                  ],
                  onChanged: (value) => setState(() => _statusFilter = value),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  TextButton.icon(
                    key: const ValueKey('finance-filter-clear'),
                    onPressed: _clearFilters,
                    icon: const Icon(Icons.filter_alt_off_rounded),
                    label: const Text('清空筛选'),
                  ),
                  OutlinedButton.icon(
                    key: const ValueKey('finance-refresh-button'),
                    onPressed: _loading ? null : _loadData,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('刷新'),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        if (_successMessage != null)
          _InlineNotice(message: _successMessage!, tone: StatusTone.success),
        _FinanceSummaryStrip(
          visibleCount: visibleSummaries.length,
          totalCount: _summaries.length,
          orderAmountCents: _visibleOrderAmountCents,
          returnedAmountCents: _visibleReturnedAmountCents,
          pendingCount: visibleSummaries
              .where((summary) => _summaryStatus(summary) == _statusPending)
              .length,
        ),
        FormSection(
          title: '积分表',
          trailing: Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              StatusTag(
                label: '已选 $selectedVisibleCount 行',
                tone: selectedVisibleCount == 0
                    ? StatusTone.neutral
                    : StatusTone.info,
              ),
              OutlinedButton.icon(
                key: const ValueKey('finance-export-guide-images-button'),
                onPressed: selectedVisibleCount == 0
                    ? null
                    : () => _exportSelectedImages(_FinanceImageType.guide),
                icon: const Icon(Icons.badge_rounded),
                label: const Text('批量导出导游图片'),
              ),
              OutlinedButton.icon(
                key: const ValueKey('finance-export-agency-images-button'),
                onPressed: selectedVisibleCount == 0
                    ? null
                    : () =>
                        _exportSelectedImages(_FinanceImageType.travelAgency),
                icon: const Icon(Icons.apartment_rounded),
                label: const Text('批量导出旅行社图片'),
              ),
            ],
          ),
          children: [
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 28),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (visibleSummaries.isEmpty)
              const _EmptyFinanceTable()
            else
              _FinancePointTable(
                summaries: visibleSummaries,
                selectedTravelGroupIds: _selectedTravelGroupIds,
                guideImageReadyIds: _guideImageReadyIds,
                travelAgencyImageReadyIds: _travelAgencyImageReadyIds,
                imageExportingKeys: _imageExportingKeys,
                rebateUpdatingKeys: _rebateUpdatingKeys,
                sentUpdatingKeys: _sentUpdatingKeys,
                onSelectionChanged: _toggleSelection,
                onSelectAllChanged: _toggleVisibleSelection,
                onDailyRebatePaidChanged: _setDailyRebatePaid,
                onMonthlyRebatePaidChanged: _setMonthlyRebatePaid,
                onExportImage: _exportImage,
                onGuideInfoSentChanged: _setGuideInfoSent,
                onTravelAgencyInfoSentChanged: _setTravelAgencyInfoSent,
              ),
          ],
        ),
      ],
    );
  }
}

class _DateRangeFilter extends StatelessWidget {
  const _DateRangeFilter({
    required this.value,
    required this.initialDate,
    required this.onChanged,
  });

  final DateTimeRange? value;
  final DateTime initialDate;
  final ValueChanged<DateTimeRange?> onChanged;

  Future<void> _pickRange(BuildContext context) async {
    final initialRange = value ??
        DateTimeRange(
          start: initialDate,
          end: initialDate,
        );
    final result = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
      initialDateRange: initialRange,
      locale: const Locale('zh', 'CN'),
      helpText: '选择日期范围',
      cancelText: '取消',
      confirmText: '确定',
      saveText: '确定',
      fieldStartHintText: '开始日期',
      fieldEndHintText: '结束日期',
      fieldStartLabelText: '开始日期',
      fieldEndLabelText: '结束日期',
      errorFormatText: '请输入正确日期',
      errorInvalidText: '日期无效',
      errorInvalidRangeText: '结束日期不能早于开始日期',
    );
    if (result != null) {
      onChanged(
        DateTimeRange(
          start: _dateOnly(result.start),
          end: _dateOnly(result.end),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final label = value == null
        ? '全部日期'
        : '${_formatDate(value!.start)} 至 ${_formatDate(value!.end)}';
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: const ValueKey('finance-filter-date'),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        onTap: () => _pickRange(context),
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: '日期',
            prefixIcon: const Icon(Icons.date_range_rounded),
            suffixIcon: value == null
                ? null
                : IconButton(
                    key: const ValueKey('finance-filter-date-clear'),
                    tooltip: '清除日期',
                    onPressed: () => onChanged(null),
                    icon: const Icon(Icons.close_rounded),
                  ),
          ),
          child: Text(label, overflow: TextOverflow.ellipsis),
        ),
      ),
    );
  }
}

class _FilterDropdown extends StatelessWidget {
  const _FilterDropdown({
    required this.controlKey,
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  final Key controlKey;
  final String label;
  final String value;
  final List<MapEntry<String, String>> items;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final values = items.map((item) => item.key).toSet();
    final safeValue = values.contains(value) ? value : _allFilter;
    return InputDecorator(
      decoration: InputDecoration(labelText: label),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          key: controlKey,
          value: safeValue,
          isExpanded: true,
          isDense: true,
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
        ),
      ),
    );
  }
}

class _FinanceSummaryStrip extends StatelessWidget {
  const _FinanceSummaryStrip({
    required this.visibleCount,
    required this.totalCount,
    required this.orderAmountCents,
    required this.returnedAmountCents,
    required this.pendingCount,
  });

  final int visibleCount;
  final int totalCount;
  final int orderAmountCents;
  final int returnedAmountCents;
  final int pendingCount;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        StatusTag(
            label: '当前显示 $visibleCount/$totalCount 行', tone: StatusTone.info),
        StatusTag(label: '待返 $pendingCount 行', tone: StatusTone.warning),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('上单金额 '),
            MoneyText(cents: orderAmountCents),
          ],
        ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('已返积分 '),
            MoneyText(cents: returnedAmountCents),
          ],
        ),
      ],
    );
  }
}

class _FinancePointTable extends StatelessWidget {
  const _FinancePointTable({
    required this.summaries,
    required this.selectedTravelGroupIds,
    required this.guideImageReadyIds,
    required this.travelAgencyImageReadyIds,
    required this.imageExportingKeys,
    required this.rebateUpdatingKeys,
    required this.sentUpdatingKeys,
    required this.onSelectionChanged,
    required this.onSelectAllChanged,
    required this.onDailyRebatePaidChanged,
    required this.onMonthlyRebatePaidChanged,
    required this.onExportImage,
    required this.onGuideInfoSentChanged,
    required this.onTravelAgencyInfoSentChanged,
  });

  final List<TravelGroupFinanceSummaryRecord> summaries;
  final Set<String> selectedTravelGroupIds;
  final Set<String> guideImageReadyIds;
  final Set<String> travelAgencyImageReadyIds;
  final Set<String> imageExportingKeys;
  final Set<String> rebateUpdatingKeys;
  final Set<String> sentUpdatingKeys;
  final void Function(String travelGroupId, bool selected) onSelectionChanged;
  final ValueChanged<bool> onSelectAllChanged;
  final Future<void> Function(TravelGroupFinanceSummaryRecord, bool)
      onDailyRebatePaidChanged;
  final Future<void> Function(TravelGroupFinanceSummaryRecord, bool)
      onMonthlyRebatePaidChanged;
  final Future<void> Function(
    TravelGroupFinanceSummaryRecord,
    _FinanceImageType,
  ) onExportImage;
  final Future<void> Function(TravelGroupFinanceSummaryRecord, bool)
      onGuideInfoSentChanged;
  final Future<void> Function(TravelGroupFinanceSummaryRecord, bool)
      onTravelAgencyInfoSentChanged;

  @override
  Widget build(BuildContext context) {
    final selectedCount = summaries
        .where(
            (summary) => selectedTravelGroupIds.contains(summary.travelGroupId))
        .length;
    final allSelected =
        selectedCount == summaries.length && summaries.isNotEmpty;
    return _TableScroller(
      child: DataTable(
        columnSpacing: 18,
        horizontalMargin: 12,
        headingRowHeight: 44,
        dataRowMinHeight: 68,
        dataRowMaxHeight: 82,
        columns: [
          DataColumn(
            label: Checkbox(
              key: const ValueKey('finance-select-all'),
              value: allSelected,
              onChanged: (value) => onSelectAllChanged(value ?? false),
            ),
          ),
          const DataColumn(label: Text('日期')),
          const DataColumn(label: Text('旅行社')),
          const DataColumn(label: Text('导游')),
          const DataColumn(label: Text('车牌')),
          const DataColumn(label: Text('人数')),
          const DataColumn(label: Text('品鉴师')),
          const DataColumn(label: Text('销售额')),
          const DataColumn(label: Text('货到付款')),
          const DataColumn(label: Text('已付定金')),
          const DataColumn(label: Text('扣酒成本')),
          const DataColumn(label: Text('上单金额')),
          const DataColumn(label: Text('积分/日返积分')),
          const DataColumn(label: Text('已返积分')),
          const DataColumn(label: Text('未返积分')),
          const DataColumn(label: Text('月返积分')),
          const DataColumn(label: Text('已返月返积分')),
          const DataColumn(label: Text('未返月返积分')),
          const DataColumn(label: Text('导游图片')),
          const DataColumn(label: Text('旅行社图片')),
          const DataColumn(label: Text('导游信息发送')),
          const DataColumn(label: Text('旅行社信息发送')),
          const DataColumn(label: Text('状态')),
        ],
        rows: [
          for (final summary in summaries) _buildRow(context, summary),
        ],
      ),
    );
  }

  DataRow _buildRow(
    BuildContext context,
    TravelGroupFinanceSummaryRecord summary,
  ) {
    final rowKey = summary.travelGroupId;
    final group = summary.travelGroup;
    final selected = selectedTravelGroupIds.contains(rowKey);
    final guideReady = guideImageReadyIds.contains(rowKey);
    final agencyReady = travelAgencyImageReadyIds.contains(rowKey);
    final guideSentBusy = sentUpdatingKeys.contains('$rowKey:guideInfoSent');
    final agencySentBusy =
        sentUpdatingKeys.contains('$rowKey:travelAgencyInfoSent');
    return DataRow(
      key: ValueKey('finance-row-$rowKey'),
      selected: selected,
      onSelectChanged: (value) => onSelectionChanged(rowKey, value ?? false),
      cells: [
        DataCell(Checkbox(
          key: ValueKey('$rowKey:select'),
          value: selected,
          onChanged: (value) => onSelectionChanged(rowKey, value ?? false),
        )),
        DataCell(_TextCell(value: _dateOnlyText(group?.visitDate ?? ''))),
        DataCell(_TextCell(value: _text(group?.travelAgency), width: 132)),
        DataCell(_TextCell(value: _text(group?.guideName), width: 96)),
        DataCell(_TextCell(value: _text(group?.licensePlate), width: 104)),
        DataCell(_TextCell(value: '${group?.guestCount ?? 0}', width: 64)),
        DataCell(_TextCell(value: _text(group?.tasterName), width: 104)),
        DataCell(_MoneyCell(cents: summary.totalSalesAmountCents)),
        DataCell(_MoneyCell(cents: summary.totalCashOnDeliveryCents)),
        DataCell(_MoneyCell(cents: summary.totalPaidDepositCents)),
        DataCell(_MoneyCell(cents: summary.totalAgencyDeductionCents)),
        DataCell(_MoneyCell(cents: summary.totalAgencyNetAmountCents)),
        DataCell(_MoneyCell(cents: summary.totalDailyRebateCents)),
        DataCell(_RebatePaidButton(
          key: ValueKey('$rowKey:dailyRebatePaid'),
          paid: summary.dailyRebatePaid,
          busy: rebateUpdatingKeys.contains('$rowKey:dailyRebatePaid'),
          onPressed: () => onDailyRebatePaidChanged(
            summary,
            !summary.dailyRebatePaid,
          ),
        )),
        DataCell(_MoneyCell(cents: summary.unpaidDailyRebateCents)),
        DataCell(_MoneyCell(cents: summary.totalMonthlyRebateCents)),
        DataCell(_RebatePaidButton(
          key: ValueKey('$rowKey:monthlyRebatePaid'),
          paid: summary.monthlyRebatePaid,
          busy: rebateUpdatingKeys.contains('$rowKey:monthlyRebatePaid'),
          onPressed: () => onMonthlyRebatePaidChanged(
            summary,
            !summary.monthlyRebatePaid,
          ),
        )),
        DataCell(_MoneyCell(cents: summary.unpaidMonthlyRebateCents)),
        DataCell(_ImageExportButton(
          key: ValueKey('$rowKey:guideImage'),
          label: '导游图片',
          busy: imageExportingKeys.contains('$rowKey:guide'),
          ready: guideReady,
          onPressed: () => onExportImage(summary, _FinanceImageType.guide),
        )),
        DataCell(_ImageExportButton(
          key: ValueKey('$rowKey:travelAgencyImage'),
          label: '旅行社图片',
          busy: imageExportingKeys.contains('$rowKey:travelAgency'),
          ready: agencyReady,
          onPressed: () =>
              onExportImage(summary, _FinanceImageType.travelAgency),
        )),
        DataCell(Switch(
          key: ValueKey('$rowKey:guideInfoSent'),
          value: summary.guideInfoSent,
          onChanged: guideSentBusy || (!guideReady && !summary.guideInfoSent)
              ? null
              : (value) => onGuideInfoSentChanged(summary, value),
        )),
        DataCell(Switch(
          key: ValueKey('$rowKey:travelAgencyInfoSent'),
          value: summary.travelAgencyInfoSent,
          onChanged:
              agencySentBusy || (!agencyReady && !summary.travelAgencyInfoSent)
                  ? null
                  : (value) => onTravelAgencyInfoSentChanged(summary, value),
        )),
        DataCell(StatusTag(
          label: _summaryStatus(summary),
          tone: _summaryStatus(summary) == _statusComplete
              ? StatusTone.success
              : StatusTone.warning,
        )),
      ],
    );
  }
}

class _TextCell extends StatelessWidget {
  const _TextCell({
    required this.value,
    this.width = 116,
  });

  final String value;
  final double width;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: Text(
        value,
        overflow: TextOverflow.ellipsis,
        maxLines: 2,
      ),
    );
  }
}

class _MoneyCell extends StatelessWidget {
  const _MoneyCell({required this.cents});

  final int cents;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 112,
      child: MoneyText(cents: cents),
    );
  }
}

class _RebatePaidButton extends StatelessWidget {
  const _RebatePaidButton({
    super.key,
    required this.paid,
    required this.busy,
    required this.onPressed,
  });

  final bool paid;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final child = busy
        ? const SizedBox.square(
            dimension: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : Text(paid ? '已返' : '标记已返');
    return SizedBox(
      width: 96,
      child: paid
          ? FilledButton(
              onPressed: busy ? null : onPressed,
              child: child,
            )
          : OutlinedButton(
              onPressed: busy ? null : onPressed,
              child: child,
            ),
    );
  }
}

class _ImageExportButton extends StatelessWidget {
  const _ImageExportButton({
    super.key,
    required this.label,
    required this.busy,
    required this.ready,
    required this.onPressed,
  });

  final String label;
  final bool busy;
  final bool ready;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 118,
      child: OutlinedButton.icon(
        onPressed: busy ? null : onPressed,
        icon: busy
            ? const SizedBox.square(
                dimension: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Icon(ready ? Icons.check_circle_rounded : Icons.image_rounded),
        label: Text(label),
      ),
    );
  }
}

class _FinanceExportImageCard extends StatelessWidget {
  const _FinanceExportImageCard({
    required this.summary,
    required this.type,
  });

  final TravelGroupFinanceSummaryRecord summary;
  final _FinanceImageType type;

  @override
  Widget build(BuildContext context) {
    final group = summary.travelGroup;
    final fields = type == _FinanceImageType.guide
        ? <MapEntry<String, String>>[
            MapEntry('日期', _dateOnlyText(group?.visitDate ?? '')),
            MapEntry('旅行社', _text(group?.travelAgency)),
            MapEntry('导游', _text(group?.guideName)),
            MapEntry('车牌', _text(group?.licensePlate)),
            MapEntry('人数', '${group?.guestCount ?? 0} 人'),
            MapEntry('品鉴师', _text(group?.tasterName)),
            MapEntry(
              '上单金额',
              formatMoneyCents(summary.totalAgencyNetAmountCents),
            ),
          ]
        : <MapEntry<String, String>>[
            MapEntry('日期', _dateOnlyText(group?.visitDate ?? '')),
            MapEntry('旅行社', _text(group?.travelAgency)),
            MapEntry('导游', _text(group?.guideName)),
            MapEntry('车牌', _text(group?.licensePlate)),
            MapEntry('人数', '${group?.guestCount ?? 0} 人'),
            MapEntry('品鉴师', _text(group?.tasterName)),
            MapEntry('销售额', formatMoneyCents(summary.totalSalesAmountCents)),
            MapEntry('已付定金', formatMoneyCents(summary.totalPaidDepositCents)),
            MapEntry(
              '货到付款',
              formatMoneyCents(summary.totalCashOnDeliveryCents),
            ),
            MapEntry(
              '扣酒成本',
              formatMoneyCents(summary.totalAgencyDeductionCents),
            ),
            MapEntry(
              '上单金额',
              formatMoneyCents(summary.totalAgencyNetAmountCents),
            ),
            MapEntry('积分', formatMoneyCents(summary.totalDailyRebateCents)),
          ];

    return SizedBox(
      width: 760,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: const Color(0xFFE1E5EA)),
          borderRadius: const BorderRadius.all(Radius.circular(8)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: DefaultTextStyle(
            style: const TextStyle(
              color: Color(0xFF17212B),
              fontSize: 20,
              height: 1.35,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  type.label,
                  style: const TextStyle(
                    fontSize: 30,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 18),
                for (final field in fields)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 120,
                          child: Text(
                            field.key,
                            style: const TextStyle(
                              color: Color(0xFF5A6673),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            field.value,
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TableScroller extends StatefulWidget {
  const _TableScroller({required this.child});

  final Widget child;

  @override
  State<_TableScroller> createState() => _TableScrollerState();
}

class _TableScrollerState extends State<_TableScroller> {
  final ScrollController _scrollController = ScrollController();
  bool _hasHorizontalOverflow = false;
  bool _overflowUpdateScheduled = false;
  bool? _pendingOverflow;

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scheduleOverflowUpdate(bool hasOverflow) {
    _pendingOverflow = hasOverflow;
    if (_overflowUpdateScheduled) {
      return;
    }
    _overflowUpdateScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _overflowUpdateScheduled = false;
      final next = _pendingOverflow;
      _pendingOverflow = null;
      if (!mounted || next == null || next == _hasHorizontalOverflow) {
        return;
      }
      setState(() => _hasHorizontalOverflow = next);
    });
  }

  bool _handleScrollMetrics(ScrollMetricsNotification notification) {
    if (notification.metrics.axis == Axis.horizontal) {
      _scheduleOverflowUpdate(notification.metrics.maxScrollExtent > 0);
    }
    return false;
  }

  void _handlePointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent || !_scrollController.hasClients) {
      return;
    }

    final delta = event.scrollDelta;
    final shiftPressed = HardwareKeyboard.instance.isShiftPressed;
    final isHorizontalGesture = delta.dx.abs() > delta.dy.abs();
    if (!shiftPressed && !isHorizontalGesture) {
      return;
    }

    final horizontalDelta =
        shiftPressed && delta.dy.abs() > delta.dx.abs() ? delta.dy : delta.dx;
    if (horizontalDelta == 0) {
      return;
    }

    GestureBinding.instance.pointerSignalResolver.register(event, (_) {
      if (!_scrollController.hasClients) {
        return;
      }
      final position = _scrollController.position;
      final target = (_scrollController.offset + horizontalDelta)
          .clamp(position.minScrollExtent, position.maxScrollExtent)
          .toDouble();
      _scrollController.jumpTo(target);
    });
  }

  @override
  Widget build(BuildContext context) {
    final scrollbarTheme = Theme.of(context).scrollbarTheme.copyWith(
          thickness: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.dragged) ||
                states.contains(WidgetState.hovered)) {
              return 10;
            }
            return 8;
          }),
          radius: const Radius.circular(8),
          minThumbLength: 48,
          mainAxisMargin: 4,
          crossAxisMargin: 1,
        );

    return NotificationListener<ScrollMetricsNotification>(
      onNotification: _handleScrollMetrics,
      child: ScrollbarTheme(
        data: scrollbarTheme,
        child: Scrollbar(
          key: const ValueKey('finance-table-scrollbar'),
          controller: _scrollController,
          thumbVisibility: _hasHorizontalOverflow,
          interactive: true,
          child: Padding(
            padding: EdgeInsets.only(
              bottom: _hasHorizontalOverflow ? 10 : 0,
            ),
            child: SingleChildScrollView(
              key: const ValueKey('finance-table-horizontal-scroll-view'),
              controller: _scrollController,
              primary: false,
              scrollDirection: Axis.horizontal,
              child: Listener(
                behavior: HitTestBehavior.translucent,
                onPointerSignal: _handlePointerSignal,
                child: widget.child,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyFinanceTable extends StatelessWidget {
  const _EmptyFinanceTable();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.table_rows_rounded, size: 34, color: scheme.primary),
          const SizedBox(height: 10),
          Text(
            '没有符合条件的积分记录',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
        ],
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
    final color = switch (tone) {
      StatusTone.success => Colors.green.shade700,
      StatusTone.danger => Colors.red.shade700,
      _ => Theme.of(context).colorScheme.primary,
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: color.withValues(alpha: 0.24)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Text(
          message,
          style: TextStyle(color: color, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

enum _FinanceImageType {
  guide('guide', '导游图片'),
  travelAgency('travelAgency', '旅行社图片');

  const _FinanceImageType(this.name, this.label);

  final String name;
  final String label;
}

const _allFilter = '__all__';
const _sentFilter = '__sent__';
const _notSentFilter = '__not_sent__';
const _statusPending = '待返';
const _statusComplete = '已完成';

const _sentFilterItems = <MapEntry<String, String>>[
  MapEntry(_allFilter, '全部'),
  MapEntry(_sentFilter, '已发送'),
  MapEntry(_notSentFilter, '未发送'),
];

bool _matchesSentFilter(bool sent, String filter) {
  return switch (filter) {
    _sentFilter => sent,
    _notSentFilter => !sent,
    _ => true,
  };
}

String _summaryStatus(TravelGroupFinanceSummaryRecord summary) {
  return summary.unpaidRebateCents == 0 ? _statusComplete : _statusPending;
}

String _text(String? value, {String fallback = ''}) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? fallback : text;
}

DateTime? _dateFromText(String value) {
  final normalized = _dateOnlyText(value);
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(normalized);
  if (match == null) {
    return null;
  }
  final year = int.parse(match.group(1)!);
  final month = int.parse(match.group(2)!);
  final day = int.parse(match.group(3)!);
  final date = DateTime(year, month, day);
  if (date.year != year || date.month != month || date.day != day) {
    return null;
  }
  return date;
}

DateTime _dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

String _dateOnlyText(String value) {
  final text = value.trim();
  if (text.length >= 10 && RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(text)) {
    return text.substring(0, 10);
  }
  return text;
}

String _formatDate(DateTime value) {
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  return '${value.year}-$month-$day';
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}

String _safeExportFileName(String fileName) {
  final sanitized = fileName
      .replaceAll(RegExp(r'[\\/:*?"<>|]'), '-')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return sanitized.isEmpty ? '积分表图片.png' : sanitized;
}

Future<File> _nextExportFile(Directory directory, String fileName) async {
  final separator = Platform.pathSeparator;
  final first = File('${directory.path}$separator$fileName');
  if (!await first.exists()) {
    return first;
  }
  final dotIndex = fileName.lastIndexOf('.');
  final baseName = dotIndex <= 0 ? fileName : fileName.substring(0, dotIndex);
  final extension = dotIndex <= 0 ? '' : fileName.substring(dotIndex);
  for (var index = 1; index < 1000; index += 1) {
    final candidate = File(
      '${directory.path}$separator$baseName ($index)$extension',
    );
    if (!await candidate.exists()) {
      return candidate;
    }
  }
  return File(
    '${directory.path}$separator$baseName-${DateTime.now().microsecondsSinceEpoch}$extension',
  );
}

class _NonNegativeIntegerFormatter extends TextInputFormatter {
  const _NonNegativeIntegerFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    return RegExp(r'^\d*$').hasMatch(newValue.text) ? newValue : oldValue;
  }
}
