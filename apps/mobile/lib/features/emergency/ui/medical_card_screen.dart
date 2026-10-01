import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/i18n/strings.dart';
import '../../../core/platform/secure_screen.dart';
import '../../../core/theme/app_theme.dart';
import '../data/medical_card.dart';
import '../domain/phone_number.dart';

enum _Phase { loading, off, editing, corrupted }

/// Ficha de emergencia: opt-in con consentimiento explícito, cifrada, solo local, protegida de capturas (Android).
class MedicalCardScreen extends ConsumerStatefulWidget {
  const MedicalCardScreen({super.key});

  @override
  ConsumerState<MedicalCardScreen> createState() => _MedicalCardScreenState();
}

class _MedicalCardScreenState extends ConsumerState<MedicalCardScreen> {
  final _form = GlobalKey<FormState>();
  final _blood = TextEditingController();
  final _allergies = TextEditingController();
  final _meds = TextEditingController();
  final _contactName = TextEditingController();
  final _contactNumber = TextEditingController();
  late final SecureScreen _secure = ref.read(secureScreenProvider);
  _Phase _phase = _Phase.loading;
  bool _consent = false;
  bool _stored = false;

  @override
  void initState() {
    super.initState();
    _secure.enable();
    _load();
  }

  Future<void> _load() async {
    try {
      final card = await ref.read(vaultProvider).load();
      if (!mounted) return;
      if (card == null) {
        setState(() => _phase = _Phase.off);
        return;
      }
      _blood.text = card.bloodType;
      _allergies.text = card.allergies;
      _meds.text = card.medications;
      _contactName.text = card.contactName;
      _contactNumber.text = card.contactNumber;
      setState(() {
        _phase = _Phase.editing;
        _consent = true;
        _stored = true;
      });
    } on VaultCorruptedException {
      if (mounted) setState(() => _phase = _Phase.corrupted);
    }
  }

  void _snack(String t) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(t)));

  Future<void> _save(AppStrings s) async {
    if (!_consent || !(_form.currentState?.validate() ?? false)) return;
    await ref.read(vaultProvider).save(MedicalCard(
          bloodType: _blood.text.trim(),
          allergies: _allergies.text.trim(),
          medications: _meds.text.trim(),
          contactName: _contactName.text.trim(),
          contactNumber: normalizePhoneInput(_contactNumber.text) ?? '',
        ));
    if (!mounted) return;
    setState(() => _stored = true);
    _snack(s.t('emergency.card.saved'));
  }

  Future<void> _delete(AppStrings s) async {
    await ref.read(vaultProvider).delete();
    for (final c in [_blood, _allergies, _meds, _contactName, _contactNumber]) {
      c.clear();
    }
    if (!mounted) return;
    setState(() {
      _phase = _Phase.off;
      _consent = false;
      _stored = false;
    });
    _snack(s.t('emergency.card.deleted'));
  }

  @override
  void dispose() {
    _secure.disable();
    for (final c in [_blood, _allergies, _meds, _contactName, _contactNumber]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return Scaffold(
      backgroundColor: AppColors.brandNavy,
      appBar: AppBar(
        backgroundColor: AppColors.brandNavy,
        foregroundColor: AppColors.textPrimary,
        title: Text(s.t('emergency.card.title')),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 640), child: _body(s)),
        ),
      ),
    );
  }

  Widget _body(AppStrings s) {
    const white = TextStyle(color: AppColors.textPrimary, fontSize: 16);
    switch (_phase) {
      case _Phase.loading:
        return Center(child: Text(s.t('state.loading'), style: white));
      case _Phase.corrupted:
        return ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            Text(s.t('emergency.card.error'), style: white),
            const SizedBox(height: AppSpacing.lg),
            _button(Icons.delete_outline, s.t('emergency.card.delete'), () => _delete(s)),
          ],
        );
      case _Phase.off:
        return ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            Text(s.t('emergency.card.off'), style: white),
            const SizedBox(height: AppSpacing.lg),
            _button(Icons.lock_outline, s.t('emergency.card.enable'), () => setState(() => _phase = _Phase.editing)),
          ],
        );
      case _Phase.editing:
        return _editor(s, white);
    }
  }

  Widget _editor(AppStrings s, TextStyle white) {
    final contact = normalizePhoneInput(_contactNumber.text);
    final name = _contactName.text.trim();
    final m = MedicalCard.maxLengths;
    return Form(
      key: _form,
      child: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          _field(_blood, s.t('emergency.card.bloodType'), m.bloodType),
          _field(_allergies, s.t('emergency.card.allergies'), m.text, lines: 3),
          _field(_meds, s.t('emergency.card.medications'), m.text, lines: 3),
          _field(_contactName, s.t('emergency.card.contactName'), m.contactName),
          _field(
            _contactNumber,
            s.t('emergency.card.contactNumber'),
            16,
            keyboard: TextInputType.phone,
            validator: (v) => (v == null || v.trim().isEmpty || normalizePhoneInput(v) != null)
                ? null
                : s.t('emergency.card.invalidNumber'),
          ),
          if (!_stored)
            CheckboxListTile(
              value: _consent,
              onChanged: (v) => setState(() => _consent = v ?? false),
              title: Text(s.t('emergency.card.consent'), style: white),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
            ),
          const SizedBox(height: AppSpacing.md),
          FilledButton.icon(
            key: const Key('card.save'),
            style: FilledButton.styleFrom(minimumSize: const Size(64, 64)),
            icon: const Icon(Icons.lock),
            label: Text(s.t('emergency.card.save')),
            onPressed: _consent ? () => _save(s) : null,
          ),
          if (_stored && contact != null && name.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.lg),
            _button(Icons.call, s.t('emergency.contact.call', {'name': name}), () => ref.read(dialerProvider).dial(contact)),
            const SizedBox(height: AppSpacing.sm),
            _button(Icons.sms_outlined, s.t('emergency.contact.sms', {'name': name}),
                () => ref.read(dialerProvider).openSms(number: contact, body: '')),
          ],
          if (_stored) ...[
            const SizedBox(height: AppSpacing.lg),
            _button(Icons.delete_outline, s.t('emergency.card.delete'), () => _delete(s)),
          ],
        ],
      ),
    );
  }

  Widget _field(
    TextEditingController c,
    String label,
    int max, {
    int lines = 1,
    TextInputType? keyboard,
    String? Function(String?)? validator,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.md),
        child: TextFormField(
          controller: c,
          maxLength: max,
          maxLines: lines,
          keyboardType: keyboard,
          validator: validator,
          style: const TextStyle(color: AppColors.textPrimary, fontSize: 16),
          decoration: InputDecoration(
            labelText: label,
            labelStyle: const TextStyle(color: AppColors.textPrimary),
            counterStyle: const TextStyle(color: AppColors.textPrimary),
            enabledBorder: const OutlineInputBorder(borderSide: BorderSide(color: AppColors.textPrimary)),
            focusedBorder: const OutlineInputBorder(borderSide: BorderSide(color: AppColors.accentCyan, width: 2)),
            border: const OutlineInputBorder(),
          ),
        ),
      );

  Widget _button(IconData icon, String label, VoidCallback onPressed) => OutlinedButton.icon(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 64),
          foregroundColor: AppColors.textPrimary,
          side: const BorderSide(color: AppColors.textPrimary, width: 1.5),
          alignment: Alignment.centerLeft,
          textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 17, fontWeight: FontWeight.w600),
        ),
        icon: Icon(icon),
        label: Text(label),
        onPressed: onPressed,
      );
}
