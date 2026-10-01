import 'dart:io';

import 'package:antisismo/core/i18n/messages.g.dart';
import 'package:flutter_test/flutter_test.dart';

/// Toda clave literal usada en lib/ existe en el locale base y en `en` (nunca una clave cruda en pantalla).
void main() {
  final literal = RegExp(r"""\.t\(\s*'([a-zA-Z0-9_.]+)'""");
  final keys = <String>{};
  for (final f in Directory('lib').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart'))) {
    for (final m in literal.allMatches(f.readAsStringSync())) {
      keys.add(m[1]!);
    }
  }

  test('scanner finds the UI keys', () => expect(keys.length, greaterThan(60)));

  for (final locale in [baseLocale, 'en']) {
    test('all literal keys exist in $locale', () {
      final missing = keys.where((k) => !messagesByLocale[locale]!.containsKey(k)).toList()..sort();
      expect(missing, isEmpty);
    });
  }

  test('dynamic key families resolve in both locales', () {
    final families = [
      for (final i in ['DROP_COVER_HOLD_ON', 'EVACUATE_HIGH_GROUND', 'FLOOD_MOVE_AWAY', 'FOLLOW_AUTHORITIES']) 'instruction.$i',
      for (final l in messagesByLocale.keys) 'language.$l',
      for (var i = 1; i <= 4; i++) 'emergency.script.$i',
      for (var i = 1; i <= 4; i++) 'guides.before.$i',
      for (var i = 1; i <= 5; i++) 'guides.during.$i',
      for (var i = 1; i <= 5; i++) 'guides.after.$i',
      for (final s in ['before', 'during', 'after']) 'guides.$s.title',
      for (final t in ['alerts', 'events', 'map', 'family', 'guides']) 'nav.tab.$t',
      'emergency.service.general',
      'alert.title.earthquake',
      'alert.title.tsunami',
    ];
    for (final locale in [baseLocale, 'en']) {
      final missing = families.where((k) => !messagesByLocale[locale]!.containsKey(k)).toList();
      expect(missing, isEmpty, reason: locale);
    }
  });
}
