# ADR-0002 — Llamadas de emergencia (F5B) · 2026-09-30

## Contexto
La persona debe poder pedir ayuda en segundos, aunque no haya red de datos, no tenga cuenta y el
backend esté caído. A la vez, un toque accidental no puede marcar a emergencias, y ninguna prueba
automatizada puede llamar a un número real.

## Decisión
1. **Marcador del sistema, no llamada directa.** `UrlLauncherDialer` lanza `tel:` (Android `ACTION_DIAL`,
   iOS `tel:` con `LSApplicationQueriesSchemes`). La persona confirma en el marcador. **No se declara
   `CALL_PHONE`** y no existe ruta de código para llamar sin confirmación. Si en el futuro se quisiera
   llamada directa, requiere ADR nuevo, permiso explícito en tiempo de ejecución y flag desactivado por
   defecto.
2. **Anti-accidente.** `HoldToCallButton`: mantener 1 s con anillo de progreso y háptico (selección al
   empezar, impacto fuerte al confirmar). Soltar o cancelar el puntero a medias reinicia. Objetivo
   táctil ≥ 120 dp de alto (≥ 64 dp exigido).
3. **Accesibilidad.** Con lector de pantalla el gesto de mantener no es practicable: el nodo semántico
   expone la acción «tocar» (doble toque) con etiqueta «Llamar al 911» y pista explícita. Texto ≥ 19 px
   en negrita sobre `alertRedStrong` (6,22:1) ⇒ AAA para texto grande.
4. **Datos verificados, embebidos.** `data/emergency_contacts/{REGION}.json` → generado a
   `emergency_contacts.g.dart` (constante en el binario: sin red ni lectura de assets). `gen-tokens`
   falla si un contacto no tiene `verified: true`, `source_url` https, número válido, `verified_at` ISO,
   `version` o hay duplicados. DO: 911 (911.gob.do). MX: 911 (C5 CDMX; nacional pendiente BLK-11).
5. **Región nunca supuesta.** Se toma del país del dispositivo solo si hay datos verificados; si no, la
   pantalla obliga a elegir. Selector manual siempre disponible.
6. **Sanitización.** `^\+?[0-9*#]{3,15}$`. `telUri`/`smsUri` lanzan `ArgumentError` ante cualquier
   otro valor (inyección `;`, `?`, `&`, `%00`, dígitos no ASCII…).
7. **Pruebas sin números reales.** `resolveDialTarget`: release ⇒ número oficial; debug/staging ⇒ solo
   `--dart-define=EMERGENCY_TEST_NUMBER`; sin él la llamada queda desactivada y se muestra el aviso.
   Las pruebas usan `5550100` (rango NANP reservado a ficción) y un `FakeDialer`.
8. **Sin telefonía** (tablets): número grande, botón copiar y aviso; no se muestra el botón de llamada.
9. **SMS de ubicación**: abre la app de mensajes con el cuerpo prellenado (Plus Code + lat/lon + enlace);
   la persona elige destinatario y pulsa enviar. Nunca SMS silencioso.
10. **Ficha de emergencia**: opt-in con consentimiento, AES-256-GCM (clave 256 bits en Keystore/Keychain,
    nonce 96 bits por escritura, AAD de versión), blob en SharedPreferences sin texto en claro; manipulación
    ⇒ estado de error con opción de borrar (nunca se muestran datos dudosos). Android `FLAG_SECURE` mientras
    está visible; iOS sin equivalente público (BLK-12).
11. **Aviso visible**: «AntiSismo no reemplaza a los servicios oficiales de emergencia».
12. **Privacidad**: el módulo no envía nada a ningún servidor. El evento anónimo opt-in
    `emergency_dial_initiated` queda **pendiente** de que exista el canal de analítica opt-in (F9); hoy
    no se emite ningún evento.

## Consecuencias
- Un paso extra (pulsar llamar en el marcador) a cambio de cero llamadas accidentales o silenciosas.
- La lista de países crece solo con verificación oficial (PR que añade JSON + fuente).

## Evidencia
QA-E1 `test/emergency/phone_number_test.dart` · QA-E2 `contacts_test.dart` + `scripts/lib/emergency-contacts.test.mjs`
· QA-E3 `hold_to_call_test.dart` · QA-E4/E5/E6 `emergency_screen_test.dart` · ficha `medical_card_test.dart`.

**F5B COMPLETE — emergencias: llamada offline + contactos verificados + anti-accidente**
