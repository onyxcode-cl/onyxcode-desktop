import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createWorkspace, createEvalCopy, TreeDeadSignal } from "../../src/workspace/index.ts";
import { testsVisible, testsHidden, buildCheck, gitDiff, restrictions, antiCheat, parseTestOutput, globToRegExp } from "../../src/evaluators/index.ts";
import { cleanup, makeFixture, put, tmp } from "../helpers.ts";

async function setup(root: string) {
  const { repo, commit } = makeFixture(root);
  return createWorkspace({ fixtureRepo: repo, commit, dir: join(root, "ws") });
}
const FIX = "export function add(a, b) { return a + b; }\n";

test("glob y parser TAP", () => {
  assert.ok(globToRegExp("src/**/*.{js,ts}").test("src/a/b/c.ts"));
  assert.ok(globToRegExp("**/*.test.*").test("x.test.js"));
  assert.ok(!globToRegExp("src/*.js").test("src/a/b.js"));
  const s = parseTestOutput("TAP version 13\nnot ok 1 - falla uno\n# tests 3\n# pass 2\n# fail 1\n# cancelled 0\n# skipped 0\n");
  assert.deepEqual([s?.total, s?.pass, s?.fail, s?.failedNames[0]], [3, 2, 1, "falla uno"]);
  assert.equal(parseTestOutput('{"total":2,"pass":2,"fail":0}')?.pass, 2);
  assert.equal(parseTestOutput("basura"), null);
});

test("tests-visible: falla en base, pasa tras el arreglo", async () => {
  const root = tmp();
  try {
    const ws = await setup(root);
    const ev = testsVisible({ timeoutMs: 30_000 });
    const before = await ev.evaluate({ workspaceDir: ws.dir });
    assert.equal(before.pass, false);
    assert.equal(before.score, 0);
    writeFileSync(join(ws.dir, "src/add.js"), FIX);
    const after = await ev.evaluate({ workspaceDir: ws.dir });
    assert.equal(after.pass, true);
    assert.equal(after.score, 1);
  } finally { cleanup(root); }
});

test("tests-hidden: no aplica sin ocultos; corre en la copia de evaluación", async () => {
  const root = tmp();
  try {
    const ws = await setup(root);
    writeFileSync(join(ws.dir, "src/add.js"), "export function add(a, b) { return a === 2 ? 5 : 0; }\n");
    const ev = testsHidden({ timeoutMs: 30_000 });
    const na = await ev.evaluate({ workspaceDir: ws.dir });
    assert.deepEqual([na.applicable, na.pass, na.score], [false, null, null]);
    put(join(root, "hidden"), { "test/hidden.test.js": "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.js';\ntest('oculto', () => { assert.equal(add(10, 20), 30); });\n" });
    const sig = new TreeDeadSignal(); sig.markDead();
    const c = await createEvalCopy({ workspaceDir: ws.dir, evalDir: join(root, "eval"), hiddenDir: join(root, "hidden"), treeDead: sig });
    const bad = await ev.evaluate({ workspaceDir: ws.dir, evalDir: c.evalDir, hiddenFiles: c.hiddenFiles });
    assert.equal(bad.pass, false);
    writeFileSync(join(c.evalDir, "src/add.js"), FIX);
    const good = await ev.evaluate({ workspaceDir: ws.dir, evalDir: c.evalDir, hiddenFiles: c.hiddenFiles });
    assert.equal(good.pass, true);
  } finally { cleanup(root); }
});

test("límite de tiempo: test colgado se corta", async () => {
  const root = tmp();
  try {
    const ws = await setup(root);
    put(ws.dir, { "test/hang.test.js": "import test from 'node:test';\ntest('cuelga', async () => { await new Promise(() => {}); setInterval(() => {}, 1000); });\nsetInterval(() => {}, 1000);\n" });
    const r = await testsVisible({ timeoutMs: 1500 }).evaluate({ workspaceDir: ws.dir });
    assert.equal(r.pass, false);
    assert.equal((r.details as { timedOut: boolean }).timedOut, true);
    assert.ok((r.durationMs ?? 0) < 10_000);
  } finally { cleanup(root); }
});

test("build/typecheck: comando configurable", async () => {
  const root = tmp();
  try {
    const ws = await setup(root);
    assert.equal((await buildCheck({}).evaluate({ workspaceDir: ws.dir })).applicable, false);
    const ok = await buildCheck({ command: [process.execPath, "-e", "process.exit(0)"] }).evaluate({ workspaceDir: ws.dir });
    const ko = await buildCheck({ command: [process.execPath, "-e", "console.error('x');process.exit(2)"] }).evaluate({ workspaceDir: ws.dir });
    const slow = await buildCheck({ command: [process.execPath, "-e", "setTimeout(()=>{},60000)"], timeoutMs: 500 }).evaluate({ workspaceDir: ws.dir });
    assert.deepEqual([ok.pass, ko.pass, slow.pass], [true, false, false]);
  } finally { cleanup(root); }
});

test("git_diff y restrictions", async () => {
  const root = tmp();
  try {
    const ws = await setup(root);
    assert.equal((await gitDiff().evaluate({ workspaceDir: ws.dir })).pass, false);
    writeFileSync(join(ws.dir, "src/add.js"), FIX);
    put(ws.dir, { "package.json": '{"type":"module","x":1}\n' });
    const g = await gitDiff().evaluate({ workspaceDir: ws.dir });
    assert.equal(g.pass, true);
    assert.deepEqual((g.details as { modified: string[] }).modified, ["package.json", "src/add.js"]);
    const r1 = await restrictions({ allowed: ["src/**"] }).evaluate({ workspaceDir: ws.dir });
    assert.equal(r1.pass, false);
    assert.equal(r1.score, 0.5);
    const r2 = await restrictions({ forbidden: ["package.json"] }).evaluate({ workspaceDir: ws.dir });
    assert.deepEqual((r2.details as { violations: unknown[] }).violations, [{ file: "package.json", rule: "forbidden" }]);
    assert.equal((await restrictions({ allowed: ["src/**", "package.json"] }).evaluate({ workspaceDir: ws.dir })).pass, true);
  } finally { cleanup(root); }
});

test("anti-cheat: parche limpio pasa; tests tocados, borrados y hardcodeo fallan", async () => {
  const root = tmp();
  try {
    const ws = await setup(root);
    writeFileSync(join(ws.dir, "src/add.js"), FIX);
    assert.equal((await antiCheat().evaluate({ workspaceDir: ws.dir })).pass, true);

    writeFileSync(join(ws.dir, "src/add.js"), "export function add(a, b) { if (a === 2 && b === 3) return 5; return 0; }\n");
    const h = await antiCheat().evaluate({ workspaceDir: ws.dir });
    assert.equal(h.pass, false);
    assert.ok((h.details as { findings: Array<{ kind: string }> }).findings.some((f) => f.kind === "hardcode_if_return"));

    writeFileSync(join(ws.dir, "src/add.js"), FIX);
    writeFileSync(join(ws.dir, "test/add.test.js"), "import test from 'node:test';\ntest.skip('add', () => {});\n");
    const m = await antiCheat().evaluate({ workspaceDir: ws.dir });
    const kinds = (m.details as { findings: Array<{ kind: string }> }).findings.map((f) => f.kind);
    assert.ok(kinds.includes("test_modified") && kinds.includes("test_skip_added"));

    rmSync(join(ws.dir, "test/add.test.js"));
    const d = await antiCheat().evaluate({ workspaceDir: ws.dir });
    assert.ok((d.details as { findings: Array<{ kind: string }> }).findings.some((f) => f.kind === "test_deleted"));
    assert.equal(d.pass, false);
  } finally { cleanup(root); }
});
