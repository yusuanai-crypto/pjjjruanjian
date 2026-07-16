import 'package:flutter/material.dart';

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.title,
    this.action,
  });

  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return _StateSurface(
      icon: Icons.inbox_rounded,
      title: title,
      action: action,
    );
  }
}

class LoadingState extends StatelessWidget {
  const LoadingState({super.key, this.title = '加载中'});

  final String title;

  @override
  Widget build(BuildContext context) {
    return _StateSurface(
      icon: Icons.hourglass_top_rounded,
      title: title,
      progress: true,
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({
    super.key,
    required this.title,
    this.onRetry,
  });

  final String title;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return _StateSurface(
      icon: Icons.error_outline_rounded,
      title: title,
      action: onRetry == null
          ? null
          : OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('重试'),
            ),
    );
  }
}

class _StateSurface extends StatelessWidget {
  const _StateSurface({
    required this.icon,
    required this.title,
    this.action,
    this.progress = false,
  });

  final IconData icon;
  final String title;
  final Widget? action;
  final bool progress;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (progress)
              const SizedBox.square(
                dimension: 28,
                child: CircularProgressIndicator(strokeWidth: 2.4),
              )
            else
              Icon(icon, size: 34, color: scheme.primary),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            if (action != null) ...[
              const SizedBox(height: 16),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}
