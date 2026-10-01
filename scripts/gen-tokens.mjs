#!/usr/bin/env node
// Genera tokens de diseño para Flutter y Tailwind desde packages/config/tokens.json (fuente única).
// `node scripts/gen-tokens.mjs --check` falla si los archivos generados están desactualizados (drift).
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateRegionFile } from "./lib/emergency-contacts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "packages/config/tokens.json"), "utf8"));
const check = process.argv.includes("--check");

const HEADER = "GENERADO por scripts/gen-tokens.mjs desde packages/config/tokens.json — NO EDITAR A MANO.";
const argb = (hex) => `0xFF${hex.slice(1).toUpperCase()}`;
const kebab = (s) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

const dart = `// ${HEADER}
import 'package:flutter/painting.dart';

abstract final class AppColors {
${Object.entries(tokens.colors).map(([k, v]) => `  static const ${k} = Color(${argb(v)});`).join("\n")}
}

abstract final class HazardColors {
${Object.entries(tokens.hazards).map(([k, v]) => `  static const ${k} = Color(${argb(v.color)});`).join("\n")}
}

abstract final class AppRadius {
${Object.entries(tokens.radius).map(([k, v]) => `  static const double ${k} = ${v};`).join("\n")}
}

abstract final class AppSpacing {
${Object.entries(tokens.spacing).map(([k, v]) => `  static const double ${k} = ${v};`).join("\n")}
}

abstract final class AppBreakpoints {
${Object.entries(tokens.breakpoints).map(([k, v]) => `  static const double ${k} = ${v};`).join("\n")}
}
`;

const css = `/* ${HEADER} */
@theme {
${Object.entries(tokens.colors).map(([k, v]) => `  --color-${kebab(k)}: ${v};`).join("\n")}
${Object.entries(tokens.hazards).map(([k, v]) => `  --color-hazard-${k}: ${v.color};`).join("\n")}
${Object.entries(tokens.radius).map(([k, v]) => `  --radius-${k}: ${v === 999 ? "9999px" : `${v}px`};`).join("\n")}
  --font-display: "Poppins", system-ui, sans-serif;
  --font-sans: "Inter", system-ui, sans-serif;
  --text-fluid-h1: clamp(1.75rem, 1.2rem + 2.5vw, 3rem);
}
`;

// i18n: base es-DO + overrides por locale (mismas reglas que packages/config/src/i18n.ts)
const i18nDir = join(root, "packages/config/i18n");
const base = JSON.parse(readFileSync(join(i18nDir, "es-DO.json"), "utf8"));
const locales = readdirSync(i18nDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
const dartStr = (s) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$").replace(/\n/g, "\\n")}'`;
const i18nDart = `// ${HEADER.replace("tokens.json", "i18n/*.json")}

const baseLocale = 'es-DO';

const supportedLocales = <String>[${locales.map(dartStr).join(", ")}];

const messagesByLocale = <String, Map<String, String>>{
${locales
  .map((loc) => {
    const merged = loc === "es-DO" ? base : { ...base, ...JSON.parse(readFileSync(join(i18nDir, `${loc}.json`), "utf8")) };
    return `  ${dartStr(loc)}: {\n${Object.entries(merged).map(([k, v]) => `    ${dartStr(k)}: ${dartStr(v)},`).join("\n")}\n  },`;
  })
  .join("\n")}
};
`;

// Contactos de emergencia (F5B): solo números verificados contra fuente oficial. Cualquier entrada sin
// verificar, sin fuente https o con número fuera de ^\+?[0-9*#]{3,15}$ rompe el gate (y por tanto el release).
const ecDir = join(root, "data/emergency_contacts");
const ecErrors = [];
const ecData = readdirSync(ecDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => {
    const d = JSON.parse(readFileSync(join(ecDir, f), "utf8"));
    ecErrors.push(...validateRegionFile(f.slice(0, -5), d));
    return d;
  });
if (ecErrors.length) {
  console.error(`✗ emergency_contacts inválidos: ${ecErrors.join("; ")}`);
  process.exit(1);
}
const ecDart = `// ${HEADER.replace("packages/config/tokens.json", "data/emergency_contacts/*.json")}
// Embebido en el binario: el módulo de emergencia funciona sin red ni lectura de assets.
import 'emergency_contact.dart';

const emergencyContactsByRegion = <String, List<EmergencyContact>>{
${ecData
  .map(
    (d) => `  ${dartStr(d.region)}: [\n${d.contacts
      .map(
        (c) =>
          `    EmergencyContact(region: ${dartStr(c.region)}, service: ${dartStr(c.service)}, number: ${dartStr(c.number)}, sourceUrl: ${dartStr(c.source_url)}, sourceName: ${dartStr(c.source_name ?? "")}, verifiedAt: ${dartStr(c.verified_at)}, version: ${c.version}),`,
      )
      .join("\n")}\n  ],`,
  )
  .join("\n")}
};
`;

const outputs = [
  ["apps/mobile/lib/core/theme/app_tokens.g.dart", dart],
  ["packages/config/generated/tokens.css", css],
  ["apps/mobile/lib/core/i18n/messages.g.dart", i18nDart],
  ["apps/mobile/lib/features/emergency/data/emergency_contacts.g.dart", ecDart],
];

let drift = false;
for (const [rel, content] of outputs) {
  const p = join(root, rel);
  const current = existsSync(p) ? readFileSync(p, "utf8") : null;
  if (check) {
    if (current !== content) {
      console.error(`✗ token drift: ${rel} (run: pnpm gen:tokens)`);
      drift = true;
    }
    continue;
  }
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, "utf8");
  console.log(`✓ ${rel}`);
}
if (drift) process.exit(1);
if (check) console.log("✓ tokens in sync");
