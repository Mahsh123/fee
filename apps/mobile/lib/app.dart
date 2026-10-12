import 'package:flutter/material.dart';

import 'api/wasl_api.dart';
import 'models.dart';
import 'screens/home_shell.dart';
import 'screens/login_screen.dart';
import 'widgets/brand_mark.dart';

const _defaultGreen = Color(0xFF064E3B);
const _defaultActionGreen = Color(0xFF047857);

class WaslMadrasaApp extends StatefulWidget {
  const WaslMadrasaApp({super.key});

  @override
  State<WaslMadrasaApp> createState() => _WaslMadrasaAppState();
}

class _WaslMadrasaAppState extends State<WaslMadrasaApp> {
  WaslApi? _api;
  SessionUser? _user;
  TenantBranding? _tenant;
  bool _restoring = true;
  String? _restoreMessage;

  @override
  void initState() {
    super.initState();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    final api = await WaslApi.restore();
    if (api == null) {
      if (mounted) setState(() => _restoring = false);
      return;
    }
    try {
      final results = await Future.wait<Object>([
        api.restoreUser(),
        api.resolveTenant(),
      ]);
      final user = results[0] as SessionUser;
      final tenant = results[1] as TenantBranding;
      if (tenant.slug != user.tenantSlug)
        throw const ApiException(
          'The signed-in account does not match this workspace. Sign in again.',
          statusCode: 403,
        );
      if (mounted)
        setState(() {
          _api = api;
          _user = user;
          _tenant = tenant;
          _restoring = false;
        });
    } catch (error) {
      await api.clearSession();
      if (mounted)
        setState(() {
          _restoreMessage = error is ApiException
              ? error.message
              : 'Your saved session could not be restored. Please sign in again.';
          _restoring = false;
        });
    }
  }

  void _signedIn(WaslApi api, SessionUser user, TenantBranding tenant) {
    setState(() {
      _api = api;
      _user = user;
      _tenant = tenant;
      _restoreMessage = null;
    });
  }

  Future<void> _signOut() async {
    final api = _api;
    if (api != null) await api.logout();
    if (mounted)
      setState(() {
        _api = null;
        _user = null;
        _tenant = null;
      });
  }

  @override
  Widget build(BuildContext context) {
    final primary = colorFromHex(_tenant?.primaryColor, _defaultGreen);
    final accent = colorFromHex(_tenant?.accentColor, _defaultActionGreen);
    final theme = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: primary,
        primary: primary,
        secondary: accent,
        surface: Colors.white,
      ),
      scaffoldBackgroundColor: const Color(0xFFF7FAF8),
      appBarTheme: AppBarTheme(
        backgroundColor: const Color(0xFFF7FAF8),
        foregroundColor: const Color(0xFF171717),
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(color: Color(0xFFE8EFEB)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: Color(0xFFD8E3DD)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: Color(0xFFD8E3DD)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: accent, width: 1.6),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 15,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
    );

    return MaterialApp(
      title: _tenant?.displayName ?? 'Wasl Madrasa',
      debugShowCheckedModeBanner: false,
      theme: theme,
      home: _restoring
          ? const _RestoreScreen()
          : _user != null && _api != null && _tenant != null
              ? HomeShell(
                  api: _api!,
                  user: _user!,
                  tenant: _tenant!,
                  onSignOut: _signOut,
                )
              : LoginScreen(
                  onSignedIn: _signedIn, initialMessage: _restoreMessage),
    );
  }
}

class _RestoreScreen extends StatelessWidget {
  const _RestoreScreen();

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              BrandMark(size: 72),
              SizedBox(height: 20),
              Text(
                'Wasl Madrasa',
                style: TextStyle(
                  color: Color(0xFF064E3B),
                  fontSize: 21,
                  fontWeight: FontWeight.w800,
                ),
              ),
              SizedBox(height: 7),
              Text(
                'Connecting to your workspace',
                style: TextStyle(color: Color(0xFF737373), fontSize: 13),
              ),
              SizedBox(height: 24),
              SizedBox(
                width: 25,
                height: 25,
                child: CircularProgressIndicator(
                  strokeWidth: 2.4,
                  color: Color(0xFF047857),
                ),
              ),
            ],
          ),
        ),
      );
}
