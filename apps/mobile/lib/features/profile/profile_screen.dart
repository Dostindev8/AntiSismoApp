import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../app/widgets/home_back_button.dart';
import '../../app/widgets/state_view.dart';
import '../../core/i18n/strings.dart';
import '../../core/theme/app_theme.dart';
import '../emergency/data/emergency_contacts.g.dart';

/// Perfil local: nombre para la voz, idioma y país de emergencias. Sin cuenta.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  late final _name = TextEditingController(text: ref.read(settingsProvider).name);

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final settings = ref.watch(settingsProvider);
    final ctrl = ref.read(settingsProvider.notifier);
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(leading: homeBackButton(context), title: Text(s.t('profile.title'))),
      body: PageList(
        children: [
          TextField(
            key: const Key('profile.name'),
            controller: _name,
            maxLength: 40,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(
              labelText: s.t('profile.name'),
              helperText: s.t('profile.nameHint'),
              helperMaxLines: 3,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          FilledButton(
            key: const Key('profile.save'),
            onPressed: () async {
              await ctrl.setName(_name.text);
              if (!context.mounted) return;
              ScaffoldMessenger.of(context)
                ..hideCurrentSnackBar()
                ..showSnackBar(SnackBar(content: Text(s.t('profile.saved'))));
            },
            child: Text(s.t('profile.save')),
          ),
          const SizedBox(height: AppSpacing.xl),
          DropdownButtonFormField<String>(
            key: const Key('profile.language'),
            initialValue: settings.locale,
            isExpanded: true,
            decoration: InputDecoration(labelText: s.t('profile.language'), border: const OutlineInputBorder()),
            items: [
              for (final l in supportedLocales) DropdownMenuItem(value: l, child: Text(s.t('language.$l'))),
            ],
            onChanged: (l) => l == null ? null : ctrl.setLocale(l),
          ),
          const SizedBox(height: AppSpacing.lg),
          DropdownButtonFormField<String>(
            key: const Key('profile.region'),
            initialValue: settings.region,
            isExpanded: true,
            hint: Text(s.t('emergency.region.choose')),
            decoration: InputDecoration(labelText: s.t('emergency.region.label'), border: const OutlineInputBorder()),
            items: [
              for (final r in emergencyContactsByRegion.keys)
                DropdownMenuItem(value: r, child: Text(s.t('emergency.region.$r'))),
            ],
            onChanged: (r) => r == null ? null : ctrl.setRegion(r),
          ),
          const SizedBox(height: AppSpacing.xl),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
            onPressed: () => context.push('/alert/drill'),
            icon: const Icon(Icons.school_outlined),
            label: Text(s.t('profile.drill')),
          ),
          const SizedBox(height: AppSpacing.xl),
          Text(s.t('profile.privacy'), style: text.bodySmall),
        ],
      ),
    );
  }
}
