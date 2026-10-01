import 'package:flutter/services.dart';

/// Protección de capturas para pantallas con datos sensibles (ficha de emergencia).
/// Android: FLAG_SECURE (MainActivity). iOS: sin API pública equivalente; ver BLOCKERS BLK-12.
abstract interface class SecureScreen {
  Future<void> enable();
  Future<void> disable();
}

class ChannelSecureScreen implements SecureScreen {
  const ChannelSecureScreen();
  static const _channel = MethodChannel('app.antisismo/secure_screen');

  Future<void> _call(String method) async {
    try {
      await _channel.invokeMethod<void>(method);
    } on MissingPluginException {
      // Plataforma sin implementación (iOS, tests): la pantalla funciona igual, sin protección de capturas.
    } on PlatformException {
      // Igual que arriba: nunca bloquear el acceso a la ficha por un fallo de la protección.
    }
  }

  @override
  Future<void> enable() => _call('enable');
  @override
  Future<void> disable() => _call('disable');
}
