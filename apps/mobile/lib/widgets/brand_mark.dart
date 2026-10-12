import 'package:flutter/material.dart';

import '../models.dart';

const _defaultGreen = Color(0xFF064E3B);

class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 46, this.tenant});

  final double size;
  final TenantBranding? tenant;

  @override
  Widget build(BuildContext context) {
    final logo = tenant?.logoUrl;
    if (logo != null && logo.startsWith('https://')) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(size * .26),
        child: Image.network(
          logo,
          width: size,
          height: size,
          fit: BoxFit.contain,
          errorBuilder: (_, __, ___) => _fallback(),
        ),
      );
    }
    return _fallback();
  }

  Widget _fallback() {
    final primary = colorFromHex(tenant?.primaryColor, _defaultGreen);
    const gold = Color(0xFFD6A23E);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: primary,
        borderRadius: BorderRadius.circular(size * .26),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          Icon(Icons.auto_awesome_rounded, color: gold, size: size * .56),
          Positioned(
            top: size * .13,
            left: size * .13,
            child: Container(
              width: size * .1,
              height: size * .1,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .75),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Positioned(
            bottom: size * .13,
            right: size * .13,
            child: Container(
              width: size * .1,
              height: size * .1,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .75),
                shape: BoxShape.circle,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
