# ADR-0001 — Decisiones de F0–F2 (2026-09-29)

## 1. Identificador de app `app.antisismo.mobile`
`flutter create --org do.antisismo` generó `package do.antisismo.antisismo`. **`do` es palabra reservada en Kotlin/Java**: el build Android no compila. Se adopta `app.antisismo.mobile` (dominio inverso de `antisismo.app`, coherente con los `$id` de los JSON Schema). Android `applicationId`/`namespace` e iOS `PRODUCT_BUNDLE_IDENTIFIER` alineados. Requiere registrar el dominio (BLK-07).

## 2. Simulacros como `level: "DRILL"` firmado
La cadena canónica v1 (contrato fijo §7.2) no incluye un campo `drill`. Si el simulacro fuese un flag no firmado, un atacante podría quitarlo y convertir un simulacro en alarma crítica. Se codifica como `level=DRILL` **dentro** de la firma. El cliente nunca usa el canal crítico para DRILL (§3#13). Vectores: `drill-never-critical`, `drill-tampered-to-critical`.

## 3. Riesgo residual aceptado: campos de presentación no firmados en v1
La firma v1 cubre `alert_id, event.id, revision_seq, time_utc_ms, iat, exp, level, instruction`, pero no `magnitude`, `place`, coordenadas ni `tea_regional_seconds`. Mitigación actual: transporte TLS de FCM/APNs, ventana `exp` ≤ 10 min y reconciliación de la tarjeta vía `GET /v1/events` (TLS) en cuanto hay red. **Propuesta v2** (requiere aprobación, no se implementa sin decisión): añadir a la cadena canónica los enteros `round(magnitude*10)`, `round(lat*1e4)`, `round(lon*1e4)`, `round(depth_km*10)`, `tsunami(0|1)`, con vectores cruzados TS/Go/Dart antes de desplegar.

## 4. USGS no envía ETag
Verificado en vivo (2026-09-30 02:33 UTC): el feed responde `Last-Modified` y `Cache-Control: max-age=60`, **sin `ETag`**. El poller usa `If-Modified-Since` y añade `If-None-Match` solo si aparece un ETag. Polling mínimo 30 s (validado por schema de región).

## 5. Revisiones: solo fuente primaria o solución revisada
Un primer reporte de una fuente secundaria (p. ej. EMSC a 2 km del de USGS) solo aporta su `source_id`; no crea revisión. Así se evita fatiga de alertas. Una solución `reviewed` de cualquier fuente pasa a ser primaria. Un aviso de tsunami nunca se degrada por otra fuente.

## 6. Límite de 200 en `place` medido en unidades UTF-16
JS y Dart miden `String.length` en UTF-16 y Go en bytes/runas. Para que el mismo texto sea válido en los 3 lenguajes, Go usa `UTF16Len` y el sanitizador trunca sin partir pares sustitutos (emoji).

## 7. Detección de lon/lat invertidos: límite honesto
El chequeo de rangos solo detecta la inversión cuando |lon| > 90. Para RD (lon ≈ −70), un par invertido cae en rango válido (Antártida). Mitigación: dedup multi-fuente (un evento mal geolocalizado no casa con el de otra fuente) y alarma ops por fuente discordante (F3).
