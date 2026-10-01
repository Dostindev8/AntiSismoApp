import 'package:antisismo/app/providers.dart';
import 'package:antisismo/app/router.dart';
import 'package:antisismo/core/platform/secure_screen.dart';
import 'package:antisismo/features/alert/domain/tts_service.dart';
import 'package:antisismo/features/emergency/data/location_provider.dart';
import 'package:antisismo/features/emergency/data/medical_card.dart';
import 'package:antisismo/features/emergency/domain/emergency_dialer.dart';
import 'package:antisismo/features/emergency/domain/phone_number.dart';
import 'package:antisismo/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 555-0100: rango NANP reservado para ficción. No es un número de emergencia en ningún país.
const testDialNumber = '5550100';

class FakeDialer implements EmergencyDialer {
  FakeDialer({this.telephony = true, this.outcome = DialOutcome.opened});

  bool telephony;
  DialOutcome outcome;
  final dialed = <String>[];
  final sms = <({String? number, String body})>[];

  @override
  Future<bool> canDial() async => telephony;

  @override
  Future<DialOutcome> dial(String number) async {
    telUri(number);
    dialed.add(number);
    return telephony ? outcome : DialOutcome.noTelephony;
  }

  @override
  Future<bool> openSms({String? number, required String body}) async {
    smsUri(number: number, body: body);
    sms.add((number: number, body: body));
    return true;
  }
}

class FakeTts implements TtsService {
  final spoken = <({String text, String locale})>[];
  int stops = 0;

  @override
  Future<bool> speak(String text, {required String locale}) async {
    spoken.add((text: text, locale: locale));
    return true;
  }

  @override
  Future<void> stop() async => stops++;
}

class FakeLocation implements LocationProvider {
  FakeLocation(this.result);
  LocationResult result;

  @override
  Future<LocationResult> current() async => result;
}

class FakeSecureScreen implements SecureScreen {
  int enabled = 0, disabled = 0;

  @override
  Future<void> enable() async => enabled++;
  @override
  Future<void> disable() async => disabled++;
}

class MemoryKeyStore implements KeyStore {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String keyB64) async => value = keyB64;
  @override
  Future<void> delete() async => value = null;
}

class MemoryBlobStore implements BlobStore {
  String? value;
  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String blob) async => value = blob;
  @override
  Future<void> delete() async => value = null;
}

class TestDeps {
  final dialer = FakeDialer();
  final tts = FakeTts();
  final location = FakeLocation(const LocationUnavailable());
  final secure = FakeSecureScreen();
  final keys = MemoryKeyStore();
  final blobs = MemoryBlobStore();
  DateTime now = DateTime.utc(2026, 10, 1, 12);

  /// `null` ⇒ resolución real (debug sin número de prueba ⇒ llamada desactivada).
  String? dialTarget = testDialNumber;
}

/// Monta la app completa (router real, splash incluido) sin red, sin backend y sin cuenta.
Future<(ProviderContainer, TestDeps)> pumpApp(
  WidgetTester tester, {
  Map<String, Object> prefs = const {},
  bool onboarded = true,
  String locale = 'es-DO',
  String? region,
  String? go,
  TestDeps? deps,
  bool settle = true,
}) async {
  final d = deps ?? TestDeps();
  SharedPreferences.setMockInitialValues({
    'settings.locale': locale,
    'settings.onboarded': onboarded,
    'settings.region': ?region,
    ...prefs,
  });
  final p = await SharedPreferences.getInstance();
  final container = ProviderContainer(
    overrides: [
      prefsProvider.overrideWithValue(p),
      dialerProvider.overrideWithValue(d.dialer),
      ttsProvider.overrideWithValue(d.tts),
      locationProvider.overrideWithValue(d.location),
      secureScreenProvider.overrideWithValue(d.secure),
      vaultProvider.overrideWithValue(MedicalCardVault(keys: d.keys, blobs: d.blobs)),
      clockProvider.overrideWithValue(() => d.now),
      if (d.dialTarget != null)
        dialTargetProvider.overrideWithValue((official) => (number: d.dialTarget, isTest: true)),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AntiSismoApp()));
  if (!settle) return (container, d);
  await tester.pumpAndSettle();
  if (go != null) {
    container.read(routerProvider).go(go);
    await tester.pumpAndSettle();
  }
  return (container, d);
}

/// Desplaza la lista principal (perezosa) hasta que [finder] existe y es visible.
Future<void> reveal(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 120, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

/// Matriz responsive común (360/375/600/840/1200, vertical y horizontal).
const responsiveSizes = <Size>[
  Size(320, 568),
  Size(360, 640),
  Size(375, 812),
  Size(600, 960),
  Size(840, 1200),
  Size(1200, 800),
  Size(812, 375),
];

void setSurface(WidgetTester tester, Size size, {double textScale = 1}) {
  tester.view
    ..devicePixelRatio = 1
    ..physicalSize = size;
  tester.platformDispatcher.textScaleFactorTestValue = textScale;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
}
