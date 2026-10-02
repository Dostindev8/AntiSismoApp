import { z } from "zod";

import doContacts from "../../../../data/emergency_contacts/DO.json";

const contactSchema = z.object({
  region: z.string().regex(/^[A-Z]{2}$/),
  service: z.string().min(1),
  number: z.string().regex(/^\+?[0-9*#]{3,15}$/),
  verified: z.literal(true),
  source_url: z.url({ protocol: /^https$/ }),
  source_name: z.string().min(1),
  verified_at: z.iso.datetime(),
  version: z.number().int().positive(),
});

const fileSchema = z.object({
  region: z.string(),
  version: z.number().int().positive(),
  contacts: z.array(contactSchema).min(1),
});

export type EmergencyContact = z.infer<typeof contactSchema>;

/** Solo números verificados contra fuente oficial (mismo origen que la app móvil, F5B). Falla el build si no. */
export function parseContacts(data: unknown): EmergencyContact[] {
  return fileSchema.parse(data).contacts;
}

export const dominicanContacts = parseContacts(doContacts);

export function primaryContact(contacts: EmergencyContact[]): EmergencyContact {
  const general = contacts.find((c) => c.service === "general") ?? contacts[0];
  if (!general) throw new Error("sin contactos verificados");
  return general;
}

/** `tel:` solo con números ya validados por el esquema; nunca concatena texto libre. */
export function telHref(number: string): string {
  if (!/^\+?[0-9*#]{3,15}$/.test(number)) throw new Error("número inválido");
  return `tel:${number.replace(/#/g, "%23")}`;
}
