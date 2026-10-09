import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createWorkspace, captureDiff, createEvalCopy, TreeDeadSignal } from "../../src/workspace/index.ts";
import { cleanup, makeFixture, put, sh, tmp } from "../helpers.ts";

test("workspace: archive del commit base + git init fresco sin historia", async () => {
  const root = tmp();
  try {
    const { repo, commit } = makeFixture(root);
    const ws = await createWorkspace({ fixtureRepo: repo, commit, dir: join(root, "ws") });
    assert.equal(existsSync(join(ws.dir, "later.txt")), false);
    assert.equal(sh(ws.dir, "rev-list", "--count", "HEAD").trim(), "1");
    assert.equal(sh(ws.dir, "log", "--format=%s").trim(), "base");
    assert.equal(sh(ws.dir, "status", "--porcelain").trim(), "");
    await assert.rejects(createWorkspace({ fixtureRepo: repo, commit, dir: ws.dir }), /no está vacío/);
  } finally { cleanup(root); }
});

test("diff: creados, modificados y borrados", async () => {
  const root = tmp();
  try {
    const { repo, commit } = makeFixture(root);
    const ws = await createWorkspace({ fixtureRepo: repo, commit, dir: join(root, "ws") });
    writeFileSync(join(ws.dir, "src/add.js"), "export const add = (a, b) => a + b;\n");
    put(ws.dir, { "src/new.js": "x\n" });
    rmSync(join(ws.dir, "test/add.test.js"));
    const d = await captureDiff(ws.dir, ws.baseCommit);
    assert.deepEqual(d.created, ["src/new.js"]);
    assert.deepEqual(d.modified, ["src/add.js"]);
    assert.deepEqual(d.deleted, ["test/add.test.js"]);
    assert.match(d.patch, /a \+ b/);
  } finally { cleanup(root); }
});

test("eval copy: ocultos solo tras la señal de árbol muerto", async () => {
  const root = tmp();
  try {
    const { repo, commit } = makeFixture(root);
    const ws = await createWorkspace({ fixtureRepo: repo, commit, dir: join(root, "ws") });
    put(join(root, "hidden"), { "test/hidden.test.js": "// oculto\n" });
    const evalDir = join(root, "eval");
    const sig = new TreeDeadSignal();
    const p = createEvalCopy({ workspaceDir: ws.dir, evalDir, hiddenDir: join(root, "hidden"), treeDead: sig });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(existsSync(evalDir), false, "no debe copiarse nada antes de la señal");
    sig.markDead();
    const r = await p;
    assert.deepEqual(r.hiddenFiles, ["test/hidden.test.js"]);
    assert.equal(readFileSync(join(evalDir, "test/hidden.test.js"), "utf8"), "// oculto\n");
    assert.equal(existsSync(join(ws.dir, "test/hidden.test.js")), false);
  } finally { cleanup(root); }
});

test("eval copy: sin señal hay timeout y no se copian ocultos; ocultos dentro del ws se rechazan", async () => {
  const root = tmp();
  try {
    const { repo, commit } = makeFixture(root);
    const ws = await createWorkspace({ fixtureRepo: repo, commit, dir: join(root, "ws") });
    put(join(root, "hidden"), { "h.test.js": "x\n" });
    await assert.rejects(
      createEvalCopy({ workspaceDir: ws.dir, evalDir: join(root, "eval"), hiddenDir: join(root, "hidden"), treeDead: new TreeDeadSignal(), timeoutMs: 100 }),
      /timeout/);
    assert.equal(existsSync(join(root, "eval")), false);
    await assert.rejects(
      createEvalCopy({ workspaceDir: ws.dir, evalDir: join(root, "eval2"), hiddenDir: join(ws.dir, "test"), treeDead: (() => { const s = new TreeDeadSignal(); s.markDead(); return s; })() }),
      /dentro del workspace/);
  } finally { cleanup(root); }
});
