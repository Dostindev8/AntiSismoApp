// GENERADO por scripts/gen-tokens.mjs desde data/emergency_contacts/*.json — NO EDITAR A MANO.
// Embebido en el binario: el módulo de emergencia funciona sin red ni lectura de assets.
import 'emergency_contact.dart';

const emergencyContactsByRegion = <String, List<EmergencyContact>>{
  'DO': [
    EmergencyContact(region: 'DO', service: 'general', number: '911', sourceUrl: 'https://911.gob.do/', sourceName: 'Sistema Nacional de Atención a Emergencias y Seguridad 9-1-1 (Gobierno de la República Dominicana)', verifiedAt: '2026-10-01T03:55:00Z', version: 1),
  ],
  'MX': [
    EmergencyContact(region: 'MX', service: 'general', number: '911', sourceUrl: 'https://www.c5.cdmx.gob.mx/', sourceName: 'C5 · Centro de Comando, Control, Cómputo, Comunicaciones y Contacto Ciudadano (Gobierno de la Ciudad de México) — «Emergencias 9-1-1»', verifiedAt: '2026-10-01T03:55:00Z', version: 1),
  ],
};
