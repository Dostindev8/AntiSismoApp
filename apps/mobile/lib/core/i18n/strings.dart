import 'messages.g.dart';

export 'messages.g.dart' show baseLocale, supportedLocales;

/// Acceso a textos (fuente: packages/config/i18n). Nunca hardcodear textos de UI.
class AppStrings {
  AppStrings(String locale) : _m = messagesByLocale[locale] ?? messagesByLocale[baseLocale]!;

  final Map<String, String> _m;

  /// Falla ruidosamente en debug si falta una clave o un parámetro; en release devuelve la clave
  /// (nunca un texto vacío en una pantalla crítica).
  String t(String key, [Map<String, Object> params = const {}]) {
    final template = _m[key];
    assert(template != null, 'Missing i18n key: $key');
    if (template == null) return key;
    return template.replaceAllMapped(RegExp(r'\{(\w+)\}'), (m) {
      final v = params[m[1]];
      assert(v != null, 'Missing i18n param ${m[1]} for $key');
      return v?.toString() ?? m[0]!;
    });
  }
}
