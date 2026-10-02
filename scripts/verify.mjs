#!/usr/bin/env node
// Gate reproducible (`make verify` / `pnpm verify`). Falla si CUALQUIER paso falla.
// Herramientas ausentes = FALLO, salvo que se omitan explícitamente: ANTISISMO_SKIP=flutter,go
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const isWin = process.platform === "win32";
const skip = new Set((process.env.ANTISISMO_SKIP ?? "").split(",").filter(Boolean));

function findTool(name, envVar, candidates) {
  if (process.env[envVar]) return process.env[envVar];
  const probe = spawnSync(isWin ? "where" : "which", [name], { encoding: "utf8", shell: false });
  if (probe.status === 0) {
    // Ruta resuelta (no el nombre): en Windows `flutter` es un .bat y spawnSync sin shell solo ejecuta rutas .exe/.bat explícitas.
    const hits = probe.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return (isWin ? hits.find((h) => /\.(exe|bat|cmd)$/i.test(h)) : hits[0]) ?? name;
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

const GO = findTool("go", "GO_BIN", ["C:\\Program Files\\Go\\bin\\go.exe", "/usr/local/go/bin/go"]);
const FLUTTER = findTool("flutter", "FLUTTER_BIN", ["C:\\src\\flutter\\bin\\flutter.bat", `${process.env.HOME}/flutter/bin/flutter`]);

const results = [];

function run(label, cmd, args, cwd = root, { expectEmptyStdout = false } = {}) {
  const t = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: isWin && /\.(bat|cmd)$/i.test(cmd) ? true : isWin && cmd === "pnpm", maxBuffer: 64 << 20 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  const ok = r.status === 0 && (!expectEmptyStdout || (r.stdout ?? "").trim() === "");
  results.push({ label, ok, ms: Date.now() - t });
  console.log(`${ok ? "✓" : "✗"} ${label} (${Date.now() - t} ms)`);
  if (!ok) console.log(out.split("\n").slice(-40).join("\n"));
  return ok;
}

function step(label, fn) {
  const t = Date.now();
  let ok = false;
  let msg = "";
  try {
    msg = fn() ?? "";
    ok = true;
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  results.push({ label, ok, ms: Date.now() - t });
  console.log(`${ok ? "✓" : "✗"} ${label}${msg ? ` — ${msg}` : ""}`);
}

function skipOrFail(label, tool) {
  if (skip.has(tool)) {
    results.push({ label, ok: true, ms: 0, skipped: true });
    console.log(`○ ${label} — OMITIDO explícitamente (ANTISISMO_SKIP=${tool})`);
  } else {
    results.push({ label, ok: false, ms: 0 });
    console.log(`✗ ${label} — herramienta '${tool}' no encontrada`);
  }
}

// ── 1. Secret scan local (gitleaks corre además en CI) ───────────────────────
const IGNORE_DIRS = new Set(["node_modules", ".git", ".dart_tool", "build", ".gradle", "Pods", ".next", "coverage", ".idea"]);
const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/, "private key"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/"private_key"\s*:\s*"-----BEGIN/, "service account"],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, "GitHub token"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/sk_live_[A-Za-z0-9]{20,}/, "Stripe live key"],
];
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|ya?ml|go|dart|kt|kts|swift|plist|xml|gradle|properties|env|example|md|mdc|txt|sh|py|css|html)$/i;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (st.size < 2_000_000 && (TEXT_EXT.test(name) || name.startsWith(".env"))) yield p;
  }
}

step("secret scan (repo)", () => {
  const hits = [];
  for (const f of walk(root)) {
    const rel = relative(root, f).split(sep).join("/");
    if (/^\.env($|\.)/.test(rel.split("/").pop()) && !rel.endsWith(".env.example")) hits.push(`${rel}: archivo .env versionable`);
    const s = readFileSync(f, "utf8");
    for (const [re, what] of SECRET_PATTERNS) if (re.test(s)) hits.push(`${rel}: ${what}`);
  }
  if (hits.length) throw new Error(hits.join("; "));
  return "sin hallazgos";
});

// ── 2. Tokens/i18n generados sin drift ───────────────────────────────────────
run("tokens + i18n sin drift", process.execPath, ["scripts/gen-tokens.mjs", "--check"]);
run("contactos de emergencia verificados (QA-E1/E2)", process.execPath, ["--test", "scripts/lib/emergency-contacts.test.mjs"]);

// ── 3. Marca (F0 gate) ───────────────────────────────────────────────────────
step("assets de marca y fuentes OFL", () => {
  const need = [
    "apps/mobile/assets/brand/app_icon.png", "apps/mobile/assets/brand/icon_29.png", "apps/mobile/assets/brand/app_icon_fg.png",
    "apps/mobile/assets/brand/app_icon_mono.png", "apps/mobile/assets/brand/logo-fullcolor.png", "apps/mobile/assets/brand/splash.png",
    "apps/mobile/assets/fonts/Inter-Regular.ttf", "apps/mobile/assets/fonts/Poppins-ExtraBold.ttf",
    "apps/mobile/assets/licenses/Inter-OFL.txt", "apps/mobile/assets/licenses/Poppins-OFL.txt",
    "apps/web/public/brand/logo-fullcolor.webp", "apps/web/public/brand/symbol.webp", "apps/web/public/brand/icon-192.png",
    "apps/web/public/brand/icon-512.png", "apps/web/public/brand/icon-maskable-512.png", "apps/web/public/brand/favicon.ico",
  ];
  const missing = need.filter((p) => !existsSync(join(root, p)));
  if (missing.length) throw new Error(`faltan: ${missing.join(", ")}`);
  return `${need.length} archivos`;
});

// ── 4. TypeScript (config + proto + web + api) ──────────────────────────────
run("pnpm typecheck (strict)", "pnpm", ["-r", "--if-present", "typecheck"]);
run("pnpm lint (0 warnings)", "pnpm", ["-r", "--if-present", "lint"]);
run("pnpm test (vitest)", "pnpm", ["-r", "--if-present", "test"]);
run("web build (next)", "pnpm", ["--filter", "@antisismo/web", "build"]);
run("api build (tsc)", "pnpm", ["--filter", "@antisismo/api", "build"]);
run("pnpm audit (alto/crítico)", "pnpm", ["audit", "--audit-level", "high"]);

const GITLEAKS = findTool("gitleaks", "GITLEAKS_BIN", []);
if (GITLEAKS) {
  run("gitleaks (árbol de trabajo)", GITLEAKS, ["dir", ".", "--no-banner", "--redact"]);
  run("gitleaks (historial git)", GITLEAKS, ["git", ".", "--no-banner", "--redact"]);
} else skipOrFail("gitleaks", "gitleaks");

// ── 5. Go (camino crítico) ──────────────────────────────────────────────────
const goModules = ["packages/proto/go", "packages/geo/go", "services/ingestion", "services/decision", "services/delivery"];
if (GO) {
  const gofmt = GO.replace(/go(\.exe)?$/, (m) => m.replace("go", "gofmt"));
  for (const m of goModules) {
    const cwd = join(root, m);
    run(`gofmt ${m}`, existsSync(gofmt) ? gofmt : "gofmt", ["-l", "."], cwd, { expectEmptyStdout: true });
    run(`go vet ${m}`, GO, ["vet", "./..."], cwd);
    run(`go test ${m}`, GO, ["test", "-count=1", "-cover", "./..."], cwd);
  }
} else for (const m of goModules) skipOrFail(`go ${m}`, "go");

// ── 6. Flutter ──────────────────────────────────────────────────────────────
if (FLUTTER) {
  const cwd = join(root, "apps/mobile");
  run("flutter analyze (strict, 0 issues)", FLUTTER, ["analyze", "--fatal-infos", "--fatal-warnings"], cwd);
  run("flutter test", FLUTTER, ["test"], cwd);
} else skipOrFail("flutter analyze/test", "flutter");

// ── Resumen ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped);
console.log(`\n${failed.length ? "✗ GATE ROJO" : "✓ GATE VERDE"} — ${results.length - failed.length}/${results.length} pasos OK${skipped.length ? ` (${skipped.length} omitidos explícitamente)` : ""}`);
process.exit(failed.length ? 1 : 0);
