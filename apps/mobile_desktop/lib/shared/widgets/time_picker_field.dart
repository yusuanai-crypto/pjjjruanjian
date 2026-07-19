import 'package:flutter/material.dart';

class AppTimePickerField extends StatelessWidget {
  const AppTimePickerField({
    super.key,
    required this.controller,
    required this.label,
    this.enabled = true,
    this.validator,
    this.onChanged,
  });

  final TextEditingController controller;
  final String label;
  final bool enabled;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onChanged;

  Future<void> _pickTime(BuildContext context) async {
    final result = await showTimePicker(
      context: context,
      initialTime: _parseTimeOfDay(controller.text) ?? TimeOfDay.now(),
    );
    if (result == null) {
      return;
    }
    final text = _formatTimeOfDay(result);
    controller.text = text;
    onChanged?.call(text);
  }

  void _clearTime() {
    controller.clear();
    onChanged?.call('');
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, _) {
        final hasValue = value.text.trim().isNotEmpty;
        return TextFormField(
          controller: controller,
          readOnly: true,
          enabled: enabled,
          validator: validator,
          onTap: enabled ? () => _pickTime(context) : null,
          decoration: InputDecoration(
            labelText: label,
            suffix: hasValue
                ? IconButton(
                    tooltip: '清空时间',
                    visualDensity: VisualDensity.compact,
                    onPressed: enabled ? _clearTime : null,
                    icon: const Icon(Icons.close_rounded, size: 18),
                  )
                : null,
            suffixIcon: const Icon(Icons.access_time_rounded),
          ),
        );
      },
    );
  }
}

TimeOfDay? _parseTimeOfDay(String value) {
  final match = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(value.trim());
  if (match == null) {
    return null;
  }
  final hour = int.tryParse(match.group(1)!);
  final minute = int.tryParse(match.group(2)!);
  if (hour == null ||
      minute == null ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59) {
    return null;
  }
  return TimeOfDay(hour: hour, minute: minute);
}

String normalizeTimeText(String? value) {
  final text = value?.trim() ?? '';
  if (text.isEmpty) {
    return '';
  }
  final parsed = _parseTimeOfDay(text);
  return parsed == null ? text : _formatTimeOfDay(parsed);
}

String _formatTimeOfDay(TimeOfDay value) {
  return '${value.hour.toString().padLeft(2, '0')}:'
      '${value.minute.toString().padLeft(2, '0')}';
}
