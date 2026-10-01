import 'package:flutter/material.dart';

import 'app_tokens.g.dart';

export 'app_tokens.g.dart';

/// Gradiente de fondo del mockup (bgDeep → brandNavy).
const appBackgroundGradient = LinearGradient(
  begin: Alignment.topCenter,
  end: Alignment.bottomCenter,
  colors: [AppColors.bgDeep, AppColors.brandNavy],
);

TextTheme _textTheme(Color primary, Color muted) => TextTheme(
      displaySmall: TextStyle(fontFamily: 'Poppins', fontWeight: FontWeight.w800, height: 1.1, color: primary),
      headlineMedium: TextStyle(fontFamily: 'Poppins', fontWeight: FontWeight.w800, height: 1.15, color: primary),
      headlineSmall: TextStyle(fontFamily: 'Poppins', fontWeight: FontWeight.w700, color: primary),
      titleLarge: TextStyle(fontFamily: 'Poppins', fontWeight: FontWeight.w700, color: primary),
      titleMedium: TextStyle(fontWeight: FontWeight.w600, color: primary),
      titleSmall: TextStyle(fontWeight: FontWeight.w600, color: primary),
      bodyLarge: TextStyle(fontWeight: FontWeight.w400, height: 1.4, fontSize: 16, color: primary),
      bodyMedium: TextStyle(fontWeight: FontWeight.w400, height: 1.4, fontSize: 14, color: primary),
      bodySmall: TextStyle(fontWeight: FontWeight.w400, height: 1.35, fontSize: 14, color: muted),
      labelLarge: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
      labelMedium: TextStyle(fontWeight: FontWeight.w500, fontSize: 14, color: muted),
    );

ThemeData _base({
  required ColorScheme scheme,
  required Color scaffold,
  required Color text,
  required Color muted,
  required Color card,
}) {
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: scaffold,
    fontFamily: 'Inter',
    textTheme: _textTheme(text, muted),
    cardTheme: CardThemeData(
      color: card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.lg)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 48), // objetivo táctil ≥ 48dp (WCAG 2.5.8)
        shape: shape,
        textStyle: const TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48), shape: shape),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(minimumSize: const Size(48, 48), shape: shape),
    ),
    iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(minimumSize: const Size(48, 48))),
    focusColor: AppColors.accentCyan.withValues(alpha: 0.35),
    visualDensity: VisualDensity.standard,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    splashFactory: InkSparkle.splashFactory,
  );
}

/// Tema oscuro por defecto (como el mockup). Rojo reservado a estados críticos.
ThemeData buildDarkTheme() => _base(
      scheme: const ColorScheme.dark(
        primary: AppColors.accentBlue,
        onPrimary: AppColors.textPrimary,
        secondary: AppColors.safeGreen,
        onSecondary: AppColors.brandNavy,
        tertiary: AppColors.accentCyan,
        onTertiary: AppColors.brandNavy,
        error: AppColors.alertRedStrong,
        onError: AppColors.textPrimary,
        surface: AppColors.surface,
        onSurface: AppColors.textPrimary,
        onSurfaceVariant: AppColors.textMuted,
        surfaceContainerHighest: AppColors.surfaceHigh,
        outline: AppColors.textMuted,
      ),
      scaffold: AppColors.brandNavy,
      text: AppColors.textPrimary,
      muted: AppColors.textMuted,
      card: AppColors.surface,
    );

/// Tema claro equivalente (texto navy sobre blanco/F3F6FA; contraste verificado en tokens.json).
ThemeData buildLightTheme() => _base(
      scheme: const ColorScheme.light(
        primary: AppColors.accentBlue,
        onPrimary: AppColors.textPrimary,
        secondary: AppColors.safeGreenStrong,
        onSecondary: AppColors.textPrimary,
        tertiary: AppColors.accentBlue,
        error: AppColors.alertRedStrong,
        onError: AppColors.textPrimary,
        surface: AppColors.lightBg,
        onSurface: AppColors.brandNavy,
        onSurfaceVariant: AppColors.brandNavy,
        outline: AppColors.brandNavy,
      ),
      scaffold: AppColors.lightBgAlt,
      text: AppColors.brandNavy,
      muted: AppColors.brandNavy,
      card: AppColors.lightBg,
    );
