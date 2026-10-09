import { test } from "node:test";
import assert from "node:assert/strict";
import { descendantsOf, isAlive, killTree, parsePs, sleep, supervise, verifyNoOrphans } from "./proc.ts";

test("parsePs y descendantsOf", () => {
  const t = parsePs("  10  1  10\n  11 10  10\n  12 11  12\n  13  1  13\nbasura\n");
  assert.equal(t.length, 4);
  assert.deepEqual(descendantsOf(10, t).sort(), [11, 12]);
});

test("completa con salida y código", async () => {
  const r = await supervise({ cmd: "sh", args: ["-c", "echo hola; echo err >&2; exit 3"], timeoutMs: 10_000 });
  assert.equal(r.outcome, "completed");
  assert.equal(r.exitCode, 3);
  assert.equal(r.stdout.trim(), "hola");
  assert.equal(r.stderr.trim(), "err");
  assert.deepEqual(r.orphans, []);
});

test("comando inexistente => spawn_error", async () => {
  const r = await supervise({ cmd: "no-existe-xyz-123", timeoutMs: 5_000 });
  assert.equal(r.outcome, "spawn_error");
});

test("timeout mata el árbol completo sin huérfanos", async () => {
  const r = await supervise({ cmd: "sh", args: ["-c", "sleep 60 & sleep 60 & wait"], timeoutMs: 600, graceMs: 500 });
  assert.equal(r.outcome, "timeout");
  assert.deepEqual(r.orphans, []);
  assert.deepEqual(verifyNoOrphans(descendantsOf(r.pid as number)), []);
});

test("watchdog de inactividad => hung", async () => {
  const r = await supervise({ cmd: "sh", args: ["-c", "echo x; sleep 60"], timeoutMs: 20_000, inactivityMs: 800, graceMs: 500 });
  assert.equal(r.outcome, "hung");
  assert.ok(r.durationMs < 8000);
  assert.deepEqual(r.orphans, []);
});

test("actividad periódica evita hung", async () => {
  const r = await supervise({ cmd: "sh", args: ["-c", "for i in 1 2 3 4; do echo $i; sleep 0.4; done"], timeoutMs: 20_000, inactivityMs: 1500 });
  assert.equal(r.outcome, "completed");
});

test("cancelación por AbortSignal", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 400);
  const r = await supervise({ cmd: "sh", args: ["-c", "sleep 60 & wait"], timeoutMs: 20_000, signal: ac.signal, graceMs: 500 });
  assert.equal(r.outcome, "cancelled");
  assert.ok(r.durationMs < 5000);
  assert.deepEqual(r.orphans, []);
});

test("mata nietos que hicieron setsid y escaparon del grupo", async () => {
  const marker = `ab-test-${process.pid}-${Date.now()}`;
  const script = `perl -e 'use POSIX; POSIX::setsid(); exec "sh", "-c", "sleep 60; true", "${marker}"' & wait`;
  const r = await supervise({ cmd: "sh", args: ["-c", script], timeoutMs: 1500, graceMs: 500 });
  assert.equal(r.outcome, "timeout");
  await sleep(100);
  const { spawnSync } = await import("node:child_process");
  const found = spawnSync("pgrep", ["-f", marker], { encoding: "utf8" }).stdout.trim();
  assert.equal(found, "", "sleep escapado sigue vivo");
  assert.deepEqual(r.orphans, []);
});

test("limpia nietos huérfanos aunque el líder salga solo", async () => {
  const marker = `ab-test2-${process.pid}-${Date.now()}`;
  const r = await supervise({ cmd: "sh", args: ["-c", `sh -c 'sleep 60; true' ${marker} & exit 0`], timeoutMs: 10_000, graceMs: 500 });
  assert.equal(r.outcome, "completed");
  await sleep(100);
  const { spawnSync } = await import("node:child_process");
  assert.equal(spawnSync("pgrep", ["-f", marker], { encoding: "utf8" }).stdout.trim(), "");
});

test("SIGKILL cuando ignora SIGTERM", async () => {
  const r = await supervise({ cmd: "sh", args: ["-c", "trap '' TERM; while :; do sleep 1; done"], timeoutMs: 500, graceMs: 600 });
  assert.equal(r.outcome, "timeout");
  assert.deepEqual(r.orphans, []);
});

test("killTree sobre pid directo", async () => {
  const { spawn } = await import("node:child_process");
  const c = spawn("sh", ["-c", "sleep 60 & wait"], { detached: true, stdio: "ignore" });
  await sleep(200);
  const pid = c.pid as number;
  const res = await killTree(pid, { graceMs: 500 });
  assert.deepEqual(res.orphans, []);
  assert.equal(isAlive(pid), false);
});

test("trunca salida por encima del tope pero termina", async () => {
  const r = await supervise({ cmd: "sh", args: ["-c", "yes abcdefghij | head -c 200000"], timeoutMs: 10_000, maxOutputBytes: 1000 });
  assert.equal(r.outcome, "completed");
  assert.equal(r.truncated, true);
  assert.equal(r.stdout.length, 1000);
});
