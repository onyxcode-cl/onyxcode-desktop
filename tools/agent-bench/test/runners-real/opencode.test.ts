import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { OpenCodeRunner } from "../../src/runners/opencode/index.ts";
import { containsSecret } from "../../src/core/redact.ts";
import { cfg, limits, makeCtx, pgrepCount, readOut } from "./helpers.ts";

const AUTH = '{"fakeprov":{"type":"api","key":"sk-SECRETSECRETSECRET0123456789"}}';

async function exec(scenario: string, lim = limits(), opts: { signal?: AbortSignal; extra?: Record<string, unknown> } = {}) {
  const { ctx, root, done } = makeCtx({ OPENCODE_AUTH_CONTENT: AUTH });
  const runner = new OpenCodeRunner();
  const prepared = await runner.prepare(ctx, cfg("opencode", "fake-opencode.ts", scenario, opts.extra));
  const raw = await runner.run(prepared, { scenarioId: "s1", prompt: "haz algo" }, lim, opts.signal ?? new AbortController().signal);
  const collected = await runner.collect(prepared, raw);
  const clean = await runner.cleanup(prepared);
  return { ctx, root, done, raw, collected, clean };
}

test("opencode ok: telemetría completa, subagentes, aislamiento y sin secretos", async () => {
  const r = await exec("ok");
  try {
    assert.equal(r.raw.outcome, "completed");
    assert.equal(r.collected.outcome, "completed");
    assert.equal(r.clean.orphans, 0);
    const t = r.collected.telemetry;
    assert.equal(t.extra.dataSource, "sqlite");
    assert.equal(t.inputTokens, 165); // (100+30+5) + (20+10)
    assert.equal(t.outputTokens, 65); // (50+10) + 5
    assert.equal(t.cachedTokens, 40);
    assert.equal(t.reasoningTokens, 10);
    assert.equal(t.totalTokens, 230);
    assert.equal(t.llmCalls, 2);
    assert.equal(t.steps, 2);
    assert.equal(t.peakContext, 135);
    assert.ok(Math.abs((t.costUsd ?? 0) - 0.012) < 1e-9);
    assert.equal(t.toolCalls, 5);
    assert.equal(t.commands, 1);
    assert.deepEqual(t.filesRead, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(t.filesCreated, ["hello.txt"]);
    assert.deepEqual(t.filesModified, ["src/a.ts"]);
    assert.equal(t.extra.subagentSessions, 1);
    assert.equal((t.extra.tokenCrosscheck as { mismatch: boolean }).mismatch, false);
    assert.equal(t.extra.cacheWriteTokens, 5);
    assert.equal(t.extra.toolDurationMs, 40 + 400 + 10 + 200 + 10);
    assert.equal(r.raw.error, null);

    // aislamiento: HOME/XDG/config por run, claves, auth solo en env
    const seen = JSON.parse(readFileSync(join(r.ctx.home, ".local/share/opencode/env-seen.json"), "utf8"));
    assert.equal(seen.home, r.ctx.home);
    assert.equal(seen.hasAuth, true);
    assert.ok(seen.keys.includes("OPENCODE_DISABLE_AUTOUPDATE"));
    assert.ok(!seen.keys.includes("USER") && !seen.keys.includes("SHELL"));
    const conf = JSON.parse(seen.config);
    assert.equal(conf.permission["*"], "allow");
    for (const k of ["external_directory", "question", "doom_loop", "webfetch", "websearch"]) assert.equal(conf.permission[k], "deny");
    assert.equal(conf.agent.build.steps, 60);
    assert.equal(seen.configDir, join(r.root, "occonfig"));
    assert.ok(existsSync(join(r.ctx.workspace, "hello.txt")));

    // sin secretos en artefactos
    const out = readOut(r.ctx.out);
    assert.ok(!out.includes("SECRETSECRET"));
    assert.ok(!containsSecret(out));
  } finally {
    r.done();
  }
});

test("opencode orphan: el nieto desligado se limpia", async () => {
  const r = await exec("orphan");
  try {
    assert.equal(r.raw.outcome, "completed");
    assert.deepEqual((r.raw.raw as { serverOrphans: number[] }).serverOrphans, []);
    assert.equal(r.clean.orphans, 0);
    assert.equal(pgrepCount("sleep 317"), 0);
  } finally {
    r.done();
  }
});

test("opencode ratelimit => rate_limited (aborta al primer retry)", async () => {
  const r = await exec("ratelimit");
  try {
    assert.equal(r.raw.outcome, "rate_limited");
    assert.equal(r.collected.outcome, "rate_limited");
    assert.match(r.raw.error ?? "", /rate limit/i);
    assert.equal(r.clean.orphans, 0);
  } finally {
    r.done();
  }
});

test("opencode hang => hung por inactividad", async () => {
  const t0 = Date.now();
  const r = await exec("hang", limits({ inactivitySec: 0.6 }));
  try {
    assert.equal(r.raw.outcome, "hung");
    assert.ok(Date.now() - t0 < 15_000);
    assert.equal(r.clean.orphans, 0);
  } finally {
    r.done();
  }
});

test("opencode slow => timeout; cancel por señal < 10 s", async () => {
  const a = await exec("slow", limits({ timeoutSec: 1 }));
  try {
    assert.equal(a.raw.outcome, "timeout");
    assert.equal(a.clean.orphans, 0);
  } finally {
    a.done();
  }
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 600);
  const t0 = Date.now();
  const b = await exec("slow", limits(), { signal: ac.signal });
  try {
    assert.equal(b.raw.outcome, "cancelled");
    assert.ok(Date.now() - t0 < 10_000);
    assert.equal(b.clean.orphans, 0);
  } finally {
    b.done();
  }
});

test("opencode error de sesión => agent_error; crash => infra_error", async () => {
  const e = await exec("error");
  try {
    assert.equal(e.raw.outcome, "agent_error");
    assert.match(e.raw.error ?? "", /boom/);
  } finally {
    e.done();
  }
  const c = await exec("crash");
  try {
    assert.equal(c.raw.outcome, "infra_error");
  } finally {
    c.done();
  }
});

test("opencode tope de pasos => completed con stopReason max_steps", async () => {
  const r = await exec("ok", limits({ maxSteps: 1 }));
  try {
    assert.equal(r.raw.outcome, "completed");
    assert.equal((r.raw.raw as { stopReason: string }).stopReason, "max_steps");
  } finally {
    r.done();
  }
});

test("opencode probe con binario simulado", async () => {
  const runner = new OpenCodeRunner({ bin: { cmd: process.execPath, args: [new URL("./fake-opencode.ts", import.meta.url).pathname] } });
  const p = await runner.probe();
  assert.equal(p.available, true);
  assert.equal(p.version, "0.0.0-fake");
});
