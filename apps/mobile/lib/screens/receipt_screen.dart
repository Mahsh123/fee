import 'package:flutter/material.dart';

import '../api/wasl_api.dart';
import '../formatting.dart';
import '../models.dart';

class ReceiptScreen extends StatefulWidget {
  const ReceiptScreen({
    super.key,
    required this.api,
    required this.receiptId,
    required this.portal,
  });
  final WaslApi api;
  final String receiptId;
  final bool portal;

  @override
  State<ReceiptScreen> createState() => _ReceiptScreenState();
}

class _ReceiptScreenState extends State<ReceiptScreen> {
  JsonMap? _receipt;
  String? _error;
  bool _loading = true;

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
      final path = widget.portal
          ? 'portal/receipts/${widget.receiptId}'
          : 'receipts/${widget.receiptId}';
      final receipt = asJsonMap(await widget.api.get(path));
      if (mounted)
        setState(() {
          _receipt = receipt;
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
    final receipt = _receipt ?? const <String, dynamic>{};
    final currency = receipt['currency']?.toString() ?? 'INR';
    final lines = asJsonList(receipt['lines']);
    return Scaffold(
      appBar: AppBar(title: const Text('Receipt')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Padding(
                  padding: const EdgeInsets.all(20),
                  child: _ReceiptMessage(message: _error!, onRetry: _load),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
                  children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  width: 44,
                                  height: 44,
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFECFDF5),
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                  child: const Icon(
                                    Icons.verified_outlined,
                                    color: Color(0xFF047857),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        'Wasl receipt',
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: Color(0xFF737373),
                                        ),
                                      ),
                                      const SizedBox(height: 3),
                                      Text(
                                        receipt['receiptNumber']?.toString() ??
                                            'Receipt',
                                        style: const TextStyle(
                                          fontSize: 18,
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            const Divider(height: 30),
                            _ReceiptLine(
                              label: 'Issue date',
                              value: formatIndianCalendarDate(
                                  receipt['issueDate']),
                            ),
                            const SizedBox(height: 13),
                            _ReceiptLine(
                              label: 'Status',
                              value: paymentStatusLabel(receipt['status']),
                            ),
                            if (receipt['amountInWords'] != null) ...[
                              const SizedBox(height: 13),
                              _ReceiptLine(
                                label: 'Amount in words',
                                value: receipt['amountInWords'].toString(),
                              ),
                            ],
                            const Divider(height: 30),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text(
                                  'Total received',
                                  style: TextStyle(fontWeight: FontWeight.w700),
                                ),
                                Text(
                                  formatMoney(
                                    receipt['totalAmount']?.toString(),
                                    currency: currency,
                                  ),
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 18,
                                    color: Color(0xFF064E3B),
                                  ),
                                ),
                              ],
                            ),
                            if (receipt['balanceAfter'] != null) ...[
                              const SizedBox(height: 12),
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  const Text(
                                    'Balance after',
                                    style: TextStyle(
                                      color: Color(0xFF737373),
                                      fontSize: 12,
                                    ),
                                  ),
                                  Text(
                                    formatMoney(
                                      receipt['balanceAfter'].toString(),
                                      currency: currency,
                                    ),
                                    style: const TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'Receipt items',
                      style:
                          TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                    ),
                    const SizedBox(height: 10),
                    if (lines.isEmpty)
                      const Card(
                        child: Padding(
                          padding: EdgeInsets.all(16),
                          child: Text(
                            'The receipt has no item breakdown.',
                            style: TextStyle(
                              color: Color(0xFF737373),
                              fontSize: 12,
                            ),
                          ),
                        ),
                      )
                    else
                      ...lines.map(
                        (line) => Card(
                          margin: const EdgeInsets.only(bottom: 8),
                          child: Padding(
                            padding: const EdgeInsets.all(15),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  line['feeTypeName']?.toString() ??
                                      line['description']?.toString() ??
                                      'Fee item',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                if (line['description'] != null &&
                                    line['feeTypeName'] != null) ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    line['description'].toString(),
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: Color(0xFF737373),
                                    ),
                                  ),
                                ],
                                const SizedBox(height: 10),
                                Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    const Text(
                                      'Amount',
                                      style: TextStyle(
                                        fontSize: 11,
                                        color: Color(0xFF737373),
                                      ),
                                    ),
                                    Text(
                                      formatMoney(
                                        line['amount']?.toString(),
                                        currency: currency,
                                      ),
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                                if (line['allocatedAmount'] != null) ...[
                                  const SizedBox(height: 6),
                                  Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.spaceBetween,
                                    children: [
                                      const Text(
                                        'Applied to fees',
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: Color(0xFF737373),
                                        ),
                                      ),
                                      Text(
                                        formatMoney(
                                          line['allocatedAmount'].toString(),
                                          currency: currency,
                                        ),
                                        style: const TextStyle(fontSize: 12),
                                      ),
                                    ],
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ),
                    const SizedBox(height: 14),
                    const _ReceiptInfo(
                      text:
                          'This view uses the receipt stored by Wasl. The current receipt APIs return data only; PDF download and sharing are not available from this mobile API.',
                    ),
                  ],
                ),
    );
  }
}

class _ReceiptLine extends StatelessWidget {
  const _ReceiptLine({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 116,
            child: Text(
              label,
              style: const TextStyle(fontSize: 12, color: Color(0xFF737373)),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      );
}

class _ReceiptInfo extends StatelessWidget {
  const _ReceiptInfo({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: const Color(0xFFECFDF5),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(
              Icons.info_outline_rounded,
              size: 17,
              color: Color(0xFF047857),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                text,
                style: const TextStyle(
                  fontSize: 11,
                  color: Color(0xFF456357),
                  height: 1.4,
                ),
              ),
            ),
          ],
        ),
      );
}

class _ReceiptMessage extends StatelessWidget {
  const _ReceiptMessage({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(17),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(message, style: const TextStyle(color: Color(0xFF8D2D26))),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
}
