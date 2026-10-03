# STATUS — AntiSismo · 2026-09-30

Estado honesto por fase. «✅» solo con evidencia ejecutada en esta iteración; lo que funciona solo con
simuladores se marca como tal.

## Resumen
| Fase | Estado | Evidencia / motivo |
|---|---|---|
| F0 Fundamentos y marca | ✅ | gate verde; logo recoloreado eliminado (ADR-0005) |
| F1 Contratos | ✅ | mismos fixtures TS/Go/Dart, 19 vectores Ed25519 |
| F2 Ingesta | ✅ (fuentes públicas) | USGS + EMSC WS, fuentes por región, salud y alarma > 60 s. Fuentes oficiales DO/MX deshabilitadas hasta acuerdo (BLK-04) |
| F3 Decisión + entrega | ✅ con FCM simulado | motor, firma, cola Redis/memoria, DLQ, p99 537 ms. Push real a dispositivos: **BLK-01** |
| F4 API + PostGIS | ⏳ no iniciado | — |
| F5 App: alertas | 🔶 parcial | pantalla completa, voz, TEA, simulacro, estados. Falta receptor push nativo (BLK-01/02/15) |
| F5B Emergencias | ✅ | QA-E1…E6 automatizados; ADR-0002. Prueba en hardware: BLK-15 |
| F6 App: navegación, perfil, guías, i18n | 🔶 parcial | 5 pestañas, perfil, guías, es-DO + en. Eventos/Mapa/Familia en estado «en preparación» (dependen de F4/F7/F8) |
| F7 Mapas | ⏳ | — |
| F8 Familia + panel admin web | ⏳ | — |
| F9 Hardening / release | 🔶 parcial | secretos fuera del repo, sin CALL_PHONE, FLAG_SECURE, allowlist SSRF, fuzz. Falta pinning, App Check, keystore (BLK-13), pentest, IPA (BLK-08) |

## Formato §3.5 — iteración 2

✅ COMPLETADO
- F2 residual: EMSC WebSocket, registro de fuentes por región desde YAML, métricas de salud y alarma ops.
- F3: decisión CRITICAL/INFORMATIVE por celda, firma Ed25519 con respaldo, cola Redis Streams con
  fallback a memoria + DLQ, transporte FCM HTTP v1 (timeout/retry/breaker), `alertd`, harness e2e.
- F5B completo (ADR-0002). Ficha de emergencia cifrada.
- App: splash, bienvenida, shell de 5 pestañas, pantalla de alerta con voz literal, simulacro local
  con insignia SIMULACRO y voz de simulacro (nunca usa la plantilla crítica), perfil (nombre para la voz, idioma, país), guías antes/durante/después, inglés.
- Benchmark de apps líderes (`docs/research/benchmark.md`), ADR 0002–0007, trazabilidad.
- 13 capturas reales (`docs/screenshots`), APK debug compilado.

🔄 EN PROGRESO: nada a medias en el código; las pestañas pendientes muestran estado honesto.

⏳ SIGUIENTE
1. BLK-01 + BLK-15: receptor FCM nativo, canal de alta importancia, full-screen intent; prueba en dispositivo.
2. F4: API REST (eventos, revisiones, reconciliación TLS) con Postgres/PostGIS fuera del camino crítico.
3. Pestaña Eventos con caché offline; F7 mapa MapLibre; BL-01 degradar alerta sin interacción.
4. F8 familia (opt-in) y panel admin; F9 pinning/App Check/keystore.

⚠️ BLOQUEADORES: BLK-00…BLK-15 en `BLOCKERS.md` (los de tercero no se marcan resueltos).

🔐 SEGURIDAD: sin secretos en repo/bundle/logs; firma inválida ⇒ reconciliación, nunca alarma; marcador
del sistema (sin CALL_PHONE); números sanitizados; ficha AES-256-GCM + FLAG_SECURE; ubicación nunca
enviada al servidor; recibir alertas no requiere cuenta.

📈 MÉTRICAS: ver `PROGRESS.md` iteración 2.

## Web (W3–W8) — 2026-10-03

| Fase | Estado | Evidencia / motivo |
|---|---|---|
| W3 Autenticación web | ✅ local (CI: pendiente del PR) | gate 29/29, Playwright 12/12 contra API real, axe 0 serias/críticas (oscuro, escritorio) |
| W4 Alertas en vivo + mapa | ⏳ | — |
| W5 SOS, Mi Familia, plan | ⏳ | — |
| W6 Panel empresa + legales | ⏳ | las páginas `/legal/*` enlazadas desde el registro llegan en W6 |
| W7 Calidad multi-navegador | ⏳ | falta tema claro, Firefox/WebKit/móvil, matriz axe 2 temas × 3 viewports, Lighthouse, Trivy/ZAP |
| W8 Docs + release | ⏳ | — |

Límites honestos de W3: solo Chromium; el inicio con Google no se probó de extremo a extremo (requiere
credenciales reales, BLK-19); la web aún no tiene tema claro (W7).
