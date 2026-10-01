import 'dart:ui' show PlatformDispatcher;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/i18n/strings.dart';
import '../core/platform/secure_screen.dart';
import '../features/alert/domain/tts_service.dart';
import '../features/emergency/data/emergency_contacts.g.dart';
import '../features/emergency/data/location_provider.dart';
import '../features/emergency/data/medical_card.dart';
import '../features/emergency/domain/emergency_dialer.dart';

/// Inyectado en main() (y en pruebas con SharedPreferences.setMockInitialValues).
final prefsProvider = Provider<SharedPreferences>((ref) => throw StateError('prefsProvider not overridden'));

class AppSettings {
  const AppSettings({required this.locale, required this.name, required this.region, required this.onboarded});

  final String locale;
  final String name;

  /// `null` ⇒ región desconocida: la pantalla de emergencia exige elegirla (nunca se asume un número).
  final String? region;
  final bool onboarded;

  AppSettings copyWith({String? locale, String? name, String? region, bool? onboarded}) => AppSettings(
        locale: locale ?? this.locale,
        name: name ?? this.name,
        region: region ?? this.region,
        onboarded: onboarded ?? this.onboarded,
      );
}

/// Locale soportado más cercano al del dispositivo (es-DO por defecto).
String resolveLocale(String? languageCode, String? countryCode) {
  final full = '$languageCode-$countryCode';
  if (supportedLocales.contains(full)) return full;
  return languageCode == 'en' ? 'en' : baseLocale;
}

/// Región con contactos verificados según el país del dispositivo; `null` si no hay certeza.
String? resolveRegion(String? countryCode) =>
    countryCode != null && emergencyContactsByRegion.containsKey(countryCode) ? countryCode : null;

class SettingsController extends Notifier<AppSettings> {
  static const _kLocale = 'settings.locale', _kName = 'settings.name', _kRegion = 'settings.region';
  static const _kOnboarded = 'settings.onboarded';

  SharedPreferences get _prefs => ref.read(prefsProvider);

  @override
  AppSettings build() {
    final p = ref.watch(prefsProvider);
    final device = PlatformDispatcher.instance.locale;
    final storedLocale = p.getString(_kLocale);
    final storedRegion = p.getString(_kRegion);
    return AppSettings(
      locale: storedLocale != null && supportedLocales.contains(storedLocale)
          ? storedLocale
          : resolveLocale(device.languageCode, device.countryCode),
      name: p.getString(_kName) ?? '',
      region: storedRegion != null && emergencyContactsByRegion.containsKey(storedRegion)
          ? storedRegion
          : resolveRegion(device.countryCode),
      onboarded: p.getBool(_kOnboarded) ?? false,
    );
  }

  Future<void> setName(String name) async {
    final n = name.trim();
    await _prefs.setString(_kName, n.length > 40 ? n.substring(0, 40) : n);
    state = state.copyWith(name: _prefs.getString(_kName));
  }

  Future<void> setLocale(String locale) async {
    if (!supportedLocales.contains(locale)) return;
    await _prefs.setString(_kLocale, locale);
    state = state.copyWith(locale: locale);
  }

  Future<void> setRegion(String region) async {
    if (!emergencyContactsByRegion.containsKey(region)) return;
    await _prefs.setString(_kRegion, region);
    state = state.copyWith(region: region);
  }

  Future<void> completeOnboarding() async {
    await _prefs.setBool(_kOnboarded, true);
    state = state.copyWith(onboarded: true);
  }
}

final settingsProvider = NotifierProvider<SettingsController, AppSettings>(SettingsController.new);

final stringsProvider = Provider<AppStrings>((ref) => AppStrings(ref.watch(settingsProvider).locale));

final dialerProvider = Provider<EmergencyDialer>((ref) => const UrlLauncherDialer());
final dialTargetProvider = Provider<({String? number, bool isTest}) Function(String official)>(
  (ref) => (official) => resolveDialTarget(official: official),
);
final locationProvider = Provider<LocationProvider>((ref) => const GeolocatorLocationProvider());
final ttsProvider = Provider<TtsService>((ref) => FlutterTtsService());
final secureScreenProvider = Provider<SecureScreen>((ref) => const ChannelSecureScreen());
final vaultProvider = Provider<MedicalCardVault>(
  (ref) => MedicalCardVault(keys: const SecureKeyStore(), blobs: PrefsBlobStore(ref.watch(prefsProvider))),
);
final clockProvider = Provider<DateTime Function()>((ref) => DateTime.now);
