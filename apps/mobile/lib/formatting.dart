import 'package:intl/intl.dart';
import 'package:timezone/timezone.dart' as tz;

const int _scale = 10000;

BigInt moneyUnits(String? value) {
  if (value == null) return BigInt.zero;
  final raw = value.trim();
  final match = RegExp(r'^(-?)(\d+)(?:\.(\d+))?$').firstMatch(raw);
  if (match == null) return BigInt.zero;
  final fraction = (match.group(3) ?? '').padRight(4, '0');
  final padded = fraction.length > 4 ? fraction.substring(0, 4) : fraction;
  final units = BigInt.parse(match.group(2)!) * BigInt.from(_scale) +
      BigInt.parse(padded.isEmpty ? '0' : padded);
  return match.group(1) == '-' ? -units : units;
}

String moneyString(BigInt units) {
  final negative = units.isNegative;
  final absolute = units.abs();
  final whole = absolute ~/ BigInt.from(_scale);
  final fraction = (absolute % BigInt.from(_scale)).toString().padLeft(4, '0');
  return '${negative ? '-' : ''}$whole.$fraction';
}

String formatMoney(String? value, {String currency = 'INR'}) {
  final units = moneyUnits(value);
  final negative = units.isNegative;
  final absolute = units.abs();
  final whole = (absolute ~/ BigInt.from(_scale)).toString();
  final frac4 = (absolute % BigInt.from(_scale)).toString().padLeft(4, '0');
  var decimals = frac4.endsWith('00') ? 2 : 4;
  final fraction = frac4.substring(0, decimals);
  final sign = negative ? '-' : '';
  final grouped = _indianGrouping(whole);
  if (currency.toUpperCase() == 'INR') return '$sign₹$grouped.$fraction';
  return '$sign$currency $grouped.$fraction';
}

String _indianGrouping(String digits) {
  if (digits.length <= 3) return digits;
  final last = digits.substring(digits.length - 3);
  var head = digits.substring(0, digits.length - 3);
  final groups = <String>[];
  while (head.length > 2) {
    groups.insert(0, head.substring(head.length - 2));
    head = head.substring(0, head.length - 2);
  }
  if (head.isNotEmpty) groups.insert(0, head);
  return '${groups.join(',')},$last';
}

String formatIndianDate(Object? value, {String? timezone}) {
  if (value == null) return '—';
  final date = value is DateTime ? value : DateTime.tryParse(value.toString());
  if (date == null) return '—';
  try {
    final location = tz.getLocation(timezone ?? 'Asia/Kolkata');
    return DateFormat('dd/MM/yyyy')
        .format(tz.TZDateTime.from(date.toUtc(), location));
  } on Exception {
    return DateFormat('dd/MM/yyyy').format(date.toLocal());
  }
}

String formatIndianCalendarDate(Object? value) {
  if (value == null) return '—';
  final text = value.toString();
  final date =
      DateTime.tryParse(text.length >= 10 ? text.substring(0, 10) : text);
  if (date == null) return '—';
  return DateFormat('dd/MM/yyyy').format(date);
}

String paymentStatusLabel(Object? value) {
  final status = value?.toString().toUpperCase() ?? '';
  if (status.isEmpty) return 'Status unavailable';
  return status
      .replaceAll('_', ' ')
      .toLowerCase()
      .split(' ')
      .map(
        (word) => word.isEmpty
            ? word
            : '${word[0].toUpperCase()}${word.substring(1)}',
      )
      .join(' ');
}
