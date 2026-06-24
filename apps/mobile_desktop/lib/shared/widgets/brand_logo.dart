import 'package:flutter/material.dart';

class BrandLogo extends StatelessWidget {
  const BrandLogo({
    super.key,
    this.width,
    this.height,
    this.size,
    this.fit = BoxFit.contain,
  });

  static const assetPath = 'assets/branding/jiangjiu-app-logo-gold.png';

  final double? width;
  final double? height;
  final double? size;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      assetPath,
      width: size ?? width,
      height: size ?? height,
      fit: fit,
      semanticLabel: '品鉴酱酒中心 logo',
    );
  }
}
