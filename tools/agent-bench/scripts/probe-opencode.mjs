#!/usr/bin/env node
// SONDA REAL de OpenCode (fase 1 de docs/PILOTO.md). Gasta cuota del proveedor: NO la ejecuta ningún agente.
//
// Lanza UNA sesión barata con el OpenCodeRunner dentro del Seatbelt, con topes duros (1 run, 10 min, 200 000 tokens),
// y vuelca a results/probe/<marca>/ (redactado, sin claves) lo que hace falta para confirmar los campos NV de
// docs/RUNNERS.md: muestra de cada tipo de evento SSE, forma de step-finish e info.tokens, reintentos (retry),
// esquema sqlite del run (sqlite_master + PRAGMA table_info + una fila de muestra), forma del diff y de las herramientas.
//
// Requisitos para ejecutarla de verdad (los tres, o sale con código 3 sin hacer nada):
//   --i-understand-this-uses-quota   AGENT_BENCH_CONFIRM_REAL=yes   OPENCODE_AUTH_CONTENT=<json de auth> (solo por entorno)
//   --provider P --model M           (un modelo barato; el que acuerde el dueño)
// Uso: node scripts/probe-opencode.mjs --provider opencode --model <id> --i-understand-this-uses-quota
// Salida: 0 ok y limpio, 1 fallo o huérfanos o secreto en el volcado, 2 uso, 3 rechazado (faltan los flags/confirmación).

import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** Topes duros de la sonda; no son configurables por línea de comandos. */
export const PROBE_LIMITS = Object.freeze({ runs: 1, timeoutSec: 600, maxTokens: 200_000, maxSteps: 8, inactivitySec: 120 });
export const FLAG = "--i-understand-this-uses-quota";
export const PROMPT = "Crea un archivo llamado hola.txt que contenga exactamente la palabra hola y termina. No hagas nada más.";

function parse(argv) {
  const o = { flag: false, provider: null, model: null, help: false, fakeBin: null, outDir: null, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === FLAG) o.flag = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--provider") o.provider = argv[++i] ?? null;
    else if (a === "--model") o.model = argv[++i] ?? null;
    else if (a === "--fake-bin") o.fakeBin = argv[++i] ?? null; // solo pruebas: script node que imita a opencode (no gasta cuota)
    else if (a === "--out-dir") o.outDir = argv[++i] ?? null; // solo pruebas: dónde volcar
    else o.unknown.push(a);
  }
  return o;
}

/** Plan en texto: qué haría la sonda (no toca la red ni lanza nada). */
export function describePlan(o) {
  const L = PROBE_LIMITS;
  return [
    "Sonda real de OpenCode (NO ejecutada). Haría, solo con confirmación explícita:",
    `  1. Comprobar sandbox-exec y 'opencode --version' (sin modelo).`,
    `  2. Crear un run aislado en ~/ab/r/<id8> con un workspace mínimo y lanzar UNA sesión del OpenCodeRunner dentro del Seatbelt`,
    `     (modelo ${o.provider ?? "<--provider>"}/${o.model ?? "<--model>"}; prompt: "${PROMPT}").`,
    `  3. Topes duros: ${L.runs} run, ${L.timeoutSec / 60} min, ${L.maxTokens} tokens, ${L.maxSteps} pasos, ${L.inactivitySec} s sin actividad; SIGINT/SIGTERM abortan limpio.`,
    `  4. Volcar a results/probe/<marca>/ (redactado): eventos SSE (muestra por tipo), step-finish e info.tokens/cost, retry, esquema sqlite, diff, herramientas.`,
    `  5. Verificar 0 huérfanos, que el volcado no contiene secretos, borrar el run y terminar.`,
    "Para ejecutarla: --i-understand-this-uses-quota, AGENT_BENCH_CONFIRM_REAL=yes y OPENCODE_AUTH_CONTENT en el entorno (nunca en disco).",
  ].join("\n");
}

/** Decide si se puede ejecutar de verdad. Devuelve null si sí, o el motivo del rechazo. */
export function refusal(o, env) {
  const miss = [];
  if (!o.flag) miss.push(`falta ${FLAG}`);
  if (env.AGENT_BENCH_CONFIRM_REAL !== "yes") miss.push("falta AGENT_BENCH_CONFIRM_REAL=yes");
  return miss.length ? miss.join("; ") : null;
}

/** Trunca a JSON acotado (para muestras). */
function clip(v, max = 3000) {
  const s = JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + `…(+${s.length - max} car.)` : s;
}

/** Forma (claves y tipos) de un valor, sin contenidos. */
function shapeOf(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return depth > 3 ? "array" : [v.length ? shapeOf(v[0], depth + 1) : "vacío"];
  if (typeof v === "object") {
    if (depth > 3) return "object";
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x, depth + 1)]));
  }
  return typeof v;
}

function sqliteDump(dbPath, DatabaseSync, redact) {
  const out = { path: "(run)/" + dbPath.split("/").slice(-3).join("/"), tables: {} };
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const master = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all();
    out.master = master;
    for (const t of master.filter((m) => m.type === "table" && !m.name.startsWith("sqlite_"))) {
      const info = db.prepare(`PRAGMA table_info(${JSON.stringify(t.name)})`).all();
      const count = db.prepare(`SELECT count(*) AS n FROM ${JSON.stringify(t.name)}`).get().n;
      let sample = null;
      try {
        const row = db.prepare(`SELECT * FROM ${JSON.stringify(t.name)} ORDER BY rowid LIMIT 1`).get();
        if (row) sample = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? redact(v.slice(0, 1500)) : v]));
      } catch { /* tabla sin rowid */ }
      out.tables[t.name] = { columns: info.map((c) => `${c.name} ${c.type}`), rows: count, sample };
    }
    // muestras de data de message/part por tipo (forma de step-finish, tools)
    const partTypes = {};
    try {
      for (const r of db.prepare("SELECT data FROM part").all()) {
        let d; try { d = JSON.parse(r.data); } catch { continue; }
        const ty = String(d?.type ?? "?");
        partTypes[ty] ??= { n: 0, shape: shapeOf(d), sample: redact(clip(d, 2000)) };
        partTypes[ty].n++;
      }
    } catch { /* sin tabla part */ }
    out.partTypes = partTypes;
  } finally { db.close(); }
  return out;
}

export async function main(argv, env) {
  const o = parse(argv);
  if (o.help) { console.log(describePlan(o)); return 0; }
  if (o.unknown.length) { console.error(`opciones desconocidas: ${o.unknown.join(" ")}`); return 2; }
  const why = refusal(o, env);
  if (why) {
    console.log(describePlan(o));
    console.error(`\nRECHAZADA: ${why}. No se ha ejecutado nada.`);
    return 3;
  }
  if (!o.provider || !o.model) { console.error("faltan --provider y --model (modelo barato acordado con el dueño)"); return 2; }
  if (!env.OPENCODE_AUTH_CONTENT) { console.error("falta OPENCODE_AUTH_CONTENT en el entorno (solo por entorno, nunca en disco)"); return 2; }

  // ---- A partir de aquí gasta cuota real. ----
  process.emitWarning = ((emit) => (w, ...r) => (String(w).includes("SQLite") ? undefined : emit(w, ...r)))(process.emitWarning.bind(process));
  const { OpenCodeRunner } = await import("../src/runners/opencode/index.ts");
  const { findDbPath } = await import("../src/runners/opencode/sqlite.ts");
  const { createRunLayout, removeRunLayout, buildEnv, sandboxAvailable } = await import("../src/isolation/index.ts");
  const { redactDeep, redactText, containsSecret } = await import("../src/core/redact.ts");
  const { writeFileNoFollow } = await import("../src/core/safefs.ts");
  const { randomUUID } = await import("node:crypto");
  const { DatabaseSync } = await import("node:sqlite");

  if (!sandboxAvailable()) { console.error("sandbox-exec no disponible: no se ejecuta opencode sin aislamiento"); return 1; }
  const runner = o.fakeBin
    ? new OpenCodeRunner({ bin: { cmd: process.execPath, args: [resolve(o.fakeBin)] } })
    : new OpenCodeRunner();
  const pr = await runner.probe();
  if (!pr.available) { console.error(`opencode no disponible: ${pr.notes ?? "?"}`); return 1; }
  console.error(`opencode ${pr.version}; lanzando UNA sesión (${o.provider}/${o.model}) con topes duros.`);

  const secrets = [env.OPENCODE_AUTH_CONTENT];
  const redact = (s) => redactText(s, secrets);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpDir = join(o.outDir ? resolve(o.outDir) : join(ROOT, "results", "probe"), stamp);
  mkdirSync(dumpDir, { recursive: true });

  const layout = createRunLayout(randomUUID().replace(/-/g, "").slice(0, 12));
  const binDir = o.fakeBin ? null : (() => { const r = spawnSync("/usr/bin/which", ["opencode"], { env: { PATH: env.PATH ?? "" }, encoding: "utf8" }); return r.status === 0 ? dirname(realpathSync(r.stdout.trim())) : null; })();
  const ctx = {
    runId: layout.runId, runRoot: layout.root, workspace: layout.ws, home: layout.home, tmp: layout.tmp, out: layout.out, seed: null,
    env: buildEnv(layout, { parentEnv: env, extraPath: binDir ? [binDir] : [], extra: { OPENCODE_AUTH_CONTENT: env.OPENCODE_AUTH_CONTENT } }),
  };
  const cfg = {
    schemaVersion: "1", id: "probe-opencode", name: "sonda real", runner: "opencode", provider: o.provider, model: o.model,
    skills: [], subagents: [], prompts: [], settings: { steps: PROBE_LIMITS.maxSteps }, tags: ["probe"],
  };
  const limits = { timeoutSec: PROBE_LIMITS.timeoutSec, maxSteps: PROBE_LIMITS.maxSteps, maxTokens: PROBE_LIMITS.maxTokens, inactivitySec: PROBE_LIMITS.inactivitySec };

  const ac = new AbortController();
  const stop = () => ac.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const wall = setTimeout(stop, (PROBE_LIMITS.timeoutSec + 30) * 1000); // tope duro del propio script (el runner ya lo respeta)
  let prepared = null; let code = 1; let orphans = -1;
  try {
    prepared = await runner.prepare(ctx, cfg);
    const rawOut = await runner.run(prepared, { scenarioId: "probe", prompt: PROMPT }, limits, ac.signal);
    const collected = await runner.collect(prepared, rawOut);
    const raw = rawOut.raw;

    const parts = (raw.messages ?? []).flatMap((m) => (m.parts ?? []).map((p) => ({ role: m.info?.role, ...p })));
    const toolParts = parts.filter((p) => p.type === "tool");
    const dump = {
      probedAt: new Date().toISOString(), opencodeVersion: pr.version, provider: o.provider, model: o.model, limits: PROBE_LIMITS,
      outcome: rawOut.outcome, collectedOutcome: collected.outcome, stopReason: raw.stopReason, verdict: raw.verdict, durationMs: rawOut.durationMs,
      NV1_eventos_sse: { counts: raw.eventTypes, samples: raw.eventSamples ?? "(el runner no guardó muestras)" },
      NV2_step_finish: {
        count: raw.stepFinishCount,
        observedBySse: raw.observedSteps ?? {},
        shapeFromMessages: shapeOf(parts.find((p) => p.type === "step-finish") ?? null),
        assistantInfoTokensCost: (raw.messages ?? []).filter((m) => m.info?.role === "assistant").map((m) => ({ tokens: m.info.tokens, cost: m.info.cost, finish: m.info.finish, error: m.info.error ?? null })),
      },
      NV3_retry: { retries: raw.retries, errorMessage: raw.errorMessage },
      NV5_diff: { entries: raw.diff, shape: shapeOf(raw.diff[0] ?? null) },
      NV6_tools: { names: [...new Set(toolParts.map((p) => p.tool))], sampleShape: shapeOf(toolParts[0] ?? null), sample: toolParts[0] ? clip(toolParts[0], 1500) : null },
      NV7_config: { messageShape: shapeOf((raw.messages ?? [])[0] ?? null), unverifiedReportedByRunner: collected.telemetry?.extra?.unverified ?? raw.unverified },
      NV8_cost: { costUsd: collected.telemetry?.costUsd ?? null, totalTokens: collected.telemetry?.totalTokens ?? null, tokenCrosscheck: collected.telemetry?.extra?.tokenCrosscheck ?? null, integrity: collected.telemetry?.extra?.telemetryIntegrity ?? null },
      telemetry: collected.telemetry,
    };
    const dbPath = findDbPath(prepared.state.xdgData);
    dump.NV4_sqlite = dbPath ? sqliteDump(dbPath, DatabaseSync, redact) : "(no se encontró la sqlite del run)";
    const textOut = JSON.stringify(redactDeep(dump, secrets), null, 1);
    if (containsSecret(textOut, secrets)) { console.error("el volcado contiene un secreto: se descarta"); rmSync(dumpDir, { recursive: true, force: true }); }
    else {
      writeFileNoFollow(join(dumpDir, "probe.json"), textOut);
      console.error(`volcado: ${join(dumpDir, "probe.json")}`);
      code = 0;
    }
  } catch (e) {
    console.error(`la sonda falló: ${redact(String(e?.message ?? e))}`);
  } finally {
    clearTimeout(wall);
    if (prepared) { try { orphans = (await runner.cleanup(prepared)).orphans; } catch { orphans = -1; } }
    try { removeRunLayout(layout); } catch { /* ya borrado */ }
  }
  if (orphans !== 0) { console.error(`huérfanos tras la sonda: ${orphans} (revisa con pgrep por AB_RUN_ROOT)`); code = 1; }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env).then((c) => process.exit(c), (e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
