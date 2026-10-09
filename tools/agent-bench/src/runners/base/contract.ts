// Suite de contrato reutilizable para cualquier AgentRunner (7 puntos del plan).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { sleep } from "../../core/proc.ts";
import { footprint, grepTree, killMatching, procsMatching } from "./util.ts";
import { METRIC_NAMES } from "./types.ts";
import type { AgentRunner, CollectResult, ContractScenario, MakeRunner, Prepared, RawRun, RunLimits, RunnerConfiguration, RunnerContext } from "./types.ts";

const CFG: RunnerConfiguration = { name: "contract", model: "contract-model" };
const TASK = { id: "contract-task", prompt: "arregla el bug" };
const LIMITS: RunLimits = { timeoutMs: 30_000, inactivityMs: 20_000, graceMs: 800 };
const SECRET = "sk-contract-SECRET-0123456789abcdefXYZ";

interface Sandbox {
  root: string;
  outside: string;
  ctx: RunnerContext;
}

function makeSandbox(env: Record<string, string> = {}, secrets: string[] = []): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "agent-bench-contract-"));
  const dirs = ["ws", "home", "tmp", "out", "outside"].map((d) => join(root, d));
  for (const d of dirs) mkdirSync(d);
  writeFileSync(join(root, "ws", "README.md"), "# fixture\n");
  writeFileSync(join(root, "outside", "sentinel.txt"), "no tocar\n");
  const [ws, home, tmp, out] = dirs as [string, string, string, string];
  return { root, outside: join(root, "outside"), ctx: { runId: randomUUID(), runRoot: root, ws, home, tmp, out, env, secrets } };
}

interface Executed {
  runner: AgentRunner;
  prepared: Prepared;
  raw: RawRun;
  collected: CollectResult;
  elapsedMs: number;
}

async function withRunner<T>(make: MakeRunner, scenario: ContractScenario, sb: Sandbox, body: (runner: AgentRunner, prepared: Prepared) => Promise<T>): Promise<T> {
  const runner = await make(scenario);
  const prepared = await runner.prepare(sb.ctx, CFG);
  try {
    return await body(runner, prepared);
  } finally {
    await runner.cleanup(prepared).catch(() => ({ orphans: -1 }));
    await killMatching(sb.root); // red de seguridad del propio test
  }
}

async function execute(make: MakeRunner, scenario: ContractScenario, sb: Sandbox, limits: RunLimits = LIMITS): Promise<Executed & { orphans: number }> {
  const runner = await make(scenario);
  const prepared = await runner.prepare(sb.ctx, CFG);
  try {
    const t0 = Date.now();
    const raw = await runner.run(prepared, TASK, limits);
    const elapsedMs = Date.now() - t0;
    const collected = await runner.collect(prepared, raw);
    const { orphans } = await runner.cleanup(prepared);
    return { runner, prepared, raw, collected, elapsedMs, orphans };
  } finally {
    await killMatching(sb.root);
  }
}

function disposeSandbox(sb: Sandbox): void {
  rmSync(sb.root, { recursive: true, force: true });
}

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(100);
  }
  return cond();
}

// 1. No toca fuera de ws/HOME con huella.
export async function checkNoTouchOutside(make: MakeRunner): Promise<void> {
  const sb = makeSandbox();
  const realMarker = join(homedir(), ".fake-agent-state");
  const markerBefore = existsSync(realMarker);
  const before = footprint(sb.outside);
  try {
    await execute(make, { behavior: "ok" }, sb);
    assert.deepEqual(footprint(sb.outside), before, "el runner modificó archivos fuera de ws/home/tmp/out");
    const names = readdirSync(sb.root).sort();
    assert.deepEqual(names, ["home", "out", "outside", "tmp", "ws"], `entradas inesperadas en runRoot: ${names.join(",")}`);
    assert.equal(existsSync(realMarker), markerBefore, "el runner escribió en el HOME real");
  } finally {
    disposeSandbox(sb);
  }
}

// 2. Cancelación < 10 s con cero huérfanos.
export async function checkCancel(make: MakeRunner): Promise<void> {
  const sb = makeSandbox();
  try {
    await withRunner(make, { behavior: "slow" }, sb, async (runner, prepared) => {
      const ac = new AbortController();
      const p = runner.run(prepared, TASK, { timeoutMs: 60_000, graceMs: 1000 }, ac.signal);
      assert.ok(await waitFor(() => procsMatching(sb.root).length >= 1, 8000), "el agente no llegó a arrancar procesos");
      const t0 = Date.now();
      ac.abort();
      const raw = await p;
      const dt = Date.now() - t0;
      assert.ok(dt < 10_000, `cancelar tardó ${dt} ms (>=10 s)`);
      const c = await runner.collect(prepared, raw);
      assert.equal(c.outcome, "cancelled");
      const { orphans } = await runner.cleanup(prepared);
      assert.equal(orphans, 0, "cleanup reporta huérfanos");
      assert.deepEqual(procsMatching(sb.root), [], "quedan procesos del run tras cancelar");
    });
  } finally {
    disposeSandbox(sb);
  }
}

// 3. Hang detectado por watchdog.
export async function checkHang(make: MakeRunner): Promise<void> {
  const sb = makeSandbox();
  try {
    const r = await execute(make, { behavior: "hang" }, sb, { timeoutMs: 60_000, inactivityMs: 1500, graceMs: 500 });
    assert.equal(r.collected.outcome, "hung");
    assert.ok(r.elapsedMs < 20_000, `watchdog tardó ${r.elapsedMs} ms`);
    assert.equal(r.orphans, 0);
    assert.deepEqual(procsMatching(sb.root), [], "quedan procesos tras hang");
  } finally {
    disposeSandbox(sb);
  }
}

// 4. Sin secretos en artefactos (grep del valor exacto).
export async function checkNoSecrets(make: MakeRunner): Promise<void> {
  const sb = makeSandbox({ AB_FAKE_SECRET: SECRET }, [SECRET]);
  try {
    const r = await execute(make, { behavior: "leak_secret", secret: SECRET }, sb);
    const hits = [...grepTree(sb.ctx.out, SECRET), ...r.collected.artifacts.filter((a) => existsSync(a)).flatMap((a) => grepTree(a, SECRET))];
    assert.deepEqual([...new Set(hits)], [], "el valor exacto del secreto aparece en artefactos");
    assert.ok(!JSON.stringify(r.collected.telemetry).includes(SECRET), "secreto en telemetría");
  } finally {
    disposeSandbox(sb);
  }
}

// 5. Métricas no declaradas = null (nunca 0).
export async function checkUndeclaredNull(make: MakeRunner): Promise<void> {
  const sb = makeSandbox();
  try {
    const r = await execute(make, { behavior: "ok" }, sb);
    const { capabilities } = await r.runner.probe();
    for (const m of METRIC_NAMES) {
      const v = r.collected.telemetry.metrics[m];
      assert.ok(v === null || typeof v === "number", `métrica ${m} inválida`);
      if (!capabilities[m]) assert.equal(v, null, `métrica no declarada ${m} debe ser null, fue ${String(v)}`);
    }
    assert.equal(r.collected.telemetry.schemaVersion, "1");
  } finally {
    disposeSandbox(sb);
  }
}

// 6. Mismo guion => telemetría normalizada idéntica.
export async function checkDeterminism(make: MakeRunner): Promise<void> {
  const a = makeSandbox();
  const b = makeSandbox();
  try {
    const ra = await execute(make, { behavior: "ok" }, a);
    const rb = await execute(make, { behavior: "ok" }, b);
    assert.equal(ra.collected.outcome, rb.collected.outcome);
    assert.equal(JSON.stringify(ra.collected.telemetry), JSON.stringify(rb.collected.telemetry), "telemetría distinta para el mismo guion");
  } finally {
    disposeSandbox(a);
    disposeSandbox(b);
  }
}

// 7. rate_limit => outcome rate_limited.
export async function checkRateLimit(make: MakeRunner): Promise<void> {
  const sb = makeSandbox();
  try {
    const r = await execute(make, { behavior: "rate_limit" }, sb);
    assert.equal(r.collected.outcome, "rate_limited");
    assert.equal(r.orphans, 0);
  } finally {
    disposeSandbox(sb);
  }
}

/** Registra los 7 puntos del contrato como tests de node:test. */
export function runContractSuite(makeRunner: MakeRunner, name = "contrato de runner"): void {
  describe(name, () => {
    const o = { timeout: 90_000 };
    test("1. no toca fuera de ws/HOME (huella)", o, () => checkNoTouchOutside(makeRunner));
    test("2. cancelación < 10 s sin huérfanos", o, () => checkCancel(makeRunner));
    test("3. hang detectado por watchdog", o, () => checkHang(makeRunner));
    test("4. sin secretos en artefactos", o, () => checkNoSecrets(makeRunner));
    test("5. métricas no declaradas = null", o, () => checkUndeclaredNull(makeRunner));
    test("6. mismo guion => telemetría idéntica", o, () => checkDeterminism(makeRunner));
    test("7. rate_limit => rate_limited", o, () => checkRateLimit(makeRunner));
  });
}
