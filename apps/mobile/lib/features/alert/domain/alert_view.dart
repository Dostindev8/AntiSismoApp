import 'dart:math';

import '../../../core/contract/contract.dart';
import '../../../core/geo/arrival.dart';
import '../../../core/i18n/strings.dart';

/// Datos que muestra la pantalla de alerta. Se construye SOLO desde un SignedAlert ya clasificado
/// (ALARM o DRILL por el contrato) o desde un simulacro local etiquetado.
class AlertView {
  const AlertView({
    required this.drill,
    required this.tsunami,
    required this.instruction,
    required this.arrivalAtServerMs,
    required this.clockOffsetMs,
    this.magnitude,
    this.place,
  });

  /// Simulacro local: sin magnitud ni lugar (no se inventan cifras), cuenta atrás fija de práctica.
  factory AlertView.drill({required int deviceNowMs, required int countdownSeconds}) => AlertView(
        drill: true,
        tsunami: false,
        instruction: 'DROP_COVER_HOLD_ON',
        arrivalAtServerMs: deviceNowMs + countdownSeconds * 1000,
        clockOffsetMs: 0,
      );

  /// Desde un payload firmado verificado. La llegada se calcula en el dispositivo si hay ubicación;
  /// si no, se usa el TEA regional de la celda (aproximado), calculado por el servidor al decidir (≈ iat).
  factory AlertView.fromSignedAlert(
    SignedAlert a, {
    required int deviceNowMs,
    double? userLat,
    double? userLon,
  }) {
    final e = a.event;
    final offset = a.serverTimeMs - deviceNowMs;
    int? arrivalAt;
    if (userLat != null && userLon != null) {
      final km = haversineKm(userLat, userLon, (e['lat'] as num).toDouble(), (e['lon'] as num).toDouble());
      final depth = max((e['depth_km'] as num).toDouble(), 0.0);
      arrivalAt = a.timeUtcMs + (sqrt(km * km + depth * depth) / sWaveKmPerS * 1000).round();
    } else if (e['tea_regional_seconds'] is int) {
      arrivalAt = a.iatMs + (e['tea_regional_seconds'] as int) * 1000;
    }
    return AlertView(
      drill: a.level == 'DRILL',
      tsunami: e['tsunami'] == true,
      instruction: a.instruction,
      arrivalAtServerMs: arrivalAt,
      clockOffsetMs: offset,
      magnitude: (e['magnitude'] as num).toDouble(),
      place: e['place'] as String,
    );
  }

  final bool drill;
  final bool tsunami;
  final String instruction;

  /// Instante estimado de llegada en reloj del servidor; `null` = desconocido.
  final int? arrivalAtServerMs;
  final int clockOffsetMs;
  final double? magnitude;
  final String? place;

  /// Segundos restantes (redondeo hacia arriba); `null` si ya pudo haber llegado o se desconoce.
  int? secondsLeft(int deviceNowMs) {
    final at = arrivalAtServerMs;
    if (at == null) return null;
    final left = ((at - (deviceNowMs + clockOffsetMs)) / 1000).ceil();
    return left > 0 ? left : null;
  }
}

/// Texto de voz (plantilla exacta del SUPER-PROMPT §F5). [name] vacío ⇒ variante sin nombre.
String alertVoiceText(AppStrings s, AlertView v, {required String name, required int secondsLeft}) {
  final n = name.trim();
  if (v.drill) return n.isEmpty ? s.t('voice.drillAnon') : s.t('voice.drill', {'name': n});
  final instruction = s.t('instruction.${v.instruction}');
  final hasTime = secondsLeft > 0;
  if (n.isEmpty) {
    return hasTime
        ? s.t('voice.criticalAnon', {'instruction': instruction, 'seconds': secondsLeft})
        : s.t('voice.criticalAnonNoTime', {'instruction': instruction});
  }
  return hasTime
      ? s.t('voice.critical', {'name': n, 'instruction': instruction, 'seconds': secondsLeft})
      : s.t('voice.criticalNoTime', {'name': n, 'instruction': instruction});
}
