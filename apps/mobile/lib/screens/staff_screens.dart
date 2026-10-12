import 'dart:async';
import 'package:flutter/material.dart';

import '../api/wasl_api.dart';
import '../formatting.dart';
import '../models.dart';
import '../widgets/brand_mark.dart';
import 'collection_screen.dart';

class StaffHomeScreen extends StatefulWidget {
  const StaffHomeScreen({
    super.key,
    required this.api,
    required this.user,
    required this.tenant,
    required this.openStudents,
  });
  final WaslApi api;
  final SessionUser user;
  final TenantBranding tenant;
  final VoidCallback openStudents;

  @override
  State<StaffHomeScreen> createState() => _StaffHomeScreenState();
}

class _StaffHomeScreenState extends State<StaffHomeScreen> {
  bool _loading = true;
  int? _studentCount;
  List<JsonMap> _payments = const [];
  List<JsonMap> _outstanding = const [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final errors = <String>[];
    if (widget.user.can('student.read')) {
      try {
        final result = asJsonMap(
          await widget.api.get(
            'students',
            query: const {'page': '1', 'pageSize': '1'},
          ),
        );
        _studentCount = asJsonMap(result['pagination'])['total'] as int?;
      } on ApiException catch (error) {
        errors.add(error.message);
      }
    }
    if (widget.user.can('payment.read')) {
      try {
        final result = asJsonMap(
          await widget.api.get(
            'payments',
            query: const {'page': '1', 'pageSize': '5', 'sort': '-paidAt'},
          ),
        );
        _payments = asJsonList(result['items']);
      } on ApiException catch (error) {
        errors.add(error.message);
      }
    }
    if (widget.user.can('report.read') &&
        widget.tenant.enabledModules.contains('REPORTS')) {
      try {
        final report = asJsonMap(await widget.api.get('reports/finance'));
        _outstanding = asJsonList(report['outstanding']);
      } on ApiException catch (error) {
        errors.add(error.message);
      }
    }
    if (mounted)
      setState(() {
        _loading = false;
        _error = errors.isEmpty ? null : errors.first;
      });
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 54, 20, 30),
          children: [
            Row(
              children: [
                BrandMark(tenant: widget.tenant),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.tenant.displayName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 2),
                      const Text(
                        'Staff workspace',
                        style:
                            TextStyle(fontSize: 12, color: Color(0xFF737373)),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: _loading ? null : _load,
                  tooltip: 'Refresh',
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
            const SizedBox(height: 28),
            Text(
              'Assalamu alaikum, ${widget.user.firstName}',
              style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            const Text(
              'Choose a task to get started.',
              style: TextStyle(color: Color(0xFF737373)),
            ),
            const SizedBox(height: 22),
            if (widget.user.can('student.read'))
              _CountCard(
                count: _studentCount,
                label: 'Students in your permitted scope',
                icon: Icons.groups_2_outlined,
                loading: _loading,
              ),
            if (widget.user.can('student.read')) const SizedBox(height: 12),
            if (widget.user.can('report.read') &&
                widget.tenant.enabledModules.contains('REPORTS')) ...[
              const SizedBox(height: 12),
              _OutstandingCard(rows: _outstanding, loading: _loading),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              _MessageCard(message: _error!, onRetry: _load),
            ],
            const SizedBox(height: 22),
            const Text(
              'Quick actions',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                if (widget.user.can('student.read'))
                  Expanded(
                    child: _ActionCard(
                      icon: Icons.search_rounded,
                      title: 'Find a student',
                      subtitle: 'Open a permitted record',
                      onTap: widget.openStudents,
                    ),
                  ),
                if (widget.user.can('student.read') &&
                    widget.user.can('payment.collect'))
                  const SizedBox(width: 11),
                if (widget.user.can('student.read') &&
                    widget.user.can('payment.collect'))
                  Expanded(
                    child: _ActionCard(
                      icon: Icons.add_card_rounded,
                      title: 'Collect a fee',
                      subtitle: 'Record through Wasl',
                      onTap: widget.openStudents,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            const _UnavailableCard(
              title: 'Attendance marking',
              message:
                  'The Wasl API has no attendance records or marking endpoint yet. Attendance actions are not available here.',
              icon: Icons.event_busy_outlined,
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Recent payments',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                  ),
                ),
                if (_loading)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
            const SizedBox(height: 11),
            if (!widget.user.can('payment.read'))
              const _UnavailableCard(
                title: 'Payment history',
                message: 'Your role does not have payment-read access.',
                icon: Icons.lock_outline_rounded,
              )
            else if (_payments.isEmpty && !_loading)
              const _UnavailableCard(
                title: 'No recent payment records',
                message:
                    'Payments will appear here after the Wasl API returns them.',
                icon: Icons.receipt_long_outlined,
              )
            else
              ..._payments.map((payment) => _RecentPayment(
                  payment: payment, timezone: widget.tenant.timezone)),
          ],
        ),
      );
}

class StudentSearchScreen extends StatefulWidget {
  const StudentSearchScreen({
    super.key,
    required this.api,
    required this.user,
    this.feeSearch = false,
  });
  final WaslApi api;
  final SessionUser user;
  final bool feeSearch;

  @override
  State<StudentSearchScreen> createState() => _StudentSearchScreenState();
}

class _StudentSearchScreenState extends State<StudentSearchScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  List<JsonMap> _students = const [];
  bool _loading = false;
  String? _error;
  int? _total;

  @override
  void initState() {
    super.initState();
    _load();
    _search.addListener(_onSearchChanged);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _onSearchChanged() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), _load);
  }

  Future<void> _load() async {
    if (!widget.user.can('student.read')) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final response = asJsonMap(
        await widget.api.get(
          'students',
          query: {
            'page': '1',
            'pageSize': '30',
            if (_search.text.trim().isNotEmpty) 'search': _search.text.trim(),
          },
        ),
      );
      if (!mounted) return;
      setState(() {
        _students = asJsonList(response['items']);
        _total = asJsonMap(response['pagination'])['total'] as int?;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (mounted)
        setState(() {
          _error = error.message;
          _loading = false;
        });
    }
  }

  Future<void> _open(JsonMap student) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => StaffStudentScreen(
          api: widget.api,
          user: widget.user,
          studentStub: student,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canCollect = widget.user.can('payment.collect');
    final title = widget.feeSearch ? 'Collect fees' : 'Students';
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 54, 20, 28),
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(
            widget.feeSearch
                ? 'Search a permitted student to review outstanding items.'
                : 'Search by name, admission number, phone, or email.',
            style: const TextStyle(color: Color(0xFF737373), fontSize: 13),
          ),
          const SizedBox(height: 18),
          TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search students',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: _search.text.isEmpty
                  ? null
                  : IconButton(
                      onPressed: () => _search.clear(),
                      tooltip: 'Clear search',
                      icon: const Icon(Icons.close_rounded),
                    ),
            ),
          ),
          const SizedBox(height: 14),
          if (_total != null)
            Text(
              'Showing ${_students.length} of $_total permitted records',
              style: const TextStyle(fontSize: 11, color: Color(0xFF737373)),
            ),
          if (_error != null) ...[
            const SizedBox(height: 14),
            _MessageCard(message: _error!, onRetry: _load),
          ],
          if (_loading && _students.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (!_loading && _students.isEmpty && _error == null)
            const Padding(
              padding: EdgeInsets.only(top: 18),
              child: _UnavailableCard(
                title: 'No students found',
                message: 'Try a different name or registration number.',
                icon: Icons.person_search_outlined,
              ),
            ),
          ..._students.map(
            (student) => Card(
              margin: const EdgeInsets.only(top: 9),
              child: InkWell(
                borderRadius: BorderRadius.circular(20),
                onTap: () => _open(student),
                child: Padding(
                  padding: const EdgeInsets.all(15),
                  child: Row(
                    children: [
                      const CircleAvatar(
                        backgroundColor: Color(0xFFECFDF5),
                        child: Icon(
                          Icons.person_outline_rounded,
                          color: Color(0xFF047857),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _studentName(student),
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Admission no. ${student['admissionNumber'] ?? '—'}',
                              style: const TextStyle(
                                color: Color(0xFF737373),
                                fontSize: 12,
                              ),
                            ),
                            if (student['primaryUnitId'] != null)
                              Text(
                                'Academic group assigned',
                                style: const TextStyle(
                                  color: Color(0xFF737373),
                                  fontSize: 11,
                                ),
                              ),
                          ],
                        ),
                      ),
                      if (widget.feeSearch && canCollect)
                        const Icon(
                          Icons.arrow_forward_ios_rounded,
                          size: 15,
                          color: Color(0xFF737373),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class StaffFeeCenterScreen extends StatelessWidget {
  const StaffFeeCenterScreen({
    super.key,
    required this.api,
    required this.user,
  });
  final WaslApi api;
  final SessionUser user;
  @override
  Widget build(BuildContext context) {
    if (!user.can('student.read') || !user.can('payment.collect')) {
      return const _PageMessage(
        title: 'Fee collection',
        message:
            'Your role needs both student-read and payment-collection permissions to use this feature.',
        icon: Icons.lock_outline_rounded,
      );
    }
    return StudentSearchScreen(api: api, user: user, feeSearch: true);
  }
}

class StaffStudentScreen extends StatefulWidget {
  const StaffStudentScreen({
    super.key,
    required this.api,
    required this.user,
    required this.studentStub,
  });
  final WaslApi api;
  final SessionUser user;
  final JsonMap studentStub;
  @override
  State<StaffStudentScreen> createState() => _StaffStudentScreenState();
}

class _StaffStudentScreenState extends State<StaffStudentScreen> {
  JsonMap? _student;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final student = asJsonMap(
        await widget.api.get('students/${widget.studentStub['id']}'),
      );
      if (mounted)
        setState(() {
          _student = student;
          _loading = false;
        });
    } on ApiException catch (error) {
      if (mounted)
        setState(() {
          _error = error.message;
          _loading = false;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final student = _student ?? widget.studentStub;
    final name = _studentName(student);
    final canCollect = widget.user.can('payment.collect');
    return Scaffold(
      appBar: AppBar(title: const Text('Student record')),
      body: _loading && _student == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (_error != null)
                  _MessageCard(message: _error!, onRetry: _load),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const CircleAvatar(
                              radius: 24,
                              backgroundColor: Color(0xFFECFDF5),
                              child: Icon(
                                Icons.person_outline_rounded,
                                color: Color(0xFF047857),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    name,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w800,
                                      fontSize: 18,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    'Admission no. ${student['admissionNumber'] ?? '—'}',
                                    style: const TextStyle(
                                      color: Color(0xFF737373),
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const Divider(height: 28),
                        _StaffInfo(
                          label: 'Status',
                          value: paymentStatusLabel(student['status']),
                        ),
                        if (student['rollNumber'] != null) ...[
                          const SizedBox(height: 12),
                          _StaffInfo(
                            label: 'Roll no.',
                            value: student['rollNumber'].toString(),
                          ),
                        ],
                        if (student['primaryUnitId'] != null) ...[
                          const SizedBox(height: 12),
                          _StaffInfo(
                            label: 'Academic unit',
                            value: 'Unit assigned in Wasl',
                          ),
                        ],
                        if (student['phone'] != null) ...[
                          const SizedBox(height: 12),
                          _StaffInfo(
                            label: 'Phone',
                            value: student['phone'].toString(),
                          ),
                        ],
                        if (student['email'] != null) ...[
                          const SizedBox(height: 12),
                          _StaffInfo(
                            label: 'Email',
                            value: student['email'].toString(),
                          ),
                        ],
                        if (student['city'] != null) ...[
                          const SizedBox(height: 12),
                          _StaffInfo(
                            label: 'City',
                            value: student['city'].toString(),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                if (canCollect)
                  FilledButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => StaffCollectionScreen(
                          api: widget.api,
                          user: widget.user,
                          student: student,
                        ),
                      ),
                    ),
                    icon: const Icon(Icons.add_card_rounded),
                    label: const Text('Collect a fee'),
                  ),
                const SizedBox(height: 14),
                const _UnavailableCard(
                  title: 'Attendance',
                  message:
                      'Attendance records and attendance editing are not present in the current Wasl API.',
                  icon: Icons.event_busy_outlined,
                ),
              ],
            ),
    );
  }
}

class _CountCard extends StatelessWidget {
  const _CountCard({
    required this.count,
    required this.label,
    required this.icon,
    required this.loading,
  });
  final int? count;
  final String label;
  final IconData icon;
  final bool loading;
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: const Color(0xFFECFDF5),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, color: const Color(0xFF047857)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  label,
                  style:
                      const TextStyle(fontSize: 12, color: Color(0xFF737373)),
                ),
              ),
              if (loading)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                Text(
                  count?.toString() ?? '—',
                  style: const TextStyle(
                      fontSize: 21, fontWeight: FontWeight.w800),
                ),
            ],
          ),
        ),
      );
}

class _OutstandingCard extends StatelessWidget {
  const _OutstandingCard({required this.rows, required this.loading});
  final List<JsonMap> rows;
  final bool loading;
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Row(children: [
              Icon(Icons.account_balance_wallet_outlined,
                  color: Color(0xFF047857)),
              SizedBox(width: 9),
              Expanded(
                  child: Text('Outstanding fee summary',
                      style: TextStyle(fontWeight: FontWeight.w700))),
            ]),
            const SizedBox(height: 11),
            if (loading)
              const LinearProgressIndicator(minHeight: 2)
            else if (rows.isEmpty)
              const Text('No open fee balances were returned for this scope.',
                  style: TextStyle(fontSize: 12, color: Color(0xFF737373)))
            else
              ...rows.map((row) => Padding(
                    padding: const EdgeInsets.only(top: 7),
                    child: Row(children: [
                      Expanded(
                          child: Text(
                              '${row['openCount'] ?? 0} open · ${row['overdueCount'] ?? 0} overdue',
                              style: const TextStyle(
                                  fontSize: 12, color: Color(0xFF737373)))),
                      Text(
                          formatMoney(row['outstanding']?.toString(),
                              currency: row['currency']?.toString() ?? 'INR'),
                          style: const TextStyle(
                              fontSize: 13, fontWeight: FontWeight.w800)),
                    ]),
                  )),
          ]),
        ),
      );
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, color: const Color(0xFF047857)),
                const SizedBox(height: 14),
                Text(
                  title,
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style:
                      const TextStyle(fontSize: 10, color: Color(0xFF737373)),
                ),
              ],
            ),
          ),
        ),
      );
}

class _RecentPayment extends StatelessWidget {
  const _RecentPayment({required this.payment, required this.timezone});
  final JsonMap payment;
  final String timezone;
  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              const Icon(Icons.receipt_long_outlined, color: Color(0xFF047857)),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      payment['paymentNumber']?.toString() ?? 'Payment',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${formatIndianDate(payment['paidAt'], timezone: timezone)} · ${paymentStatusLabel(payment['status'])}',
                      style: const TextStyle(
                        fontSize: 10,
                        color: Color(0xFF737373),
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                formatMoney(payment['amount']?.toString(),
                    currency: payment['currency']?.toString() ?? 'INR'),
                style:
                    const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
              ),
            ],
          ),
        ),
      );
}

class _MessageCard extends StatelessWidget {
  const _MessageCard({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Card(
        color: const Color(0xFFFFF3F1),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  message,
                  style:
                      const TextStyle(fontSize: 12, color: Color(0xFF8D2D26)),
                ),
              ),
              IconButton(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded),
                tooltip: 'Retry',
              ),
            ],
          ),
        ),
      );
}

class _UnavailableCard extends StatelessWidget {
  const _UnavailableCard({
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
          padding: const EdgeInsets.all(15),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: const Color(0xFF9A6B1D)),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      message,
                      style: const TextStyle(
                        fontSize: 11,
                        height: 1.4,
                        color: Color(0xFF737373),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
}

class _PageMessage extends StatelessWidget {
  const _PageMessage({
    required this.title,
    required this.message,
    required this.icon,
  });
  final String title;
  final String message;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: Padding(
          padding: const EdgeInsets.all(22),
          child: _UnavailableCard(title: title, message: message, icon: icon),
        ),
      );
}

class _StaffInfo extends StatelessWidget {
  const _StaffInfo({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(fontSize: 12, color: Color(0xFF737373)),
            ),
          ),
          Expanded(
            child: Text(
              value,
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
