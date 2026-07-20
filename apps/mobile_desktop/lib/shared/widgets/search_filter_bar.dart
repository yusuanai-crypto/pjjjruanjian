import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

class AppSearchField extends StatelessWidget {
  const AppSearchField({
    super.key,
    this.hintText = '搜索',
    this.onChanged,
    this.controller,
  });

  final String hintText;
  final ValueChanged<String>? onChanged;
  final TextEditingController? controller;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      decoration: InputDecoration(
        prefixIcon: const Icon(Icons.search_rounded),
        suffixIcon: IconButton(
          tooltip: '清空',
          onPressed: controller == null
              ? null
              : () {
                  controller!.clear();
                  onChanged?.call('');
                },
          icon: const Icon(Icons.close_rounded),
        ),
        hintText: hintText,
      ),
    );
  }
}

class AppFilterBar extends StatelessWidget {
  const AppFilterBar({
    super.key,
    required this.filters,
    required this.selected,
    required this.onSelected,
    this.labelColor = Colors.black87,
  });

  final List<String> filters;
  final String selected;
  final ValueChanged<String> onSelected;
  final Color labelColor;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final filter in filters)
          FilterChip(
            selected: selected == filter,
            onSelected: (_) => onSelected(filter),
            labelStyle: TextStyle(color: labelColor),
            label: Text(filter),
          ),
      ],
    );
  }
}

class AppDateRangeButton extends StatelessWidget {
  const AppDateRangeButton({
    super.key,
    required this.start,
    required this.end,
    required this.onChanged,
    this.allSelected = false,
    this.onAllSelected,
    this.allLabel = '全部日期',
  });

  final DateTime start;
  final DateTime end;
  final ValueChanged<DateTimeRange> onChanged;
  final bool allSelected;
  final VoidCallback? onAllSelected;
  final String allLabel;

  Future<void> _pickRange(BuildContext context) async {
    final result = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
      initialDateRange: DateTimeRange(start: start, end: end),
      locale: const Locale('zh', 'CN'),
      helpText: '选择日期范围',
      cancelText: '取消',
      confirmText: '确定',
      saveText: '确定',
      fieldStartHintText: '开始日期',
      fieldEndHintText: '结束日期',
      fieldStartLabelText: '开始日期',
      fieldEndLabelText: '结束日期',
      errorFormatText: '请输入正确日期',
      errorInvalidText: '日期无效',
      errorInvalidRangeText: '结束日期不能早于开始日期',
    );
    if (result != null) {
      onChanged(result);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rangeButton = OutlinedButton.icon(
      onPressed: () => _pickRange(context),
      icon: const Icon(Icons.date_range_rounded),
      label: Text('${formatDate(start)} 至 ${formatDate(end)}'),
    );
    final onAll = onAllSelected;
    if (onAll == null) {
      return rangeButton;
    }
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        rangeButton,
        FilterChip(
          selected: allSelected,
          onSelected: (_) => onAll(),
          label: Text(allLabel),
        ),
      ],
    );
  }
}
