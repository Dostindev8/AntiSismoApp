import 'package:antisismo/core/theme/app_theme.dart';
import 'package:antisismo/features/emergency/ui/hold_to_call_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';

/// QA-E3: mantener ~1 s confirma; soltar a medias cancela; alternativa accesible por acción semántica.
void main() {
  late int calls;
  setUp(() => calls = 0);

  /// Avanza en frames de 100 ms (el primer frame solo arranca el reloj de la animación, como en un dispositivo).
  Future<void> frames(WidgetTester tester, int ms) async {
    for (var t = 0; t < ms; t += 100) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> pump(WidgetTester tester, {bool enabled = true, double width = 360}) async {
    await tester.pumpWidget(MaterialApp(
      theme: buildDarkTheme(),
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: width,
            child: HoldToCallButton(
              number: '911',
              caption: 'Mantén pulsado para llamar al 911',
              holdingCaption: 'Sigue pulsando…',
              semanticLabel: 'Llamar al 911',
              semanticHint: 'Abre el marcador con el 911',
              enabled: enabled,
              onConfirmed: () => calls++,
            ),
          ),
        ),
      ),
    ));
  }

  testWidgets('a short tap never calls', (tester) async {
    await pump(tester);
    await tester.tap(find.byType(HoldToCallButton));
    await tester.pump(const Duration(seconds: 2));
    expect(calls, 0);
  });

  testWidgets('holding for the full duration calls exactly once, with progress feedback', (tester) async {
    await pump(tester);
    final g = await tester.startGesture(tester.getCenter(find.byType(HoldToCallButton)));
    await frames(tester, 500);
    expect(find.text('Sigue pulsando…'), findsOneWidget);
    expect(calls, 0);
    await frames(tester, 700);
    expect(calls, 1);
    await g.up();
    await tester.pump(const Duration(seconds: 2));
    expect(calls, 1);
    expect(find.text('Mantén pulsado para llamar al 911'), findsOneWidget);
  });

  testWidgets('releasing midway cancels and resets', (tester) async {
    await pump(tester);
    final g = await tester.startGesture(tester.getCenter(find.byType(HoldToCallButton)));
    await frames(tester, 800);
    await g.up();
    await tester.pump(const Duration(seconds: 2));
    expect(calls, 0);
    expect(find.text('Mantén pulsado para llamar al 911'), findsOneWidget);
  });

  testWidgets('pointer cancel (e.g. scroll steals the gesture) cancels', (tester) async {
    await pump(tester);
    final g = await tester.startGesture(tester.getCenter(find.byType(HoldToCallButton)));
    await tester.pump(const Duration(milliseconds: 400));
    await g.cancel();
    await tester.pump(const Duration(seconds: 2));
    expect(calls, 0);
  });

  testWidgets('screen reader: semantic tap (double-tap) is the accessible alternative', (tester) async {
    final handle = tester.ensureSemantics();
    await pump(tester);
    final node = tester.getSemantics(find.bySemanticsLabel('Llamar al 911'));
    expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
    expect(node.hint, 'Abre el marcador con el 911');
    tester.semantics.tap(find.semantics.byLabel('Llamar al 911'));
    await tester.pump();
    expect(calls, 1);
    handle.dispose();
  });

  testWidgets('disabled: neither hold nor semantic tap calls', (tester) async {
    final handle = tester.ensureSemantics();
    await pump(tester, enabled: false);
    final g = await tester.startGesture(tester.getCenter(find.byType(HoldToCallButton)));
    await tester.pump(const Duration(seconds: 2));
    await g.up();
    final node = tester.getSemantics(find.bySemanticsLabel('Llamar al 911'));
    expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isFalse);
    expect(calls, 0);
    handle.dispose();
  });

  for (final width in [240.0, 360.0, 600.0]) {
    testWidgets('touch target ≥ 64 dp and no overflow at width $width (text 2x)', (tester) async {
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await pump(tester, width: width);
      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.byType(HoldToCallButton)).height, greaterThanOrEqualTo(64));
    });
  }
}
