import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SCRIPT = join(import.meta.dirname, "..", "..", "scripts", "probe-opencode.mjs");
const PROBE_DIR = join(import.meta.dirname, "..", "..", "results", "probe");

// Entorno mínimo a propósito: sin credenciales ni confirmación heredadas de quien lance los tests.
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "", ...env }, timeout: 30_000 });

test("sonda real: sin flags imprime el plan y sale con 3, sin tocar nada", () => {
  const before = existsSync(PROBE_DIR);
  const r = run(["--provider", "p", "--model", "m"]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /NO ejecutada/);
  assert.match(r.stdout, /200000 tokens/);
  assert.match(r.stderr, /RECHAZADA.*--i-understand-this-uses-quota.*AGENT_BENCH_CONFIRM_REAL=yes/);
  assert.equal(existsSync(PROBE_DIR), before, "no crea results/probe");
});

test("sonda real: se niega con solo uno de los dos requisitos", () => {
  const onlyFlag = run(["--i-understand-this-uses-quota", "--provider", "p", "--model", "m"]);
  assert.equal(onlyFlag.status, 3);
  assert.match(onlyFlag.stderr, /falta AGENT_BENCH_CONFIRM_REAL=yes/);
  assert.doesNotMatch(onlyFlag.stderr, /falta --i-understand/);
  const onlyEnv = run(["--provider", "p", "--model", "m"], { AGENT_BENCH_CONFIRM_REAL: "yes" });
  assert.equal(onlyEnv.status, 3);
  assert.match(onlyEnv.stderr, /falta --i-understand-this-uses-quota/);
  const wrongEnv = run(["--i-understand-this-uses-quota"], { AGENT_BENCH_CONFIRM_REAL: "true" });
  assert.equal(wrongEnv.status, 3);
});

test("sonda real: con ambos requisitos pero sin modelo o sin credencial en el entorno sale con 2 antes de gastar nada", () => {
  const noModel = run(["--i-understand-this-uses-quota"], { AGENT_BENCH_CONFIRM_REAL: "yes" });
  assert.equal(noModel.status, 2);
  assert.match(noModel.stderr, /--provider y --model/);
  const noAuth = run(["--i-understand-this-uses-quota", "--provider", "p", "--model", "m"], { AGENT_BENCH_CONFIRM_REAL: "yes" });
  assert.equal(noAuth.status, 2);
  assert.match(noAuth.stderr, /OPENCODE_AUTH_CONTENT/);
});

test("sonda real: topes duros fijos y opción desconocida rechazada", async () => {
  const m = await import(SCRIPT);
  assert.deepEqual({ ...m.PROBE_LIMITS }, { runs: 1, timeoutSec: 600, maxTokens: 200_000, maxSteps: 8, inactivitySec: 120 });
  assert.equal(run(["--max-tokens", "9999999"]).status, 2);
});

test("sonda real: el camino completo contra un opencode simulado vuelca NV redactado, sin claves, y termina limpio", { timeout: 60_000 }, async () => {
  const { mkdtempSync, readdirSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const out = mkdtempSync(join(tmpdir(), "ab-probe-"));
  const secret = "sk-FAKEPROBESECRET1234567890abcdef";
  try {
    const r = run(
      ["--i-understand-this-uses-quota", "--provider", "fake", "--model", "m", "--fake-bin", join(import.meta.dirname, "fake-opencode.ts"), "--out-dir", out],
      { AGENT_BENCH_CONFIRM_REAL: "yes", OPENCODE_AUTH_CONTENT: JSON.stringify({ fake: { type: "api", key: secret } }), HOME: process.env["HOME"] ?? "" },
    );
    assert.equal(r.status, 0, r.stderr);
    const stamp = readdirSync(out);
    assert.equal(stamp.length, 1);
    const text = readFileSync(join(out, stamp[0]!, "probe.json"), "utf8");
    assert.ok(!text.includes(secret), "sin la clave");
    const j = JSON.parse(text);
    for (const k of ["NV1_eventos_sse", "NV2_step_finish", "NV3_retry", "NV4_sqlite", "NV5_diff", "NV6_tools", "NV8_cost"]) assert.ok(j[k] !== undefined, k);
    assert.ok(j.NV1_eventos_sse.counts["session.status"] >= 1);
    assert.ok(Object.keys(j.NV4_sqlite.tables).includes("part"));
    assert.ok(j.NV6_tools.names.includes("read"));
  } finally { rmSync(out, { recursive: true, force: true }); }
});
