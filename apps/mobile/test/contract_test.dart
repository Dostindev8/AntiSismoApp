import 'dart:convert';
import 'dart:io';

import 'package:antisismo/core/contract/contract.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _fixture(String name) =>
    jsonDecode(File('../../packages/proto/fixtures/$name').readAsStringSync()) as Map<String, dynamic>;

void main() {
  final events = _fixture('events.json');
  final vectors = _fixture('alert-vectors.json');
  final keys = (vectors['public_keys'] as Map<String, dynamic>).cast<String, String>();

  group('NormalizedEvent (same fixtures as TS/Go)', () {
    for (final f in (events['valid'] as List).cast<Map<String, dynamic>>()) {
      test('valid: ${f['name']}', () => expect(() => NormalizedEvent.fromJson(f['event']), returnsNormally));
    }
    for (final f in (events['invalid'] as List).cast<Map<String, dynamic>>()) {
      test('invalid: ${f['name']}', () => expect(() => NormalizedEvent.fromJson(f['event']), throwsA(isA<ContractError>())));
    }
  });

  group('SignedAlert + Ed25519', () {
    final canonical = vectors['canonical'] as Map<String, dynamic>;

    test('alert_id = sha256(event.id:revision_seq)', () {
      expect(computeAlertId(canonical['event_id'] as String, canonical['revision_seq'] as int), canonical['alert_id']);
    });

    test('canonical string matches TS generator', () {
      final valid = (vectors['cases'] as List).cast<Map<String, dynamic>>().firstWhere((c) => c['name'] == 'valid-critical');
      expect(SignedAlert.fromJson(valid['alert']).canonicalString(), canonical['string']);
    });

    final seen = <AlertAction>{};
    for (final c in (vectors['cases'] as List).cast<Map<String, dynamic>>()) {
      test('decision: ${c['name']}', () async {
        final r = await classifyIncomingAlert(c['alert'], c['now_ms'] as int, keys);
        seen.add(r.action);
        expect(r.action.name.toUpperCase(), c['expect'], reason: r.reason);
      });
    }
    test('vectors cover every action', () => expect(seen, AlertAction.values.toSet()));
  });
}
