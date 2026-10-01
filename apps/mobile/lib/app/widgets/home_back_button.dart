import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// `leading` de AppBar para pantallas abiertas por enlace profundo (p. ej. desde una notificación):
/// si no hay pantalla anterior, «Volver» lleva a Alertas en lugar de dejar a la persona sin salida.
Widget? homeBackButton(BuildContext context, {Color? color}) =>
    context.canPop() ? null : BackButton(color: color, onPressed: () => context.go('/alerts'));
