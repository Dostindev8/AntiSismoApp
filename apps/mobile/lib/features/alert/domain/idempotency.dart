/// Idempotencia de alertas (§7.3): clave determinista alert_id (evento+revisión).
/// - misma alert_id ⇒ no repetir alarma
/// - nueva revisión de un evento ya alarmado ⇒ actualizar tarjeta SIN alarma nueva
/// - TTL 7 días. La persistencia cifrada (Hive + Keystore/Keychain) se conecta en F5 vía [AlertLedgerStore].
library;

enum LedgerOutcome { firstAlarm, duplicate, revisionUpdate }

abstract interface class AlertLedgerStore {
  Future<Map<String, int>> loadAlertIds();
  Future<Map<String, int>> loadAlarmedEvents();
  Future<void> save(Map<String, int> alertIds, Map<String, int> alarmedEvents);
}

class AlertLedger {
  AlertLedger({this.ttl = const Duration(days: 7)});

  final Duration ttl;
  final Map<String, int> _seenAlertIds = {};
  final Map<String, int> _alarmedEvents = {};

  void restore(Map<String, int> alertIds, Map<String, int> alarmedEvents) {
    _seenAlertIds
      ..clear()
      ..addAll(alertIds);
    _alarmedEvents
      ..clear()
      ..addAll(alarmedEvents);
  }

  Map<String, int> get alertIds => Map.unmodifiable(_seenAlertIds);
  Map<String, int> get alarmedEvents => Map.unmodifiable(_alarmedEvents);

  /// Registra una alerta que el clasificador marcó como ALARM y decide si debe sonar.
  LedgerOutcome register({required String alertId, required String eventId, required int nowMs}) {
    _prune(nowMs);
    if (_seenAlertIds.containsKey(alertId)) return LedgerOutcome.duplicate;
    _seenAlertIds[alertId] = nowMs;
    if (_alarmedEvents.containsKey(eventId)) return LedgerOutcome.revisionUpdate;
    _alarmedEvents[eventId] = nowMs;
    return LedgerOutcome.firstAlarm;
  }

  void _prune(int nowMs) {
    final cutoff = nowMs - ttl.inMilliseconds;
    _seenAlertIds.removeWhere((_, t) => t < cutoff);
    _alarmedEvents.removeWhere((_, t) => t < cutoff);
  }
}
