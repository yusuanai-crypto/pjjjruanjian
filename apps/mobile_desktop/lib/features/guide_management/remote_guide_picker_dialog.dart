import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/business/business_api.dart';
import 'guide_editor_dialog.dart';

class GuidePickerResult {
  const GuidePickerResult(this.guide);

  final GuideRecord? guide;
}

class RemoteGuidePickerDialog extends StatefulWidget {
  const RemoteGuidePickerDialog({
    super.key,
    required this.businessApi,
    this.title = '选择导游',
    this.initialGuide,
    this.allowClear = false,
    this.allowCreate = false,
  });

  final BusinessApi businessApi;
  final String title;
  final GuideRecord? initialGuide;
  final bool allowClear;
  final bool allowCreate;

  @override
  State<RemoteGuidePickerDialog> createState() =>
      _RemoteGuidePickerDialogState();
}

class _RemoteGuidePickerDialogState extends State<RemoteGuidePickerDialog> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  List<GuideRecord> _guides = const [];
  int _page = 1;
  int _totalPages = 0;
  bool _loading = true;
  bool _loadingMore = false;
  String? _errorMessage;

  bool get _canLoadMore => !_loadingMore && _page < _totalPages;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      _load(reset: true);
    });
  }

  Future<void> _load({required bool reset}) async {
    if (reset) {
      setState(() {
        _loading = true;
        _errorMessage = null;
      });
    } else {
      if (!_canLoadMore) {
        return;
      }
      setState(() {
        _loadingMore = true;
        _errorMessage = null;
      });
    }
    final requestedPage = reset ? 1 : _page + 1;
    try {
      final result = await widget.businessApi.listGuidesPage(
        page: requestedPage,
        pageSize: 20,
        keyword: _searchController.text.trim(),
        isActive: true,
      );
      if (!mounted) {
        return;
      }
      final merged =
          reset ? result.guides : _mergeGuides(_guides, result.guides);
      setState(() {
        _guides = merged;
        _page = result.page;
        _totalPages = result.totalPages;
        _loading = false;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _loadingMore = false;
        _errorMessage = error.toString();
      });
    }
  }

  Future<void> _createGuide() async {
    final guide = await showDialog<GuideRecord>(
      context: context,
      builder: (context) => GuideEditorDialog(
        businessApi: widget.businessApi,
      ),
    );
    if (guide != null && mounted) {
      Navigator.of(context).pop(GuidePickerResult(guide));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 560,
        height: 520,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              key: const ValueKey('remote-guide-search'),
              controller: _searchController,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                labelText: '搜索导游',
                hintText: '输入姓名、手机号或备注',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _searchController.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: '清空',
                        onPressed: () {
                          _searchController.clear();
                          _load(reset: true);
                        },
                        icon: const Icon(Icons.close_rounded),
                      ),
              ),
              onChanged: (value) {
                setState(() {});
                _onSearchChanged(value);
              },
              onSubmitted: (_) => _load(reset: true),
            ),
            const SizedBox(height: 12),
            Expanded(child: _buildResults()),
          ],
        ),
      ),
      actions: [
        if (widget.allowClear)
          TextButton(
            key: const ValueKey('remote-guide-clear'),
            onPressed: () =>
                Navigator.of(context).pop(const GuidePickerResult(null)),
            child: const Text('全部 / 清除选择'),
          ),
        if (widget.allowCreate)
          OutlinedButton.icon(
            key: const ValueKey('remote-guide-create'),
            onPressed: _createGuide,
            icon: const Icon(Icons.add_rounded),
            label: const Text('新增导游'),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
      ],
    );
  }

  Widget _buildResults() {
    if (_loading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 12),
            Text('正在加载导游...'),
          ],
        ),
      );
    }
    if (_errorMessage != null && _guides.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _errorMessage!,
              key: const ValueKey('remote-guide-error'),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => _load(reset: true),
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('重试'),
            ),
          ],
        ),
      );
    }
    if (_guides.isEmpty) {
      return const Center(
        child: Text(
          '没有匹配的启用导游。',
          key: ValueKey('remote-guide-empty'),
        ),
      );
    }
    return ListView(
      children: [
        for (final guide in _guides)
          ListTile(
            key: ValueKey('remote-guide-${guide.id}'),
            selected: guide.id == widget.initialGuide?.id,
            title: Text(guide.name),
            subtitle: Text('${guide.name} · ${guide.phone}'),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => Navigator.of(context).pop(GuidePickerResult(guide)),
          ),
        if (_errorMessage != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              _errorMessage!,
              textAlign: TextAlign.center,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        if (_page < _totalPages)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: OutlinedButton.icon(
              key: const ValueKey('remote-guide-load-more'),
              onPressed: _loadingMore ? null : () => _load(reset: false),
              icon: _loadingMore
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.expand_more_rounded),
              label: const Text('加载更多'),
            ),
          ),
      ],
    );
  }
}

List<GuideRecord> _mergeGuides(
  List<GuideRecord> existing,
  List<GuideRecord> incoming,
) {
  final byId = <String, GuideRecord>{
    for (final guide in existing) guide.id: guide,
    for (final guide in incoming) guide.id: guide,
  };
  return byId.values.toList();
}
