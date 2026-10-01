import 'package:intl/intl.dart';
import 'package:timezone/timezone.dart' as tz;

/// Presentación de tiempo de un evento. [ms] = epoch UTC en MILISEGUNDOS; [tzName] = IANA
/// (p. ej. America/Santo_Domingo). Requiere `initializeTimeZones()` e `initializeDateFormatting('es')`.
/// UI: "{localTime} hora local · {utcTime} UTC" — siempre doble, 24 h, sin abreviaturas ambiguas.
({String dateLong, String localTime, String utcTime}) formatEventTime(int ms, String tzName, {String locale = 'es'}) {
  final loc = tz.getLocation(tzName);
  final local = tz.TZDateTime.fromMillisecondsSinceEpoch(loc, ms);
  final utc = DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);
  final date = DateFormat("EEEE d 'de' MMMM 'de' y", locale).format(local);
  final hms = DateFormat('HH:mm:ss', locale);
  return (dateLong: date, localTime: hms.format(local), utcTime: hms.format(utc));
}
