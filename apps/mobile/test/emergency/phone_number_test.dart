import 'package:antisismo/features/emergency/domain/emergency_dialer.dart';
import 'package:antisismo/features/emergency/domain/phone_number.dart';
import 'package:flutter_test/flutter_test.dart';

/// QA-E1: sanitización de números e inyección de URI.
void main() {
  group('isValidPhoneNumber', () {
    for (final n in ['911', '112', '+18095550100', '*123#', '5550100', '123456789012345']) {
      test('accepts $n', () => expect(isValidPhoneNumber(n), isTrue));
    }
    for (final n in [
      '',
      '91',
      '1234567890123456',
      '911;calc',
      '911&body=x',
      '911?x=1',
      'tel:911',
      '911\n',
      ' 911',
      '9 11',
      '911%00',
      '++911',
      '91+1',
      '٩١١',
      '911/../',
      'javascript:alert(1)',
    ]) {
      test('rejects ${n.replaceAll('\n', r'\n')}', () => expect(isValidPhoneNumber(n), isFalse));
    }
  });

  test('normalizePhoneInput strips only visual separators', () {
    expect(normalizePhoneInput('+1 (809) 555-0100'), '+18095550100');
    expect(normalizePhoneInput('809.555.0100'), '8095550100');
    expect(normalizePhoneInput('809-555-0100;x'), isNull);
    expect(normalizePhoneInput('abc'), isNull);
  });

  test('telUri builds tel: and refuses unsanitized input', () {
    expect(telUri('911').toString(), 'tel:911');
    expect(telUri('+18095550100').toString(), 'tel:+18095550100');
    expect(() => telUri('911;rm'), throwsArgumentError);
    expect(() => telUri('911?body=x'), throwsArgumentError);
  });

  test('smsUri encodes the body; the user always presses send', () {
    final uri = smsUri(body: 'Estoy en 77CGF3P9+CG & necesito ayuda #1');
    expect(uri.scheme, 'sms');
    expect(uri.path, '');
    expect(Uri.decodeComponent(uri.query.substring('body='.length)), 'Estoy en 77CGF3P9+CG & necesito ayuda #1');
    expect(uri.query, isNot(contains('&')));
    expect(smsUri(number: '5550100', body: 'x').path, '5550100');
    expect(() => smsUri(number: '555?body=evil', body: 'x'), throwsArgumentError);
  });

  group('resolveDialTarget (no automated test dials a real emergency number)', () {
    test('release dials the verified official number', () {
      expect(resolveDialTarget(official: '911', release: true, testNumber: ''), (number: '911', isTest: false));
    });
    test('release with an invalid official number disables the call', () {
      expect(resolveDialTarget(official: '9;1', release: true).number, isNull);
    });
    test('debug/staging dials only the configured test number', () {
      expect(resolveDialTarget(official: '911', release: false, testNumber: '5550100'), (number: '5550100', isTest: true));
    });
    test('debug without a valid test number disables the call', () {
      expect(resolveDialTarget(official: '911', release: false, testNumber: ''), (number: null, isTest: true));
      expect(resolveDialTarget(official: '911', release: false, testNumber: '55;0'), (number: null, isTest: true));
    });
    test('this test run is not a release build and has no real number configured', () {
      final t = resolveDialTarget(official: '911');
      expect(t.isTest, isTrue);
      expect(t.number, isNot('911'));
    });
  });
}
