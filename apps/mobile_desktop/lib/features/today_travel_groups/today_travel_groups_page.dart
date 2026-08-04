import 'dart:async';

import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../../shared/widgets/form_section.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/state_views.dart';

class TodayTravelGroupsPage extends StatefulWidget {
  const TodayTravelGroupsPage({
    super.key,
    required this.apiClient,
    required this.token,
    this.refreshInterval = const Duration(seconds: 30),
  });

  final ApiClient apiClient;
  final String token;
  final Duration refreshInterval;

  @override
  State<TodayTravelGroupsPage> createState() =>
      _TodayTravelGroupsPageState();
}

class _TodayTravelGroupsPageState extends State<TodayTravelGroupsPage>
    with WidgetsBindingObserver {
  late BusinessApi _businessApi;
  Timer? _refreshTimer;
  List<TodayTravelGroupRecord> _groups = const [];
  bool _loading = true;
  bool _refreshing = false;
  bool _hasSuccessfulLoad = false;
  bool _requestInFlight = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _businessApi = BusinessApi(
      apiClient: widget.apiClient,
      token: widget.token,
    );
    _restartRefreshTimer();
    unawaited(_refresh());
  }

  @override
  void didUpdateWidget(covariant TodayTravelGroupsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token) {
      _businessApi = BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      );
      unawaited(_refresh());
    }
    if (oldWidget.refreshInterval != widget.refreshInterval) {
      _restartRefreshTimer();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) {
      unawaited(_refresh());
    }
  }

  void _restartRefreshTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(widget.refreshInterval, (_) {
      unawaited(_refresh());
    });
  }

  Future<void> _refresh() async {
    if (_requestInFlight) {
      return;
    }
    _requestInFlight = true;
    if (mounted) {
      setState(() {
        if (_hasSuccessfulLoad) {
          _refreshing = true;
        } else {
          _loading = true;
        }
        _errorMessage = null;
      });
    }

    try {
      final groups = await _businessApi.listTodayTravelGroups();
      if (!mounted) {
        return;
      }
      setState(() {
        _groups = groups;
        _loading = false;
        _refreshing = false;
        _hasSuccessfulLoad = true;
        _errorMessage = null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _refreshing = false;
        _errorMessage = _messageForError(error);
      });
    } finally {
      _requestInFlight = false;
    }
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ResponsivePage(
      children: [
        FormSection(
          title: '今日旅行团',
          trailing: _buildStatus(),
          children: _buildContent(),
        ),
      ],
    );
  }

  Widget _buildStatus() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_refreshing) ...[
          const SizedBox.square(
            key: ValueKey('today-travel-groups-refreshing'),
            dimension: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 8),
        ],
        Text(_hasSuccessfulLoad ? '${_groups.length} 个团' : '每 30 秒刷新'),
      ],
    );
  }

  List<Widget> _buildContent() {
    if (_loading && !_hasSuccessfulLoad) {
      return const [
        LoadingState(title: '正在加载今日旅行团'),
      ];
    }
    if (_errorMessage != null && !_hasSuccessfulLoad) {
      return [
        ErrorState(
          title: _errorMessage!,
          onRetry: () => unawaited(_refresh()),
        ),
      ];
    }

    return [
      if (_errorMessage != null) ...[
        _RefreshErrorBanner(
          message: _errorMessage!,
          onRetry: () => unawaited(_refresh()),
        ),
        const SizedBox(height: 12),
      ],
      if (_groups.isEmpty)
        const EmptyState(title: '暂无今日旅行团')
      else
        _TodayTravelGroupsTable(groups: _groups),
    ];
  }
}

class _TodayTravelGroupsTable extends StatelessWidget {
  const _TodayTravelGroupsTable({required this.groups});

  final List<TodayTravelGroupRecord> groups;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        key: const ValueKey('today-travel-groups-table'),
        columns: const [
          DataColumn(label: Text('车牌号')),
          DataColumn(label: Text('接待品鉴师')),
          DataColumn(label: Text('品鉴馆号')),
          DataColumn(label: Text('香烟费用')),
        ],
        rows: [
          for (final group in groups)
            DataRow(
              cells: [
                DataCell(Text(_displayValue(group.licensePlate))),
                DataCell(Text(_displayValue(group.tasterName))),
                DataCell(Text(_displayValue(group.tastingRoomNo))),
                DataCell(
                  Text(
                    group.cigaretteFeeCents == null
                        ? '—'
                        : formatMoneyCents(group.cigaretteFeeCents!),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _RefreshErrorBanner extends StatelessWidget {
  const _RefreshErrorBanner({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.errorContainer,
      child: ListTile(
        leading: const Icon(Icons.error_outline_rounded),
        title: Text(message),
        trailing: OutlinedButton.icon(
          onPressed: onRetry,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('重新加载'),
        ),
      ),
    );
  }
}

String _displayValue(String? value) {
  final text = value?.trim() ?? '';
  return text.isEmpty ? '—' : text;
}

String _messageForError(Object error) {
  if (error is ApiException) {
    if (error.statusCode == 403) {
      return '当前账号没有访问今日旅行团的权限。';
    }
    if (error.message.trim().isNotEmpty) {
      return '今日旅行团加载失败：${error.message.trim()}';
    }
  }
  return '今日旅行团加载失败，请稍后重试。';
}
