import 'dart:convert';

import 'package:antisismo/features/emergency/data/medical_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/harness.dart';

void main() {
  const card = MedicalCard(
    bloodType: 'O+',
    allergies: 'Penicilina',
    medications: 'Ninguna',
    contactName: 'Ana',
    contactNumber: '+1 809 555 0100',
  );

  group('MedicalCardVault (AES-256-GCM, local only)', () {
    late MemoryKeyStore keys;
    late MemoryBlobStore blobs;
    late MedicalCardVault vault;
    setUp(() {
      keys = MemoryKeyStore();
      blobs = MemoryBlobStore();
      vault = MedicalCardVault(keys: keys, blobs: blobs);
    });

    test('empty by default (opt-in)', () async {
      expect(await vault.exists(), isFalse);
      expect(await vault.load(), isNull);
    });

    test('round trip; stored blob never contains plaintext', () async {
      await vault.save(card);
      expect(await vault.exists(), isTrue);
      final loaded = (await vault.load())!;
      expect(loaded.toJson(), card.toJson());
      final raw = base64Url.decode(blobs.value!);
      expect(raw.first, 1, reason: 'format version');
      expect(utf8.decode(raw, allowMalformed: true), isNot(contains('Penicilina')));
      expect(blobs.value, isNot(contains('Penicilina')));
      expect(base64Url.decode(keys.value!), hasLength(32));
    });

    test('fresh 96-bit nonce per write', () async {
      await vault.save(card);
      final a = base64Url.decode(blobs.value!).sublist(1, 13);
      await vault.save(card);
      final b = base64Url.decode(blobs.value!).sublist(1, 13);
      expect(a, isNot(b));
    });

    test('tampered ciphertext ⇒ VaultCorruptedException (never shows doubtful data)', () async {
      await vault.save(card);
      final raw = base64Url.decode(blobs.value!);
      raw[20] ^= 0x01;
      blobs.value = base64Url.encode(raw);
      expect(vault.load(), throwsA(isA<VaultCorruptedException>()));
    });

    test('wrong key, missing key, bad version or truncated blob ⇒ corrupted', () async {
      await vault.save(card);
      final good = blobs.value!;
      keys.value = base64Url.encode(List.filled(32, 7));
      await expectLater(vault.load(), throwsA(isA<VaultCorruptedException>()));
      keys.value = null;
      await expectLater(vault.load(), throwsA(isA<VaultCorruptedException>()));
      await vault.save(card);
      final raw = base64Url.decode(blobs.value!);
      raw[0] = 2;
      blobs.value = base64Url.encode(raw);
      await expectLater(vault.load(), throwsA(isA<VaultCorruptedException>()));
      blobs.value = good.substring(0, 8);
      await expectLater(vault.load(), throwsA(isA<VaultCorruptedException>()));
      blobs.value = 'not base64 !!';
      await expectLater(vault.load(), throwsA(isA<VaultCorruptedException>()));
    });

    test('delete removes blob and key', () async {
      await vault.save(card);
      await vault.delete();
      expect(blobs.value, isNull);
      expect(keys.value, isNull);
      expect(await vault.load(), isNull);
    });
  });

  test('MedicalCard: field limits and dialable contact allowlist', () {
    expect(card.dialableContact, '+18095550100');
    expect(const MedicalCard(contactNumber: '809;x').dialableContact, isNull);
    expect(const MedicalCard().dialableContact, isNull);
    expect(() => MedicalCard.fromJson({...card.toJson(), 'blood_type': 'X' * 9}), throwsFormatException);
    expect(() => MedicalCard.fromJson({...card.toJson(), 'allergies': 3}), throwsFormatException);
    expect(MedicalCard.maxLengths.text, 500);
  });

  group('MedicalCardScreen', () {
    testWidgets('opt-in with consent, encrypted save, screenshot protection on/off', (tester) async {
      final (_, d) = await pumpApp(tester, go: '/emergency/card');
      expect(d.secure.enabled, 1);
      expect(find.textContaining('Desactivada.'), findsOneWidget);
      await tester.tap(find.text('Activar ficha de emergencia'));
      await tester.pumpAndSettle();
      final save = find.byKey(const Key('card.save'));
      await reveal(tester, save);
      expect(tester.widget<ButtonStyleButton>(save).onPressed, isNull, reason: 'consent required');
      await tester.dragUntilVisible(
        find.widgetWithText(TextFormField, 'Grupo sanguíneo'),
        find.byType(Scrollable).first,
        const Offset(0, 200),
      );
      await tester.enterText(find.widgetWithText(TextFormField, 'Grupo sanguíneo'), 'O+');
      await tester.enterText(find.widgetWithText(TextFormField, 'Contacto de emergencia'), 'Ana');
      await tester.enterText(find.widgetWithText(TextFormField, 'Teléfono del contacto'), '809-555-0100');
      await reveal(tester, find.byType(CheckboxListTile));
      await tester.tap(find.byType(CheckboxListTile));
      await tester.pumpAndSettle();
      await reveal(tester, save);
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(find.text('Ficha guardada cifrada en este teléfono'), findsOneWidget);
      expect(d.blobs.value, isNotNull);
      expect(d.blobs.value, isNot(contains('Ana')));
      final loaded = await MedicalCardVault(keys: d.keys, blobs: d.blobs).load();
      expect(loaded!.contactNumber, '8095550100');

      final call = find.text('Llamar a Ana');
      await reveal(tester, call);
      await tester.tap(call);
      await tester.pumpAndSettle();
      expect(d.dialer.dialed, ['8095550100']);
      final sms = find.text('SMS a Ana');
      await reveal(tester, sms);
      await tester.tap(sms);
      await tester.pumpAndSettle();
      expect(d.dialer.sms.single.number, '8095550100');

      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(d.secure.disabled, 1);
      expect(find.text('AntiSismo no reemplaza a los servicios oficiales de emergencia'), findsOneWidget);
    });

    testWidgets('invalid contact number is rejected by the form', (tester) async {
      await pumpApp(tester, go: '/emergency/card');
      await tester.tap(find.text('Activar ficha de emergencia'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextFormField, 'Teléfono del contacto'), '809;rm');
      await reveal(tester, find.byType(CheckboxListTile));
      await tester.tap(find.byType(CheckboxListTile));
      await tester.pumpAndSettle();
      final save = find.byKey(const Key('card.save'));
      await reveal(tester, save);
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(find.text('Número no válido'), findsOneWidget);
    });

    testWidgets('corrupted vault ⇒ error state with delete, never shows data', (tester) async {
      final deps = TestDeps()..blobs.value = 'AQ';
      await pumpApp(tester, go: '/emergency/card', deps: deps);
      expect(find.text('No se pudo abrir la ficha cifrada en este teléfono'), findsOneWidget);
      await tester.tap(find.text('Borrar ficha'));
      await tester.pumpAndSettle();
      expect(deps.blobs.value, isNull);
      expect(find.text('Ficha borrada de este teléfono'), findsOneWidget);
      expect(find.text('Activar ficha de emergencia'), findsOneWidget);
    });

    testWidgets('existing card is decrypted and shown for editing', (tester) async {
      final deps = TestDeps();
      await MedicalCardVault(keys: deps.keys, blobs: deps.blobs).save(card);
      await pumpApp(tester, go: '/emergency/card', deps: deps);
      expect(find.text('O+'), findsOneWidget);
      expect(find.text('Penicilina'), findsOneWidget);
      expect(find.byType(CheckboxListTile), findsNothing);
    });
  });
}
