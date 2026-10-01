import 'dart:convert';
import 'dart:io';

import 'package:antisismo/app/providers.dart';
import 'package:antisismo/core/i18n/strings.dart';
import 'package:antisismo/features/emergency/data/emergency_contacts.g.dart';
import 'package:antisismo/features/emergency/domain/phone_number.dart';
import 'package:flutter_test/flutter_test.dart';

/// QA-E2: selección por región y datos verificados (el build falla con datos sin verificar: ver
/// scripts/lib/emergency-contacts.test.mjs y gen-tokens --check en el gate).
void main() {
  final dir = Directory('../../data/emergency_contacts');
  final files = dir.listSync().whereType<File>().where((f) => f.path.endsWith('.json')).toList();

  test('generated table matches data/emergency_contacts (no drift)', () {
    expect(files, isNotEmpty);
    final fromFiles = <String, List<String>>{};
    for (final f in files) {
      final d = jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
      fromFiles[d['region'] as String] = [
        for (final c in (d['contacts'] as List).cast<Map<String, dynamic>>()) '${c['service']}:${c['number']}',
      ];
    }
    expect(
      {for (final e in emergencyContactsByRegion.entries) e.key: [for (final c in e.value) '${c.service}:${c.number}']},
      fromFiles,
    );
  });

  for (final entry in emergencyContactsByRegion.entries) {
    group('region ${entry.key}', () {
      test('has at least one verified, dialable contact with an official https source', () {
        expect(entry.value, isNotEmpty);
        for (final c in entry.value) {
          expect(c.region, entry.key);
          expect(isValidPhoneNumber(c.number), isTrue, reason: c.number);
          expect(Uri.parse(c.sourceUrl).scheme, 'https');
          expect(c.sourceName.trim(), isNotEmpty);
          expect(DateTime.parse(c.verifiedAt).isUtc, isTrue);
          expect(c.version, greaterThanOrEqualTo(1));
        }
      });
      test('is labelled in es-DO and en', () {
        expect(AppStrings('es-DO').t('emergency.region.${entry.key}'), isNot('emergency.region.${entry.key}'));
        expect(AppStrings('en').t('emergency.region.${entry.key}'), isNot('emergency.region.${entry.key}'));
      });
    });
  }

  test('region comes from the device country only when verified data exists (never assumed)', () {
    expect(resolveRegion('DO'), 'DO');
    expect(resolveRegion('MX'), 'MX');
    expect(resolveRegion('US'), isNull);
    expect(resolveRegion(null), isNull);
  });

  test('locale resolution: es-DO default, en supported', () {
    expect(resolveLocale('es', 'DO'), 'es-DO');
    expect(resolveLocale('es', 'MX'), 'es-MX');
    expect(resolveLocale('en', 'US'), 'en');
    expect(resolveLocale('fr', 'FR'), 'es-DO');
    expect(resolveLocale(null, null), 'es-DO');
  });
}
