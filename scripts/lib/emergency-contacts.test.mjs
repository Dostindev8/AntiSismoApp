// QA-E2: bloqueo de build si hay datos de emergencia sin verificar. Ejecutado por scripts/verify.mjs.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { NUMBER_RE, validateRegionFile } from "./emergency-contacts.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const good = () => ({
  region: "DO",
  version: 1,
  contacts: [{ region: "DO", service: "general", number: "911", verified: true, source_url: "https://911.gob.do/", verified_at: "2026-10-01T03:55:00Z", version: 1 }],
});

test("repo data is valid and only verified official numbers ship", () => {
  for (const f of readdirSync(join(root, "data/emergency_contacts")).filter((n) => n.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(join(root, "data/emergency_contacts", f), "utf8"));
    assert.deepEqual(validateRegionFile(f.slice(0, -5), d), [], f);
  }
});

test("valid fixture passes", () => assert.deepEqual(validateRegionFile("DO", good()), []));

test("verified=false blocks the build", () => {
  const d = good();
  d.contacts[0].verified = false;
  assert.match(validateRegionFile("DO", d).join(), /verified=false/);
});

test("missing or non-https source_url blocks the build", () => {
  for (const url of [undefined, "", "http://911.gob.do/", "javascript:alert(1)", "https://x.y/\"onload"]) {
    const d = good();
    d.contacts[0].source_url = url;
    assert.match(validateRegionFile("DO", d).join(), /source_url/, String(url));
  }
});

test("QA-E1: number allowlist rejects URI injection attempts", () => {
  for (const n of ["911", "+18095551234", "*911#", "112"]) assert.ok(NUMBER_RE.test(n), n);
  for (const n of ["91", "911;ext", "911?call", "tel:911", "911\n", "9 1 1", "911%0A", "+1234567890123456", "", "911&body=x", "１１２"]) {
    assert.ok(!NUMBER_RE.test(n), JSON.stringify(n));
    const d = good();
    d.contacts[0].number = n;
    assert.match(validateRegionFile("DO", d).join(), /número inválido/);
  }
});

test("region mismatch, duplicates and bad header are rejected", () => {
  const d = good();
  d.contacts.push({ ...d.contacts[0] });
  assert.match(validateRegionFile("DO", d).join(), /duplicado/);
  assert.match(validateRegionFile("MX", good()).join(), /cabecera/);
  assert.match(validateRegionFile("DO", { ...good(), contacts: [] }).join(), /cabecera/);
  assert.match(validateRegionFile("DO", null).join(), /cabecera/);
});
