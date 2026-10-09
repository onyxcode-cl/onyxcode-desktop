import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BENCH_ROOT, buildEnv, createRunLayout, generateProfile, runSandboxed, sandboxAvailable } from "../../src/isolation/index.ts";

const skip = !sandboxAvailable();
const HIDDEN = join(BENCH_ROOT, "benchmarks", "node", "node-l1-002-leap-year", "hidden", "leap.hidden.test.ts");
const REF = join(BENCH_ROOT, "benchmarks", "node", "node-l1-002-leap-year", "reference.patch");

async function inSandbox(script: string, extra: Partial<Parameters<typeof runSandboxed>[0]> = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "ab-a7-")));
  try {
    const l = createRunLayout("abcdef1234567890", base);
    return await runSandboxed({ runRoot: l.root, cmd: "/bin/sh", args: ["-c", script], cwd: l.ws, env: buildEnv(l), timeoutSec: 20, ...extra });
  } finally { rmSync(base, { recursive: true, force: true }); }
}

test("A7: el perfil no puede leer ni listar benchmarks/ (hidden, reference.patch, cheat.patch)", { skip }, async () => {
  for (const f of [HIDDEN, REF, join(BENCH_ROOT, "benchmarks", "node", "node-l1-002-leap-year", "cheat.patch")]) {
    const r = await inSandbox(`cat "${f}"`);
    assert.notEqual(r.code, 0, f);
    assert.equal(r.stdout, "");
  }
  const ls = await inSandbox(`ls "${join(BENCH_ROOT, "benchmarks")}"`);
  assert.notEqual(ls.code, 0);
});

test("A7: ni siquiera con extraReadPaths que incluyan el banco o el home", { skip }, async () => {
  const r = await inSandbox(`cat "${HIDDEN}"`, { extraReadPaths: [BENCH_ROOT, join(BENCH_ROOT, "benchmarks"), join(BENCH_ROOT, "benchmarks", "node")] });
  assert.notEqual(r.code, 0);
  assert.equal(r.stdout, "");
  const p = generateProfile({ runRoot: tmpdir(), extraReadPaths: [BENCH_ROOT] });
  assert.ok(!p.split("\n").some((l) => l.startsWith("(allow file-read*") && l.includes(`"${BENCH_ROOT}"`)), "el banco no entra en los allow");
  const lines = p.split("\n");
  const denyIdx = lines.findIndex((l) => l.startsWith("(deny file-read-data") && l.includes(BENCH_ROOT));
  const lastAllow = lines.map((l, i) => (l.startsWith("(allow file-read*") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert.ok(denyIdx > lastAllow, "la denegación del banco va DESPUÉS de todos los allow de lectura");
});

test("M9: dentro del perfil fallan launchctl, pbpaste y open (sin acceso a launchd/LaunchServices/pasteboard)", { skip }, async () => {
  // control: fuera del sandbox funcionan (si no, la comprobación no distingue nada)
  const lc = spawnSync("/bin/launchctl", ["list"], { encoding: "utf8", timeout: 15_000 });
  if (lc.status === 0 && lc.stdout.length > 0) {
    const r = await inSandbox("/bin/launchctl list");
    assert.ok(r.code !== 0 || r.stdout.length === 0, "launchctl list devolvió datos dentro del sandbox");
  }
  const pb = spawnSync("/usr/bin/pbpaste", [], { encoding: "utf8", timeout: 15_000 });
  if (pb.status === 0) {
    const r = await inSandbox("/usr/bin/pbpaste");
    assert.notEqual(r.code, 0, "el pasteboard es accesible dentro del sandbox");
  }
  // open habla con LaunchServices (launchservicesd): oculto y en segundo plano para no molestar si no fallara
  const o = await inSandbox("/usr/bin/open -g -j -a Finder; echo rc=$?");
  assert.ok(!/rc=0/.test(o.stdout), "open funcionó dentro del sandbox: " + o.stdout);
  // y lo imprescindible sigue funcionando: node, git, perl, tar
  const ok = await inSandbox(`"${process.execPath}" -e "console.log('n-ok')" && /usr/bin/git --version && /usr/bin/perl -e 'print "p-ok\\n"' && /usr/bin/tar --version >/dev/null`);
  assert.equal(ok.code, 0, ok.stderr);
});

test("M9: el perfil restringido sigue dejando arrancar el binario real de opencode (--version, sin modelos)", { skip: skip || !existsSync(join(homedir(), ".opencode", "bin", "opencode")) }, async () => {
  const bin = join(homedir(), ".opencode", "bin", "opencode");
  const r = await inSandbox(`"${bin}" --version`, { network: "loopback" });
  assert.equal(r.code, 0, `${r.signal} ${r.stderr}`);
  assert.match(r.stdout, /^\d+\.\d+\.\d+/);
});
