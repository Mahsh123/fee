import 'dart:async';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../api/wasl_api.dart';
import '../models.dart';

class GatewayCheckoutScreen extends StatefulWidget {
  const GatewayCheckoutScreen({
    super.key,
    required this.api,
    required this.orderId,
    required this.orderNumber,
    required this.checkout,
  });
  final WaslApi api;
  final String orderId;
  final String orderNumber;
  final JsonMap checkout;

  @override
  State<GatewayCheckoutScreen> createState() => _GatewayCheckoutScreenState();
}

class _GatewayCheckoutScreenState extends State<GatewayCheckoutScreen> {
  WebViewController? _controller;
  Timer? _pollTimer;
  String _serverStatus = 'INITIATED';
  String? _error;
  bool _checking = false;

  bool get _isFinal => const {
        'SUCCESS',
        'FAILED',
        'CANCELLED',
        'EXPIRED',
      }.contains(_serverStatus);
  bool get _confirmed => _serverStatus == 'SUCCESS';

  @override
  void initState() {
    super.initState();
    final html = _checkoutHtml(widget.checkout, widget.orderNumber);
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(
        NavigationDelegate(
          onWebResourceError: (error) {
            if (error.isForMainFrame == true && mounted)
              setState(
                () => _error =
                    'The provider checkout page could not be opened. Check your connection or contact the Madrasa office.',
              );
          },
        ),
      )
      ..loadHtmlString(html, baseUrl: widget.api.workspaceUri.toString());
    _controller = controller;
    _checkStatus();
    _pollTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _checkStatus(),
    );
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _checkStatus() async {
    if (_checking || _isFinal) return;
    _checking = true;
    try {
      final order = asJsonMap(
        await widget.api.get('gateways/orders/${widget.orderId}'),
      );
      if (!mounted) return;
      final status = order['status']?.toString().toUpperCase() ?? 'INITIATED';
      setState(() {
        _serverStatus = status;
        _error = null;
      });
      if (_isFinal) _pollTimer?.cancel();
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      _checking = false;
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(
            widget.orderNumber.isEmpty ? 'Secure checkout' : widget.orderNumber,
          ),
          actions: [
            IconButton(
              tooltip: 'Check Wasl status',
              onPressed: _checking ? null : _checkStatus,
              icon: const Icon(Icons.sync_rounded),
            ),
          ],
        ),
        body: Column(
          children: [
            if (_confirmed)
              const _CheckoutStatus(
                color: Color(0xFFECFDF5),
                icon: Icons.check_circle_rounded,
                text: 'Wasl confirmed this payment.',
              ),
            if (_serverStatus == 'FAILED' ||
                _serverStatus == 'CANCELLED' ||
                _serverStatus == 'EXPIRED')
              const _CheckoutStatus(
                color: Color(0xFFFFF3F1),
                icon: Icons.error_outline_rounded,
                text:
                    'Wasl has not recorded a successful payment for this order.',
              ),
            if (_error != null)
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                child: Text(
                  _error!,
                  style:
                      const TextStyle(fontSize: 11, color: Color(0xFF8D2D26)),
                ),
              ),
            Expanded(
              child: _controller == null
                  ? const Center(child: CircularProgressIndicator())
                  : WebViewWidget(controller: _controller!),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
                child: Column(
                  children: [
                    Text(
                      _confirmed
                          ? 'Your balance will refresh when you return.'
                          : 'Payment state: ${_serverStatus.toLowerCase()}. Wasl checks the provider result.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Color(0xFF737373),
                        fontSize: 11,
                      ),
                    ),
                    const SizedBox(height: 8),
                    FilledButton(
                      onPressed: () => Navigator.of(context).pop(_confirmed),
                      child: Text(
                          _confirmed ? 'Return to fees' : 'Close checkout'),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
}

class _CheckoutStatus extends StatelessWidget {
  const _CheckoutStatus({
    required this.color,
    required this.icon,
    required this.text,
  });
  final Color color;
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        color: color,
        padding: const EdgeInsets.all(12),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 18, color: const Color(0xFF047857)),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                text,
                style:
                    const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      );
}

String _checkoutHtml(JsonMap checkout, String orderNumber) {
  final mode = checkout['mode']?.toString().toUpperCase();
  if (mode == 'MOCK') {
    return _htmlShell(
      '<main><h2>Test gateway</h2><p>This workspace is using the non-capturing test gateway. No payment will be marked successful here.</p></main>',
    );
  }
  if (mode == 'REDIRECT' && checkout['url'] is String) {
    final url = Uri.tryParse(checkout['url'].toString());
    if (url == null || url.scheme != 'https')
      return _checkoutError('The provider returned an invalid checkout link.');
    final encoded = _htmlEscape(url.toString());
    return _htmlShell(
      '<main><h2>Connecting to payment provider…</h2><p>If the page does not continue, open the link below.</p><p><a href="$encoded">Continue to secure checkout</a></p></main><script>location.replace("${_jsString(url.toString())}")</script>',
    );
  }
  if (mode == 'FORM_POST' &&
      checkout['url'] is String &&
      checkout['fields'] is Map) {
    final url = Uri.tryParse(checkout['url'].toString());
    if (url == null || url.scheme != 'https')
      return _checkoutError('The provider returned an invalid checkout link.');
    final fields = asJsonMap(checkout['fields']);
    final inputs = fields.entries
        .map(
          (entry) =>
              '<input type="hidden" name="${_htmlEscape(entry.key)}" value="${_htmlEscape(entry.value.toString())}">',
        )
        .join();
    return _htmlShell(
      '<main><h2>Connecting to payment provider…</h2><form id="payment" method="post" action="${_htmlEscape(url.toString())}">$inputs</form><script>document.getElementById("payment").submit()</script></main>',
    );
  }
  if (mode == 'RAZORPAY' &&
      checkout['keyId'] != null &&
      checkout['orderId'] != null &&
      checkout['amount'] != null &&
      checkout['currency'] != null) {
    final key = _jsString(checkout['keyId'].toString());
    final providerOrder = _jsString(checkout['orderId'].toString());
    final amount = _jsString(checkout['amount'].toString());
    final currency = _jsString(checkout['currency'].toString());
    final callback = checkout['callbackUrl'] == null
        ? ''
        : ', callback_url: "${_jsString(checkout['callbackUrl'].toString())}", redirect: true';
    final title = _jsString(
      orderNumber.isEmpty ? 'Wasl Madrasa' : 'Wasl Madrasa · $orderNumber',
    );
    return _htmlShell(
      '<main><h2>Opening secure checkout…</h2><p>Complete payment with the provider, then wait for Wasl to confirm it.</p><button id="retry">Open checkout</button></main><script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>function start(){if(!window.Razorpay){document.body.insertAdjacentHTML("beforeend","<p>Provider checkout could not load. Check your connection.</p>");return;}var r=new Razorpay({key:"$key",order_id:"$providerOrder",amount:"$amount",currency:"$currency",name:"$title",description:"Fee payment"$callback,modal:{ondismiss:function(){}}});r.open();}document.getElementById("retry").onclick=start;setTimeout(start,500);</script>',
    );
  }
  if (mode == 'CASHFREE' && checkout['paymentSessionId'] != null) {
    final session = _jsString(checkout['paymentSessionId'].toString());
    final env = checkout['environment']?.toString().toUpperCase() == 'LIVE'
        ? 'production'
        : 'sandbox';
    return _htmlShell(
      '<main><h2>Opening secure checkout…</h2><p>Complete payment with the provider, then wait for Wasl to confirm it.</p><button id="retry">Open checkout</button></main><script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script><script>async function start(){if(!window.Cashfree){document.body.insertAdjacentHTML("beforeend","<p>Provider checkout could not load. Check your connection.</p>");return;}try{var c=Cashfree({mode:"$env"});await c.checkout({paymentSessionId:"$session",redirectTarget:"_self"});}catch(e){document.body.insertAdjacentHTML("beforeend","<p>Checkout could not be opened. Try again or contact the Madrasa office.</p>");}}document.getElementById("retry").onclick=start;setTimeout(start,500);</script>',
    );
  }
  return _checkoutError(
    'This provider returned a checkout format that the Wasl mobile app does not support. No payment is marked successful.',
  );
}

String _htmlShell(String content) =>
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>body{font-family:system-ui,-apple-system,sans-serif;background:#f7faf8;color:#171717;margin:0;padding:24px}main{max-width:480px;margin:28px auto;background:white;border:1px solid #e8efeb;border-radius:20px;padding:22px;line-height:1.5}h2{font-size:18px;color:#064e3b}p{font-size:13px;color:#525252}button{background:#047857;color:white;border:0;border-radius:12px;padding:14px 18px;font-weight:700}</style></head><body>$content</body></html>';
String _checkoutError(String text) => _htmlShell(
      '<main><h2>Checkout unavailable</h2><p>${_htmlEscape(text)}</p></main>',
    );
String _htmlEscape(String value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
String _jsString(String value) => value
    .replaceAll(r'\', r'\\')
    .replaceAll('"', r'\"')
    .replaceAll("'", r"\'")
    .replaceAll('\n', r'\n')
    .replaceAll('\r', r'\r');
