import 'dart:async';

import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/status_tag.dart';
import 'guide_editor_dialog.dart';

const _guideStatusAll = 'all';
const _guideStatusActive = 'active';
const _guideStatusInactive = 'inactive';

class GuideManagementPage extends StatefulWidget {
  const GuideManagementPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;

  @override
  State<GuideManagementPage> createState() => _GuideManagementPageState();
}

class _GuideManagementPageState extends State<GuideManagementPage> {
  late BusinessApi _businessApi;
  final _searchController = TextEditingController();
  Timer? _searchDebounce;
  GuidePage? _result;
  String _status = _guideStatusAll;
  int _page = 1;
  int _pageSize = 20;
  bool _loading = true;
  String? _errorMessage;
  final Set<String> _busyGuideIds = {};

  bool get _canManage =>
      widget.role == UserRole.superAdmin ||
      widget.role == UserRole.admin ||
      widget.role == UserRole.frontDesk;

  bool? get _activeFilter {
    return switch (_status) {
      _guideStatusActive => true,
      _guideStatusInactive => false,
      _ => null,
    };
  }

  @override
  void initState() {
    super.initState();
    _businessApi =
        BusinessApi(apiClient: widget.apiClient, token: widget.token);
    if (_canManage) {
      _load();
    } else {
      _loading = false;
      _errorMessage = '当前账号没有导游管理权限。';
    }
  }

  @override
  void didUpdateWidget(covariant GuideManagementPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.role != widget.role) {
      _businessApi =
          BusinessApi(apiClient: widget.apiClient, token: widget.token);
      _page = 1;
      if (_canManage) {
        _load();
      } else {
        setState(() {
          _loading = false;
          _result = null;
          _errorMessage = '当前账号没有导游管理权限。';
        });
      }
    }
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _searchChanged(String _) {
    _page = 1;
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 350), _load);
  }

  Future<void> _load() async {
    if (!_canManage) {
      return;
    }
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      var result = await _businessApi.listGuidesPage(
        page: _page,
        pageSize: _pageSize,
        keyword: _searchController.text.trim(),
        isActive: _activeFilter,
      );
      if (result.guides.isEmpty && _page > 1 && result.totalPages < _page) {
        _page = result.totalPages < 1 ? 1 : result.totalPages;
        result = await _businessApi.listGuidesPage(
          page: _page,
          pageSize: _pageSize,
          keyword: _searchController.text.trim(),
          isActive: _activeFilter,
        );
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _result = result;
        _page = result.page;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _errorMessage = error.toString();
      });
    }
  }

  Future<void> _openEditor({GuideRecord? guide}) async {
    final saved = await showDialog<GuideRecord>(
      context: context,
      builder: (context) => GuideEditorDialog(
        businessApi: _businessApi,
        guide: guide,
      ),
    );
    if (saved == null || !mounted) {
      return;
    }
    await _load();
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(guide == null ? '导游已新增。' : '导游信息已更新。')),
    );
  }

  Future<void> _showDetail(GuideRecord row) async {
    if (_busyGuideIds.contains(row.id)) {
      return;
    }
    setState(() => _busyGuideIds.add(row.id));
    try {
      final guide = await _businessApi.getGuide(row.id);
      if (!mounted) {
        return;
      }
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('导游详情'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _DetailLine(label: '姓名', value: guide.name),
                _DetailLine(label: '手机号', value: guide.phone),
                _DetailLine(
                  label: '状态',
                  value: guide.isActive ? '启用' : '已停用',
                ),
                _DetailLine(label: '备注', value: _display(guide.remarks)),
                _DetailLine(
                  label: '创建时间',
                  value: _dateTimeText(guide.createdAt),
                ),
                _DetailLine(
                  label: '更新时间',
                  value: _dateTimeText(guide.updatedAt),
                ),
              ],
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
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busyGuideIds.remove(row.id));
      }
    }
  }

  Future<void> _disableGuide(GuideRecord guide) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('确认停用导游'),
        content: Text(
          '停用“${guide.name}”后，该导游将不再出现在旅行团的可选列表中。确定继续吗？',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            key: const ValueKey('guide-disable-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('确认停用'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _runStatusAction(
        guide,
        () => _businessApi.disableGuide(guide.id),
        '导游已停用。',
      );
    }
  }

  Future<void> _enableGuide(GuideRecord guide) async {
    await _runStatusAction(
      guide,
      () => _businessApi.enableGuide(guide.id),
      '导游已恢复。',
    );
  }

  Future<void> _runStatusAction(
    GuideRecord guide,
    Future<GuideRecord> Function() action,
    String successMessage,
  ) async {
    if (_busyGuideIds.contains(guide.id)) {
      return;
    }
    setState(() => _busyGuideIds.add(guide.id));
    try {
      await action();
      await _load();
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(successMessage)),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busyGuideIds.remove(guide.id));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    return ResponsivePage(
      maxWidth: 1480,
      children: [
        FormSection(
          title: '导游管理',
          trailing: Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              StatusTag(
                key: const ValueKey('guide-total'),
                label: '${result?.total ?? 0} 名导游',
                tone: StatusTone.info,
              ),
              IconButton(
                key: const ValueKey('guide-refresh'),
                tooltip: '刷新',
                onPressed: _loading || !_canManage ? null : _load,
                icon: const Icon(Icons.refresh_rounded),
              ),
              FilledButton.icon(
                key: const ValueKey('guide-add'),
                onPressed: _loading || !_canManage ? null : () => _openEditor(),
                icon: const Icon(Icons.add_rounded),
                label: const Text('新增导游'),
              ),
            ],
          ),
          children: [
            TextField(
              key: const ValueKey('guide-search'),
              controller: _searchController,
              enabled: _canManage,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: '搜索姓名、手机号或备注',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _searchController.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: '清空',
                        onPressed: () {
                          _searchController.clear();
                          _page = 1;
                          setState(() {});
                          _load();
                        },
                        icon: const Icon(Icons.close_rounded),
                      ),
              ),
              onChanged: (value) {
                setState(() {});
                _searchChanged(value);
              },
              onSubmitted: (_) {
                _page = 1;
                _load();
              },
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                SegmentedButton<String>(
                  key: const ValueKey('guide-status-filter'),
                  segments: const [
                    ButtonSegment(value: _guideStatusAll, label: Text('全部')),
                    ButtonSegment(
                      value: _guideStatusActive,
                      label: Text('启用'),
                    ),
                    ButtonSegment(
                      value: _guideStatusInactive,
                      label: Text('已停用'),
                    ),
                  ],
                  selected: {_status},
                  onSelectionChanged: !_canManage
                      ? null
                      : (selection) {
                          setState(() {
                            _status = selection.first;
                            _page = 1;
                          });
                          _load();
                        },
                ),
                SizedBox(
                  width: 150,
                  child: DropdownButtonFormField<int>(
                    key: const ValueKey('guide-page-size'),
                    initialValue: _pageSize,
                    decoration: const InputDecoration(labelText: '每页条数'),
                    items: const [
                      DropdownMenuItem(value: 20, child: Text('20 条')),
                      DropdownMenuItem(value: 50, child: Text('50 条')),
                      DropdownMenuItem(value: 100, child: Text('100 条')),
                    ],
                    onChanged: !_canManage
                        ? null
                        : (value) {
                            if (value == null || value == _pageSize) {
                              return;
                            }
                            setState(() {
                              _pageSize = value;
                              _page = 1;
                            });
                            _load();
                          },
                  ),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (_loading)
          const LoadingState(title: '正在加载导游...')
        else if (_errorMessage != null)
          ErrorState(
            key: const ValueKey('guide-error-state'),
            title: _errorMessage!,
            onRetry: _canManage ? _load : null,
          )
        else if (result == null || result.guides.isEmpty)
          EmptyState(
            key: const ValueKey('guide-empty-state'),
            title: '没有匹配的导游',
            action: OutlinedButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('刷新'),
            ),
          )
        else ...[
          LayoutBuilder(
            builder: (context, constraints) {
              return constraints.maxWidth >= 820
                  ? _buildTable(result.guides)
                  : _buildCards(result.guides);
            },
          ),
          const SizedBox(height: 12),
          _buildPagination(result),
        ],
      ],
    );
  }

  Widget _buildTable(List<GuideRecord> guides) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        key: const ValueKey('guide-data-table'),
        columns: const [
          DataColumn(label: Text('姓名')),
          DataColumn(label: Text('手机号')),
          DataColumn(label: Text('状态')),
          DataColumn(label: Text('备注')),
          DataColumn(label: Text('更新时间')),
          DataColumn(label: Text('操作')),
        ],
        rows: [
          for (final guide in guides)
            DataRow(
              cells: [
                DataCell(Text(guide.name)),
                DataCell(Text(guide.phone)),
                DataCell(_statusTag(guide)),
                DataCell(
                  SizedBox(
                    width: 260,
                    child: Text(
                      _display(guide.remarks),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
                DataCell(Text(_dateTimeText(guide.updatedAt))),
                DataCell(_actionButtons(guide)),
              ],
            ),
        ],
      ),
    );
  }

  Widget _buildCards(List<GuideRecord> guides) {
    return Column(
      key: const ValueKey('guide-card-list'),
      children: [
        for (final guide in guides)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          guide.name,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      _statusTag(guide),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text('手机号：${guide.phone}'),
                  Text('备注：${_display(guide.remarks)}'),
                  Text('更新时间：${_dateTimeText(guide.updatedAt)}'),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: _actionButtons(guide),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _statusTag(GuideRecord guide) {
    return StatusTag(
      label: guide.isActive ? '启用' : '已停用',
      tone: guide.isActive ? StatusTone.success : StatusTone.neutral,
    );
  }

  Widget _actionButtons(GuideRecord guide) {
    final busy = _busyGuideIds.contains(guide.id);
    return Wrap(
      spacing: 4,
      runSpacing: 4,
      children: [
        TextButton(
          key: ValueKey('guide-detail-${guide.id}'),
          onPressed: busy ? null : () => _showDetail(guide),
          child: const Text('查看'),
        ),
        TextButton(
          key: ValueKey('guide-edit-${guide.id}'),
          onPressed: busy ? null : () => _openEditor(guide: guide),
          child: const Text('编辑'),
        ),
        if (guide.isActive)
          TextButton(
            key: ValueKey('guide-disable-${guide.id}'),
            onPressed: busy ? null : () => _disableGuide(guide),
            child: const Text('停用'),
          )
        else
          TextButton(
            key: ValueKey('guide-enable-${guide.id}'),
            onPressed: busy ? null : () => _enableGuide(guide),
            child: const Text('恢复'),
          ),
      ],
    );
  }

  Widget _buildPagination(GuidePage result) {
    final totalPages = result.totalPages;
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        IconButton(
          key: const ValueKey('guide-previous-page'),
          tooltip: '上一页',
          onPressed: _loading || result.page <= 1
              ? null
              : () {
                  setState(() => _page -= 1);
                  _load();
                },
          icon: const Icon(Icons.chevron_left_rounded),
        ),
        Text(
          totalPages == 0 ? '第 0 / 0 页' : '第 ${result.page} / $totalPages 页',
          key: const ValueKey('guide-page-info'),
        ),
        IconButton(
          key: const ValueKey('guide-next-page'),
          tooltip: '下一页',
          onPressed: _loading || result.page >= totalPages
              ? null
              : () {
                  setState(() => _page += 1);
                  _load();
                },
          icon: const Icon(Icons.chevron_right_rounded),
        ),
      ],
    );
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 88,
            child: Text(
              label,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}

String _display(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? '-' : text;
}

String _dateTimeText(String? value) {
  final parsed = DateTime.tryParse(value ?? '');
  if (parsed == null) {
    return _display(value);
  }
  final local = parsed.toLocal();
  String two(int number) => number.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)} '
      '${two(local.hour)}:${two(local.minute)}';
}
