import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import {
  applyOverrides, checkExperimentRefs, ConfigError, loadConfiguration, loadConfigurations, loadExperiment, loadScenarios, parseConfigText,
  validateConfigurationFile,
} from "../../src/engine/config.ts";
import { parseYamlLite, YamlLiteError } from "../../src/engine/yaml-lite.ts";
import { BENCH_ROOT, cfg, CASES, experiment, rmDir, tmpDir } from "./helpers.ts";

const dirs: string[] = [];
const mk = (): string => { const d = tmpDir("ab-cfg-"); dirs.push(d); return d; };
after(() => rmDir(...dirs));

describe("yaml-lite", () => {
  test("mapas, listas, anidación y escalares", () => {
    const v = parseYamlLite(`
# comentario
id: cfg-a   # al final
name: "Con: dos puntos"
n: 3
f: 0.5
ok: true
nada: ~
lista: [a, 2, "x,y"]
mapa: {k: 1, j: dos}
skills:
  - name: skill-a
    version: v1
    path: null
  - name: skill-b
    version: "2"
tags:
- uno
- dos
settings:
  reasoning: high
  nested:
    deep: [1, 2]
texto: |
  línea 1
  # no es comentario
  línea 3
`) as Record<string, unknown>;
    assert.deepEqual(v, {
      id: "cfg-a", name: "Con: dos puntos", n: 3, f: 0.5, ok: true, nada: null, lista: ["a", 2, "x,y"], mapa: { k: 1, j: "dos" },
      skills: [{ name: "skill-a", version: "v1", path: null }, { name: "skill-b", version: "2" }], tags: ["uno", "dos"],
      settings: { reasoning: "high", nested: { deep: [1, 2] } }, texto: "línea 1\n# no es comentario\nlínea 3\n",
    });
  });
  test("errores con línea", () => {
    assert.throws(() => parseYamlLite("a: 1\na: 2\n"), (e: unknown) => e instanceof YamlLiteError && e.line === 2);
    assert.throws(() => parseYamlLite("a: [1, 2\n"), YamlLiteError);
    assert.throws(() => parseYamlLite("a: 1\n  b: 2\n"), YamlLiteError);
  });
  test("JSON también vale", () => { assert.deepEqual(parseConfigText('{"a":[1]}'), { a: [1] }); });
});

describe("configuraciones y experimentos", () => {
  test("Configuration YAML con skills versionados", () => {
    const d = mk();
    mkdirSync(join(d, "skills"));
    writeFileSync(join(d, "skills", "a.md"), "x");
    writeFileSync(join(d, "c.yaml"), `id: opencode-skill-a-v1
name: OpenCode + skill A v1
runner: opencode
provider: opencode-go
model: glm-5
skills:
  - {name: skill-a, version: v1, path: skills/a.md}
  - {name: skill-b, version: v2, path: skills/falta.md}
settings:
  reasoning: high
`);
    const c = loadConfiguration(join(d, "c.yaml"));
    assert.equal(c.schemaVersion, "1");
    assert.equal(c.skills[0]!.version, "v1");
    assert.deepEqual(c.subagents, []);
    const v = validateConfigurationFile(join(d, "c.yaml"));
    assert.equal(v.ok, true);
    assert.equal(v.warnings.length, 1);
    assert.match(v.warnings[0]!, /falta\.md/);
  });

  test("errores de validación legibles", () => {
    const d = mk();
    writeFileSync(join(d, "bad.json"), JSON.stringify({ id: "Mal Id", runner: 3 }));
    const v = validateConfigurationFile(join(d, "bad.json"));
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.startsWith("id:")));
    assert.ok(v.errors.some((e) => e.startsWith("runner:")));
    assert.throws(() => loadConfiguration(join(d, "no-existe.yaml")), ConfigError);
  });

  test("ids duplicados en un directorio", () => {
    const d = mk();
    writeFileSync(join(d, "a.json"), JSON.stringify({ id: "x", name: "x", runner: "fake" }));
    writeFileSync(join(d, "b.yaml"), "id: x\nname: x\nrunner: fake\n");
    assert.throws(() => loadConfigurations(d), /duplicado/);
  });

  test("Experiment: maxCost obligatorio, defaults y límites de concurrencia", () => {
    const d = mk();
    writeFileSync(join(d, "e.yaml"), "id: e1\nscenarios: [a]\nconfigurations: [b]\nbudget:\n  maxRuns: 3\n");
    assert.throws(() => loadExperiment(join(d, "e.yaml")), /maxCost/);
    writeFileSync(join(d, "e.yaml"), "id: e1\nscenarios: [a]\nconfigurations: [b]\nconcurrency: 3\nbudget: {maxCost: 5}\n");
    assert.throws(() => loadExperiment(join(d, "e.yaml")), /concurrency/);
    writeFileSync(join(d, "e.yaml"), "id: e1\nscenarios: [a]\nconfigurations: [b]\nbudget: {maxCost: 5}\n");
    const e = loadExperiment(join(d, "e.yaml"));
    assert.equal(e.repetitions, 5);
    assert.equal(e.concurrency, 1);
    assert.equal(e.design, "interleaved");
    assert.equal(e.limits.timeoutSec, 1200);
  });

  test("overrides del CLI y referencias cruzadas", () => {
    const e = applyOverrides(experiment(), { maxCost: 2, maxRuns: 4, maxWallSec: 600, concurrency: 2, timeoutSec: 99 });
    assert.deepEqual([e.budget.maxCost, e.budget.maxRuns, e.budget.maxWallSec, e.concurrency, e.limits.timeoutSec], [2, 4, 600, 2, 99]);
    assert.throws(() => applyOverrides(experiment(), { concurrency: 5 }));
    const sc = loadScenarios(BENCH_ROOT, [...CASES]);
    assert.deepEqual(checkExperimentRefs(experiment(), sc, [cfg("cfg-ref"), cfg("cfg-cheat")], ["fake"]), []);
    const errs = checkExperimentRefs(experiment({ scenarios: ["nada"] }), sc, [cfg("cfg-ref")], ["fake"]);
    assert.equal(errs.length, 2);
  });

  test("case.json de benchmarks/node se convierte a Scenario", () => {
    const [s] = loadScenarios(BENCH_ROOT, ["node-l1-002-leap-year"]);
    assert.equal(s!.fixture.path, "benchmarks/node/node-l1-002-leap-year/repo");
    assert.equal(s!.hiddenTests, "benchmarks/node/node-l1-002-leap-year/hidden");
    assert.equal(s!.metadata.hiddenInject, "test-hidden");
    assert.ok(s!.evaluators.some((e) => e.kind === "tests-hidden"));
    assert.ok(s!.constraints.forbiddenPaths.includes("test/**"));
    assert.throws(() => loadScenarios(BENCH_ROOT, ["no-existe"]), ConfigError);
    assert.ok(loadScenarios(BENCH_ROOT).length >= 10);
  });
});
