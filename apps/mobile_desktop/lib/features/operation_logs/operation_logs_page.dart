import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import 'operation_log_presentation.dart';

export 'operation_log_presentation.dart' show OperationLogEntry;

typedef OperationLogFileSaver = Future<String?> Function(
  String fileName,
  Uint8List bytes,
);

abstract interface class OperationLogsApi {
  Future<OperationLogPageResult> list(OperationLogQuery query);
  Future<OperationLogFilterOptions> filterOptions();
  Future<OperationLogEntry> detail(String id, {required bool archived});
  Future<ApiDownloadedFile> export(OperationLogQuery query);
}

class HttpOperationLogsApi implements OperationLogsApi {
  HttpOperationLogsApi(this.apiClient, this.token);

  final ApiClient apiClient;
  final String token;

  @override
  Future<OperationLogPageResult> list(OperationLogQuery query) async {
    final payload = await apiClient.getJson(
      buildPath('/api/operation-logs', query),
      token: token,
    );
    return OperationLogPageResult.fromJson(_dataMap(payload));
  }

  @override
  Future<OperationLogFilterOptions> filterOptions() async {
    final payload = await apiClient.getJson(
      '/api/operation-logs/filter-options',
      token: token,
    );
    return OperationLogFilterOptions.fromJson(_dataMap(payload));
  }

  @override
  Future<OperationLogEntry> detail(
    String id, {
    required bool archived,
  }) async {
    final query = archived ? '?archived=true' : '';
    final payload = await apiClient.getJson(
      '/api/operation-logs/${Uri.encodeComponent(id)}$query',
      token: token,
    );
    return OperationLogEntry.fromJson(_dataMap(payload));
  }

  @override
  Future<ApiDownloadedFile> export(OperationLogQuery query) {
    return apiClient.getBytes(
      buildPath('/api/operation-logs/export.xlsx', query),
      defaultFileName: '操作日志.xlsx',
      token: token,
    );
  }

  static String buildPath(String path, OperationLogQuery query) {
    final parameters = query.toQueryParameters();
    return parameters.isEmpty
        ? path
        : '$path?${Uri(queryParameters: parameters).query}';
  }
}

class OperationLogsPage extends StatefulWidget {
  const OperationLogsPage({
    super.key,
    required this.apiClient,
    required this.token,
    this.operationLogsApi,
    this.fileSaver,
    this.pageSize = 20,
  });

  final ApiClient apiClient;
  final String token;
  final OperationLogsApi? operationLogsApi;
  final OperationLogFileSaver? fileSaver;
  final int pageSize;

  @override
  State<OperationLogsPage> createState() => _OperationLogsPageState();
}

class _OperationLogsPageState extends State<OperationLogsPage> {
  late final OperationLogsApi _api = widget.operationLogsApi ??
      HttpOperationLogsApi(widget.apiClient, widget.token);
  final _keywordController = TextEditingController();
  final _ipController = TextEditingController();
  OperationLogFilterOptions _options = const OperationLogFilterOptions.empty();
  OperationLogPageResult? _page;
  String? _userId;
  String? _module;
  String? _operationType;
  String? _result;
  DateTimeRange? _dateRange;
  bool _archived = false;
  bool _loading = true;
  bool _exporting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  @override
  void dispose() {
    _keywordController.dispose();
    _ipController.dispose();
    super.dispose();
  }

  Future<void> _loadInitial() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait<dynamic>([
        _api.filterOptions(),
        _api.list(_query(page: 1)),
      ]);
      if (!mounted) return;
      setState(() {
        _options = results[0] as OperationLogFilterOptions;
        _page = results[1] as OperationLogPageResult;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _messageFor(error);
      });
    }
  }

  Future<void> _loadPage([int page = 1]) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await _api.list(_query(page: page));
      if (!mounted) return;
      setState(() {
        _page = result;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _messageFor(error);
      });
    }
  }

  OperationLogQuery _query({required int page}) {
    final keyword = _nonEmpty(_keywordController.text);
    final automaticKeywordStart = keyword == null || _dateRange != null
        ? null
        : DateTime.now().subtract(const Duration(days: 365));
    return OperationLogQuery(
      page: page,
      pageSize: widget.pageSize,
      userId: _userId,
      startTime: _dateRange?.start ?? automaticKeywordStart,
      endTime: _dateRange == null
          ? null
          : DateTime(
              _dateRange!.end.year,
              _dateRange!.end.month,
              _dateRange!.end.day,
              23,
              59,
              59,
              999,
            ),
      module: _module,
      operationType: _operationType,
      result: _result,
      ipAddress: _nonEmpty(_ipController.text),
      keyword: keyword,
      archived: _archived,
    );
  }

  void _reset() {
    setState(() {
      _userId = null;
      _module = null;
      _operationType = null;
      _result = null;
      _dateRange = null;
      _archived = false;
      _keywordController.clear();
      _ipController.clear();
    });
    _loadPage();
  }

  Future<void> _chooseDateRange() async {
    final now = DateTime.now();
    final selected = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 1),
      initialDateRange: _dateRange,
      helpText: '选择日志时间范围',
      cancelText: '取消',
      confirmText: '确定',
    );
    if (selected != null && mounted) {
      setState(() => _dateRange = selected);
    }
  }

  Future<void> _export() async {
    setState(() => _exporting = true);
    try {
      final downloaded = await _api.export(_query(page: 1));
      final saver = widget.fileSaver ??
          (fileName, bytes) => FilePicker.saveFile(
                dialogTitle: '保存操作日志',
                fileName: _safeFileName(fileName),
                bytes: bytes,
              );
      final target = await saver(downloaded.fileName, downloaded.bytes);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(target == null ? '已取消导出。' : '操作日志已导出。'),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          key: const ValueKey('operation-log-export-error'),
          content: Text('导出失败：${_messageFor(error)}'),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _exporting = false);
      }
    }
  }

  Future<void> _showDetail(OperationLogEntry entry) async {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator()),
    );
    try {
      final detail = await _api.detail(entry.id, archived: _archived);
      if (!mounted) return;
      Navigator.of(context).pop();
      await showDialog<void>(
        context: context,
        builder: (context) => _OperationLogDetailDialog(log: detail),
      );
    } catch (error) {
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('加载详情失败：${_messageFor(error)}')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final page = _page;
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Header(total: page?.total ?? 0),
              const SizedBox(height: 12),
              _buildFilters(),
              const SizedBox(height: 12),
              Expanded(child: _buildContent()),
              if (!_loading && _error == null && page != null)
                _Pagination(
                  page: page.page,
                  totalPages: page.totalPages,
                  onPrevious:
                      page.page > 1 ? () => _loadPage(page.page - 1) : null,
                  onNext: page.page < page.totalPages
                      ? () => _loadPage(page.page + 1)
                      : null,
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilters() {
    final content = Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SegmentedButton<bool>(
            key: const ValueKey('operation-log-archive-switch'),
            segments: const [
              ButtonSegment(
                value: false,
                label: Text('在线日志'),
                icon: Icon(Icons.history_rounded),
              ),
              ButtonSegment(
                value: true,
                label: Text('历史归档'),
                icon: Icon(Icons.inventory_2_outlined),
              ),
            ],
            selected: {_archived},
            onSelectionChanged: (values) {
              setState(() => _archived = values.first);
              _loadPage();
            },
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _FilterBox(
                child: KeyedSubtree(
                  key: const ValueKey('operation-log-user-filter'),
                  child: DropdownButtonFormField<String>(
                    key: ValueKey(_userId),
                    initialValue: _userId,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: '操作人'),
                    items: [
                      const DropdownMenuItem(
                        value: null,
                        child: Text('全部操作人'),
                      ),
                      ..._options.users.map(
                        (user) => DropdownMenuItem(
                          value: user.id,
                          child: Text(user.displayLabel),
                        ),
                      ),
                    ],
                    onChanged: (value) => setState(() => _userId = value),
                  ),
                ),
              ),
              _FilterBox(
                child: KeyedSubtree(
                  key: const ValueKey('operation-log-module-filter'),
                  child: DropdownButtonFormField<String>(
                    key: ValueKey(_module),
                    initialValue: _module,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: '所属模块'),
                    items: [
                      const DropdownMenuItem(
                        value: null,
                        child: Text('全部所属模块'),
                      ),
                      ..._options.modules.map(
                        (module) => DropdownMenuItem(
                          value: module,
                          child: Text(
                            OperationLogPresentation.moduleLabel(module),
                          ),
                        ),
                      ),
                    ],
                    onChanged: (value) => setState(() => _module = value),
                  ),
                ),
              ),
              _FilterBox(
                child: KeyedSubtree(
                  key: const ValueKey('operation-log-type-filter'),
                  child: DropdownButtonFormField<String>(
                    key: ValueKey(_operationType),
                    initialValue: _operationType,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: '操作类型'),
                    items: [
                      const DropdownMenuItem(
                        value: null,
                        child: Text('全部类型'),
                      ),
                      ..._options.operationTypes.map(
                        (option) => DropdownMenuItem(
                          value: option.value,
                          child: Text(
                            OperationLogPresentation.operationLabel(
                              option.value,
                              '',
                            ),
                          ),
                        ),
                      ),
                    ],
                    onChanged: (value) =>
                        setState(() => _operationType = value),
                  ),
                ),
              ),
              _FilterBox(
                child: KeyedSubtree(
                  key: const ValueKey('operation-log-result-filter'),
                  child: DropdownButtonFormField<String>(
                    key: ValueKey(_result),
                    initialValue: _result,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: '操作结果'),
                    items: [
                      const DropdownMenuItem(
                        value: null,
                        child: Text('全部结果'),
                      ),
                      ..._options.results.map(
                        (option) => DropdownMenuItem(
                          value: option.value,
                          child: Text(option.label),
                        ),
                      ),
                    ],
                    onChanged: (value) => setState(() => _result = value),
                  ),
                ),
              ),
              _FilterBox(
                width: 220,
                child: OutlinedButton.icon(
                  key: const ValueKey('operation-log-date-filter'),
                  onPressed: _chooseDateRange,
                  icon: const Icon(Icons.date_range_rounded),
                  label: Text(
                    _dateRange == null
                        ? '操作时间'
                        : '${_date(_dateRange!.start)} 至 '
                            '${_date(_dateRange!.end)}',
                  ),
                ),
              ),
              _FilterBox(
                width: 210,
                child: TextField(
                  key: const ValueKey('operation-log-keyword-filter'),
                  controller: _keywordController,
                  decoration: const InputDecoration(
                    labelText: '关键词',
                    hintText: '用户名、订单编号、商品名称',
                    prefixIcon: Icon(Icons.search_rounded),
                  ),
                  onSubmitted: (_) => _loadPage(),
                ),
              ),
            ],
          ),
          ExpansionTile(
            key: const ValueKey('operation-log-more-filters'),
            tilePadding: EdgeInsets.zero,
            childrenPadding: const EdgeInsets.only(bottom: 8),
            title: const Text('更多筛选'),
            dense: true,
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: _FilterBox(
                  child: TextField(
                    key: const ValueKey('operation-log-ip-filter'),
                    controller: _ipController,
                    decoration: const InputDecoration(labelText: 'IP 地址'),
                    onSubmitted: (_) => _loadPage(),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            alignment: WrapAlignment.end,
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                key: const ValueKey('operation-log-reset-button'),
                onPressed: _loading ? null : _reset,
                icon: const Icon(Icons.restart_alt_rounded),
                label: const Text('重置'),
              ),
              FilledButton.icon(
                key: const ValueKey('operation-log-search-button'),
                onPressed: _loading ? null : () => _loadPage(),
                icon: const Icon(Icons.search_rounded),
                label: const Text('查询'),
              ),
              FilledButton.tonalIcon(
                key: const ValueKey('operation-log-export-button'),
                onPressed: _exporting ? null : _export,
                icon: _exporting
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.download_rounded),
                label: const Text('导出 Excel'),
              ),
            ],
          ),
        ],
      ),
    );
    return LayoutBuilder(
      builder: (context, constraints) => Card(
        child: constraints.maxWidth < 700
            ? ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 360),
                child: SingleChildScrollView(child: content),
              )
            : content,
      ),
    );
  }

  Widget _buildContent() {
    if (_loading) {
      return const Center(
        key: ValueKey('operation-log-loading'),
        child: CircularProgressIndicator(),
      );
    }
    if (_error != null) {
      return Center(
        key: const ValueKey('operation-log-error'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded, size: 42),
            const SizedBox(height: 8),
            Text(_error!, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton.icon(
              key: const ValueKey('operation-log-retry-button'),
              onPressed: _loadInitial,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('重试'),
            ),
          ],
        ),
      );
    }
    final logs = _page?.logs ?? const <OperationLogEntry>[];
    if (logs.isEmpty) {
      return const Center(
        key: ValueKey('operation-log-empty'),
        child: Text('没有符合条件的操作日志。'),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 900) {
          return _DesktopLogTable(logs: logs, onOpen: _showDetail);
        }
        return _MobileLogList(logs: logs, onOpen: _showDetail);
      },
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.total});

  final int total;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(
          Icons.manage_history_rounded,
          color: Theme.of(context).colorScheme.primary,
          size: 32,
        ),
        const SizedBox(width: 10),
        const Expanded(
          child: Text(
            '操作日志',
            style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
          ),
        ),
        Chip(
          key: const ValueKey('operation-log-total'),
          label: Text('共 $total 条'),
        ),
      ],
    );
  }
}

class _DesktopLogTable extends StatelessWidget {
  const _DesktopLogTable({required this.logs, required this.onOpen});

  final List<OperationLogEntry> logs;
  final ValueChanged<OperationLogEntry> onOpen;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const ValueKey('operation-log-desktop-table'),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          const _LogTableCells(
            isHeader: true,
            time: '时间',
            actor: '操作人',
            module: '所属模块',
            operation: '操作类型',
            object: '操作对象',
            content: '操作内容',
            result: '结果',
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView.separated(
              itemCount: logs.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final log = logs[index];
                final display = OperationLogPresentation.present(log);
                return InkWell(
                  key: ValueKey('operation-log-row-${log.id}'),
                  onTap: () => onOpen(log),
                  child: _LogTableCells(
                    time: _dateTime(log.createdAt),
                    actor: display.actor,
                    module: display.module,
                    operation: display.operation,
                    object: display.object,
                    content: display.summary,
                    result: display.result,
                    display: display,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _LogTableCells extends StatelessWidget {
  const _LogTableCells({
    required this.time,
    required this.actor,
    required this.module,
    required this.operation,
    required this.object,
    required this.content,
    required this.result,
    this.isHeader = false,
    this.display,
  });

  final String time;
  final String actor;
  final String module;
  final String operation;
  final String object;
  final String content;
  final String result;
  final bool isHeader;
  final OperationLogDisplay? display;

  @override
  Widget build(BuildContext context) {
    final headerStyle = Theme.of(context).textTheme.labelMedium?.copyWith(
          fontWeight: FontWeight.w700,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        );
    final contentColor = display?.isRead == true
        ? Theme.of(context).colorScheme.onSurfaceVariant
        : Theme.of(context).colorScheme.onSurface;
    Widget textCell(String value, {int maxLines = 2}) {
      return Text(
        value,
        maxLines: maxLines,
        overflow: TextOverflow.ellipsis,
        style: isHeader
            ? headerStyle
            : TextStyle(
                color: contentColor,
                fontWeight: value == content && display?.isRead == false
                    ? FontWeight.w600
                    : FontWeight.normal,
              ),
      );
    }

    return Container(
      color: isHeader
          ? Theme.of(context).colorScheme.surfaceContainerHighest
          : null,
      constraints: BoxConstraints(minHeight: isHeader ? 46 : 70),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(flex: 18, child: textCell(time)),
          const SizedBox(width: 8),
          Expanded(flex: 13, child: textCell(actor)),
          const SizedBox(width: 8),
          Expanded(flex: 13, child: textCell(module)),
          const SizedBox(width: 8),
          Expanded(
            flex: 12,
            child: isHeader
                ? textCell(operation)
                : _OperationBadge(display: display!),
          ),
          const SizedBox(width: 8),
          Expanded(flex: 18, child: textCell(object)),
          const SizedBox(width: 8),
          Expanded(
            flex: 34,
            child: isHeader
                ? textCell(content)
                : Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      if (display!.isImportant) const _ImportantBadge(),
                      Text(
                        content,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: contentColor,
                          fontWeight: display!.isRead
                              ? FontWeight.normal
                              : FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
          ),
          const SizedBox(width: 8),
          Expanded(
            flex: 10,
            child: isHeader
                ? textCell(result)
                : _ResultBadge(result: display!.result),
          ),
        ],
      ),
    );
  }
}

class _MobileLogList extends StatelessWidget {
  const _MobileLogList({required this.logs, required this.onOpen});

  final List<OperationLogEntry> logs;
  final ValueChanged<OperationLogEntry> onOpen;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      key: const ValueKey('operation-log-mobile-list'),
      itemCount: logs.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final log = logs[index];
        final display = OperationLogPresentation.present(log);
        return Card(
          key: ValueKey('operation-log-card-${log.id}'),
          child: InkWell(
            onTap: () => onOpen(log),
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            _OperationBadge(display: display),
                            if (display.isImportant) const _ImportantBadge(),
                          ],
                        ),
                      ),
                      _ResultBadge(result: display.result),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    display.summary,
                    style: TextStyle(
                      fontWeight:
                          display.isRead ? FontWeight.normal : FontWeight.w600,
                      color: display.isRead
                          ? Theme.of(context).colorScheme.onSurfaceVariant
                          : null,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${display.actor} · ${display.module} · ${display.object}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _dateTime(log.createdAt),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _OperationBadge extends StatelessWidget {
  const _OperationBadge({required this.display});

  final OperationLogDisplay display;

  @override
  Widget build(BuildContext context) {
    final color = display.isRead
        ? Theme.of(context).colorScheme.outline
        : Theme.of(context).colorScheme.primary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: display.isRead ? 0.08 : 0.12),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        display.operation,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: display.isRead ? FontWeight.w500 : FontWeight.w700,
        ),
      ),
    );
  }
}

class _ImportantBadge extends StatelessWidget {
  const _ImportantBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('operation-log-important-badge'),
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.red.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: Colors.red.withValues(alpha: 0.25)),
      ),
      child: Text(
        '重要操作',
        style: TextStyle(
          color: Colors.red.shade800,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _ResultBadge extends StatelessWidget {
  const _ResultBadge({required this.result});

  final String result;

  @override
  Widget build(BuildContext context) {
    final success = result == 'SUCCESS' || result == '成功';
    return Container(
      key: ValueKey(
        success ? 'operation-log-success-badge' : 'operation-log-failure-badge',
      ),
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: success
            ? Colors.green.withValues(alpha: 0.12)
            : Colors.red.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        success ? '成功' : '失败',
        style: TextStyle(
          color: success ? Colors.green.shade800 : Colors.red.shade800,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _Pagination extends StatelessWidget {
  const _Pagination({
    required this.page,
    required this.totalPages,
    required this.onPrevious,
    required this.onNext,
  });

  final int page;
  final int totalPages;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          IconButton(
            key: const ValueKey('operation-log-previous-page'),
            onPressed: onPrevious,
            tooltip: '上一页',
            icon: const Icon(Icons.chevron_left_rounded),
          ),
          Text('第 $page / ${totalPages == 0 ? 1 : totalPages} 页'),
          IconButton(
            key: const ValueKey('operation-log-next-page'),
            onPressed: onNext,
            tooltip: '下一页',
            icon: const Icon(Icons.chevron_right_rounded),
          ),
        ],
      ),
    );
  }
}

class _OperationLogDetailDialog extends StatelessWidget {
  const _OperationLogDetailDialog({required this.log});

  final OperationLogEntry log;

  @override
  Widget build(BuildContext context) {
    final display = OperationLogPresentation.present(log);
    return Dialog(
      key: const ValueKey('operation-log-detail-dialog'),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 900, maxHeight: 760),
        child: Column(
          children: [
            ListTile(
              title: const Text(
                '日志详情',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              subtitle: Text('${display.module} · ${display.operation}'),
              trailing: IconButton(
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.close_rounded),
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    key: const ValueKey('operation-log-plain-summary'),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Theme.of(context)
                          .colorScheme
                          .primaryContainer
                          .withValues(alpha: 0.55),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.auto_awesome_rounded,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            display.summary,
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  _BasicInformation(
                    log: log,
                    display: display,
                  ),
                  if (display.comparisons.isNotEmpty &&
                      (display.detailKind == OperationLogDetailKind.update ||
                          display.detailKind ==
                              OperationLogDetailKind.review)) ...[
                    const SizedBox(height: 16),
                    _ComparisonSection(rows: display.comparisons),
                  ],
                  for (final section in display.sections) ...[
                    const SizedBox(height: 16),
                    _BusinessDetailSection(section: section),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BasicInformation extends StatelessWidget {
  const _BasicInformation({required this.log, required this.display});

  final OperationLogEntry log;
  final OperationLogDisplay display;

  @override
  Widget build(BuildContext context) {
    final fields = [
      _DetailValue(
        label: '操作时间',
        value: OperationLogPresentation.formatDateTime(log.createdAt),
      ),
      _DetailValue(label: '操作人', value: display.actor),
      _DetailValue(label: '所属模块', value: display.module),
      _DetailValue(label: '操作类型', value: display.operation),
      _DetailValue(label: '操作结果', value: display.result),
      _DetailValue(label: '操作对象', value: display.object),
      if (display.failureReason != null)
        _DetailValue(label: '失败原因', value: display.failureReason!),
    ];
    return _DetailCard(
      title: '基本信息',
      child: Wrap(
        spacing: 12,
        runSpacing: 12,
        children: fields
            .map(
              (field) => SizedBox(
                width: 250,
                child: field,
              ),
            )
            .toList(growable: false),
      ),
    );
  }
}

class _DetailValue extends StatelessWidget {
  const _DetailValue({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        ),
        const SizedBox(height: 3),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
      ],
    );
  }
}

class _BusinessDetailSection extends StatelessWidget {
  const _BusinessDetailSection({required this.section});

  final OperationLogDetailSection section;

  @override
  Widget build(BuildContext context) {
    return _DetailCard(
      title: section.title,
      child: Column(
        children: [
          for (var index = 0; index < section.rows.length; index++) ...[
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 7),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 150,
                    child: Text(
                      section.rows[index].label,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: SelectableText(
                      section.rows[index].value,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
            if (index < section.rows.length - 1) const Divider(height: 1),
          ],
        ],
      ),
    );
  }
}

class _ComparisonSection extends StatelessWidget {
  const _ComparisonSection({required this.rows});

  final List<OperationLogComparison> rows;

  @override
  Widget build(BuildContext context) {
    final borderColor = Theme.of(context).dividerColor;
    return _DetailCard(
      key: const ValueKey('operation-log-comparison'),
      title: '修改前后对比',
      padding: EdgeInsets.zero,
      child: Table(
        key: const ValueKey('operation-log-comparison-table'),
        border: TableBorder.symmetric(inside: BorderSide(color: borderColor)),
        columnWidths: const {
          0: FlexColumnWidth(1.3),
          1: FlexColumnWidth(2),
          2: FlexColumnWidth(2),
        },
        defaultVerticalAlignment: TableCellVerticalAlignment.middle,
        children: [
          TableRow(
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
            ),
            children: const [
              _ComparisonCell(text: '内容', isHeader: true),
              _ComparisonCell(text: '修改前', isHeader: true),
              _ComparisonCell(text: '修改后', isHeader: true),
            ],
          ),
          for (final row in rows)
            TableRow(
              key: ValueKey(
                'operation-log-comparison-${row.label}-${row.changed}',
              ),
              decoration: row.changed
                  ? BoxDecoration(
                      color: Colors.amber.withValues(alpha: 0.1),
                    )
                  : null,
              children: [
                _ComparisonCell(
                  text: row.label,
                  changed: row.changed,
                ),
                _ComparisonCell(
                  text: row.before,
                  changed: row.changed,
                  before: true,
                ),
                _ComparisonCell(
                  text: row.after,
                  changed: row.changed,
                  after: true,
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _ComparisonCell extends StatelessWidget {
  const _ComparisonCell({
    required this.text,
    this.isHeader = false,
    this.changed = false,
    this.before = false,
    this.after = false,
  });

  final String text;
  final bool isHeader;
  final bool changed;
  final bool before;
  final bool after;

  @override
  Widget build(BuildContext context) {
    final textColor = changed && before
        ? Colors.red.shade700
        : changed && after
            ? Colors.green.shade800
            : null;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      child: Wrap(
        spacing: 6,
        runSpacing: 4,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SelectableText(
            text,
            style: TextStyle(
              color: textColor,
              fontWeight: isHeader || (changed && after)
                  ? FontWeight.w700
                  : FontWeight.normal,
            ),
          ),
          if (changed && after)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.green.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(99),
              ),
              child: Text(
                '已修改',
                style: TextStyle(
                  color: Colors.green.shade800,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _DetailCard extends StatelessWidget {
  const _DetailCard({
    super.key,
    required this.title,
    required this.child,
    this.padding = const EdgeInsets.all(14),
  });

  final String title;
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).dividerColor),
        borderRadius: BorderRadius.circular(12),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
            child: Text(
              title,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
          const Divider(height: 1),
          Padding(padding: padding, child: child),
        ],
      ),
    );
  }
}

class _FilterBox extends StatelessWidget {
  const _FilterBox({required this.child, this.width = 190});

  final Widget child;
  final double width;

  @override
  Widget build(BuildContext context) => SizedBox(width: width, child: child);
}

class OperationLogQuery {
  const OperationLogQuery({
    required this.page,
    required this.pageSize,
    this.userId,
    this.startTime,
    this.endTime,
    this.module,
    this.operationType,
    this.action,
    this.entityType,
    this.entityId,
    this.result,
    this.ipAddress,
    this.keyword,
    this.archived = false,
  });

  final int page;
  final int pageSize;
  final String? userId;
  final DateTime? startTime;
  final DateTime? endTime;
  final String? module;
  final String? operationType;
  final String? action;
  final String? entityType;
  final String? entityId;
  final String? result;
  final String? ipAddress;
  final String? keyword;
  final bool archived;

  Map<String, String> toQueryParameters() {
    final parameters = <String, String>{
      'page': '$page',
      'pageSize': '$pageSize',
      'archived': '$archived',
    };
    void add(String key, String? value) {
      final normalized = _nonEmpty(value);
      if (normalized != null) parameters[key] = normalized;
    }

    add('userId', userId);
    if (startTime != null) {
      parameters['startTime'] = startTime!.toUtc().toIso8601String();
    }
    if (endTime != null) {
      parameters['endTime'] = endTime!.toUtc().toIso8601String();
    }
    add('module', module);
    add('operationType', operationType);
    add('action', action);
    add('entityType', entityType);
    add('entityId', entityId);
    add('result', result);
    add('ipAddress', ipAddress);
    add('keyword', keyword);
    return parameters;
  }
}

class OperationLogPageResult {
  const OperationLogPageResult({
    required this.logs,
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  final List<OperationLogEntry> logs;
  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  factory OperationLogPageResult.fromJson(Map<String, dynamic> json) {
    return OperationLogPageResult(
      logs: _mapList(json['logs'])
          .map(OperationLogEntry.fromJson)
          .toList(growable: false),
      page: _int(json['page'], 1),
      pageSize: _int(json['pageSize'], 20),
      total: _int(json['total'], 0),
      totalPages: _int(json['totalPages'], 0),
    );
  }
}

class OperationLogFilterOptions {
  const OperationLogFilterOptions({
    required this.users,
    required this.modules,
    required this.operationTypes,
    required this.results,
  });

  const OperationLogFilterOptions.empty()
      : users = const [],
        modules = const [],
        operationTypes = const [],
        results = const [];

  final List<OperationLogUserOption> users;
  final List<String> modules;
  final List<OperationLogValueOption> operationTypes;
  final List<OperationLogValueOption> results;

  factory OperationLogFilterOptions.fromJson(Map<String, dynamic> json) {
    return OperationLogFilterOptions(
      users: _mapList(json['users'])
          .map(OperationLogUserOption.fromJson)
          .where((option) => option.id != null)
          .toList(growable: false),
      modules: (json['modules'] as List? ?? const [])
          .map((value) => '$value')
          .where((value) => value.isNotEmpty)
          .toList(growable: false),
      operationTypes: _mapList(json['operationTypes'])
          .map(OperationLogValueOption.fromJson)
          .toList(growable: false),
      results: _mapList(json['results'])
          .map(OperationLogValueOption.fromJson)
          .toList(growable: false),
    );
  }
}

class OperationLogUserOption {
  const OperationLogUserOption({
    required this.id,
    required this.name,
    required this.username,
    required this.role,
    required this.isActive,
    required this.historicalOnly,
  });

  final String? id;
  final String name;
  final String username;
  final String role;
  final bool isActive;
  final bool historicalOnly;

  String get displayLabel {
    final suffix = !isActive || historicalOnly ? '（历史/停用）' : '';
    return '$name · $username$suffix';
  }

  factory OperationLogUserOption.fromJson(Map<String, dynamic> json) {
    return OperationLogUserOption(
      id: _string(json['id']),
      name: '${json['name'] ?? '未知用户'}',
      username: '${json['username'] ?? ''}',
      role: '${json['role'] ?? ''}',
      isActive: json['isActive'] == true,
      historicalOnly: json['historicalOnly'] == true,
    );
  }
}

class OperationLogValueOption {
  const OperationLogValueOption({
    required this.value,
    required this.label,
  });

  final String value;
  final String label;

  factory OperationLogValueOption.fromJson(Map<String, dynamic> json) {
    return OperationLogValueOption(
      value: '${json['value'] ?? ''}',
      label: '${json['label'] ?? json['value'] ?? ''}',
    );
  }
}

Map<String, dynamic> _dataMap(Map<String, dynamic> payload) {
  final data = payload['data'];
  return data is Map
      ? data.map((key, value) => MapEntry('$key', value))
      : payload;
}

List<Map<String, dynamic>> _mapList(dynamic value) {
  return (value as List? ?? const [])
      .whereType<Map>()
      .map((item) => item.map((key, value) => MapEntry('$key', value)))
      .toList(growable: false);
}

String? _string(dynamic value) {
  if (value == null) return null;
  final normalized = '$value'.trim();
  return normalized.isEmpty ? null : normalized;
}

int _int(dynamic value, int fallback) => int.tryParse('$value') ?? fallback;

String? _nonEmpty(String? value) {
  final normalized = value?.trim() ?? '';
  return normalized.isEmpty ? null : normalized;
}

String _date(DateTime value) => '${value.year.toString().padLeft(4, '0')}-'
    '${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';

String _dateTime(DateTime value) {
  final local = value.toLocal();
  return '${_date(local)} '
      '${local.hour.toString().padLeft(2, '0')}:'
      '${local.minute.toString().padLeft(2, '0')}:'
      '${local.second.toString().padLeft(2, '0')}';
}

String _messageFor(Object error) {
  return error is ApiException ? error.message : '请求失败，请稍后重试。';
}

String _safeFileName(String value) {
  final sanitized =
      value.replaceAll(RegExp(r'[<>:"/\\|?*\u0000-\u001f]'), '_').trim();
  return sanitized.isEmpty ? '操作日志.xlsx' : sanitized;
}
