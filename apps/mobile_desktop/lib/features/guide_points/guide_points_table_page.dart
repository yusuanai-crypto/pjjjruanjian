import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/role_access.dart';
import '../../core/business/business_api.dart';
import '../../core/crash_reporting/crash_reporter.dart';
import '../../shared/image_export_memory_policy.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/status_tag.dart';
import '../travel_group_finance/travel_group_finance_supplement_page.dart';

const guidePointsImageAlbumName = '贵州酱酒馆导游积分表';
const guidePointsImageExportPageSize = 8;

typedef GuidePointsImagePageRenderer = Future<Uint8List> Function(
  GuidePointsImageExportPage page,
);

class GuidePointsImageExportPage {
  const GuidePointsImageExportPage({
    required this.records,
    required this.pageNumber,
    required this.totalPages,
    required this.exportId,
  });

  final List<GuidePointsSummaryRecord> records;
  final int pageNumber;
  final int totalPages;
  final int exportId;

  String get fileName {
    final baseName = '导游积分表-$exportId';
    return totalPages == 1 ? '$baseName.png' : '$baseName-第$pageNumber页.png';
  }
}

List<List<T>> paginateGuidePointsImageRecords<T>(List<T> records) {
  return [
    for (var start = 0;
        start < records.length;
        start += guidePointsImageExportPageSize)
      records.sublist(
        start,
        (start + guidePointsImageExportPageSize)
            .clamp(0, records.length)
            .toInt(),
      ),
  ];
}

List<GuidePointsImageExportPage> buildGuidePointsImageExportPages(
  List<GuidePointsSummaryRecord> records, {
  required int exportId,
}) {
  final recordPages = paginateGuidePointsImageRecords(records);
  return [
    for (var index = 0; index < recordPages.length; index += 1)
      GuidePointsImageExportPage(
        records: recordPages[index],
        pageNumber: index + 1,
        totalPages: recordPages.length,
        exportId: exportId,
      ),
  ];
}

class GuidePointsTablePage extends StatefulWidget {
  const GuidePointsTablePage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    this.imageSaver = saveFinanceImage,
    this.imagePageRenderer,
    this.documentsDirectoryProvider,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final FinanceImageSaver imageSaver;
  final GuidePointsImagePageRenderer? imagePageRenderer;
  final Future<Directory> Function()? documentsDirectoryProvider;

  @override
  State<GuidePointsTablePage> createState() => _GuidePointsTablePageState();
}

class _GuidePointsTablePageState extends State<GuidePointsTablePage> {
  late BusinessApi _businessApi;
  late final TextEditingController _queryController;
  final List<GlobalKey> _imageBoundaryKeys = [];
  final Map<String, GuidePointsSummaryRecord> _details = {};
  final Set<String> _loadingDetailIds = {};
  final Set<String> _busyKeys = {};
  List<GuidePointsSummaryRecord> _summaries = const [];
  DateTime? _start;
  DateTime? _end;
  bool _loading = true;
  bool _exportingExcel = false;
  bool _exportingImage = false;
  String? _errorMessage;
  String? _successMessage;

  bool get _canMaintain => canMaintainGuidePointsTable(widget.role);

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _queryController = TextEditingController();
    final now = DateTime.now();
    _start = DateTime(now.year, now.month, 1);
    _end = DateTime(now.year, now.month, now.day);
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadData());
  }

  @override
  void didUpdateWidget(covariant GuidePointsTablePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.role != widget.role) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadData();
    }
  }

  @override
  void dispose() {
    _queryController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
      _successMessage = null;
    });
    try {
      final summaries = await _businessApi.listGuidePointsSummaries(
        limit: 200,
        start: _start,
        end: _end,
        query: _queryController.text.trim(),
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _summaries = summaries;
        _details.removeWhere(
          (id, _) => !summaries.any((summary) => summary.id == id),
        );
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _errorMessage = _messageForGuidePointsError(error);
      });
    }
  }

  Future<void> _loadDetail(String id) async {
    if (_details.containsKey(id) || _loadingDetailIds.contains(id)) {
      return;
    }
    setState(() => _loadingDetailIds.add(id));
    try {
      final detail = await _businessApi.getGuidePointsSummary(id);
      if (!mounted) {
        return;
      }
      _replaceSummary(detail);
      setState(() {
        _details[id] = detail;
        _loadingDetailIds.remove(id);
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loadingDetailIds.remove(id);
        _errorMessage = _messageForGuidePointsError(error);
      });
    }
  }

  Future<void> _setPaid(
    GuidePointsSummaryRecord summary,
    String type,
    bool value,
  ) async {
    final busyKey = '${summary.id}:$type';
    if (_busyKeys.contains(busyKey) || !_canMaintain) {
      return;
    }
    setState(() {
      _busyKeys.add(busyKey);
      _errorMessage = null;
    });
    try {
      final updated = type == 'daily'
          ? await _businessApi.setGuideDailyPointsPaid(summary.id, value)
          : await _businessApi.setGuideMonthlyPointsPaid(summary.id, value);
      if (!mounted) {
        return;
      }
      _replaceSummary(updated);
      setState(() {
        _details[updated.id] = updated;
        _busyKeys.remove(busyKey);
        _successMessage = value
            ? '${type == 'daily' ? '日返' : '月返'}已标记为已返'
            : '${type == 'daily' ? '日返' : '月返'}已取消已返';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _busyKeys.remove(busyKey);
        _errorMessage = _messageForGuidePointsError(error);
      });
    }
  }

  Future<void> _editOrderRates(
    GuidePointsSummaryRecord summary,
    GuidePointsOrderRecord order,
  ) async {
    if (!_canMaintain) {
      return;
    }
    final result = await showDialog<_GuideRateEditResult>(
      context: context,
      builder: (context) => _GuideRateEditDialog(
        summary: summary,
        order: order,
      ),
    );
    if (result == null) {
      return;
    }
    final busyKey = '${order.id}:rates';
    setState(() {
      _busyKeys.add(busyKey);
      _errorMessage = null;
    });
    try {
      final updated = await _businessApi.updateGuidePersonalOrderRates(
        order.id,
        dailyRebateRate: result.dailyRate,
        monthlyRebateRate: result.monthlyRate,
      );
      if (!mounted) {
        return;
      }
      if (updated != null) {
        _replaceSummary(updated);
        _details[updated.id] = updated;
      } else {
        _details.remove(summary.id);
        await _loadDetail(summary.id);
      }
      setState(() {
        _busyKeys.remove(busyKey);
        _successMessage = '订单 ${order.orderNo} 的个人积分比例已更新';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _busyKeys.remove(busyKey);
        _errorMessage = _messageForGuidePointsError(error);
      });
    }
  }

  void _replaceSummary(GuidePointsSummaryRecord updated) {
    final index = _summaries.indexWhere((summary) => summary.id == updated.id);
    if (index < 0) {
      _summaries = [..._summaries, updated];
    } else {
      final values = [..._summaries];
      values[index] = updated;
      _summaries = values;
    }
  }

  Future<void> _pickDateRange() async {
    final now = DateTime.now();
    final selected = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime(now.year + 2),
      initialDateRange: _start != null && _end != null
          ? DateTimeRange(start: _start!, end: _end!)
          : null,
    );
    if (selected == null) {
      return;
    }
    setState(() {
      _start = selected.start;
      _end = selected.end;
    });
    await _loadData();
  }

  Future<void> _exportExcel() async {
    if (_exportingExcel) {
      return;
    }
    setState(() {
      _exportingExcel = true;
      _errorMessage = null;
    });
    try {
      final file = await _businessApi.downloadGuidePointsSummariesExcel(
        start: _start,
        end: _end,
        query: _queryController.text.trim(),
      );
      final documents = widget.documentsDirectoryProvider != null
          ? await widget.documentsDirectoryProvider!()
          : await getApplicationDocumentsDirectory();
      final directory = Directory(
        '${documents.path}${Platform.pathSeparator}exports',
      );
      await directory.create(recursive: true);
      final target = File(
        '${directory.path}${Platform.pathSeparator}'
        '${_safeFileName(file.fileName, 'guide-points.xlsx')}',
      );
      await target.writeAsBytes(file.bytes, flush: true);
      if (!mounted) {
        return;
      }
      setState(() {
        _exportingExcel = false;
        _successMessage = '导游积分表已导出：${target.path}';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _exportingExcel = false;
        _errorMessage = _messageForGuidePointsError(error);
      });
    }
  }

  Future<void> _exportImage() async {
    if (_exportingImage || _summaries.isEmpty) {
      return;
    }
    setState(() {
      _exportingImage = true;
      _errorMessage = null;
      _successMessage = null;
    });
    final pages = buildGuidePointsImageExportPages(
      _summaries,
      exportId: DateTime.now().millisecondsSinceEpoch,
    );
    CrashReporting.setUserAction('export_guide_points_images');
    CrashReporting.breadcrumb(
      'guide_points_image_export.start',
      data: {
        'recordCount': _summaries.length,
        'pageCount': pages.length,
        'recordsPerPage': guidePointsImageExportPageSize,
      },
    );
    var successCount = 0;
    final failures = <String>[];
    await WidgetsBinding.instance.endOfFrame;
    for (var index = 0; index < pages.length; index += 1) {
      final page = pages[index];
      CrashReporting.breadcrumb(
        'guide_points_image_export.page_start',
        data: {
          'pageNumber': page.pageNumber,
          'pageCount': page.totalPages,
          'recordCount': page.records.length,
        },
      );
      try {
        final bytes = await (widget.imagePageRenderer?.call(page) ??
            _renderGuidePointsPageBytes(index));
        if (bytes.isEmpty) {
          throw const FinanceImageSaveException('导游积分表图片生成失败。');
        }
        await widget.imageSaver(
          bytes,
          album: guidePointsImageAlbumName,
          name: page.fileName,
        );
        successCount += 1;
        CrashReporting.breadcrumb(
          'guide_points_image_export.page_success',
          data: {
            'pageNumber': page.pageNumber,
            'pageCount': page.totalPages,
            'encodedSizeBytes': bytes.length,
          },
        );
      } catch (error, stackTrace) {
        CrashReporting.breadcrumb(
          'guide_points_image_export.page_failure',
          data: {
            'pageNumber': page.pageNumber,
            'pageCount': page.totalPages,
            'exceptionType': error.runtimeType.toString(),
          },
        );
        unawaited(
          CrashReporting.recordError(
            error,
            stackTrace,
            source: 'guide_points.image_export',
            context: {
              'pageNumber': page.pageNumber,
              'pageCount': page.totalPages,
              'recordCount': page.records.length,
            },
          ),
        );
        failures.add(
          '第${page.pageNumber}页：${_messageForGuidePointsError(error)}',
        );
      }
    }
    CrashReporting.breadcrumb(
      'guide_points_image_export.complete',
      data: {
        'pageCount': pages.length,
        'successCount': successCount,
        'failureCount': failures.length,
      },
    );
    if (!mounted) {
      return;
    }
    final message = failures.isEmpty
        ? '导游积分表图片已生成，共 $successCount 页'
        : '导游积分表导出完成：成功 $successCount 页，失败 '
            '${failures.length} 页；${failures.join('；')}';
    setState(() {
      _exportingImage = false;
      if (failures.isEmpty) {
        _successMessage = message;
      } else {
        _errorMessage = message;
      }
    });
  }

  Future<Uint8List> _renderGuidePointsPageBytes(int pageIndex) async {
    final boundary = pageIndex < _imageBoundaryKeys.length
        ? _imageBoundaryKeys[pageIndex].currentContext?.findRenderObject()
            as RenderRepaintBoundary?
        : null;
    if (boundary == null) {
      throw const FinanceImageSaveException('导游积分表图片尚未准备完成。');
    }
    try {
      return await renderRepaintBoundaryPngWithinPixelBudget(boundary);
    } on ExportImagePixelBudgetException catch (error) {
      throw FinanceImageSaveException(error.message);
    } catch (_) {
      throw const FinanceImageSaveException(
        '导游积分表图片生成失败，请重试或减少单次导出记录。',
      );
    }
  }

  void _ensureImageBoundaryKeys(int pageCount) {
    while (_imageBoundaryKeys.length < pageCount) {
      _imageBoundaryKeys.add(GlobalKey());
    }
    if (_imageBoundaryKeys.length > pageCount) {
      _imageBoundaryKeys.removeRange(pageCount, _imageBoundaryKeys.length);
    }
  }

  @override
  Widget build(BuildContext context) {
    final summaryPages = paginateGuidePointsImageRecords(_summaries);
    _ensureImageBoundaryKeys(summaryPages.length);
    final totalNet = _summaries.fold<int>(
      0,
      (sum, summary) => sum + summary.totalNetAmountCents,
    );
    final totalPoints = _summaries.fold<int>(
      0,
      (sum, summary) =>
          sum + summary.totalDailyPointsCents + summary.totalMonthlyPointsCents,
    );
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          FormSection(
            title: '导游积分表',
            trailing: StatusTag(
              key: const ValueKey('guide-points-permission-status'),
              label: _canMaintain ? '可维护' : '只读',
              tone: _canMaintain ? StatusTone.info : StatusTone.neutral,
            ),
            children: [
              Wrap(
                spacing: 10,
                runSpacing: 10,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  SizedBox(
                    width: 260,
                    child: TextField(
                      key: const ValueKey('guide-points-query'),
                      controller: _queryController,
                      decoration: const InputDecoration(
                        labelText: '团号 / 旅行社 / 收款导游',
                        prefixIcon: Icon(Icons.search_rounded),
                      ),
                      onSubmitted: (_) => _loadData(),
                    ),
                  ),
                  OutlinedButton.icon(
                    key: const ValueKey('guide-points-date-filter'),
                    onPressed: _pickDateRange,
                    icon: const Icon(Icons.date_range_rounded),
                    label: Text(
                      _start == null || _end == null
                          ? '全部日期'
                          : '${_dateText(_start!)} 至 ${_dateText(_end!)}',
                    ),
                  ),
                  FilledButton.icon(
                    key: const ValueKey('guide-points-search-button'),
                    onPressed: _loading ? null : _loadData,
                    icon: const Icon(Icons.search_rounded),
                    label: const Text('查询'),
                  ),
                  OutlinedButton.icon(
                    key: const ValueKey('guide-points-export-excel'),
                    onPressed: _exportingExcel ? null : _exportExcel,
                    icon: const Icon(Icons.table_view_rounded),
                    label: Text(
                      _exportingExcel ? '导出中' : '导出 Excel',
                    ),
                  ),
                  OutlinedButton.icon(
                    key: const ValueKey('guide-points-export-image'),
                    onPressed: _summaries.isEmpty || _exportingImage
                        ? null
                        : _exportImage,
                    icon: const Icon(Icons.image_rounded),
                    label: Text(
                      _exportingImage ? '生成中' : '生成导游积分图片',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 16,
                runSpacing: 8,
                children: [
                  Text('汇总 ${_summaries.length} 行'),
                  Text('上单金额 ${formatMoneyCents(totalNet)}'),
                  Text('个人积分 ${formatMoneyCents(totalPoints)}'),
                ],
              ),
            ],
          ),
          if (_errorMessage != null) ...[
            const SizedBox(height: 10),
            StatusTag(
              label: _errorMessage!,
              tone: StatusTone.danger,
            ),
          ],
          if (_successMessage != null) ...[
            const SizedBox(height: 10),
            StatusTag(
              label: _successMessage!,
              tone: StatusTone.success,
            ),
          ],
          const SizedBox(height: 12),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(36),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_summaries.isEmpty)
            const Padding(
              padding: EdgeInsets.all(36),
              child: Center(child: Text('当前筛选范围内暂无走个人订单')),
            )
          else
            ColoredBox(
              color: Theme.of(context).colorScheme.surface,
              child: Column(
                children: [
                  for (var pageIndex = 0;
                      pageIndex < summaryPages.length;
                      pageIndex += 1)
                    RepaintBoundary(
                      key: _imageBoundaryKeys[pageIndex],
                      child: Column(
                        children: [
                          for (final summary in summaryPages[pageIndex])
                            _GuideSummaryCard(
                              key: ValueKey(
                                'guide-points-summary-'
                                '${summary.travelGroupId}-'
                                '${summary.guideId}',
                              ),
                              summary: _details[summary.id] ?? summary,
                              canMaintain: _canMaintain,
                              loadingDetail:
                                  _loadingDetailIds.contains(summary.id),
                              busyKeys: _busyKeys,
                              onExpanded: () => _loadDetail(summary.id),
                              onSetDailyPaid: (value) =>
                                  _setPaid(summary, 'daily', value),
                              onSetMonthlyPaid: (value) =>
                                  _setPaid(summary, 'monthly', value),
                              onEditRates: (order) => _editOrderRates(
                                _details[summary.id] ?? summary,
                                order,
                              ),
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _GuideSummaryCard extends StatelessWidget {
  const _GuideSummaryCard({
    super.key,
    required this.summary,
    required this.canMaintain,
    required this.loadingDetail,
    required this.busyKeys,
    required this.onExpanded,
    required this.onSetDailyPaid,
    required this.onSetMonthlyPaid,
    required this.onEditRates,
  });

  final GuidePointsSummaryRecord summary;
  final bool canMaintain;
  final bool loadingDetail;
  final Set<String> busyKeys;
  final VoidCallback onExpanded;
  final ValueChanged<bool> onSetDailyPaid;
  final ValueChanged<bool> onSetMonthlyPaid;
  final ValueChanged<GuidePointsOrderRecord> onEditRates;

  @override
  Widget build(BuildContext context) {
    final group = summary.travelGroup;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ExpansionTile(
        onExpansionChanged: (expanded) {
          if (expanded) {
            onExpanded();
          }
        },
        title: Wrap(
          spacing: 10,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              group?.groupNo ?? summary.travelGroupId,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            StatusTag(
              label: summary.guideNameSnapshot,
              tone: StatusTone.info,
            ),
            Text('${summary.orderCount} 笔个人订单'),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Wrap(
            spacing: 14,
            runSpacing: 6,
            children: [
              Text(group?.visitDate?.split('T').first ?? ''),
              Text(group?.travelAgency ?? '未填旅行社'),
              Text('销售额 ${formatMoneyCents(summary.totalSalesAmountCents)}'),
              Text(
                  '退款 ${formatMoneyCents(summary.confirmedRefundAmountCents)}'),
              Text('有效 ${formatMoneyCents(summary.effectiveSalesAmountCents)}'),
              Text(
                '扣酒 ${formatMoneyCents(summary.totalLiquorCostDeductionCents)}',
              ),
              Text('上单 ${formatMoneyCents(summary.totalNetAmountCents)}'),
            ],
          ),
        ),
        trailing: SizedBox(
          width: 260,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              _PaidButton(
                key: ValueKey('${summary.id}:daily-paid'),
                label: '日返',
                paid: summary.dailyPointsPaid,
                busy: busyKeys.contains('${summary.id}:daily'),
                enabled: canMaintain,
                onChanged: onSetDailyPaid,
              ),
              const SizedBox(width: 8),
              _PaidButton(
                key: ValueKey('${summary.id}:monthly-paid'),
                label: '月返',
                paid: summary.monthlyPointsPaid,
                busy: busyKeys.contains('${summary.id}:monthly'),
                enabled: canMaintain,
                onChanged: onSetMonthlyPaid,
              ),
              const Icon(Icons.expand_more_rounded),
            ],
          ),
        ),
        children: [
          if (loadingDetail)
            const Padding(
              padding: EdgeInsets.all(24),
              child: CircularProgressIndicator(),
            )
          else if (summary.orders.isEmpty)
            const Padding(
              padding: EdgeInsets.all(20),
              child: Text('展开后将加载订单明细'),
            )
          else
            _GuideOrderTable(
              summary: summary,
              canMaintain: canMaintain,
              busyKeys: busyKeys,
              onEditRates: onEditRates,
            ),
        ],
      ),
    );
  }
}

class _GuideOrderTable extends StatelessWidget {
  const _GuideOrderTable({
    required this.summary,
    required this.canMaintain,
    required this.busyKeys,
    required this.onEditRates,
  });

  final GuidePointsSummaryRecord summary;
  final bool canMaintain;
  final Set<String> busyKeys;
  final ValueChanged<GuidePointsOrderRecord> onEditRates;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          key: ValueKey('guide-points-orders-${summary.id}'),
          columns: const [
            DataColumn(label: Text('订单号')),
            DataColumn(label: Text('客户')),
            DataColumn(label: Text('原始销售额')),
            DataColumn(label: Text('已确认退款')),
            DataColumn(label: Text('有效金额')),
            DataColumn(label: Text('扣酒成本')),
            DataColumn(label: Text('上单金额')),
            DataColumn(label: Text('收款导游')),
            DataColumn(label: Text('日返比例 / 金额')),
            DataColumn(label: Text('月返比例 / 金额')),
            DataColumn(label: Text('操作')),
          ],
          rows: [
            for (final order in summary.orders)
              DataRow(
                key: ValueKey('guide-points-order-${order.id}'),
                cells: [
                  DataCell(Text(order.orderNo)),
                  DataCell(Text(order.customerName)),
                  DataCell(Text(formatMoneyCents(order.grossAmountCents))),
                  DataCell(
                    Text(formatMoneyCents(order.confirmedRefundAmountCents)),
                  ),
                  DataCell(Text(formatMoneyCents(order.effectiveAmountCents))),
                  DataCell(
                    Text(formatMoneyCents(order.liquorCostDeductionCents)),
                  ),
                  DataCell(Text(formatMoneyCents(order.netAmountCents))),
                  DataCell(Text(order.guideName ?? summary.guideNameSnapshot)),
                  DataCell(
                    Text(
                      '${_rateToPercent(order.dailyRebateRate)} / '
                      '${formatMoneyCents(order.dailyPointsCents)}',
                    ),
                  ),
                  DataCell(
                    Text(
                      '${_rateToPercent(order.monthlyRebateRate)} / '
                      '${formatMoneyCents(order.monthlyPointsCents)}',
                    ),
                  ),
                  DataCell(
                    canMaintain
                        ? IconButton(
                            key: ValueKey(
                              'guide-points-edit-rates-${order.id}',
                            ),
                            tooltip: '修改本单比例',
                            onPressed: busyKeys.contains('${order.id}:rates') ||
                                    (summary.dailyPointsPaid &&
                                        summary.monthlyPointsPaid)
                                ? null
                                : () => onEditRates(order),
                            icon: busyKeys.contains('${order.id}:rates')
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.edit_rounded),
                          )
                        : const Text('只读'),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _PaidButton extends StatelessWidget {
  const _PaidButton({
    super.key,
    required this.label,
    required this.paid,
    required this.busy,
    required this.enabled,
    required this.onChanged,
  });

  final String label;
  final bool paid;
  final bool busy;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: !enabled || busy ? null : () => onChanged(!paid),
      child: Text('$label${paid ? '已返' : '未返'}'),
    );
  }
}

class _GuideRateEditDialog extends StatefulWidget {
  const _GuideRateEditDialog({
    required this.summary,
    required this.order,
  });

  final GuidePointsSummaryRecord summary;
  final GuidePointsOrderRecord order;

  @override
  State<_GuideRateEditDialog> createState() => _GuideRateEditDialogState();
}

class _GuideRateEditDialogState extends State<_GuideRateEditDialog> {
  late final TextEditingController _dailyController;
  late final TextEditingController _monthlyController;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _dailyController = TextEditingController(
      text: _rateToPercentText(widget.order.dailyRebateRate),
    );
    _monthlyController = TextEditingController(
      text: _rateToPercentText(widget.order.monthlyRebateRate),
    );
  }

  @override
  void dispose() {
    _dailyController.dispose();
    _monthlyController.dispose();
    super.dispose();
  }

  void _submit() {
    final daily = widget.summary.dailyPointsPaid
        ? widget.order.dailyRebateRate
        : _percentToRate(_dailyController.text);
    final monthly = widget.summary.monthlyPointsPaid
        ? widget.order.monthlyRebateRate
        : _percentToRate(_monthlyController.text);
    if (daily == null || monthly == null) {
      setState(() => _errorMessage = '比例必须在 0% 至 100% 之间，最多两位小数。');
      return;
    }
    Navigator.of(context).pop(
      _GuideRateEditResult(dailyRate: daily, monthlyRate: monthly),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('修改订单 ${widget.order.orderNo} 的个人积分比例'),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              key: const ValueKey('guide-order-daily-rate-percent'),
              controller: _dailyController,
              enabled: !widget.summary.dailyPointsPaid,
              inputFormatters: [_PercentInputFormatter()],
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: '日返积分比例',
                suffixText: '%',
                helperText: widget.summary.dailyPointsPaid ? '日返已返，禁止修改' : null,
              ),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const ValueKey('guide-order-monthly-rate-percent'),
              controller: _monthlyController,
              enabled: !widget.summary.monthlyPointsPaid,
              inputFormatters: [_PercentInputFormatter()],
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: '月返积分比例',
                suffixText: '%',
                helperText:
                    widget.summary.monthlyPointsPaid ? '月返已返，禁止修改' : null,
              ),
            ),
            if (_errorMessage != null) ...[
              const SizedBox(height: 12),
              Text(
                _errorMessage!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton(
          key: const ValueKey('guide-order-rate-save'),
          onPressed: _submit,
          child: const Text('确认修改'),
        ),
      ],
    );
  }
}

class _GuideRateEditResult {
  const _GuideRateEditResult({
    required this.dailyRate,
    required this.monthlyRate,
  });

  final String dailyRate;
  final String monthlyRate;
}

class _PercentInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    if (newValue.text.isEmpty ||
        RegExp(r'^\d{0,3}(\.\d{0,2})?$').hasMatch(newValue.text)) {
      return newValue;
    }
    return oldValue;
  }
}

String? _percentToRate(String value) {
  final text = value.trim();
  final match = RegExp(r'^(\d{1,3})(?:\.(\d{1,2}))?$').firstMatch(text);
  if (match == null) {
    return null;
  }
  final whole = int.parse(match.group(1)!);
  final fraction = (match.group(2) ?? '').padRight(2, '0');
  final basisPoints = whole * 100 + int.parse(fraction);
  if (basisPoints < 0 || basisPoints > 10000) {
    return null;
  }
  final integer = basisPoints ~/ 10000;
  final decimal = (basisPoints % 10000).toString().padLeft(4, '0');
  return '$integer.$decimal';
}

String _rateToPercentText(String rate) {
  final text = rate.trim();
  final match = RegExp(r'^(\d+)(?:\.(\d+))?$').firstMatch(text);
  if (match == null) {
    return '0';
  }
  final integer = int.tryParse(match.group(1)!) ?? 0;
  final fraction = (match.group(2) ?? '').padRight(4, '0').substring(0, 4);
  final scaled = integer * 10000 + (int.tryParse(fraction) ?? 0);
  final percentWhole = scaled ~/ 100;
  final percentFraction = (scaled % 100).toString().padLeft(2, '0');
  return percentFraction == '00'
      ? '$percentWhole'
      : '$percentWhole.${percentFraction.replaceFirst(RegExp(r'0+$'), '')}';
}

String _rateToPercent(String rate) => '${_rateToPercentText(rate)}%';

String _dateText(DateTime date) => '${date.year.toString().padLeft(4, '0')}-'
    '${date.month.toString().padLeft(2, '0')}-'
    '${date.day.toString().padLeft(2, '0')}';

String _safeFileName(String? value, String fallback) {
  final text = value?.trim() ?? '';
  if (text.isEmpty) {
    return fallback;
  }
  return text.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
}

String _messageForGuidePointsError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  if (error is FinanceImageSaveException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}
