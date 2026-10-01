import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/app_theme.dart';

/// Botón anti-llamada accidental (F5B): mantener pulsado [holdDuration] con anillo de progreso y háptico.
/// Un toque corto no llama. Con lector de pantalla, la acción semántica «Llamar» (doble toque) confirma.
/// Se usan eventos de puntero crudos (Listener) para que el gesto no exponga un «tap» semántico propio.
class HoldToCallButton extends StatefulWidget {
  const HoldToCallButton({
    super.key,
    required this.number,
    required this.caption,
    required this.holdingCaption,
    required this.semanticLabel,
    required this.semanticHint,
    required this.onConfirmed,
    this.enabled = true,
    this.holdDuration = const Duration(milliseconds: 1000),
  });

  final String number;
  final String caption;
  final String holdingCaption;
  final String semanticLabel;
  final String semanticHint;
  final VoidCallback onConfirmed;
  final bool enabled;
  final Duration holdDuration;

  @override
  State<HoldToCallButton> createState() => _HoldToCallButtonState();
}

class _HoldToCallButtonState extends State<HoldToCallButton> with SingleTickerProviderStateMixin {
  late final AnimationController _progress = AnimationController(vsync: this, duration: widget.holdDuration)
    ..addStatusListener(_onStatus);
  bool _holding = false;

  void _onStatus(AnimationStatus s) {
    if (s != AnimationStatus.completed) return;
    HapticFeedback.heavyImpact();
    setState(() => _holding = false);
    _progress.value = 0;
    widget.onConfirmed();
  }

  void _start(PointerDownEvent _) {
    if (!widget.enabled) return;
    HapticFeedback.selectionClick();
    setState(() => _holding = true);
    _progress.forward(from: 0);
  }

  void _cancel([PointerEvent? _]) {
    if (!_holding) return;
    _progress.stop();
    _progress.value = 0;
    setState(() => _holding = false);
  }

  @override
  void dispose() {
    _progress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bg = widget.enabled ? AppColors.alertRedStrong : AppColors.surfaceHigh;
    // Texto ≥ 19 px en negrita sobre rojo: «texto grande» WCAG ⇒ AAA con contraste 6.2:1.
    const caption = TextStyle(color: AppColors.textPrimary, fontSize: 19, fontWeight: FontWeight.w700, height: 1.2);
    return Semantics(
      button: true,
      enabled: widget.enabled,
      label: widget.semanticLabel,
      hint: widget.semanticHint,
      onTap: widget.enabled ? widget.onConfirmed : null,
      excludeSemantics: true,
      child: Listener(
        onPointerDown: _start,
        onPointerUp: _cancel,
        onPointerCancel: _cancel,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 120),
          child: Material(
            color: bg,
            borderRadius: BorderRadius.circular(AppRadius.xl),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.lg),
              child: LayoutBuilder(
                builder: (context, c) {
                  final narrow = c.maxWidth < 300;
                  final ring = SizedBox.square(
                    dimension: 88,
                    child: AnimatedBuilder(
                      animation: _progress,
                      builder: (context, _) => CustomPaint(
                        painter: _RingPainter(_progress.value),
                        child: const Center(child: Icon(Icons.call, size: 40, color: AppColors.textPrimary)),
                      ),
                    ),
                  );
                  final text = Column(
                    crossAxisAlignment: narrow ? CrossAxisAlignment.center : CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          widget.number,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontFamily: 'Poppins',
                            fontWeight: FontWeight.w800,
                            fontSize: 48,
                            height: 1.05,
                          ),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        _holding ? widget.holdingCaption : widget.caption,
                        style: caption,
                        textAlign: narrow ? TextAlign.center : TextAlign.start,
                      ),
                    ],
                  );
                  if (narrow) {
                    return Column(mainAxisSize: MainAxisSize.min, children: [ring, const SizedBox(height: AppSpacing.md), text]);
                  }
                  return Row(children: [ring, const SizedBox(width: AppSpacing.lg), Expanded(child: text)]);
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.value);
  final double value;

  @override
  void paint(Canvas canvas, Size size) {
    final r = size.shortestSide / 2 - 4;
    final c = size.center(Offset.zero);
    final track = Paint()
      ..color = AppColors.textPrimary.withValues(alpha: 0.35)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 6;
    canvas.drawCircle(c, r, track);
    if (value <= 0) return;
    final arc = Paint()
      ..color = AppColors.textPrimary
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 6;
    canvas.drawArc(Rect.fromCircle(center: c, radius: r), -pi / 2, 2 * pi * value, false, arc);
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.value != value;
}
