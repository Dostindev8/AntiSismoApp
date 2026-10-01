# ADR-0005 — Arquitectura de información, navegación y marca · 2026-09-30

## Navegación
- 5 pestañas: **Alertas | Eventos | Mapa | Familia | Guías** (`StatefulShellRoute.indexedStack`: cada
  pestaña conserva su estado). Perfil en el avatar del encabezado.
- **Emergencia** siempre visible en el encabezado (rojo `alertRedStrong`); con ancho < 420 px o texto
  > 130 % se muestra como icono SOS con etiqueta semántica y tooltip «Emergencia».
- ≥ 840 px: `NavigationRail`; < 840 px: `NavigationBar`.
- Pantallas abiertas por enlace profundo (`/emergency`, `/profile`) muestran «Volver» que lleva a
  Alertas si no hay pantalla anterior (evita callejones sin salida desde una notificación).
- Pestañas sin backend todavía (Mapa, Familia, Eventos) muestran estados **honestos** («en
  preparación», «aún no hay eventos guardados»), nunca datos simulados.

## Pantalla de alerta
- Sin animaciones decorativas: solo cambia la cuenta atrás (1/s).
- Orden: nivel (+ insignia SIMULACRO) → instrucción (30 px) → llegada estimada → magnitud/lugar (solo
  si vienen de un payload verificado) → Estoy bien / Necesito ayuda / Llamar a emergencias (abre F5B).

## Splash
Gradiente radial `brandNavy`→`splashEdge` (#000), partículas **estáticas**, logo con fade y escala
1.0→1.02 una sola vez; con «reducir movimiento» no hay animación. Navega al terminar (≤ 1,4 s).

## Marca — corrección
La iteración F0 generó `logo-negative.png` recoloreando el wordmark a blanco. Eso viola «nunca
recolorear ni aplicar filtros». **Se elimina**: la app usa `logo-fullcolor.png` intacto sobre una placa
clara (`lightBg`) con zona de seguridad del 25 % del alto por lado y `BoxFit.contain`. El splash nativo usa
el escudo intacto con margen ≥ 25 %. `symbol-mono`/`app_icon_mono` (icono temático Android 13+) son una
exigencia de plataforma y se mantienen solo para ese uso.

## Evidencia
`test/app/navigation_test.dart` (flujo, pestañas, rail, matriz responsive 7 tamaños × texto 1.0/2.0),
`welcome_responsive_test.dart`, `docs/screenshots/*.png`.
