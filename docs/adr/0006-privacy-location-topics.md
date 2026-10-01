# ADR-0006 — Privacidad: ubicación y topics · 2026-09-30

## Decisión
- El servidor publica por **topic de celda geohash gruesa** `alerts_{REGION}_{geohash}` con precisión
  4 (≈ 37×19 km). El motor rechaza precisiones fuera de 3..5 (celdas finas permitirían inferir domicilio).
- El dispositivo se suscribe a su celda; **la ubicación exacta nunca sale del teléfono**. El TEA se
  calcula en el dispositivo (Haversine + profundidad, `sWaveKmPerS` = 3,5 idéntico en Go y Dart).
- Pantalla de emergencia: la ubicación se pide **solo** al pulsar «Obtener mi ubicación», se muestra
  (Plus Code + lat/lon + precisión) y solo sale del teléfono si la persona copia o envía el SMS.
- Datos locales: nombre para la voz (≤ 40 caracteres), idioma, país, estado «Estoy bien/Necesito ayuda»
  y ficha cifrada. Nada se sincroniza.
- iOS `NSLocationWhenInUseUsageDescription` explica el uso; Android solo `ACCESS_COARSE/FINE_LOCATION`
  en primer plano (sin ubicación en segundo plano).

## Pendiente
Revisión legal (BLK-10) y traducción del texto de permiso iOS a `en` (InfoPlist.strings) antes de release.
