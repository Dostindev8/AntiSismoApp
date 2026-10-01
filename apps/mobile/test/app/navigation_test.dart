import 'package:antisismo/app/router.dart';
import 'package:antisismo/app/widgets/brand_logo.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../helpers/harness.dart';

void main() {
  testWidgets('first run: splash → welcome → «Comenzar» → Alertas, no account required', (tester) async {
    await pumpApp(tester, onboarded: false);
    expect(find.text('Tu seguridad en cada paso'), findsOneWidget);
    await tester.tap(find.byKey(const Key('welcome.start')));
    await tester.pumpAndSettle();
    expect(find.text('Sin alertas activas en tu zona'), findsOneWidget);
    expect((await SharedPreferences.getInstance()).getBool('settings.onboarded'), isTrue);
  });

  testWidgets('returning user goes straight from splash to Alertas', (tester) async {
    await pumpApp(tester);
    expect(find.text('Sin alertas activas en tu zona'), findsOneWidget);
  });

  testWidgets('splash honours reduced motion (no animation, immediate)', (tester) async {
    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    await pumpApp(tester);
    expect(find.text('Sin alertas activas en tu zona'), findsOneWidget);
  });

  testWidgets('splash: official logo unaltered (BoxFit.contain, no tint), then navigates', (tester) async {
    await pumpApp(tester, settle: false);
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byType(BrandLogo), findsOneWidget);
    final img = tester.widget<Image>(find.byType(Image));
    expect((img.image as AssetImage).assetName, BrandLogo.asset);
    expect(img.fit, BoxFit.contain);
    expect(img.color, isNull, reason: 'never recoloured');
    final scale = tester.widget<ScaleTransition>(
      find.ancestor(of: find.byType(BrandLogo), matching: find.byType(ScaleTransition)).first,
    );
    expect(scale.scale.value, inInclusiveRange(1.0, 1.02));
    await tester.pumpAndSettle();
    expect(find.byType(BrandLogo), findsNothing);
    expect(find.text('Sin alertas activas en tu zona'), findsOneWidget);
  });

  testWidgets('five tabs with honest content; profile from the avatar', (tester) async {
    await pumpApp(tester);
    final expectations = {
      'Eventos': 'Aún no hay eventos guardados en este teléfono',
      'Mapa': 'Mapa offline en preparación',
      'Familia': 'Círculo familiar en preparación',
      'Guías': 'Durante el sismo',
      'Alertas': 'Sin alertas activas en tu zona',
    };
    for (final e in expectations.entries) {
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(e.key)));
      await tester.pumpAndSettle();
      expect(find.text(e.value), findsOneWidget, reason: e.key);
    }
    await tester.tap(find.byKey(const Key('nav.profile')));
    await tester.pumpAndSettle();
    expect(find.text('Tu nombre para la alerta por voz'), findsOneWidget);
  });

  testWidgets('profile: name is saved locally and language switches to English', (tester) async {
    await pumpApp(tester, go: '/profile');
    await tester.enterText(find.byKey(const Key('profile.name')), '  María  ');
    await tester.tap(find.byKey(const Key('profile.save')));
    await tester.pumpAndSettle();
    expect((await SharedPreferences.getInstance()).getString('settings.name'), 'María');
    expect(find.text('Guardado'), findsOneWidget);

    await tester.tap(find.byKey(const Key('profile.language')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('English').last);
    await tester.pumpAndSettle();
    expect(find.text('Profile'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('No active alerts in your area'), findsOneWidget);
    expect(find.descendant(of: find.byType(NavigationBar), matching: find.text('Guides')), findsOneWidget);
  });

  testWidgets('wide layout (≥ 840) uses a navigation rail', (tester) async {
    setSurface(tester, const Size(1200, 800));
    await pumpApp(tester);
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.text('Emergencia'), findsOneWidget, reason: 'labelled emergency button on wide screens');
  });

  group('responsive shell (every tab, text up to 200%)', () {
    for (final size in responsiveSizes) {
      for (final scale in [1.0, 2.0]) {
        testWidgets('${size.width.toInt()}x${size.height.toInt()} @${scale}x', (tester) async {
          setSurface(tester, size, textScale: scale);
          final (c, _) = await pumpApp(tester);
          for (final path in ['/alerts', '/events', '/map', '/family', '/guides', '/profile']) {
            c.read(routerProvider).go(path);
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull, reason: path);
          }
        });
      }
    }
  });
}
