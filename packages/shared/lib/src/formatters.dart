String formatMoneyCents(int cents, {String symbol = '¥'}) {
  final sign = cents < 0 ? '-' : '';
  final absValue = cents.abs();
  final yuan = absValue ~/ 100;
  final fraction = (absValue % 100).toString().padLeft(2, '0');
  return '$sign$symbol$yuan.$fraction';
}

/// Converts the backend amount used by the points table to its dedicated
/// display amount. The display contract is 1/100 of the current value.
///
/// Integer half-up rounding avoids introducing floating-point money errors.
int scalePointsTableAmountCents(int sourceCents) {
  final sign = sourceCents < 0 ? -1 : 1;
  final absolute = sourceCents.abs();
  return sign * ((absolute + 50) ~/ 100);
}

/// Converts an edited points-table display amount back to the unchanged
/// backend storage unit.
int pointsTableDisplayCentsToSourceCents(int displayCents) =>
    displayCents * 100;

String formatPointsTableMoneyCents(
  int sourceCents, {
  String symbol = '¥',
}) {
  return formatMoneyCents(
    scalePointsTableAmountCents(sourceCents),
    symbol: symbol,
  );
}

String formatDate(DateTime value) {
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  return '${value.year}-$month-$day';
}

String formatDateTime(DateTime value) {
  final hour = value.hour.toString().padLeft(2, '0');
  final minute = value.minute.toString().padLeft(2, '0');
  return '${formatDate(value)} $hour:$minute';
}
