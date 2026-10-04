import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDiff, createWorkspace } from "../../src/workspace/index.ts";
import { cleanup, makeFixture, tmp } from "../helpers.ts";

// C1: el agente controla el .git del workspace; el banco ejecuta git sin sandbox sobre él.

test("C1 (gitdir en el árbol): core.fsmonitor plantado en .git/config NO ejecuta nada", async () => {
  const root = tmp();
  try {
    const { repo, commit } = makeFixture(root);
    const ws = await createWorkspace({ fixtureRepo: repo, commit, dir: join(root, "ws") });
    const canary = join(root, "PWNED-fsmonitor");
    appendFileSync(join(ws.dir, ".git", "config"), `[core]\n\tfsmonitor = touch ${canary}; echo\n`);
    writeFileSync(join(ws.dir, "x.txt"), "x\n");
    await captureDiff(ws.dir, ws.baseCommit);
    assert.equal(existsSync(canary), false, "el banco ejecutó el comando de core.fsmonitor");
  } finally { cleanup(root); }
});

test("C1 (gitdir en el árbol): filtro clean + .gitattributes plantados no se ejecutan", async () => {
  const root = tmp();
  try {
    const { repo, commit } = makeFixture(root);
    const ws = await createWorkspace({ fixtureRepo: repo, commit, dir: join(root, "ws") });
    const canary = join(root, "PWNED-filter");
    appendFileSync(join(ws.dir, ".git", "config"), `[filter "x"]\n\tclean = touch ${canary}; cat\n`);
    writeFileSync(join(ws.dir, ".gitattributes"), "* filter=x\n");
    writeFileSync(join(ws.dir, "x.txt"), "x\n");
    await captureDiff(ws.dir, ws.baseCommit);
    assert.equal(existsSync(canary), false, "el banco ejecutó el filtro clean");
  } finally { cleanup(root); }
});

test("C1 (gitdir separado): config/hook/fsmonitor del .git que crea el agente son inertes y el diff sale igual", async () => {
  const root = tmp();
  try {
    const { repo, commit } = makeFixture(root);
    const gitDir = join(root, "ctl", "gitdir");
    const ws = await createWorkspace({ fixtureRepo: repo, commit, dir: join(root, "ws"), gitDir });
    assert.equal(existsSync(join(ws.dir, ".git")), false, "el workspace no debe tener .git");
    // el agente crea su propio .git con config hostil
    const canary = join(root, "PWNED-sep");
    mkdirSync(join(ws.dir, ".git", "hooks"), { recursive: true });
    writeFileSync(join(ws.dir, ".git", "config"), `[core]\n\tfsmonitor = touch ${canary}; echo\n`);
    writeFileSync(join(ws.dir, ".git", "hooks", "pre-commit"), `#!/bin/sh\ntouch ${canary}\n`, { mode: 0o755 });
    writeFileSync(join(ws.dir, "x.txt"), "hola\n");
    const d = await captureDiff(ws.dir, ws.baseCommit, { gitDir });
    assert.equal(existsSync(canary), false);
    assert.deepEqual(d.created, ["x.txt"]);
    assert.match(readFileSync(join(gitDir, "config"), "utf8"), /bare|worktree|core/);
  } finally { cleanup(root); }
});
