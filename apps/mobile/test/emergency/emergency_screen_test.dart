import 'package:antisismo/core/geo/plus_code.dart';
import 'package:antisismo/features/emergency/data/location_provider.dart';
import 'package:antisismo/features/emergency/domain/emergency_dialer.dart';
import 'package:antisismo/features/emergency/ui/hold_to_call_button.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/harness.dart';

Future<void> _hold(WidgetTester tester) async {
  final btn = find.byType(HoldToCallButton);
  await reveal(tester, btn);
  final g = await tester.startGesture(tester.getCenter(btn));
  for (var i = 0; i < 13; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  await g.up();
  await tester.pumpAndSettle();
}

void main() {
  const disclaimer = 'AntiSismo no reemplaza a los servicios oficiales de emergencia';

  group('QA-E6: loads with no backend, no account and no network', () {
    testWidgets('unknown region ⇒ asks for the country; never assumes a number', (tester) async {
      await pumpApp(tester, go: '/emergency');
      expect(find.text(disclaimer), findsOneWidget);
      expect(find.text('Elige tu país para ver el número de emergencias'), findsOneWidget);
      expect(find.byType(HoldToCallButton), findsNothing);
      await tester.tap(find.text('República Dominicana'));
      await tester.pumpAndSettle();
      expect(find.byType(HoldToCallButton), findsOneWidget);
      expect(find.text('911'), findsOneWidget);
      expect(find.textContaining('Número verificado · Fuente: Sistema Nacional de Atención'), findsOneWidget);
    });

    testWidgets('reachable from every tab through the persistent Emergency button', (tester) async {
      await pumpApp(tester, region: 'DO');
      for (final tab in ['Eventos', 'Mapa', 'Familia', 'Guías', 'Alertas']) {
        await tester.tap(find.text(tab).last);
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('nav.emergency')), findsOneWidget, reason: tab);
      }
      await tester.tap(find.byKey(const Key('nav.emergency')));
      await tester.pumpAndSettle();
      expect(find.text(disclaimer), findsOneWidget);
    });
  });

  group('QA-E4: fake dialer, airplane mode', () {
    testWidgets('hold opens the system dialer with the TEST number, never the real one', (tester) async {
      final (_, d) = await pumpApp(tester, region: 'DO', go: '/emergency');
      expect(find.text('Modo de prueba: se marcará el número de prueba $testDialNumber'), findsOneWidget);
      await _hold(tester);
      expect(d.dialer.dialed, [testDialNumber]);
      expect(d.dialer.dialed, isNot(contains('911')));
      expect(find.text('Marcador abierto con el $testDialNumber. Pulsa llamar en tu teléfono.'), findsOneWidget);
    });

    testWidgets('debug build without a test number: call disabled, nothing is dialed', (tester) async {
      final deps = TestDeps()..dialTarget = null;
      await pumpApp(tester, region: 'DO', go: '/emergency', deps: deps);
      expect(find.text('Compilación de desarrollo sin número de prueba: la llamada está desactivada'), findsOneWidget);
      await _hold(tester);
      expect(deps.dialer.dialed, isEmpty);
    });

    testWidgets('dialer failure is reported with the number to dial manually', (tester) async {
      final deps = TestDeps()..dialer.outcome = DialOutcome.failed;
      await pumpApp(tester, region: 'DO', go: '/emergency', deps: deps);
      await _hold(tester);
      expect(find.text('No se pudo abrir el marcador. Marca el 911 manualmente.'), findsOneWidget);
    });

    testWidgets('operator script and location without network: Plus Code + lat/lon + SMS (user sends)', (tester) async {
      final deps = TestDeps()..location.result = const LocationFix(lat: 18.4861, lon: -69.9312, accuracyM: 12);
      await pumpApp(tester, region: 'DO', go: '/emergency', deps: deps);
      await reveal(tester, find.textContaining('No cuelgues'));
      expect(find.text('Qué decirle al operador'), findsOneWidget);
      final get = find.text('Obtener mi ubicación');
      await reveal(tester, get);
      await tester.tap(get);
      await tester.pumpAndSettle();
      final code = encodePlusCode(18.4861, -69.9312);
      expect(code, '77CGF3P9+CG');
      expect(find.text(code), findsOneWidget);
      expect(find.text('18.48610, -69.93120'), findsOneWidget);
      expect(find.text('Precisión aproximada: 12 m'), findsOneWidget);
      final share = find.text('Compartir ubicación por SMS');
      await reveal(tester, share);
      await tester.tap(share);
      await tester.pumpAndSettle();
      expect(deps.dialer.sms, hasLength(1));
      expect(deps.dialer.sms.single.number, isNull, reason: 'the person chooses the recipient and presses send');
      expect(deps.dialer.sms.single.body, contains(code));
      expect(deps.dialer.sms.single.body, contains('18.48610, -69.93120'));
    });

    testWidgets('location denied / unavailable are explained, never block the screen', (tester) async {
      final deps = TestDeps()..location.result = const LocationDenied();
      await pumpApp(tester, region: 'DO', go: '/emergency', deps: deps);
      final get = find.text('Obtener mi ubicación');
      await reveal(tester, get);
      await tester.tap(get);
      await tester.pumpAndSettle();
      expect(find.textContaining('Permiso de ubicación denegado'), findsOneWidget);
      deps.location.result = const LocationUnavailable();
      await reveal(tester, get);
      await tester.tap(get);
      await tester.pumpAndSettle();
      expect(find.textContaining('Ubicación no disponible ahora'), findsOneWidget);
    });
  });

  group('QA-E5: device without telephony', () {
    testWidgets('shows the number, a copy button and a notice; no call button', (tester) async {
      final copied = <String>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') copied.add((call.arguments as Map)['text'] as String);
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      final deps = TestDeps()..dialer.telephony = false;
      await pumpApp(tester, region: 'DO', go: '/emergency', deps: deps);
      expect(find.byType(HoldToCallButton), findsNothing);
      expect(find.text('911'), findsOneWidget);
      expect(find.text('Este dispositivo no puede hacer llamadas. Marca el 911 desde un teléfono.'), findsOneWidget);
      await reveal(tester, find.text('Copiar número'));
      await tester.tap(find.text('Copiar número'));
      await tester.pumpAndSettle();
      expect(copied, ['911']);
      expect(find.text('Copiado'), findsOneWidget);
      expect(deps.dialer.dialed, isEmpty);
    });
  });

  group('responsive + text 200%', () {
    for (final size in responsiveSizes) {
      testWidgets('emergency screen ${size.width.toInt()}x${size.height.toInt()} @2x', (tester) async {
        setSurface(tester, size, textScale: 2);
        await pumpApp(tester, region: 'DO', go: '/emergency');
        expect(tester.takeException(), isNull);
        expect(find.text(disclaimer), findsOneWidget);
      });
    }
  });
}
