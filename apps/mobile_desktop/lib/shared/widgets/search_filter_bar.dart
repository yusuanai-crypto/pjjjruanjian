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
          onPressed: controller?.clear,
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
  });

  final List<String> filters;
  final String selected;
  final ValueChanged<String> onSelected;

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
  });

  final DateTime start;
  final DateTime end;
  final ValueChanged<DateTimeRange> onChanged;

  Future<void> _pickRange(BuildContext context) async {
    final result = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
      initialDateRange: DateTimeRange(start: start, end: end),
    );
    if (result != null) {
      onChanged(result);
    }
  }

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: () => _pickRange(context),
      icon: const Icon(Icons.date_range_rounded),
      label: Text('${formatDate(start)} 至 ${formatDate(end)}'),
    );
  }
}
