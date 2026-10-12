import 'dart:math';

import 'package:flutter/material.dart';

import '../api/wasl_api.dart';
import '../formatting.dart';
import '../models.dart';
import 'gateway_checkout_screen.dart';

class OnlinePaymentScreen extends StatefulWidget {
  const OnlinePaymentScreen({
    super.key,
    required this.api,
    required this.user,
    required this.student,
    required this.methods,
  });
  final WaslApi api;
  final SessionUser user;
  final JsonMap student;
  final List<JsonMap> methods;

  @override
  State<OnlinePaymentScreen> createState() => _OnlinePaymentScreenState();
}

class _OnlinePaymentScreenState extends State<OnlinePaymentScreen> {
  List<JsonMap> _items = const [];
  String? _methodId;
  String? _currency;
  String? _error;
  bool _loading = true;
  bool _starting = false;
  String _idempotencyKey = _uuid();

  bool get _parentPayer =>
      widget.user.roles.contains('PARENT') && widget.user.guardianId != null;
  BigInt get _balance => _items.fold<BigInt>(
        BigInt.zero,
        (sum, item) => sum + moneyUnits(item['outstandingAmount']?.toString()),
      );
  JsonMap? get _method {
    final entries = widget.methods.where(
      (method) => method['id']?.toString() == _methodId,
    );
    return entries.isEmpty ? null : entries.first;
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = asJsonList(
        await widget.api.get(
          'payments/students/${widget.student['id']}/open-items',
          query: {
            'payerType': _parentPayer ? 'PARENT' : 'STUDENT',
            if (_parentPayer) 'payerGuardianId': widget.user.guardianId!,
          },
        ),
      );
      if (!mounted) return;
      setState(() {
        _items = items;
        _currency = items.isEmpty
            ? 'INR'
            : asJsonMap(items.first['demand'])['currency']?.toString() ?? 'INR';
        final usable = widget.methods
            .where(
              (method) =>
                  method['active'] != false &&
                  method['enabledForOnline'] == true,
            )
            .toList();
        _methodId = firstOrNull(usable)?['id']?.toString();
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

  Future<void> _startCheckout() async {
    final method = _method;
    if (!widget.user.can('payment.collect') ||
        method == null ||
        _items.isEmpty ||
        _balance <= BigInt.zero) {
      setState(
        () => _error =
            'No payable balance or authorised online method is available for this profile.',
      );
      return;
    }
    setState(() {
      _starting = true;
      _error = null;
    });
    try {
      final parent = _parentPayer;
      final response = asJsonMap(
        await widget.api.post(
          'gateways/orders',
          body: {
            'idempotencyKey': _idempotencyKey,
            'studentId': widget.student['id'],
            'methodId': method['id'],
            'amount': moneyString(_balance),
            'demandItemIds':
                _items.map((item) => item['id']).whereType<String>().toList(),
            'payerType': parent ? 'PARENT' : 'STUDENT',
            if (parent) 'payerGuardianId': widget.user.guardianId,
            if (widget.user.phone?.isNotEmpty == true)
              'payerPhone': widget.user.phone,
            if (widget.user.email.isNotEmpty) 'payerEmail': widget.user.email,
          },
        ),
      );
      final status = response['status']?.toString().toUpperCase();
      final checkout = asJsonMap(response['checkout']);
      final orderId = response['orderId']?.toString();
      if (orderId == null || orderId.isEmpty)
        throw ApiException(
          response['message']?.toString() ??
              'The Wasl API did not return a payment order.',
        );
      if (status == 'FAILED')
        throw ApiException(
          response['message']?.toString() ??
              'Wasl could not start checkout. Try again or contact the Madrasa office.',
        );
      if (checkout.isEmpty)
        throw ApiException(
          'Wasl created order ${response['orderNumber'] ?? ''}, but did not return a checkout session. Check its status before retrying.',
        );
      if (!mounted) return;
      setState(() => _starting = false);
      final confirmed = await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          builder: (_) => GatewayCheckoutScreen(
            api: widget.api,
            orderId: orderId,
            orderNumber: response['orderNumber']?.toString() ?? '',
            checkout: checkout,
          ),
        ),
      );
      if (confirmed == true && mounted) Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (mounted)
        setState(() {
          _error = error.message;
          _starting = false;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = [
      widget.student['firstName'],
      widget.student['middleName'],
      widget.student['lastName'],
    ].whereType<String>().where((part) => part.trim().isNotEmpty).join(' ');
    final usableMethods = widget.methods
        .where(
          (method) =>
              method['active'] != false && method['enabledForOnline'] == true,
        )
        .toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Pay online')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(17),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          'Admission no. ${widget.student['admissionNumber'] ?? '—'}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: Color(0xFF737373),
                          ),
                        ),
                        const Divider(height: 26),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'Amount due',
                              style: TextStyle(color: Color(0xFF737373)),
                            ),
                            Text(
                              formatMoney(
                                moneyString(_balance),
                                currency: _currency ?? 'INR',
                              ),
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                fontSize: 19,
                                color: Color(0xFF064E3B),
                              ),
                            ),
                          ],
                        ),
                        Text(
                          '${_items.length} outstanding fee item${_items.length == 1 ? '' : 's'}',
                          style: const TextStyle(
                            fontSize: 11,
                            color: Color(0xFF737373),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                if (_items.isEmpty)
                  const _PayMessage(
                    message:
                        'There are no online-payable fee items for this student.',
                    isError: false,
                  )
                else if (usableMethods.isEmpty)
                  const _PayMessage(
                    message:
                        'No active online payment method is configured for this workspace.',
                    isError: false,
                  )
                else ...[
                  DropdownButtonFormField<String>(
                    initialValue: _methodId,
                    decoration: const InputDecoration(
                      labelText: 'Payment method',
                    ),
                    items: usableMethods
                        .map(
                          (method) => DropdownMenuItem(
                            value: method['id']?.toString(),
                            child: Text(
                              method['name']?.toString() ??
                                  method['kind']?.toString() ??
                                  'Online payment',
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: _starting
                        ? null
                        : (value) => setState(() {
                              _methodId = value;
                              _idempotencyKey = _uuid();
                              _error = null;
                            }),
                  ),
                  const SizedBox(height: 15),
                  const _PayMessage(
                    message:
                        'Wasl will verify payment status with the configured provider. Leaving its checkout page or seeing a success message there does not update your fee balance until Wasl confirms the transaction.',
                    isError: false,
                  ),
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    onPressed: _starting ? null : _startCheckout,
                    icon: _starting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.lock_outline_rounded),
                    label: Text(
                      _starting
                          ? 'Starting secure checkout…'
                          : 'Continue to payment',
                    ),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 14),
                  _PayMessage(message: _error!, isError: true),
                ],
              ],
            ),
    );
  }
}

String _uuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex =
      bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

class _PayMessage extends StatelessWidget {
  const _PayMessage({required this.message, required this.isError});
  final String message;
  final bool isError;
  @override
  Widget build(BuildContext context) => Container(
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
                  color: isError
                      ? const Color(0xFF8D2D26)
                      : const Color(0xFF456357),
                  fontSize: 12,
                  height: 1.45,
                ),
              ),
            ),
          ],
        ),
      );
}
