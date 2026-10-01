import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app/providers.dart';
import '../../app/widgets/state_view.dart';
import '../../core/theme/app_theme.dart';
import '../alert/ui/alert_screen.dart';

/// Pestaña Alertas: estado vacío honesto, último estado guardado y simulacro.
class AlertsTab extends ConsumerWidget {
  const AlertsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final locale = ref.watch(settingsProvider).locale;
    final prefs = ref.watch(prefsProvider);
    final status = prefs.getString(AlertScreen.statusKey);
    final at = prefs.getInt(AlertScreen.statusAtKey);
    return PageList(
      children: [
        StateView(icon: Icons.verified_outlined, title: s.t('alerts.none'), body: s.t('alerts.noneBody')),
        if (status != null && at != null) ...[
          const SizedBox(height: AppSpacing.lg),
          Card(
            child: ListTile(
              leading: Icon(status == 'ok' ? Icons.check_circle_outline : Icons.support, color: AppColors.accentCyan),
              title: Text(s.t(status == 'ok' ? 'alert.imOk' : 'alert.needHelp')),
              subtitle: Text(DateFormat.yMMMd(locale.replaceAll('-', '_')).add_Hm().format(
                    DateTime.fromMillisecondsSinceEpoch(at),
                  )),
            ),
          ),
        ],
        const SizedBox(height: AppSpacing.lg),
        StateView(
          icon: Icons.school_outlined,
          title: s.t('alerts.drill.title'),
          body: s.t('alerts.drill.body'),
          action: FilledButton.icon(
            key: const Key('alerts.drill.start'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
            onPressed: () => context.push('/alert/drill'),
            icon: const Icon(Icons.play_arrow),
            label: Text(s.t('alerts.drill.start')),
          ),
        ),
      ],
    );
  }
}

class EventsTab extends ConsumerWidget {
  const EventsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return PageList(
      children: [StateView(icon: Icons.inbox_outlined, title: s.t('events.empty'), body: s.t('events.emptyBody'))],
    );
  }
}

class MapTab extends ConsumerWidget {
  const MapTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return PageList(
      children: [StateView(icon: Icons.map_outlined, title: s.t('map.pending'), body: s.t('map.pendingBody'))],
    );
  }
}

class FamilyTab extends ConsumerWidget {
  const FamilyTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return PageList(
      children: [
        StateView(
          icon: Icons.group_outlined,
          title: s.t('family.pending'),
          body: s.t('family.pendingBody'),
          action: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
            onPressed: () => context.push('/emergency/card'),
            icon: const Icon(Icons.medical_information_outlined),
            label: Text(s.t('emergency.card.title')),
          ),
        ),
      ],
    );
  }
}

class GuidesTab extends ConsumerWidget {
  const GuidesTab({super.key});

  static const _sections = [
    (key: 'guides.before', items: 4, icon: Icons.inventory_2_outlined),
    (key: 'guides.during', items: 5, icon: Icons.shield_outlined),
    (key: 'guides.after', items: 5, icon: Icons.healing_outlined),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final text = Theme.of(context).textTheme;
    return PageList(
      children: [
        for (final sec in _sections) ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(sec.icon, color: AppColors.accentCyan),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Semantics(header: true, child: Text(s.t('${sec.key}.title'), style: text.titleLarge)),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  for (var i = 1; i <= sec.items; i++)
                    Padding(
                      padding: const EdgeInsets.only(top: AppSpacing.sm),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          ExcludeSemantics(child: Text('$i.', style: text.bodyLarge)),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(child: Text(s.t('${sec.key}.$i'), style: text.bodyLarge)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
        ],
      ],
    );
  }
}
