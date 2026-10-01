# ⚡ ANTISISMO APP — MEGA PROMPT MAESTRO DE EJECUCIÓN PARA CURSOR
**Protocolo GOD-STACK-ING · v3.2 · Septiembre 2026 · Prevención · Alerta · Vida**

> Este archivo es la **orden de construcción**. Va en `docs/EXECUTION_PROMPT.md`.
> Prevalece sobre el Blueprint v2.0 y sobre `protocolos_post_sismo_completo.md` donde haya conflicto (ver §3 Errata).

---

## 📌 CÓMO USAR (para Dostin)

1. Crea el repo `antisismo/` y copia:
   - `docs/blueprint/AntiSismo_Blueprint_Maestro_Construccion.pdf`
   - `docs/blueprint/protocolos_post_sismo_completo.md`
   - `docs/brand/logo-fullcolor.png` y `docs/brand/mockup-reference.png` (entregados junto a este archivo)
   - `docs/EXECUTION_PROMPT.md` (este archivo)
2. Crea `.cursor/rules/antisismo.mdc` con el bloque de **§0.3** (siempre activo).
3. En el chat de Cursor (modo Agent) pega el **PROMPT DE ARRANQUE** de §0.4.
4. Cursor trabaja por fases (F0 → F9) y guarda su estado en `PROGRESS.md`. Si el agente se detiene por límite de contexto, escribe: `Continúa desde PROGRESS.md` y retoma exactamente donde quedó.

---

# PARTE 0 — INSTRUCCIONES DE OPERACIÓN (LEER PRIMERO, OBLIGATORIO)

## 0.1 Rol
Eres el **ingeniero principal de un sistema de alerta temprana de misión crítica**. No sugieres: **construyes**. No preguntas si se puede: **determinas cómo**. Cada línea se justifica; cada decisión se mide en **segundos de aviso y claridad de acción**. Si dudas entre velocidad y seguridad de la vida humana, gana la vida.

## 0.2 Protocolo de lectura y prioridad de fuentes
Antes de escribir código lee, en este orden: (1) este archivo completo, (2) el Blueprint PDF, (3) `protocolos_post_sismo_completo.md`, (4) `docs/brand/*`. En conflicto, el orden de prioridad es: **§3 Errata de este archivo > Blueprint v2.0 > protocolos .md**. Nunca inventes endpoints, claves, datos oficiales ni cifras: si algo no está documentado, usa un placeholder en `.env.example`, márcalo en `BLOCKERS.md` y continúa con lo no bloqueado.

## 0.3 Regla permanente de Cursor → `.cursor/rules/antisismo.mdc`
```md
---
description: Reglas permanentes de AntiSismo (misión crítica)
alwaysApply: true
---
1. Lee docs/EXECUTION_PROMPT.md y PROGRESS.md al iniciar cada sesión.
2. Camino crítico (ingesta→decisión→push→alerta) NO depende de Postgres ni de servicios no esenciales; solo Redis + cola en memoria, con fallback a memoria local.
3. Tiempos: epoch ms UTC en backend; IANA tz solo en presentación. Coordenadas GeoJSON [lon,lat,depth]; validar rangos siempre.
4. Toda alerta es idempotente (alert_id determinista = evento+revisión).
5. Fail-safe: ningún fallo silencia una alerta legítima; ningún fallo de verificación deja pasar una falsa. Degradar y reportar.
6. Nunca hardcodear umbrales, hosts, claves ni textos: config por región / .env / i18n.
7. Toda integración externa: allowlist de host, timeout, retry con backoff+jitter, circuit breaker.
8. Toda feature = pruebas unit + integración + criterio de aceptación + estados (loading/error/empty/offline/degraded).
9. Seguridad por defecto (§8). Accesibilidad WCAG 2.2 AA y responsive 320px→tablet→desktop desde el primer commit.
10. Extend-never-overwrite: no rompas lo que ya pasa el gate.
11. Cero warnings en build/lint/analyze. Cero TODOs vagos: todo TODO lleva ID en BLOCKERS.md.
```

## 0.4 PROMPT DE ARRANQUE (pegar en Cursor Agent)
```
Actúa según docs/EXECUTION_PROMPT.md (léelo completo primero). Ejecuta las fases F0→F9 en orden.
Para CADA fase aplica el LOOP de la Parte 14: PLAN → BUILD → VERIFY → AUDIT → FIX → repetir
hasta que el GATE de la fase esté 100% verde. No avances con nada en rojo.
Al cerrar cada iteración actualiza PROGRESS.md con el formato de §14.2.
Si algo depende de terceros (claves, entitlements, acuerdos), documenta en BLOCKERS.md
y continúa con el resto. No pares hasta completar F9 o hasta que solo queden bloqueadores externos.
```

## 0.5 Honestidad técnica (no negociable)
Ningún software garantiza literalmente «cero fallas». El estándar exigido es: **arquitectura fail-safe, redundancia multi-fuente, idempotencia, pruebas de misión crítica, monitoreo continuo y honestidad al usuario**. Las apps por internet **no reemplazan** los sistemas oficiales de alertamiento: AntiSismo es **amplificador de la señal oficial**. La app nunca presenta una estimación como medición oficial, y nunca promete lo que el sistema operativo no permite (§3, ítems 3–6).

---

# PARTE 1 — MISIÓN, ALCANCE Y ESTÁNDARES

**Misión:** que cada persona en zona de riesgo reciba, en **< 2 s (p50) / < 4 s (p99)** desde la publicación oficial, una alerta inequívoca, personalizada y accionable, y que después pueda responder en **< 10 s**: ¿dónde tembló?, ¿cuándo?, ¿a qué hora (mi hora local)?, ¿en qué área se sintió y me afecta?

**Mercado inicial (decisión):** República Dominicana + Caribe (la marca, bandera y mockups son dominicanos). México (SASMEX/SSN) queda como **región 2** habilitable por config. Locale por defecto `es-DO`, zona `America/Santo_Domingo` (UTC−4, sin horario de verano). Emergencias: 911.

**Stack (decisión, respeta el Blueprint y el stack de Dostin):**

| Capa | Tecnología |
|---|---|
| App móvil | Flutter 3.x estable (Impeller), Dart 3 sound null-safety, Riverpod, go_router |
| Ingesta / normalización / decisión / entrega | Go 1.23 (camino crítico) |
| API REST y panel admin | Node.js 22 + TypeScript strict + Express 5 + zod |
| Web pública + admin | Next.js 15 (App Router) + React 19 + Tailwind CSS 4 (misma paleta) |
| Datos | Redis (camino crítico) · PostgreSQL 16 + PostGIS (servicios de valor) |
| Push | FCM HTTP v1 (Android + iOS) · APNs Critical Alerts |
| Observabilidad | OpenTelemetry + Prometheus + Grafana + Sentry |
| Infra | Docker, Terraform, multi-región (2), GitHub Actions |

> **Regla de versiones:** al instalar cada dependencia, verifica que la versión exista (`flutter pub add`, `pnpm add`, `go get`), **fija versiones exactas** y lee su documentación real. Prohibido adivinar APIs de memoria.

---

# PARTE 2 — ASSETS DE MARCA (FUENTE DE VERDAD VISUAL)

- `docs/brand/logo-fullcolor.png`: escudo azul/rojo, sismograma rojo, pin de ubicación rojo, mapa de Latinoamérica azul, wordmark **Anti** (azul) **Sismo** (rojo), lema «PREVENCIÓN · ALERTA · VIDA», cinta con bandera dominicana.
- `docs/brand/mockup-reference.png`: **referencia visual de pantallas** (Menú/Inicio, Mapa con alerta, Sitios seguros, Multi-hazard). Cursor debe **abrir la imagen y replicar** jerarquía, espaciados, esquinas redondeadas, iconografía, estados y badges.

**Tareas de branding (F0/F5):**
1. Generar desde el logo: `app_icon` 1024×1024 (adaptive icon Android con foreground/background/monochrome; iOS sin transparencia), splash, versión monocromática, negativo y solo-icono (legible a 29 px). Usar `flutter_launcher_icons` y `flutter_native_splash`.
2. Logo **siempre** `BoxFit.contain` / `object-contain`; zona de seguridad mínima = 25 % del alto del símbolo; sin distorsión, sin recortes, sin sombras extra.
3. Fuentes **empaquetadas en assets** (nunca Google Fonts en runtime: la app debe verse igual offline): **Poppins** (700/800, títulos y wordmark-like) + **Inter** (400/500/600, texto). Licencias OFL en `assets/licenses/`.

---

# PARTE 3 — ERRATA Y DECISIONES SOBRE EL BLUEPRINT (OBLIGATORIO)

Se auditó el Blueprint. Estas correcciones **anulan** lo que el documento diga en contrario.

| # | Blueprint dice | Problema | Decisión vinculante |
|---|---|---|---|
| 1 | Ejemplo `time_utc_ms: 1786613527000` con «lunes 28 sep 2026 · 20:32:07 UTC» | Ese epoch es **13-ago-2026 09:32:07 UTC**; no coincide con el ejemplo | Valor correcto: **`1790627527000`** (= 2026-09-28T20:32:07Z, lunes). `received_at_ms` de ejemplo: `1790627529500`. Añadir test que valide epoch↔texto |
| 2 | «Firmas **HMAC** en mensajes push» | Un secreto compartido dentro de la app es extraíble → falsificable | **Firma asimétrica Ed25519**. Clave privada solo en KMS/HSM del backend; **clave pública embebida** en la app (2 claves: activa + siguiente, con `kid`). HMAC solo servicio↔servicio |
| 3 | RF-03 «no silenciable por No Molestar» | iOS exige **entitlement Critical Alerts** aprobado por Apple; Android exige que el **usuario conceda** acceso a No Molestar | Implementar flujo de permisos guiado + pantalla de estado «Tu dispositivo puede/no puede sonar en silencio». Test en dispositivo real. Documentar solicitud a Apple en `BLOCKERS.md` |
| 4 | «Volumen forzado al máximo» | iOS no permite fijar volumen; en Android solo con permisos y mejor esfuerzo | iOS: `criticalSoundVolume` en payload APNs. Android: canal `USAGE_ALARM` + subir `STREAM_ALARM` mientras dure la alerta y restaurar después |
| 5 | «Frase cacheada, cero red» + TTS on-device | El TTS del SO sintetiza en el momento; en iOS la voz en background está limitada | Pre-renderizar audio del nombre/frase a archivo tras cada cambio de perfil (`synthesizeToFile` Android; `AVSpeechSynthesizer.write` iOS) y reproducir; fallback: TTS en vivo; fallback 2: sonido de alerta + pantalla. **Spike obligatorio en F6** para iOS (Notification Service Extension + App Group) |
| 6 | Pantalla full-screen sobre bloqueo | Android 14+ restringe `USE_FULL_SCREEN_INTENT` y Play Store limita su uso | Declarar categoría correcta, solicitar permiso en onboarding, y fallback a notificación de máxima importancia con `fullScreenIntent` + acción. Documentar justificación de política en `docs/store/` |
| 7 | Ejemplos en México / `es-MX` por defecto | La marca y el mercado inicial son RD | Config por región: `DO` (por defecto) y `MX`. Ejemplos y datos de prueba en RD; MX como fixture adicional |
| 8 | TEA calculado en backend «por usuario» | Obliga a que el servidor conozca la ubicación → privacidad y latencia | **El dispositivo calcula el TEA** con su última ubicación local; el payload lleva un TEA regional de respaldo. El servidor **no** almacena ubicación de alertas |
| 9 | Mockup muestra insignia «Usuario Premium» | Riesgo de contradecir «la alerta es gratis siempre» | Premium **nunca** condiciona ni degrada alertas. Solo funciones no críticas (más contactos, historial extendido, etc.) |
| 10 | Botón **SOS** aparece en el mockup pero no está especificado | Ambigüedad = riesgo de falso disparo | Definido en §5.9: mantener 2 s + confirmación; acciones: «Necesito ayuda» al círculo, compartir ubicación aproximada, llamar 911 |
| 11 | «Tiempo estimado de **arribo**» vs mockup «llegada» | Inconsistencia de vocabulario | Etiqueta UI: **«Llegada estimada»** (TEA internamente). Frase de voz mantiene «Tiempo estimado de arribo» |
| 12 | Typos: «alejate», «segurura» | Error de texto en frase crítica | «**Aléjate** de corrientes», «zona de **seguridad**». Test de ortografía sobre i18n |
| 13 | Simulacro «marcado» | Riesgo de que suene «esto no es un simulacro» en un simulacro | En simulacro la voz dice «**Esto es un simulacro**…»; canal y sonido distintos; nunca usa el canal crítico |
| 14 | Fan-out a 5 M tokens | Latencia y privacidad | Suscribir el dispositivo a **topics por celda geohash** (calculado en el dispositivo) + fan-out por token como respaldo. El backend no sabe dónde está cada usuario |
| 15 | Polling USGS cada 15–30 s | Los feeds se refrescan ~1/min | Polling 30 s con `If-None-Match`/`ETag`; EMSC WebSocket como detector primario |
| 16 | Dedup ±16 s / ±100 km | Puede fusionar dos eventos distintos (réplica cercana) | Elegir el candidato de **menor distancia espacio-temporal normalizada**; no fusionar si \|Δmag\| > 1.5; conservar `source_ids` |
| 17 | Alertas para todo lo que supera umbral | Fatiga de alertas = usuarios que desactivan | **Dos niveles**: `CRITICAL` (MMI esperado ≥ V → canal crítico) e `INFORMATIVE` (notificación normal). Umbrales iniciales en config, **calibrables con sismólogos** |
| 18 | Fuentes de RD no listadas | El mercado inicial es RD | Añadir `AlertSourceProvider` para: Centro Nacional de Sismología, COE/Defensa Civil, centros de tsunami (PTWC/NTWC vía CAP). **No inventar endpoints**: verificar documentación oficial y dejar conector en modo `disabled` hasta confirmar |
| 19 | Contraste de colores no verificado | `#E63946` con texto blanco = **4.17:1** (falla AA texto normal); `#2A9D8F` con blanco = **3.32:1** | Ver tokens de §4.1: botones rellenos rojos usan `#C1121F` (6.22:1); verde con texto navy `#0A2540` (4.67:1) |
| 20 | «Cero fallas» | Promesa imposible | Mantener la nota de honestidad de §0.5 en «Acerca de» y en onboarding |

---

# PARTE 4 — SISTEMA DE DISEÑO (COLORES, LETRA, RESPONSIVE)

## 4.1 Tokens de color (fijos; no inventar otros)

| Token | HEX | Uso | Contraste verificado |
|---|---|---|---|
| `brandNavy` | `#0A2540` | Fondo base / marca | Blanco sobre navy 15.54:1 |
| `bgDeep` | `#06132B` | Fondo profundo / gradiente superior | Blanco 18.49:1 |
| `surface` | `#0F2F55` | Tarjetas | — |
| `surfaceHigh` | `#14406F` | Tarjetas elevadas / hover | — |
| `alertRed` | `#E63946` | Iconos, acentos, texto **grande** (≥18.66 px bold) | Sobre navy 3.73:1 → **no** para texto pequeño |
| `alertRedStrong` | `#C1121F` | **Botones rellenos** con texto blanco | 6.22:1 |
| `alertRedText` | `#FFB4BB` | Texto rojo pequeño sobre fondo oscuro | 9.25:1 |
| `safeGreen` | `#2A9D8F` | Sitio seguro (icono/borde/fondo con texto navy) | Navy sobre verde 4.67:1 |
| `safeGreenStrong` | `#1F7A6F` | Verde con texto blanco | 5.16:1 |
| `accentBlue` | `#1E6FEB` | Enlaces, foco, selección | verificar en test |
| `accentCyan` | `#38BDF8` | Énfasis de títulos («cada paso») | — |
| `textPrimary` | `#FFFFFF` | Texto principal | — |
| `textMuted` | `#9FB3C8` | Texto secundario | 7.22:1 sobre navy |
| `warnAmber` | `#F59E0B` | Precaución / deslizamientos | — |

**Reglas:** fondo por defecto **oscuro** (como el mockup: gradiente `bgDeep → brandNavy`), con tema claro equivalente (fondo `#FFFFFF`/`#F3F6FA`, texto `#0A2540`). El rojo de alerta está **reservado a estados críticos** (alerta, SOS, peligro alto). **Nunca color como único indicador**: siempre icono + forma + texto (daltonismo). Escala MMI I–XII: paleta secuencial apta para daltónicos (tipo *inferno/viridis*) + numeral romano visible + descriptor en lenguaje llano.

Colores por amenaza (icono + forma distinta + etiqueta): Sismo `#E63946` (onda) · Tsunami `#1E90FF` (ola) · Volcán `#FF5A36` (volcán) · Inundación `#3B82F6` (casa-agua) · Deslizamiento `#F59E0B` (ladera) · Incendio `#FF4D2E` (llama) · Civil `#9FB3C8` (altavoz).

## 4.2 Flutter — implementación base (`lib/core/theme/`)
(Ver código de referencia `AppColors` y `buildDarkTheme()` en la versión original del prompt; implementado en `apps/mobile/lib/core/theme/`.)

## 4.3 Responsive (obligatorio, desde 320 px)

| Clase | Ancho | Layout |
|---|---|---|
| `compact` | < 600 dp | 1 columna, bottom nav (Inicio · Mapa · Alertas · Más) |
| `medium` | 600–839 dp | 2 columnas / NavigationRail |
| `expanded` | ≥ 840 dp | Master-detail (lista + mapa/detalle), NavigationRail extendido |

Reglas: `SafeArea` + `MediaQuery.viewPadding`; `LayoutBuilder`/`SliverList` (nunca alturas fijas para texto); soportar `textScaler` hasta **2.0** sin overflow ni texto cortado; orientación vertical y horizontal; plegables; objetivos táctiles ≥ 48 dp; sin scroll horizontal accidental; `RepaintBoundary` en mapa y listas largas. **La pantalla de alerta muestra sus 5 campos (tipo, magnitud, MMI, llegada, instrucción) sin scroll de 5" a 6.9"** y se reacomoda en 320×568 con `FittedBox` controlado + prioridad de contenido.
Web (Next.js/Tailwind 4): tokens vía `@theme`, mobile-first `xs:375 sm:640 md:768 lg:1024 xl:1280 2xl:1536`, tipografía fluida `clamp()`, `prefers-color-scheme`, `prefers-reduced-motion`, imágenes/logo `object-contain`.

## 4.4 Accesibilidad (requisito, no mejora)
WCAG 2.2 AA: `Semantics` en todo control, orden de foco lógico, VoiceOver/TalkBack probados, alerta anunciada con `SemanticsService.announce` (prioridad alta), vibración con patrón configurable + flash LED opcional, opción de desactivar voz sin perder sonido/visual, texto mínimo 14 sp, contraste verificado por **test automático** de tokens, animaciones respetan «reducir movimiento».

---

# PARTE 5 — PANTALLAS (replicar `mockup-reference.png` + Blueprint)

Estados obligatorios por pantalla: **loading (skeleton) · success · empty · error · offline · degraded**.

- **5.1 Splash / Onboarding:** logo, honestidad técnica (§0.5), permisos guiados (notificaciones, alertas críticas, ubicación «mientras se usa» → «siempre» solo si el usuario lo decide y entiende por qué, No Molestar/full-screen en Android, batería sin restricción), nombre para la voz, ≥3 contactos, puntos de encuentro. Nunca bloquear la recepción de alertas por falta de cuenta.
- **5.2 Home / Inicio (menú lateral del mockup):** avatar + nombre + insignia; entradas: Inicio · Mapa de Riesgos · Alertas · Sitios Seguros · Multi-Hazard · Mi Familia · Configuración · Ayuda; tarjeta inferior «La prevención también salva vidas → Mantente informado». Bottom nav: Inicio · Mapa · Alertas (badge) · Más.
- **5.3 Alerta full-screen (crítica):** no descartable por gesto accidental (confirmar con botón), sobre pantalla bloqueada, tipo/magnitud/MMI/llegada/instrucción sin scroll, botones «Estoy bien / Necesito ayuda», TTS + alarma + vibración. Tarjeta del mockup: «¡Alerta Sísmica! Magnitud, Profundidad, Llegada estimada, **Ver detalles y recomendaciones**».
- **5.4 Evento (módulo estrella, Blueprint §2):** tarjeta completa con **fecha larga**, **hora local + UTC (24 h)**, epicentro textual + coordenadas, profundidad, **área** (contornos MMI/polígono), distancia al usuario, intensidad esperada con rango, estado de solución («Datos automáticos — sujetos a revisión» / «Revisado»), historial de revisiones (6.4 → 6.2), fuentes, banner rojo permanente si `tsunami`. **100 % offline** desde caché.
- **5.5 Mapa de riesgos:** MapLibre + MBTiles offline; capas conmutables (vulnerabilidad alta/baja, sitios seguros, rutas, MMI); leyenda de amenazas (Sismos, Tsunamis, Erupciones, Inundaciones, Deslizamientos, Incendios) como el mockup; controles: mi ubicación, capas, zoom; modo «solo sitios seguros».
- **5.6 Sitios seguros:** pestañas **Todos · Refugios · Hospitales · Zonas Altas**; tarjeta con foto, nombre, tipo, distancia, insignia **«Seguro»** (icono escudo + texto, no solo verde); distancia y brújula calculadas **en el dispositivo** (Dijkstra/A* sobre subgrafo peatonal). Solo `verified=true` muestran «Seguro»; el resto «Por verificar».
- **5.7 Multi-Hazard:** lista de 7 amenazas con icono, color, subtítulo (p. ej. «Alerta temprana y guía de acción») y chevron.
- **5.8 Mi Familia:** círculo, estado «Estoy bien» de cada contacto en ≤ 10 s, puntos de encuentro, opt-in explícito para ubicación aproximada.
- **5.9 SOS:** botón rojo en el encabezado; **mantener 2 s + confirmación** (anti falso disparo) → «Necesito ayuda» al círculo, ubicación aproximada opcional, atajo «Llamar 911». Cola offline con reintento.
- **5.10 Guías post-sismo:** contenido del Blueprint §13 / `protocolos_post_sismo_completo.md`, 100 % offline, checklist interactiva (gas, electricidad, estructura), tarjeta rápida de 8 acciones, kit 72 h, habitabilidad (alto/precaución/dictamen profesional).
- **5.11 Simulacros:** marca visual y sonora «SIMULACRO», jamás usa canal crítico (§3 #13).
- **5.12 Configuración / Acerca de:** perfil, voz, idioma, umbrales de usuario (solo hacia **más** sensibilidad), permisos y diagnóstico («¿sonará en silencio?»), atribuciones (**USGS**, **EMSC/CSEM CC BY 4.0**), política de privacidad, versión.

---

# PARTE 6 — ARQUITECTURA Y MONOREPO

```
antisismo/
├── apps/
│   ├── mobile/                 # Flutter
│   │   ├── lib/core/{theme,router,i18n,time,geo,security,storage,config}
│   │   ├── lib/features/{onboarding,home,alert,event,map,sites,multihazard,family,guides,drills,sos,settings}
│   │   ├── android/  ios/      # servicios nativos de alerta, NSE iOS
│   │   └── test/ integration_test/
│   └── web/                    # Next.js 15: página pública /evento/[id] + panel admin de curaduría
├── services/
│   ├── ingestion/  decision/  delivery/  enrichment/   # Go
│   └── api/                    # Node/TS Express 5
├── packages/{proto,geo,config}/
├── infra/{terraform,docker,otel,grafana}/
├── data/{safe_sites,routes,regions,guides}/            # seeds con verified=false por defecto
├── docs/{blueprint,brand,store,runbooks,adr}/
├── .github/workflows/          # ci, security, release
├── PROGRESS.md  BLOCKERS.md  .env.example  .cursor/rules/antisismo.mdc
```

**Principios (no negociables):** camino crítico aislado · idempotencia por `alert_id` · fail-safe (degrada, jamás silencia) · offline-first selectivo · privacidad por diseño · multi-región · cada componente con métrica y presupuesto de tiempo.

**Cadena de degradación:** N0 pipeline completo → N1 sin MMI/contornos → N2 alerta básica (tipo, magnitud, instrucción) → N3 push no entregado ⇒ la app reconcilia al reconectar con `/v1/events` → N4 sin red ⇒ tarjeta cacheada + sitios offline. **Bajar de nivel nunca cancela una alerta ya emitida.**

**Dependencias Flutter sugeridas** (verificar versiones reales): `flutter_riverpod`, `go_router`, `freezed`+`json_serializable`, `hive_ce` (cajas **cifradas**), `flutter_secure_storage`, `maplibre_gl`, `flutter_tts`, `firebase_messaging`, `flutter_local_notifications`, `geolocator`, geohash propio (paquete o implementación con tests), `intl`, `timezone`+`flutter_timezone`, `cryptography` (Ed25519), `dio` con pinning, `sentry_flutter`, `flutter_launcher_icons`, `flutter_native_splash`, `mocktail`, `patrol`/`integration_test`.

---

# PARTE 7 — CÓDIGO DE REFERENCIA

Implementado (y ampliado con tests) en:
- 7.1 Go validación/distancia/dedup → `services/ingestion/normalize/`
- 7.2 Payload de push firmado → `packages/proto/` (schema + cadena canónica + fixtures)
- 7.3 Dart tiempo / llegada estimada / idempotencia → `apps/mobile/lib/core/{time,geo}` y `features/alert/domain`
- 7.4 Config por región → `packages/config/regions/{DO,MX}.yaml`
- 7.5 API Node/TS endurecida → `services/api/src/app.ts`

**Cadena canónica de firma Ed25519 (contrato fijo):**
`v1\n{alert_id}\n{event.id}\n{revision_seq}\n{time_utc_ms}\n{iat_ms}\n{exp_ms}\n{level}\n{instruction}`

`alert_id = hex(sha256(event.id + ':' + revision_seq))`.
Reglas: `exp_ms` acota la vigencia **como alarma**; si llega después, evento informativo (no suena). **Firma inválida ⇒ NO alarmar por ese push, registrar incidente y confirmar por TLS con `GET /v1/events`**: si el evento existe y es crítico, alarmar con la fuente autenticada. Tamaño total < 4 KB (límite FCM). Localizar textos en el cliente.

**Tests obligatorios 7.1:** lon/lat invertidos ⇒ `ErrInvalid`; epoch en segundos ⇒ `ErrInvalid`; M4.0 y M5.8 a 60 km/10 s ⇒ **no** fusionar; dos candidatos válidos ⇒ menor score; USGS+EMSC mismo evento ⇒ 1 alerta.

---

# PARTE 8 — SEGURIDAD ANTIHACKING (SECURITY BY DEFAULT)

## 8.1 Modelo de amenazas (STRIDE resumido → control obligatorio)

| Amenaza | Vector | Control |
|---|---|---|
| Alerta **falsificada** | Push/API falsos | Ed25519 + `kid` + `exp` + confirmación TLS con `/v1/events`; rate limit y circuit breaker de emisión; dos personas para cambiar umbrales globales |
| Alerta **silenciada** | DoS a ingesta/entrega | Multi-fuente, multi-región, cola con DLQ, health checks, alarma ops si fuente cae > 60 s |
| **Replay** | Reenvío de push antiguo | `exp_ms`, `alert_id` idempotente, ventana de vigencia |
| **MITM** | Red hostil | TLS 1.3, certificate pinning con **pin de respaldo** y plan de rotación (nunca bloquear recepción de alertas por fallo de pinning) |
| **XSS/inyección** vía `place` | Datos no confiables | Longitud, caracteres, escape, CSP estricta en web |
| **SSRF** en ingesta | URLs manipuladas | **Allowlist** fija de hosts |
| **Fuga de ubicación** | Abuso de API | Sin histórico de trayectorias; ubicación efímera; opt-in; BOLA verificada |
| **Spam de reportes** | Bots | Rate limit IP+dispositivo, App Attest / Play Integrity solo en escritura |
| **Toma de admin** | Credenciales | MFA/WebAuthn, RBAC, cookies HttpOnly+Secure+SameSite=Strict, CSRF, auditoría inmutable |
| **Cadena de suministro** | Dependencias | Versiones exactas, lockfiles, osv-scanner, govulncheck, pnpm audit, SBOM, cosign, Dependabot |
| **Manipulación APK/IPA** | Ingeniería inversa | R8/obfuscation, sin secretos en binario, root/jailbreak solo informativo |
| **Secretos expuestos** | Git / logs | gitleaks pre-commit y CI; KMS; logs sin tokens ni PII |

## 8.2 Reglas duras
- **Recibir alertas públicas NUNCA requiere cuenta ni integridad del dispositivo.**
- Datos personales cifrados (Hive + Keychain/Keystore, AES-256); borrado garantizado; retención definida.
- Web/admin: CSP con nonce, HSTS, nosniff, Referrer-Policy, Permissions-Policy, `frame-ancestors 'none'`, sin `dangerouslySetInnerHTML`.
- OWASP MASVS (L1 + partes L2) y OWASP API Top 10 por release; evidencias en `docs/security/`.
- Cumplimiento: GDPR / LFPDPPP / **Ley 172-13 (RD)** — verificar con asesoría legal.
- CI de seguridad bloqueante: gitleaks, semgrep, gosec, govulncheck, pnpm audit --prod, trivy, flutter analyze.

---

# PARTE 9 — RENDIMIENTO (PRESUPUESTOS)

| Métrica | Objetivo |
|---|---|
| Fuente → pantalla | < 2 s p50 / < 4 s p99 |
| Normalizador / decisión / enriquecimiento / cola→push | < 200 / < 100 / < 200 / < 400 ms |
| Arranque en frío | < 2 s |
| Frames | 16 ms (60 fps) |
| Batería | < 2 %/día extra, sin GPS continuo |
| APK/AAB | < 40 MB |
| Web CWV | LCP < 2.5 s · INP < 200 ms · CLS < 0.1 |
| Cobertura | ≥ 80 % normalizador/decisión/TEA/serialización; 100 % firma/idempotencia |

---

# PARTE 10 — FASES (F0 → F9) CON GATES

- **F0 Fundamentos y marca** — monorepo, CI, docker-compose, `.env.example`, PROGRESS/BLOCKERS, assets de marca, fuentes, tokens Flutter+Tailwind, test de contraste. **Gate:** `make verify` verde; contraste AA; icono legible a 29 px.
- **F1 Contratos y configuración** — `packages/proto`, JSON Schemas + validadores Go/TS/Dart, `packages/config` (DO, MX, i18n), test epoch↔texto. **Gate:** mismos fixtures en 3 lenguajes; schema-diff en CI.
- **F2 Ingesta/normalización/dedup (Go)** — USGS (30 s, ETag), EMSC WS, `AlertSourceProvider` (CNS/PTWC/CAP/SASMEX disabled), normalizador, dedup, revisiones, sanitización, allowlist, circuit breaker, métricas. **Gate:** QA-02/03/08; fixtures reales; fuzz.
- **F3 Decisión/enriquecimiento/entrega (Go)** — CRITICAL/INFORMATIVE, IntensityEstimator, cola prioritaria, FCM v1 + APNs, topics geohash, Ed25519, DLQ, N0–N4. **Gate:** p99 < 4 s; QA-01/04/10; chaos.
- **F4 API (Node/TS + PostGIS)** — `/v1/*`, auth, zod, BOLA, ETag, rate limit Redis→Map, migraciones, safe_sites, familia, status, felt, health. **Gate:** integración vs Postgres; semgrep/gosec limpio; OWASP API.
- **F5 App base (Flutter)** — features, tema, router, i18n, storage cifrado, red con pinning, onboarding, diagnóstico, topics geohash, clock offset. **Gate:** analyze limpio; goldens 320/360/412/768; a11y.
- **F6 Alerta crítica** — nativo Android/iOS, firma, idempotencia, full-screen, TTS, simulacro. **Gate:** QA-01/04/10/11/13–17 en dispositivo real.
- **F7 Módulo Evento** — tarjeta completa + web `/evento/[id]` + caché 100 eventos. **Gate:** RF-10…17; QA-03/05/06/07.
- **F8 Mapa, sitios, multi-hazard, familia, guías, SOS, simulacros, admin.** **Gate:** RF-20…27; QA-09/12.
- **F9 Endurecimiento y release.** **Gate:** todos + checklist §14.3.

---

# PARTE 11 — QA ZERO-DEFECT (QA-13…QA-24 añadidos)

| ID | Caso | Esperado |
|---|---|---|
| QA-13 | Push con firma inválida | No suena; incidente; confirma vía `/v1/events`; si real, alarma |
| QA-14 | Push válido tras `exp_ms` | Solo informativo |
| QA-15 | Permiso Críticas/DND denegado | Diagnóstico claro; alerta por el mejor canal |
| QA-16 | `place` con `<script>` y 5 000 chars | Escapado y truncado |
| QA-17 | lon/lat invertidos o epoch en segundos | Rechazado en ingesta; alarma ops |
| QA-18 | Reloj +5 min | TEA correcto con clockOffset |
| QA-19 | Zona RD y cambio de zona | Hora local correcta; UTC intacto |
| QA-20 | EMSC tormenta de reconexión | Backoff+jitter, sin duplicar |
| QA-21 | JSON malformado USGS | Descartado con métrica; pipeline vivo |
| QA-22 | Abuso status/felt 1000 req/min | 429; camino crítico intacto |
| QA-23 | Simulacro | «Esto es un simulacro»; canal no crítico |
| QA-24 | Leer círculo ajeno | 403/404; auditado |

Matriz responsive: 320×568 · 360×640 · 390×844 · 412×915 · 768×1024 · 1024×768 · 673×841; texto 1.0/1.5/2.0; oscuro/claro. Web: 375/768/1280/1536.

---

# PARTE 12 — OBSERVABILIDAD, CI/CD E INFRA
Métricas `latency_e2e_seconds`, `delivery_rate`, `source_health`, `dedup_accuracy`, `tts_failures`, `user_reports_miss`; trazas OTel por `alert_id`; alertas ops (p99 > 4 s 5 min · delivery < 99.9 % · fuente caída > 60 s · ≥10 «no recibí»). CI: PR ⇒ lint+unit+integración+seguridad+latencia; main ⇒ staging; release ⇒ canary + rollback. Terraform 2 regiones, 99.95 %.

---

# PARTE 13 — PROHIBICIONES ABSOLUTAS
1. Secretos en repo/bundle/logs. 2. Postgres/enriquecimiento/mapas en camino crítico. 3. Alarmar sin verificar, o descartar alerta real por verificación secundaria. 4. Estimaciones como oficiales. 5. Fechas ambiguas / mezclar s y ms. 6. «Seguro» sin `verified=true`. 7. Monetizar degradando alertas / vender trayectorias. 8. Inventar endpoints/cifras/sitios/acuerdos. 9. Colores fuera de tokens; color como único indicador; texto rojo pequeño sobre navy. 10. Warnings ignorados, tests desactivados, TODO sin ID. 11. Sobrescribir trabajo que pasó su gate.

---

# PARTE 14 — LOOP, REPORTE Y CIERRE
Loop: PLAN → BUILD → VERIFY → AUDIT → FIX → CLOSE. Bloqueos de terceros ⇒ `BLOCKERS.md` y continuar.

Formato PROGRESS.md:
```
✅ COMPLETADO / 🔄 EN PROGRESO / ⏳ SIGUIENTE / ⚠️ BLOQUEADOR / 🔐 SEGURIDAD / 📈 MÉTRICAS
```

Checklist final §14.3: gates F0–F9 verdes con `make verify`; RF/RNF/QA con evidencia; p99 < 4 s; Ed25519 + idempotencia + N0–N4 por chaos; Evento offline; responsive; WCAG 2.2 AA; sin secretos; privacidad; runbooks; comunicación honesta.
