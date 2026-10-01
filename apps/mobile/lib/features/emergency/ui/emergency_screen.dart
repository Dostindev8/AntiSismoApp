import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/app_config.dart';
import '../../../app/providers.dart';
import '../../../app/widgets/home_back_button.dart';
import '../../../core/geo/plus_code.dart';
import '../../../core/i18n/strings.dart';
import '../../../core/theme/app_theme.dart';
import '../data/emergency_contact.dart';
import '../data/emergency_contacts.g.dart';
import '../data/location_provider.dart';
import '../domain/emergency_dialer.dart';
import 'hold_to_call_button.dart';

/// Pantalla de emergencias (F5B): funciona sin red, sin cuenta y sin backend. Datos embebidos en el binario.
class EmergencyScreen extends ConsumerStatefulWidget {
  const EmergencyScreen({super.key});

  @override
  ConsumerState<EmergencyScreen> createState() => _EmergencyScreenState();
}

class _EmergencyScreenState extends ConsumerState<EmergencyScreen> {
  bool? _canDial;
  bool _choosingRegion = false;
  LocationResult? _location;
  bool _locating = false;

  @override
  void initState() {
    super.initState();
    _probeTelephony();
  }

  Future<void> _probeTelephony() async {
    bool can;
    try {
      can = await ref.read(dialerProvider).canDial();
    } on Exception {
      can = false;
    }
    if (mounted) setState(() => _canDial = can);
  }

  void _snack(String text) {
    final m = ScaffoldMessenger.of(context);
    m.hideCurrentSnackBar();
    m.showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _dial(String target, String shown) async {
    final s = ref.read(stringsProvider);
    DialOutcome outcome;
    try {
      outcome = await ref.read(dialerProvider).dial(target);
    } on Exception {
      outcome = DialOutcome.failed;
    }
    if (!mounted) return;
    switch (outcome) {
      case DialOutcome.opened:
        _snack(s.t('emergency.dialerOpened', {'number': target}));
      case DialOutcome.noTelephony:
        setState(() => _canDial = false);
        _snack(s.t('emergency.noTelephony', {'number': shown}));
      case DialOutcome.failed:
        _snack(s.t('emergency.dialFailed', {'number': shown}));
    }
  }

  Future<void> _copy(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) _snack(ref.read(stringsProvider).t('emergency.copied'));
  }

  Future<void> _locate() async {
    setState(() => _locating = true);
    final r = await ref.read(locationProvider).current();
    if (mounted) {
      setState(() {
        _location = r;
        _locating = false;
      });
    }
  }

  Future<void> _shareSms(LocationFix fix) async {
    final s = ref.read(stringsProvider);
    final lat = fix.lat.toStringAsFixed(5), lon = fix.lon.toStringAsFixed(5);
    final body = s.t('emergency.sms.body', {
      'plusCode': encodePlusCode(fix.lat, fix.lon),
      'lat': lat,
      'lon': lon,
      'mapUrl': '${AppConfig.mapLinkBase}$lat,$lon',
    });
    final ok = await ref.read(dialerProvider).openSms(body: body);
    if (!ok && mounted) _snack(s.t('state.error'));
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final region = ref.watch(settingsProvider).region;
    final contacts = region == null ? const <EmergencyContact>[] : emergencyContactsByRegion[region]!;
    final text = Theme.of(context).textTheme;
    return Scaffold(
      backgroundColor: AppColors.brandNavy,
      appBar: AppBar(
        backgroundColor: AppColors.brandNavy,
        foregroundColor: AppColors.textPrimary,
        leading: homeBackButton(context),
        title: Text(s.t('emergency.title')),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: ListView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              children: [
                _Disclaimer(text: s.t('emergency.disclaimer')),
                const SizedBox(height: AppSpacing.lg),
                if (region == null || _choosingRegion)
                  _RegionPicker(
                    strings: s,
                    selected: region,
                    onSelected: (r) async {
                      await ref.read(settingsProvider.notifier).setRegion(r);
                      if (mounted) setState(() => _choosingRegion = false);
                    },
                  )
                else
                  _RegionSummary(
                    label: '${s.t('emergency.region.label')}: ${s.t('emergency.region.$region')}',
                    action: s.t('emergency.region.choose'),
                    onChange: () => setState(() => _choosingRegion = true),
                  ),
                for (final c in contacts) ...[
                  const SizedBox(height: AppSpacing.lg),
                  _ContactCard(
                    contact: c,
                    target: ref.watch(dialTargetProvider)(c.number),
                    strings: s,
                    canDial: _canDial,
                    onDial: _dial,
                    onCopy: () => _copy(c.number),
                  ),
                ],
                const SizedBox(height: AppSpacing.xl),
                _Section(
                  title: s.t('emergency.script.title'),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var i = 1; i <= 4; i++)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: Text('$i. ${s.t('emergency.script.$i')}', style: text.bodyLarge),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                _Section(
                  title: s.t('emergency.location.title'),
                  child: _LocationBody(
                    strings: s,
                    loading: _locating,
                    result: _location,
                    onLocate: _locate,
                    onCopy: _copy,
                    onSms: _shareSms,
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                _BigButton(
                  icon: Icons.medical_information_outlined,
                  label: s.t('emergency.card.title'),
                  onPressed: () => context.push('/emergency/card'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Disclaimer extends StatelessWidget {
  const _Disclaimer({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Semantics(
        container: true,
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border.all(color: AppColors.textPrimary, width: 1.5),
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              children: [
                const Icon(Icons.info_outline, color: AppColors.textPrimary),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(text, style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600, fontSize: 16)),
                ),
              ],
            ),
          ),
        ),
      );
}

class _RegionPicker extends StatelessWidget {
  const _RegionPicker({required this.strings, required this.selected, required this.onSelected});
  final AppStrings strings;
  final String? selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final regions = emergencyContactsByRegion.keys.toList()..sort();
    return _Section(
      title: strings.t('emergency.region.choose'),
      child: Column(
        children: [
          for (final r in regions)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: _BigButton(
                icon: r == selected ? Icons.radio_button_checked : Icons.radio_button_off,
                label: strings.t('emergency.region.$r'),
                selected: r == selected,
                onPressed: () => onSelected(r),
              ),
            ),
        ],
      ),
    );
  }
}

class _RegionSummary extends StatelessWidget {
  const _RegionSummary({required this.label, required this.action, required this.onChange});
  final String label;
  final String action;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Expanded(child: Text(label, style: const TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w600))),
          ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 64, minWidth: 64),
            child: IconButton(
              tooltip: action,
              icon: const Icon(Icons.edit_location_alt_outlined, color: AppColors.textPrimary),
              onPressed: onChange,
            ),
          ),
        ],
      );
}

class _ContactCard extends StatelessWidget {
  const _ContactCard({
    required this.contact,
    required this.target,
    required this.strings,
    required this.canDial,
    required this.onDial,
    required this.onCopy,
  });

  final EmergencyContact contact;
  final ({String? number, bool isTest}) target;
  final AppStrings strings;
  final bool? canDial;
  final Future<void> Function(String target, String shown) onDial;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final s = strings;
    final n = contact.number;
    const white = TextStyle(color: AppColors.textPrimary, fontSize: 16);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(s.t('emergency.service.${contact.service}'), style: white.copyWith(fontSize: 20, fontWeight: FontWeight.w700)),
        const SizedBox(height: AppSpacing.sm),
        if (canDial == false)
          _NoTelephony(number: n, message: s.t('emergency.noTelephony', {'number': n}))
        else
          HoldToCallButton(
            number: n,
            caption: s.t('emergency.hold', {'number': n}),
            holdingCaption: s.t('emergency.holding'),
            semanticLabel: s.t('emergency.a11yCall', {'number': n}),
            semanticHint: s.t('emergency.a11yHint', {'number': n}),
            enabled: target.number != null && canDial == true,
            onConfirmed: () => onDial(target.number!, n),
          ),
        if (target.isTest) ...[
          const SizedBox(height: AppSpacing.sm),
          Text(
            target.number == null
                ? s.t('emergency.debugNoTestNumber')
                : s.t('emergency.testMode', {'number': target.number!}),
            style: white.copyWith(color: AppColors.warnAmber, fontWeight: FontWeight.w600),
          ),
        ],
        const SizedBox(height: AppSpacing.sm),
        Text(s.t('emergency.verifiedSource', {'source': contact.sourceName}), style: white.copyWith(fontSize: 14)),
        const SizedBox(height: AppSpacing.sm),
        _BigButton(icon: Icons.copy, label: s.t('emergency.copy'), onPressed: onCopy),
      ],
    );
  }
}

class _NoTelephony extends StatelessWidget {
  const _NoTelephony({required this.number, required this.message});
  final String number;
  final String message;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(AppRadius.xl)),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                number,
                style: const TextStyle(color: AppColors.textPrimary, fontFamily: 'Poppins', fontWeight: FontWeight.w800, fontSize: 48),
              ),
              Text(message, style: const TextStyle(color: AppColors.textPrimary, fontSize: 16)),
            ],
          ),
        ),
      );
}

class _LocationBody extends StatelessWidget {
  const _LocationBody({
    required this.strings,
    required this.loading,
    required this.result,
    required this.onLocate,
    required this.onCopy,
    required this.onSms,
  });

  final AppStrings strings;
  final bool loading;
  final LocationResult? result;
  final VoidCallback onLocate;
  final Future<void> Function(String) onCopy;
  final Future<void> Function(LocationFix) onSms;

  @override
  Widget build(BuildContext context) {
    final s = strings;
    const body = TextStyle(color: AppColors.textPrimary, fontSize: 16);
    if (loading) {
      return Row(
        children: [
          const SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 3)),
          const SizedBox(width: AppSpacing.md),
          Expanded(child: Text(s.t('emergency.location.loading'), style: body)),
        ],
      );
    }
    final r = result;
    final children = <Widget>[];
    switch (r) {
      case LocationFix():
        final plus = encodePlusCode(r.lat, r.lon);
        final latLon = '${r.lat.toStringAsFixed(5)}, ${r.lon.toStringAsFixed(5)}';
        children.addAll([
          Text(s.t('emergency.location.plusCode'), style: body),
          SelectableText(plus, style: body.copyWith(fontSize: 26, fontWeight: FontWeight.w700, fontFamily: 'Poppins')),
          const SizedBox(height: AppSpacing.sm),
          Text(s.t('emergency.location.latLon'), style: body),
          SelectableText(latLon, style: body.copyWith(fontSize: 20, fontWeight: FontWeight.w600)),
          Text(s.t('emergency.location.accuracy', {'meters': r.accuracyM.round()}), style: body.copyWith(fontSize: 14)),
          const SizedBox(height: AppSpacing.md),
          _BigButton(icon: Icons.copy, label: s.t('emergency.location.copy'), onPressed: () => onCopy('$plus · $latLon')),
          const SizedBox(height: AppSpacing.sm),
          _BigButton(icon: Icons.sms_outlined, label: s.t('emergency.sms.share'), onPressed: () => onSms(r)),
          const SizedBox(height: AppSpacing.sm),
        ]);
      case LocationDenied():
        children.addAll([Text(s.t('emergency.location.denied'), style: body), const SizedBox(height: AppSpacing.md)]);
      case LocationUnavailable():
        children.addAll([Text(s.t('emergency.location.unavailable'), style: body), const SizedBox(height: AppSpacing.md)]);
      case null:
        break;
    }
    children.add(_BigButton(icon: Icons.my_location, label: s.t('emergency.location.get'), onPressed: onLocate));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(AppRadius.lg)),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                header: true,
                child: Text(title, style: const TextStyle(color: AppColors.textPrimary, fontSize: 19, fontWeight: FontWeight.w700)),
              ),
              const SizedBox(height: AppSpacing.md),
              child,
            ],
          ),
        ),
      );
}

/// Botón secundario de la pantalla de emergencia: objetivo táctil ≥ 64 dp (F5B).
class _BigButton extends StatelessWidget {
  const _BigButton({required this.icon, required this.label, required this.onPressed, this.selected = false});
  final IconData icon;
  final String label;
  final VoidCallback onPressed;
  final bool selected;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 64),
          foregroundColor: AppColors.textPrimary,
          backgroundColor: selected ? AppColors.surfaceHigh : null,
          side: const BorderSide(color: AppColors.textPrimary, width: 1.5),
          alignment: Alignment.centerLeft,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
          textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 17, fontWeight: FontWeight.w600),
        ),
        icon: Icon(icon),
        label: Text(label),
        onPressed: onPressed,
      );
}
