/// Configuración de compilación (nunca secretos). Se sobrescribe con `--dart-define`.
abstract final class AppConfig {
  /// Base del enlace de mapa en el SMS de ubicación (Google Maps URLs, `api=1`). Se le añade `lat,lon`.
  static const mapLinkBase = String.fromEnvironment(
    'MAP_LINK_BASE',
    defaultValue: 'https://www.google.com/maps/search/?api=1&query=',
  );

  /// Cuenta atrás del simulacro (práctica; no representa ningún evento real).
  static const drillCountdownSeconds = 10;

  /// Ventana máxima del splash: nunca retrasa más que esto el acceso a la app.
  static const splashDuration = Duration(milliseconds: 1400);
}
