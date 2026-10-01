import 'dart:convert';
import 'dart:io';

import 'package:antisismo/core/geo/plus_code.dart';
import 'package:flutter_test/flutter_test.dart';

/// Vectores generados con la librería oficial de Google (openlocationcode, PyPI).
void main() {
  final fixture = jsonDecode(File('test/fixtures/plus_code_vectors.json').readAsStringSync()) as Map<String, dynamic>;
  final vectors = (fixture['vectors'] as List).cast<Map<String, dynamic>>();

  test('fixture is non-trivial', () => expect(vectors.length, greaterThanOrEqualTo(20)));

  for (final v in vectors) {
    test('${v['label']} (${v['lat']}, ${v['lon']}) → ${v['code']}', () {
      expect(encodePlusCode((v['lat'] as num).toDouble(), (v['lon'] as num).toDouble()), v['code']);
    });
  }
}
