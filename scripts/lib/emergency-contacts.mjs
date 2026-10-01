// Validación de data/emergency_contacts/{region}.json (F5B). Solo números verificados contra una fuente
// oficial: cualquier entrada sin verificar, sin fuente https o con número fuera de la allowlist rompe el
// gate y, por tanto, cualquier build de release.
export const NUMBER_RE = /^\+?[0-9*#]{3,15}$/;

/** Devuelve la lista de errores (vacía = válido). `code` es el nombre de archivo sin extensión. */
export function validateRegionFile(code, d) {
  const errors = [];
  if (!d || d.region !== code || !Number.isInteger(d.version) || !Array.isArray(d.contacts) || d.contacts.length === 0) {
    return [`${code}: cabecera inválida`];
  }
  const seen = new Set();
  for (const c of d.contacts) {
    const id = `${code}:${c?.service}`;
    if (c?.region !== code) errors.push(`${id}: region`);
    if (c?.verified !== true) errors.push(`${id}: verified=false`);
    if (typeof c?.source_url !== "string" || !/^https:\/\/[^\s"'<>]+$/.test(c.source_url)) errors.push(`${id}: source_url https requerido`);
    if (typeof c?.number !== "string" || !NUMBER_RE.test(c.number)) errors.push(`${id}: número inválido`);
    if (typeof c?.service !== "string" || !/^[a-z_]{2,24}$/.test(c.service)) errors.push(`${id}: service`);
    if (typeof c?.verified_at !== "string" || Number.isNaN(Date.parse(c.verified_at))) errors.push(`${id}: verified_at`);
    if (!Number.isInteger(c?.version)) errors.push(`${id}: version`);
    if (seen.has(c?.service)) errors.push(`${id}: servicio duplicado`);
    seen.add(c?.service);
  }
  return errors;
}
