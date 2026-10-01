import 'package:flutter/material.dart';

import '../../core/i18n/strings.dart';
import '../../core/theme/app_theme.dart';

/// Logo oficial sin recolorear ni recortar (BoxFit.contain), sobre placa clara para fondos oscuros,
/// con zona de seguridad del 25 % del alto del logo por cada lado.
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, required this.strings, required this.maxHeight});

  static const asset = 'assets/brand/logo-fullcolor.png';
  static const safeZone = 0.25;

  final AppStrings strings;
  final double maxHeight;

  @override
  Widget build(BuildContext context) {
    final logoHeight = maxHeight / (1 + 2 * safeZone);
    return Semantics(
      image: true,
      label: '${strings.t('app.name')}. ${strings.t('app.tagline')}',
      child: ExcludeSemantics(
        child: Container(
          constraints: BoxConstraints(maxHeight: maxHeight),
          padding: EdgeInsets.all(logoHeight * safeZone),
          decoration: BoxDecoration(color: AppColors.lightBg, borderRadius: BorderRadius.circular(AppRadius.xl)),
          child: Image.asset(asset, fit: BoxFit.contain),
        ),
      ),
    );
  }
}
