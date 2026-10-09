import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvalCopy, TreeDeadSignal } from "../../src/workspace/index.ts";
import { writeFileNoFollow } from "../../src/core/safefs.ts";
import { createRunLayout } from "../../src/isolation/layout.ts";
import { buildEnv } from "../../src/isolation/env.ts";
import { runSandboxed, sandboxAvailable } from "../../src/isolation/seatbelt.ts";
import { cleanup, tmp } from "../helpers.ts";

// C2: el agente planta symlinks en carpetas que el banco escribe después, sin sandbox.

function dead(): TreeDeadSignal { const s = new TreeDeadSignal(); s.markDead(); return s; }

test("C2: ws/link -> directorio externo; los ocultos NO se escriben a través del enlace", async () => {
  const root = tmp();
  try {
    const canaryDir = join(root, "fuera");
    mkdirSync(canaryDir);
    const ws = join(root, "ws");
    mkdirSync(ws);
    symlinkSync(canaryDir, join(ws, "sub"));
    writeFileSync(join(ws, "ok.txt"), "ok\n");
    const hidden = join(root, "hidden");
    mkdirSync(join(hidden, "sub"), { recursive: true });
    writeFileSync(join(hidden, "sub", "x.test.js"), "// oculto\n");
    const r = await createEvalCopy({ workspaceDir: ws, evalDir: join(root, "eval"), hiddenDir: hidden, treeDead: dead() });
    assert.deepEqual(readdirSync(canaryDir), [], "se escribió a través del symlink");
    assert.deepEqual(r.rejectedSymlinks, ["sub"]);
    assert.ok(lstatSync(join(root, "eval", "sub", "x.test.js")).isFile());
    assert.equal(lstatSync(join(root, "eval", "sub")).isSymbolicLink(), false);
    assert.equal(readFileSync(join(root, "eval", "ok.txt"), "utf8"), "ok\n");
  } finally { cleanup(root); }
});

test("C2: ws/cfg -> archivo canario; el oculto con el mismo nombre no lo sobrescribe", async () => {
  const root = tmp();
  try {
    const canary = join(root, "canario.txt");
    writeFileSync(canary, "ORIGINAL");
    const ws = join(root, "ws");
    mkdirSync(ws);
    symlinkSync(canary, join(ws, "cfg.test.js"));
    const hidden = join(root, "hidden");
    mkdirSync(hidden);
    writeFileSync(join(hidden, "cfg.test.js"), "// oculto\n");
    await createEvalCopy({ workspaceDir: ws, evalDir: join(root, "eval"), hiddenDir: hidden, treeDead: dead() });
    assert.equal(readFileSync(canary, "utf8"), "ORIGINAL");
  } finally { cleanup(root); }
});

test("C2: un .git plantado por el agente no se copia a la copia de evaluación", async () => {
  const root = tmp();
  try {
    const ws = join(root, "ws");
    mkdirSync(join(ws, ".git"), { recursive: true });
    writeFileSync(join(ws, ".git", "config"), "[core]\n\tfsmonitor = x\n");
    writeFileSync(join(ws, "a.txt"), "a");
    await createEvalCopy({ workspaceDir: ws, evalDir: join(root, "eval"), hiddenDir: null, treeDead: dead() });
    assert.equal(existsSync(join(root, "eval", ".git")), false);
    assert.equal(existsSync(join(root, "eval", "a.txt")), true);
  } finally { cleanup(root); }
});

test("C2: writeFileNoFollow se niega a escribir a través de un symlink (out/x -> canario)", () => {
  const root = tmp();
  try {
    const canary = join(root, "zshrc");
    writeFileSync(canary, "ORIGINAL");
    const out = join(root, "out");
    mkdirSync(out);
    symlinkSync(canary, join(out, "opencode-raw.json"));
    assert.throws(() => writeFileNoFollow(join(out, "opencode-raw.json"), "PWN"));
    assert.equal(readFileSync(canary, "utf8"), "ORIGINAL");
    writeFileNoFollow(join(out, "normal.json"), "{}");
    assert.equal(readFileSync(join(out, "normal.json"), "utf8"), "{}");
    // directorio padre symlink
    const link = join(root, "outlink");
    symlinkSync(out, link);
    assert.throws(() => writeFileNoFollow(join(link, "y.json"), "x"));
  } finally { cleanup(root); }
});

test("C2: dentro de Seatbelt el agente no puede escribir ni enlazar en out/, eval/, ctl/ ni en la raíz del run", { skip: !sandboxAvailable() }, async () => {
  const base = realpathSync(tmp());
  const outside = realpathSync(tmp());
  try {
    const l = createRunLayout("abcdef1234567890", base);
    const canary = join(outside, "zshrc");
    writeFileSync(canary, "ORIGINAL");
    const env = buildEnv(l);
    const run = (script: string) => runSandboxed({ runRoot: l.root, cmd: "/bin/sh", args: ["-c", script], cwd: l.ws, env, timeoutSec: 20 });
    for (const d of [l.out, l.eval, l.ctl, l.root]) {
      const w = await run(`ln -s "${canary}" "${d}/x" ; echo hola > "${d}/y"`);
      assert.equal(existsSync(join(d, "x")) || existsSync(join(d, "y")), false, `escribió en ${d}: ${w.stderr}`);
    }
    // sí puede en ws, home y tmp
    for (const d of [l.ws, l.home, l.tmp]) {
      const w = await run(`echo hola > "${d}/y"`);
      assert.equal(w.code, 0, `${d}: ${w.stderr}`);
    }
    // no puede sustituir out por un symlink (rename/rm en la raíz)
    await run(`rm -rf "${l.out}"; ln -s "${outside}" "${l.out}"`);
    assert.equal(lstatSync(l.out).isSymbolicLink(), false);
    assert.equal(readFileSync(canary, "utf8"), "ORIGINAL");
  } finally { cleanup(base, outside); void tmpdir; }
});
