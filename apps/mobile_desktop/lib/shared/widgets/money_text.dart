import 'package:flutter/material.dart';
import 'package:jiangjiu_shared/jiangjiu_shared.dart';

class MoneyText extends StatelessWidget {
  const MoneyText({
    super.key,
    required this.cents,
    this.prominent = false,
  });

  final int cents;
  final bool prominent;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Text(
      formatMoneyCents(cents),
      style: (prominent ? theme.textTheme.titleLarge : theme.textTheme.titleMedium)?.copyWith(
        color: cents < 0 ? theme.colorScheme.error : theme.colorScheme.primary,
        fontWeight: FontWeight.w800,
      ),
    );
  }
}

