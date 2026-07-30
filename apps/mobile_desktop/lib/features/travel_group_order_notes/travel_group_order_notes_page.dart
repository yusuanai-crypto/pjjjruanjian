import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/search_filter_bar.dart';
import '../../shared/widgets/status_tag.dart';
import '../../shared/widgets/time_picker_field.dart';
import '../travel_groups/travel_group_picker_dialog.dart';
import '../travel_groups/tasting_items_editor.dart';

class TravelGroupOrderNotesPage extends StatefulWidget {
  const TravelGroupOrderNotesPage({
    super.key,
    required this.apiClient,
    required this.token,
    this.role = UserRole.sales,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<TravelGroupOrderNotesPage> createState() =>
      _TravelGroupOrderNotesPageState();
}

class _TravelGroupOrderNotesPageState extends State<TravelGroupOrderNotesPage> {
  late BusinessApi _businessApi;
  late final TextEditingController _searchController;

  List<TravelGroupRecord> _groups = const <TravelGroupRecord>[];
  List<TasterOption> _tasters = const <TasterOption>[];
  TravelGroupSearchScope _scope = TravelGroupSearchScope.taster;
  String _filter = '待销售';
  String? _selectedTasterId;
  String? _selectedGroupId;
  bool _loadingTasters = true;
  bool _loading = true;
  String? _tasterErrorMessage;
  String? _errorMessage;
  String? _successMessage;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _searchController = TextEditingController();
    _loadTasters();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant TravelGroupOrderNotesPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _loadTasters();
      _loadData();
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadTasters() async {
    setState(() {
      _loadingTasters = true;
      _tasterErrorMessage = null;
    });
    try {
      final tasters = await _businessApi.listTasters();
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

  Future<void> _loadData({bool applyFilter = false}) async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final groups = await _businessApi.listTravelGroups(
        limit: 100,
        tasterId: applyFilter && _scope == TravelGroupSearchScope.taster
            ? _trimmedOrNull(_selectedTasterId)
            : null,
        tastingRoomNo:
            applyFilter && _scope == TravelGroupSearchScope.tastingRoomNo
                ? _trimmedOrNull(_searchController.text)
                : null,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = groups;
        _loading = false;
        _selectedGroupId = _selectedGroupIdFor(groups);
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

  String? _selectedGroupIdFor(List<TravelGroupRecord> groups) {
    if (groups.isEmpty) {
      return null;
    }
    if (_selectedGroupId != null &&
        groups.any((group) => group.id == _selectedGroupId)) {
      return _selectedGroupId;
    }
    return groups.first.id;
  }

  List<TravelGroupRecord> get _visibleGroups {
    return _groups.where((group) {
      if (_filter == '待销售' && !_needsSupplement(group)) {
        return false;
      }
      if (_filter == '已出单' && group.status != 'ordered') {
        return false;
      }
      return true;
    }).toList();
  }

  void _changeScope(TravelGroupSearchScope scope) {
    setState(() {
      _scope = scope;
      _selectedTasterId = null;
      _searchController.clear();
    });
    _loadData();
  }

  bool get _canSearch {
    if (_loading || _loadingTasters) {
      return false;
    }
    switch (_scope) {
      case TravelGroupSearchScope.taster:
        return _trimmedOrNull(_selectedTasterId) != null;
      case TravelGroupSearchScope.tastingRoomNo:
        return _trimmedOrNull(_searchController.text) != null;
    }
  }

  Future<void> _openNotesEditor(TravelGroupRecord group) async {
    setState(() {
      _selectedGroupId = group.id;
      _successMessage = null;
      _errorMessage = null;
    });

    final TravelGroupRecord? updated;
    if (isDesktopWidth(MediaQuery.sizeOf(context).width)) {
      updated = await showDialog<TravelGroupRecord>(
        context: context,
        builder: (dialogContext) {
          return Dialog(
            clipBehavior: Clip.antiAlias,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 800),
              child: SizedBox(
                width: 800,
                height: MediaQuery.sizeOf(dialogContext).height * 0.9,
                child: _NotesEditor(
                  businessApi: _businessApi,
                  group: group,
                ),
              ),
            ),
          );
        },
      );
    } else {
      updated = await showModalBottomSheet<TravelGroupRecord>(
        context: context,
        isScrollControlled: true,
        isDismissible: true,
        enableDrag: false,
        useSafeArea: true,
        backgroundColor: Colors.transparent,
        builder: (sheetContext) {
          final mediaQuery = MediaQuery.of(sheetContext);
          final availableHeight =
              mediaQuery.size.height - mediaQuery.viewInsets.bottom;
          return AnimatedPadding(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            padding: EdgeInsets.only(bottom: mediaQuery.viewInsets.bottom),
            child: SizedBox(
              height: availableHeight * 0.94,
              child: _NotesEditor(
                businessApi: _businessApi,
                group: group,
              ),
            ),
          );
        },
      );
    }

    if (updated == null || !mounted) {
      return;
    }
    final savedGroup = updated;
    final message = '保存成功：${savedGroup.groupNo}';
    setState(() {
      _groups = [
        for (final item in _groups)
          item.id == savedGroup.id ? savedGroup : item,
      ];
      _selectedGroupId = savedGroup.id;
      _successMessage = message;
      _errorMessage = null;
    });
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          duration: const Duration(milliseconds: 2500),
        ),
      );
  }

  bool _needsSupplement(TravelGroupRecord group) {
    return (group.departureTime ?? '').isEmpty || group.lossStatus == 'PENDING';
  }

  @override
  Widget build(BuildContext context) {
    final visibleGroups = _visibleGroups;

    return ResponsivePage(
      maxWidth: 1440,
      children: [
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        if (_tasterErrorMessage != null)
          _InlineNotice(
            message: _tasterErrorMessage!,
            tone: StatusTone.danger,
          ),
        if (_successMessage != null)
          _InlineNotice(message: _successMessage!, tone: StatusTone.success),
        _OrderNotesSummary(
          groupCount: _groups.length,
          pendingCount: _groups.where(_needsSupplement).length,
        ),
        _GroupQueue(
          loading: _loading,
          loadingTasters: _loadingTasters,
          searchController: _searchController,
          scope: _scope,
          tasters: _tasters,
          selectedTasterId: _selectedTasterId,
          filter: _filter,
          groups: visibleGroups,
          selectedGroupId: _selectedGroupId,
          canSearch: _canSearch,
          onScopeChanged: _changeScope,
          onTasterChanged: (value) {
            setState(() => _selectedTasterId = value);
          },
          onRoomNoChanged: (_) => setState(() {}),
          onSearch: () => _loadData(applyFilter: true),
          onFilterChanged: (value) => setState(() => _filter = value),
          onSelectGroup: _openNotesEditor,
        ),
      ],
    );
  }
}

class _OrderNotesSummary extends StatelessWidget {
  const _OrderNotesSummary({
    required this.groupCount,
    required this.pendingCount,
  });

  final int groupCount;
  final int pendingCount;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        StatusTag(label: '旅行团 $groupCount 个', tone: StatusTone.info),
        StatusTag(label: '待销售 $pendingCount 个', tone: StatusTone.warning),
      ],
    );
  }
}

class _GroupQueue extends StatelessWidget {
  const _GroupQueue({
    required this.loading,
    required this.loadingTasters,
    required this.searchController,
    required this.scope,
    required this.tasters,
    required this.selectedTasterId,
    required this.filter,
    required this.groups,
    required this.selectedGroupId,
    required this.canSearch,
    required this.onScopeChanged,
    required this.onTasterChanged,
    required this.onRoomNoChanged,
    required this.onSearch,
    required this.onFilterChanged,
    required this.onSelectGroup,
  });

  final bool loading;
  final bool loadingTasters;
  final TextEditingController searchController;
  final TravelGroupSearchScope scope;
  final List<TasterOption> tasters;
  final String? selectedTasterId;
  final String filter;
  final List<TravelGroupRecord> groups;
  final String? selectedGroupId;
  final bool canSearch;
  final ValueChanged<TravelGroupSearchScope> onScopeChanged;
  final ValueChanged<String?> onTasterChanged;
  final ValueChanged<String> onRoomNoChanged;
  final VoidCallback onSearch;
  final ValueChanged<String> onFilterChanged;
  final ValueChanged<TravelGroupRecord> onSelectGroup;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FormSection(
          title: '选择旅行团',
          trailing:
              StatusTag(label: '${groups.length} 个团', tone: StatusTone.info),
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 150,
                  child: DropdownButtonFormField<TravelGroupSearchScope>(
                    key: const ValueKey(
                      'travel-group-notes-search-scope',
                    ),
                    initialValue: scope,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: '搜索范围'),
                    items: [
                      for (final item in TravelGroupSearchScope.values)
                        DropdownMenuItem(
                          value: item,
                          child: Text(_travelGroupScopeLabel(item)),
                        ),
                    ],
                    onChanged: loading
                        ? null
                        : (value) {
                            if (value != null) {
                              onScopeChanged(value);
                            }
                          },
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: scope == TravelGroupSearchScope.taster
                      ? DropdownButtonFormField<String>(
                          key: const ValueKey(
                            'travel-group-notes-taster-field',
                          ),
                          initialValue: tasters.any(
                            (taster) => taster.id == selectedTasterId,
                          )
                              ? selectedTasterId
                              : null,
                          isExpanded: true,
                          decoration: InputDecoration(
                            labelText: '品鉴师',
                            hintText: loadingTasters ? '正在加载品鉴师' : '请选择品鉴师',
                          ),
                          items: [
                            for (final taster in tasters)
                              DropdownMenuItem(
                                value: taster.id,
                                child: Text(_tasterOptionLabel(taster)),
                              ),
                          ],
                          onChanged: loadingTasters ? null : onTasterChanged,
                        )
                      : TextField(
                          key: const ValueKey(
                            'travel-group-notes-tasting-room-no-field',
                          ),
                          controller: searchController,
                          decoration: const InputDecoration(
                            labelText: '品鉴馆号',
                            hintText: '输入品鉴馆号',
                            prefixIcon: Icon(Icons.meeting_room_rounded),
                          ),
                          textInputAction: TextInputAction.search,
                          onChanged: onRoomNoChanged,
                          onSubmitted: (_) {
                            if (canSearch) {
                              onSearch();
                            }
                          },
                        ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                key: const ValueKey('travel-group-notes-search-button'),
                onPressed: canSearch ? onSearch : null,
                icon: const Icon(Icons.search_rounded),
                label: const Text('搜索'),
              ),
            ),
            const SizedBox(height: 12),
            AppFilterBar(
              filters: const ['待销售', '已出单', '全部'],
              selected: filter,
              onSelected: onFilterChanged,
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (loading)
          const Center(child: CircularProgressIndicator())
        else if (groups.isEmpty)
          const _EmptyCard(title: '暂无符合条件的旅行团')
        else
          AppRecordList(
            items: [
              for (final group in groups)
                AppRecordItem(
                  title: group.groupNo,
                  subtitle:
                      '${group.travelAgency ?? '未填旅行社'} · ${group.guideName ?? '未填导游'}',
                  meta: [
                    '到店日期：${_displayValue(group.visitDate, '未填写到店日期')}',
                    '品鉴师：${_displayValue(group.tasterName, '未分配品鉴师')}',
                    '品鉴馆号：${_displayValue(group.tastingRoomNo, '未填写品鉴馆号')}',
                    group.guestCount > 0 ? '${group.guestCount} 人' : '人数未填写',
                  ],
                  icon: selectedGroupId == group.id
                      ? Icons.radio_button_checked_rounded
                      : Icons.directions_bus_rounded,
                  trailing: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      StatusTag(
                        label: _groupStatusLabel(group.status),
                        tone: _groupStatusTone(group.status),
                      ),
                      const SizedBox(height: 4),
                      StatusTag(
                        label: _lossStatusLabel(group.lossStatus),
                        tone: _lossStatusTone(group.lossStatus),
                      ),
                    ],
                  ),
                  onTap: () => onSelectGroup(group),
                ),
            ],
          ),
      ],
    );
  }
}

class _NotesEditor extends StatefulWidget {
  const _NotesEditor({
    required this.businessApi,
    required this.group,
  });

  final BusinessApi businessApi;
  final TravelGroupRecord group;

  @override
  State<_NotesEditor> createState() => _NotesEditorState();
}

class _NotesEditorState extends State<_NotesEditor> {
  final _tastingItemsKey = GlobalKey<TastingItemsEditorState>();

  late final TextEditingController _departureTimeController;
  late final TextEditingController _remarksController;
  late final List<TastingItemDraft> _initialTastingItemDrafts;
  late final List<Map<String, dynamic>> _initialTastingItems;
  late List<Map<String, dynamic>> _tastingItems;
  late final String _initialDepartureTime;
  late final String _initialRemarks;

  bool _saving = false;
  bool _allowPop = false;
  bool _confirmingDiscard = false;
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    _initialDepartureTime = normalizeTimeText(widget.group.departureTime);
    _initialRemarks = widget.group.remarks ?? '';
    _initialTastingItemDrafts = _tastingDraftsFromGroup(widget.group);
    _initialTastingItems = _tastingPayloadFromGroup(widget.group);
    _tastingItems = [
      for (final item in _initialTastingItems) Map<String, dynamic>.from(item),
    ];
    _departureTimeController =
        TextEditingController(text: _initialDepartureTime)
          ..addListener(_updateDirty);
    _remarksController = TextEditingController(text: _initialRemarks)
      ..addListener(_updateDirty);
  }

  @override
  void dispose() {
    _departureTimeController
      ..removeListener(_updateDirty)
      ..dispose();
    _remarksController
      ..removeListener(_updateDirty)
      ..dispose();
    super.dispose();
  }

  void _updateDirty() {
    final dirty = _departureTimeController.text != _initialDepartureTime ||
        _remarksController.text != _initialRemarks ||
        jsonEncode(_tastingItems) != jsonEncode(_initialTastingItems);
    if (dirty == _dirty || !mounted) {
      return;
    }
    setState(() => _dirty = dirty);
  }

  void _handleTastingItemsChanged(List<Map<String, dynamic>> items) {
    _tastingItems = [
      for (final item in items) Map<String, dynamic>.from(item),
    ];
    _updateDirty();
  }

  void _clear() {
    _tastingItemsKey.currentState?.clear();
    _departureTimeController.clear();
    _remarksController.clear();
    _tastingItems = const <Map<String, dynamic>>[];
    _updateDirty();
  }

  Future<void> _saveSupplement() async {
    if (_saving) {
      return;
    }
    final tastingValid = _tastingItemsKey.currentState?.validate() ?? true;
    if (!tastingValid) {
      await _showEditorMessage(
        title: '无法保存',
        message: '请先补全品酒明细。',
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'departureTime': normalizeTimeText(_departureTimeController.text),
        'remarks': _remarksController.text.trim(),
      };
      if (_tastingItems.isNotEmpty || widget.group.tastingItems.isNotEmpty) {
        body['tastingItems'] = _tastingItems;
      }
      final updated =
          await widget.businessApi.updateTravelGroup(widget.group.id, body);
      if (!mounted) {
        return;
      }
      _closeWithResult(updated);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _saving = false);
      await _showEditorMessage(
        title: '保存失败',
        message: _messageForSaveError(error),
      );
    }
  }

  Future<void> _confirmNoLoss() async {
    if (_saving) {
      return;
    }
    if (_tastingItems.isNotEmpty || widget.group.tastingItems.isNotEmpty) {
      await _showEditorMessage(
        title: '无法确认无损耗',
        message: '已有损耗明细，请先清空并保存明细后再确认无损耗。',
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final updated =
          await widget.businessApi.updateTravelGroup(widget.group.id, {
        'lossStatus': 'NO_LOSS',
        'departureTime': normalizeTimeText(_departureTimeController.text),
        'remarks': _remarksController.text.trim(),
      });
      if (!mounted) {
        return;
      }
      _closeWithResult(updated);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _saving = false);
      await _showEditorMessage(
        title: '保存失败',
        message: _messageForSaveError(error),
      );
    }
  }

  Future<void> _showEditorMessage({
    required String title,
    required String message,
  }) {
    return showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('知道了'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _requestClose() async {
    if (_saving || _confirmingDiscard) {
      return;
    }
    if (!_dirty) {
      _closeWithResult();
      return;
    }

    _confirmingDiscard = true;
    final discard = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('放弃未保存修改？'),
          content: const Text('当前修改尚未保存，关闭后将无法恢复。'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('继续编辑'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('放弃修改'),
            ),
          ],
        );
      },
    );
    _confirmingDiscard = false;
    if (discard == true && mounted) {
      _closeWithResult();
    }
  }

  void _closeWithResult([TravelGroupRecord? result]) {
    if (_allowPop || !mounted) {
      return;
    }
    setState(() {
      _allowPop = true;
      _saving = false;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        Navigator.of(context).pop(result);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return PopScope<TravelGroupRecord>(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) {
          _requestClose();
        }
      },
      child: Material(
        key: const ValueKey('travel-group-notes-editor'),
        color: scheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 8, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '损耗与离店备注',
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                  ),
                  IconButton(
                    key: const ValueKey('travel-group-notes-editor-close'),
                    tooltip: '关闭',
                    onPressed: _saving ? null : _requestClose,
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: SingleChildScrollView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
                child: _NotesPanel(
                  businessApi: widget.businessApi,
                  group: widget.group,
                  tastingItemsKey: _tastingItemsKey,
                  initialTastingItems: _initialTastingItemDrafts,
                  departureTimeController: _departureTimeController,
                  remarksController: _remarksController,
                  saving: _saving,
                  onTastingItemsChanged: _handleTastingItemsChanged,
                  onSave: _saving ? null : _saveSupplement,
                  onConfirmNoLoss: _saving ? null : _confirmNoLoss,
                  onClear: _saving ? null : _clear,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotesPanel extends StatelessWidget {
  const _NotesPanel({
    required this.businessApi,
    required this.group,
    required this.tastingItemsKey,
    required this.initialTastingItems,
    required this.departureTimeController,
    required this.remarksController,
    required this.saving,
    required this.onTastingItemsChanged,
    required this.onSave,
    required this.onConfirmNoLoss,
    required this.onClear,
  });

  final BusinessApi businessApi;
  final TravelGroupRecord group;
  final GlobalKey<TastingItemsEditorState> tastingItemsKey;
  final List<TastingItemDraft> initialTastingItems;
  final TextEditingController departureTimeController;
  final TextEditingController remarksController;
  final bool saving;
  final ValueChanged<List<Map<String, dynamic>>> onTastingItemsChanged;
  final VoidCallback? onSave;
  final VoidCallback? onConfirmNoLoss;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SelectedGroupHeader(group: group),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            StatusTag(
              label: _lossStatusLabel(group.lossStatus),
              tone: _lossStatusTone(group.lossStatus),
            ),
            if (group.lossConfirmedByName != null)
              StatusTag(
                label: '确认人：${group.lossConfirmedByName}',
                tone: StatusTone.neutral,
              ),
            if (group.lossConfirmedAt != null)
              StatusTag(
                label: '确认时间：${group.lossConfirmedAt}',
                tone: StatusTone.neutral,
              ),
          ],
        ),
        const SizedBox(height: 12),
        _TastingItemsBox(
          businessApi: businessApi,
          tastingItemsKey: tastingItemsKey,
          initialItems: initialTastingItems,
          onChanged: onTastingItemsChanged,
        ),
        const SizedBox(height: 12),
        ResponsiveFormGrid(
          children: [
            AppTimePickerField(
              key: const ValueKey('departure-time-field'),
              controller: departureTimeController,
              label: '离店时间',
            ),
            TextField(
              controller: remarksController,
              maxLines: 2,
              decoration: const InputDecoration(labelText: '离店备注'),
            ),
          ],
        ),
        const SizedBox(height: 14),
        SectionActions(
          primaryLabel: saving ? '保存中...' : '保存损耗与备注',
          secondaryLabel: '清空明细',
          onPrimaryPressed: onSave,
          onSecondaryPressed: onClear,
        ),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerRight,
          child: OutlinedButton.icon(
            key: const ValueKey('confirm-no-loss'),
            onPressed: onConfirmNoLoss,
            icon: const Icon(Icons.check_circle_outline_rounded),
            label: const Text('确认无损耗'),
          ),
        ),
      ],
    );
  }
}

class _TastingItemsBox extends StatelessWidget {
  const _TastingItemsBox({
    required this.businessApi,
    required this.tastingItemsKey,
    required this.initialItems,
    required this.onChanged,
  });

  final BusinessApi businessApi;
  final GlobalKey<TastingItemsEditorState> tastingItemsKey;
  final List<TastingItemDraft> initialItems;
  final ValueChanged<List<Map<String, dynamic>>> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '损耗明细',
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            TastingItemsEditor(
              key: tastingItemsKey,
              businessApi: businessApi,
              initialItems: initialItems,
              onChanged: onChanged,
            ),
          ],
        ),
      ),
    );
  }
}

class _SelectedGroupHeader extends StatelessWidget {
  const _SelectedGroupHeader({required this.group});

  final TravelGroupRecord group;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        StatusTag(label: group.groupNo, tone: StatusTone.info),
        StatusTag(label: group.visitDate, tone: StatusTone.neutral),
        if (group.travelAgency != null)
          StatusTag(label: group.travelAgency!, tone: StatusTone.neutral),
        if (group.guideName != null)
          StatusTag(label: group.guideName!, tone: StatusTone.neutral),
        if (group.licensePlate != null)
          StatusTag(label: group.licensePlate!, tone: StatusTone.neutral),
      ],
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
        child: Center(
          child: Text(
            title,
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
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
    return Align(
      alignment: Alignment.centerLeft,
      child: StatusTag(label: message, tone: tone),
    );
  }
}

String _travelGroupScopeLabel(TravelGroupSearchScope scope) {
  switch (scope) {
    case TravelGroupSearchScope.taster:
      return '品鉴师';
    case TravelGroupSearchScope.tastingRoomNo:
      return '品鉴馆号';
  }
}

String _tasterOptionLabel(TasterOption taster) {
  final name = taster.name.trim();
  if (name.isNotEmpty) {
    return name;
  }
  final username = taster.username.trim();
  return username.isEmpty ? '未命名品鉴师' : username;
}

String? _trimmedOrNull(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? null : text;
}

String _displayValue(String? value, String fallback) {
  return _trimmedOrNull(value) ?? fallback;
}

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
}

String _messageForSaveError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '保存失败，请稍后重试';
}

String _groupStatusLabel(String status) {
  switch (status) {
    case 'ordered':
      return '已出单';
    case 'pending_summary':
      return '待总结';
    case 'unmarked':
    default:
      return '未标记';
  }
}

StatusTone _groupStatusTone(String status) {
  switch (status) {
    case 'ordered':
      return StatusTone.success;
    case 'pending_summary':
      return StatusTone.warning;
    case 'unmarked':
    default:
      return StatusTone.neutral;
  }
}

List<TastingItemDraft> _tastingDraftsFromGroup(TravelGroupRecord? group) {
  if (group == null) {
    return const <TastingItemDraft>[];
  }
  return [
    for (final item in _sortedTastingItems(group.tastingItems))
      TastingItemDraft(
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unit: item.unit,
        note: item.note,
      ),
  ];
}

List<Map<String, dynamic>> _tastingPayloadFromGroup(TravelGroupRecord? group) {
  if (group == null) {
    return const <Map<String, dynamic>>[];
  }
  final sortedItems = _sortedTastingItems(group.tastingItems);
  return [
    for (var index = 0; index < sortedItems.length; index += 1)
      {
        'productId': sortedItems[index].productId,
        'productName': sortedItems[index].productName,
        'quantity': sortedItems[index].quantity,
        'unit': sortedItems[index].unit,
        'note': sortedItems[index].note,
        'sortOrder': index + 1,
      },
  ];
}

String _lossStatusLabel(String status) {
  switch (status) {
    case 'RECORDED':
      return '已记录损耗';
    case 'NO_LOSS':
      return '已确认无损耗';
    case 'PENDING':
    default:
      return '损耗待确认';
  }
}

StatusTone _lossStatusTone(String status) {
  switch (status) {
    case 'RECORDED':
    case 'NO_LOSS':
      return StatusTone.success;
    case 'PENDING':
    default:
      return StatusTone.warning;
  }
}

List<TravelGroupTastingItemRecord> _sortedTastingItems(
  List<TravelGroupTastingItemRecord> items,
) {
  return [...items]
    ..sort((left, right) => left.sortOrder.compareTo(right.sortOrder));
}
