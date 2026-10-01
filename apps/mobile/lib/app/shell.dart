import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/i18n/strings.dart';
import '../core/theme/app_theme.dart';
import 'providers.dart';

/// IA de navegación (ADR 0005): 5 pestañas, Perfil en el avatar y Emergencia siempre visible.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  static const _tabs = [
    (key: 'nav.tab.alerts', icon: Icons.notifications_none, selected: Icons.notifications),
    (key: 'nav.tab.events', icon: Icons.list_alt_outlined, selected: Icons.list_alt),
    (key: 'nav.tab.map', icon: Icons.map_outlined, selected: Icons.map),
    (key: 'nav.tab.family', icon: Icons.group_outlined, selected: Icons.group),
    (key: 'nav.tab.guides', icon: Icons.menu_book_outlined, selected: Icons.menu_book),
  ];

  void _select(int i) => shell.goBranch(i, initialLocation: i == shell.currentIndex);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final wide = MediaQuery.sizeOf(context).width >= AppBreakpoints.expanded;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: AppColors.brandNavy,
        foregroundColor: AppColors.textPrimary,
        title: Text(s.t(_tabs[shell.currentIndex].key)),
        actions: [
          _EmergencyAction(s: s),
          IconButton(
            key: const Key('nav.profile'),
            tooltip: s.t('nav.profile'),
            onPressed: () => context.push('/profile'),
            icon: const CircleAvatar(
              radius: 16,
              backgroundColor: AppColors.surfaceHigh,
              child: Icon(Icons.person, color: AppColors.textPrimary, size: 20),
            ),
          ),
          const SizedBox(width: AppSpacing.xs),
        ],
      ),
      body: wide
          ? Row(
              children: [
                NavigationRail(
                  selectedIndex: shell.currentIndex,
                  onDestinationSelected: _select,
                  labelType: NavigationRailLabelType.all,
                  destinations: [
                    for (final t in _tabs)
                      NavigationRailDestination(icon: Icon(t.icon), selectedIcon: Icon(t.selected), label: Text(s.t(t.key))),
                  ],
                ),
                const VerticalDivider(width: 1),
                Expanded(child: shell),
              ],
            )
          : shell,
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: shell.currentIndex,
              onDestinationSelected: _select,
              destinations: [
                for (final t in _tabs)
                  NavigationDestination(icon: Icon(t.icon), selectedIcon: Icon(t.selected), label: s.t(t.key)),
              ],
            ),
    );
  }
}

class _EmergencyAction extends StatelessWidget {
  const _EmergencyAction({required this.s});

  final AppStrings s;

  @override
  Widget build(BuildContext context) {
    final label = s.t('nav.emergency');
    final compact = MediaQuery.sizeOf(context).width < 420 || MediaQuery.textScalerOf(context).scale(1) > 1.3;
    final style = FilledButton.styleFrom(
      backgroundColor: AppColors.alertRedStrong,
      foregroundColor: AppColors.textPrimary,
      minimumSize: const Size(48, 48),
      textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w800),
    );
    void open() => context.push('/emergency');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
      child: compact
          ? Tooltip(
              message: label,
              child: FilledButton(
                key: const Key('nav.emergency'),
                style: style.copyWith(padding: const WidgetStatePropertyAll(EdgeInsets.zero)),
                onPressed: open,
                child: Semantics(label: label, excludeSemantics: true, child: const Icon(Icons.sos)),
              ),
            )
          : FilledButton.icon(
              key: const Key('nav.emergency'),
              style: style,
              onPressed: open,
              icon: const Icon(Icons.sos),
              label: Text(label),
            ),
    );
  }
}
