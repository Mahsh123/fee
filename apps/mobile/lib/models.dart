import 'package:flutter/material.dart';

typedef JsonMap = Map<String, dynamic>;

JsonMap asJsonMap(Object? value) => value is Map<String, dynamic>
    ? value
    : value is Map
        ? value.map((key, value) => MapEntry(key.toString(), value))
        : <String, dynamic>{};

List<JsonMap> asJsonList(Object? value) => value is List
    ? value.whereType<Map>().map((item) => asJsonMap(item)).toList()
    : const [];

T? firstOrNull<T>(Iterable<T> values) => values.isEmpty ? null : values.first;

String? nullableString(Object? value) =>
    value == null ? null : value.toString();

class SessionUser {
  const SessionUser({
    required this.id,
    required this.tenantId,
    required this.tenantSlug,
    required this.tenantName,
    required this.email,
    required this.firstName,
    required this.roles,
    required this.permissions,
    required this.isPlatformAdmin,
    this.phone,
    this.lastName,
    this.studentId,
    this.guardianId,
    this.mustChangePassword = false,
  });

  final String id;
  final String tenantId;
  final String tenantSlug;
  final String tenantName;
  final String email;
  final String firstName;
  final String? lastName;
  final String? phone;
  final List<String> roles;
  final List<String> permissions;
  final bool isPlatformAdmin;
  final String? studentId;
  final String? guardianId;
  final bool mustChangePassword;

  factory SessionUser.fromJson(JsonMap json) => SessionUser(
        id: json['id']?.toString() ?? '',
        tenantId: json['tenantId']?.toString() ?? '',
        tenantSlug: json['tenantSlug']?.toString() ?? '',
        tenantName: json['tenantName']?.toString() ?? '',
        email: json['email']?.toString() ?? '',
        firstName: json['firstName']?.toString() ?? '',
        lastName: nullableString(json['lastName']),
        phone: nullableString(json['phone']),
        roles: (json['roles'] as List? ?? const [])
            .map((value) => value.toString())
            .toList(),
        permissions: (json['permissions'] as List? ?? const [])
            .map((value) => value.toString())
            .toList(),
        isPlatformAdmin: json['isPlatformAdmin'] == true,
        studentId: nullableString(json['studentId']),
        guardianId: nullableString(json['guardianId']),
        mustChangePassword: json['mustChangePassword'] == true,
      );

  String get displayName => [
        firstName,
        lastName,
      ].whereType<String>().where((value) => value.trim().isNotEmpty).join(' ');
  bool get hasPortalRole =>
      roles.any((role) => role == 'STUDENT' || role == 'PARENT');
  bool get hasStaffRole =>
      roles.any((role) => role != 'STUDENT' && role != 'PARENT');
  bool can(String permission) => permissions.contains(permission);
}

class TenantBranding {
  const TenantBranding({
    required this.kind,
    this.name,
    this.slug,
    this.organizationCategory,
    this.enabledModules = const [],
    this.organizationName,
    this.logoUrl,
    this.primaryColor,
    this.accentColor,
    this.email,
    this.timezone = 'Asia/Kolkata',
    this.inactive = false,
  });

  final String kind;
  final String? name;
  final String? slug;
  final String? organizationCategory;
  final List<String> enabledModules;
  final String? organizationName;
  final String? logoUrl;
  final String? primaryColor;
  final String? accentColor;
  final String? email;
  final String timezone;
  final bool inactive;

  factory TenantBranding.fromJson(JsonMap json, {Uri? resourceBase}) {
    final branding = asJsonMap(json['branding']);
    return TenantBranding(
      kind: json['kind']?.toString() ?? 'unknown',
      name: nullableString(json['name']),
      slug: nullableString(json['slug']),
      organizationCategory: nullableString(json['organizationCategory']),
      enabledModules: (json['enabledModules'] as List? ?? const [])
          .map((value) => value.toString())
          .toList(),
      organizationName: nullableString(branding['organizationName']),
      logoUrl: _resolveLogoUrl(
        nullableString(branding['logoUrl']),
        resourceBase,
      ),
      primaryColor: nullableString(branding['primaryColor']),
      accentColor: nullableString(branding['accentColor']),
      email: nullableString(branding['email']),
      timezone: json['timezone']?.toString() ?? 'Asia/Kolkata',
      inactive: json['kind'] == 'inactive',
    );
  }

  String get displayName => organizationName?.trim().isNotEmpty == true
      ? organizationName!.trim()
      : name?.trim().isNotEmpty == true
          ? name!.trim()
          : 'Wasl Madrasa';

  bool get paymentsEnabled => enabledModules.contains('PAYMENTS');
}

String? _resolveLogoUrl(String? value, Uri? resourceBase) {
  final input = value?.trim();
  if (input == null || input.isEmpty) return null;
  final parsed = Uri.tryParse(input);
  if (parsed == null) return null;
  final resolved = parsed.hasScheme ? parsed : resourceBase?.resolveUri(parsed);
  if (resolved == null ||
      !resolved.hasAuthority ||
      resolved.host.isEmpty ||
      resolved.userInfo.isNotEmpty) {
    return null;
  }
  final local = resolved.host == 'localhost' ||
      resolved.host == '127.0.0.1' ||
      resolved.host.endsWith('.localhost');
  if (resolved.scheme != 'https' && !(local && resolved.scheme == 'http')) {
    return null;
  }
  return resolved.toString();
}

class StudentSummary {
  const StudentSummary({
    required this.id,
    required this.firstName,
    required this.admissionNumber,
    this.middleName,
    this.lastName,
    this.status,
  });

  final String id;
  final String firstName;
  final String admissionNumber;
  final String? middleName;
  final String? lastName;
  final String? status;

  factory StudentSummary.fromJson(JsonMap json) => StudentSummary(
        id: json['id']?.toString() ?? '',
        firstName: json['firstName']?.toString() ?? '',
        middleName: nullableString(json['middleName']),
        lastName: nullableString(json['lastName']),
        admissionNumber: json['admissionNumber']?.toString() ?? '',
        status: nullableString(json['status']),
      );

  String get name => [
        firstName,
        middleName,
        lastName,
      ].whereType<String>().where((part) => part.trim().isNotEmpty).join(' ');
}

Color colorFromHex(String? value, Color fallback) {
  if (value == null) return fallback;
  var hex = value.trim().replaceFirst('#', '');
  if (hex.length == 6) hex = 'FF$hex';
  final parsed = int.tryParse(hex, radix: 16);
  return parsed == null ? fallback : Color(parsed);
}
