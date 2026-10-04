import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { runContractSuite, checkNoSecrets, checkNoTouchOutside, checkUndeclaredNull } from "../../src/runners/base/contract.ts";
import { killMatching, procsMatching } from "../../src/runners/base/util.ts";
import type { AgentRunner, CollectResult, Prepared, RawRun, RunnerContext, RunnerConfiguration, ContractScenario } from "../../src/runners/base/types.ts";
import { FakeRunner, makeFakeForContract } from "../../src/runners/fake/runner.ts";
import { FakeScriptSchema } from "../../src/runners/fake/script.ts";

runContractSuite((s) => makeFakeForContract(s), "FakeRunner cumple el contrato");

function sandbox(): RunnerContext & { cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), "agent-bench-fake-"));
  const [ws, home, tmp, out] = ["ws", "home", "tmp", "out"].map((d) => { const p = join(root, d); mkdirSync(p); return p; }) as [string, string, string, string];
  return { runId: "r", runRoot: root, ws, home, tmp, out, env: {}, secrets: [], cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const CFG: RunnerConfiguration = { name: "t", model: null };

describe("FakeRunner", () => {
  test("aplica el parche al workspace y reporta metricas", async () => {
    const ctx = sandbox();
    try {
      const r = makeFakeForContract({ behavior: "ok" });
      const p = await r.prepare(ctx, CFG);
      const raw = await r.run(p, { id: "t", prompt: "x" }, { timeoutMs: 20000 });
      const c = await r.collect(p, raw);
      await r.cleanup(p);
      assert.equal(c.outcome, "completed");
      assert.equal(readFileSync(join(ctx.ws, "src/fix.txt"), "utf8"), "arreglado\n");
      assert.equal(c.telemetry.metrics.toolCalls, 2);
      assert.equal(c.telemetry.metrics.llmCalls, 2);
      assert.equal(c.telemetry.metrics.filesModified, 1);
      assert.equal(c.telemetry.metrics.peakContext, null); // no declarado por defecto
    } finally { ctx.cleanup(); }
  });

  test("semilla distinta => tokens distintos; misma semilla => iguales", async () => {
    const tokens = async (seed: number): Promise<number | null> => {
      const ctx = sandbox();
      try {
        const r = new FakeRunner({ script: { seed, jitter: 0.5, usage: { input: 10000, output: 100 }, events: [{ type: "message" }] } });
        const p = await r.prepare(ctx, CFG);
        const c = await r.collect(p, await r.run(p, { id: "t", prompt: "" }, { timeoutMs: 20000 }));
        await r.cleanup(p);
        return c.telemetry.metrics.tokensInput;
      } finally { ctx.cleanup(); }
    };
    assert.equal(await tokens(1), await tokens(1));
    assert.notEqual(await tokens(1), await tokens(2));
  });

  test("crash => agent_error; capacidad recortada => null aunque haya dato", async () => {
    const ctx = sandbox();
    try {
      const r = new FakeRunner({ script: { usage: { input: 5, output: 5, cached: 3 }, events: [{ type: "message" }] }, capabilities: { tokensCached: false } });
      const p = await r.prepare(ctx, CFG);
      const c = await r.collect(p, await r.run(p, { id: "t", prompt: "" }, { timeoutMs: 20000 }));
      await r.cleanup(p);
      assert.equal(c.telemetry.metrics.tokensCached, null);
      assert.equal(c.telemetry.metrics.tokensInput, 5);
    } finally { ctx.cleanup(); }
    const ctx2 = sandbox();
    try {
      const r = makeFakeForContract({ behavior: "crash" });
      const p = await r.prepare(ctx2, CFG);
      const c = await r.collect(p, await r.run(p, { id: "t", prompt: "" }, { timeoutMs: 20000 }));
      await r.cleanup(p);
      assert.equal(c.outcome, "agent_error");
      assert.equal(c.telemetry.metrics.tokensInput, null); // nunca llegó a emitir uso
    } finally { ctx2.cleanup(); }
  });

  test("hijo huerfano deliberado: cleanup lo encuentra y deja 0 supervivientes", async () => {
    const ctx = sandbox();
    try {
      const r = makeFakeForContract({ behavior: "orphan" });
      const p = await r.prepare(ctx, CFG);
      const raw = await r.run(p, { id: "t", prompt: "" }, { timeoutMs: 20000 });
      const c = await r.collect(p, raw);
      const cl = await r.cleanup(p);
      assert.equal(c.outcome, "completed");
      assert.equal(cl.orphans, 0);
      assert.deepEqual(procsMatching(ctx.runRoot), []);
    } finally { await killMatching(ctx.runRoot); ctx.cleanup(); }
  });

  test("el guion rechaza rutas fuera del workspace", () => {
    assert.throws(() => FakeScriptSchema.parse({ patch: { write: { "../x": "a" } } }));
    assert.throws(() => FakeScriptSchema.parse({ patch: { write: { "/etc/x": "a" } } }));
  });
});

// La suite debe detectar runners que violan el contrato.
function wrap(base: (s: ContractScenario) => AgentRunner, over: Partial<AgentRunner>): (s: ContractScenario) => AgentRunner {
  return (s) => {
    const inner = base(s);
    return {
      id: inner.id,
      probe: () => inner.probe(),
      prepare: (c, g) => inner.prepare(c, g),
      run: (p, t, l, sg) => inner.run(p, t, l, sg),
      collect: (p, r) => inner.collect(p, r),
      cleanup: (p) => inner.cleanup(p),
      ...over,
    };
  };
}

describe("la suite detecta violaciones", () => {
  test("escritura fuera de ws", async () => {
    const bad = wrap((s) => makeFakeForContract(s), {});
    const mk = (s: ContractScenario): AgentRunner => {
      const r = bad(s);
      const run = r.run.bind(r);
      r.run = async (p: Prepared, t, l, sg): Promise<RawRun> => {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(join(p.ctx.runRoot, "outside", "intruso.txt"), "x");
        return run(p, t, l, sg);
      };
      return r;
    };
    await assert.rejects(checkNoTouchOutside(mk));
  });

  test("secreto filtrado a artefactos", async () => {
    const mk = wrap((s) => makeFakeForContract(s), {});
    const leaky = (s: ContractScenario): AgentRunner => {
      const r = mk(s);
      const collect = r.collect.bind(r);
      r.collect = async (p: Prepared, raw: RawRun): Promise<CollectResult> => {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(join(p.ctx.out, "raw.txt"), raw.stdout); // sin redactar
        return collect(p, raw);
      };
      return r;
    };
    await assert.rejects(checkNoSecrets(leaky));
  });

  test("métrica no declarada con 0 en vez de null", async () => {
    const mk = wrap((s) => makeFakeForContract(s), {});
    const zero = (s: ContractScenario): AgentRunner => {
      const r = mk(s);
      const collect = r.collect.bind(r);
      r.collect = async (p: Prepared, raw: RawRun): Promise<CollectResult> => {
        const c = await collect(p, raw);
        c.telemetry.metrics.peakContext = 0;
        return c;
      };
      return r;
    };
    await assert.rejects(checkUndeclaredNull(zero));
  });
});
