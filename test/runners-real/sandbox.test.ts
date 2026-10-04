import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CodexRunner } from "../../src/runners/codex/index.ts";
import { OpenCodeRunner } from "../../src/runners/opencode/index.ts";
import { generateProfile, sandboxAvailable, sandboxWrap, defaultDenyReadPaths } from "../../src/isolation/index.ts";
import { cfg, limits, makeCtx, HERE } from "./helpers.ts";

const skip = !sandboxAvailable();

interface ProbeResult { reads: Record<string, string>; lists: Record<string, string>; writes: Record<string, string> }

/** Canario y destino de escape fuera del run; el agente simulado intenta leerlos/escribirlos dentro del perfil. */
async function probe(kind: "opencode" | "codex"): Promise<{ res: ProbeResult; outside: string; canary: string; escape: string; settingsHome: string }> {
  const { ctx, done } = makeCtx();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "ab-canary-")));
  try {
    const canary = join(outside, "canary.txt");
    const escape = join(outside, "escape.txt");
    writeFileSync(canary, "CANARIO-FUERA");
    const real = homedir();
    writeFileSync(join(ctx.home, "probe.json"), JSON.stringify({
      readPaths: [canary, `${real}/.ssh/id_ed25519`, `${real}/.aws/credentials`, `${real}/.config/gh/hosts.yml`],
      listDirs: [real, `${real}/.ssh`, `${real}/.config`, `${real}/Library/Application Support`, `${real}/.gnupg`],
      writePaths: [escape, join(real, "ab-escape-probe.txt"), "/private/tmp/ab-escape-probe.txt"],
    }));
    const config = cfg(kind, kind === "opencode" ? "fake-opencode.ts" : "fake-codex.ts", "probe", { network: "loopback" });
    const runner = kind === "opencode" ? new OpenCodeRunner() : new CodexRunner();
    assert.equal(runner.isolation, "seatbelt");
    const prepared = await runner.prepare(ctx, config);
    const raw = await runner.run(prepared, { scenarioId: "s", prompt: "x" }, limits(), new AbortController().signal);
    assert.equal(raw.outcome, "completed", String(raw.error));
    assert.equal((await runner.cleanup(prepared)).orphans, 0);
    const res = JSON.parse(readFileSync(join(ctx.home, "probe-result.json"), "utf8")) as ProbeResult;
    return { res, outside, canary, escape, settingsHome: ctx.home };
  } finally {
    done();
  }
}

for (const kind of ["opencode", "codex"] as const) {
  test(`${kind}: el binario simulado corre en Seatbelt, no lee canario/secretos ni escribe fuera`, { skip }, async () => {
    const r = await probe(kind);
    try {
      for (const [p, v] of Object.entries(r.res.reads)) assert.notEqual(v, "ok", `lectura permitida: ${p}`);
      for (const [p, v] of Object.entries(r.res.lists)) assert.notEqual(v, "ok", `listado permitido: ${p}`);
      for (const [p, v] of Object.entries(r.res.writes)) assert.notEqual(v, "ok", `escritura permitida: ${p}`);
      assert.equal(existsSync(r.escape), false);
      assert.equal(existsSync(join(homedir(), "ab-escape-probe.txt")), false);
      assert.equal(existsSync("/private/tmp/ab-escape-probe.txt"), false);
    } finally {
      rmSync(r.outside, { recursive: true, force: true });
    }
  });
}

test("sandboxWrap: perfil con denegaciones, escritura solo ws/home/tmp y red según modo", () => {
  const root = realpathSync(tmpdir());
  const w = sandboxWrap({ cmd: process.execPath, args: [HERE + "fake-codex.ts", "ok"] }, { runRoot: root, network: "loopback" });
  assert.equal(w.cmd, "/usr/bin/sandbox-exec");
  assert.equal(w.args[0], "-p");
  const prof = w.args[1] as string;
  assert.match(prof, /\(deny file-read\*/);
  for (const d of defaultDenyReadPaths()) assert.ok(prof.includes(`(subpath "${d}")`), d);
  assert.ok(prof.includes(`(literal "${realpathSync(HERE + "fake-codex.ts")}")`), "solo el script simulado (fichero) queda en lectura");
  assert.ok(!prof.includes(`(subpath "${realpathSync(HERE.replace(/\/$/, ""))}")`), "el directorio del banco no se expone");
  assert.match(prof, /\(deny file-read-data \(subpath/);
  assert.ok(!prof.includes("(allow network*)"));
  assert.match(prof, /localhost:\*/);
  assert.ok(generateProfile({ runRoot: root, network: "all" }).includes("(allow network*)"));
  assert.ok(!generateProfile({ runRoot: root, network: "none" }).includes("(allow network"));
  assert.equal(generateProfile({ runRoot: root }).split("\n").filter((l) => l.includes("file-write*")).length, 1);
});
