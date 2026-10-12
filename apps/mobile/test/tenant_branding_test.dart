import 'package:flutter_test/flutter_test.dart';
import 'package:wasl_madrasa/models.dart';

void main() {
  test('resolves same-workspace tenant logo paths against the workspace host',
      () {
    final tenant = TenantBranding.fromJson(
      {
        'kind': 'tenant',
        'branding': {'logoUrl': '/tenant-brands/madrasa.svg'},
      },
      resourceBase: Uri.parse('https://north.example.org'),
    );

    expect(
      tenant.logoUrl,
      'https://north.example.org/tenant-brands/madrasa.svg',
    );
  });

  test('rejects non-local insecure tenant logo URLs', () {
    final tenant = TenantBranding.fromJson({
      'kind': 'tenant',
      'branding': {'logoUrl': 'http://assets.example.org/madrasa.png'},
    });

    expect(tenant.logoUrl, isNull);
  });
}
