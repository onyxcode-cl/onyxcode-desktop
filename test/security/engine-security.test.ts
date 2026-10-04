import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { loadScenarios } from "../../src/engine/config.ts";
import { runExperiment } from "../../src/engine/engine.ts";
import type { RunExperimentOptions } from "../../src/engine/engine.ts";
import { sandboxAvailable } from "../../src/isolation/index.ts";
import { testsVisible } from "../../src/evaluators/index.ts";
import { openStore } from "../../src/store/index.ts";
import { BENCH_ROOT, cfg, experiment, rmDir, tmpDir } from "../engine/helpers.ts";
import { actRunner } from "./harness.ts";
import type { ActOptions } from "./harness.ts";

const CASE = "node-l1-002-leap-year";
const scenarios = loadScenarios(BENCH_ROOT, [CASE]);
const dirs: string[] = [];
after(() => rmDir(...dirs));

function setup() {
  const root = tmpDir();
  dirs.push(root);
  return { root, store: openStore(join(root, "results")), runBase: join(root, "r") };
}

function run(a: ActOptions, extra: Partial<RunExperimentOptions> = {}, cfgOver: Record<string, unknown> = {}) {
  const e = setup();
  const promise = runExperiment(experiment({ scenarios: [CASE], configurations: ["cfg-a"] }), {
    store: e.store, runBase: e.runBase, benchRoot: BENCH_ROOT, scenarios, handleSignals: false,
    configurations: [cfg("cfg-a", "fake", cfgOver)], runners: { fake: actRunner(a) }, ...extra,
  });
  return { ...e, promise };
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p)); else out.push(p);
  }
  return out;
}

describe("A2: el motor reenvía solo las credenciales declaradas", () => {
  test("recibe la declarada por el runner y por la configuración; no el resto del entorno", async () => {
    let seen: Record<string, string> = {};
    const r = run(
      { credentialEnv: ["FAKE_CRED"], onPrepare: (ctx) => { seen = { ...ctx.env }; } },
      { parentEnv: { FAKE_CRED: "valor-cred-123456", CFG_CRED: "valor-cfg-654321", UNRELATED_SECRET: "no-debe-llegar", AWS_SECRET_ACCESS_KEY: "tampoco", PATH: "/x" } },
      { settings: { credentialEnv: ["CFG_CRED"] } },
    );
    const sum = await r.promise;
    assert.equal(sum.results.length, 1);
    assert.equal(seen.FAKE_CRED, "valor-cred-123456");
    assert.equal(seen.CFG_CRED, "valor-cfg-654321");
    assert.equal(seen.UNRELATED_SECRET, undefined);
    assert.equal(seen.AWS_SECRET_ACCESS_KEY, undefined);
    assert.notEqual(seen.PATH, "/x");
  });

  test("sin declarar nada no se reenvía ninguna credencial", async () => {
    let seen: Record<string, string> = {};
    await run({ onPrepare: (ctx) => { seen = { ...ctx.env }; } }, { parentEnv: { FAKE_CRED: "valor-cred-123456" } }).promise;
    assert.equal(seen.FAKE_CRED, undefined);
  });
});

describe("A1: la credencial no llega a lo persistido", () => {
  test("campos del JSON de auth escritos por el agente en el workspace se redactan y detienen el experimento", async () => {
    const field = "zzTOKENfieldQ9876543210"; // sin forma de token conocida: solo la redacción exacta lo detecta
    const auth = JSON.stringify({ provider: { type: "api", key: field } });
    const r = run(
      { credentialEnv: ["FAKE_AUTH_CONTENT"], act: (ctx) => { writeFileSync(join(ctx.workspace, "leak.txt"), `clave: ${field}\n`); } },
      { parentEnv: { FAKE_AUTH_CONTENT: auth } },
    );
    const sum = await r.promise;
    const res = sum.results[0]!;
    assert.ok(res.error?.includes("secretos detectados"), String(res.error));
    assert.equal(sum.stopReason, "damage");
    assert.ok(!(res.gitDiff ?? "").includes(field), "el diff contiene la credencial");
    for (const f of filesUnder(r.store.root)) {
      if (f.endsWith(".sqlite")) continue;
      assert.ok(!readFileSync(f, "utf8").includes(field), `${f} contiene la credencial`);
    }
    r.store.close();
  });
});

describe("A3: el diff es contra el commit base aunque el agente haga git commit", () => {
  test("git init + commit del agente no vacía el parche ni los archivos modificados", async () => {
    const r = run({
      act: (ctx) => {
        appendFileSync(join(ctx.workspace, "src", "leap.ts"), "\n// edición del agente\n");
        const g = (...a: string[]) => execFileSync("git", a, { cwd: ctx.workspace, stdio: "ignore", env: { PATH: process.env.PATH ?? "", HOME: ctx.home, GIT_CONFIG_NOSYSTEM: "1" } });
        g("init", "-q", "-b", "main"); g("add", "-A"); g("-c", "user.name=a", "-c", "user.email=a@a", "commit", "-q", "-m", "mío");
      },
    });
    const res = (await r.promise).results[0]!;
    assert.match(res.gitDiff ?? "", /edición del agente/);
    assert.deepEqual(res.telemetry.filesModified, ["src/leap.ts"]);
    r.store.close();
  });
});

describe("A4: tests-visible corre con los tests originales", () => {
  test("el agente reemplaza el test visible por uno trivial: tests-visible sigue fallando", async () => {
    const r = run({
      act: (ctx) => {
        writeFileSync(join(ctx.workspace, "test", "leap.test.ts"), "import test from 'node:test';\ntest('trivial', () => {});\n");
      },
    });
    const res = (await r.promise).results[0]!;
    const tv = res.evaluators.find((e) => e.kind === "tests-visible");
    assert.ok(tv, "debe existir el evaluador tests-visible");
    assert.equal(tv!.passed, false, tv!.details.slice(0, 300));
    assert.equal(res.success, false);
    r.store.close();
  });
});

describe("A5: los evaluadores ejecutan el código del agente en Seatbelt con HOME/PATH limpios", { skip: !sandboxAvailable() }, () => {
  test("el código del agente no lee ~ ni hereda HOME/secretos; sin sandbox el mismo test falla", async () => {
    const root = mkdtempSync(join(tmpdir(), "ab-a5-"));
    dirs.push(root);
    const canary = join(homedir(), `.ab-canary-a5-${process.pid}`);
    writeFileSync(canary, "SECRETO");
    try {
      mkdirSync(join(root, "test"));
      writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
      writeFileSync(join(root, "test", "evil.test.js"), `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('aislado', () => {
  assert.throws(() => readFileSync(${JSON.stringify(canary)}, 'utf8'));
  assert.notEqual(process.env.HOME, ${JSON.stringify(homedir())});
  assert.equal(process.env.AB_PARENT_SECRET, undefined);
});
`);
      process.env.AB_PARENT_SECRET = "no-debe-verse";
      const ev = testsVisible({ timeoutMs: 30_000 });
      const sandboxed = await ev.evaluate({ workspaceDir: root, sandbox: true });
      assert.equal(sandboxed.pass, true, JSON.stringify(sandboxed.details).slice(0, 600));
      const plain = await ev.evaluate({ workspaceDir: root });
      assert.equal(plain.pass, false, "sin sandbox el código del agente sí ve el HOME real");
    } finally {
      delete process.env.AB_PARENT_SECRET;
      rmSync(canary, { force: true });
    }
  });
});

describe("A1: evaluador canary-secret", () => {
  test("falla si la credencial (o un campo de su JSON) aparece en el workspace; pasa si no; no aplica sin secretos", async () => {
    const { canarySecret } = await import("../../src/evaluators/canary-secret.ts");
    const root = mkdtempSync(join(tmpdir(), "ab-cs-"));
    dirs.push(root);
    const secret = "zzTOKENfieldQ9876543210";
    const diff = { created: [], modified: [], deleted: [], patch: "" };
    const ev = canarySecret();
    writeFileSync(join(root, "a.txt"), "nada\n");
    assert.equal((await ev.evaluate({ workspaceDir: root, diff, secrets: [secret] })).pass, true);
    assert.equal((await ev.evaluate({ workspaceDir: root, diff })).applicable, false);
    writeFileSync(join(root, "env.txt"), `HOME=x\nAUTH=${secret}\n`);
    const bad = await ev.evaluate({ workspaceDir: root, diff, secrets: [secret] });
    assert.equal(bad.pass, false);
    assert.ok(!JSON.stringify(bad).includes(secret), "el resultado no debe repetir el secreto");
    const viaDiff = await ev.evaluate({ workspaceDir: join(root, "no-existe-aun"), diff: { ...diff, patch: `+${secret}` }, secrets: [secret] }).catch(() => null);
    assert.ok(viaDiff === null || viaDiff.pass === false);
  });
});

describe("A6: la reanudación no mezcla versiones de configuración ni de caso", () => {
  test("misma versión: reutiliza; contenido de config distinto con el mismo id: repite y avisa; hashes en RunResult", async () => {
    const e = setup();
    const go = (over: Record<string, unknown>) => runExperiment(experiment({ scenarios: [CASE], configurations: ["cfg-a"] }), {
      store: e.store, runBase: e.runBase, benchRoot: BENCH_ROOT, scenarios, handleSignals: false,
      configurations: [cfg("cfg-a", "fake", over)], runners: { fake: actRunner({}) },
    });
    const first = await go({ settings: { prompt: "v1" } });
    assert.equal(first.results.length, 1);
    assert.match(first.results[0]!.configHash ?? "", /^[0-9a-f]{64}$/);
    assert.match(first.results[0]!.caseHash ?? "", /^[0-9a-f]{64}$/);
    const same = await go({ settings: { prompt: "v1" } });
    assert.equal(same.skipped, 1);
    assert.equal(same.results.length, 0);
    const changed = await go({ settings: { prompt: "v2" } });
    assert.equal(changed.skipped, 0, "no debe reutilizar el run hecho con el prompt viejo");
    assert.equal(changed.results.length, 1);
    assert.notEqual(changed.results[0]!.configHash, first.results[0]!.configHash);
    assert.ok(changed.warnings.some((w) => /otra versión/.test(w)), changed.warnings.join("|"));
    e.store.close();
  });
});
