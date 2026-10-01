import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../app/widgets/brand_logo.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/app_theme.dart';

/// Bienvenida de marca + compromiso de honestidad. «Comenzar» no pide cuenta ni permisos:
/// recibir alertas públicas nunca requiere registro.
class WelcomeScreen extends ConsumerWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = ref.watch(stringsProvider);
    final text = Theme.of(context).textTheme;
    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(gradient: appBackgroundGradient),
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, c) => SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl, vertical: AppSpacing.xl),
              child: Center(
                child: ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: 560, minHeight: c.maxHeight - 2 * AppSpacing.xl),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      BrandLogo(strings: strings, maxHeight: (c.maxHeight * 0.34).clamp(120, 280)),
                      const SizedBox(height: AppSpacing.xl),
                      Text(strings.t('app.hero'), textAlign: TextAlign.center, style: text.headlineMedium),
                      const SizedBox(height: AppSpacing.xl),
                      _HonestyCard(strings: strings),
                      const SizedBox(height: AppSpacing.xl),
                      FilledButton(
                        key: const Key('welcome.start'),
                        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
                        onPressed: () async {
                          await ref.read(settingsProvider.notifier).completeOnboarding();
                          if (context.mounted) context.go('/alerts');
                        },
                        child: Text(strings.t('onboarding.start')),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(
                        '${strings.t('attribution.usgs')} · ${strings.t('attribution.emsc')}',
                        textAlign: TextAlign.center,
                        style: text.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _HonestyCard extends StatelessWidget {
  const _HonestyCard({required this.strings});

  final AppStrings strings;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.verified_user_outlined, color: AppColors.safeGreen, size: 28),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(strings.t('honesty.title'), style: text.titleMedium),
                  const SizedBox(height: AppSpacing.xs),
                  Text(strings.t('honesty.body'), style: text.bodySmall),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
