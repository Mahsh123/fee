import 'package:flutter/material.dart';

import '../app_config.dart';
import '../api/wasl_api.dart';
import '../models.dart';
import '../widgets/brand_mark.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.onSignedIn, this.initialMessage});

  final void Function(WaslApi api, SessionUser user, TenantBranding tenant)
      onSignedIn;
  final String? initialMessage;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  TenantBranding? _tenant;
  WaslApi? _api;
  bool _staffLogin = false;
  bool _busy = false;
  bool _obscurePassword = true;
  String? _error;
  String? _notice;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _resolveWorkspace();
    });
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<bool> _resolveWorkspace() async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final api = WaslApi.forWorkspace(waslWorkspaceUrl);
      final tenant = await api.resolveTenant();
      if (!mounted) return false;
      setState(() {
        _api = api;
        _tenant = tenant;
      });
      return true;
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
      return false;
    } on FormatException catch (error) {
      if (mounted) setState(() => _error = error.message);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signIn() async {
    if (!_formKey.currentState!.validate()) return;
    if (_tenant == null || _api == null) {
      if (!await _resolveWorkspace()) return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final api = _api!;
      final user = await api.login(_email.text, _password.text);
      if (user.tenantSlug != _tenant!.slug) {
        await api.clearSession();
        throw const ApiException(
          'This account belongs to a different Madrasa. Use an account for this app.',
          statusCode: 403,
        );
      }
      if (_staffLogin && !user.hasStaffRole) {
        await api.clearSession();
        throw const ApiException(
          'This account does not have a staff role. Choose Student / Parent Login or contact the Madrasa administrator.',
          statusCode: 403,
        );
      }
      if (!_staffLogin && (!user.hasPortalRole || user.hasStaffRole)) {
        await api.clearSession();
        throw const ApiException(
          'This account is not limited to a student or parent role. Use Staff Login or contact the Madrasa administrator.',
          statusCode: 403,
        );
      }
      if (user.mustChangePassword) {
        final changed = await _requirePasswordChange(api);
        if (!changed) {
          await api.logout();
          return;
        }
      }
      if (mounted) widget.onSignedIn(api, user, _tenant!);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _requirePasswordChange(WaslApi api) async {
    final current = TextEditingController(text: _password.text);
    final next = TextEditingController();
    final confirm = TextEditingController();
    var error = '';
    final saved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, refresh) => AlertDialog(
          title: const Text('Set a new password'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Your account requires a password update before you continue.',
              ),
              const SizedBox(height: 18),
              TextField(
                controller: current,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Current password',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: next,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'New password (12 characters minimum)',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: confirm,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Confirm new password',
                ),
              ),
              if (error.isNotEmpty) ...[
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    error,
                    style: const TextStyle(color: Color(0xFFB42318)),
                  ),
                ),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Sign out'),
            ),
            FilledButton(
              onPressed: () async {
                if (next.text.length < 12) {
                  refresh(() => error = 'Use at least 12 characters.');
                  return;
                }
                if (next.text != confirm.text) {
                  refresh(() => error = 'The passwords do not match.');
                  return;
                }
                try {
                  await api.changePassword(current.text, next.text);
                  // Password changes revoke all refresh sessions. Sign in once
                  // more so this device receives a fresh server-issued session.
                  await api.login(_email.text, next.text);
                  if (dialogContext.mounted) Navigator.pop(dialogContext, true);
                } on ApiException catch (exception) {
                  refresh(() => error = exception.message);
                }
              },
              child: const Text('Update password'),
            ),
          ],
        ),
      ),
    );
    current.dispose();
    next.dispose();
    confirm.dispose();
    if (saved != true) return false;
    setState(() => _notice = 'Password updated. You are signed in.');
    return true;
  }

  Future<void> _forgotPassword() async {
    if (_email.text.trim().isEmpty || !_email.text.contains('@')) {
      setState(
        () => _error =
            'Enter your email address first, then tap Forgot password.',
      );
      return;
    }
    if (_tenant == null || _api == null) {
      if (!await _resolveWorkspace()) return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      await _api!.post(
        'auth/forgot-password',
        body: {'email': _email.text.trim()},
      );
      if (mounted)
        setState(
          () => _notice =
              'If an account matches this address, Wasl will send password reset instructions to its registered email.',
        );
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final accent = colorFromHex(_tenant?.primaryColor, const Color(0xFF064E3B));
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth > 560;
            return Center(
              child: SingleChildScrollView(
                padding: EdgeInsets.symmetric(
                  horizontal: wide ? 32 : 22,
                  vertical: 28,
                ),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Column(
                          children: [
                            BrandMark(size: 72, tenant: _tenant),
                            const SizedBox(height: 14),
                            Text(
                              _tenant?.displayName ?? 'Madrasa',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: 26,
                                height: 1.15,
                                fontWeight: FontWeight.w800,
                                letterSpacing: -.3,
                                color: accent,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 32),
                      SegmentedButton<bool>(
                        segments: const [
                          ButtonSegment(
                            value: false,
                            label: Text('Student / Parent'),
                            icon: Icon(Icons.person_outline_rounded),
                          ),
                          ButtonSegment(
                            value: true,
                            label: Text('Staff Login'),
                            icon: Icon(Icons.badge_outlined),
                          ),
                        ],
                        selected: {_staffLogin},
                        onSelectionChanged: _busy
                            ? null
                            : (value) => setState(() {
                                  _staffLogin = value.first;
                                  _error = null;
                                }),
                        showSelectedIcon: false,
                      ),
                      const SizedBox(height: 22),
                      Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            TextFormField(
                              controller: _email,
                              keyboardType: TextInputType.emailAddress,
                              textInputAction: TextInputAction.next,
                              autocorrect: false,
                              decoration: const InputDecoration(
                                labelText: 'Email address',
                                prefixIcon: Icon(Icons.alternate_email_rounded),
                              ),
                              validator: (value) =>
                                  value == null || !value.contains('@')
                                      ? 'Enter a valid email address.'
                                      : null,
                            ),
                            const SizedBox(height: 15),
                            TextFormField(
                              controller: _password,
                              obscureText: _obscurePassword,
                              textInputAction: TextInputAction.done,
                              decoration: InputDecoration(
                                labelText: 'Password',
                                prefixIcon: const Icon(
                                  Icons.lock_outline_rounded,
                                ),
                                suffixIcon: IconButton(
                                  tooltip: _obscurePassword
                                      ? 'Show password'
                                      : 'Hide password',
                                  onPressed: () => setState(
                                    () => _obscurePassword = !_obscurePassword,
                                  ),
                                  icon: Icon(
                                    _obscurePassword
                                        ? Icons.visibility_outlined
                                        : Icons.visibility_off_outlined,
                                  ),
                                ),
                              ),
                              validator: (value) =>
                                  value == null || value.isEmpty
                                      ? 'Enter your password.'
                                      : null,
                              onFieldSubmitted: (_) => _signIn(),
                            ),
                          ],
                        ),
                      ),
                      if (_error != null ||
                          widget.initialMessage != null && _notice == null) ...[
                        const SizedBox(height: 14),
                        _MessageBox(
                          message: _error ?? widget.initialMessage!,
                          isError: true,
                        ),
                      ],
                      if (_notice != null) ...[
                        const SizedBox(height: 14),
                        _MessageBox(message: _notice!, isError: false),
                      ],
                      const SizedBox(height: 18),
                      FilledButton.icon(
                        onPressed: _busy ? null : _signIn,
                        icon: _busy
                            ? const SizedBox(
                                width: 19,
                                height: 19,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.login_rounded),
                        label: Text(_busy ? 'Please wait…' : 'Sign in'),
                      ),
                      Align(
                        alignment: Alignment.center,
                        child: TextButton(
                          onPressed: _busy ? null : _forgotPassword,
                          child: const Text('Forgot password?'),
                        ),
                      ),
                      const SizedBox(height: 22),
                      const Center(
                        child: Text(
                          'Powered by Wasl',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                            color: Color(0xFF8A938F),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _MessageBox extends StatelessWidget {
  const _MessageBox({required this.message, required this.isError});

  final String message;
  final bool isError;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: isError ? const Color(0xFFFFF3F1) : const Color(0xFFECFDF5),
          borderRadius: BorderRadius.circular(13),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              isError
                  ? Icons.info_outline_rounded
                  : Icons.check_circle_outline_rounded,
              size: 18,
              color:
                  isError ? const Color(0xFFB42318) : const Color(0xFF047857),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message,
                style: TextStyle(
                  fontSize: 12,
                  height: 1.4,
                  color: isError
                      ? const Color(0xFF8D2D26)
                      : const Color(0xFF05603A),
                ),
              ),
            ),
          ],
        ),
      );
}
