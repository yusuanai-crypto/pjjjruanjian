String formatMoneyCents(int cents, {String symbol = '¥'}) {
  final sign = cents < 0 ? '-' : '';
  final absValue = cents.abs();
  final yuan = absValue ~/ 100;
  final fraction = (absValue % 100).toString().padLeft(2, '0');
  return '$sign$symbol$yuan.$fraction';
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

