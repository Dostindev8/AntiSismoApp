import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

/// Estado vacío / en preparación / sin conexión con icono, título y explicación honesta.
class StateView extends StatelessWidget {
  const StateView({super.key, required this.icon, required this.title, required this.body, this.action});

  final IconData icon;
  final String title, body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 36, color: AppColors.accentCyan),
            const SizedBox(height: AppSpacing.md),
            Semantics(header: true, child: Text(title, style: text.titleLarge)),
            const SizedBox(height: AppSpacing.sm),
            Text(body, style: text.bodyLarge),
            if (action != null) ...[const SizedBox(height: AppSpacing.lg), action!],
          ],
        ),
      ),
    );
  }
}

/// Lista centrada con ancho máximo legible (responsive 320 → desktop).
class PageList extends StatelessWidget {
  const PageList({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: ListView(padding: const EdgeInsets.all(AppSpacing.lg), children: children),
        ),
      );
}
