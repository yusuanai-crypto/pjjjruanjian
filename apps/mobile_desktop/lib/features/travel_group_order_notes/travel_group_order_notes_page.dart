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
  final _tastingItemsKey = GlobalKey<TastingItemsEditorState>();

  late BusinessApi _businessApi;
  late final TextEditingController _searchController;
  late final TextEditingController _departureTimeController;
  late final TextEditingController _remarksController;

  List<TastingItemDraft> _tastingItemDrafts = const <TastingItemDraft>[];
  List<Map<String, dynamic>> _tastingItems = const <Map<String, dynamic>>[];
  List<TravelGroupRecord> _groups = const <TravelGroupRecord>[];
  String _filter = '待销售';
  String _query = '';
  String? _selectedGroupId;
  bool _loading = true;
  bool _saving = false;
  String? _errorMessage;
  String? _successMessage;

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    _searchController = TextEditingController();
    _departureTimeController = TextEditingController();
    _remarksController = TextEditingController();
    _loadData();
  }

  @override
  void didUpdateWidget(covariant TravelGroupOrderNotesPage oldWidget) {
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
    _searchController.dispose();
    _departureTimeController.dispose();
    _remarksController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      final groups = await _businessApi.listTravelGroups(limit: 100);
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = groups;
        _loading = false;
        _selectedGroupId = _selectedGroupIdFor(groups);
        _syncSelectedGroupFields();
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

  TravelGroupRecord? get _selectedGroup {
    for (final group in _groups) {
      if (group.id == _selectedGroupId) {
        return group;
      }
    }
    return null;
  }

  List<TravelGroupRecord> get _visibleGroups {
    final query = _query.trim().toLowerCase();
    return _groups.where((group) {
      if (_filter == '今日' && group.visitDate != formatDate(DateTime.now())) {
        return false;
      }
      if (_filter == '待销售' && !_needsSupplement(group)) {
        return false;
      }
      if (_filter == '已出单' && group.status != 'ordered') {
        return false;
      }
      if (query.isEmpty) {
        return true;
      }
      return [
        group.groupNo,
        group.travelAgency ?? '',
        group.guideName ?? '',
        group.licensePlate ?? '',
        group.tasterName ?? '',
      ].any((value) => value.toLowerCase().contains(query));
    }).toList();
  }

  void _selectGroup(TravelGroupRecord group) {
    setState(() {
      _selectedGroupId = group.id;
      _syncSelectedGroupFields();
      _successMessage = null;
      _errorMessage = null;
    });
  }

  void _syncSelectedGroupFields() {
    final group = _selectedGroup;
    _departureTimeController.text = normalizeTimeText(group?.departureTime);
    _remarksController.text = group?.remarks ?? '';
    _tastingItemDrafts = _tastingDraftsFromGroup(group);
    _tastingItems = _tastingPayloadFromGroup(group);
  }

  Future<void> _saveSupplement() async {
    final group = _selectedGroup;
    if (group == null) {
      return;
    }
    final tastingValid = _tastingItemsKey.currentState?.validate() ?? true;
    if (!tastingValid) {
      setState(() {
        _errorMessage = '请先补全品酒明细。';
        _successMessage = null;
      });
      return;
    }

    setState(() {
      _saving = true;
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final body = <String, dynamic>{
        'departureTime': normalizeTimeText(_departureTimeController.text),
        'remarks': _remarksController.text.trim(),
      };
      if (_tastingItems.isNotEmpty || group.tastingItems.isNotEmpty) {
        body['tastingItems'] = _tastingItems;
      }
      final updated = await _businessApi.updateTravelGroup(group.id, body);
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = [
          for (final item in _groups) item.id == updated.id ? updated : item,
        ];
        _tastingItemDrafts = _tastingDraftsFromGroup(updated);
        _tastingItems = _tastingPayloadFromGroup(updated);
        _saving = false;
        _successMessage = _needsSupplement(updated)
            ? '已暂存，未完成项目继续保留为待销售。'
            : '离店时间与损耗确认均已完成。';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  bool _needsSupplement(TravelGroupRecord group) {
    return (group.departureTime ?? '').isEmpty ||
        group.lossStatus == 'PENDING';
  }

  Future<void> _confirmNoLoss() async {
    final group = _selectedGroup;
    if (group == null || _saving) {
      return;
    }
    if (_tastingItems.isNotEmpty || group.tastingItems.isNotEmpty) {
      setState(() {
        _errorMessage = '已有损耗明细，请先清空并保存明细后再确认无损耗。';
        _successMessage = null;
      });
      return;
    }
    setState(() {
      _saving = true;
      _errorMessage = null;
      _successMessage = null;
    });
    try {
      final updated = await _businessApi.updateTravelGroup(group.id, {
        'lossStatus': 'NO_LOSS',
        'departureTime': normalizeTimeText(_departureTimeController.text),
        'remarks': _remarksController.text.trim(),
      });
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = [
          for (final item in _groups) item.id == updated.id ? updated : item,
        ];
        _saving = false;
        _successMessage = _needsSupplement(updated)
            ? '已确认无损耗，离店时间仍待补录。'
            : '离店时间与无损耗确认均已完成。';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _errorMessage = _messageForError(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final selectedGroup = _selectedGroup;
    final visibleGroups = _visibleGroups;

    return ResponsivePage(
      maxWidth: 1440,
      children: [
        if (_errorMessage != null)
          _InlineNotice(message: _errorMessage!, tone: StatusTone.danger),
        if (_successMessage != null)
          _InlineNotice(message: _successMessage!, tone: StatusTone.success),
        _OrderNotesSummary(
          groupCount: _groups.length,
          pendingCount: _groups.where(_needsSupplement).length,
        ),
        ResponsiveTwoColumn(
          primaryFlex: 1,
          secondaryFlex: 2,
          primary: _GroupQueue(
            loading: _loading,
            searchController: _searchController,
            filter: _filter,
            groups: visibleGroups,
            selectedGroupId: _selectedGroupId,
            onQueryChanged: (value) => setState(() => _query = value),
            onFilterChanged: (value) => setState(() => _filter = value),
            onSelectGroup: _selectGroup,
          ),
          secondary: _NotesPanel(
            businessApi: _businessApi,
            group: selectedGroup,
            tastingItemsKey: _tastingItemsKey,
            initialTastingItems: _tastingItemDrafts,
            departureTimeController: _departureTimeController,
            remarksController: _remarksController,
            saving: _saving,
            onTastingItemsChanged: (items) => _tastingItems = items,
            onSave: _saving ? null : _saveSupplement,
            onConfirmNoLoss: _saving ? null : _confirmNoLoss,
            onClear: selectedGroup == null
                ? null
                : () {
                    _tastingItemsKey.currentState?.clear();
                    setState(() {
                      _departureTimeController.clear();
                      _remarksController.clear();
                      _tastingItems = const <Map<String, dynamic>>[];
                      _tastingItemDrafts = const <TastingItemDraft>[];
                      _successMessage = null;
                      _errorMessage = null;
                    });
                  },
          ),
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
    required this.searchController,
    required this.filter,
    required this.groups,
    required this.selectedGroupId,
    required this.onQueryChanged,
    required this.onFilterChanged,
    required this.onSelectGroup,
  });

  final bool loading;
  final TextEditingController searchController;
  final String filter;
  final List<TravelGroupRecord> groups;
  final String? selectedGroupId;
  final ValueChanged<String> onQueryChanged;
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
            AppSearchField(
              controller: searchController,
              hintText: '搜索团号、旅行社、导游、车牌',
              onChanged: onQueryChanged,
            ),
            const SizedBox(height: 12),
            AppFilterBar(
              filters: const ['待销售', '今日', '已出单', '全部'],
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
                    group.visitDate,
                    if (group.licensePlate != null) group.licensePlate!,
                    group.guestCount > 0 ? '${group.guestCount} 人' : '人数未填写',
                  ],
                  icon: selectedGroupId == group.id
                      ? Icons.radio_button_checked_rounded
                      : Icons.directions_bus_rounded,
                  trailing: StatusTag(
                    label: _groupStatusLabel(group.status),
                    tone: _groupStatusTone(group.status),
                  ),
                  onTap: () => onSelectGroup(group),
                ),
            ],
          ),
      ],
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
  final TravelGroupRecord? group;
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
    final selectedGroup = group;
    if (selectedGroup == null) {
      return const _EmptyCard(title: '请选择一个旅行团');
    }

    return FormSection(
      title: '损耗与离店备注',
      children: [
        _SelectedGroupHeader(group: selectedGroup),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            StatusTag(
              label: _lossStatusLabel(selectedGroup.lossStatus),
              tone: _lossStatusTone(selectedGroup.lossStatus),
            ),
            if (selectedGroup.lossConfirmedByName != null)
              StatusTag(
                label: '确认人：${selectedGroup.lossConfirmedByName}',
                tone: StatusTone.neutral,
              ),
            if (selectedGroup.lossConfirmedAt != null)
              StatusTag(
                label: '确认时间：${selectedGroup.lossConfirmedAt}',
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

String _messageForError(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '操作失败，请稍后重试。';
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
