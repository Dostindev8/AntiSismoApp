import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/alert/domain/alert_view.dart';
import '../features/alert/ui/alert_screen.dart';
import '../features/emergency/ui/emergency_screen.dart';
import '../features/emergency/ui/medical_card_screen.dart';
import '../features/home/tabs.dart';
import '../features/onboarding/splash_screen.dart';
import '../features/onboarding/welcome_screen.dart';
import '../features/profile/profile_screen.dart';
import 'app_config.dart';
import 'providers.dart';
import 'shell.dart';

GoRouter buildRouter() => GoRouter(
      initialLocation: '/splash',
      routes: [
        GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
        GoRoute(path: '/welcome', builder: (_, _) => const WelcomeScreen()),
        StatefulShellRoute.indexedStack(
          builder: (_, _, shell) => AppShell(shell: shell),
          branches: [
            StatefulShellBranch(routes: [GoRoute(path: '/alerts', builder: (_, _) => const AlertsTab())]),
            StatefulShellBranch(routes: [GoRoute(path: '/events', builder: (_, _) => const EventsTab())]),
            StatefulShellBranch(routes: [GoRoute(path: '/map', builder: (_, _) => const MapTab())]),
            StatefulShellBranch(routes: [GoRoute(path: '/family', builder: (_, _) => const FamilyTab())]),
            StatefulShellBranch(routes: [GoRoute(path: '/guides', builder: (_, _) => const GuidesTab())]),
          ],
        ),
        GoRoute(path: '/profile', builder: (_, _) => const ProfileScreen()),
        GoRoute(
          path: '/emergency',
          builder: (_, _) => const EmergencyScreen(),
          routes: [GoRoute(path: 'card', builder: (_, _) => const MedicalCardScreen())],
        ),
        GoRoute(path: '/alert/drill', builder: (_, _) => const DrillAlertScreen()),
      ],
    );

final routerProvider = Provider<GoRouter>((ref) {
  final router = buildRouter();
  ref.onDispose(router.dispose);
  return router;
});

/// Simulacro: la vista se fija al abrir (la cuenta atrás no se reinicia en reconstrucciones).
class DrillAlertScreen extends ConsumerStatefulWidget {
  const DrillAlertScreen({super.key});

  @override
  ConsumerState<DrillAlertScreen> createState() => _DrillAlertScreenState();
}

class _DrillAlertScreenState extends ConsumerState<DrillAlertScreen> {
  late final AlertView _view = AlertView.drill(
    deviceNowMs: ref.read(clockProvider)().millisecondsSinceEpoch,
    countdownSeconds: AppConfig.drillCountdownSeconds,
  );

  @override
  Widget build(BuildContext context) => AlertScreen(view: _view);
}
