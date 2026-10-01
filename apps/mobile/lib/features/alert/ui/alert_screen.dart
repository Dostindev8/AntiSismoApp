import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../core/i18n/strings.dart';
import '../../../core/theme/app_theme.dart';
import '../domain/alert_view.dart';
import '../domain/tts_service.dart';

/// Pantalla de alerta a pantalla completa. Sin animaciones decorativas (protocolo de pantallas críticas):
/// lo único que cambia es la cuenta atrás, una vez por segundo.
class AlertScreen extends ConsumerStatefulWidget {
  const AlertScreen({super.key, required this.view});

  final AlertView view;

  static const statusKey = 'alert.status', statusAtKey = 'alert.status.at';

  @override
  ConsumerState<AlertScreen> createState() => _AlertScreenState();
}

class _AlertScreenState extends ConsumerState<AlertScreen> {
  Timer? _ticker;
  int? _left;
  late final TtsService _tts;

  int _now() => ref.read(clockProvider)().millisecondsSinceEpoch;

  @override
  void initState() {
    super.initState();
    _tts = ref.read(ttsProvider);
    _left = widget.view.secondsLeft(_now());
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      final left = widget.view.secondsLeft(_now());
      if (left != _left) setState(() => _left = left);
      if (left == null) _ticker?.cancel();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _speak());
  }

  Future<void> _speak() async {
    if (!mounted) return;
    final settings = ref.read(settingsProvider);
    final text = alertVoiceText(ref.read(stringsProvider), widget.view, name: settings.name, secondsLeft: _left ?? 0);
    await _tts.speak(text, locale: settings.locale);
  }

  Future<void> _saveStatus(String status, AppStrings s) async {
    final prefs = ref.read(prefsProvider);
    await prefs.setString(AlertScreen.statusKey, status);
    await prefs.setInt(AlertScreen.statusAtKey, _now());
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(s.t('alert.statusSaved'))));
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _tts.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final v = widget.view;
    final title = s.t(v.tsunami ? 'alert.title.tsunami' : 'alert.title.earthquake');
    return Scaffold(
      backgroundColor: AppColors.bgDeep,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: ListView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              children: [
                _Header(title: title, drill: v.drill ? s.t('alerts.drill.title') : null),
                const SizedBox(height: AppSpacing.lg),
                Text(s.t('alert.instruction'), style: const TextStyle(color: AppColors.textMuted, fontSize: 16)),
                Semantics(
                  header: true,
                  child: Text(
                    s.t('instruction.${v.instruction}'),
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 30, fontWeight: FontWeight.w800, height: 1.15),
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                _Arrival(s: s, secondsLeft: _left),
                if (v.magnitude != null) ...[
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    '${s.t('alert.magnitude')}: ${s.t('alert.magnitudeValue', {'magnitude': v.magnitude!.toStringAsFixed(1)})}',
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 18, fontWeight: FontWeight.w600),
                  ),
                  if (v.place != null && v.place!.isNotEmpty)
                    Text(v.place!, style: const TextStyle(color: AppColors.textPrimary, fontSize: 16)),
                ],
                const SizedBox(height: AppSpacing.xl),
                _ActionButton(
                  key: const Key('alert.imOk'),
                  label: s.t('alert.imOk'),
                  icon: Icons.check_circle_outline,
                  background: AppColors.safeGreen,
                  foreground: AppColors.brandNavy,
                  onPressed: () => _saveStatus('ok', s),
                ),
                const SizedBox(height: AppSpacing.md),
                _ActionButton(
                  key: const Key('alert.needHelp'),
                  label: s.t('alert.needHelp'),
                  icon: Icons.support,
                  background: AppColors.surfaceHigh,
                  foreground: AppColors.textPrimary,
                  onPressed: () => _saveStatus('help', s),
                ),
                const SizedBox(height: AppSpacing.md),
                _ActionButton(
                  key: const Key('alert.callEmergency'),
                  label: s.t('alert.callEmergency'),
                  icon: Icons.call,
                  background: AppColors.alertRedStrong,
                  foreground: AppColors.textPrimary,
                  onPressed: () => context.push('/emergency'),
                ),
                const SizedBox(height: AppSpacing.lg),
                TextButton(
                  style: TextButton.styleFrom(foregroundColor: AppColors.textPrimary, minimumSize: const Size(64, 64)),
                  onPressed: () => context.canPop() ? context.pop() : context.go('/alerts'),
                  child: Text(s.t('alert.close'), style: const TextStyle(fontSize: 17)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.title, required this.drill});

  final String title;
  final String? drill;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(color: AppColors.alertRedStrong, borderRadius: BorderRadius.circular(AppRadius.lg)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (drill != null) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
                decoration: BoxDecoration(color: AppColors.warnAmber, borderRadius: BorderRadius.circular(AppRadius.sm)),
                child: Text(
                  drill!.toUpperCase(),
                  style: const TextStyle(color: AppColors.brandNavy, fontSize: 16, fontWeight: FontWeight.w800),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
            Row(
              children: [
                const Icon(Icons.warning_amber_rounded, color: AppColors.textPrimary, size: 40),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Semantics(
                    header: true,
                    liveRegion: true,
                    child: Text(
                      title,
                      style: const TextStyle(color: AppColors.textPrimary, fontSize: 26, fontWeight: FontWeight.w800),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      );
}

class _Arrival extends StatelessWidget {
  const _Arrival({required this.s, required this.secondsLeft});

  final AppStrings s;
  final int? secondsLeft;

  @override
  Widget build(BuildContext context) {
    final left = secondsLeft;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.textPrimary, width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(s.t('alert.arrival'), style: const TextStyle(color: AppColors.textPrimary, fontSize: 16)),
          Text(
            left == null ? s.t('alert.arrival.passed') : s.t('alert.arrival.seconds', {'seconds': left}),
            key: const Key('alert.arrival'),
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: left == null ? 20 : 48,
              fontWeight: FontWeight.w800,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          Text(s.t('alert.arrival.estimateNote'), style: const TextStyle(color: AppColors.textMuted, fontSize: 14)),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    super.key,
    required this.label,
    required this.icon,
    required this.background,
    required this.foreground,
    required this.onPressed,
  });

  final String label;
  final IconData icon;
  final Color background, foreground;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => FilledButton.icon(
        style: FilledButton.styleFrom(
          backgroundColor: background,
          foregroundColor: foreground,
          minimumSize: const Size.fromHeight(64),
          textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 20, fontWeight: FontWeight.w700),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
        ),
        icon: Icon(icon, size: 28),
        label: Text(label),
        onPressed: onPressed,
      );
}
