/// Open Location Code (Plus Code) — codificación en el dispositivo, sin red (F5B «Qué decir al operador»).
/// Especificación: github.com/google/open-location-code (Apache-2.0). Vectores verificados contra la
/// librería oficial en test/fixtures/plus_code_vectors.json.
library;

const _alphabet = '23456789CFGHJMPQRVWX';
const _pairCodeLength = 10;
const _gridCodeLength = 5;
const _gridRows = 5;
const _gridColumns = 4;
const _latIntegerMultiplier = 8000 * 3125;
const _lngIntegerMultiplier = 8000 * 1024;

/// Código completo de 10 dígitos (≈ 14 × 14 m); Santo Domingo (18.4861, −69.9312) ⇒ `77CGF3P9+CG`.
String encodePlusCode(double latitude, double longitude) {
  if (latitude.isNaN || longitude.isNaN || latitude.isInfinite || longitude.isInfinite) {
    throw ArgumentError('invalid coordinates');
  }
  var lat = latitude.clamp(-90.0, 90.0);
  var lng = longitude;
  while (lng < -180) {
    lng += 360;
  }
  while (lng >= 180) {
    lng -= 360;
  }
  if (lat == 90) lat -= 0.000125; // precisión de un código de 10 dígitos
  var latVal = (lat * _latIntegerMultiplier).round() + 90 * _latIntegerMultiplier;
  var lngVal = (lng * _lngIntegerMultiplier).round() + 180 * _lngIntegerMultiplier;
  for (var i = 0; i < _gridCodeLength; i++) {
    latVal ~/= _gridRows;
    lngVal ~/= _gridColumns;
  }
  final out = List.filled(_pairCodeLength, '');
  for (var i = _pairCodeLength ~/ 2 - 1; i >= 0; i--) {
    out[2 * i + 1] = _alphabet[lngVal % 20];
    out[2 * i] = _alphabet[latVal % 20];
    latVal ~/= 20;
    lngVal ~/= 20;
  }
  final code = out.join();
  return '${code.substring(0, 8)}+${code.substring(8)}';
}
