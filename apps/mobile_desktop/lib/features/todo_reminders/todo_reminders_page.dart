import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../shared/widgets/responsive.dart';
import 'todo_reminder_controller.dart';
import 'todo_reminder_models.dart';

class TodoRemindersPage extends StatefulWidget {
  const TodoRemindersPage({
    super.key,
    required this.controller,
    required this.onOpenDestination,
  });

  final TodoReminderController controller;
  final ValueChanged<String> onOpenDestination;

  @override
  State<TodoRemindersPage> createState() => _TodoRemindersPageState();
}

class _TodoRemindersPageState extends State<TodoRemindersPage> {
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => widget.controller.sync(silent: true),
    );
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.controller,
      builder: (context, _) {
        final controller = widget.controller;
        return ResponsivePage(
          children: [
            _SummaryGrid(summary: controller.summary),
            _CategoryBar(
              selected: controller.category,
              onSelected: controller.setCategory,
              loading: controller.loading,
            ),
            _Filters(
              searchController: _searchController,
              priority: controller.priority,
              sourceType: controller.sourceType,
              loading: controller.loading,
              onApply: (priority, sourceType) => controller.setFilters(
                priorityValue: priority,
                sourceTypeValue: sourceType,
                keywordValue: _searchController.text,
              ),
              onRefresh: controller.sync,
            ),
            if (controller.loading) const LinearProgressIndicator(),
            if (controller.error != null)
              _ErrorCard(
                message: controller.error!,
                onRetry: controller.sync,
              )
            else if (!controller.loading && controller.reminders.isEmpty)
              const _EmptyCard()
            else
              for (final reminder in controller.reminders)
                _ReminderCard(
                  reminder: reminder,
                  onTap: () => _showDetails(reminder),
                ),
          ],
        );
      },
    );
  }

  Future<void> _showDetails(TodoReminder original) async {
    var reminder = original;
    try {
      reminder = await widget.controller.markRead(original);
    } catch (error) {
      if (mounted) _showError(error);
    }
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(reminder.title),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                _DetailLine(label: '来源编号', value: reminder.sourceNumber),
                _DetailLine(
                  label: '来源类型',
                  value: _sourceLabel(reminder.sourceType),
                ),
                _DetailLine(
                  label: '优先级',
                  value: _priorityLabel(reminder.priority),
                ),
                _DetailLine(
                  label: '截止时间',
                  value: _formatDateTime(reminder.dueAt),
                ),
                _DetailLine(label: '说明', value: reminder.content),
                _DetailLine(
                  label: '个人备注',
                  value: reminder.personalNote ?? '无',
                ),
                if (reminder.personalRemindAt != null)
                  _DetailLine(
                    label: '个人提醒',
                    value: _formatDateTime(reminder.personalRemindAt!),
                  ),
                if (reminder.recipientReason == 'ESCALATION')
                  const _DetailLine(label: '提醒来源', value: '管理升级提醒'),
              ],
            ),
          ),
        ),
        actions: [
          TextButton.icon(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              widget.onOpenDestination(_destinationFor(reminder.sourceType));
            },
            icon: const Icon(Icons.open_in_new_rounded),
            label: const Text('打开业务页面'),
          ),
          TextButton(
            onPressed: () async {
              Navigator.of(dialogContext).pop();
              await _editPreferences(reminder);
            },
            child: const Text('备注/提醒时间'),
          ),
          if (reminder.isActive)
            TextButton(
              onPressed: () async {
                Navigator.of(dialogContext).pop();
                await _snooze(reminder);
              },
              child: const Text('稍后提醒'),
            ),
          if (reminder.isActive)
            FilledButton(
              onPressed: () async {
                Navigator.of(dialogContext).pop();
                await _verify(reminder);
              },
              child: const Text('检查是否完成'),
            )
          else
            FilledButton(
              onPressed: () async {
                Navigator.of(dialogContext).pop();
                await _archive(reminder);
              },
              child: const Text('归档'),
            ),
        ],
      ),
    );
  }

  Future<void> _editPreferences(TodoReminder reminder) async {
    final noteController =
        TextEditingController(text: reminder.personalNote ?? '');
    var remindAt = reminder.personalRemindAt;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('个人备注与提醒时间'),
          content: SizedBox(
            width: 480,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: noteController,
                  maxLines: 4,
                  maxLength: 2000,
                  decoration: const InputDecoration(
                    labelText: '个人备注',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('个人提醒时间'),
                  subtitle: Text(
                    remindAt == null ? '跟随业务截止时间' : _formatDateTime(remindAt!),
                  ),
                  trailing: Wrap(
                    children: [
                      if (remindAt != null)
                        IconButton(
                          tooltip: '清除',
                          onPressed: () =>
                              setDialogState(() => remindAt = null),
                          icon: const Icon(Icons.clear_rounded),
                        ),
                      IconButton(
                        tooltip: '选择时间',
                        onPressed: () async {
                          final selected = await _pickFutureDateTime(
                            context,
                            remindAt ??
                                DateTime.now().add(const Duration(hours: 1)),
                          );
                          if (selected != null) {
                            setDialogState(() => remindAt = selected);
                          }
                        },
                        icon: const Icon(Icons.schedule_rounded),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('保存'),
            ),
          ],
        ),
      ),
    );
    if (accepted == true) {
      try {
        await widget.controller.updatePreferences(
          reminder,
          personalNote: noteController.text.trim(),
          personalRemindAt: remindAt,
        );
      } catch (error) {
        if (mounted) _showError(error);
      }
    }
    noteController.dispose();
  }

  Future<void> _snooze(TodoReminder reminder) async {
    final duration = await showModalBottomSheet<Duration>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(title: Text('稍后提醒')),
            ListTile(
              title: const Text('30 分钟后'),
              onTap: () =>
                  Navigator.of(context).pop(const Duration(minutes: 30)),
            ),
            ListTile(
              title: const Text('2 小时后'),
              onTap: () => Navigator.of(context).pop(const Duration(hours: 2)),
            ),
            ListTile(
              title: const Text('明天此时'),
              onTap: () => Navigator.of(context).pop(const Duration(days: 1)),
            ),
          ],
        ),
      ),
    );
    if (duration == null) return;
    try {
      await widget.controller.snooze(reminder, DateTime.now().add(duration));
    } catch (error) {
      if (mounted) _showError(error);
    }
  }

  Future<void> _verify(TodoReminder reminder) async {
    try {
      await widget.controller.verifyCompletion(reminder);
      if (mounted) _showMessage('业务条件已解决，待办已关闭。');
    } catch (error) {
      if (mounted) _showError(error);
    }
  }

  Future<void> _archive(TodoReminder reminder) async {
    try {
      await widget.controller.archive(reminder);
      if (mounted) _showMessage('待办已归档。');
    } catch (error) {
      if (mounted) _showError(error);
    }
  }

  void _showError(Object error) {
    final message =
        error is ApiException && error.code == 'TODO_SOURCE_STILL_ACTIVE'
            ? '源业务条件仍未解决，不能标记完成。'
            : error is ApiException
                ? error.message
                : '操作失败，请稍后重试。';
    _showMessage(message);
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }
}

class _SummaryGrid extends StatelessWidget {
  const _SummaryGrid({required this.summary});

  final TodoReminderSummary summary;

  @override
  Widget build(BuildContext context) {
    final values = [
      ('未完成', summary.unfinished, Icons.pending_actions_rounded),
      ('今日到期', summary.todayDue, Icons.today_rounded),
      ('已逾期', summary.overdue, Icons.warning_amber_rounded),
      ('紧急', summary.urgent, Icons.priority_high_rounded),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth >= 760
            ? (constraints.maxWidth - 36) / 4
            : (constraints.maxWidth - 12) / 2;
        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            for (final value in values)
              SizedBox(
                width: width,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Icon(value.$3),
                        const SizedBox(width: 10),
                        Expanded(child: Text(value.$1)),
                        Text(
                          '${value.$2}',
                          style: Theme.of(context)
                              .textTheme
                              .headlineSmall
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _CategoryBar extends StatelessWidget {
  const _CategoryBar({
    required this.selected,
    required this.onSelected,
    required this.loading,
  });

  final String selected;
  final ValueChanged<String> onSelected;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    const values = {
      'active': '待处理',
      'today': '今日',
      'overdue': '逾期',
      'resolved': '已解决',
    };
    return Wrap(
      spacing: 8,
      children: [
        for (final entry in values.entries)
          ChoiceChip(
            label: Text(entry.value),
            selected: selected == entry.key,
            onSelected: loading ? null : (_) => onSelected(entry.key),
          ),
      ],
    );
  }
}

class _Filters extends StatelessWidget {
  const _Filters({
    required this.searchController,
    required this.priority,
    required this.sourceType,
    required this.loading,
    required this.onApply,
    required this.onRefresh,
  });

  final TextEditingController searchController;
  final String? priority;
  final String? sourceType;
  final bool loading;
  final void Function(String?, String?) onApply;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    String? nextPriority = priority;
    String? nextSource = sourceType;
    return StatefulBuilder(
      builder: (context, setState) => Wrap(
        spacing: 10,
        runSpacing: 10,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SizedBox(
            width: 260,
            child: TextField(
              controller: searchController,
              onSubmitted: (_) => onApply(nextPriority, nextSource),
              decoration: const InputDecoration(
                labelText: '搜索标题或来源编号',
                prefixIcon: Icon(Icons.search_rounded),
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ),
          DropdownButton<String?>(
            value: nextPriority,
            hint: const Text('全部优先级'),
            items: const [
              DropdownMenuItem(value: null, child: Text('全部优先级')),
              DropdownMenuItem(value: 'NORMAL', child: Text('普通')),
              DropdownMenuItem(value: 'IMPORTANT', child: Text('重要')),
              DropdownMenuItem(value: 'URGENT', child: Text('紧急')),
            ],
            onChanged: loading
                ? null
                : (value) => setState(() => nextPriority = value),
          ),
          DropdownButton<String?>(
            value: nextSource,
            hint: const Text('全部来源'),
            items: const [
              DropdownMenuItem(value: null, child: Text('全部来源')),
              DropdownMenuItem(value: 'TRAVEL_GROUP', child: Text('旅行团')),
              DropdownMenuItem(value: 'SALES_ORDER', child: Text('销售订单')),
              DropdownMenuItem(
                value: 'AFTER_SALES_ORDER',
                child: Text('售后单'),
              ),
            ],
            onChanged:
                loading ? null : (value) => setState(() => nextSource = value),
          ),
          FilledButton.icon(
            onPressed: loading ? null : () => onApply(nextPriority, nextSource),
            icon: const Icon(Icons.filter_alt_rounded),
            label: const Text('筛选'),
          ),
          IconButton(
            tooltip: '刷新',
            onPressed: loading ? null : onRefresh,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
    );
  }
}

class _ReminderCard extends StatelessWidget {
  const _ReminderCard({required this.reminder, required this.onTap});

  final TodoReminder reminder;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = reminder.priority == 'URGENT'
        ? Theme.of(context).colorScheme.error
        : reminder.priority == 'IMPORTANT'
            ? Colors.orange.shade700
            : Theme.of(context).colorScheme.primary;
    return Card(
      child: ListTile(
        onTap: onTap,
        leading: Badge(
          isLabelVisible: reminder.isUnread,
          child: Icon(Icons.task_alt_rounded, color: color),
        ),
        title: Text(
          reminder.title,
          style: TextStyle(
            fontWeight: reminder.isUnread ? FontWeight.w800 : FontWeight.w600,
          ),
        ),
        subtitle: Text(
          '${_sourceLabel(reminder.sourceType)} ${reminder.sourceNumber}'
          ' · ${_formatDateTime(reminder.dueAt)}',
        ),
        trailing: Chip(
          label: Text(
              reminder.isOverdue ? '已逾期' : _priorityLabel(reminder.priority)),
          side: BorderSide(color: color.withValues(alpha: 0.5)),
        ),
      ),
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
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 88,
            child: Text(
              label,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              Text(message),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('重试'),
              ),
            ],
          ),
        ),
      );
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard();

  @override
  Widget build(BuildContext context) => const Card(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Center(child: Text('当前分类没有待办。')),
        ),
      );
}

Future<DateTime?> _pickFutureDateTime(
  BuildContext context,
  DateTime initial,
) async {
  final date = await showDatePicker(
    context: context,
    firstDate: DateTime.now(),
    lastDate: DateTime.now().add(const Duration(days: 365)),
    initialDate: initial,
  );
  if (date == null || !context.mounted) return null;
  final time = await showTimePicker(
    context: context,
    initialTime: TimeOfDay.fromDateTime(initial),
  );
  if (time == null) return null;
  final result =
      DateTime(date.year, date.month, date.day, time.hour, time.minute);
  return result.isAfter(DateTime.now()) ? result : null;
}

String _destinationFor(String sourceType) {
  switch (sourceType) {
    case 'TRAVEL_GROUP':
      return 'travel_group_query';
    case 'AFTER_SALES_ORDER':
      return 'after_sales_form';
    default:
      return 'order_query';
  }
}

String _sourceLabel(String value) {
  switch (value) {
    case 'TRAVEL_GROUP':
      return '旅行团';
    case 'AFTER_SALES_ORDER':
      return '售后单';
    default:
      return '销售订单';
  }
}

String _priorityLabel(String value) {
  switch (value) {
    case 'URGENT':
      return '紧急';
    case 'IMPORTANT':
      return '重要';
    default:
      return '普通';
  }
}

String _formatDateTime(DateTime value) {
  final local = value.toLocal();
  String two(int number) => number.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)} '
      '${two(local.hour)}:${two(local.minute)}';
}
