import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../models.dart';

const _configuredApiBase = String.fromEnvironment('WASL_API_BASE_URL');
const _workspaceKey = 'wasl.mobile.workspace';
const _refreshKey = 'wasl.mobile.refresh_token';

class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode, this.code});

  final String message;
  final int? statusCode;
  final String? code;

  @override
  String toString() => message;
}

class WaslApi {
  WaslApi._(this.workspaceUri, this.apiBase, this._storage);

  static const _secureStorage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static final http.Client _client = http.Client();
  static const _timeout = Duration(seconds: 25);

  final Uri workspaceUri;
  final Uri apiBase;
  final FlutterSecureStorage _storage;
  String? _accessToken;
  String? _refreshToken;
  Future<bool>? _refreshing;

  String get workspaceLabel => workspaceUri.host;

  static WaslApi forWorkspace(String value) {
    final workspace = _normalizeWorkspace(value);
    final configured = _configuredApiBase.trim();
    final api = configured.isEmpty
        ? workspace.replace(path: '/api/v1', query: null, fragment: null)
        : _normalizeApiBase(configured);
    return WaslApi._(workspace, api, _secureStorage);
  }

  static Future<WaslApi?> restore() async {
    final workspace = await _secureStorage.read(key: _workspaceKey);
    final refresh = await _secureStorage.read(key: _refreshKey);
    if (workspace == null || refresh == null) return null;
    try {
      final api = forWorkspace(workspace);
      api._refreshToken = refresh;
      return api;
    } on FormatException {
      await _secureStorage.delete(key: _workspaceKey);
      await _secureStorage.delete(key: _refreshKey);
      return null;
    }
  }

  Future<TenantBranding> resolveTenant() async {
    final json = asJsonMap(
      await _request('GET', 'tenant-context', authenticate: false),
    );
    final result = TenantBranding.fromJson(json, resourceBase: workspaceUri);
    if (result.kind != 'tenant') {
      final message = result.inactive
          ? 'This Madrasa workspace is currently inactive.'
          : 'That workspace could not be found. Check the URL and try again.';
      throw ApiException(message, statusCode: 404);
    }
    return result;
  }

  Future<SessionUser> login(String email, String password) async {
    final json = asJsonMap(
      await _request(
        'POST',
        'auth/login',
        body: {'email': email.trim(), 'password': password},
        authenticate: false,
      ),
    );
    _accessToken = json['accessToken']?.toString();
    final user = SessionUser.fromJson(asJsonMap(json['user']));
    if (_accessToken == null || _accessToken!.isEmpty || user.id.isEmpty) {
      throw const ApiException(
        'The sign-in response was incomplete. Please try again.',
      );
    }
    await _storage.write(key: _workspaceKey, value: workspaceUri.toString());
    if (_refreshToken != null) {
      await _storage.write(key: _refreshKey, value: _refreshToken);
    }
    return user;
  }

  Future<SessionUser> refreshSession() async {
    if (_refreshToken == null)
      throw const ApiException(
        'Your session expired. Please sign in again.',
        statusCode: 401,
      );
    final json = asJsonMap(
      await _request(
        'POST',
        'auth/refresh',
        body: {'refreshToken': _refreshToken},
        authenticate: false,
      ),
    );
    final rotated = _refreshToken;
    if (rotated == null || rotated.isEmpty) {
      await clearSession();
      throw const ApiException(
        'The secure session could not be renewed. Please sign in again.',
        statusCode: 401,
      );
    }
    _accessToken = json['accessToken']?.toString();
    if (_accessToken == null || _accessToken!.isEmpty) {
      await clearSession();
      throw const ApiException(
        'The session response was incomplete. Please sign in again.',
        statusCode: 401,
      );
    }
    await _storage.write(key: _refreshKey, value: rotated);
    return SessionUser.fromJson(asJsonMap(json['user']));
  }

  Future<SessionUser> restoreUser() => refreshSession();

  Future<void> logout() async {
    try {
      await _request(
        'POST',
        'auth/logout',
        body: {'refreshToken': _refreshToken},
        authenticate: false,
      );
    } catch (_) {
      // Local credentials are removed even if the device is offline. The server
      // will reject the refresh token after it expires or is revoked elsewhere.
    }
    await clearSession();
  }

  Future<void> changePassword(
    String currentPassword,
    String newPassword,
  ) async {
    await _request(
      'POST',
      'auth/change-password',
      body: {'currentPassword': currentPassword, 'newPassword': newPassword},
    );
  }

  Future<void> clearSession() async {
    _accessToken = null;
    _refreshToken = null;
    await _storage.delete(key: _workspaceKey);
    await _storage.delete(key: _refreshKey);
  }

  Future<JsonMap?> readPendingManualCollection(
    String actorId,
    String studentId,
  ) async {
    final key = _pendingManualCollectionKey(actorId, studentId);
    final saved = await _storage.read(key: key);
    if (saved == null) return null;
    try {
      return asJsonMap(jsonDecode(saved));
    } on FormatException {
      await _storage.delete(key: key);
      return null;
    }
  }

  Future<void> savePendingManualCollection(
    String actorId,
    String studentId,
    JsonMap body,
  ) =>
      _storage.write(
        key: _pendingManualCollectionKey(actorId, studentId),
        value: jsonEncode(body),
      );

  Future<void> clearPendingManualCollection(
    String actorId,
    String studentId,
  ) =>
      _storage.delete(
        key: _pendingManualCollectionKey(actorId, studentId),
      );

  String _pendingManualCollectionKey(String actorId, String studentId) =>
      'wasl.mobile.pending_manual.${workspaceUri.authority}.$actorId.$studentId';

  Future<Object?> get(String path, {Map<String, String>? query}) =>
      _request('GET', path, query: query);

  Future<Object?> post(String path, {Object? body}) =>
      _request('POST', path, body: body);

  Future<Object?> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    bool authenticate = true,
    bool retried = false,
  }) async {
    final response = await _send(
      method,
      path,
      query: query,
      body: body,
      authenticate: authenticate,
    );
    if (response.statusCode == 401 && authenticate && !retried) {
      final refreshed = await _refreshAccessToken();
      if (refreshed)
        return _request(
          method,
          path,
          query: query,
          body: body,
          authenticate: true,
          retried: true,
        );
      await clearSession();
      throw const ApiException(
        'Your session expired. Please sign in again.',
        statusCode: 401,
      );
    }
    final payload = _decode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = asJsonMap(asJsonMap(payload)['error']);
      throw ApiException(
        error['message']?.toString() ?? _friendlyStatus(response.statusCode),
        statusCode: response.statusCode,
        code: nullableString(error['code']),
      );
    }
    final envelope = asJsonMap(payload);
    if (envelope['success'] == false) {
      final error = asJsonMap(envelope['error']);
      throw ApiException(
        error['message']?.toString() ?? 'The request could not be completed.',
        code: nullableString(error['code']),
      );
    }
    return envelope.containsKey('data') ? envelope['data'] : payload;
  }

  Future<bool> _refreshAccessToken() {
    if (_refreshing != null) return _refreshing!;
    final future = () async {
      if (_refreshToken == null) return false;
      try {
        final json = asJsonMap(
          await _request(
            'POST',
            'auth/refresh',
            body: {'refreshToken': _refreshToken},
            authenticate: false,
          ),
        );
        _accessToken = json['accessToken']?.toString();
        if (_accessToken == null ||
            _accessToken!.isEmpty ||
            _refreshToken == null) return false;
        await _storage.write(key: _refreshKey, value: _refreshToken);
        return true;
      } catch (_) {
        return false;
      }
    }();
    _refreshing = future.whenComplete(() => _refreshing = null);
    return _refreshing!;
  }

  Future<http.Response> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    required bool authenticate,
  }) async {
    final endpoint = Uri.parse(
      '${apiBase.toString().replaceFirst(RegExp(r'/+$'), '')}/${path.replaceFirst(RegExp(r'^/+'), '')}',
    ).replace(queryParameters: query);
    final request = http.Request(method, endpoint)
      ..headers['accept'] = 'application/json'
      ..headers['x-request-id'] = _uuid();
    // The tenant hostname, rather than any caller-provided tenant ID, is the
    // workspace selector validated by Wasl middleware on every API request.
    request.headers['host'] = workspaceUri.hasPort
        ? '${workspaceUri.host}:${workspaceUri.port}'
        : workspaceUri.host;
    if (authenticate && _accessToken != null)
      request.headers['authorization'] = 'Bearer $_accessToken';
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    try {
      final streamed = await _client.send(request).timeout(_timeout);
      final response = await http.Response.fromStream(
        streamed,
      ).timeout(_timeout);
      _captureRefreshCookie(response.headers['set-cookie']);
      return response;
    } on TimeoutException {
      throw const ApiException(
        'The request timed out. Check your connection and try again.',
      );
    } on http.ClientException {
      throw const ApiException(
        'Wasl could not be reached. Check the workspace URL and your internet connection.',
      );
    } on FormatException {
      throw const ApiException('The workspace URL is not valid.');
    }
  }

  void _captureRefreshCookie(String? header) {
    if (header == null) return;
    final match = RegExp(
      r'(?:^|[,;]\s*)fee_refresh=([^; ,]+)',
    ).firstMatch(header);
    if (match != null) _refreshToken = Uri.decodeComponent(match.group(1)!);
  }

  Object? _decode(String body) {
    if (body.trim().isEmpty) return null;
    try {
      return jsonDecode(body);
    } on FormatException {
      return null;
    }
  }

  String _friendlyStatus(int code) => switch (code) {
        403 => 'You do not have permission to do that in this workspace.',
        404 => 'This Wasl service could not find the requested record.',
        408 || 504 => 'The request timed out. Please try again.',
        429 => 'Too many attempts. Wait a moment and try again.',
        >= 500 => 'Wasl is temporarily unavailable. Please try again shortly.',
        _ => 'The request could not be completed. Please try again.',
      };

  static Uri _normalizeWorkspace(String value) {
    var input = value.trim();
    if (input.isEmpty)
      throw const FormatException('Enter the Madrasa workspace URL.');
    if (!input.contains('://')) input = 'https://$input';
    final parsed = Uri.parse(input);
    final local = parsed.host == 'localhost' ||
        parsed.host == '127.0.0.1' ||
        parsed.host.endsWith('.localhost');
    if (!parsed.hasAuthority ||
        parsed.host.isEmpty ||
        (parsed.scheme != 'https' && !(local && parsed.scheme == 'http'))) {
      throw const FormatException(
        'Use a valid HTTPS workspace URL. HTTP is allowed only for localhost.',
      );
    }
    if (parsed.userInfo.isNotEmpty ||
        parsed.query.isNotEmpty ||
        parsed.fragment.isNotEmpty ||
        (parsed.path != '' && parsed.path != '/')) {
      throw const FormatException(
        'Enter the workspace origin only, without a path or query.',
      );
    }
    return parsed.replace(path: '', query: null, fragment: null);
  }

  static Uri _normalizeApiBase(String value) {
    var input = value.trim();
    if (!input.contains('://')) input = 'https://$input';
    final uri = Uri.parse(input);
    if (!uri.hasAuthority ||
        uri.host.isEmpty ||
        (uri.scheme != 'https' &&
            uri.host != 'localhost' &&
            !uri.host.endsWith('.localhost'))) {
      throw const FormatException('The configured Wasl API URL is invalid.');
    }
    final path = uri.path.replaceFirst(RegExp(r'/+$'), '');
    return uri.replace(
      path: path.endsWith('/api/v1') ? path : '$path/api/v1',
      query: null,
      fragment: null,
    );
  }

  static String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex =
        bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
