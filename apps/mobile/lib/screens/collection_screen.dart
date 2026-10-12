import 'dart:math';

import 'package:flutter/material.dart';

import '../api/wasl_api.dart';
import '../formatting.dart';
import '../models.dart';
import 'receipt_screen.dart';

class StaffCollectionScreen extends StatefulWidget {
  const StaffCollectionScreen({
    super.key,
    required this.api,
    required this.user,
    required this.student,
  });
  final WaslApi api;
  final SessionUser user;
  final JsonMap student;

  @override
  State<StaffCollectionScreen> createState() => _StaffCollectionScreenState();
}

class _StaffCollectionScreenState extends State<StaffCollectionScreen> {
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _instrument = TextEditingController();
  List<JsonMap> _items = const [];
  List<JsonMap> _methods = const [];
  List<JsonMap> _guardians = const [];
  final Set<String> _selectedItems = {};
  String? _methodId;
  String _payerKey = 'STUDENT';
  String? _currency;
  String? _error;
  String? _notice;
  bool _loading = true;
  bool _submitting = false;
  bool _collectionFinalized = false;
  String? _pendingIdempotencyKey;
  JsonMap? _pendingCollectionBody;
  JsonMap? _recentReceipt;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      final studentId = widget.student['id']?.toString() ?? '';
      final pending = await widget.api.readPendingManualCollection(
        widget.user.id,
        studentId,
      );
      if (pending != null &&
          pending['studentId']?.toString() == studentId &&
          pending['idempotencyKey']?.toString().isNotEmpty == true) {
        _pendingCollectionBody = pending;
        _pendingIdempotencyKey = pending['idempotencyKey']?.toString();
        final guardianId = pending['payerGuardianId']?.toString();
        _payerKey = pending['payerType'] == 'PARENT' && guardianId != null
            ? 'PARENT:$guardianId'
            : 'STUDENT';
        _currency = pending['currency']?.toString();
        _amount.text = pending['amount']?.toString() ?? '';
        _reference.text = pending['referenceNumber']?.toString() ?? '';
        _instrument.text = pending['instrumentNumber']?.toString() ?? '';
        _methodId = pending['methodId']?.toString();
        _selectedItems.addAll(
          asJsonList(pending['demandItemIds'])
              .map((id) => id.toString())
              .where((id) => id.isNotEmpty),
        );
      } else if (pending != null) {
        await widget.api.clearPendingManualCollection(
          widget.user.id,
          studentId,
        );
      }
      await _load();
      if (_pendingCollectionBody != null && mounted) {
        setState(() {
          _notice =
              'A previous collection is waiting for confirmation. Retry the saved request to safely check its result.';
        });
      }
    } on Exception {
      if (mounted) {
        setState(() {
          _error =
              'A saved collection request could not be checked safely. Reopen this screen when secure storage is available.';
          _loading = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    _instrument.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notice = null;
    });
    try {
      final guardianId =
          _payerKey == 'STUDENT' ? null : _payerKey.substring('PARENT:'.length);
      final results = await Future.wait<Object?>([
        widget.api.get(
          'payments/students/${widget.student['id']}/open-items',
          query: {
            'payerType': guardianId == null ? 'STUDENT' : 'PARENT',
            if (guardianId != null) 'payerGuardianId': guardianId,
          },
        ),
        widget.api.get('payment-methods'),
        if (widget.user.can('guardian.read'))
          widget.api.get('students/${widget.student['id']}/guardians'),
      ]);
      final items = asJsonList(results[0]);
      final methods = asJsonList(results[1])
          .where(
            (method) =>
                method['active'] != false && method['enabledForManual'] == true,
          )
          .toList();
      final guardians = widget.user.can('guardian.read')
          ? asJsonList(results[2])
          : const <JsonMap>[];
      final selected = items
          .map((item) => item['id']?.toString())
          .whereType<String>()
          .toSet();
      final currency = items.isEmpty
          ? null
          : asJsonMap(items.first['demand'])['currency']?.toString();
      final pending = _pendingCollectionBody;
      final pendingItems = asJsonList(pending?['demandItemIds'])
          .map((id) => id.toString())
          .where((id) => id.isNotEmpty)
          .toSet();
      final preferredMethod = pending?['methodId']?.toString() ?? _methodId;
      if (!mounted) return;
      setState(() {
        _items = items;
        _methods = methods;
        _guardians = guardians;
        _selectedItems
          ..clear()
          ..addAll(pending == null ? selected : pendingItems);
        _currency = pending?['currency']?.toString() ?? currency;
        _methodId = methods.any(
          (method) => method['id']?.toString() == preferredMethod,
        )
            ? preferredMethod
            : firstOrNull(methods)?['id']?.toString();
        _amount.text =
            pending?['amount']?.toString() ?? moneyString(_selectedBalance);
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

  BigInt get _selectedBalance => _items
      .where((item) => _selectedItems.contains(item['id']?.toString()))
      .fold<BigInt>(
        BigInt.zero,
        (total, item) =>
            total + moneyUnits(item['outstandingAmount']?.toString()),
      );

  JsonMap? get _selectedMethod {
    final matches = _methods.where(
      (method) => method['id']?.toString() == _methodId,
    );
    return matches.isEmpty ? null : matches.first;
  }

  void _toggleItem(String id, bool selected) {
    setState(() {
      if (selected)
        _selectedItems.add(id);
      else
        _selectedItems.remove(id);
      _amount.text = moneyString(_selectedBalance);
    });
  }

  Future<void> _selectPayer(String? value) async {
    if (value == null ||
        value == _payerKey ||
        _submitting ||
        _pendingIdempotencyKey != null) {
      return;
    }
    setState(() {
      _payerKey = value;
      _selectedItems.clear();
      _amount.clear();
      _error = null;
      _recentReceipt = null;
    });
    await _load();
  }

  JsonMap? get _selectedGuardian {
    if (_payerKey == 'STUDENT') return null;
    final id = _payerKey.substring('PARENT:'.length);
    final matches =
        _guardians.where((guardian) => guardian['id']?.toString() == id);
    return matches.isEmpty ? null : matches.first;
  }

  Future<void> _submit() async {
    if (_collectionFinalized || _submitting) return;
    if (!widget.user.can('payment.collect')) {
      setState(
        () => _error = 'Your role does not have payment-collection permission.',
      );
      return;
    }
    final savedRequest = _pendingCollectionBody;
    final JsonMap request;
    if (savedRequest != null) {
      request = savedRequest;
    } else {
      final method = _selectedMethod;
      final amountUnits = moneyUnits(_amount.text);
      if (method == null || _selectedItems.isEmpty) {
        setState(
          () => _error =
              'Select at least one outstanding fee and a payment method.',
        );
        return;
      }
      if (amountUnits <= BigInt.zero || amountUnits > _selectedBalance) {
        setState(
          () => _error =
              'Enter an amount greater than zero and no higher than the selected outstanding balance.',
        );
        return;
      }
      if (method['requiresReference'] == true &&
          _reference.text.trim().isEmpty) {
        setState(
          () => _error = 'This payment method requires a reference number.',
        );
        return;
      }
      if (method['requiresInstrument'] == true &&
          _instrument.text.trim().isEmpty) {
        setState(
          () => _error = 'This payment method requires an instrument number.',
        );
        return;
      }
      final guardian = _selectedGuardian;
      request = {
        'idempotencyKey': _newUuid(),
        'studentId': widget.student['id'],
        'methodId': method['id'],
        'amount': _amount.text.trim(),
        'currency': _currency,
        'demandItemIds': _selectedItems.toList(),
        'payerType': guardian == null ? 'STUDENT' : 'PARENT',
        if (guardian != null) 'payerGuardianId': guardian['id'],
        if (guardian != null)
          'payerName': [guardian['firstName'], guardian['lastName']]
              .whereType<String>()
              .where((part) => part.trim().isNotEmpty)
              .join(' '),
        if (guardian?['phone'] != null) 'payerPhone': guardian!['phone'],
        if (guardian?['email'] != null) 'payerEmail': guardian!['email'],
        if (_reference.text.trim().isNotEmpty)
          'referenceNumber': _reference.text.trim(),
        if (_instrument.text.trim().isNotEmpty)
          'instrumentNumber': _instrument.text.trim(),
      };
    }
    setState(() {
      _submitting = true;
      _error = null;
      _notice = null;
    });
    try {
      if (savedRequest == null) {
        await widget.api.savePendingManualCollection(
          widget.user.id,
          widget.student['id'].toString(),
          request,
        );
        _pendingCollectionBody = request;
        _pendingIdempotencyKey = request['idempotencyKey'].toString();
      }
      final result = asJsonMap(
        await widget.api.post(
          'payments/manual',
          body: request,
        ),
      );
      if (result['requiresApproval'] == true) {
        setState(() {
          _notice =
              'This collection is awaiting an authorised approval. No receipt has been issued yet.';
          _collectionFinalized = true;
          _submitting = false;
        });
        return;
      }
      final receipt = asJsonMap(result['receipt']);
      final payment = asJsonMap(result['payment']);
      final receiptNumber = receipt['receiptNumber']?.toString() ??
          payment['receiptNumber']?.toString();
      if (receipt['id'] != null || receiptNumber != null) {
        await _clearSavedRequest();
        setState(() {
          _pendingCollectionBody = null;
          _recentReceipt = receipt;
          _collectionFinalized = true;
          _notice = receiptNumber == null
              ? 'Wasl recorded the collection and issued a receipt.'
              : 'Wasl recorded the collection. Receipt $receiptNumber';
          _submitting = false;
        });
        await _showReceiptDialog(receipt, receiptNumber);
        await _load();
      } else {
        setState(() {
          _error =
              'Wasl returned no receipt for this collection. Check the payment record before retrying.';
          _submitting = false;
        });
      }
    } on ApiException catch (error) {
      final code = error.statusCode;
      final definitiveClientError = code != null &&
          code >= 400 &&
          code < 500 &&
          !{408, 409, 429}.contains(code);
      if (definitiveClientError) await _clearSavedRequest();
      if (mounted)
        setState(() {
          _error = error.message;
          if (definitiveClientError) {
            _pendingCollectionBody = null;
            _pendingIdempotencyKey = null;
          }
          _submitting = false;
        });
    } catch (_) {
      if (mounted)
        setState(() {
          _error = _pendingCollectionBody == null
              ? 'The request could not be saved securely, so Wasl was not sent a collection.'
              : 'Wasl has not confirmed the collection. Retry the saved request safely to avoid a duplicate.';
          _submitting = false;
        });
    }
  }

  Future<void> _clearSavedRequest() async {
    try {
      await widget.api.clearPendingManualCollection(
        widget.user.id,
        widget.student['id'].toString(),
      );
    } catch (_) {
      // A retained idempotency key is safe to retry if secure storage is busy.
    }
  }

  Future<void> _showReceiptDialog(
    JsonMap receipt,
    String? receiptNumber,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: const Icon(
          Icons.check_circle_outline_rounded,
          color: Color(0xFF047857),
          size: 34,
        ),
        title: const Text('Collection recorded'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Wasl confirmed the financial record and issued this receipt.',
            ),
            if (receiptNumber != null) ...[
              const SizedBox(height: 11),
              SelectableText(
                receiptNumber,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 18,
                ),
              ),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Done'),
          ),
          if (receipt['id'] != null)
            FilledButton.tonal(
              onPressed: () {
                Navigator.pop(dialogContext);
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => ReceiptScreen(
                      api: widget.api,
                      receiptId: receipt['id'].toString(),
                      portal: false,
                    ),
                  ),
                );
              },
              child: const Text('View receipt'),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final name = [
      widget.student['firstName'],
      widget.student['middleName'],
      widget.student['lastName'],
    ].whereType<String>().where((part) => part.trim().isNotEmpty).join(' ');
    final method = _selectedMethod;
    return Scaffold(
      appBar: AppBar(title: const Text('Collect fee')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
              children: [
                Card(
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
                        const SizedBox(width: 11),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                name,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                'Admission no. ${widget.student['admissionNumber'] ?? '—'}',
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
                  ),
                ),
                const SizedBox(height: 18),
                if (_guardians.isNotEmpty) ...[
                  DropdownButtonFormField<String>(
                    initialValue: _payerKey,
                    decoration: const InputDecoration(
                        labelText: 'Payer responsibility'),
                    items: [
                      const DropdownMenuItem(
                          value: 'STUDENT', child: Text('Student share')),
                      ..._guardians.map((guardian) {
                        final id = guardian['id']?.toString() ?? '';
                        final guardianName = [
                          guardian['firstName'],
                          guardian['lastName']
                        ]
                            .whereType<String>()
                            .where((part) => part.trim().isNotEmpty)
                            .join(' ');
                        final relation = guardian['relation']?.toString();
                        return DropdownMenuItem(
                          value: 'PARENT:$id',
                          child: Text(
                            '${guardianName.isEmpty ? 'Guardian' : guardianName}${relation == null ? '' : ' · $relation'}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        );
                      }),
                    ],
                    onChanged:
                        _pendingIdempotencyKey == null ? _selectPayer : null,
                  ),
                  const SizedBox(height: 14),
                ],
                const Text(
                  'Outstanding fee items',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 8),
                if (_items.isEmpty)
                  const _InfoCard(
                    text:
                        'There are no payable outstanding fee items for this student.',
                    icon: Icons.task_alt_rounded,
                  )
                else
                  ..._items.map((item) {
                    final id = item['id']?.toString() ?? '';
                    final demand = asJsonMap(item['demand']);
                    return Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: CheckboxListTile(
                        value: _selectedItems.contains(id),
                        onChanged: id.isEmpty ||
                                _submitting ||
                                _pendingIdempotencyKey != null
                            ? null
                            : (value) => _toggleItem(id, value == true),
                        title: Text(
                          item['name']?.toString() ??
                              item['label']?.toString() ??
                              demand['demandNumber']?.toString() ??
                              'Fee item',
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                          ),
                        ),
                        subtitle: Text(
                          'Due ${formatIndianCalendarDate(item['dueDate'] ?? demand['dueDate'])}',
                          style: const TextStyle(
                            fontSize: 11,
                            color: Color(0xFF737373),
                          ),
                        ),
                        secondary: Text(
                          formatMoney(
                            item['outstandingAmount']?.toString(),
                            currency: demand['currency']?.toString() ??
                                _currency ??
                                'INR',
                          ),
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 12,
                          ),
                        ),
                        controlAffinity: ListTileControlAffinity.leading,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 8,
                        ),
                      ),
                    );
                  }),
                if (_items.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Selected balance: ${formatMoney(moneyString(_selectedBalance), currency: _currency ?? 'INR')}',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 15),
                  TextField(
                    controller: _amount,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(
                      labelText: 'Collection amount',
                      prefixText:
                          _currency == 'INR' ? '₹ ' : '${_currency ?? ''} ',
                    ),
                    enabled: !_submitting && _pendingIdempotencyKey == null,
                  ),
                  const SizedBox(height: 15),
                  if (_methods.isEmpty)
                    const _InfoCard(
                      text:
                          'No active payment method is enabled for staff collection in Wasl.',
                      icon: Icons.payment_outlined,
                    )
                  else
                    DropdownButtonFormField<String>(
                      initialValue: _methodId,
                      decoration: const InputDecoration(
                        labelText: 'Payment method',
                      ),
                      items: _methods
                          .map(
                            (entry) => DropdownMenuItem(
                              value: entry['id']?.toString(),
                              child: Text(
                                entry['name']?.toString() ??
                                    entry['kind']?.toString() ??
                                    'Payment method',
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: _submitting || _pendingIdempotencyKey != null
                          ? null
                          : (value) => setState(() {
                                _methodId = value;
                                _error = null;
                              }),
                    ),
                  if (method?['requiresReference'] == true) ...[
                    const SizedBox(height: 14),
                    TextField(
                      controller: _reference,
                      decoration: const InputDecoration(
                        labelText: 'Transaction reference',
                      ),
                      enabled: !_submitting && _pendingIdempotencyKey == null,
                    ),
                  ],
                  if (method?['requiresInstrument'] == true) ...[
                    const SizedBox(height: 14),
                    TextField(
                      controller: _instrument,
                      decoration: const InputDecoration(
                        labelText: 'Instrument number',
                      ),
                      enabled: !_submitting && _pendingIdempotencyKey == null,
                    ),
                  ],
                  const SizedBox(height: 10),
                  const Text(
                    'Collection limits and partial-payment rules are checked again by the Wasl server.',
                    style: TextStyle(
                      fontSize: 11,
                      color: Color(0xFF737373),
                      height: 1.4,
                    ),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 14),
                  _InfoCard(
                    text: _error!,
                    icon: Icons.error_outline_rounded,
                    isError: true,
                  ),
                ],
                if (_notice != null) ...[
                  const SizedBox(height: 14),
                  _InfoCard(
                    text: _notice!,
                    icon: _notice!.contains('awaiting')
                        ? Icons.hourglass_top_rounded
                        : Icons.check_circle_outline_rounded,
                  ),
                ],
                if (_recentReceipt?['id'] != null) ...[
                  const SizedBox(height: 6),
                  OutlinedButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => ReceiptScreen(
                          api: widget.api,
                          receiptId: _recentReceipt!['id'].toString(),
                          portal: false,
                        ),
                      ),
                    ),
                    icon: const Icon(Icons.receipt_outlined),
                    label: const Text('View latest receipt'),
                  ),
                ],
                if ((_items.isNotEmpty && _methods.isNotEmpty) ||
                    _pendingCollectionBody != null) ...[
                  const SizedBox(height: 17),
                  FilledButton.icon(
                    onPressed:
                        _submitting || _collectionFinalized ? null : _submit,
                    icon: _submitting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.verified_outlined),
                    label: Text(
                      _submitting
                          ? 'Submitting to Wasl…'
                          : _pendingIdempotencyKey == null
                              ? 'Confirm collection'
                              : 'Retry same collection safely',
                    ),
                  ),
                ],
              ],
            ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.text,
    required this.icon,
    this.isError = false,
  });
  final String text;
  final IconData icon;
  final bool isError;
  @override
  Widget build(BuildContext context) => Card(
        color: isError ? const Color(0xFFFFF3F1) : null,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                icon,
                color:
                    isError ? const Color(0xFFB42318) : const Color(0xFF047857),
                size: 18,
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  text,
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.4,
                    color: isError
                        ? const Color(0xFF8D2D26)
                        : const Color(0xFF456357),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
}

String _newUuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex =
      bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
