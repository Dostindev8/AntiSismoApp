// Capturas de evidencia (docs/screenshots). No forman parte del gate:
//   flutter test screenshots --update-goldens
import 'dart:io';

import 'package:antisismo/features/emergency/data/location_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../test/helpers/harness.dart';

const _out = '../../../docs/screenshots';

Future<void> _loadFonts() async {
  Future<void> family(String name, List<String> files) async {
    final loader = FontLoader(name);
    for (final f in files) {
      loader.addFont(Future.value(ByteData.sublistView(File(f).readAsBytesSync())));
    }
    await loader.load();
  }

  await family('Inter', [
    for (final w in ['Regular', 'Medium', 'SemiBold']) 'assets/fonts/Inter-$w.ttf',
  ]);
  await family('Poppins', ['assets/fonts/Poppins-Bold.ttf', 'assets/fonts/Poppins-ExtraBold.ttf']);
  final root = Platform.environment['FLUTTER_ROOT']!;
  await family('MaterialIcons', ['$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf']);
}

Future<void> _precache(WidgetTester tester) async {
  await tester.runAsync(() async {
    for (final e in find.byType(Image).evaluate()) {
      await precacheImage((e.widget as Image).image, e);
    }
  });
  await tester.pump();
}

Future<void> _shot(WidgetTester tester, String name) async {
  await _precache(tester);
  await expectLater(find.byType(MaterialApp), matchesGoldenFile('$_out/$name.png'));
}

void _phone(WidgetTester tester, {Size size = const Size(390, 844)}) {
  tester.view
    ..devicePixelRatio = 2
    ..physicalSize = size * 2;
  addTearDown(tester.view.reset);
}

void main() {
  setUpAll(_loadFonts);

  testWidgets('01 splash', (tester) async {
    _phone(tester);
    await pumpApp(tester, settle: false);
    await tester.pump();
    await _precache(tester);
    await tester.pump(const Duration(milliseconds: 900));
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('$_out/01-splash.png'));
    await tester.pumpAndSettle();
  });

  testWidgets('02 welcome', (tester) async {
    _phone(tester);
    await pumpApp(tester, onboarded: false);
    await _shot(tester, '02-welcome');
  });

  testWidgets('03 alerts tab', (tester) async {
    _phone(tester);
    await pumpApp(tester, region: 'DO');
    await _shot(tester, '03-alertas');
  });

  testWidgets('04 alert screen (drill)', (tester) async {
    _phone(tester);
    await pumpApp(tester, prefs: {'settings.name': 'María'}, go: '/alert/drill');
    await _shot(tester, '04-alerta-simulacro');
  });

  testWidgets('05 emergency', (tester) async {
    _phone(tester);
    await pumpApp(tester, region: 'DO', go: '/emergency');
    await _shot(tester, '05-emergencia');
  });

  testWidgets('06 emergency location', (tester) async {
    _phone(tester);
    final deps = TestDeps()..location.result = const LocationFix(lat: 18.4861, lon: -69.9312, accuracyM: 12);
    await pumpApp(tester, region: 'DO', go: '/emergency', deps: deps);
    await reveal(tester, find.text('Obtener mi ubicación'));
    await tester.tap(find.text('Obtener mi ubicación'));
    await tester.pumpAndSettle();
    await reveal(tester, find.text('Compartir ubicación por SMS'));
    await _shot(tester, '06-emergencia-ubicacion');
  });

  testWidgets('07 medical card', (tester) async {
    _phone(tester);
    await pumpApp(tester, go: '/emergency/card');
    await tester.tap(find.text('Activar ficha de emergencia'));
    await tester.pumpAndSettle();
    await _shot(tester, '07-ficha-medica');
  });

  testWidgets('08 guides', (tester) async {
    _phone(tester);
    await pumpApp(tester, go: '/guides');
    await _shot(tester, '08-guias');
  });

  testWidgets('09 profile', (tester) async {
    _phone(tester);
    await pumpApp(tester, prefs: {'settings.name': 'María'}, region: 'DO', go: '/profile');
    await _shot(tester, '09-perfil');
  });

  testWidgets('10 english', (tester) async {
    _phone(tester);
    await pumpApp(tester, locale: 'en', region: 'DO');
    await _shot(tester, '10-english');
  });

  testWidgets('11 no telephony', (tester) async {
    _phone(tester, size: const Size(600, 960));
    final deps = TestDeps()..dialer.telephony = false;
    await pumpApp(tester, region: 'DO', go: '/emergency', deps: deps);
    await _shot(tester, '11-tablet-sin-telefonia');
  });

  testWidgets('12 desktop rail', (tester) async {
    tester.view
      ..devicePixelRatio = 1
      ..physicalSize = const Size(1280, 800);
    addTearDown(tester.view.reset);
    await pumpApp(tester, go: '/guides');
    await _shot(tester, '12-escritorio');
  });

  testWidgets('13 text 200% at 360', (tester) async {
    _phone(tester, size: const Size(360, 740));
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpApp(tester, region: 'DO', go: '/emergency');
    await _shot(tester, '13-texto-200');
  });
}
