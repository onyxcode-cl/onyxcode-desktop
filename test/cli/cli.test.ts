import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, UsageError } from "../../src/cli/args.ts";
import { main } from "../../src/cli/main.ts";
import { EXIT, type Ctx } from "../../src/cli/ctx.ts";
import { supervise } from "../../src/core/proc.ts";

const T = { help: { kind: "boolean" }, n: { kind: "int", min: 1, max: 3, alias: "n" }, name: { kind: "string" }, x: { kind: "number" } } as const;

test("parser: casos válidos", () => {
  const r = parseArgs(["a", "--name", "z", "--x=1.5", "--help", "--", "--raro"], T as never);
  assert.deepEqual(r.positionals, ["a", "--raro"]);
  assert.equal(r.options["name"], "z");
  assert.equal(r.options["x"], 1.5);
  assert.equal(r.options["help"], true);
  assert.equal(parseArgs(["-n", "2"], T as never).options["n"], 2);
});

test("parser: errores en español", () => {
  const bad = (a: string[], re: RegExp) => assert.throws(() => parseArgs(a, T as never), (e: unknown) => e instanceof UsageError && re.test(e.message));
  bad(["--nada"], /desconocida/);
  bad(["--n", "9"], /<= 3/);
  bad(["--n", "1.5"], /entero/);
  bad(["--x", "abc"], /número/);
  bad(["--name"], /requiere un valor/);
  bad(["--n", "1", "--n", "2"], /repetida/);
  bad(["-q"], /desconocida/);
});

// ---- entorno de prueba ----
function fixture(opts: { runner?: string; withEngine?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ab-cli-test-"));
  mkdirSync(join(root, "configurations", "x"), { recursive: true });
  mkdirSync(join(root, "experiments"), { recursive: true });
  mkdirSync(join(root, "benchmarks", "node", "c1"), { recursive: true });
  writeFileSync(join(root, "benchmarks", "node", "c1", "case.json"), JSON.stringify({ id: "c1", category: "atomic", difficulty: "L1" }));
  for (const id of ["a", "b"]) {
    writeFileSync(join(root, "configurations", "x", `${id}.json`), JSON.stringify({ schemaVersion: "1", id, name: id, runner: id === "b" && opts.runner ? opts.runner : "fake" }));
  }
  writeFileSync(join(root, "experiments", "e1.json"), JSON.stringify({ id: "e1", scenarios: ["c1"], configurations: ["a", "b"], repetitions: 3, budget: { maxCost: 1 } }));
  if (opts.withEngine) {
    mkdirSync(join(root, "src", "engine"), { recursive: true });
    writeFileSync(
      join(root, "src", "engine", "index.ts"),
      `export function planExperiment(r: any) { return { runs: [{ scenarioId: "c1", configurationId: "a", repetition: 0, order: 0 }], seed: r.experiment.seed, design: "interleaved" }; }
export async function runExperiment(r: any) { return { experimentId: r.experiment.id, runsPlanned: 1, runsFinished: 1, runsSucceeded: 1, costUsd: null, stoppedBy: "done", orphans: 0, concurrency: r.concurrency, maxCost: r.maxCost }; }\n`,
    );
  }
  const out: string[] = [];
  const err: string[] = [];
  const ac = new AbortController();
  const ctx: Ctx = {
    root,
    home: root,
    env: { PATH: process.env["PATH"] },
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
    isTTY: false,
    confirm: async () => true,
    signal: ac.signal,
  };
  return { root, ctx, out, err, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("run sin --max-cost se rechaza (3) y no ejecuta nada", async () => {
  const f = fixture({ withEngine: true });
  try {
    const code = await main(["run", "e1"], f.ctx);
    assert.equal(code, EXIT.RECHAZADO);
    assert.match(f.err.join(""), /--max-cost/);
    assert.equal(existsSync(join(f.root, "results")), false);
  } finally { f.done(); }
});

test("run --dry-run con fake: ok, cuenta runs y no llama al motor", async () => {
  const f = fixture();
  try {
    const code = await main(["run", "e1", "--max-cost", "0", "--dry-run", "--max-runs", "4", "--json"], f.ctx);
    assert.equal(code, 0);
    const j = JSON.parse(f.out.join(""));
    assert.equal(j.dryRun, true);
    assert.equal(j.totalRuns, 6);
    assert.equal(j.effectiveRuns, 4);
    assert.equal(j.budget.maxCost, 0);
  } finally { f.done(); }
});

test("run con runner real exige --allow-real-runner y AGENT_BENCH_CONFIRM_REAL=yes", async () => {
  const f = fixture({ runner: "opencode", withEngine: true });
  try {
    assert.equal(await main(["run", "e1", "--max-cost", "1", "--dry-run"], f.ctx), EXIT.RECHAZADO);
    assert.match(f.err.join(""), /allow-real-runner/);
    f.err.length = 0;
    assert.equal(await main(["run", "e1", "--max-cost", "1", "--allow-real-runner", "--dry-run"], f.ctx), EXIT.RECHAZADO);
    assert.match(f.err.join(""), /AGENT_BENCH_CONFIRM_REAL/);
    f.ctx.env["AGENT_BENCH_CONFIRM_REAL"] = "yes";
    assert.equal(await main(["run", "e1", "--max-cost", "1", "--allow-real-runner", "--dry-run"], f.ctx), 0);
  } finally { f.done(); }
});

test("max-concurrency por encima de 2 se rechaza", async () => {
  const f = fixture();
  try {
    assert.equal(await main(["run", "e1", "--max-cost", "0", "--max-concurrency", "3", "--dry-run"], f.ctx), EXIT.RECHAZADO);
    assert.match(f.err.join(""), /tope duro de 2/);
    assert.equal(await main(["run", "e1", "--max-cost", "0", "--max-concurrency", "2", "--dry-run"], f.ctx), 0);
  } finally { f.done(); }
});

test("run: experimento, config o caso inexistente => 4; opción desconocida => 2", async () => {
  const f = fixture();
  try {
    assert.equal(await main(["run", "nope", "--max-cost", "0", "--dry-run"], f.ctx), EXIT.DATOS);
    assert.equal(await main(["run", "e1", "--max-cost", "0", "--bogus"], f.ctx), EXIT.USO);
    assert.equal(await main(["frobnicar"], f.ctx), EXIT.USO);
    assert.equal(await main(["run", "--max-cost", "0"], f.ctx), EXIT.USO);
  } finally { f.done(); }
});

test("run y plan sin motor: código 5 y nada ejecutado; con motor simulado se cablea", async () => {
  const f = fixture();
  try {
    assert.equal(await main(["run", "e1", "--max-cost", "0"], f.ctx), EXIT.NO_DISPONIBLE);
    assert.equal(await main(["plan", "e1"], f.ctx), EXIT.NO_DISPONIBLE);
  } finally { f.done(); }
  const g = fixture({ withEngine: true });
  try {
    assert.equal(await main(["plan", "e1", "--json"], g.ctx), 0);
    assert.equal(JSON.parse(g.out.join("")).plan.runs.length, 1);
    g.out.length = 0;
    assert.equal(await main(["run", "e1", "--max-cost", "2.5", "--max-concurrency", "2", "--json"], g.ctx), 0);
    const j = JSON.parse(g.out.join(""));
    assert.equal(j.summary.concurrency, 2);
    assert.equal(j.summary.maxCost, 2.5);
  } finally { g.done(); }
});

test("clean: dry-run no borra; sin --yes y sin TTY se niega; --yes borra solo ~/ab/r y validate, omite recientes", async () => {
  const f = fixture();
  try {
    const old = join(f.root, "ab", "r", "abcd1234");
    const fresh = join(f.root, "ab", "r", "fresh999");
    const val = join(f.root, "ab", "validate", "123");
    const other = join(f.root, "ab", "otro");
    for (const d of [old, fresh, val, other]) mkdirSync(d, { recursive: true });
    const past = new Date(Date.now() - 3600_000);
    for (const d of [old, val]) utimesSync(d, past, past);
    assert.equal(await main(["clean", "--dry-run"], f.ctx), 0);
    assert.ok(existsSync(old));
    assert.equal(await main(["clean"], f.ctx), EXIT.USO);
    assert.ok(existsSync(old));
    assert.equal(await main(["clean", "--yes"], f.ctx), 0);
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(val), false);
    assert.ok(existsSync(fresh), "reciente se omite");
    assert.ok(existsSync(other), "fuera de r/validate no se toca");
  } finally { f.done(); }
});

test("power: devuelve potencia y respeta tope de simulaciones", async () => {
  const f = fixture();
  try {
    assert.equal(await main(["power", "--cases", "10", "--reps", "3", "--delta", "0.3", "--sims", "100", "--json"], f.ctx), 0);
    const j = JSON.parse(f.out.join(""));
    assert.equal(j.mode, "power");
    assert.ok(j.sims <= 100 && j.power >= 0 && j.power <= 1);
    assert.equal(await main(["power", "--cases", "10"], f.ctx), EXIT.USO);
  } finally { f.done(); }
});

test("list y doctor --json", async () => {
  const f = fixture();
  try {
    assert.equal(await main(["list", "--json"], f.ctx), 0);
    const j = JSON.parse(f.out.join(""));
    assert.equal(j.scenarios.length, 1);
    assert.equal(j.configurations.length, 2);
    f.out.length = 0;
    const c = await main(["doctor", "--json"], f.ctx);
    assert.ok(c === 0 || c === 1);
    assert.ok(Array.isArray(JSON.parse(f.out.join("")).checks));
  } finally { f.done(); }
});

test("bin/agent-bench: ayuda y código de uso, sin huérfanos", async () => {
  const bin = join(import.meta.dirname, "..", "..", "bin", "agent-bench");
  const env = { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" };
  const h = await supervise({ cmd: process.execPath, args: [bin, "--help"], env, timeoutMs: 20000 });
  assert.equal(h.exitCode, 0);
  assert.match(h.stdout, /validate-cases/);
  const r = await supervise({ cmd: process.execPath, args: [bin, "run", "x"], env, timeoutMs: 20000 });
  assert.equal(r.exitCode, EXIT.RECHAZADO);
  assert.deepEqual(h.orphans.concat(r.orphans), []);
});
