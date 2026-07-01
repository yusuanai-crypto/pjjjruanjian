import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/business/business_api.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';

typedef TravelGroupListLoader = Future<List<TravelGroupRecord>> Function(
  TravelGroupPickerQuery query,
);

enum TravelGroupSearchScope {
  keyword,
  groupNo,
  travelAgency,
  guide,
}

class TravelGroupPickerQuery {
  const TravelGroupPickerQuery({
    required this.scope,
    required this.text,
    required this.start,
    required this.end,
    required this.limit,
  });

  final TravelGroupSearchScope scope;
  final String text;
  final DateTime? start;
  final DateTime? end;
  final int limit;
}

class TravelGroupPickerDialog extends StatefulWidget {
  const TravelGroupPickerDialog({
    super.key,
    this.businessApi,
    this.loadTravelGroups,
    this.initialQuery,
    this.initialStart,
    this.initialEnd,
    this.limit = 30,
  }) : assert(
          businessApi != null || loadTravelGroups != null,
          'businessApi or loadTravelGroups must be provided.',
        );

  final BusinessApi? businessApi;
  final TravelGroupListLoader? loadTravelGroups;
  final String? initialQuery;
  final DateTime? initialStart;
  final DateTime? initialEnd;
  final int limit;

  @override
  State<TravelGroupPickerDialog> createState() =>
      _TravelGroupPickerDialogState();
}

class _TravelGroupPickerDialogState extends State<TravelGroupPickerDialog> {
  late final TextEditingController _searchController;
  TravelGroupSearchScope _scope = TravelGroupSearchScope.keyword;
  DateTime? _start;
  DateTime? _end;
  List<TravelGroupRecord> _groups = const <TravelGroupRecord>[];
  bool _loading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController(text: widget.initialQuery ?? '');
    _start = widget.initialStart;
    _end = widget.initialEnd;
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final query = TravelGroupPickerQuery(
        scope: _scope,
        text: _searchController.text.trim(),
        start: _start,
        end: _end,
        limit: widget.limit,
      );
      final loader = widget.loadTravelGroups;
      final groups = loader == null
          ? await widget.businessApi!.listTravelGroups(
              limit: widget.limit,
              start: _start,
              end: _end,
              keyword: _keywordFor(query),
              groupNo: _groupNoFor(query),
            )
          : await loader(query);
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = groups;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = const <TravelGroupRecord>[];
        _loading = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  Future<void> _pickDateRange() async {
    final now = DateTime.now();
    final initialStart = _start ?? now;
    final initialEnd = _end ?? initialStart;
    final result = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 3),
      lastDate: DateTime(now.year + 3, 12, 31),
      initialDateRange: DateTimeRange(start: initialStart, end: initialEnd),
    );
    if (result == null || !mounted) {
      return;
    }
    setState(() {
      _start = result.start;
      _end = result.end;
    });
    await _load();
  }

  void _clearDateRange() {
    setState(() {
      _start = null;
      _end = null;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('选择旅行团'),
      content: SizedBox(
        width: 700,
        height: 560,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 150,
                  child: DropdownButtonFormField<TravelGroupSearchScope>(
                    key: const ValueKey('travel-group-search-scope'),
                    initialValue: _scope,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: '搜索范围'),
                    items: [
                      for (final scope in TravelGroupSearchScope.values)
                        DropdownMenuItem(
                          value: scope,
                          child: Text(_scopeLabel(scope)),
                        ),
                    ],
                    onChanged: _loading
                        ? null
                        : (scope) {
                            if (scope == null) {
                              return;
                            }
                            setState(() => _scope = scope);
                          },
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    key: const ValueKey('travel-group-search-field'),
                    controller: _searchController,
                    decoration: InputDecoration(
                      labelText: _searchLabel(_scope),
                      hintText: _searchHint(_scope),
                      prefixIcon: const Icon(Icons.search_rounded),
                      suffixIcon: _searchController.text.trim().isEmpty
                          ? null
                          : IconButton(
                              tooltip: '清空搜索',
                              onPressed: () {
                                _searchController.clear();
                                _load();
                              },
                              icon: const Icon(Icons.close_rounded),
                            ),
                    ),
                    textInputAction: TextInputAction.search,
                    onChanged: (_) => setState(() {}),
                    onSubmitted: (_) => _load(),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                OutlinedButton.icon(
                  key: const ValueKey('travel-group-date-button'),
                  onPressed: _loading ? null : _pickDateRange,
                  icon: const Icon(Icons.event_rounded),
                  label: Text(_dateLabel()),
                ),
                if (_start != null || _end != null) ...[
                  const SizedBox(width: 6),
                  IconButton(
                    key: const ValueKey('travel-group-clear-date-button'),
                    tooltip: '清空日期',
                    onPressed: _loading ? null : _clearDateRange,
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
                const Spacer(),
                FilledButton.icon(
                  key: const ValueKey('travel-group-search-button'),
                  onPressed: _loading ? null : _load,
                  icon: const Icon(Icons.search_rounded),
                  label: const Text('搜索'),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Expanded(child: _buildResult()),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
      ],
    );
  }

  Widget _buildResult() {
    if (_loading) {
      return const LoadingState(title: '正在加载旅行团');
    }
    if (_errorMessage != null) {
      return ErrorState(title: _errorMessage!, onRetry: _load);
    }
    if (_groups.isEmpty) {
      return const EmptyState(
        key: ValueKey('travel-group-empty-state'),
        title: '暂无匹配旅行团',
      );
    }

    return ListView.separated(
      key: const ValueKey('travel-group-result-list'),
      itemCount: _groups.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final group = _groups[index];
        return _TravelGroupListTile(
          group: group,
          onTap: () => Navigator.of(context).pop(group),
        );
      },
    );
  }

  String _dateLabel() {
    if (_start == null && _end == null) {
      return '到店日期';
    }
    if (_start != null && _end != null) {
      return '${formatDate(_start!)} 至 ${formatDate(_end!)}';
    }
    return formatDate((_start ?? _end)!);
  }
}

class _TravelGroupListTile extends StatelessWidget {
  const _TravelGroupListTile({
    required this.group,
    required this.onTap,
  });

  final TravelGroupRecord group;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final agency = _display(group.travelAgency, fallback: '未填写旅行社');
    final guide = _display(group.guideName, fallback: '未填写导游');
    final visitDate =
        group.visitDate.trim().isEmpty ? '未填写到店日期' : group.visitDate;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      leading: CircleAvatar(
        child: Text(_initial(group.groupNo)),
      ),
      title: Wrap(
        spacing: 8,
        runSpacing: 6,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            group.groupNo,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
          StatusTag(
            label: group.financeMark ? '已标记' : '未标记',
            tone: group.financeMark ? StatusTone.success : StatusTone.neutral,
          ),
        ],
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('旅行社：$agency'),
            const SizedBox(height: 2),
            Text('导游：$guide'),
            const SizedBox(height: 2),
            Text('到店日期：$visitDate'),
          ],
        ),
      ),
      trailing: const Icon(Icons.check_circle_outline_rounded),
      onTap: onTap,
    );
  }
}

String? _keywordFor(TravelGroupPickerQuery query) {
  if (query.text.isEmpty) {
    return null;
  }
  switch (query.scope) {
    case TravelGroupSearchScope.keyword:
    case TravelGroupSearchScope.travelAgency:
    case TravelGroupSearchScope.guide:
      return query.text;
    case TravelGroupSearchScope.groupNo:
      return null;
  }
}

String? _groupNoFor(TravelGroupPickerQuery query) {
  if (query.text.isEmpty || query.scope != TravelGroupSearchScope.groupNo) {
    return null;
  }
  return query.text;
}

String _scopeLabel(TravelGroupSearchScope scope) {
  switch (scope) {
    case TravelGroupSearchScope.keyword:
      return '关键词';
    case TravelGroupSearchScope.groupNo:
      return '团号';
    case TravelGroupSearchScope.travelAgency:
      return '旅行社';
    case TravelGroupSearchScope.guide:
      return '导游';
  }
}

String _searchLabel(TravelGroupSearchScope scope) {
  switch (scope) {
    case TravelGroupSearchScope.keyword:
      return '搜索旅行团';
    case TravelGroupSearchScope.groupNo:
      return '搜索团号';
    case TravelGroupSearchScope.travelAgency:
      return '搜索旅行社';
    case TravelGroupSearchScope.guide:
      return '搜索导游';
  }
}

String _searchHint(TravelGroupSearchScope scope) {
  switch (scope) {
    case TravelGroupSearchScope.keyword:
      return '输入团号、旅行社或导游';
    case TravelGroupSearchScope.groupNo:
      return '输入团号';
    case TravelGroupSearchScope.travelAgency:
      return '输入旅行社名称';
    case TravelGroupSearchScope.guide:
      return '输入导游姓名';
  }
}

String _display(String? value, {required String fallback}) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? fallback : text;
}

String _initial(String value) {
  final text = value.trim();
  if (text.isEmpty) {
    return '?';
  }
  return text.substring(0, 1);
}

String _messageForError(Object error) {
  final text = error.toString();
  if (text.startsWith('Exception: ')) {
    return text.substring('Exception: '.length);
  }
  return text;
}
