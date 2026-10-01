import 'dart:math';

const earthRadiusKm = 6371.0088;

/// Velocidad de onda S del modelo homogéneo; idéntica a services/delivery/dispatch.SWaveKmPerS.
const sWaveKmPerS = 3.5;

double haversineKm(double lat1, double lon1, double lat2, double lon2) {
  double r(double d) => d * pi / 180;
  final a = pow(sin(r(lat2 - lat1) / 2), 2) + cos(r(lat1)) * cos(r(lat2)) * pow(sin(r(lon2 - lon1) / 2), 2);
  return 2 * earthRadiusKm * asin(min(1.0, sqrt(a)));
}

/// Segundos hasta la llegada estimada de la onda S (modelo simple, homogéneo). `null` ⇒ la onda ya pudo
/// haber llegado. El TEA se calcula EN EL DISPOSITIVO (§3#8): el servidor nunca conoce la ubicación.
/// [clockOffsetMs] = serverTime − deviceTime (derivado de `server_time_ms` del payload).
/// Siempre se etiqueta en UI como estimación.
int? estimateArrivalSeconds({
  required double epicentralKm,
  required double depthKm,
  required int originUtcMs,
  required int deviceNowMs,
  int clockOffsetMs = 0,
  double vsKmPerS = sWaveKmPerS,
}) {
  if (epicentralKm < 0 || vsKmPerS <= 0) throw ArgumentError('invalid distance or velocity');
  final hypo = sqrt(epicentralKm * epicentralKm + depthKm * depthKm);
  final arrivalMs = originUtcMs + (hypo / vsKmPerS * 1000).round();
  final nowServerMs = deviceNowMs + clockOffsetMs;
  final remaining = ((arrivalMs - nowServerMs) / 1000).ceil();
  return remaining <= 0 ? null : remaining;
}
