import 'package:flutter/material.dart';

import '../../core/business/business_api.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';

typedef TravelGroupListLoader = Future<List<TravelGroupRecord>> Function(
  TravelGroupPickerQuery query,
);

typedef TasterListLoader = Future<List<TasterOption>> Function();

enum TravelGroupSearchScope {
  taster,
  tastingRoomNo,
}

class TravelGroupPickerQuery {
  const TravelGroupPickerQuery({
    required this.scope,
    required this.tasterId,
    required this.tastingRoomNo,
    required this.limit,
  });

  final TravelGroupSearchScope scope;
  final String? tasterId;
  final String? tastingRoomNo;
  final int limit;
}

class TravelGroupPickerDialog extends StatefulWidget {
  const TravelGroupPickerDialog({
    super.key,
    this.businessApi,
    this.loadTravelGroups,
    this.loadTasters,
    this.initialTasterId,
    this.limit = 30,
    this.showFinanceMark = false,
  }) : assert(
          businessApi != null ||
              (loadTravelGroups != null && loadTasters != null),
          'businessApi or both loaders must be provided.',
        );

  final BusinessApi? businessApi;
  final TravelGroupListLoader? loadTravelGroups;
  final TasterListLoader? loadTasters;
  final String? initialTasterId;
  final int limit;
  final bool showFinanceMark;

  @override
  State<TravelGroupPickerDialog> createState() =>
      _TravelGroupPickerDialogState();
}

class _TravelGroupPickerDialogState extends State<TravelGroupPickerDialog> {
  late final TextEditingController _tastingRoomNoController;
  TravelGroupSearchScope _scope = TravelGroupSearchScope.taster;
  String? _selectedTasterId;
  List<TasterOption> _tasters = const <TasterOption>[];
  List<TravelGroupRecord> _groups = const <TravelGroupRecord>[];
  TravelGroupPickerQuery? _lastQuery;
  bool _loadingTasters = true;
  bool _loading = true;
  String? _tasterErrorMessage;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _tastingRoomNoController = TextEditingController();
    _selectedTasterId = _trimmedOrNull(widget.initialTasterId);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadTasters();
      _loadTravelGroups();
    });
  }

  @override
  void dispose() {
    _tastingRoomNoController.dispose();
    super.dispose();
  }

  Future<void> _loadTasters() async {
    setState(() {
      _loadingTasters = true;
      _tasterErrorMessage = null;
    });

    try {
      final loader = widget.loadTasters;
      final tasters = loader == null
          ? await widget.businessApi!.listTasters()
          : await loader();
      if (!mounted) {
        return;
      }
      setState(() {
        _tasters = tasters;
        _loadingTasters = false;
        if (_selectedTasterId != null &&
            !tasters.any((taster) => taster.id == _selectedTasterId)) {
          _selectedTasterId = null;
        }
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _tasters = const <TasterOption>[];
        _loadingTasters = false;
        _tasterErrorMessage = _messageForError(error);
      });
    }
  }

  TravelGroupPickerQuery _query({required bool applyFilter}) {
    return TravelGroupPickerQuery(
      scope: _scope,
      tasterId: applyFilter && _scope == TravelGroupSearchScope.taster
          ? _trimmedOrNull(_selectedTasterId)
          : null,
      tastingRoomNo:
          applyFilter && _scope == TravelGroupSearchScope.tastingRoomNo
              ? _trimmedOrNull(_tastingRoomNoController.text)
              : null,
      limit: widget.limit,
    );
  }

  Future<void> _loadTravelGroups({
    TravelGroupPickerQuery? query,
    bool applyFilter = false,
  }) async {
    final effectiveQuery = query ?? _query(applyFilter: applyFilter);
    _lastQuery = effectiveQuery;
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final loader = widget.loadTravelGroups;
      final groups = loader == null
          ? await widget.businessApi!.listTravelGroups(
              limit: effectiveQuery.limit,
              tasterId: effectiveQuery.tasterId,
              tastingRoomNo: effectiveQuery.tastingRoomNo,
            )
          : await loader(effectiveQuery);
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

  void _changeScope(TravelGroupSearchScope scope) {
    setState(() {
      _scope = scope;
      _selectedTasterId = null;
      _tastingRoomNoController.clear();
    });
    _loadTravelGroups();
  }

  bool get _canSearch {
    if (_loading || _loadingTasters) {
      return false;
    }
    switch (_scope) {
      case TravelGroupSearchScope.taster:
        return _trimmedOrNull(_selectedTasterId) != null;
      case TravelGroupSearchScope.tastingRoomNo:
        return _trimmedOrNull(_tastingRoomNoController.text) != null;
    }
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
                            _changeScope(scope);
                          },
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _scope == TravelGroupSearchScope.taster
                      ? DropdownButtonFormField<String>(
                          key: const ValueKey('travel-group-taster-field'),
                          initialValue: _tasters.any(
                            (taster) => taster.id == _selectedTasterId,
                          )
                              ? _selectedTasterId
                              : null,
                          isExpanded: true,
                          decoration: InputDecoration(
                            labelText: '品鉴师',
                            hintText: _loadingTasters ? '正在加载品鉴师' : '请选择品鉴师',
                          ),
                          items: [
                            for (final taster in _tasters)
                              DropdownMenuItem(
                                value: taster.id,
                                child: Text(_tasterLabel(taster)),
                              ),
                          ],
                          onChanged: _loadingTasters
                              ? null
                              : (value) {
                                  setState(() => _selectedTasterId = value);
                                },
                        )
                      : TextField(
                          key: const ValueKey(
                            'travel-group-tasting-room-no-field',
                          ),
                          controller: _tastingRoomNoController,
                          decoration: InputDecoration(
                            labelText: '品鉴馆号',
                            hintText: '输入品鉴馆号',
                            prefixIcon: const Icon(Icons.meeting_room_rounded),
                            suffixIcon:
                                _tastingRoomNoController.text.trim().isEmpty
                                    ? null
                                    : IconButton(
                                        tooltip: '清空馆号',
                                        onPressed: () {
                                          _tastingRoomNoController.clear();
                                          setState(() {});
                                          _loadTravelGroups();
                                        },
                                        icon: const Icon(Icons.close_rounded),
                                      ),
                          ),
                          textInputAction: TextInputAction.search,
                          onChanged: (_) => setState(() {}),
                          onSubmitted: (_) {
                            if (_canSearch) {
                              _loadTravelGroups(applyFilter: true);
                            }
                          },
                        ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                const Spacer(),
                FilledButton.icon(
                  key: const ValueKey('travel-group-search-button'),
                  onPressed: _canSearch
                      ? () => _loadTravelGroups(applyFilter: true)
                      : null,
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
    if (_scope == TravelGroupSearchScope.taster && _loadingTasters) {
      return const LoadingState(title: '正在加载品鉴师');
    }
    if (_scope == TravelGroupSearchScope.taster &&
        _tasterErrorMessage != null) {
      return ErrorState(
        title: _tasterErrorMessage!,
        onRetry: _loadTasters,
      );
    }
    if (_errorMessage != null) {
      return ErrorState(
        title: _errorMessage!,
        onRetry: () => _loadTravelGroups(query: _lastQuery),
      );
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
          showFinanceMark: widget.showFinanceMark,
          onTap: () => Navigator.of(context).pop(group),
        );
      },
    );
  }
}

class _TravelGroupListTile extends StatelessWidget {
  const _TravelGroupListTile({
    required this.group,
    required this.showFinanceMark,
    required this.onTap,
  });

  final TravelGroupRecord group;
  final bool showFinanceMark;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final visitDate =
        group.visitDate.trim().isEmpty ? '未填写到店日期' : group.visitDate;
    final taster = _display(
      group.tasterName,
      fallback: '未分配品鉴师',
    );
    final tastingRoomNo = _display(
      group.tastingRoomNo,
      fallback: '未填写品鉴馆号',
    );
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
          if (showFinanceMark)
            StatusTag(
              label: group.financeMark ? '已标记' : '未标记',
              tone: group.financeMark ? StatusTone.success : StatusTone.neutral,
            ),
          if (group.isHistoricalCompleted)
            const StatusTag(
              label: '已结束',
              tone: StatusTone.neutral,
            ),
        ],
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('到店日期：$visitDate'),
            const SizedBox(height: 2),
            Text('品鉴师：$taster'),
            const SizedBox(height: 2),
            Text('品鉴馆号：$tastingRoomNo'),
          ],
        ),
      ),
      trailing: const Icon(Icons.check_circle_outline_rounded),
      onTap: onTap,
    );
  }
}

String _scopeLabel(TravelGroupSearchScope scope) {
  switch (scope) {
    case TravelGroupSearchScope.taster:
      return '品鉴师';
    case TravelGroupSearchScope.tastingRoomNo:
      return '品鉴馆号';
  }
}

String _tasterLabel(TasterOption taster) {
  final name = taster.name.trim();
  if (name.isNotEmpty) {
    return name;
  }
  final username = taster.username.trim();
  return username.isEmpty ? '未命名品鉴师' : username;
}

String? _trimmedOrNull(String? value) {
  final trimmed = value?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
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
