/// Sanitización estricta de números (F5B, QA-E1): ningún URI se construye con un número fuera de la allowlist.
library;

final _allowed = RegExp(r'^\+?[0-9*#]{3,15}$');
final _formatting = RegExp(r'[\s\-().]');

bool isValidPhoneNumber(String n) => _allowed.hasMatch(n);

/// Quita solo separadores visuales que una persona escribe (espacios, guiones, paréntesis, puntos) y valida.
/// Devuelve `null` si el resultado no pasa la allowlist.
String? normalizePhoneInput(String raw) {
  final n = raw.replaceAll(_formatting, '');
  return isValidPhoneNumber(n) ? n : null;
}

/// `tel:` (RFC 3966). Lanza [ArgumentError] si el número no es válido: nunca se marca algo no sanitizado.
Uri telUri(String number) {
  if (!isValidPhoneNumber(number)) throw ArgumentError.value(number, 'number', 'not allowed');
  return Uri(scheme: 'tel', path: number);
}

/// `sms:` con cuerpo prellenado; la persona pulsa enviar (nunca se envía en silencio).
Uri smsUri({String? number, required String body}) {
  if (number != null && !isValidPhoneNumber(number)) throw ArgumentError.value(number, 'number', 'not allowed');
  return Uri(scheme: 'sms', path: number ?? '', query: 'body=${Uri.encodeComponent(body)}');
}
