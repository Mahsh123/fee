import 'package:flutter_test/flutter_test.dart';
import 'package:timezone/data/latest_all.dart' as timezone_data;
import 'package:wasl_madrasa/formatting.dart';

void main() {
  setUpAll(timezone_data.initializeTimeZones);

  test('formats INR with Indian digit grouping and exact decimal strings', () {
    expect(formatMoney('150000.0000'), '₹1,50,000.00');
    expect(formatMoney('150000.1250'), '₹1,50,000.1250');
    expect(formatMoney('-950.5'), '-₹950.50');
    expect(formatMoney('1500.00', currency: 'USD'), 'USD 1,500.00');
  });

  test('retains exact ten-thousandth currency units when aggregating', () {
    final total = moneyUnits('1.1250') + moneyUnits('0.3750');
    expect(moneyString(total), '1.5000');
  });

  test('formats transaction timestamps in the configured tenant timezone', () {
    expect(
      formatIndianDate('2026-10-12T20:00:00.000Z', timezone: 'Asia/Kolkata'),
      '13/10/2026',
    );
  });

  test('keeps date-only due dates from shifting with device timezone', () {
    expect(formatIndianCalendarDate('2026-10-12T00:00:00.000Z'), '12/10/2026');
  });
}
