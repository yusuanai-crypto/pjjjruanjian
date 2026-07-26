import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

import '../../app/destinations.dart';
import '../../core/api/api_client.dart';
import '../../core/business/business_api.dart';
import '../todo_reminders/todo_reminder_controller.dart';
import '../todo_reminders/todo_reminder_models.dart';
import '../../shared/widgets/app_record_list.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/responsive.dart';
import '../../shared/widgets/status_tag.dart';

class DashboardPage extends StatefulWidget {
  const DashboardPage({
    super.key,
    required this.apiClient,
    required this.token,
    required this.role,
    required this.allowedDestinations,
    required this.onOpenDestination,
    this.todoReminderController,
  });

  final ApiClient apiClient;
  final String token;
  final UserRole role;
  final List<AppDestination> allowedDestinations;
  final ValueChanged<String> onOpenDestination;
  final TodoReminderController? todoReminderController;

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  AnalyticsOverview? _overview;
  bool _loadingOverview = false;
  String? _overviewError;
  int _overviewRequestId = 0;

  bool get _canViewAnalytics {
    return widget.role == UserRole.superAdmin ||
        widget.role == UserRole.admin ||
        widget.role == UserRole.boss ||
        widget.role == UserRole.finance;
  }

  bool get _canOpenAnalytics {
    return _canViewAnalytics &&
        widget.allowedDestinations.any((item) => item.id == 'analytics');
  }

  @override
  void initState() {
    super.initState();
    if (_canViewAnalytics) {
      _loadingOverview = true;
      _loadOverview(setLoading: false);
    }
  }

  @override
  void didUpdateWidget(covariant DashboardPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    final analyticsContextChanged = oldWidget.apiClient != widget.apiClient ||
        oldWidget.token != widget.token ||
        oldWidget.role != widget.role;
    if (!analyticsContextChanged) {
      return;
    }

    if (!_canViewAnalytics) {
      _overviewRequestId++;
      setState(() {
        _overview = null;
        _overviewError = null;
        _loadingOverview = false;
      });
      return;
    }

    _loadOverview();
  }

  Future<void> _loadOverview({bool setLoading = true}) async {
    final requestId = ++_overviewRequestId;
    if (setLoading) {
      setState(() {
        _loadingOverview = true;
        _overviewError = null;
      });
    }

    try {
      final overview = await BusinessApi(
        apiClient: widget.apiClient,
        token: widget.token,
      ).getAnalyticsOverview(preset: 'today');
      if (!mounted || requestId != _overviewRequestId) {
        return;
      }
      setState(() {
        _overview = overview;
        _overviewError = null;
        _loadingOverview = false;
      });
    } catch (error) {
      if (!mounted || requestId != _overviewRequestId) {
        return;
      }
      setState(() {
        _overviewError = _overviewErrorMessage(error);
        _loadingOverview = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final destinations = widget.allowedDestinations
        .where((item) => item.id != 'dashboard')
        .toList();
    return ResponsivePage(
      children: [
        if (_canViewAnalytics)
          _DashboardAnalyticsSummary(
            overview: _overview,
            loading: _loadingOverview,
            errorMessage: _overviewError,
            onRetry: _loadOverview,
            onOpenAnalytics: _canOpenAnalytics
                ? () => widget.onOpenDestination('analytics')
                : null,
          ),
        ResponsiveTwoColumn(
          primary: Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '${widget.role.label}工作入口',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 12),
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final columns = constraints.maxWidth >= 680 ? 3 : 1;
                      const spacing = 12.0;
                      final width =
                          (constraints.maxWidth - spacing * (columns - 1)) /
                              columns;
                      return Wrap(
                        spacing: spacing,
                        runSpacing: spacing,
                        children: [
                          for (final destination in destinations)
                            SizedBox(
                              width: width,
                              child: _ActionTile(
                                destination: destination,
                                onTap: () =>
                                    widget.onOpenDestination(destination.id),
                              ),
                            ),
                        ],
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
          secondary: _DashboardTodoList(
            controller: widget.todoReminderController,
            onOpen: () => widget.onOpenDestination('todo_reminders'),
          ),
        ),
      ],
    );
  }
}

class _DashboardTodoList extends StatelessWidget {
  const _DashboardTodoList({
    required this.controller,
    required this.onOpen,
  });

  final TodoReminderController? controller;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final value = controller;
    if (value == null) {
      return const AppRecordList(
        compact: true,
        items: [
          AppRecordItem(
            title: '待办提醒',
            subtitle: '正在初始化',
            icon: Icons.notifications_none_rounded,
          ),
        ],
      );
    }
    return AnimatedBuilder(
      animation: value,
      builder: (context, _) {
        final reminders = value.activeReminders.take(5).toList();
        if (reminders.isEmpty) {
          return AppRecordList(
            compact: true,
            items: [
              AppRecordItem(
                title: value.error == null ? '暂无待办' : '待办加载失败',
                subtitle: value.error ?? '当前没有需要处理的业务事项',
                icon: value.error == null
                    ? Icons.task_alt_rounded
                    : Icons.sync_problem_rounded,
                onTap: onOpen,
              ),
            ],
          );
        }
        return AppRecordList(
          compact: true,
          items: reminders
              .map(
                (item) => AppRecordItem(
                  title: item.sourceNumber,
                  subtitle: item.title,
                  icon: _todoIcon(item),
                  trailing: StatusTag(
                    label: item.isOverdue ? '逾期' : _todoPriority(item),
                    tone: item.priority == 'URGENT'
                        ? StatusTone.danger
                        : item.priority == 'IMPORTANT'
                            ? StatusTone.warning
                            : StatusTone.info,
                  ),
                  onTap: onOpen,
                ),
              )
              .toList(),
        );
      },
    );
  }
}

IconData _todoIcon(TodoReminder reminder) {
  switch (reminder.sourceType) {
    case 'TRAVEL_GROUP':
      return Icons.directions_bus_rounded;
    case 'AFTER_SALES_ORDER':
      return Icons.support_agent_rounded;
    default:
      return Icons.receipt_long_rounded;
  }
}

String _todoPriority(TodoReminder reminder) {
  switch (reminder.priority) {
    case 'URGENT':
      return '紧急';
    case 'IMPORTANT':
      return '重要';
    default:
      return '待处理';
  }
}

class _DashboardAnalyticsSummary extends StatelessWidget {
  const _DashboardAnalyticsSummary({
    required this.overview,
    required this.loading,
    required this.errorMessage,
    required this.onRetry,
    required this.onOpenAnalytics,
  });

  final AnalyticsOverview? overview;
  final bool loading;
  final String? errorMessage;
  final VoidCallback onRetry;
  final VoidCallback? onOpenAnalytics;

  @override
  Widget build(BuildContext context) {
    final notice = _noticeText();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '今日经营摘要',
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
            IconButton(
              tooltip: '刷新',
              onPressed: loading ? null : onRetry,
              icon: const Icon(Icons.refresh_rounded),
            ),
            if (onOpenAnalytics != null) ...[
              const SizedBox(width: 4),
              TextButton.icon(
                onPressed: onOpenAnalytics,
                icon: const Icon(Icons.bar_chart_rounded),
                label: const Text('数据分析'),
              ),
            ],
          ],
        ),
        const SizedBox(height: 8),
        if (loading) ...[
          const LinearProgressIndicator(),
          const SizedBox(height: 10),
        ],
        if (notice != null) ...[
          _DashboardNotice(
            message: notice,
            tone: errorMessage == null ? StatusTone.warning : StatusTone.danger,
          ),
          const SizedBox(height: 10),
        ],
        MetricGrid(metrics: _metrics(context)),
      ],
    );
  }

  List<MetricData> _metrics(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final analytics = overview;
    return [
      MetricData(
        label: '今日接待团数',
        value:
            analytics == null ? '-' : _formatCount(analytics.totalGroupCount),
        icon: Icons.directions_bus_rounded,
        accent: const Color(0xFF7D5A2E),
      ),
      MetricData(
        label: '今日销售额',
        value: analytics == null
            ? '-'
            : formatMoneyCents(analytics.netSalesAmountCents),
        icon: Icons.payments_rounded,
        accent: const Color(0xFF226D68),
      ),
      MetricData(
        label: '今日打蛋率',
        value: analytics == null ? '-' : _formatPercent(analytics.noOrderRate),
        icon: Icons.pie_chart_rounded,
        accent: const Color(0xFF6C4F8F),
      ),
      MetricData(
        label: _riskLabel(analytics),
        value: _riskValue(analytics),
        icon: Icons.warning_amber_rounded,
        accent: _riskCount(analytics) > 0 ? scheme.error : scheme.tertiary,
      ),
    ];
  }

  String? _noticeText() {
    final error = errorMessage;
    if (error != null) {
      return '统计摘要加载失败：$error';
    }

    final analytics = overview;
    if (analytics == null) {
      return null;
    }
    if (analytics.pendingRefundAmountCents > 0) {
      return '存在待确认退款 ${formatMoneyCents(analytics.pendingRefundAmountCents)}';
    }
    final riskCount = _riskCount(analytics);
    if (riskCount > 0) {
      return '统计风险 $riskCount 项';
    }
    return null;
  }
}

class _DashboardNotice extends StatelessWidget {
  const _DashboardNotice({
    required this.message,
    required this.tone,
  });

  final String message;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = tone == StatusTone.danger ? scheme.error : scheme.tertiary;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Icon(
              tone == StatusTone.danger
                  ? Icons.error_outline_rounded
                  : Icons.warning_amber_rounded,
              color: color,
              size: 20,
            ),
            const SizedBox(width: 8),
            Expanded(child: Text(message)),
          ],
        ),
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.destination,
    required this.onTap,
  });

  final AppDestination destination;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: InkWell(
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: scheme.primary.withValues(alpha: 0.1),
                  borderRadius: const BorderRadius.all(Radius.circular(8)),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Icon(destination.icon, color: scheme.primary),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      destination.label,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    Text(
                      '第 ${destination.phase} 阶段',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded),
            ],
          ),
        ),
      ),
    );
  }
}

String _overviewErrorMessage(Object error) {
  if (error is ApiException) {
    return error.message;
  }
  return '请稍后重试';
}

String _riskLabel(AnalyticsOverview? overview) {
  if (overview != null && overview.pendingRefundAmountCents > 0) {
    return '待确认退款';
  }
  return '统计风险';
}

String _riskValue(AnalyticsOverview? overview) {
  if (overview == null) {
    return '-';
  }
  if (overview.pendingRefundAmountCents > 0) {
    return formatMoneyCents(overview.pendingRefundAmountCents);
  }
  return '${_riskCount(overview)} 项';
}

int _riskCount(AnalyticsOverview? overview) {
  if (overview == null) {
    return 0;
  }
  final hasPendingWarning = overview.warnings.any(
    (warning) =>
        warning.code == 'pending_refund' ||
        warning.code == 'pending_refund_amount',
  );
  return overview.warnings.length +
      (overview.pendingRefundAmountCents > 0 && !hasPendingWarning ? 1 : 0);
}

String _formatPercent(double value) {
  return '${(value * 100).toStringAsFixed(1)}%';
}

String _formatCount(int value) {
  final sign = value < 0 ? '-' : '';
  final digits = value.abs().toString();
  final buffer = StringBuffer();
  for (var index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 == 0) {
      buffer.write(',');
    }
    buffer.write(digits[index]);
  }
  return '$sign$buffer';
}
