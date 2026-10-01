import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import 'phone_number.dart';

enum DialOutcome { opened, failed, noTelephony }

/// Abstracción del marcador (F5B). La implementación por defecto abre el marcador del sistema con el número
/// cargado (Android ACTION_DIAL vía `tel:`, sin permiso CALL_PHONE): la persona confirma la llamada.
/// La llamada directa (CALL_PHONE) no está implementada a propósito: ver docs/adr/0002-emergency-calls.md.
abstract interface class EmergencyDialer {
  Future<bool> canDial();
  Future<DialOutcome> dial(String number);
  Future<bool> openSms({String? number, required String body});
}

class UrlLauncherDialer implements EmergencyDialer {
  const UrlLauncherDialer();

  @override
  Future<bool> canDial() => canLaunchUrl(Uri(scheme: 'tel', path: '000'));

  @override
  Future<DialOutcome> dial(String number) async {
    final uri = telUri(number);
    if (!await canLaunchUrl(uri)) return DialOutcome.noTelephony;
    return await launchUrl(uri, mode: LaunchMode.externalApplication) ? DialOutcome.opened : DialOutcome.failed;
  }

  @override
  Future<bool> openSms({String? number, required String body}) =>
      launchUrl(smsUri(number: number, body: body), mode: LaunchMode.externalApplication);
}

/// Número de prueba para builds de debug/profile: `--dart-define=EMERGENCY_TEST_NUMBER=...`.
/// Ningún test ni build de desarrollo marca un número de emergencia real.
const emergencyTestNumber = String.fromEnvironment('EMERGENCY_TEST_NUMBER');

/// Qué número se marca realmente. Release ⇒ el oficial verificado. Debug/profile ⇒ solo el número de prueba;
/// sin número de prueba válido la llamada queda desactivada (`number == null`).
({String? number, bool isTest}) resolveDialTarget({
  required String official,
  bool release = kReleaseMode,
  String testNumber = emergencyTestNumber,
}) {
  if (release) return (number: isValidPhoneNumber(official) ? official : null, isTest: false);
  return (number: isValidPhoneNumber(testNumber) ? testNumber : null, isTest: true);
}
