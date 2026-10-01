# Benchmark — apps líderes de alerta y emergencia (2026-09-30)

Fuentes públicas consultadas en esta iteración. Solo se citan comportamientos documentados por cada
proveedor; no se citan cifras que no aparezcan en la fuente.

| Referente | Patrón documentado | Fuente | Cómo lo aplica AntiSismo |
|---|---|---|---|
| Android Earthquake Alerts (Google) | Dos niveles: «Be Aware» (informativa) y «Take Action» (pantalla completa, sonido fuerte, ignora No molestar) | [crisisresilience.google](https://crisisresilience.google/android-early-earthquake-warnings), [Google Research](https://research.google/blog/android-earthquake-alerts-a-global-system-for-early-warning/) | Niveles `CRITICAL` (pantalla completa) / `INFORMATIVE` decididos por celda; la pantalla crítica muestra **una sola instrucción** grande |
| Android Earthquake Alerts | Si la alerta llega después del temblor no se muestra como «Take Action»; sin interacción en 4 min pasa a «sismo ocurrido» | [Cal OES / Google (PDF)](https://www.caloes.ca.gov/wp-content/uploads/Earthquake-Tsunami-Volcano/Documents/Google_-Android-Earthquake-Alerts-CalOES-11.3_ADA.pdf) | Ya: `exp` ≤ 10 min ⇒ INFORMATIVE (QA-14) y la cuenta atrás nunca es negativa («La onda ya pudo haber llegado»). **Backlog BL-01**: degradar la pantalla tras N min sin interacción |
| Android Earthquake Alerts | Alerta para quien ya recibió «Be Aware» y entra en la zona de MMI 5+ (mejora de nivel) | ídem | Ya: una revisión que sube a CRITICAL vuelve a alarmar; nunca se cancela una alerta (dispatch F3) |
| MyShake (UC Berkeley / ShakeAlert) | Por seguridad, la app **no permite** configurar magnitud mínima, radio ni volumen de la alerta temprana | [myshake.berkeley.edu/faq](https://myshake.berkeley.edu/faq.html) | Umbrales solo en `packages/config/regions/*.yaml` (validados por schema); el usuario no puede silenciar alertas críticas |
| MyShake | Alerta sonora «Drop, Cover and Hold On» con voz calmada pero urgente, en varios idiomas | ídem, [earthquake.ca.gov](https://www.earthquake.ca.gov/get-alerts/) | Plantilla de voz fija con nombre + instrucción + llegada estimada (es-DO y en); TTS en el dispositivo, sin red |
| MyShake | Funciona con ubicación o con una dirección base («Homebase») | ídem | Topics por celda geohash gruesa (≈37×19 km): el servidor nunca conoce la ubicación exacta (ADR 0006). **Backlog BL-02**: celda base manual sin GPS |
| Apple Emergency SOS | Mantener pulsado + cuenta atrás + sonido; soltar antes del final cancela | [support.apple.com](https://support.apple.com/guide/iphone/contact-emergency-services-iph3c99374c/ios) | `HoldToCallButton`: mantener ~1 s con anillo de progreso y háptico; soltar a medias cancela (QA-E3) |
| Apple Emergency SOS | Tras la llamada se comparte Medical ID y se avisa a contactos | ídem | Ficha de emergencia opt-in, cifrada AES-256-GCM, solo local; SMS de ubicación que **la persona** envía |

## Lo que AntiSismo hace distinto (y por qué)
- **Nunca llama en silencio**: abre el marcador del sistema con el número cargado (`ACTION_DIAL`); la
  persona pulsa llamar. Evita llamadas accidentales en bolsillos y cumple la política de no realizar
  acciones de comunicación sin intervención humana (ADR 0002).
- **Números solo verificados**: cada número tiene fuente oficial https y fecha de verificación; el build
  falla si falta (QA-E2).
- **Recibir alertas no requiere cuenta** ni integridad del dispositivo: igual que los sistemas públicos.
