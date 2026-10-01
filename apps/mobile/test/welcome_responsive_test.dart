import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers/harness.dart';

/// Matriz responsive §11 (subset F0): sin overflow ni texto cortado, con escala de texto hasta 2.0.
const _sizes = <Size>[
  Size(320, 568),
  Size(360, 640),
  Size(390, 844),
  Size(412, 915),
  Size(768, 1024),
  Size(1024, 768),
  Size(673, 841),
];

void main() {
  for (final size in _sizes) {
    for (final scale in [1.0, 1.5, 2.0]) {
      testWidgets('welcome ${size.width.toInt()}x${size.height.toInt()} @ text ${scale}x', (tester) async {
        setSurface(tester, size, textScale: scale);
        await pumpApp(tester, onboarded: false);
        expect(tester.takeException(), isNull, reason: 'layout overflow at $size x$scale');
        expect(find.text('Tu seguridad en cada paso'), findsOneWidget);
      });
    }
  }

  testWidgets('logo is exposed to screen readers and fits (BoxFit.contain)', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpApp(tester, onboarded: false);
    expect(find.bySemanticsLabel(RegExp('AntiSismo. Prevención · Alerta · Vida')), findsOneWidget);
    final img = tester.widget<Image>(find.byType(Image));
    expect(img.fit, BoxFit.contain);
    handle.dispose();
  });
}
