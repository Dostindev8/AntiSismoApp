/// Espejo Dart de packages/proto (wire format). Mismos fixtures que TS y Go.
library;

import 'dart:convert';

import 'package:crypto/crypto.dart' as hash;
import 'package:cryptography/cryptography.dart';

const minEpochMs = 946684800000;
const _maxEpochMs = 32503680000000;
const maxFutureSkewMs = 5 * 60 * 1000;
const maxAlarmWindowMs = 10 * 60 * 1000;
const maxPlaceUnits = 200;

final _reUuid = RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$');
final _reSrcKey = RegExp(r'^[a-z][a-z0-9_]{1,15}$');
final _reSrcVal = RegExp(r'^[A-Za-z0-9_.:-]{1,64}$');
final _reMagType = RegExp(r'^[A-Za-z_]{1,8}$');
final _reUnsafe = RegExp(r'[\x00-\x1F\x7F<>]');
final _reAlertId = RegExp(r'^[0-9a-f]{64}$');
final _reKid = RegExp(r'^k-[a-z0-9-]{1,32}$');
final _reSig = RegExp(r'^[A-Za-z0-9_-]{86}$');

const hazardTypes = {'EARTHQUAKE', 'TSUNAMI', 'VOLCANO', 'FLOOD', 'LANDSLIDE', 'WILDFIRE', 'CIVIL'};
const alertLevels = {'CRITICAL', 'INFORMATIVE', 'DRILL'};
const instructions = {'DROP_COVER_HOLD_ON', 'EVACUATE_HIGH_GROUND', 'FLOOD_MOVE_AWAY', 'FOLLOW_AUTHORITIES'};
const _statuses = {'automatic', 'reviewed'};

class ContractError implements Exception {
  ContractError(this.field);
  final String field;
  @override
  String toString() => 'ContractError($field)';
}

Never _fail(String f) => throw ContractError(f);

void _keysExact(Map<String, dynamic> m, Set<String> keys, String ctx) {
  for (final k in keys) {
    if (!m.containsKey(k)) _fail('$ctx.$k missing');
  }
  for (final k in m.keys) {
    if (!keys.contains(k)) _fail('$ctx.$k unknown');
  }
}

int _int(Object? v, String f, int min, int max) {
  if (v is! int || v < min || v > max) _fail(f);
  return v;
}

double _num(Object? v, String f, double min, double max) {
  if (v is! num || v.isNaN || v < min || v > max) _fail(f);
  return v.toDouble();
}

String _str(Object? v, String f, RegExp re) {
  if (v is! String || !re.hasMatch(v)) _fail(f);
  return v;
}

String _enum(Object? v, String f, Set<String> allowed) {
  if (v is! String || !allowed.contains(v)) _fail(f);
  return v;
}

bool _bool(Object? v, String f) {
  if (v is! bool) _fail(f);
  return v;
}

String _place(Object? v) {
  // String.length = unidades UTF-16, igual que JS y que contract.UTF16Len en Go.
  if (v is! String || v.length > maxPlaceUnits || _reUnsafe.hasMatch(v)) _fail('place');
  return v;
}

/// NormalizedEvent validado estrictamente.
class NormalizedEvent {
  NormalizedEvent._(this.json);
  final Map<String, dynamic> json;

  static const _keys = {
    'id', 'source_ids', 'type', 'magnitude', 'mag_type', 'time_utc_ms', 'received_at_ms',
    'lon', 'lat', 'depth_km', 'place', 'tsunami', 'solution_status', 'revision_seq',
  };

  factory NormalizedEvent.fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) _fail('event');
    _keysExact(raw, _keys, 'event');
    _str(raw['id'], 'id', _reUuid);
    final src = raw['source_ids'];
    if (src is! Map<String, dynamic> || src.isEmpty) _fail('source_ids');
    src.forEach((k, v) {
      if (!_reSrcKey.hasMatch(k)) _fail('source_ids key');
      _str(v, 'source_ids value', _reSrcVal);
    });
    _enum(raw['type'], 'type', hazardTypes);
    _num(raw['magnitude'], 'magnitude', -2, 10);
    _str(raw['mag_type'], 'mag_type', _reMagType);
    final t = _int(raw['time_utc_ms'], 'time_utc_ms', minEpochMs, _maxEpochMs);
    final r = _int(raw['received_at_ms'], 'received_at_ms', minEpochMs, _maxEpochMs);
    if (t > r + maxFutureSkewMs) _fail('time_utc_ms future');
    _num(raw['lon'], 'lon', -180, 180);
    _num(raw['lat'], 'lat', -90, 90);
    _num(raw['depth_km'], 'depth_km', -100, 1000);
    _place(raw['place']);
    _bool(raw['tsunami'], 'tsunami');
    _enum(raw['solution_status'], 'solution_status', _statuses);
    _int(raw['revision_seq'], 'revision_seq', 0, 10000);
    return NormalizedEvent._(Map.unmodifiable(raw));
  }
}

/// Payload de push firmado (§7.2).
class SignedAlert {
  SignedAlert._({
    required this.alertId,
    required this.level,
    required this.eventId,
    required this.revisionSeq,
    required this.timeUtcMs,
    required this.instruction,
    required this.iatMs,
    required this.expMs,
    required this.serverTimeMs,
    required this.kid,
    required this.sig,
    required this.event,
  });

  final String alertId, level, eventId, instruction, kid, sig;
  final int revisionSeq, timeUtcMs, iatMs, expMs, serverTimeMs;
  final Map<String, dynamic> event;

  static const _keys = {'v', 'alert_id', 'level', 'event', 'instruction', 'voice', 'iat_ms', 'exp_ms', 'server_time_ms', 'kid', 'sig'};
  static const _eventKeys = {
    'id', 'type', 'magnitude', 'mag_type', 'time_utc_ms', 'place', 'lon', 'lat', 'depth_km',
    'mmi_estimated_regional', 'mmi_range', 'tsunami', 'solution_status', 'revision_seq', 'tea_regional_seconds',
  };

  factory SignedAlert.fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) _fail('alert');
    _keysExact(raw, _keys, 'alert');
    if (raw['v'] != 1) _fail('v');
    final e = raw['event'];
    if (e is! Map<String, dynamic>) _fail('event');
    _keysExact(e, _eventKeys, 'event');
    final voice = raw['voice'];
    if (voice is! Map<String, dynamic>) _fail('voice');
    _keysExact(voice, {'speak_name'}, 'voice');
    _bool(voice['speak_name'], 'voice.speak_name');

    _str(e['id'], 'event.id', _reUuid);
    _enum(e['type'], 'event.type', hazardTypes);
    _num(e['magnitude'], 'event.magnitude', -2, 10);
    _str(e['mag_type'], 'event.mag_type', _reMagType);
    _place(e['place']);
    _num(e['lon'], 'event.lon', -180, 180);
    _num(e['lat'], 'event.lat', -90, 90);
    _num(e['depth_km'], 'event.depth_km', -100, 1000);
    if (e['mmi_estimated_regional'] != null) _num(e['mmi_estimated_regional'], 'mmi', 1, 12);
    final range = e['mmi_range'];
    if (range != null) {
      if (range is! List || range.length != 2) _fail('mmi_range');
      for (final v in range) {
        _num(v, 'mmi_range', 1, 12);
      }
    }
    _bool(e['tsunami'], 'event.tsunami');
    _enum(e['solution_status'], 'event.solution_status', _statuses);
    if (e['tea_regional_seconds'] != null) _int(e['tea_regional_seconds'], 'tea', 0, 600);

    return SignedAlert._(
      alertId: _str(raw['alert_id'], 'alert_id', _reAlertId),
      level: _enum(raw['level'], 'level', alertLevels),
      eventId: e['id'] as String,
      revisionSeq: _int(e['revision_seq'], 'event.revision_seq', 0, 10000),
      timeUtcMs: _int(e['time_utc_ms'], 'event.time_utc_ms', minEpochMs, _maxEpochMs),
      instruction: _enum(raw['instruction'], 'instruction', instructions),
      iatMs: _int(raw['iat_ms'], 'iat_ms', minEpochMs, _maxEpochMs),
      expMs: _int(raw['exp_ms'], 'exp_ms', minEpochMs, _maxEpochMs),
      serverTimeMs: _int(raw['server_time_ms'], 'server_time_ms', minEpochMs, _maxEpochMs),
      kid: _str(raw['kid'], 'kid', _reKid),
      sig: _str(raw['sig'], 'sig', _reSig),
      event: Map.unmodifiable(e),
    );
  }

  /// Cadena canónica v1 (contrato fijo).
  String canonicalString() =>
      ['v1', alertId, eventId, '$revisionSeq', '$timeUtcMs', '$iatMs', '$expMs', level, instruction].join('\n');
}

/// alert_id determinista = hex(sha256(event.id + ':' + revision_seq)).
String computeAlertId(String eventId, int revisionSeq) =>
    hash.sha256.convert(utf8.encode('$eventId:$revisionSeq')).toString();

List<int> _b64url(String s) => base64Url.decode(s.padRight((s.length + 3) ~/ 4 * 4, '='));

Future<bool> verifySignature(SignedAlert a, Map<String, String> publicKeysByKid) async {
  final pkB64 = publicKeysByKid[a.kid];
  if (pkB64 == null) return false;
  try {
    final pk = _b64url(pkB64);
    final sig = _b64url(a.sig);
    if (pk.length != 32 || sig.length != 64) return false;
    return await Ed25519().verify(
      utf8.encode(a.canonicalString()),
      signature: Signature(sig, publicKey: SimplePublicKey(pk, type: KeyPairType.ed25519)),
    );
  } on FormatException {
    return false;
  }
}

enum AlertAction { alarm, informative, drill, reconcile }

/// Decisión fail-safe ante un push (idéntica a TS/Go). RECONCILE = no alarmar por este push y
/// confirmar vía GET /v1/events por TLS; si el evento es real y crítico, alarmar con esa fuente.
/// [nowMs] debe venir corregido con el offset de reloj conocido.
Future<({AlertAction action, String reason})> classifyIncomingAlert(
  Object? raw,
  int nowMs,
  Map<String, String> publicKeysByKid,
) async {
  final SignedAlert a;
  try {
    a = SignedAlert.fromJson(raw);
  } on ContractError {
    return (action: AlertAction.reconcile, reason: 'schema');
  }
  if (a.expMs <= a.iatMs || a.expMs - a.iatMs > maxAlarmWindowMs) {
    return (action: AlertAction.reconcile, reason: 'validity-window');
  }
  if (computeAlertId(a.eventId, a.revisionSeq) != a.alertId) {
    return (action: AlertAction.reconcile, reason: 'alert-id');
  }
  if (!await verifySignature(a, publicKeysByKid)) return (action: AlertAction.reconcile, reason: 'signature');
  if (a.level == 'DRILL') return (action: AlertAction.drill, reason: 'drill');
  if (nowMs > a.expMs) return (action: AlertAction.informative, reason: 'expired');
  if (a.level == 'INFORMATIVE') return (action: AlertAction.informative, reason: 'level');
  return (action: AlertAction.alarm, reason: 'ok');
}
