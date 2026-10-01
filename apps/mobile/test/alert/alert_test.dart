import 'dart:convert';
import 'dart:io';

import 'package:antisismo/app/app_config.dart';
import 'package:antisismo/core/contract/contract.dart';
import 'package:antisismo/core/geo/arrival.dart';
import 'package:antisismo/core/i18n/strings.dart';
import 'package:antisismo/features/alert/domain/alert_view.dart';
import 'package:antisismo/features/alert/ui/alert_screen.dart';
import 'package:antisismo/features/emergency/ui/hold_to_call_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../helpers/harness.dart';

Map<String, dynamic> _case(String name) {
  final v = jsonDecode(File('../../packages/proto/fixtures/alert-vectors.json').readAsStringSync()) as Map<String, dynamic>;
  return (v['cases'] as List).cast<Map<String, dynamic>>().firstWhere((c) => c['name'] == name);
}

void main() {
  final es = AppStrings('es-DO');
  final en = AppStrings('en');
  final critical = SignedAlert.fromJson(_case('valid-critical')['alert']);
  const deviceNow = 1790627530000;

  group('AlertView from a verified SignedAlert (shared contract fixtures)', () {
    test('fixture is a genuine ALARM per the contract', () async {
      final v = jsonDecode(File('../../packages/proto/fixtures/alert-vectors.json').readAsStringSync()) as Map<String, dynamic>;
      final keys = (v['public_keys'] as Map<String, dynamic>).cast<String, String>();
      final r = await classifyIncomingAlert(_case('valid-critical')['alert'], deviceNow, keys);
      expect(r.action, AlertAction.alarm);
    });

    test('no location ⇒ regional TEA from decision time (iat + 12 s), corrected by server clock offset', () {
      final view = AlertView.fromSignedAlert(critical, deviceNowMs: deviceNow);
      expect(view.drill, isFalse);
      expect(view.magnitude, 6.8);
      expect(view.place, 'Frente a la costa norte de República Dominicana');
      expect(view.clockOffsetMs, critical.serverTimeMs - deviceNow);
      expect(view.secondsLeft(deviceNow), 12);
      expect(view.secondsLeft(deviceNow + 11900), isNull, reason: 'already arrived ⇒ never a negative countdown');
    });

    test('with location ⇒ same model as estimateArrivalSeconds (on device, never sent)', () {
      const lat = 18.4861, lon = -69.9312;
      final view = AlertView.fromSignedAlert(critical, deviceNowMs: deviceNow, userLat: lat, userLon: lon);
      final expected = estimateArrivalSeconds(
        epicentralKm: haversineKm(lat, lon, 19.7, -69.9),
        depthKm: 35,
        originUtcMs: critical.timeUtcMs,
        deviceNowMs: deviceNow,
        clockOffsetMs: critical.serverTimeMs - deviceNow,
      );
      expect(view.secondsLeft(deviceNow), expected);
      final atEpicenter = AlertView.fromSignedAlert(critical, deviceNowMs: deviceNow, userLat: 19.7, userLon: -69.9);
      expect(atEpicenter.secondsLeft(deviceNow), 8, reason: '35 km / 3.5 km/s = 10 s after origin; 2.1 s elapsed');
    });

    test('DRILL level maps to drill view', () {
      final drill = SignedAlert.fromJson(_case('drill-never-critical (QA-23)')['alert']);
      expect(AlertView.fromSignedAlert(drill, deviceNowMs: deviceNow).drill, isTrue);
    });
  });

  group('voice text (mandated template)', () {
    final view = AlertView.fromSignedAlert(critical, deviceNowMs: deviceNow);
    test('named, with time', () {
      expect(
        alertVoiceText(es, view, name: ' Ana ', secondsLeft: 12),
        'Ana, esto no es un simulacro. Favor tomar las acciones correspondientes. Agáchate, cúbrete y sujétate. '
        'Tiempo estimado de arribo: 12 segundos.',
      );
    });
    test('named, wave already arrived ⇒ no countdown sentence', () {
      final t = alertVoiceText(es, view, name: 'Ana', secondsLeft: 0);
      expect(t, startsWith('Ana, esto no es un simulacro.'));
      expect(t, isNot(contains('segundos')));
    });
    test('anonymous variants never leave an empty name', () {
      expect(alertVoiceText(es, view, name: '', secondsLeft: 9), isNot(startsWith(',')));
      expect(alertVoiceText(es, view, name: '', secondsLeft: 9), contains('9 segundos'));
      expect(alertVoiceText(es, view, name: '', secondsLeft: 0), isNot(contains('segundos')));
    });
    test('drill always announces itself as a drill', () {
      final drill = AlertView.drill(deviceNowMs: 0, countdownSeconds: 10);
      expect(alertVoiceText(es, drill, name: 'Ana', secondsLeft: 10), startsWith('Esto es un simulacro.'));
      expect(alertVoiceText(es, drill, name: '', secondsLeft: 10), startsWith('Esto es un simulacro.'));
      expect(alertVoiceText(en, drill, name: '', secondsLeft: 10), startsWith('This is a drill.'));
    });
    test('English', () {
      expect(alertVoiceText(en, view, name: 'Ana', secondsLeft: 5), startsWith('Ana, this is not a drill.'));
    });
  });

  group('AlertScreen (drill, full app)', () {
    testWidgets('drill: labelled, counts down, speaks once with the name, no magnitude invented', (tester) async {
      final (_, d) = await pumpApp(tester, prefs: {'settings.name': 'Ana'}, go: '/alert/drill');
      expect(find.text('SIMULACRO'), findsOneWidget);
      expect(find.text('Agáchate, cúbrete y sujétate'), findsOneWidget);
      expect(find.text('${AppConfig.drillCountdownSeconds} s'), findsOneWidget);
      expect(find.textContaining('Magnitud'), findsNothing);
      expect(d.tts.spoken.single.text, 'Esto es un simulacro. Ana, practica: agáchate, cúbrete y sujétate.');
      expect(d.tts.spoken.single.locale, 'es-DO');
      d.now = d.now.add(const Duration(seconds: 3));
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('${AppConfig.drillCountdownSeconds - 3} s'), findsOneWidget);
      d.now = d.now.add(const Duration(seconds: 30));
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('La onda principal ya pudo haber llegado'), findsOneWidget);
    });

    testWidgets('“Estoy bien” and “Necesito ayuda” save status locally', (tester) async {
      await pumpApp(tester, go: '/alert/drill');
      await tester.tap(find.byKey(const Key('alert.imOk')));
      await tester.pumpAndSettle();
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(AlertScreen.statusKey), 'ok');
      expect(find.text('Guardamos tu estado en este teléfono'), findsOneWidget);
      final help = find.byKey(const Key('alert.needHelp'));
      await reveal(tester, help);
      await tester.tap(help);
      await tester.pumpAndSettle();
      expect(prefs.getString(AlertScreen.statusKey), 'help');
    });

    testWidgets('“Llamar a emergencias” opens the F5B module (never dials directly)', (tester) async {
      final (_, d) = await pumpApp(tester, region: 'DO', go: '/alert/drill');
      final call = find.byKey(const Key('alert.callEmergency'));
      await reveal(tester, call);
      await tester.tap(call);
      await tester.pumpAndSettle();
      expect(find.byType(HoldToCallButton), findsOneWidget);
      expect(d.dialer.dialed, isEmpty);
    });

    testWidgets('closing stops the voice', (tester) async {
      final (_, d) = await pumpApp(tester, go: '/alerts');
      await reveal(tester, find.byKey(const Key('alerts.drill.start')));
      await tester.tap(find.byKey(const Key('alerts.drill.start')));
      await tester.pumpAndSettle();
      final close = find.text('Cerrar');
      await reveal(tester, close);
      await tester.tap(close);
      await tester.pumpAndSettle();
      expect(d.tts.stops, greaterThanOrEqualTo(1));
      expect(find.text('Sin alertas activas en tu zona'), findsOneWidget);
    });

    for (final size in responsiveSizes) {
      testWidgets('alert screen ${size.width.toInt()}x${size.height.toInt()} @2x has no overflow', (tester) async {
        setSurface(tester, size, textScale: 2);
        await pumpApp(tester, go: '/alert/drill');
        expect(tester.takeException(), isNull);
      });
    }
  });
}
