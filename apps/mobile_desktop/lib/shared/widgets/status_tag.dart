import 'package:flutter/material.dart';

enum StatusTone { neutral, success, warning, danger, info }

class StatusTag extends StatelessWidget {
  const StatusTag({
    super.key,
    required this.label,
    this.tone = StatusTone.neutral,
  });

  final String label;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    final colors = _colors(context, tone);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: const BorderRadius.all(Radius.circular(999)),
        border: Border.all(color: colors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        child: Text(
          label,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: colors.foreground,
                fontWeight: FontWeight.w700,
              ),
        ),
      ),
    );
  }

  _TagColors _colors(BuildContext context, StatusTone tone) {
    final scheme = Theme.of(context).colorScheme;
    switch (tone) {
      case StatusTone.success:
        return const _TagColors(
          foreground: Color(0xFF176349),
          background: Color(0xFFE6F4EE),
          border: Color(0xFFB9DFD1),
        );
      case StatusTone.warning:
        return const _TagColors(
          foreground: Color(0xFF7A5200),
          background: Color(0xFFFFF3D6),
          border: Color(0xFFE8C56A),
        );
      case StatusTone.danger:
        return const _TagColors(
          foreground: Color(0xFF9C1C28),
          background: Color(0xFFFBE4E8),
          border: Color(0xFFE6A8B2),
        );
      case StatusTone.info:
        return const _TagColors(
          foreground: Color(0xFF1F5F85),
          background: Color(0xFFE4F1F7),
          border: Color(0xFFB3D5E5),
        );
      case StatusTone.neutral:
        return _TagColors(
          foreground: scheme.onSurfaceVariant,
          background: scheme.surfaceContainerHighest.withValues(alpha: 0.45),
          border: scheme.outlineVariant,
        );
    }
  }
}

class _TagColors {
  const _TagColors({
    required this.foreground,
    required this.background,
    required this.border,
  });

  final Color foreground;
  final Color background;
  final Color border;
}
