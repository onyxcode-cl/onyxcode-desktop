import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunLayout, removeRunLayout } from "../../src/isolation/layout.ts";
import { buildEnv } from "../../src/isolation/env.ts";
import { generateProfile, runSandboxed, sandboxAvailable } from "../../src/isolation/seatbelt.ts";
import { evaluateGate, parseVmStat, loadGate } from "../../src/isolation/gate.ts";
import { doctor } from "../../src/isolation/doctor.ts";

const tmpBase = () => realpathSync(mkdtempSync(join(tmpdir(), "ab-iso-")));

test("layout crea los 6 directorios bajo la base", () => {
  const base = tmpBase();
  try {
    const l = createRunLayout("abcdef1234567890", base);
    assert.equal(l.runId8, "abcdef12");
    for (const d of [l.ws, l.home, l.tmp, l.eval, l.out, l.ctl]) assert.ok(existsSync(d));
    assert.ok(l.root.startsWith(base));
    assert.throws(() => createRunLayout("../x", base));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("entorno: lista blanca, HOME/XDG propios, PATH mínimo", () => {
  const base = tmpBase();
  try {
    const l = createRunLayout("abcdef1234567890", base);
    const env = buildEnv(l, { parentEnv: { LANG: "es_CL.UTF-8", OPENAI_API_KEY: "secreto", HOME: "/Users/x", AWS_TOKEN: "t" } });
    assert.equal(env.LANG, "es_CL.UTF-8");
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.AWS_TOKEN, undefined);
    assert.equal(env.HOME, l.home);
    for (const k of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
      assert.ok(env[k]!.startsWith(l.home), k);
    }
    assert.equal(env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("perfil contiene deny default y escritura solo en ws/home/tmp del run", () => {
  const base = tmpBase();
  try {
    const p = generateProfile({ runRoot: base });
    assert.match(p, /\(deny default\)/);
    const writes = p.split("\n").filter((x) => x.includes("file-write*"));
    assert.equal(writes.length, 1);
    for (const d of ["ws", "home", "tmp"]) assert.ok(writes[0]!.includes(`${base}/${d}"`), d);
    for (const d of ["out", "eval", "ctl"]) assert.ok(!writes[0]!.includes(`${base}/${d}`), `${d} no debe ser escribible`);
    // .ssh solo aparece en denegaciones, nunca en permisos
    for (const l of p.split("\n").filter((x) => x.includes(".ssh"))) assert.match(l, /^\(deny file-read\*/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("load gate: decisiones por umbral", () => {
  const ok = evaluateGate({ loadPerCpu: 0.2, ncpu: 8, freeMemMB: 4000, thermal: "nominal" });
  assert.equal(ok.status, "ok");
  const p = evaluateGate({ loadPerCpu: 0.9, ncpu: 8, freeMemMB: 100, thermal: "warning" });
  assert.equal(p.status, "pausa");
  if (p.status === "pausa") assert.match(p.reason, /carga.*memoria.*térmico/);
  const g = loadGate();
  assert.ok(g.status === "ok" || g.status === "pausa");
  assert.equal(parseVmStat("page size of 16384 bytes)\nPages free: 64.\nPages inactive: 64.\n"), 2);
});

test("doctor reporta sin ejecutar modelos", () => {
  const r = doctor({ managedConfigDir: "/no/existe/opencode" });
  assert.equal(r.schemaVersion, "1");
  assert.ok(r.checks.find((c) => c.name === "node")?.status === "ok");
  assert.ok(r.checks.find((c) => c.name === "sandbox-exec"));
  const bad = doctor({ managedConfigDir: tmpdir() });
  assert.equal(bad.checks.find((c) => c.name === "config-gestionada")?.status, "fail");
  assert.equal(bad.ok, false);
});

test("sandbox: escribe en runRoot, no fuera, no lee canario", { skip: !sandboxAvailable() }, async () => {
  const base = tmpBase();
  const outside = tmpBase(); // fuera del run root: también hace de "~/.ssh" simulado
  try {
    const l = createRunLayout("abcdef1234567890", base);
    const canary = join(outside, "id_canary");
    writeFileSync(canary, "SECRETO-CANARIO");
    const env = buildEnv(l);
    // Un `code === null` sin timeout significa que una señal externa mató al hijo (p. ej. un pkill -f de otro
    // proceso de la máquina durante `npm test` completo): es ruido de infraestructura, no del aislamiento.
    // Se reintenta hasta 2 veces; un fallo real del perfil devuelve código distinto de null y no se reintenta.
    const run = async (script: string) => {
      let r = await runSandboxed({ runRoot: l.root, cmd: "/bin/sh", args: ["-c", script], cwd: l.ws, env, timeoutSec: 20 });
      for (let i = 0; i < 2 && r.code === null && !r.timedOut; i++) {
        r = await runSandboxed({ runRoot: l.root, cmd: "/bin/sh", args: ["-c", script], cwd: l.ws, env, timeoutSec: 20 });
      }
      return r;
    };

    const inside = await run(`echo hola > "${l.ws}/a.txt"`);
    assert.equal(inside.code, 0, `signal=${inside.signal} timedOut=${inside.timedOut} stderr=${inside.stderr}`);
    assert.equal(readFileSync(join(l.ws, "a.txt"), "utf8").trim(), "hola");

    const w = await run(`echo x > "${outside}/escape.txt"`);
    assert.notEqual(w.code, 0);
    assert.ok(!existsSync(join(outside, "escape.txt")));

    const r = await run(`cat "${canary}"`);
    assert.notEqual(r.code, 0);
    assert.ok(!r.stdout.includes("SECRETO-CANARIO"));

    const n = await run(`"${process.execPath}" -e "process.stdout.write('node-ok')"`);
    assert.equal(n.stdout, "node-ok", n.stderr);
    removeRunLayout(l);
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
