import 'package:flutter/material.dart';

import '../api/wasl_api.dart';
import '../formatting.dart';
import '../models.dart';
import '../widgets/brand_mark.dart';
import 'online_payment_screen.dart';
import 'receipt_screen.dart';

class PortalStore extends ChangeNotifier {
  PortalStore(this.api, this.user);

  final WaslApi api;
  final SessionUser user;
  JsonMap? data;
  String? error;
  bool loading = false;
  String? selectedStudentId;

  List<JsonMap> get students => asJsonList(data?['students']);
  List<JsonMap> get demands => asJsonList(data?['demands']);
  List<JsonMap> get payments => asJsonList(data?['payments']);
  List<JsonMap> get paymentMethods => asJsonList(data?['paymentMethods']);
  JsonMap? get selectedStudent {
    final matching = students.where(
      (student) => student['id']?.toString() == selectedStudentId,
    );
    return matching.isEmpty
        ? (students.isEmpty ? null : students.first)
        : matching.first;
  }

  List<JsonMap> forSelectedStudent(List<JsonMap> records) {
    final studentId = selectedStudent?['id']?.toString();
    return records
        .where((record) => record['studentId']?.toString() == studentId)
        .toList();
  }

  Future<void> load({bool refresh = false}) async {
    if (loading && !refresh) return;
    loading = true;
    error = null;
    notifyListeners();
    try {
      data = asJsonMap(await api.get('portal/dashboard'));
      if (selectedStudentId == null ||
          !students.any(
            (student) => student['id']?.toString() == selectedStudentId,
          )) {
        final linked = students.where(
          (student) => student['id']?.toString() == user.studentId,
        );
        selectedStudentId = linked.isNotEmpty
            ? user.studentId
            : firstOrNull(students)?['id']?.toString();
      }
    } on ApiException catch (exception) {
      error = exception.message;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  void selectStudent(String id) {
    selectedStudentId = id;
    notifyListeners();
  }
}

class PortalHomeScreen extends StatelessWidget {
  const PortalHomeScreen({
    super.key,
    required this.store,
    required this.tenant,
  });
  final PortalStore store;
  final TenantBranding tenant;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: store,
        builder: (context, _) {
          final student = store.selectedStudent;
          final studentDemands = store.forSelectedStudent(store.demands);
          final studentPayments = store.forSelectedStudent(store.payments);
          final currency =
              firstOrNull(studentDemands)?['currency']?.toString() ?? 'INR';
          final outstanding = studentDemands.fold<BigInt>(
            BigInt.zero,
            (sum, row) =>
                sum + moneyUnits(row['outstandingAmount']?.toString()),
          );
          final nextDue = [...studentDemands]..sort(
              (a, b) =>
                  _dateValue(a['dueDate']).compareTo(_dateValue(b['dueDate'])),
            );
          return RefreshIndicator(
            onRefresh: () => store.load(refresh: true),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 54, 20, 28),
              children: [
                Row(
                  children: [
                    BrandMark(tenant: tenant),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            tenant.displayName,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 2),
                          const Text(
                            'Student and parent portal',
                            style: TextStyle(
                              fontSize: 12,
                              color: Color(0xFF737373),
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Refresh',
                      onPressed: store.loading
                          ? null
                          : () => store.load(refresh: true),
                      icon: const Icon(Icons.refresh_rounded),
                    ),
                  ],
                ),
                const SizedBox(height: 26),
                Text(
                  'Assalamu alaikum',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  student?['firstName']?.toString().trim().isNotEmpty == true
                      ? 'Welcome, ${student!['firstName']}'
                      : 'Welcome',
                  style: const TextStyle(
                    fontSize: 25,
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF171717),
                  ),
                ),
                if (store.students.length > 1) ...[
                  const SizedBox(height: 18),
                  DropdownButtonFormField<String>(
                    initialValue: student?['id']?.toString(),
                    decoration:
                        const InputDecoration(labelText: 'Student profile'),
                    items: store.students
                        .map(
                          (row) => DropdownMenuItem(
                            value: row['id']?.toString(),
                            child: Text(
                              '${_studentName(row)} · ${row['admissionNumber'] ?? '—'}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value != null) store.selectStudent(value);
                    },
                  ),
                ] else if (student != null) ...[
                  const SizedBox(height: 5),
                  Text(
                    'Admission no. ${student['admissionNumber'] ?? '—'}',
                    style:
                        const TextStyle(color: Color(0xFF737373), fontSize: 13),
                  ),
                ],
                if (store.error != null) ...[
                  const SizedBox(height: 20),
                  _InlineMessage(
                    message: store.error!,
                    isError: true,
                    onRetry: () => store.load(refresh: true),
                  ),
                ] else if (store.loading && store.data == null) ...[
                  const SizedBox(height: 60),
                  const Center(child: CircularProgressIndicator()),
                ] else if (student == null) ...[
                  const SizedBox(height: 24),
                  const _EmptyCard(
                    title: 'No linked student profile',
                    message:
                        'This account has no active student profiles linked in Wasl. Contact your Madrasa administrator.',
                    icon: Icons.person_search_outlined,
                  ),
                ] else ...[
                  const SizedBox(height: 22),
                  _BalanceCard(
                    amount: formatMoney(
                      moneyString(outstanding),
                      currency: currency,
                    ),
                    label: 'Outstanding fees',
                    detail: nextDue.isEmpty
                        ? 'No fee balance is currently due.'
                        : 'Next due ${formatIndianCalendarDate(nextDue.first['dueDate'])}',
                  ),
                  const SizedBox(height: 14),
                  _PanelCard(
                    title: 'Attendance',
                    trailing: const Icon(
                      Icons.event_busy_outlined,
                      color: Color(0xFF9A6B1D),
                    ),
                    child: const Text(
                      'Attendance records are not available in the Wasl API yet.',
                      style: TextStyle(
                        height: 1.45,
                        fontSize: 13,
                        color: Color(0xFF737373),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  _PanelCard(
                    title: 'Recent payments',
                    child: studentPayments.isEmpty
                        ? const Text(
                            'No completed payments are available.',
                            style: TextStyle(
                              fontSize: 13,
                              color: Color(0xFF737373),
                            ),
                          )
                        : Column(
                            children: studentPayments
                                .take(3)
                                .map(
                                  (payment) => _PaymentRow(
                                    payment: payment,
                                    timezone: tenant.timezone,
                                    onReceipt: _receiptAction(
                                      context,
                                      store.api,
                                      payment,
                                    ),
                                  ),
                                )
                                .toList(),
                          ),
                  ),
                ],
              ],
            ),
          );
        },
      );
}

class AttendanceUnavailableScreen extends StatelessWidget {
  const AttendanceUnavailableScreen({super.key});

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.fromLTRB(22, 58, 22, 30),
        children: const [
          Text(
            'Attendance',
            style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
          ),
          SizedBox(height: 18),
          _EmptyCard(
            title: 'Attendance is not connected yet',
            message:
                'Wasl currently has no attendance API or attendance records for this Madrasa. No sample records are shown. Ask the Wasl administrator to add the attendance service before using this screen.',
            icon: Icons.event_busy_outlined,
          ),
        ],
      );
}

class PortalFeesScreen extends StatelessWidget {
  const PortalFeesScreen({
    super.key,
    required this.api,
    required this.store,
    required this.user,
    required this.tenant,
  });
  final WaslApi api;
  final PortalStore store;
  final SessionUser user;
  final TenantBranding tenant;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: store,
        builder: (context, _) {
          final student = store.selectedStudent;
          final demands = store.forSelectedStudent(store.demands);
          final payments = store.forSelectedStudent(store.payments);
          final methods = store.paymentMethods;
          final onlineAllowed = user.can('payment.collect') &&
              tenant.paymentsEnabled &&
              methods.isNotEmpty;
          return RefreshIndicator(
            onRefresh: () => store.load(refresh: true),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 54, 20, 30),
              children: [
                const Text(
                  'Fees and payments',
                  style: TextStyle(fontSize: 25, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                Text(
                  student == null
                      ? 'Fee records linked to this account'
                      : _studentName(student),
                  style: const TextStyle(color: Color(0xFF737373)),
                ),
                if (student != null && store.students.length > 1) ...[
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue: student['id']?.toString(),
                    decoration:
                        const InputDecoration(labelText: 'Student profile'),
                    items: store.students
                        .map(
                          (row) => DropdownMenuItem(
                            value: row['id']?.toString(),
                            child: Text(
                              '${_studentName(row)} · ${row['admissionNumber'] ?? '—'}',
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value != null) store.selectStudent(value);
                    },
                  ),
                ],
                const SizedBox(height: 20),
                if (onlineAllowed && student != null) ...[
                  FilledButton.icon(
                    onPressed: () async {
                      final completed = await Navigator.of(context).push<bool>(
                        MaterialPageRoute(
                          builder: (_) => OnlinePaymentScreen(
                            api: api,
                            user: user,
                            student: student,
                            methods: methods,
                          ),
                        ),
                      );
                      if (completed == true) await store.load(refresh: true);
                    },
                    icon: const Icon(Icons.lock_outline_rounded),
                    label: const Text('Pay online'),
                  ),
                  const SizedBox(height: 16),
                ],
                if (store.error != null)
                  _InlineMessage(
                    message: store.error!,
                    isError: true,
                    onRetry: () => store.load(refresh: true),
                  ),
                _SectionTitle(title: 'Fee entries', count: demands.length),
                if (demands.isEmpty)
                  const _EmptyCard(
                    title: 'No outstanding fee entries',
                    message:
                        'There are no unpaid fee entries linked to this profile.',
                    icon: Icons.task_alt_rounded,
                  )
                else
                  ...demands.map((row) => _DemandCard(demand: row)),
                const SizedBox(height: 24),
                _SectionTitle(title: 'Payment history', count: payments.length),
                if (payments.isEmpty)
                  const _EmptyCard(
                    title: 'No completed payments',
                    message:
                        'Completed payments and receipts will appear here after Wasl records them.',
                    icon: Icons.receipt_long_outlined,
                  )
                else
                  ...payments.map(
                    (payment) => _PaymentCard(
                      payment: payment,
                      timezone: tenant.timezone,
                      onReceipt: _receiptAction(context, api, payment),
                    ),
                  ),
              ],
            ),
          );
        },
      );
}

class PortalProfileScreen extends StatelessWidget {
  const PortalProfileScreen({
    super.key,
    required this.store,
    required this.user,
    required this.tenant,
    required this.onSignOut,
  });
  final PortalStore store;
  final SessionUser user;
  final TenantBranding tenant;
  final Future<void> Function() onSignOut;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: store,
        builder: (context, _) {
          final student = store.selectedStudent;
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 54, 20, 30),
            children: [
              const Text(
                'Profile',
                style: TextStyle(fontSize: 25, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 20),
              if (store.students.length > 1)
                DropdownButtonFormField<String>(
                  initialValue: student?['id']?.toString(),
                  decoration:
                      const InputDecoration(labelText: 'Student profile'),
                  items: store.students
                      .map(
                        (row) => DropdownMenuItem(
                          value: row['id']?.toString(),
                          child: Text(_studentName(row)),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) store.selectStudent(value);
                  },
                )
              else if (student != null)
                _StudentProfileCard(student: student),
              if (student != null && store.students.length > 1) ...[
                const SizedBox(height: 12),
                _StudentProfileCard(student: student),
              ],
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Linked account',
                        style: TextStyle(
                            fontWeight: FontWeight.w800, fontSize: 16),
                      ),
                      const SizedBox(height: 17),
                      _InfoLine(label: 'Account name', value: user.displayName),
                      const SizedBox(height: 13),
                      _InfoLine(label: 'Email', value: user.email),
                      if (user.phone?.isNotEmpty == true) ...[
                        const SizedBox(height: 13),
                        _InfoLine(label: 'Phone', value: user.phone!),
                      ],
                      const SizedBox(height: 13),
                      _InfoLine(label: 'Madrasa', value: tenant.displayName),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),
              const _InlineMessage(
                message:
                    'The portal API does not provide profile photos, class labels, or guardian contact records. This screen only shows fields Wasl authorises for the signed-in account.',
                isError: false,
              ),
              const SizedBox(height: 22),
              OutlinedButton.icon(
                onPressed: () => onSignOut(),
                icon: const Icon(Icons.logout_rounded),
                label: const Text('Sign out'),
              ),
            ],
          );
        },
      );
}

class _StudentProfileCard extends StatelessWidget {
  const _StudentProfileCard({required this.student});
  final JsonMap student;
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const CircleAvatar(
                    radius: 23,
                    backgroundColor: Color(0xFFECFDF5),
                    child: Icon(
                      Icons.person_outline_rounded,
                      color: Color(0xFF047857),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      _studentName(student),
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              const Divider(height: 28),
              _InfoLine(
                label: 'Registration no.',
                value: student['admissionNumber']?.toString() ?? '—',
              ),
              const SizedBox(height: 13),
              _InfoLine(
                label: 'Status',
                value: paymentStatusLabel(student['status']),
              ),
            ],
          ),
        ),
      );
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({
    required this.amount,
    required this.label,
    required this.detail,
  });
  final String amount;
  final String label;
  final String detail;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: const Color(0xFF064E3B),
          borderRadius: BorderRadius.circular(22),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(
              Icons.account_balance_wallet_outlined,
              color: Color(0xFFC8E9D7),
            ),
            const SizedBox(height: 16),
            Text(
              label,
              style: const TextStyle(color: Color(0xFFD9F3E5), fontSize: 13),
            ),
            const SizedBox(height: 5),
            Text(
              amount,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 30,
                fontWeight: FontWeight.w800,
                letterSpacing: -.4,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              detail,
              style: const TextStyle(color: Color(0xFFC8E9D7), fontSize: 12),
            ),
          ],
        ),
      );
}

class _PanelCard extends StatelessWidget {
  const _PanelCard({required this.title, required this.child, this.trailing});
  final String title;
  final Widget child;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(17),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                      ),
                    ),
                  ),
                  if (trailing != null) trailing!,
                ],
              ),
              const SizedBox(height: 12),
              child,
            ],
          ),
        ),
      );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, required this.count});
  final String title;
  final int count;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          children: [
            Expanded(
              child: Text(
                title,
                style:
                    const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
              ),
            ),
            Text(
              '$count',
              style: const TextStyle(fontSize: 12, color: Color(0xFF737373)),
            ),
          ],
        ),
      );
}

class _DemandCard extends StatelessWidget {
  const _DemandCard({required this.demand});
  final JsonMap demand;
  @override
  Widget build(BuildContext context) {
    final currency = demand['currency']?.toString() ?? 'INR';
    final due = demand['dueDate'];
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.receipt_long_outlined,
                  size: 19,
                  color: Color(0xFF047857),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Text(
                    'Fee ${demand['demandNumber'] ?? ''}',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
                _StatusChip(label: paymentStatusLabel(demand['status'])),
              ],
            ),
            const SizedBox(height: 13),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Outstanding',
                  style: TextStyle(color: Color(0xFF737373), fontSize: 12),
                ),
                Text(
                  formatMoney(
                    demand['outstandingAmount']?.toString(),
                    currency: currency,
                  ),
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Due date',
                  style: TextStyle(color: Color(0xFF737373), fontSize: 12),
                ),
                Text(
                  formatIndianCalendarDate(due),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PaymentCard extends StatelessWidget {
  const _PaymentCard(
      {required this.payment, required this.timezone, this.onReceipt});
  final JsonMap payment;
  final String timezone;
  final VoidCallback? onReceipt;
  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 10),
        child: Padding(
          padding: const EdgeInsets.all(15),
          child: _PaymentRow(
              payment: payment, timezone: timezone, onReceipt: onReceipt),
        ),
      );
}

class _PaymentRow extends StatelessWidget {
  const _PaymentRow(
      {required this.payment, required this.timezone, this.onReceipt});
  final JsonMap payment;
  final String timezone;
  final VoidCallback? onReceipt;
  @override
  Widget build(BuildContext context) {
    final currency = payment['currency']?.toString() ?? 'INR';
    final receiptList = asJsonList(payment['receipts']);
    return Row(
      children: [
        const CircleAvatar(
          radius: 20,
          backgroundColor: Color(0xFFECFDF5),
          child: Icon(Icons.check_rounded, color: Color(0xFF047857), size: 19),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                payment['paymentNumber']?.toString() ?? 'Payment',
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                '${formatIndianDate(payment['paidAt'], timezone: timezone)} · ${payment['methodKind'] ?? 'Payment'}',
                style: const TextStyle(color: Color(0xFF737373), fontSize: 11),
              ),
              if (receiptList.isNotEmpty)
                Text(
                  'Receipt ${receiptList.first['receiptNumber'] ?? ''}',
                  style: const TextStyle(
                    fontSize: 11,
                    color: Color(0xFF737373),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Text(
          formatMoney(payment['amount']?.toString(), currency: currency),
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
        ),
        if (onReceipt != null)
          IconButton(
            onPressed: onReceipt,
            tooltip: 'View receipt',
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.receipt_outlined, size: 18),
          ),
      ],
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(
          color: const Color(0xFFECFDF5),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: const TextStyle(
            color: Color(0xFF047857),
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
      );
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({
    required this.title,
    required this.message,
    required this.icon,
  });
  final String title;
  final String message;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 24, color: const Color(0xFF047857)),
              const SizedBox(height: 12),
              Text(
                title,
                style:
                    const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
              ),
              const SizedBox(height: 7),
              Text(
                message,
                style: const TextStyle(
                  fontSize: 12,
                  height: 1.45,
                  color: Color(0xFF737373),
                ),
              ),
            ],
          ),
        ),
      );
}

class _InlineMessage extends StatelessWidget {
  const _InlineMessage({
    required this.message,
    this.isError = false,
    this.onRetry,
  });
  final String message;
  final bool isError;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isError ? const Color(0xFFFFF3F1) : const Color(0xFFECFDF5),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              isError
                  ? Icons.error_outline_rounded
                  : Icons.info_outline_rounded,
              color:
                  isError ? const Color(0xFFB42318) : const Color(0xFF047857),
              size: 18,
            ),
            const SizedBox(width: 9),
            Expanded(
              child: Text(
                message,
                style: TextStyle(
                  fontSize: 12,
                  height: 1.4,
                  color: isError
                      ? const Color(0xFF8D2D26)
                      : const Color(0xFF456357),
                ),
              ),
            ),
            if (onRetry != null)
              IconButton(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded),
                visualDensity: VisualDensity.compact,
              ),
          ],
        ),
      );
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 108,
            child: Text(
              label,
              style: const TextStyle(fontSize: 12, color: Color(0xFF737373)),
            ),
          ),
          Expanded(
            child: Text(
              value.isEmpty ? '—' : value,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      );
}

String _studentName(JsonMap student) => [
      student['firstName'],
      student['middleName'],
      student['lastName'],
    ].whereType<String>().where((part) => part.trim().isNotEmpty).join(' ');
DateTime _dateValue(Object? value) => value == null
    ? DateTime(9999)
    : DateTime.tryParse(value.toString()) ?? DateTime(9999);

VoidCallback? _receiptAction(
  BuildContext context,
  WaslApi api,
  JsonMap payment,
) {
  final receipts = asJsonList(payment['receipts']);
  if (receipts.isEmpty || receipts.first['id'] == null) return null;
  return () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ReceiptScreen(
            api: api,
            receiptId: receipts.first['id'].toString(),
            portal: true,
          ),
        ),
      );
}
