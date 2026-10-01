import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:antisismo/core/geo/arrival.dart';
import 'package:antisismo/core/i18n/strings.dart';
import 'package:antisismo/core/theme/app_tokens.g.dart';
import 'package:antisismo/core/time/event_time.dart';
import 'package:antisismo/features/alert/domain/idempotency.dart';
import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

const t0 = 1790627527000; // 2026-09-28T20:32:07Z (§3#1)

double _contrast(Color a, Color b) {
  final la = a.computeLuminance(), lb = b.computeLuminance();
  return (max(la, lb) + 0.05) / (min(la, lb) + 0.05);
}

void main() {
  setUpAll(() async {
    tzdata.initializeTimeZones();
    await initializeDateFormatting('es');
  });

  group('event time (QA-19)', () {
    test('RD: long date + local + UTC 24h', () {
      final f = formatEventTime(t0, 'America/Santo_Domingo');
      expect(f.dateLong, 'lunes 28 de septiembre de 2026');
      expect(f.localTime, '16:32:07');
      expect(f.utcTime, '20:32:07');
    });
    test('changing zone changes local time only; UTC intact', () {
      final mx = formatEventTime(t0, 'America/Mexico_City');
      expect(mx.localTime, '14:32:07');
      expect(mx.utcTime, '20:32:07');
      final madrid = formatEventTime(t0, 'Europe/Madrid');
      expect(madrid.localTime, '22:32:07');
    });
    test('day rollover in local zone', () {
      final f = formatEventTime(DateTime.utc(2026, 9, 29, 2).millisecondsSinceEpoch, 'America/Santo_Domingo');
      expect(f.dateLong, 'lunes 28 de septiembre de 2026');
      expect(f.localTime, '22:00:00');
    });
  });

  group('arrival estimate (TEA on device)', () {
    test('haversine known distances', () {
      expect(haversineKm(0, 0, 1, 0), closeTo(111.195, 0.01));
      expect(haversineKm(18.4861, -69.9312, 19.4517, -70.6970), closeTo(134, 10));
      expect(haversineKm(10, 179.9, 10, -179.9), lessThan(25));
    });
    test('S-wave remaining seconds', () {
      // 105 km epicentral, 35 km depth ⇒ hypo ≈ 110.68 km ⇒ 31.62 s after origin
      final s = estimateArrivalSeconds(epicentralKm: 105, depthKm: 35, originUtcMs: t0, deviceNowMs: t0 + 10000);
      expect(s, 22);
    });
    test('null when the wave already passed', () {
      expect(estimateArrivalSeconds(epicentralKm: 10, depthKm: 10, originUtcMs: t0, deviceNowMs: t0 + 60000), isNull);
    });
    test('QA-18: device clock +5 min corrected by clockOffset', () {
      const skew = 5 * 60 * 1000;
      final s = estimateArrivalSeconds(
        epicentralKm: 105, depthKm: 35, originUtcMs: t0, deviceNowMs: t0 + 10000 + skew, clockOffsetMs: -skew);
      expect(s, 22);
      final wrong = estimateArrivalSeconds(epicentralKm: 105, depthKm: 35, originUtcMs: t0, deviceNowMs: t0 + 10000 + skew);
      expect(wrong, isNull, reason: 'without offset the skewed clock would hide the warning');
    });
    test('rejects invalid input', () {
      expect(() => estimateArrivalSeconds(epicentralKm: -1, depthKm: 0, originUtcMs: t0, deviceNowMs: t0), throwsArgumentError);
    });
  });

  group('idempotency ledger', () {
    test('first alarm, duplicate, revision update, TTL', () {
      final l = AlertLedger();
      expect(l.register(alertId: 'a0', eventId: 'e', nowMs: t0), LedgerOutcome.firstAlarm);
      expect(l.register(alertId: 'a0', eventId: 'e', nowMs: t0 + 1), LedgerOutcome.duplicate);
      expect(l.register(alertId: 'a1', eventId: 'e', nowMs: t0 + 2), LedgerOutcome.revisionUpdate);
      expect(l.register(alertId: 'a0', eventId: 'e', nowMs: t0 + const Duration(days: 8).inMilliseconds), LedgerOutcome.firstAlarm);
    });
    test('restore keeps duplicates silent after app restart', () {
      final a = AlertLedger()..register(alertId: 'x', eventId: 'e', nowMs: t0);
      final b = AlertLedger()..restore(a.alertIds, a.alarmedEvents);
      expect(b.register(alertId: 'x', eventId: 'e', nowMs: t0 + 5), LedgerOutcome.duplicate);
    });
  });

  group('design tokens (generated from packages/config/tokens.json)', () {
    final tokens = jsonDecode(File('../../packages/config/tokens.json').readAsStringSync()) as Map<String, dynamic>;
    Color hex(String h) => Color(int.parse('FF${h.substring(1)}', radix: 16));

    test('AppColors match the single source of truth', () {
      final c = (tokens['colors'] as Map<String, dynamic>).cast<String, String>();
      expect(AppColors.brandNavy, hex(c['brandNavy']!));
      expect(AppColors.alertRedStrong, hex(c['alertRedStrong']!));
      expect(AppColors.safeGreen, hex(c['safeGreen']!));
      expect(AppColors.textMuted, hex(c['textMuted']!));
    });
    test('critical pairs pass WCAG AA', () {
      expect(_contrast(AppColors.textPrimary, AppColors.alertRedStrong), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColors.brandNavy, AppColors.safeGreen), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColors.alertRedText, AppColors.brandNavy), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColors.textMuted, AppColors.surface), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColors.textPrimary, AppColors.alertRed), lessThan(4.5), reason: '§3#19 ban stays justified');
    });
  });

  group('i18n', () {
    const voiceParams = {'name': 'Ana', 'instruction': 'Agáchate', 'seconds': 12};
    test('every Spanish locale resolves critical keys', () {
      for (final loc in supportedLocales.where((l) => l.startsWith('es-'))) {
        final s = AppStrings(loc);
        expect(s.t('alert.arrival'), 'Llegada estimada');
        expect(s.t('voice.drill', {'name': 'Ana'}), startsWith('Esto es un simulacro.'));
        final critical = s.t('voice.critical', voiceParams);
        expect(critical, contains('esto no es un simulacro.'), reason: loc);
        expect(critical, isNot(startsWith('Esto es un simulacro')), reason: loc);
        expect(s.t('sos.call', {'emergencyNumber': '911'}), 'Llamar al 911');
      }
    });
    test('critical voice uses the exact mandated template (es-DO)', () {
      expect(
        AppStrings('es-DO').t('voice.critical', voiceParams),
        'Ana, esto no es un simulacro. Favor tomar las acciones correspondientes. Agáchate. '
        'Tiempo estimado de arribo: 12 segundos.',
      );
    });
    test('English is a complete, separate locale', () {
      final s = AppStrings('en');
      expect(supportedLocales, contains('en'));
      expect(s.t('alert.arrival'), 'Estimated arrival');
      expect(s.t('voice.critical', voiceParams), startsWith('Ana, this is not a drill.'));
      expect(s.t('voice.drill', {'name': 'Ana'}), startsWith('This is a drill.'));
      expect(s.t('sos.call', {'emergencyNumber': '911'}), 'Call 911');
    });
  });
}