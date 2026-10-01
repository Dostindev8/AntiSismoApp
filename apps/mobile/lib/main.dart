import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

import 'app/providers.dart';
import 'app/router.dart';
import 'core/i18n/strings.dart';
import 'core/theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  tzdata.initializeTimeZones();
  await initializeDateFormatting();
  final prefs = await SharedPreferences.getInstance();
  runApp(ProviderScope(overrides: [prefsProvider.overrideWithValue(prefs)], child: const AntiSismoApp()));
}

/// `es-DO` → Locale('es','DO'); `en` → Locale('en').
Locale toLocale(String tag) {
  final p = tag.split('-');
  return Locale(p[0], p.length > 1 ? p[1] : null);
}

class AntiSismoApp extends ConsumerWidget {
  const AntiSismoApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = ref.watch(settingsProvider.select((s) => s.locale));
    final s = ref.watch(stringsProvider);
    return MaterialApp.router(
      title: s.t('app.name'),
      debugShowCheckedModeBanner: false,
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: ThemeMode.dark,
      locale: toLocale(locale),
      supportedLocales: [for (final l in supportedLocales) toLocale(l)],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
