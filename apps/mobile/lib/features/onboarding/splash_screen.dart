import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_config.dart';
import '../../app/providers.dart';
import '../../app/widgets/brand_logo.dart';
import '../../core/theme/app_theme.dart';

/// Splash: gradiente radial navy→negro con partículas estáticas; el logo hace fade y escala 1.0→1.02 una vez.
/// Con «reducir movimiento» no hay animación. Nunca retrasa más de [AppConfig.splashDuration].
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: AppConfig.splashDuration);
  late final Animation<double> _fade = CurvedAnimation(parent: _c, curve: const Interval(0, 0.6, curve: Curves.easeOut));
  late final Animation<double> _scale =
      Tween(begin: 1.0, end: 1.02).animate(CurvedAnimation(parent: _c, curve: const Interval(0, 0.6, curve: Curves.easeOut)));
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    if (MediaQuery.disableAnimationsOf(context)) {
      _c.value = 1;
      WidgetsBinding.instance.addPostFrameCallback((_) => _next());
    } else {
      _c.forward().whenComplete(_next);
    }
  }

  void _next() {
    if (!mounted) return;
    context.go(ref.read(settingsProvider).onboarded ? '/alerts' : '/welcome');
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: RadialGradient(radius: 1.1, colors: [AppColors.brandNavy, AppColors.splashEdge]),
        ),
        child: CustomPaint(
          painter: const _ParticlesPainter(),
          child: SafeArea(
            child: LayoutBuilder(
              builder: (context, c) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.xl),
                  child: FadeTransition(
                    opacity: _fade,
                    child: ScaleTransition(
                      scale: _scale,
                      child: BrandLogo(strings: s, maxHeight: (min(c.maxHeight, c.maxWidth) * 0.6).clamp(140, 360)),
                    ),
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

class _ParticlesPainter extends CustomPainter {
  const _ParticlesPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rnd = Random(7);
    final paint = Paint()..color = AppColors.accentCyan.withValues(alpha: 0.18);
    for (var i = 0; i < 48; i++) {
      canvas.drawCircle(
        Offset(rnd.nextDouble() * size.width, rnd.nextDouble() * size.height),
        0.8 + rnd.nextDouble() * 1.8,
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_ParticlesPainter oldDelegate) => false;
}
