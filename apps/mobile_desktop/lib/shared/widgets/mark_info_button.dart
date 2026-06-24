import 'package:flutter/material.dart';

class MarkInfoButton extends StatelessWidget {
  const MarkInfoButton({
    super.key,
    required this.marked,
    required this.onPressed,
    this.label = '标记信息',
    this.compact = false,
    this.busy = false,
  });

  final bool marked;
  final VoidCallback? onPressed;
  final String label;
  final bool compact;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final icon =
        marked ? Icons.bookmark_added_rounded : Icons.bookmark_add_outlined;
    final text = marked ? '$label 已标记' : '$label 未标记';
    final iconWidget = busy
        ? SizedBox.square(
            dimension: compact ? 18 : 20,
            child: const CircularProgressIndicator(strokeWidth: 2),
          )
        : Icon(icon, size: compact ? 18 : null);
    final effectiveOnPressed = busy ? null : onPressed;

    if (marked) {
      return FilledButton.icon(
        onPressed: effectiveOnPressed,
        icon: iconWidget,
        label: Text(text),
      );
    }
    return OutlinedButton.icon(
      onPressed: effectiveOnPressed,
      icon: iconWidget,
      label: Text(text),
    );
  }
}
